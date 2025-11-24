// src/creeps/sourceManager.ts
import { MemoryManager } from '../memory/memoryManager';

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
    if (!assignments[sid] || assignments[sid] === creep.name) {
      assignments[sid] = creep.name;
      MemoryManager.set(path, assignments);
      return sid;
    }
  }

  const sources = room.find(FIND_SOURCES);
  // prefer nearest unassigned active source
  let best: Source | undefined;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const s of sources) {
    if ((s as Source).energy === 0) continue;
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
