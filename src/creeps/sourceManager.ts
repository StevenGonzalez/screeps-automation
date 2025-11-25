// src/creeps/sourceManager.ts
import { MemoryManager } from '../memory/memoryManager';

function isSafeSource(source: Source): boolean {
  const room = Game.rooms[source.pos.roomName];
  if (!room) return false;
  
  // Don't go to enemy-controlled rooms
  if (room.controller && room.controller.owner && !room.controller.my) {
    return false;
  }
  
  // Check for hostile creeps near the source
  const hostiles = source.pos.findInRange(FIND_HOSTILE_CREEPS, 5);
  if (hostiles.length > 0) return false;
  
  return true;
}

export function assignSourceToCreep(creep: Creep): string | undefined {
  const room = creep.room;
  if (!room) return undefined;
  const path = `rooms.${room.name}.sourceAssignments`;
  const assignments = MemoryManager.get<Record<string, string>>(path, {}) || {};

  // clean dead assignments
  for (const srcId in Object.assign({}, assignments)) {
    const assigned = assignments[srcId];
    if (assigned && !Game.creeps[assigned]) delete assignments[srcId];
  }

  // if creep already has an assignment and it's valid, return it
  if (creep.memory && (creep.memory as any).sourceId) {
    const sid = (creep.memory as any).sourceId as string;
    const source = Game.getObjectById(sid) as Source | null;
    if (source && isSafeSource(source) && (!assignments[sid] || assignments[sid] === creep.name)) {
      assignments[sid] = creep.name;
      MemoryManager.set(path, assignments);
      return sid;
    }
  }

  const sources = room.find(FIND_SOURCES);
  // prefer nearest unassigned active safe source
  let best: Source | undefined;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const s of sources) {
    if ((s as Source).energy === 0) continue;
    if (!isSafeSource(s)) continue;
    const assigned = assignments[s.id];
    if (assigned && Game.creeps[assigned]) continue;
    const d = creep.pos.getRangeTo(s.pos);
    if (d < bestDist) {
      bestDist = d;
      best = s as Source;
    }
  }

  if (best) {
    assignments[best.id] = creep.name;
    MemoryManager.set(path, assignments);
    return best.id;
  }

  return undefined;
}
