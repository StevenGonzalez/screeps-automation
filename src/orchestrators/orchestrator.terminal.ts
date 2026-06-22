/**
 * Terminal Orchestrator
 * Handles mineral sales, base-mineral buying, and inter-room resource balancing.
 */

import { NUKER_GHODIUM_RESERVE } from "./orchestrator.nuker";
import { MANAGED_COMMODITIES } from "../config/config.factory";

// Module augmentation — the market-maker keeps a tiny rolling price record and a couple
// of throttles in Memory. Kept here (not in types.d.ts) because the terminal fully owns
// this slice of memory.
declare global {
  interface Memory {
    // Bounded rolling record of recently-SEEN sale prices, per resource type, used as a
    // sanity floor so we never post/sell well below our own recent average.
    marketPrices?: Record<string, number[]>;
  }
  interface RoomMemory {
    // Throttle: last tick this room reconciled its market-maker sell orders.
    lastOrderManageTick?: number;
    // Throttle: last tick this room evaluated surplus-energy market trading.
    lastEnergyTradeTick?: number;
  }
}

// ── Sell config ───────────────────────────────────────────────────────────────

const TERMINAL_CONFIG = {
  MINERAL_SELL_THRESHOLD: 1000,
  MINERAL_MAX_TRADE_AMOUNT: 1000,
  MIN_PRICE_RATIO: 0.5,       // sell only at >= this fraction of the recent market average
  MAX_TRADE_DISTANCE: 10,
  MIN_TERMINAL_ENERGY: 1000,
};

// ── Buy config ────────────────────────────────────────────────────────────────

const BUY_CONFIG = {
  INTERVAL: 500,
  MIN_STOCK: 500,
  TARGET_STOCK: 3000,
  MAX_PRICE: 50,
  MAX_AMOUNT: 1000,
};

// ── Ghodium (nuker) config ────────────────────────────────────────────────────
//
// Ghodium (G) loads our offensive nukers (see orchestrator.nuker.ts). We keep one
// NUKER_GHODIUM_RESERVE worth available per room that has a nuker. G is also a lab/boost
// reagent, so the reserve is kept SEPARATE from the lab buy logic: lab chains still buy G
// to TARGET_STOCK via the normal mineral path, and the nuker reserve sits on top of that —
// we only buy/transfer to cover (reserve + lab target), never cannibalizing lab ghodium.

const GHODIUM_CONFIG = {
  INTERVAL: 500,      // throttle market buys (matches BUY_CONFIG.INTERVAL cadence)
  MAX_PRICE: 8,       // G is cheap-ish; cap to avoid overpaying on a thin order book
  MAX_AMOUNT: 1000,   // per market deal
  TRANSFER_AMOUNT: 1000, // G per inter-room transfer
};

// ── Network balancing config ──────────────────────────────────────────────────

const NETWORK_CONFIG = {
  PLAN_INTERVAL: 100,
  ENERGY_RICH_THRESHOLD: 200_000,    // donate energy if storage above this
  ENERGY_POOR_THRESHOLD: 50_000,     // accept energy if storage below this
  ENERGY_TRANSFER_AMOUNT: 30_000,    // energy sent to receiver per transfer
  ENERGY_MAX_TRANSFERS_PER_PASS: 4,  // cap donor→receiver pairs queued per planning pass
  MINERAL_SURPLUS_THRESHOLD: 2_000,  // only donate mineral if stock above this + needed
  MINERAL_TRANSFER_AMOUNT: 1_000,    // minerals per transfer
  MAX_DISTANCE: 10,                  // skip cross-room transfers beyond this
};

// ── Market-maker (sell orders) config ─────────────────────────────────────────
//
// In addition to the deal()-taker path (which always pays the 5% taker premium), we
// post our OWN sell orders to capture the bid/ask spread. Order management is throttled
// and bounded so we never spam createOrder (each post costs credits = 0.05 × total value)
// and never hold more orders than we can babysit.

const MARKET_MAKER_CONFIG = {
  MANAGE_INTERVAL: 50,        // reconcile this room's orders at most this often
  MAX_ACTIVE_ORDERS: 12,      // empire-wide cap on our live sell orders (credit-cost guard)
  MIN_SELL_SURPLUS: 5_000,    // only post a sell order once we hold this much of a resource
  ORDER_LOT: 5_000,           // remaining-amount we aim to keep on a live order
  TOPUP_THRESHOLD: 1_000,     // top a thinning order back up once it drops below this
  UNDERCUT: 0.001,            // price just under the best competing ask (capture the sale)
  MIN_CREDITS_TO_POST: 10_000, // never post orders unless we have a healthy credit cushion
  PRICE_FLOOR_RATIO: 0.9,     // never price below this fraction of our recent seen average
  REPRICE_TOLERANCE: 0.15,    // cancel+replace if our price drifts >15% from the new fair price
};

// Resources we are willing to market-make: the room's own mineral plus managed commodities.
// (Base lab minerals and ghodium are things we BUY/keep, so they're excluded from selling.)

// ── Energy trading config ─────────────────────────────────────────────────────
//
// Sell only TRUE empire-wide surplus energy (storage persistently very high, well above
// the inter-room donor threshold so we don't fight the balancer), and buy energy when the
// market is unusually cheap and a room is genuinely low. Sane floors/ceilings throughout.

