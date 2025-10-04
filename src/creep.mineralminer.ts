/**
 * MineralMiner: Best-practice mineral harvesting automation.
 * - Assigns mineral deposit and extractor.
 * - Moves to mineral, waits for cooldown, harvests efficiently.
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
      s.structureType === STRUCTURE_EXTRACTOR && s.pos.isNearTo(mineral.pos),
  })[0] as StructureExtractor | undefined;
  if (!extractor) {
    if (Game.time % 100 === 0) {
      console.log(
        `[MineralMiner] No extractor for mineral in ${creep.room.name}`
      );
    }
    return;
  }

  // Find adjacent container or storage
  const container = creep.pos.findInRange(FIND_STRUCTURES, 1, {
    filter: (s) =>
      s.structureType === STRUCTURE_CONTAINER ||
      s.structureType === STRUCTURE_STORAGE,
  })[0] as StructureContainer | StructureStorage | undefined;

  // Move to mineral deposit
  if (!creep.pos.isEqualTo(mineral.pos)) {
    creep.moveTo(mineral.pos, { visualizePathStyle: { stroke: "#ffaa00" } });
    return;
  }

  // Harvest mineral if extractor is ready and mineral is available
  if (extractor.cooldown === 0 && mineral.mineralAmount > 0) {
    const res = creep.harvest(mineral);
    switch (res) {
      case OK:
        if (Game.time % 50 === 0) {
          console.log(
            `[MineralMiner] Harvested ${mineral.mineralType} in ${creep.room.name}`
          );
        }
        break;
      case ERR_NOT_ENOUGH_RESOURCES:
        if (Game.time % 200 === 0) {
          console.log(`[MineralMiner] Mineral depleted in ${creep.room.name}`);
        }
        break;
      case ERR_NOT_OWNER:
      case ERR_BUSY:
      case ERR_NOT_FOUND:
      case ERR_NOT_ENOUGH_RESOURCES:
      case ERR_INVALID_TARGET:
      case ERR_NOT_IN_RANGE:
      case ERR_TIRED:
      case ERR_NO_BODYPART:
        if (Game.time % 100 === 0) {
          console.log(
            `[MineralMiner] Harvest error ${res} in ${creep.room.name}`
          );
        }
        break;
    }
  } else if (extractor.cooldown > 0 && Game.time % 50 === 0) {
    console.log(
      `[MineralMiner] Waiting for extractor cooldown (${extractor.cooldown}) in ${creep.room.name}`
    );
  }

  // Transfer minerals to container/storage if carrying any
  if (container && creep.store.getUsedCapacity(mineral.mineralType) > 0) {
    const res = creep.transfer(container, mineral.mineralType);
    if (res === OK && Game.time % 50 === 0) {
      console.log(
        `[MineralMiner] Transferred ${mineral.mineralType} to container/storage in ${creep.room.name}`
      );
    }
  }
}
