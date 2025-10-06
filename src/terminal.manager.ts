declare const RESOURCE_OH: ResourceConstant;

/**
 * Terminal Manager: Handles resource sending, market trading, cooldown, transaction cost, and logging.
 */

export function runTerminalManager(room: Room) {
  const terminal = room.terminal;
  if (!terminal) return;

  // Economy check: Don't use terminal if room economy is struggling
  const storage = room.storage;
  const storageEnergy = storage?.store.getUsedCapacity(RESOURCE_ENERGY) || 0;
  const MIN_STORAGE_FOR_TERMINAL = 20000; // Need at least 20k in storage
  const MIN_STORAGE_FOR_BUYING = 50000; // Need at least 50k to buy resources

  const economyHealthy = storageEnergy >= MIN_STORAGE_FOR_TERMINAL;
  const economyStrong = storageEnergy >= MIN_STORAGE_FOR_BUYING;

  if (!economyHealthy && Game.time % 500 === 0) {
    console.log(
      `[Terminal] ⚠️ Pausing terminal operations - storage at ${storageEnergy}/${MIN_STORAGE_FOR_TERMINAL}`
    );
  }

  // 1. Auto-send excess energy and minerals to hub room
  const HUB_ROOM = Memory.terminalHub || "W1N1";

  // Check if hub room exists and has a terminal
  const hubRoom = Game.rooms[HUB_ROOM];
  const hubHasTerminal = hubRoom?.terminal;

  if (!terminal.cooldown && hubHasTerminal && economyHealthy) {
    if (terminal.store.energy > 20000) {
      const cost = Game.market.calcTransactionCost(5000, room.name, HUB_ROOM);
      if (terminal.store.energy > 20000 + cost) {
        const result = terminal.send(RESOURCE_ENERGY, 5000, HUB_ROOM);
        if (result === OK) {
          console.log(
            `[Terminal] ✅ Sent 5000 energy from ${room.name} to ${HUB_ROOM}. Cost: ${cost}`
          );
        } else {
          console.log(
            `[Terminal] ❌ Failed to send energy to ${HUB_ROOM}: ${result}`
          );
        }
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
          const result = terminal.send(
            mineral as ResourceConstant,
            500,
            HUB_ROOM
          );
          if (result === OK) {
            console.log(
              `[Terminal] ✅ Sent 500 ${mineral} from ${room.name} to ${HUB_ROOM}. Cost: ${cost}`
            );
          } else {
            console.log(
              `[Terminal] ❌ Failed to send ${mineral} to ${HUB_ROOM}: ${result}`
            );
          }
          return;
        }
      }
    }
  } else if (!terminal.cooldown && !hubHasTerminal) {
    // Log this occasionally so user knows why sending isn't working
    if (Game.time % 500 === 0) {
      console.log(
        `[Terminal] ⚠️ Hub room ${HUB_ROOM} doesn't exist or has no terminal - skipping auto-send`
      );
    }
  }
  // 2. Auto-sell surplus minerals if price is good, with dynamic pricing and cooldown check
  if (!terminal.cooldown && economyHealthy) {
    for (const mineral of Object.keys(terminal.store)) {
      if (mineral === RESOURCE_ENERGY) continue;

      const amount = terminal.store[mineral as ResourceConstant] || 0;
      if (amount <= 500) continue; // Need more than 500 to sell

      const orders = Game.market.getAllOrders({
        type: ORDER_BUY,
        resourceType: mineral as MarketResourceConstant,
      });

      if (orders.length === 0) continue;

      // Dynamic pricing: prefer highest price, but only sell if above 10% of average
      const best = orders.reduce((a, b) => (a.price > b.price ? a : b));
      const history = Game.market.getHistory(
        mineral as MarketResourceConstant
      )[0];
      const avg = history?.avgPrice || 0;

      if (best.price > avg * 1.1) {
        // Calculate safe deal amount - can't sell more than we have
        const dealAmount = Math.min(
          amount,
          best.remainingAmount,
          1000 // Max 1000 per deal to avoid depleting instantly
        );

        // Verify we actually have this much
        const actualAmount =
          terminal.store.getUsedCapacity(mineral as ResourceConstant) || 0;
        if (actualAmount < dealAmount) {
          if (Game.time % 100 === 0) {
            console.log(
              `[Terminal] ⚠️ Skipping ${mineral} sale - insufficient stock (have ${actualAmount}, need ${dealAmount})`
            );
          }
          continue;
        }

        // Check if we have enough credits for the transaction
        const transactionCost = Game.market.calcTransactionCost(
          dealAmount,
          room.name,
          best.roomName || ""
        );

        if (terminal.store.energy < transactionCost) {
          if (Game.time % 100 === 0) {
            console.log(
              `[Terminal] ⚠️ Not enough energy for ${mineral} sale - need ${transactionCost}, have ${terminal.store.energy}`
            );
          }
          continue;
        }

        const result = Game.market.deal(best.id, dealAmount, room.name);

        if (result === OK) {
          console.log(
            `[Terminal] ✅ Sold ${dealAmount} ${mineral} at ${best.price.toFixed(
              3
            )} (avg: ${avg.toFixed(3)}) in ${
              room.name
            } [Cost: ${transactionCost} energy]`
          );
        } else if (result === ERR_NOT_ENOUGH_RESOURCES) {
          console.log(
            `[Terminal] ⚠️ Failed to sell ${mineral}: Not enough resources (Credits: ${Game.market.credits}, Energy: ${terminal.store.energy}, Need: ${transactionCost})`
          );
        } else if (result === ERR_INVALID_ARGS) {
          if (Game.time % 100 === 0) {
            console.log(
              `[Terminal] ⚠️ Order ${best.id} for ${mineral} is no longer valid`
            );
          }
        } else {
          console.log(
            `[Terminal] ❌ Failed to sell ${mineral}: ${result} (Error code)`
          );
        }
        return; // Only one deal per tick
      }
    }
  }
  // 3. Auto-buy reagents if needed for labs, with cooldown and transaction cost check
  // Only buy if economy is strong (50k+ in storage)
  if (!terminal.cooldown && economyStrong) {
    // Auto-buy strategy: maintain minimum amounts of lab compounds and base minerals
    const MIN_LAB_COMPOUND = 1000; // Keep 1k of each lab compound
    const MIN_BASE_MINERAL = 3000; // Keep 3k of base minerals (H, O, U, L, K, Z, X)

    const baseMinerals: ResourceConstant[] = [
      RESOURCE_HYDROGEN,
      RESOURCE_OXYGEN,
      RESOURCE_UTRIUM,
      RESOURCE_LEMERGIUM,
      RESOURCE_KEANIUM,
      RESOURCE_ZYNTHIUM,
      RESOURCE_CATALYST,
    ];

    // Check active labs to see what compounds they're using
    const labs = room.find(FIND_MY_STRUCTURES, {
      filter: (s) => s.structureType === STRUCTURE_LAB,
    }) as StructureLab[];

    const neededResources: { [key: string]: number } = {};

    // Always maintain base minerals
    for (const mineral of baseMinerals) {
      const current = terminal.store[mineral] || 0;
      if (current < MIN_BASE_MINERAL) {
        neededResources[mineral] = MIN_BASE_MINERAL;
      }
    }

    // Check what labs are actively using
    for (const lab of labs) {
      const mineralType = lab.mineralType;
      if (mineralType) {
        const current = terminal.store[mineralType] || 0;
        // Determine target based on whether it's a base mineral or compound
        const isBaseMiner = baseMinerals.includes(
          mineralType as ResourceConstant
        );
        const target = isBaseMiner ? MIN_BASE_MINERAL : MIN_LAB_COMPOUND;
        if (current < target && !neededResources[mineralType]) {
          neededResources[mineralType] = target;
        }
      }
    }

    // Try to buy needed resources
    for (const [resourceType, targetAmount] of Object.entries(
      neededResources
    )) {
      const currentAmount =
        terminal.store[resourceType as ResourceConstant] || 0;

      if (currentAmount < targetAmount) {
        const orders = Game.market.getAllOrders({
          type: ORDER_SELL,
          resourceType: resourceType as MarketResourceConstant,
        });

        if (orders.length === 0) continue;

        const best = orders.reduce((a, b) => (a.price < b.price ? a : b));
        const buyAmount = Math.min(
          500, // Max 500 per purchase
          targetAmount - currentAmount, // Only buy what we need
          best.remainingAmount // Can't buy more than seller has
        );

        const totalCost = best.price * buyAmount;
        const energyCost = Game.market.calcTransactionCost(
          buyAmount,
          room.name,
          best.roomName || room.name
        );

        // Check if we have enough credits
        if (Game.market.credits < totalCost) {
          if (Game.time % 500 === 0) {
            console.log(
              `[Terminal] ⚠️ Not enough credits to buy ${resourceType} - need ${Math.ceil(
                totalCost
              )}, have ${Math.floor(Game.market.credits)}`
            );
          }
          continue; // Try next resource
        }

        // Check if we have enough energy for transfer
        if (terminal.store.energy < energyCost) {
          if (Game.time % 100 === 0) {
            console.log(
              `[Terminal] ⚠️ Not enough energy to buy ${resourceType} - need ${energyCost}, have ${terminal.store.energy}`
            );
          }
          continue; // Try next resource
        }

        const result = Game.market.deal(best.id, buyAmount, room.name);

        if (result === OK) {
          console.log(
            `[Terminal] ✅ Bought ${buyAmount} ${resourceType} at ${best.price.toFixed(
              3
            )} for ${room.name}. Energy: ${energyCost}, Credits: ${Math.ceil(
              totalCost
            )}`
          );
        } else if (result === ERR_NOT_ENOUGH_RESOURCES) {
          console.log(
            `[Terminal] ❌ Not enough resources to buy ${resourceType} - Credits: ${Math.floor(
              Game.market.credits
            )}/${Math.ceil(totalCost)}, Energy: ${
              terminal.store.energy
            }/${energyCost}`
          );
        } else if (result === ERR_INVALID_ARGS) {
          if (Game.time % 100 === 0) {
            console.log(
              `[Terminal] ⚠️ ${resourceType} order is no longer valid`
            );
          }
        } else {
          console.log(
            `[Terminal] ❌ Failed to buy ${resourceType}: ${result} (Error code)`
          );
        }
        return; // Only one purchase per tick
      }
    }
  }
}