const ENERGY_TRADE_CONFIG = {
  INTERVAL: 100,                 // throttle energy market evaluation per room
  SELL_STORAGE_THRESHOLD: 400_000, // only sell surplus when storage is persistently this high
  SELL_KEEP: 350_000,            // never let a market sale draw storage below this
  SELL_MIN_PRICE: 2,             // don't sell energy for less than this many credits/unit
  SELL_MAX_AMOUNT: 5_000,        // cap per energy sell deal
  BUY_STORAGE_THRESHOLD: 30_000, // only buy energy when a room is genuinely low
  BUY_MAX_PRICE: 1,              // energy is "cheap" below this — worth buying with credits
  BUY_MAX_AMOUNT: 5_000,         // cap per energy buy deal
  MIN_CREDITS_TO_BUY: 50_000,    // keep a credit cushion; only buy energy above this
};

// ── Rolling price record config ───────────────────────────────────────────────
const PRICE_HISTORY_LEN = 20;     // bounded samples kept per resource

const BASE_MINERALS: MineralConstant[] = ['H', 'O', 'Z', 'K', 'U', 'L', 'X'];

// Base minerals + ghodium are bought/kept, never market-made for sale.
const NON_SELLABLE = new Set<ResourceConstant>([...BASE_MINERALS, RESOURCE_GHODIUM, RESOURCE_ENERGY]);

// Drop a queued inter-room send that hasn't gone through after this many ticks so a
// send that can't be filled or paid for never permanently freezes the room's balancing.
const SEND_STALL_TIMEOUT = 1500;

// ── Main loop ─────────────────────────────────────────────────────────────────

// ── Market order-book cache ─────────────────────────────────────────────────────
//
// Game.market.getAllOrders() is one of the most CPU-expensive calls in the API — it
// returns (and deserializes) the entire global order book. The terminal queries it from
// several places, per owned room and per candidate resource, every tick; on a multi-room
// empire that alone can exceed the per-tick CPU limit and drain the bucket to zero (the
// whole colony then appears to "freeze" until the bucket recovers). To bound the cost we
// fetch the full book at most once per ORDER_BOOK_CACHE_TTL ticks into a heap variable and
// filter it in JS — so the heavy call happens once, not dozens of times per tick. The mild
// staleness is harmless: stale order IDs/amounts just make the occasional deal() fail,
// which every caller already handles by checking the result.
let orderBookCache: Order[] | null = null;
let orderBookCacheTick = -Infinity;
const ORDER_BOOK_CACHE_TTL = 15;

function getMarketOrders(filter: (o: Order) => boolean): Order[] {
  if (!orderBookCache || Game.time - orderBookCacheTick >= ORDER_BOOK_CACHE_TTL) {
    orderBookCache = Game.market.getAllOrders();
    orderBookCacheTick = Game.time;
  }
  return orderBookCache.filter(filter);
}

// Game.market.getHistory() is also a heavy call (≈14 days of daily records). The sell paths
// query it per resource and per commodity, potentially every tick — the same CPU-drain class
// as getAllOrders. Daily history barely changes, so cache the most-recent average per resource
// in heap for a generous TTL.
const historyAvgCache: Record<string, number | undefined> = {};
let historyAvgCacheTick = -Infinity;
const HISTORY_CACHE_TTL = 100;

function getMarketHistoryAvg(resource: ResourceConstant): number | undefined {
  if (Game.time - historyAvgCacheTick >= HISTORY_CACHE_TTL) {
    for (const k in historyAvgCache) delete historyAvgCache[k];
    historyAvgCacheTick = Game.time;
  }
  if (resource in historyAvgCache) return historyAvgCache[resource];
  const history = Game.market.getHistory(resource);
  const avg = history.length > 0 ? history[history.length - 1].avgPrice : undefined;
  historyAvgCache[resource] = avg;
  return avg;
}

export function loop() {
  if (Game.time % NETWORK_CONFIG.PLAN_INTERVAL === 0) {
    planNetworkBalancing();
  }

  for (const roomName in Game.rooms) {
    const room = Game.rooms[roomName];
    if (!room.controller?.my) continue;
    try {
      processTerminal(room);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`[Terminal] Error in ${room.name}: ${msg}`);
    }
  }
}

// ── Per-room processing ───────────────────────────────────────────────────────

