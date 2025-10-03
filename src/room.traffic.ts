/// <reference types="@types/screeps" />

import { getRoomMemory } from "./global.memory";

type TrafficMem = {
  counts: Record<string, number>;
  lastDecay?: number;
};

function getTrafficMem(roomName: string): TrafficMem {
  const mem = getRoomMemory(roomName);
  mem.traffic = mem.traffic || { counts: {} };
  if (!mem.traffic.counts) mem.traffic.counts = {};
  return mem.traffic as TrafficMem;
}

export function updateRoomTraffic(room: Room): void {
  const traffic = getTrafficMem(room.name);
  const counts = traffic.counts;

  // Record movement: increment tile when creep position changed from last tick
  const creeps = room.find(FIND_MY_CREEPS);
  for (const c of creeps) {
    const lpx = (c.memory as any).lpx as number | undefined;
    const lpy = (c.memory as any).lpy as number | undefined;
    if (typeof lpx === "number" && typeof lpy === "number") {
      if (lpx !== c.pos.x || lpy !== c.pos.y) {
        const key = `${c.pos.x}:${c.pos.y}`;
        counts[key] = Math.min(1000, (counts[key] || 0) + 1);
      }
    }
    // update last pos for next tick comparison
    (c.memory as any).lpx = c.pos.x;
    (c.memory as any).lpy = c.pos.y;
  }

  // Occasional decay/prune to keep memory bounded
  if (Game.time % 100 === 0) {
    const keys = Object.keys(counts);
    // Soft decay
    for (let i = 0; i < Math.min(keys.length, 300); i++) {
      const k = keys[i];
      const v = Math.floor((counts[k] || 0) * 0.9);
      if (v < 5) delete counts[k];
      else counts[k] = v;
    }
    // Hard cap entries
    const MAX_KEYS = 600;
    const all = Object.keys(counts);
    if (all.length > MAX_KEYS) {
      const sorted = all
        .map((k) => ({ k, v: counts[k] || 0 }))
        .sort((a, b) => a.v - b.v);
      for (let i = 0; i < all.length - MAX_KEYS; i++) {
        delete counts[sorted[i].k];
      }
    }
    traffic.lastDecay = Game.time;
  }
}

function isRoadBuildableTile(room: Room, x: number, y: number): boolean {
  if (x <= 0 || x >= 49 || y <= 0 || y >= 49) return false;
  const terrain = room.getTerrain();
  if (terrain.get(x, y) === TERRAIN_MASK_WALL) return false;
  const pos = new RoomPosition(x, y, room.name);
  const structs = pos.lookFor(LOOK_STRUCTURES);
  // Allow roads on empty tiles or over existing road/rampart only
  return !structs.some(
    (s) =>
      s.structureType !== STRUCTURE_ROAD &&
      s.structureType !== STRUCTURE_RAMPART
  );
}

export function getHotTrafficTiles(
  room: Room,
  minCount: number,
  maxTiles: number
): RoomPosition[] {
  const traffic = getTrafficMem(room.name);
  const entries = Object.entries(traffic.counts);
  if (entries.length === 0) return [];
  // Partial selection instead of full sort for CPU efficiency
  const target = maxTiles * 3;
  const heap: Array<[string, number]> = [];
  for (const [k, v] of entries) {
    if (v < minCount) continue;
    if (heap.length < target) {
      heap.push([k, v]);
      continue;
    }
    // Replace smallest if current is larger; linear scan since target is tiny
    let minIdx = 0;
    for (let i = 1; i < heap.length; i++)
      if (heap[i][1] < heap[minIdx][1]) minIdx = i;
    if (heap[minIdx][1] < v) heap[minIdx] = [k, v];
  }
  heap.sort((a, b) => b[1] - a[1]);
  const results: RoomPosition[] = [];
  for (const [k] of heap) {
    const [sx, sy] = k.split(":");
    const x = Number(sx);
    const y = Number(sy);
    if (!isFinite(x) || !isFinite(y)) continue;
    const pos = new RoomPosition(x, y, room.name);
    // Skip if road already exists
    const hasRoad = pos
      .lookFor(LOOK_STRUCTURES)
      .some((s) => s.structureType === STRUCTURE_ROAD);
    if (hasRoad) continue;
    if (!isRoadBuildableTile(room, x, y)) continue;
    results.push(pos);
    if (results.length >= maxTiles) break;
  }
  return results;
}
