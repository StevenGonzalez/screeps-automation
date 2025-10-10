/**
 * MineralMiner: Best-practice mineral harvesting automation.
 * - Assigns mineral deposit and extractor.
 * - Moves adjacent to mineral, waits for cooldown, harvests efficiently.
 * - Transfers minerals to adjacent container or storage.
 * - Handles errors, logs actions, and supports future expansion.
 */
export function runMineralMiner(creep: Creep): void {
  // Find mineral deposit in the room
  const mineral = creep.room.find(FIND_MINERALS)[0];
  if (!mineral) return;

  // Find extractor structure
  const extractor = creep.room.find(FIND_STRUCTURES, {
    filter: (s) =>
      s.structureType === STRUCTURE_EXTRACTOR && s.pos.isEqualTo(mineral.pos),
  })[0] as StructureExtractor | undefined;
  if (!extractor) {
    if (Game.time % 100 === 0) {
      console.log(
        `[MineralMiner] No extractor for mineral in ${creep.room.name}`
      );
    }
    return;
  }

  // Check if creep is full
  const isFull = creep.store.getFreeCapacity() === 0;

  // If full, find container or storage to transfer to
  if (isFull) {
    const target = creep.pos.findClosestByRange(FIND_STRUCTURES, {
      filter: (s) =>
        (s.structureType === STRUCTURE_CONTAINER ||
          s.structureType === STRUCTURE_STORAGE) &&
        s.store.getFreeCapacity(mineral.mineralType) > 0,
    }) as StructureContainer | StructureStorage | undefined;

    if (target) {
      if (creep.pos.isNearTo(target)) {
        creep.transfer(target, mineral.mineralType);
      } else {
        creep.moveTo(target);
      }
      return;
    }
  }

  // Move adjacent to mineral deposit (not on top, since extractor is there)
  if (!creep.pos.isNearTo(mineral.pos)) {
    creep.moveTo(mineral.pos);
    return;
  }

  // Harvest mineral if not at cooldown and mineral is available
  if (mineral.mineralAmount > 0) {
    const res = creep.harvest(mineral);
    if (res === ERR_TIRED) {
      // Extractor on cooldown, this is normal - wait
      return;
    }
    if (
      res !== OK &&
      res !== ERR_NOT_ENOUGH_RESOURCES &&
      Game.time % 100 === 0
    ) {
      console.log(`[MineralMiner] Harvest error ${res} in ${creep.room.name}`);
    }
  }
}
