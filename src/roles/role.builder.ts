import {
  getSources,
  acquireEnergy,
  isCreepEmpty,
  isCreepFull,
  getRoomBuildTarget,
  findClosestConstructionSite,
  findClosestRepairTarget,
  findCriticalDefenseTarget,
  findCoreFillTarget,
  transferEnergyTo,
  upgradeController,
  buildAtConstructionSite,
  repairStructure,
  isEnergyEmergency,
} from "../services/services.creep";

export function runBuilder(creep: Creep) {
  if (creep.memory.working === undefined) creep.memory.working = false;

  if (creep.memory.working && isCreepEmpty(creep)) {
    creep.memory.working = false;
  }

  if (!creep.memory.working && isCreepFull(creep)) {
    creep.memory.working = true;
  }
  if (!creep.memory.working) {
    // In a storage room, leave the miner containers AND the dropped piles beside them for the
    // porters — pulling that raw producer energy out from under them starves the tower/extension
    // refill. Builders eat from the storage buffer instead, so construction keeps going without
    // outbidding the core's supply, and back off (idle) when the buffer is empty rather than
    // raiding the miners. Pre-storage rooms have no buffer, so builders still use any container.
    const acquired = acquireEnergy(creep, { bufferOnly: !!creep.room.storage });
    // If nothing could be drawn (drained buffer, miners reserved for porters) but we're already
    // carrying some energy, go spend that partial load instead of idling forever waiting for a
    // full top-up the buffer can't give — otherwise the creep is stranded half-full, never full
    // enough to flip to working and unwilling to raid the miners. Empty-handed with no source:
    // genuinely nothing to do, so wait.
    if (acquired || isCreepEmpty(creep)) return;
    creep.memory.working = true;
  }

  // While the room is starving for energy, stop spending it on construction, repair and
  // upgrading — those drain the very buffer the colony needs to keep spawning haulers/miners
  // back. Spawning already declines to replace builders during an emergency; this stops the
  // ones already alive from bleeding the room dry in the meantime. Instead, the carried energy
  // is poured into the starved core (spawn/extensions/towers) to help end the emergency faster.
  //
  // Limited to rooms WITH storage: there the emergency signal also requires a drained storage
  // buffer, so it marks a genuine starvation. Pre-storage rooms trip the signal off the raw
  // spawn fraction alone, which dips under 25% routinely as the spawn drains to make creeps —
  // backing off there would just stall the early construction those rooms most need.
  if (creep.room.storage && isEnergyEmergency(creep.room)) {
    const fill = findCoreFillTarget(creep);
    if (fill) transferEnergyTo(creep, fill);
    return;
  }

  // Rescue a freshly-built (critically low) rampart/wall before laying or building anything
  // else. A rampart completes at 1 hit and decays away within ~100 ticks if it isn't lifted
  // past the decay amount — and the builder's generic repair fallback excludes ramparts — so
  // without this a mason that just built a rampart abandons it at 1 hit and it dies, looping
  // build→decay→rebuild forever. Once it's past the floor, towers/repairers maintain it.
  // Each step below targets a single structure. If that target can't be reached
  // (ERR_NO_PATH — the tile is walled off, behind wall construction sites, or on
  // unreachable terrain) we must NOT return, or the creep stands still holding full
  // energy forever while other reachable work goes undone. Fall through to the next
  // kind of work instead; ERR_NO_PATH means "couldn't get close enough", every other
  // result (built/repaired/moving/out-of-energy) is real progress, so we return on it.
  const critical = findCriticalDefenseTarget(creep);
  if (critical) {
    const r = repairStructure(creep, critical);
    if (r === ERR_NOT_ENOUGH_RESOURCES) creep.memory.working = false;
    if (r !== ERR_NO_PATH) return;
  }

  const site = getRoomBuildTarget(creep.room);
  if (site) {
    const res = buildAtConstructionSite(creep, site);
    if (res === ERR_NOT_ENOUGH_RESOURCES) {
      creep.memory.working = false;
      return;
    }
    if (res !== ERR_NO_PATH) return;
    // The room's focus-fire site is unreachable from here — build the closest site we
    // CAN path to instead of idling, so construction still makes progress.
    const reachable = findClosestConstructionSite(creep);
    if (reachable && reachable.id !== site.id) {
      const r2 = buildAtConstructionSite(creep, reachable);
      if (r2 === ERR_NOT_ENOUGH_RESOURCES) creep.memory.working = false;
      if (r2 !== ERR_NO_PATH) return;
    }
  }

  const repairTarget = findClosestRepairTarget(creep);
  if (repairTarget) {
    const r = repairStructure(creep, repairTarget);
    if (r === ERR_NOT_ENOUGH_RESOURCES) creep.memory.working = false;
    if (r !== ERR_NO_PATH) return;
  }

  upgradeController(creep);
}
