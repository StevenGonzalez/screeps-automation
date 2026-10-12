// The gold desk plays the market in gold. While gold sells far under its usual
// price it keeps a standing bid, so the sellers pay the carrying; half of what
// the bid buys goes on to the castles' treasuries and half is held in the
// terminal, kept from the enchanters, to be sold again once the price climbs
// back. Held gold is offered no lower than a margin over what it cost.
//
// The usual price is the median of the market's daily averages, two weeks of
// them, so a slump that lasts becomes the usual price and the buying stops.

declare global {
  interface Memory {
    goldDesk?: GoldDeskMemory;
  }
}

export interface GoldDeskMemory {
  // Gold held for resale, by castle, and the credits it cost.
  held: Record<string, number>;
  heldCost: number;
  // Credits laid out on gold and order fees, less what held gold sold for.
  invested: number;
  // Lifetime tallies for the books.
  bought: number;
  boughtFor: number;
  sold: number;
  soldFor: number;
  // Last tick whose transactions are on the books.
  seenAt: number;
}

export const GOLD_DESK = {
  INTERVAL: 50,
  // Trades are booked this often: soon enough that held gold is on the books
  // before the filler, draining the terminal a load at a time, reaches it.
  BOOK_EVERY: 10,
  // Gold is cheap below this share of its usual price: the desk bids, and
  // never above it.
  BUY_BELOW: 0.6,
  // The standing bid is withdrawn once the price is back above this share.
  WITHDRAW_ABOVE: 0.75,
  BID_STEP: 0.01,
  BID_LOT: 20_000,
  // A bid is moved only when the price it should stand at is this far off,
  // as raising one costs a fee on the difference.
  REPRICE_TOLERANCE: 0.02,
  // Credits the desk may have out at once, and the credits it never touches.
  BUDGET: 2_000_000,
  CREDIT_RESERVE: 3_000_000,
  // Share of each purchase held for resale, and the most one castle holds.
  HOLD_SHARE: 0.5,
  HOLD_CAP: 100_000,
  // Held gold is offered once the price is back above this share of the
  // usual price, and never under it or under MIN_MARGIN times its cost.
  ASK_FLOOR: 0.8,
  MIN_MARGIN: 1.3,
  UNDERCUT: 0.01,
  // Treasuries at or above this are fed by no bid.
  FEED_BELOW: 350_000,
  MIN_LOT: 1_000,
  ORDER_FEE: 0.05,
};

// Gold the terminal keeps for its own sends and deals, which held gold never counts.
const TERMINAL_WORKING_GOLD = 1_000;

const HISTORY_TTL = 100;
let historyAt = -Infinity;
let usualCache: number | undefined;
let todayCache: number | undefined;

function readHistory(): void {
  if (Game.time - historyAt < HISTORY_TTL) return;
  historyAt = Game.time;
  const days = Game.market.getHistory(RESOURCE_ENERGY);
  if (days.length === 0) {
    usualCache = todayCache = undefined;
    return;
  }
  const prices = days.map((d) => d.avgPrice).sort((a, b) => a - b);
  const mid = prices.length >> 1;
  usualCache = prices.length % 2 ? prices[mid] : (prices[mid - 1] + prices[mid]) / 2;
  todayCache = days[days.length - 1].avgPrice;
}

/** Gold's usual price: the median of the market's daily averages. */
export function usualGoldPrice(): number | undefined {
  readHistory();
  return usualCache;
}

/** Today's average price of gold so far. */
export function todaysGoldPrice(): number | undefined {
  readHistory();
  return todayCache;
}

export function desk(): GoldDeskMemory {
  if (!Memory.goldDesk) {
    Memory.goldDesk = {
      held: {},
      heldCost: 0,
      invested: 0,
      bought: 0,
      boughtFor: 0,
      sold: 0,
      soldFor: 0,
      seenAt: Game.time - 1,
    };
  }
  return Memory.goldDesk;
}

/** Gold held for resale in a castle's terminal, which the filler leaves there. */
export function heldGold(roomName: string): number {
  return Memory.goldDesk?.held[roomName] ?? 0;
}

function totalHeld(d: GoldDeskMemory): number {
  let n = 0;
  for (const r in d.held) n += d.held[r];
  return n;
}

/** What one held unit cost, on average. */
function heldUnitCost(d: GoldDeskMemory): number {
  const n = totalHeld(d);
  return n > 0 ? d.heldCost / n : 0;
}

/** Least a unit of held gold is sold for. */
export function heldSellFloor(): number | undefined {
  const usual = usualGoldPrice();
  if (usual === undefined) return undefined;
  return Math.max(usual * GOLD_DESK.ASK_FLOOR, heldUnitCost(desk()) * GOLD_DESK.MIN_MARGIN);
}

/** Highest effective price the desk pays for gold now, or undefined while it is not cheap. */
export function goldBuyCap(): number | undefined {
  const usual = usualGoldPrice();
  const today = todaysGoldPrice();
  if (usual === undefined || today === undefined) return undefined;
  const cap = usual * GOLD_DESK.BUY_BELOW;
  return today <= cap ? cap : undefined;
}

