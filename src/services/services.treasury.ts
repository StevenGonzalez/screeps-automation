// How much gold each castle's treasury keeps back from the enchanters. They
// upgrade the controller only with what sits above the floor, and the floor
// rises while the castle saves for a new keep or funds one.

export const UPGRADER_STORAGE_FLOOR = 10_000;

// Held while saving for, or funding, a new keep. It clears the expansion gate
// (MIN_HOME_STORAGE_ENERGY) with room to spare, and keeps the conqueror and the
// settlers clear of the economy-critical stop on spawning them.
export const KEEP_FUND_FLOOR = 45_000;

const UPGRADER_DOWNGRADE_GUARD = 5000;

export function nearDowngrade(room: Room): boolean {
  const ctrl = room.controller;
  return !!ctrl && ctrl.my && ctrl.ticksToDowngrade < UPGRADER_DOWNGRADE_GUARD;
}

/** Whether the castle is saving for the next keep in the queue, or funding one. */
export function savingForKeep(room: Room): boolean {
  const exp = Memory.expansion;
  if (exp && exp.homeRoom === room.name && exp.phase !== "established") return true;
  return Memory.expansionSavings?.room === room.name;
}

export function upgraderStorageFloor(room: Room): number {
  return savingForKeep(room) ? KEEP_FUND_FLOOR : UPGRADER_STORAGE_FLOOR;
}

/**
 * Whether the room can afford to spend energy on upgrading: it has no storage
 * yet, storage is above the floor, or the controller is close to downgrading.
 * Every route energy takes to the controller checks this - the controller link
 * and the upgrade container included - so no route slips past the floor.
 */
export function upgradingFunded(room: Room): boolean {
  const storage = room.storage;
  if (!storage) return true;
  return storage.store[RESOURCE_ENERGY] > upgraderStorageFloor(room) || nearDowngrade(room);
}
