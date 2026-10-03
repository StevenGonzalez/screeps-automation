import { getBoostRequests, assignBoostLabs } from "../services/services.labs";

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

  const boostRequests = getBoostRequests(room);
  const boostLabs = assignBoostLabs(outputLabs, boostRequests.keys());

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

    for (const [compound, lab] of boostLabs) {
      const fits =
        resource === RESOURCE_ENERGY
          ? lab.store.getFreeCapacity(RESOURCE_ENERGY) > 0
          : resource === compound && (!lab.mineralType || lab.mineralType === compound);
      if (fits && deliverTo(creep, lab, resource)) return;
    }

    if (ls.inputCompounds) {
      for (let i = 0; i < 2; i++) {
        const lab = inputLabs[i];
        if (
          ls.inputCompounds[i] === resource &&
          (!lab.mineralType || lab.mineralType === resource) &&
          deliverTo(creep, lab, resource)
        ) {
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

  for (const [compound, lab] of boostLabs) {
    if (lab.mineralType && lab.mineralType !== compound) {
      if (creep.withdraw(lab, lab.mineralType) === ERR_NOT_IN_RANGE) {
        creep.moveTo(lab, { reusePath: 5 });
      }
      return;
    }
    const rc = compound as ResourceConstant;
    const needed = boostRequests.get(compound) ?? 0;
    const missing = Math.min(needed, LAB_MINERAL_CAPACITY) - (lab.store.getUsedCapacity(rc) ?? 0);
    if (missing > 0) {
      const src = findStoreWith(room, rc);
      if (src) {
        const amount = Math.min(creep.store.getFreeCapacity(), missing, src.store.getUsedCapacity(rc));
        if (creep.withdraw(src, rc, amount) === ERR_NOT_IN_RANGE) {
          creep.moveTo(src, { reusePath: 5 });
        }
        return;
      }
    }
    const energyMissing = Math.min(
      (needed / LAB_BOOST_MINERAL) * LAB_BOOST_ENERGY - lab.store[RESOURCE_ENERGY],
      lab.store.getFreeCapacity(RESOURCE_ENERGY)
    );
    if (energyMissing > 0 && storage.store[RESOURCE_ENERGY] > 0) {
      const amount = Math.min(creep.store.getFreeCapacity(), energyMissing, storage.store[RESOURCE_ENERGY]);
      if (creep.withdraw(storage, RESOURCE_ENERGY, amount) === ERR_NOT_IN_RANGE) {
        creep.moveTo(storage, { reusePath: 5 });
      }
      return;
    }
  }

  // Empty output labs before refilling inputs only once they are filling up.
  // A lab's store has no capacity without a resource named, so this has to
  // measure the product itself.
  for (const outputLab of outputLabs) {
    const resource = (Object.keys(outputLab.store) as ResourceConstant[]).find(
      (r) =>
        r !== RESOURCE_ENERGY &&
        (outputLab.store.getUsedCapacity(r) ?? 0) >= LAB_MINERAL_CAPACITY * 0.75 &&
        !pendingBoostCompounds.has(r)
    );
    if (resource) {
      if (creep.withdraw(outputLab, resource) === ERR_NOT_IN_RANGE) {
        creep.moveTo(outputLab, { reusePath: 5 });
      }
      return;
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
      const src = findStoreWith(room, compound);
      if (!src) continue;
      const amount = Math.min(creep.store.getFreeCapacity() ?? 0, labFree, src.store.getUsedCapacity(compound));
      if (creep.withdraw(src, compound, amount) === ERR_NOT_IN_RANGE) {
        creep.moveTo(src, { reusePath: 5 });
      }
      return;
    }
  }

  // With nothing queued, inputs left in the input labs go back to storage too,
  // where stock counts and boosts can see them.
  const idleInputs = !ls.inputCompounds && ls.queue.length === 0 ? inputLabs : [];
  for (const lab of [...outputLabs, ...idleInputs]) {
    const resource = (Object.keys(lab.store) as ResourceConstant[]).find(
      (r) =>
        r !== RESOURCE_ENERGY &&
        (lab.store.getUsedCapacity(r) ?? 0) > 0 &&
        !pendingBoostCompounds.has(r)
    );
    if (resource) {
      if (creep.withdraw(lab, resource) === ERR_NOT_IN_RANGE) {
        creep.moveTo(lab, { reusePath: 5 });
      }
      return;
    }
  }

  if (!creep.pos.isNearTo(storage)) creep.moveTo(storage, { reusePath: 20 });
}

function deliverTo(creep: Creep, target: Structure, resource: ResourceConstant): boolean {
  const res = creep.transfer(target, resource);
  if (res === ERR_NOT_IN_RANGE) {
    creep.moveTo(target, { reusePath: 5 });
    return true;
  }
  return res === OK;
}

function findStoreWith(room: Room, resource: ResourceConstant): StructureStorage | StructureTerminal | undefined {
  return [room.storage, room.terminal].find(
    (s): s is StructureStorage | StructureTerminal => !!s && s.store.getUsedCapacity(resource) > 0
  );
}