function myGoldOrders(type: string): Order[] {
  return Object.values(Game.market.orders).filter((o) => o.type === type && o.resourceType === RESOURCE_ENERGY);
}

/** Credits the desk may still commit, after what its open bids would take. */
export function deskSpendRoom(): number {
  const d = desk();
  let owed = 0;
  for (const o of myGoldOrders(ORDER_BUY)) owed += o.remainingAmount * o.price;
  return Math.max(
    0,
    Math.min(GOLD_DESK.BUDGET - d.invested - owed, Game.market.credits - GOLD_DESK.CREDIT_RESERVE - owed)
  );
}

/**
 * Books every gold trade since the last read: gold bought from another lord,
 * half held where it landed, and gold sold to one, taken first from what is held.
 */
export function bookTrades(): void {
  const d = desk();
  const seen = d.seenAt;
  // Only ticks already over: a deal made this tick may not be on the books yet.
  // A send between our own castles is no trade.
  const fresh = (t: Transaction) =>
    t.time > seen &&
    t.time < Game.time &&
    t.resourceType === RESOURCE_ENERGY &&
    !!t.order &&
    t.sender?.username !== t.recipient?.username;
  for (const t of Game.market.incomingTransactions) {
    if (!fresh(t)) continue;
    const price = t.order!.price;
    d.bought += t.amount;
    d.boughtFor += t.amount * price;
    d.invested += t.amount * price;
    const room = t.to;
    const hold = Math.max(
      0,
      Math.min(Math.floor(t.amount * GOLD_DESK.HOLD_SHARE), GOLD_DESK.HOLD_CAP - heldGold(room))
    );
    if (hold > 0) {
      d.held[room] = heldGold(room) + hold;
      d.heldCost += hold * price;
    }
  }
  for (const t of Game.market.outgoingTransactions) {
    if (!fresh(t)) continue;
    const price = t.order!.price;
    d.sold += t.amount;
    d.soldFor += t.amount * price;
    const fromHeld = Math.min(heldGold(t.from), t.amount);
    if (fromHeld > 0) {
      d.heldCost -= fromHeld * heldUnitCost(d);
      d.held[t.from] -= fromHeld;
      d.invested -= fromHeld * price;
    }
  }
  d.seenAt = Game.time - 1;
}

/** Holds no more than a castle's terminal has, past the gold the terminal works on. */
function settleHeld(d: GoldDeskMemory): void {
  for (const name in d.held) {
    const terminal = Game.rooms[name]?.terminal;
    const has = terminal?.my ? Math.max(0, (terminal.store[RESOURCE_ENERGY] ?? 0) - TERMINAL_WORKING_GOLD) : 0;
    if (d.held[name] > has) {
      const lost = d.held[name] - has;
      d.heldCost -= lost * heldUnitCost(d);
      d.held[name] = has;
    }
    if (d.held[name] <= 0) delete d.held[name];
  }
  if (totalHeld(d) === 0) d.heldCost = 0;
}