function processTerminal(room: Room): void {
  const terminalId = room.memory.terminalId;
  if (!terminalId) return;

  const terminal = Game.getObjectById(terminalId) as StructureTerminal | null;
  if (!terminal) {
    room.memory.terminalId = undefined;
    return;
  }

  // Execute any queued inter-room send first (highest priority use of the terminal)
  executePendingSend(room, terminal);

  if (terminal.store[RESOURCE_ENERGY] < TERMINAL_CONFIG.MIN_TERMINAL_ENERGY) return;

  // Sell the room's own mineral surplus from the terminal.
  const mineralId = room.memory.mineralId;
  const mineral = mineralId ? (Game.getObjectById(mineralId) as Mineral | null) : null;
  if (mineralId && !mineral) room.memory.mineralId = undefined;
  if (mineral) {
    const mineralType = mineral.mineralType;
    const mineralAmount = terminal.store.getUsedCapacity(mineralType) ?? 0;
    if (mineralAmount >= TERMINAL_CONFIG.MINERAL_SELL_THRESHOLD) {
      attemptMineralSale(room, terminal, mineralType, mineralAmount);
    }
  }

  // Buy base minerals for lab chains when stock runs low
  if (room.memory.labSystem?.inputLabIds?.length) {
    const lastBuy = room.memory.lastMarketBuyTick ?? 0;
    if (Game.time - lastBuy >= BUY_CONFIG.INTERVAL) {
      if (buyMissingMinerals(room, terminal)) {
        room.memory.lastMarketBuyTick = Game.time;
      }
    }
  }

  // Acquire ghodium to keep this room's nuker reserve stocked (RCL 8 rooms with a nuker).
  const lastGBuy = room.memory.lastGhodiumBuyTick ?? 0;
  if (Game.time - lastGBuy >= GHODIUM_CONFIG.INTERVAL) {
    if (buyMissingGhodium(room, terminal)) {
      room.memory.lastGhodiumBuyTick = Game.time;
    }
  }

  // Vend factory commodities last, so a steady stream of commodity deals can't keep the
  // terminal on cooldown and starve the lab/nuker buys above. Throttled: the vend loop scans
  // every managed commodity (filtering the order book per staged commodity), so running it
  // every tick across many rooms is needless CPU — a commodity sitting in the terminal can
  // wait a few ticks to be listed.
  const lastCommoditySale = room.memory.lastCommoditySaleTick ?? 0;
  if (Game.time - lastCommoditySale >= COMMODITY_SALE_INTERVAL) {
    attemptCommoditySale(room, terminal);
    room.memory.lastCommoditySaleTick = Game.time;
  }

  // Energy market trading: sell true empire-wide surplus / buy when unusually cheap.
  // Throttled and gated so it never fights the inter-room balancer. A market deal cools
  // the terminal, so this runs after the lab/nuker/commodity priorities above.
  const lastEnergyTrade = room.memory.lastEnergyTradeTick ?? 0;
  if (Game.time - lastEnergyTrade >= ENERGY_TRADE_CONFIG.INTERVAL) {
    if (tradeEnergy(room, terminal)) {
      room.memory.lastEnergyTradeTick = Game.time;
    }
  }

  // Market-maker: maintain our own sell orders so surplus minerals/commodities capture the
  // bid/ask spread instead of always paying the 5% taker premium. Order management costs no
  // terminal cooldown (createOrder is not a terminal action), so it's safe to run last.
  const lastOrderManage = room.memory.lastOrderManageTick ?? 0;
  if (Game.time - lastOrderManage >= MARKET_MAKER_CONFIG.MANAGE_INTERVAL) {
    manageSellOrders(room, terminal);
    room.memory.lastOrderManageTick = Game.time;
  }
}

// ── Ghodium (nuker reserve) ─────────────────────────────────────────────────────

// How much G this room should hold in total (storage + terminal): the lab target stock
// (so lab/boost ghodium isn't cannibalized) PLUS the nuker reserve when a nuker exists.
function ghodiumTarget(room: Room): number {
  let target = 0;
  // Lab rooms already keep TARGET_STOCK of every base mineral incl. G; mirror that so the
  // nuker reserve sits strictly on top and never eats into lab ghodium.
  if (room.memory.labSystem?.inputLabIds?.length) target += BUY_CONFIG.TARGET_STOCK;
  if (roomHasNuker(room)) target += NUKER_GHODIUM_RESERVE;
  return target;
}

function roomHasNuker(room: Room): boolean {
  const ns = room.memory.nukerSystem;
  if (ns?.nukerId && Game.getObjectById(ns.nukerId)) return true;
  return (
    room.find(FIND_MY_STRUCTURES, {
      filter: (s) => s.structureType === STRUCTURE_NUKER,
    }).length > 0
  );
}

function ghodiumStock(room: Room): number {
  return (
    (room.storage?.store.getUsedCapacity(RESOURCE_GHODIUM) ?? 0) +
    (room.terminal?.store.getUsedCapacity(RESOURCE_GHODIUM) ?? 0)
  );
}

// Buy ghodium from the market when this room is below its target. Returns true on a deal.
function buyMissingGhodium(room: Room, terminal: StructureTerminal): boolean {
  const target = ghodiumTarget(room);
  if (target <= 0) return false;

  const stock = ghodiumStock(room);
  if (stock >= target) return false;

  const needed = target - stock;
  const orders = getMarketOrders(
    (o) =>
      o.type === ORDER_SELL &&
      o.resourceType === RESOURCE_GHODIUM &&
      o.price <= GHODIUM_CONFIG.MAX_PRICE
  );
  if (orders.length === 0) return false;

  orders.sort((a, b) => a.price - b.price);
  const best = orders[0];
  const amount = affordableTradeAmount(
    terminal,
    room.name,
    best.roomName!,
    Math.min(needed, best.amount, GHODIUM_CONFIG.MAX_AMOUNT)
  );
  if (amount <= 0) return false;

  const result = Game.market.deal(best.id, amount, room.name);
  if (result === OK) {
    console.log(
      `[Terminal] ${room.name}: Bought ${amount} G @ ${best.price.toFixed(2)} for nuker reserve (stock was ${stock}/${target})`
    );
    return true;
  }
  return false;
}

// ── Inter-room send execution ─────────────────────────────────────────────────

