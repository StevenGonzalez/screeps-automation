export function runMineralMiner(creep: Creep): void {
  const mineralId = creep.room.memory.mineralId;
  if (!mineralId) return;

  const mineral = Game.getObjectById(mineralId) as Mineral | null;
  if (!mineral) return;

  const containerId = creep.room.memory.mineralContainerId;
  if (!containerId) return;

  const container = Game.getObjectById(containerId) as StructureContainer | null;
  if (!container) return;

  const depleted = mineral.mineralAmount === 0;
  const carrying = creep.store.getUsedCapacity() > 0;

  if (creep.store.getFreeCapacity() === 0 || (depleted && carrying)) {
    const terminalId = creep.room.memory.terminalId;
    const terminal = terminalId
      ? (Game.getObjectById(terminalId) as StructureTerminal | null)
      : null;
    const storage = creep.room.storage;
    const target =
      storage && storage.store.getFreeCapacity() > 0
        ? storage
        : terminal && terminal.store.getFreeCapacity() > 0
        ? terminal
        : storage ?? terminal;
    if (!target) return;
    for (const resourceType in creep.store) {
      const amount = creep.store[resourceType as ResourceConstant];
      if (amount > 0) {
        const res = creep.transfer(target, resourceType as ResourceConstant);
        if (res === ERR_NOT_IN_RANGE) creep.moveTo(target, { reusePath: 20 });
        break;
      }
    }
    return;
  }

  if (depleted) {
    creep.suicide();
    return;
  }

  if (!creep.pos.isEqualTo(container.pos)) {
    creep.moveTo(container.pos, { reusePath: 50 });
    return;
  }

  const result = creep.harvest(mineral);
  if (result === ERR_NOT_IN_RANGE) {
    creep.moveTo(mineral, { reusePath: 50 });
  }
}
