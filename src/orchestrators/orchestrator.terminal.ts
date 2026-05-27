/**
 * Terminal Orchestrator
 * Manages inter-room resource trading, mineral sales, and lab supply buying.
 */

const TERMINAL_CONFIG = {
  MINERAL_SELL_THRESHOLD: 1000,
  MINERAL_MAX_TRADE_AMOUNT: 1000,
  MIN_PRICE_RATIO: 0.5,
  MAX_TRADE_DISTANCE: 10,
  MIN_TERMINAL_ENERGY: 1000,
};

const BUY_CONFIG = {
  INTERVAL: 500,       // ticks between buy attempts per room
  MIN_STOCK: 500,      // buy when base mineral stock drops below this
  TARGET_STOCK: 3000,  // buy up to this amount per mineral
  MAX_PRICE: 50,       // credits per unit ceiling
  MAX_AMOUNT: 1000,    // max units per single deal
};

// Base minerals consumed as inputs to the reaction tree
const BASE_MINERALS: MineralConstant[] = ['H', 'O', 'Z', 'K', 'U', 'L', 'X'];

export function loop() {
  for (const roomName in Game.rooms) {
    const room = Game.rooms[roomName];
    if (!room.controller || !room.controller.my) continue;

    try {
      processTerminal(room);
    } catch (e) {
      console.error(`[Terminal] Error in room ${room.name}:`, e);
    }
  }
}

function processTerminal(room: Room): void {
  const terminalId = room.memory.terminalId;
  if (!terminalId) return;

  const terminal = Game.getObjectById(terminalId) as StructureTerminal | null;
  if (!terminal) {
    room.memory.terminalId = undefined;
    return;
  }

  // Exit early if terminal lacks energy for trading
  if (terminal.store[RESOURCE_ENERGY] < TERMINAL_CONFIG.MIN_TERMINAL_ENERGY) {
    return;
  }

  const mineralId = room.memory.mineralId;
  if (!mineralId) return;

  const mineral = Game.getObjectById(mineralId) as Mineral | null;
  if (!mineral) {
    room.memory.mineralId = undefined;
    return;
  }

  const mineralType = mineral.mineralType;
  const mineralAmount = terminal.store.getUsedCapacity(mineralType);

  // Only attempt sales when threshold is met
  if (mineralAmount < TERMINAL_CONFIG.MINERAL_SELL_THRESHOLD) {
    return;
  }

  attemptMineralSale(room, terminal, mineralType, mineralAmount);

  // Buy base minerals for lab chains when stock runs low
  if (room.memory.labSystem?.inputLabIds?.length) {
    const lastBuy = room.memory.lastMarketBuyTick ?? 0;
    if (Game.time - lastBuy >= BUY_CONFIG.INTERVAL) {
      if (buyMissingMinerals(room, terminal)) {
        room.memory.lastMarketBuyTick = Game.time;
      }
    }
  }
}

function attemptMineralSale(
  room: Room,
  terminal: StructureTerminal,
  mineralType: MineralConstant,
  availableAmount: number
): void {
  // Find best buy orders within range and price threshold
  let bestPrice = TERMINAL_CONFIG.MIN_PRICE_RATIO;
  let bestOrderId: string | null = null;
  let bestOrderAmount = 0;

  const orders = Game.market.getAllOrders((order) => {
    if (order.type !== ORDER_BUY || order.resourceType !== mineralType) {
      return false;
    }
    if (!order.roomName) {
      return false;
    }
    const distance = Game.map.getRoomLinearDistance(
      room.name,
      order.roomName
    );
    return distance < TERMINAL_CONFIG.MAX_TRADE_DISTANCE;
  });

  // Linear scan to find best order (avoid sort overhead)
  for (const order of orders) {
    if (order.price > bestPrice) {
      bestPrice = order.price;
      bestOrderId = order.id;
      bestOrderAmount = order.amount;
    }
  }

  if (!bestOrderId) {
    return; // No profitable orders found
  }

  const tradeAmount = Math.min(
    availableAmount,
    bestOrderAmount,
    TERMINAL_CONFIG.MINERAL_MAX_TRADE_AMOUNT
  );

  if (tradeAmount <= 0) {
    return;
  }

  const result = Game.market.deal(bestOrderId, tradeAmount, room.name);

  if (result === OK) {
    console.log(
      `[${room.name}] Sold ${tradeAmount} ${mineralType} @ ${bestPrice.toFixed(
        2
      )} = ${(tradeAmount * bestPrice).toFixed(0)} credits`
    );
  } else if (result === ERR_NOT_ENOUGH_RESOURCES) {
    // Terminal is full or lacks energy; let container drain naturally next tick
  } else if (result !== ERR_FULL) {
    // Log unexpected errors only
    console.warn(
      `[${room.name}] Market deal failed: ${result} for ${mineralType}`
    );
  }
}

function buyMissingMinerals(room: Room, terminal: StructureTerminal): boolean {
  const storage = room.storage;
  for (const mineral of BASE_MINERALS) {
    const stock =
      (storage?.store.getUsedCapacity(mineral) ?? 0) +
      (terminal.store.getUsedCapacity(mineral) ?? 0);
    if (stock >= BUY_CONFIG.MIN_STOCK) continue;

    const needed = BUY_CONFIG.TARGET_STOCK - stock;
    const orders = Game.market.getAllOrders(
      (o) => o.type === ORDER_SELL && o.resourceType === mineral && o.price <= BUY_CONFIG.MAX_PRICE
    );
    if (orders.length === 0) continue;

    // Cheapest first
    orders.sort((a, b) => a.price - b.price);
    const best = orders[0];
    const amount = Math.min(needed, best.amount, BUY_CONFIG.MAX_AMOUNT);
    if (amount <= 0) continue;

    const result = Game.market.deal(best.id, amount, room.name);
    if (result === OK) {
      console.log(
        `[Terminal] ${room.name}: Bought ${amount} ${mineral} @ ${best.price.toFixed(2)} (stock was ${stock})`
      );
      return true; // one buy per interval to avoid burning credits in one tick
    }
  }
  return false;
}