function executePendingSend(room: Room, terminal: StructureTerminal): void {
  const pending = room.memory.pendingSend;
  if (!pending) return;

  // Abandon a send that can never complete (terminal can't be filled, or lacks the
  // energy to pay a non-energy transfer fee). Without this it would block forever and,
  // because every balancing pass skips rooms with a pendingSend, freeze this room out
  // of all energy/mineral/ghodium balancing indefinitely.
  if (pending.queuedAt === undefined) {
    pending.queuedAt = Game.time;
  } else if (Game.time - pending.queuedAt > SEND_STALL_TIMEOUT) {
    console.log(
      `[Network] Abandoning stuck send in ${room.name} (${pending.amount} ${pending.resource} → ${pending.to})`
    );
    delete room.memory.pendingSend;
    return;
  }

  if (terminal.cooldown > 0) return;

  const rc = pending.resource as ResourceConstant;
  const inTerminal = terminal.store.getUsedCapacity(rc) ?? 0;

  if (inTerminal < pending.loadTarget) return; // hauler/apothecary still filling

  // For non-energy resources also ensure terminal has enough energy to pay the fee
  if (rc !== RESOURCE_ENERGY) {
    const dist = Game.map.getRoomLinearDistance(room.name, pending.to);
    const fee = Math.ceil(pending.amount * (1 - Math.exp(-dist / 30)));
    if ((terminal.store[RESOURCE_ENERGY] ?? 0) < fee + 100) return;
  }

  const result = terminal.send(rc, pending.amount, pending.to);
  if (result === OK) {
    console.log(`[Network] ${room.name} → ${pending.to}: ${pending.amount} ${pending.resource}`);
    delete room.memory.pendingSend;
  } else if (result !== ERR_TIRED && result !== ERR_NOT_ENOUGH_RESOURCES) {
    // Unexpected error (full destination, invalid args, etc.) — clear to avoid getting stuck
    console.log(`[Network] Send failed (${result}), clearing pending send in ${room.name}`);
    delete room.memory.pendingSend;
  }
}

// ── Network planning ──────────────────────────────────────────────────────────

function planNetworkBalancing(): void {
  type RoomInfo = {
    room: Room;
    terminal: StructureTerminal;
    storageEnergy: number;
  };

  const infos: RoomInfo[] = [];
  for (const roomName in Game.rooms) {
    const room = Game.rooms[roomName];
    if (!room.controller?.my || !room.terminal) continue;
    infos.push({
      room,
      terminal: room.terminal,
      storageEnergy: room.storage?.store[RESOURCE_ENERGY] ?? 0,
    });
  }
  if (infos.length < 2) return;

  planEnergyTransfers(infos);
  planMineralTransfers(infos);
  planGhodiumTransfers(infos);
}

function planEnergyTransfers(infos: Array<{ room: Room; terminal: StructureTerminal; storageEnergy: number }>) {
  // Scale the donor/receiver lines modestly with empire size (GCL): bigger empires run
  // more rooms with deeper storage, so a slightly higher rich line / lower poor line keeps
  // us from churning small balancing sends. Bounded so a high GCL can't push them silly.
  const gclScale = Math.min(2, 1 + (Game.gcl.level - 1) * 0.1);
  const richThreshold = NETWORK_CONFIG.ENERGY_RICH_THRESHOLD * gclScale;
  const poorThreshold = NETWORK_CONFIG.ENERGY_POOR_THRESHOLD / gclScale;

  // Poorest rooms first; richest donors first
  const receivers = infos
    .filter((i) => !i.room.memory.pendingSend && i.storageEnergy < poorThreshold)
    .sort((a, b) => a.storageEnergy - b.storageEnergy);

  const donors = infos
    .filter((i) => !i.room.memory.pendingSend && i.storageEnergy > richThreshold)
    .sort((a, b) => b.storageEnergy - a.storageEnergy);

  // Service multiple donor→receiver pairs per pass so a multi-room empire converges faster.
  // Each donor is consumed once it's assigned (a terminal can only send once per tick), so
  // there are no double-sends; the cap bounds CPU/log spam per planning pass.
  let queued = 0;
  for (const receiver of receivers) {
    if (queued >= NETWORK_CONFIG.ENERGY_MAX_TRANSFERS_PER_PASS) break;
    if (donors.length === 0) break;

    const donor = donors.find((d) => {
      if (d.room.name === receiver.room.name) return false;
      return Game.map.getRoomLinearDistance(d.room.name, receiver.room.name) <= NETWORK_CONFIG.MAX_DISTANCE;
    });
    if (!donor) continue;

    const dist = Game.map.getRoomLinearDistance(donor.room.name, receiver.room.name);
    const amount = NETWORK_CONFIG.ENERGY_TRANSFER_AMOUNT;
    const fee = Math.ceil(amount * (1 - Math.exp(-dist / 30)));
    const loadTarget = amount + fee;

    donor.room.memory.pendingSend = { resource: RESOURCE_ENERGY, amount, loadTarget, to: receiver.room.name };
    console.log(
      `[Network] Planned: ${amount} energy ${donor.room.name}→${receiver.room.name} (fee ~${fee})`
    );

    // Remove donor so it's not assigned twice this cycle
    donors.splice(donors.indexOf(donor), 1);
    queued++;
  }
}

