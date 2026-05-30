// Minimum free capacity in an input lab before bothering to refill it.
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

  // ── DELIVERING ──────────────────────────────────────────────────────────────
  if (carrying.length > 0) {
    const resource = carrying[0];

    // If carrying a mineral earmarked for a cross-room transfer, fill the terminal first
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

    // If it's an active input reagent, fill the correct input lab
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

    // Anything else (product from output labs, wrong compounds) → storage
    if (creep.transfer(storage, resource) === ERR_NOT_IN_RANGE) {
      creep.moveTo(storage, { reusePath: 5 });
    }
    return;
  }

  // ── LOADING ─────────────────────────────────────────────────────────────────

  // Build a set of compounds currently being sought for boosts in this room —
  // the apothecary must not drain those from labs or the boost window closes.
  const pendingBoostCompounds = new Set(
    creep.room.find(FIND_MY_CREEPS, { filter: (c) => !!c.memory.boostCompound && !c.memory.boosted })
      .map((c) => c.memory.boostCompound as string)
  );

  // Priority 0: withdraw mineral from storage to pre-load terminal for a pending cross-room send
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

  // Priority 1: drain output labs that are nearly full so reactions don't stall
  for (const outputLab of outputLabs) {
    const used = outputLab.store.getUsedCapacity() ?? 0;
    const cap = outputLab.store.getCapacity() ?? 0;
    if (used >= cap * 0.75) {
      const resource = (Object.keys(outputLab.store) as ResourceConstant[]).find(
        (r) => (outputLab.store.getUsedCapacity(r) ?? 0) > 0 && !pendingBoostCompounds.has(r)
      );
      if (resource) {
        if (creep.withdraw(outputLab, resource) === ERR_NOT_IN_RANGE) {
          creep.moveTo(outputLab, { reusePath: 5 });
        }
        return;
      }
    }
  }

  // Priority 2: remove wrong compounds from input labs so they can accept reagents
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

  // Priority 3: fill input labs with the correct reagents
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

  // Priority 4: drain any remaining output lab product to storage (skip boost-reserved)
  for (const outputLab of outputLabs) {
    const resource = (Object.keys(outputLab.store) as ResourceConstant[]).find(
      (r) => (outputLab.store.getUsedCapacity(r) ?? 0) > 0 && !pendingBoostCompounds.has(r)
    );
    if (resource) {
      if (creep.withdraw(outputLab, resource) === ERR_NOT_IN_RANGE) {
        creep.moveTo(outputLab, { reusePath: 5 });
      }
      return;
    }
  }

  // Idle — park near storage
  if (!creep.pos.isNearTo(storage)) creep.moveTo(storage, { reusePath: 20 });
}