function bestRivalPrice(type: string): number | undefined {
  let best: number | undefined;
  for (const o of Game.market.getAllOrders({ resourceType: RESOURCE_ENERGY })) {
    if (o.type !== type || o.amount <= 0 || o.id in Game.market.orders) continue;
    if (best === undefined || (type === ORDER_BUY ? o.price > best : o.price < best)) best = o.price;
  }
  return best;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** Keeps one standing bid for gold while it is cheap, at the poorest castle with a terminal. */
function manageBid(): void {
  const usual = usualGoldPrice();
  const today = todaysGoldPrice();
  if (usual === undefined || today === undefined) return;
  const bids = myGoldOrders(ORDER_BUY);

  if (today > usual * GOLD_DESK.WITHDRAW_ABOVE) {
    for (const o of bids) {
      Game.market.cancelOrder(o.id);
      console.log(`[GoldDesk] Withdrew the bid at ${o.roomName}: gold is back at ${today.toFixed(1)}`);
    }
    return;
  }

  const cap = usual * GOLD_DESK.BUY_BELOW;
  const rival = bestRivalPrice(ORDER_BUY);
  const price = round3(Math.min(cap, (rival ?? 0) + GOLD_DESK.BID_STEP));
  const room = deskSpendRoom();

  const bid = bids[0];
  if (bid) {
    if (Math.abs(bid.price - price) / price > GOLD_DESK.REPRICE_TOLERANCE) {
      const fee = Math.max(0, price - bid.price) * bid.remainingAmount * GOLD_DESK.ORDER_FEE;
      if (fee <= room && Game.market.changeOrderPrice(bid.id, price) === OK) {
        desk().invested += fee;
        console.log(`[GoldDesk] Moved the bid at ${bid.roomName} from ${bid.price} to ${price}`);
      }
      return;
    }
    if (bid.remainingAmount < GOLD_DESK.MIN_LOT) {
      const add = Math.floor(Math.min(GOLD_DESK.BID_LOT - bid.remainingAmount, room / (bid.price * (1 + GOLD_DESK.ORDER_FEE))));
      if (add >= GOLD_DESK.MIN_LOT && Game.market.extendOrder(bid.id, add) === OK) {
        desk().invested += add * bid.price * GOLD_DESK.ORDER_FEE;
      }
    }
    return;
  }

  if (today > cap) return;
  const castle = poorestTerminalCastle();
  if (!castle) return;
  const amount = Math.floor(Math.min(GOLD_DESK.BID_LOT, room / (price * (1 + GOLD_DESK.ORDER_FEE))));
  if (amount < GOLD_DESK.MIN_LOT) return;
  const result = Game.market.createOrder({
    type: ORDER_BUY,
    resourceType: RESOURCE_ENERGY,
    price,
    totalAmount: amount,
    roomName: castle.name,
  });
  if (result === OK) {
    desk().invested += amount * price * GOLD_DESK.ORDER_FEE;
    console.log(`[GoldDesk] Bid ${price} for ${amount} gold at ${castle.name} (usual ${usual.toFixed(1)}, today ${today.toFixed(1)})`);
  }
}

function poorestTerminalCastle(): Room | undefined {
  let best: Room | undefined;
  for (const name in Game.rooms) {
    const room = Game.rooms[name];
    if (!room.controller?.my || !room.terminal?.my || !room.storage) continue;
    if (room.terminal.store.getFreeCapacity() < GOLD_DESK.BID_LOT) continue;
    const stored = room.storage.store[RESOURCE_ENERGY] ?? 0;
    if (stored >= GOLD_DESK.FEED_BELOW) continue;
    if (!best || stored < (best.storage!.store[RESOURCE_ENERGY] ?? 0)) best = room;
  }
  return best;
}

/** Offers each castle's held gold once the price has climbed back. */
function manageAsks(): void {
  const d = desk();
  const usual = usualGoldPrice();
  const today = todaysGoldPrice();
  const floor = heldSellFloor();
  if (usual === undefined || today === undefined || floor === undefined) return;
  if (today < usual * GOLD_DESK.ASK_FLOOR) return;
  const rival = bestRivalPrice(ORDER_SELL);
  const price = round3(Math.max(floor, rival !== undefined ? rival - GOLD_DESK.UNDERCUT : usual));
  const asks = myGoldOrders(ORDER_SELL);

  for (const name in d.held) {
    const held = d.held[name];
    const ask = asks.find((o) => o.roomName === name);
    if (ask) {
      if (Math.abs(ask.price - price) / price > GOLD_DESK.REPRICE_TOLERANCE) {
        const fee = Math.max(0, price - ask.price) * ask.remainingAmount * GOLD_DESK.ORDER_FEE;
        if (Game.market.credits - fee >= GOLD_DESK.CREDIT_RESERVE && Game.market.changeOrderPrice(ask.id, price) === OK) {
          d.invested += fee;
        }
      }
      const add = held - ask.remainingAmount;
      if (add >= GOLD_DESK.MIN_LOT) {
        const fee = add * ask.price * GOLD_DESK.ORDER_FEE;
        if (Game.market.credits - fee >= GOLD_DESK.CREDIT_RESERVE && Game.market.extendOrder(ask.id, add) === OK) {
          d.invested += fee;
        }
      }
      continue;
    }
    if (held < GOLD_DESK.MIN_LOT) continue;
    const fee = held * price * GOLD_DESK.ORDER_FEE;
    if (Game.market.credits - fee < GOLD_DESK.CREDIT_RESERVE) continue;
    const result = Game.market.createOrder({
      type: ORDER_SELL,
      resourceType: RESOURCE_ENERGY,
      price,
      totalAmount: held,
      roomName: name,
    });
    if (result === OK) {
      d.invested += fee;
      console.log(`[GoldDesk] Offered ${held} held gold at ${name} for ${price} (cost ${heldUnitCost(d).toFixed(1)})`);
    }
  }
}

export function loop(): void {
  if (!Game.market) return;
  if (Game.time % GOLD_DESK.BOOK_EVERY === 0) bookTrades();
  if (Game.time % GOLD_DESK.INTERVAL !== 0) return;
  const d = desk();
  settleHeld(d);
  manageBid();
  manageAsks();
}

export function describeDesk(): string[] {
  const d = desk();
  const usual = usualGoldPrice();
  const today = todaysGoldPrice();
  const lines = [
    `gold usual ${usual?.toFixed(1) ?? "?"}, today ${today?.toFixed(1) ?? "?"}, credits ${Math.round(Game.market.credits)}`,
    `bought ${d.bought} for ${Math.round(d.boughtFor)}, sold ${d.sold} for ${Math.round(d.soldFor)}, invested ${Math.round(d.invested)}`,
  ];
  for (const name in d.held) lines.push(`held at ${name}: ${d.held[name]}`);
  if (totalHeld(d) > 0) lines.push(`held cost ${heldUnitCost(d).toFixed(1)} a unit, floor ${heldSellFloor()?.toFixed(1) ?? "?"}`);
  for (const o of Object.values(Game.market.orders)) {
    if (o.resourceType === RESOURCE_ENERGY) lines.push(`${o.type} ${o.remainingAmount} at ${o.roomName} for ${o.price}`);
  }
  return lines;
}