function planMineralTransfers(infos: Array<{ room: Room; terminal: StructureTerminal; storageEnergy: number }>) {
  for (const receiver of infos) {
    if (receiver.room.memory.pendingSend) continue;
    if (!receiver.room.memory.labSystem?.inputLabIds?.length) continue;

    for (const mineral of BASE_MINERALS) {
      const rc = mineral as ResourceConstant;
      const receiverStock =
        (receiver.room.storage?.store.getUsedCapacity(rc) ?? 0) +
        (receiver.terminal.store.getUsedCapacity(rc) ?? 0);

      if (receiverStock >= BUY_CONFIG.MIN_STOCK) continue;

      const amount = Math.min(
        BUY_CONFIG.TARGET_STOCK - receiverStock,
        NETWORK_CONFIG.MINERAL_TRANSFER_AMOUNT
      );

      // Find a donor with genuine surplus
      const donor = infos.find((d) => {
        if (d.room.name === receiver.room.name || d.room.memory.pendingSend) return false;
        const dist = Game.map.getRoomLinearDistance(d.room.name, receiver.room.name);
        if (dist > NETWORK_CONFIG.MAX_DISTANCE) return false;
        const donorStock =
          (d.room.storage?.store.getUsedCapacity(rc) ?? 0) +
          (d.terminal.store.getUsedCapacity(rc) ?? 0);
        return donorStock >= NETWORK_CONFIG.MINERAL_SURPLUS_THRESHOLD + amount;
      });

      if (!donor) continue;

      donor.room.memory.pendingSend = { resource: mineral, amount, loadTarget: amount, to: receiver.room.name };
      console.log(`[Network] Planned: ${amount} ${mineral} ${donor.room.name}→${receiver.room.name}`);
      break; // one mineral per receiver per plan cycle
    }
  }
}

// Balance ghodium toward rooms whose nuker reserve is short, pulling from rooms that hold
// G above their own target (surplus). Mirrors planMineralTransfers but keyed on the
// per-room ghodium target (lab target + nuker reserve) so we never strip a donor below
// what its own labs/nuker need.
function planGhodiumTransfers(
  infos: Array<{ room: Room; terminal: StructureTerminal; storageEnergy: number }>
) {
  for (const receiver of infos) {
    if (receiver.room.memory.pendingSend) continue;
    const target = ghodiumTarget(receiver.room);
    if (target <= 0) continue; // no nuker / no lab need here

    const receiverStock = ghodiumStock(receiver.room);
    if (receiverStock >= target) continue;

    const amount = Math.min(target - receiverStock, GHODIUM_CONFIG.TRANSFER_AMOUNT);
    if (amount <= 0) continue;

    const donor = infos.find((d) => {
      if (d.room.name === receiver.room.name || d.room.memory.pendingSend) return false;
      const dist = Game.map.getRoomLinearDistance(d.room.name, receiver.room.name);
      if (dist > NETWORK_CONFIG.MAX_DISTANCE) return false;
      // Donor must keep its own target intact and still have `amount` to spare.
      const surplus = ghodiumStock(d.room) - ghodiumTarget(d.room);
      return surplus >= amount;
    });
    if (!donor) continue;

    donor.room.memory.pendingSend = {
      resource: RESOURCE_GHODIUM,
      amount,
      loadTarget: amount,
      to: receiver.room.name,
    };
    console.log(`[Network] Planned: ${amount} G ${donor.room.name}→${receiver.room.name} (nuker reserve)`);
    break; // one ghodium transfer per planning pass
  }
}

// ── Market helpers ────────────────────────────────────────────────────────────

// Cap a trade so its energy transfer fee can't drain the terminal below its reserve.
// The fee is linear in amount, so when we can't afford the full quantity we scale it down
// proportionally rather than letting Game.market.deal fail with ERR_NOT_ENOUGH_RESOURCES.
function affordableTradeAmount(
  terminal: StructureTerminal,
  fromRoom: string,
  toRoom: string,
  want: number
): number {
  if (want <= 0) return 0;
  const spare = (terminal.store[RESOURCE_ENERGY] ?? 0) - TERMINAL_CONFIG.MIN_TERMINAL_ENERGY;
  if (spare <= 0) return 0;
  const cost = Game.market.calcTransactionCost(want, fromRoom, toRoom);
  if (cost <= spare) return want;
  return Math.floor((want * spare) / cost);
}

// ── Mineral selling ───────────────────────────────────────────────────────────

function attemptMineralSale(
  room: Room,
  terminal: StructureTerminal,
  mineralType: MineralConstant,
  availableAmount: number
): void {
  sellResourceToMarket(
    room,
    terminal,
    mineralType,
    availableAmount,
    TERMINAL_CONFIG.MINERAL_MAX_TRADE_AMOUNT
  );
}

