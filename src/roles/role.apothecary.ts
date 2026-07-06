const MIN_REFILL_AMOUNT = 200;

export function runApothecary(creep: Creep) {
  const room = creep.room;
  const ls = room.memory.labSystem;
  const storage = room.storage;

  if (!ls || !ls.inputLabIds || !ls.outputLabIds || !storage) {
    if (storage && !creep.pos.isNearTo(storage)) creep.moveTo(storage, { reusePath: 20 });
    return;
  }

  const inputLabs = ls.inputLabIds
    .map((id) => Game.getObjectById(id) as StructureLab | null)
    .filter((l): l is StructureLab => l !== null);
  const outputLabs = ls.outputLabIds
    .map((id) => Game.getObjectById(id) as StructureLab | null)
    .filter((l): l is StructureLab => l !== null);

  if (inputLabs.length < 2) return;

  const carrying = (Object.keys(creep.store) as ResourceConstant[]).filter(
    (r) => creep.store.getUsedCapacity(r) > 0
  );

  if (carrying.length > 0) {
    const resource = carrying[0];

    const pendingSend = room.memory.pendingSend;
    if (pendingSend && pendingSend.resource === resource && pendingSend.resource !== RESOURCE_ENERGY) {
      const termId = room.memory.terminalId;
      const terminal = termId ? (Game.getObjectById(termId) as StructureTerminal | null) : null;
      if (terminal && (terminal.store.getUsedCapacity(resource) ?? 0) < pendingSend.loadTarget) {
        if (creep.transfer(terminal, resource) === ERR_NOT_IN_RANGE) {
          creep.moveTo(terminal, { reusePath: 5 });
        }
        return;
      }
    }

    if (ls.inputCompounds) {
      for (let i = 0; i < 2; i++) {
        if (ls.inputCompounds[i] === resource) {
          const lab = inputLabs[i];
          if (creep.transfer(lab, resource) === ERR_NOT_IN_RANGE) {
            creep.moveTo(lab, { reusePath: 5 });
          }
          return;
        }
      }
    }

    if (creep.transfer(storage, resource) === ERR_NOT_IN_RANGE) {
      creep.moveTo(storage, { reusePath: 5 });
    }
    return;
  }

  const pendingBoostCompounds = new Set<string>();
  for (const c of creep.room.find(FIND_MY_CREEPS, { filter: (c) => !c.memory.boosted })) {
    if (c.memory.boostCompound) pendingBoostCompounds.add(c.memory.boostCompound);
    if (c.memory.boostQueue) for (const q of c.memory.boostQueue) pendingBoostCompounds.add(q);
  }

  const pendingSend = room.memory.pendingSend;
  if (pendingSend && pendingSend.resource !== RESOURCE_ENERGY) {
    const termId = room.memory.terminalId;
    const terminal = termId ? (Game.getObjectById(termId) as StructureTerminal | null) : null;
    if (terminal) {
      const rc = pendingSend.resource as ResourceConstant;
      const inTerminal = terminal.store.getUsedCapacity(rc) ?? 0;
      if (inTerminal < pendingSend.loadTarget) {
        const inStorage = storage.store.getUsedCapacity(rc) ?? 0;
        if (inStorage > 0) {
          const amount = Math.min(
            creep.store.getFreeCapacity() ?? 0,
            pendingSend.loadTarget - inTerminal,
            inStorage
          );
          if (amount > 0) {
            if (creep.withdraw(storage, rc, amount) === ERR_NOT_IN_RANGE) {
              creep.moveTo(storage, { reusePath: 5 });
            }
            return;
          }
        }
      }
    }
  }

  for (const outputLab of outputLabs) {
    const used = outputLab.store.getUsedCapacity() ?? 0;
    const cap = outputLab.store.getCapacity() ?? 0;
    if (used >= cap * 0.75) {
      const resource = (Object.keys(outputLab.store) as ResourceConstant[]).find(
        (r) =>
          r !== RESOURCE_ENERGY &&
          (outputLab.store.getUsedCapacity(r) ?? 0) > 0 &&
          !pendingBoostCompounds.has(r)
      );
      if (resource) {
        if (creep.withdraw(outputLab, resource) === ERR_NOT_IN_RANGE) {
          creep.moveTo(outputLab, { reusePath: 5 });
        }
        return;
      }
    }
  }

  for (let i = 0; i < 2; i++) {
    if (!ls.inputCompounds) break;
    const expected = ls.inputCompounds[i] as ResourceConstant;
    const lab = inputLabs[i];
    const wrong = (Object.keys(lab.store) as ResourceConstant[]).find(
      (r) => r !== expected && (lab.store.getUsedCapacity(r) ?? 0) > 0
    );
    if (wrong) {
      if (creep.withdraw(lab, wrong) === ERR_NOT_IN_RANGE) {
        creep.moveTo(lab, { reusePath: 5 });
      }
      return;
    }
  }

  if (ls.inputCompounds) {
    for (let i = 0; i < 2; i++) {
      const compound = ls.inputCompounds[i] as ResourceConstant;
      const lab = inputLabs[i];
      const labFree = lab.store.getFreeCapacity(compound) ?? 0;
      if (labFree < MIN_REFILL_AMOUNT) continue;
      if ((storage.store.getUsedCapacity(compound) ?? 0) <= 0) continue;
      const amount = Math.min(creep.store.getFreeCapacity() ?? 0, labFree);
      if (creep.withdraw(storage, compound, amount) === ERR_NOT_IN_RANGE) {
        creep.moveTo(storage, { reusePath: 5 });
      }
      return;
    }
  }

  for (const outputLab of outputLabs) {
    const resource = (Object.keys(outputLab.store) as ResourceConstant[]).find(
      (r) =>
        r !== RESOURCE_ENERGY &&
        (outputLab.store.getUsedCapacity(r) ?? 0) > 0 &&
        !pendingBoostCompounds.has(r)
    );
    if (resource) {
      if (creep.withdraw(outputLab, resource) === ERR_NOT_IN_RANGE) {
        creep.moveTo(outputLab, { reusePath: 5 });
      }
      return;
    }
  }

  if (!creep.pos.isNearTo(storage)) creep.moveTo(storage, { reusePath: 20 });
}
