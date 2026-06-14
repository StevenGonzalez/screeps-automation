/**
 * Terminal Orchestrator
 * Handles mineral sales, base-mineral buying, and inter-room resource balancing.
 */

import { NUKER_GHODIUM_RESERVE } from "./orchestrator.nuker";
import { MANAGED_COMMODITIES } from "../config/config.factory";

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
  MINERAL_SURPLUS_THRESHOLD: 2_000,  // only donate mineral if stock above this + needed
  MINERAL_TRANSFER_AMOUNT: 1_000,    // minerals per transfer
  MAX_DISTANCE: 10,                  // skip cross-room transfers beyond this
};

const BASE_MINERALS: MineralConstant[] = ['H', 'O', 'Z', 'K', 'U', 'L', 'X'];

// Drop a queued inter-room send that hasn't gone through after this many ticks so a
// send that can't be filled or paid for never permanently freezes the room's balancing.
const SEND_STALL_TIMEOUT = 1500;

// ── Main loop ─────────────────────────────────────────────────────────────────

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
  // terminal on cooldown and starve the lab/nuker buys above.
  attemptCommoditySale(room, terminal);
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
  const orders = Game.market.getAllOrders(
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
  // Poorest rooms first; richest donors first
  const receivers = infos
    .filter((i) => !i.room.memory.pendingSend && i.storageEnergy < NETWORK_CONFIG.ENERGY_POOR_THRESHOLD)
    .sort((a, b) => a.storageEnergy - b.storageEnergy);

  const donors = infos
    .filter((i) => !i.room.memory.pendingSend && i.storageEnergy > NETWORK_CONFIG.ENERGY_RICH_THRESHOLD)
    .sort((a, b) => b.storageEnergy - a.storageEnergy);

  for (const receiver of receivers) {
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
    break; // one energy transfer queued per planning pass
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
  const history = Game.market.getHistory(resource);
  const avgPrice = history.length > 0 ? history[history.length - 1].avgPrice : undefined;
  if (avgPrice === undefined) return false;
  let bestPrice = avgPrice * TERMINAL_CONFIG.MIN_PRICE_RATIO;
  let bestOrderId: string | null = null;
  let bestOrderRoom = "";
  let bestOrderAmount = 0;

  const orders = Game.market.getAllOrders((order) => {
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

// ── Commodity selling ───────────────────────────────────────────────────────────

const COMMODITY_SELL_MIN_LOT = 100;   // don't bother dealing dust
const COMMODITY_MAX_TRADE = 5_000;    // cap per market deal

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
    const orders = Game.market.getAllOrders(
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