// Sell up to `maxAmount` of `resource` from the terminal to the best nearby buy order,
// provided that order pays at least MIN_PRICE_RATIO of the recent market average. Returns
// true when a deal was placed (a deal puts the terminal on cooldown, so callers stop after
// one). Skips resources with no price history rather than dumping at a zero floor.
function sellResourceToMarket(
  room: Room,
  terminal: StructureTerminal,
  resource: ResourceConstant,
  availableAmount: number,
  maxTradeAmount: number
): boolean {
  const avgPrice = getMarketHistoryAvg(resource);
  if (avgPrice === undefined) return false;
  // Floor = the higher of (a) the market-history fraction we already used and (b) our own
  // recent rolling average — so a transient crash in the order book can't make us dump
  // below what we've actually been getting lately.
  const recentAvg = recentAvgPrice(resource);
  let bestPrice = avgPrice * TERMINAL_CONFIG.MIN_PRICE_RATIO;
  if (recentAvg !== undefined) {
    bestPrice = Math.max(bestPrice, recentAvg * TERMINAL_CONFIG.MIN_PRICE_RATIO);
  }
  let bestOrderId: string | null = null;
  let bestOrderRoom = "";
  let bestOrderAmount = 0;

  const orders = getMarketOrders((order) => {
    if (order.type !== ORDER_BUY || order.resourceType !== resource) return false;
    if (!order.roomName) return false;
    return (
      Game.map.getRoomLinearDistance(room.name, order.roomName) <
      TERMINAL_CONFIG.MAX_TRADE_DISTANCE
    );
  });

  for (const order of orders) {
    if (order.price > bestPrice) {
      bestPrice = order.price;
      bestOrderId = order.id;
      bestOrderRoom = order.roomName!;
      bestOrderAmount = order.amount;
    }
  }

  if (!bestOrderId) return false;

  const tradeAmount = affordableTradeAmount(
    terminal,
    room.name,
    bestOrderRoom,
    Math.min(availableAmount, bestOrderAmount, maxTradeAmount)
  );
  if (tradeAmount <= 0) return false;

  const result = Game.market.deal(bestOrderId, tradeAmount, room.name);
  if (result === OK) {
    recordPrice(resource, bestPrice); // feed the rolling sanity record
    console.log(
      `[Terminal] ${room.name}: Sold ${tradeAmount} ${resource} @ ${bestPrice.toFixed(2)}`
    );
    return true;
  }
  if (result !== ERR_NOT_ENOUGH_RESOURCES && result !== ERR_FULL) {
    console.log(`[Terminal] Market deal failed: ${result} for ${resource}`);
  }
  return false;
}

// ── Rolling price record ──────────────────────────────────────────────────────
//
// A tiny bounded history of prices we've actually transacted/seen per resource, used as a
// sanity floor (see sellResourceToMarket / market-maker pricing). Lightweight: at most
// PRICE_HISTORY_LEN numbers per resource live in Memory.

function recordPrice(resource: ResourceConstant, price: number): void {
  if (!(price > 0)) return;
  if (!Memory.marketPrices) Memory.marketPrices = {};
  const arr = (Memory.marketPrices[resource] ??= []);
  arr.push(Math.round(price * 1000) / 1000); // keep memory small (3 dp)
  while (arr.length > PRICE_HISTORY_LEN) arr.shift();
}

// Average of the recently-seen prices for a resource, or undefined if we have none yet.
function recentAvgPrice(resource: ResourceConstant): number | undefined {
  const arr = Memory.marketPrices?.[resource];
  if (!arr || arr.length === 0) return undefined;
  let sum = 0;
  for (const p of arr) sum += p;
  return sum / arr.length;
}

// ── Commodity selling ───────────────────────────────────────────────────────────

const COMMODITY_SELL_MIN_LOT = 100;   // don't bother dealing dust
const COMMODITY_MAX_TRADE = 5_000;    // cap per market deal
const COMMODITY_SALE_INTERVAL = 20;   // ticks between commodity-vend passes (CPU pacing)

// Vend factory commodities the factory has staged in the terminal (see orchestrator.factory
// routing evicted product here). One deal per tick — a deal cools the terminal down. Called
// at the lowest priority so lab/nuker buys keep the terminal first.
function attemptCommoditySale(room: Room, terminal: StructureTerminal): void {
  if (terminal.cooldown > 0) return;
  for (const c of MANAGED_COMMODITIES) {
    const rc = c as ResourceConstant;
    const amount = terminal.store.getUsedCapacity(rc) ?? 0;
    if (amount < COMMODITY_SELL_MIN_LOT) continue;
    if (sellResourceToMarket(room, terminal, rc, amount, COMMODITY_MAX_TRADE)) return;
  }
}

// ── Mineral buying ────────────────────────────────────────────────────────────

function buyMissingMinerals(room: Room, terminal: StructureTerminal): boolean {
  const storage = room.storage;
  for (const mineral of BASE_MINERALS) {
    const stock =
      (storage?.store.getUsedCapacity(mineral) ?? 0) +
      (terminal.store.getUsedCapacity(mineral) ?? 0);
    if (stock >= BUY_CONFIG.MIN_STOCK) continue;

    const needed = BUY_CONFIG.TARGET_STOCK - stock;
    const orders = getMarketOrders(
      (o) =>
        o.type === ORDER_SELL &&
        o.resourceType === mineral &&
        o.price <= BUY_CONFIG.MAX_PRICE
    );
    if (orders.length === 0) continue;

    orders.sort((a, b) => a.price - b.price);
    const best = orders[0];
    const amount = affordableTradeAmount(
      terminal,
      room.name,
      best.roomName!,
      Math.min(needed, best.amount, BUY_CONFIG.MAX_AMOUNT)
    );
    if (amount <= 0) continue;

    const result = Game.market.deal(best.id, amount, room.name);
    if (result === OK) {
      console.log(
        `[Terminal] ${room.name}: Bought ${amount} ${mineral} @ ${best.price.toFixed(2)} (stock was ${stock})`
      );
      return true;
    }
  }
  return false;
}

