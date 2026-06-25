import { getThreatInfo } from "../services/services.combat";
import { pickSignature } from "../config/signatures";

// Settler: seeds a freshly claimed child room. Its job, in priority order:
//   1. Survive — retreat to the home room if the child is invaded (a dead settler
//      builds nothing; defense is the home room's / towers' job).
//   2. Build the spawn first so the colony can start spawning its own creeps.
//   3. Build the rest of the room's critical economy (other sites).
//   4. Keep the spawn topped up so it can actually spawn.
//   5. Upgrade the controller to stop it decaying.
// Once the expansion is "established", existing settlers retire (suicide) rather
// than looping pointlessly — the room now sustains itself.

export function runSettler(creep: Creep) {
  const targetRoom = creep.memory.targetRoom;
  if (!targetRoom) { creep.suicide(); return; }

  // Retire once the colony is self-sufficient. The expansion orchestrator owns the
  // bootstrapping → established transition; a settler has nothing left to do after.
  const exp = Memory.expansion;
  if (exp && exp.roomName === targetRoom && exp.phase === "established") {
    creep.suicide();
    return;
  }

  // ── Retreat from an invaded child room ──────────────────────────────────────
  // If our destination room is hot, fall back to the home room and wait it out
  // instead of feeding the enemy a free kill. The orchestrator pauses settler
  // spawning while this lasts.
  const homeRoom = creep.memory.homeRoom ?? exp?.homeRoom;
  if (creep.room.name === targetRoom && getThreatInfo(creep.room).score > 0) {
    if (homeRoom && homeRoom !== targetRoom) {
      moveToRoom(creep, homeRoom);
    } else {
      // No safe room to fall back to — flee toward the nearest exit edge.
      const exits = creep.room.find(FIND_EXIT);
      const exit = creep.pos.findClosestByRange(exits);
      if (exit) creep.moveTo(exit, { reusePath: 5 });
    }
    return;
  }

  if (creep.room.name !== targetRoom) {
    moveToRoom(creep, targetRoom);
    return;
  }

  // Toggle working state on empty/full
  if (creep.memory.working && creep.store[RESOURCE_ENERGY] === 0) {
    creep.memory.working = false;
  } else if (!creep.memory.working && creep.store.getFreeCapacity() === 0) {
    creep.memory.working = true;
  }

  if (!creep.memory.working) {
    harvest(creep);
    return;
  }

  // 2. Build the spawn FIRST so the colony becomes self-spawning ASAP.
  const spawnSite = creep.room
    .find(FIND_MY_CONSTRUCTION_SITES)
    .find((s) => s.structureType === STRUCTURE_SPAWN);
  if (spawnSite) {
    if (creep.build(spawnSite) === ERR_NOT_IN_RANGE) {
      creep.moveTo(spawnSite, { reusePath: 10 });
    }
    return;
  }

  // 3. Otherwise build whatever else is queued (extensions, containers, towers…).
  const site = creep.pos.findClosestByRange(FIND_CONSTRUCTION_SITES);
  if (site) {
    if (creep.build(site) === ERR_NOT_IN_RANGE) {
      creep.moveTo(site, { reusePath: 10 });
    }
    return;
  }

  // 4. Spawn exists but no sites — keep it fuelled so it can spawn the economy.
  const spawn = creep.room.find(FIND_MY_SPAWNS)[0];
  if (spawn && spawn.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
    if (creep.transfer(spawn, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
      creep.moveTo(spawn, { reusePath: 20 });
    }
    return;
  }

  // 5. Nothing urgent — upgrade controller to keep the room from decaying.
  const ctrl = creep.room.controller;
  if (ctrl) {
    // On the first tick we find the room self-sufficient / settled, sign once.
    // lastSigned is stamped on success (here or by the conqueror on claim), so
    // once the room carries a mark we never re-sign — without this guard the
    // block fires every tick of the whole bootstrapping phase.
    const exp = Memory.expansion;
    const shouldSign =
      exp &&
      exp.roomName === creep.room.name &&
      exp.phase === "bootstrapping" &&
      creep.room.memory.lastSigned === undefined;
    if (shouldSign) {
      try {
        const sig = pickSignature(creep.room.name);
        const sres = creep.signController(ctrl, sig);
        if (sres === OK) {
          if (!Memory.rooms) Memory.rooms = {} as any;
          if (!Memory.rooms[creep.room.name]) Memory.rooms[creep.room.name] = {} as any;
          Memory.rooms[creep.room.name].lastSigned = Game.time;
        }
      } catch (e) {}
    }
    if (creep.upgradeController(ctrl) === ERR_NOT_IN_RANGE) {
      creep.moveTo(ctrl, { reusePath: 20 });
    }
  }
}

function harvest(creep: Creep) {
  const source = creep.pos.findClosestByRange(FIND_SOURCES_ACTIVE);
  if (!source) {
    // No active source right now — idle near the controller so we're ready to work.
    const ctrl = creep.room.controller;
    if (ctrl && !creep.pos.isNearTo(ctrl)) creep.moveTo(ctrl, { reusePath: 20 });
    return;
  }
  if (creep.harvest(source) === ERR_NOT_IN_RANGE) {
    creep.moveTo(source, { reusePath: 10 });
  }
}

function moveToRoom(creep: Creep, roomName: string) {
  const exit = creep.room.findExitTo(roomName);
  if (exit === ERR_NO_PATH || exit === ERR_INVALID_ARGS) {
    creep.suicide();
    return;
  }
  const exitPos = creep.pos.findClosestByRange(exit);
  if (exitPos) creep.moveTo(exitPos, { reusePath: 50 });
}
