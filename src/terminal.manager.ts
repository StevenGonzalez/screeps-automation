declare const RESOURCE_OH: ResourceConstant;

/**
 * Terminal Manager: Handles resource sending, market trading, cooldown, transaction cost, and logging.
 */

export function runTerminalManager(room: Room) {
  const terminal = room.terminal;
  if (!terminal) return;
  // 1. Auto-send excess energy and minerals to hub room
  const HUB_ROOM = Memory.terminalHub || "W1N1";
  if (!terminal.cooldown) {
    if (terminal.store.energy > 20000) {
      const cost = Game.market.calcTransactionCost(5000, room.name, HUB_ROOM);
      if (terminal.store.energy > 20000 + cost) {
        terminal.send(RESOURCE_ENERGY, 5000, HUB_ROOM);
        console.log(
          `[Terminal] Sent 5000 energy from ${room.name} to ${HUB_ROOM}. Cost: ${cost}`
        );
        return;
      }
    }
    // Send surplus minerals to hub
    for (const mineral of Object.keys(terminal.store)) {
      if (mineral === RESOURCE_ENERGY) continue;
      if (!(mineral in terminal.store)) continue;
      const amount = terminal.store[mineral as ResourceConstant];
      if (amount > 1000) {
        const cost = Game.market.calcTransactionCost(500, room.name, HUB_ROOM);
        if (terminal.store.energy > cost) {
          terminal.send(mineral as ResourceConstant, 500, HUB_ROOM);
          console.log(
            `[Terminal] Sent 500 ${mineral} from ${room.name} to ${HUB_ROOM}. Cost: ${cost}`
          );
          return;
        }
      }
    }
  }
  // 2. Auto-sell surplus minerals if price is good, with dynamic pricing and cooldown check
  for (const mineral of Object.keys(terminal.store)) {
    if (mineral === RESOURCE_ENERGY) continue;
    if (!(mineral in terminal.store)) continue;
    const amount = terminal.store[mineral as ResourceConstant];
    if (amount > 500 && !terminal.cooldown) {
      const orders = Game.market.getAllOrders({
        type: ORDER_BUY,
        resourceType: mineral as MarketResourceConstant,
      });
      if (orders.length) {
        // Dynamic pricing: prefer highest price, but only sell if above 10% of average
        const best = orders.reduce((a, b) => (a.price > b.price ? a : b));
        const history = Game.market.getHistory(
          mineral as MarketResourceConstant
        )[0];
        const avg = history?.avgPrice || 0;
        if (best.price > avg * 1.1) {
          Game.market.deal(
            best.id,
            Math.min(amount, best.remainingAmount),
            room.name
          );
          console.log(
            `[Terminal] Sold ${Math.min(
              amount,
              best.remainingAmount
            )} ${mineral} at ${best.price} (avg: ${avg}) in ${room.name}`
          );
          return;
        }
      }
    }
  }
  // 3. Auto-buy reagents if needed for labs, with cooldown and transaction cost check
  if (
    !terminal.cooldown &&
    (terminal.store[RESOURCE_OH as ResourceConstant] || 0) < 1000
  ) {
    const orders = Game.market.getAllOrders({
      type: ORDER_SELL,
      resourceType: RESOURCE_OH as MarketResourceConstant,
    });
    if (orders.length) {
      const best = orders.reduce((a, b) => (a.price < b.price ? a : b));
      const cost = Game.market.calcTransactionCost(
        500,
        room.name,
        best.roomName || room.name
      );
      if (terminal.store.energy > cost) {
        Game.market.deal(best.id, 500, room.name);
        console.log(
          `[Terminal] Bought 500 ${RESOURCE_OH} at ${best.price} for ${room.name}. Cost: ${cost}`
        );
        return;
      }
    }
  }
}