// ── Energy market trading ─────────────────────────────────────────────────────
//
// Sell TRUE empire-wide surplus energy for credits, or buy energy when it's unusually
// cheap and a room is genuinely low. Both paths are deliberately conservative so they
// never undermine the inter-room balancer: we only sell well ABOVE the donor threshold
// (NETWORK_CONFIG.ENERGY_RICH_THRESHOLD = 200k) — at 400k — and never draw storage below
// SELL_KEEP, and we only buy when a room is below BUY_STORAGE_THRESHOLD. Returns true when
// a deal was placed (a deal cools the terminal, so the caller stops for the tick).
function tradeEnergy(room: Room, terminal: StructureTerminal): boolean {
  if (terminal.cooldown > 0) return false;
  const storageEnergy = room.storage?.store[RESOURCE_ENERGY] ?? 0;

  // Don't sell while a queued send still wants this room's energy — let the balancer win.
  if (room.memory.pendingSend) return false;

  // SELL: storage persistently very high → unload the surplus above SELL_KEEP for credits.
  if (storageEnergy > ENERGY_TRADE_CONFIG.SELL_STORAGE_THRESHOLD) {
    const surplus = storageEnergy - ENERGY_TRADE_CONFIG.SELL_KEEP;
    // We can only sell what's staged in the terminal (haulers fill it from storage).
    const inTerminal = terminal.store.getUsedCapacity(RESOURCE_ENERGY) ?? 0;
    const sellable = Math.min(
      surplus,
      inTerminal - TERMINAL_CONFIG.MIN_TERMINAL_ENERGY,
      ENERGY_TRADE_CONFIG.SELL_MAX_AMOUNT
    );
    if (sellable >= 1000) {
      if (sellEnergyToMarket(room, terminal, sellable)) return true;
    }
  }

  // BUY: room genuinely low AND energy is unusually cheap AND we have a credit cushion.
  if (
    storageEnergy < ENERGY_TRADE_CONFIG.BUY_STORAGE_THRESHOLD &&
    Game.market.credits > ENERGY_TRADE_CONFIG.MIN_CREDITS_TO_BUY
  ) {
    if (buyCheapEnergy(room, terminal)) return true;
  }

  return false;
}

// Sell up to `amount` energy to the best nearby buy order paying at least SELL_MIN_PRICE.
function sellEnergyToMarket(room: Room, terminal: StructureTerminal, amount: number): boolean {
  let best: Order | null = null;
  const orders = getMarketOrders((o) => {
    if (o.type !== ORDER_BUY || o.resourceType !== RESOURCE_ENERGY) return false;
    if (!o.roomName || o.amount <= 0) return false;
    if (o.price < ENERGY_TRADE_CONFIG.SELL_MIN_PRICE) return false;
    return (
      Game.map.getRoomLinearDistance(room.name, o.roomName) < TERMINAL_CONFIG.MAX_TRADE_DISTANCE
    );
  });
  for (const o of orders) {
    if (!best || o.price > best.price) best = o;
  }
  if (!best || !best.roomName) return false;

  // Energy sales spend energy on the fee too; cap by what we can afford after the fee.
  const want = Math.min(amount, best.amount);
  const dealAmount = affordableTradeAmount(terminal, room.name, best.roomName, want);
  if (dealAmount < 1000) return false;

  const result = Game.market.deal(best.id, dealAmount, room.name);
  if (result === OK) {
    recordPrice(RESOURCE_ENERGY, best.price);
    console.log(
      `[Terminal] ${room.name}: Sold ${dealAmount} surplus energy @ ${best.price.toFixed(2)}`
    );
    return true;
  }
  return false;
}

// Buy energy from the cheapest nearby sell order under BUY_MAX_PRICE to refill a low room.
function buyCheapEnergy(room: Room, terminal: StructureTerminal): boolean {
  const orders = getMarketOrders((o) => {
    if (o.type !== ORDER_SELL || o.resourceType !== RESOURCE_ENERGY) return false;
    if (!o.roomName || o.amount <= 0) return false;
    if (o.price > ENERGY_TRADE_CONFIG.BUY_MAX_PRICE) return false;
    return (
      Game.map.getRoomLinearDistance(room.name, o.roomName) < TERMINAL_CONFIG.MAX_TRADE_DISTANCE
    );
  });
  if (orders.length === 0) return false;
  orders.sort((a, b) => a.price - b.price);
  const best = orders[0];

  const want = Math.min(best.amount, ENERGY_TRADE_CONFIG.BUY_MAX_AMOUNT);
  // Buying energy still costs energy for the fee; cap by what the terminal can spare.
  const amount = affordableTradeAmount(terminal, room.name, best.roomName!, want);
  if (amount < 1000) return false;

  const result = Game.market.deal(best.id, amount, room.name);
  if (result === OK) {
    console.log(
      `[Terminal] ${room.name}: Bought ${amount} energy @ ${best.price.toFixed(2)} (room low)`
    );
    return true;
  }
  return false;
}

// ── Market-maker (sell orders) ─────────────────────────────────────────────────
//
// Post and maintain our own ORDER_SELL listings for surplus minerals/commodities so buyers
// come to us at the ask price (we pocket the spread) instead of us always crossing to a bid
// and paying the 5% taker premium. We:
//   • cap total live orders empire-wide (each post costs credits = 0.05 × price × amount),
//   • never duplicate an order for the same resource+room,
//   • top up a thinning order's remaining amount from terminal stock,
//   • cancel+replace an order whose price has drifted from the current fair price,
//   • price just under the best competing ask, never below our recent rolling-average floor.
function manageSellOrders(room: Room, terminal: StructureTerminal): void {
  if (Game.market.credits < MARKET_MAKER_CONFIG.MIN_CREDITS_TO_POST) return;

  const myOrders = Object.values(Game.market.orders);
  const mySellCount = myOrders.filter((o) => o.type === ORDER_SELL).length;

  // Candidate resources to sell from THIS room's terminal: own mineral + managed commodities.
  const candidates = new Set<ResourceConstant>();
  const mineralId = room.memory.mineralId;
  const mineral = mineralId ? (Game.getObjectById(mineralId) as Mineral | null) : null;
  if (mineral && !NON_SELLABLE.has(mineral.mineralType)) candidates.add(mineral.mineralType);
  for (const c of MANAGED_COMMODITIES) {
    const rc = c as ResourceConstant;
    if (!NON_SELLABLE.has(rc)) candidates.add(rc);
  }

  for (const resource of candidates) {
    const surplus = terminal.store.getUsedCapacity(resource) ?? 0;
    if (surplus < MARKET_MAKER_CONFIG.MIN_SELL_SURPLUS) continue;

    const fair = fairSellPrice(resource);
    if (fair === undefined) continue; // no price signal — don't guess

    // Existing live sell order for this resource owned by this room (avoid duplicates).
    const existing = myOrders.find(
      (o) => o.type === ORDER_SELL && o.resourceType === resource && o.roomName === room.name
    );

    if (existing) {
      reconcileOrder(room, terminal, existing, resource, surplus, fair);
      continue;
    }

    // No order yet — post a new one if we're under the empire-wide cap.
    if (mySellCount >= MARKET_MAKER_CONFIG.MAX_ACTIVE_ORDERS) continue;
    const lot = Math.min(surplus, MARKET_MAKER_CONFIG.ORDER_LOT);
    // createOrder fee = 0.05 × price × amount; bail if we can't comfortably afford it.
    const fee = fair * lot * 0.05;
    if (Game.market.credits < MARKET_MAKER_CONFIG.MIN_CREDITS_TO_POST + fee) continue;

    const result = Game.market.createOrder({
      type: ORDER_SELL,
      resourceType: resource,
      price: fair,
      totalAmount: lot,
      roomName: room.name,
    });
    if (result === OK) {
      recordPrice(resource, fair);
      console.log(
        `[Terminal] ${room.name}: Posted sell order ${lot} ${resource} @ ${fair.toFixed(3)}`
      );
    }
    return; // one order action per management pass to spread credit cost over time
  }
}

// The price to list a sell order at: just under the best competing ask within trade range,
// but never below our recent rolling-average floor (PRICE_FLOOR_RATIO of it). Falls back to
// the market history average when no competing ask exists. undefined → no signal, skip.
function fairSellPrice(resource: ResourceConstant): number | undefined {
  const floorAvg = recentAvgPrice(resource);
  const histAvg = getMarketHistoryAvg(resource);

  // Best (lowest) competing sell order — we undercut it slightly to win the next sale.
  let bestAsk: number | undefined;
  const asks = getMarketOrders(
    (o) => o.type === ORDER_SELL && o.resourceType === resource && o.amount > 0
  );
  for (const o of asks) {
    if (bestAsk === undefined || o.price < bestAsk) bestAsk = o.price;
  }

  let price = bestAsk !== undefined ? bestAsk - MARKET_MAKER_CONFIG.UNDERCUT : histAvg;
  if (price === undefined || price <= 0) return undefined;

  // Enforce the rolling-average floor so a depressed order book can't make us list cheap.
  if (floorAvg !== undefined) {
    price = Math.max(price, floorAvg * MARKET_MAKER_CONFIG.PRICE_FLOOR_RATIO);
  }
  return Math.round(price * 1000) / 1000;
}

// Keep an existing sell order healthy: top up its remaining amount from terminal surplus,
// or cancel+replace it when its price has drifted too far from the current fair price.
function reconcileOrder(
  room: Room,
  terminal: StructureTerminal,
  order: Order,
  resource: ResourceConstant,
  surplus: number,
  fair: number
): void {
  // Reprice: if our listed price has drifted beyond tolerance, cancel so a fresh order at
  // the new fair price is posted next pass. (Cheaper than extendOrder's price-change cost
  // semantics and keeps the logic simple.)
  const drift = Math.abs(order.price - fair) / fair;
  if (drift > MARKET_MAKER_CONFIG.REPRICE_TOLERANCE) {
    Game.market.cancelOrder(order.id);
    console.log(
      `[Terminal] ${room.name}: Cancelled stale ${resource} order @ ${order.price.toFixed(3)} (fair ${fair.toFixed(3)})`
    );
    return;
  }

  // Top up a thinning order from terminal surplus so it stays attractive/visible.
  if (order.remainingAmount < MARKET_MAKER_CONFIG.TOPUP_THRESHOLD) {
    const addBy = Math.min(
      surplus,
      MARKET_MAKER_CONFIG.ORDER_LOT - order.remainingAmount
    );
    if (addBy > 0) {
      const fee = fair * addBy * 0.05;
      if (Game.market.credits >= MARKET_MAKER_CONFIG.MIN_CREDITS_TO_POST + fee) {
        const result = Game.market.extendOrder(order.id, addBy);
        if (result === OK) {
          console.log(`[Terminal] ${room.name}: Topped up ${resource} order by ${addBy}`);
        }
      }
    }
  }
}
