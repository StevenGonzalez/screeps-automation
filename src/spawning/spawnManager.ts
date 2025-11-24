// src/spawning/spawnManager.ts
import { bestBodyForRole } from './bodyFactory';
import { MemoryManager } from '../memory/memoryManager';
import { SpawnConfig } from '../config';

export class SpawnManager {
  run() {
    const spawns = Object.values(Game.spawns);
    for (const sp of spawns) {
      if (sp.spawning) continue;
      const room = sp.room;
      const creepsInRoom = Object.values(Game.creeps).filter(c => c.room.name === room.name) as Creep[];
      const harvesterCount = creepsInRoom.reduce((acc, c) => acc + (c.memory.role === 'harvester' ? 1 : 0), 0);
      const desiredHarvesters = Math.max(1, Math.floor(room.energyCapacityAvailable / 300));
      const sourcesCount = room.find(FIND_SOURCES).length;
      const maxPerSource = SpawnConfig.maxHarvestersPerSource;
      const maxHarvesters = Math.max(1, sourcesCount * maxPerSource);
      const targetHarvesters = Math.min(desiredHarvesters, maxHarvesters);

      const queuePath = `rooms.${room.name}.spawnQueue`;
      const queue = MemoryManager.get<any[]>(queuePath, []) || [];

      // Auto-enqueue upgraders for low-RCL rooms without storage
      const controller = room.controller;
      if (controller && controller.my) {
        const currentUpgraders = creepsInRoom.reduce((acc, c) => acc + (c.memory.role === 'upgrader' ? 1 : 0), 0);
        const queuedUpgraders = (queue || []).reduce((acc, r) => acc + (r.role === 'upgrader' ? 1 : 0), 0);

        let desiredUpgraders = 0;
        if (!room.storage) {
          if ((room.energyCapacityAvailable || 0) >= SpawnConfig.upgrader.energyThreshold2) desiredUpgraders = 2;
          else if ((room.energyCapacityAvailable || 0) >= SpawnConfig.upgrader.energyThreshold1) desiredUpgraders = 1;
        } else {
          // storage-based scaling (if storage exists)
          const stored = (room.storage && (room.storage.store as any)[RESOURCE_ENERGY]) || 0;
          desiredUpgraders = Math.min(3, Math.floor(stored / 5000) + 1);
        }

        // controller downgrade urgency increases desired upgraders
        if (controller.ticksToDowngrade && controller.ticksToDowngrade < 1500) desiredUpgraders = Math.max(desiredUpgraders, 1);

        if (currentUpgraders + queuedUpgraders < desiredUpgraders) {
          const needed = desiredUpgraders - (currentUpgraders + queuedUpgraders);
          for (let i = 0; i < needed; i++) {
            const { body } = bestBodyForRole('upgrader', room.energyCapacityAvailable);
            queue.push({ role: 'upgrader', body, priority: SpawnConfig.upgrader.priority, requestedAt: Game.time, fallbackAfter: SpawnConfig.upgrader.fallbackAfter });
          }
          MemoryManager.set(queuePath, queue);
        }
      }

      // Auto-enqueue builders when there are construction sites
      const constructionSites = room.find(FIND_MY_CONSTRUCTION_SITES).length;
      if (constructionSites > 0) {
        const currentBuilders = creepsInRoom.reduce((acc, c) => acc + (c.memory.role === 'builder' ? 1 : 0), 0);
        const queuedBuilders = (queue || []).reduce((acc, r) => acc + (r.role === 'builder' ? 1 : 0), 0);
        const desiredBuilders = Math.min(SpawnConfig.builder.maxBuilders, Math.ceil(constructionSites / SpawnConfig.builder.sitesPerBuilder));
        if (currentBuilders + queuedBuilders < desiredBuilders) {
          const needed = desiredBuilders - (currentBuilders + queuedBuilders);
          for (let i = 0; i < needed; i++) {
            const { body } = bestBodyForRole('builder', room.energyCapacityAvailable);
            queue.push({ role: 'builder', body, priority: SpawnConfig.builder.priority, requestedAt: Game.time, fallbackAfter: SpawnConfig.builder.fallbackAfter });
          }
          MemoryManager.set(queuePath, queue);
        }
      }

      // Emergency immediate spawn if no harvesters and nothing queued
      if (harvesterCount === 0 && queue.length === 0) {
        const { body } = bestBodyForRole('harvester', room.energyAvailable || SpawnConfig.harvesterEnergyStep);
        const name = `harv_${Game.time}`;
        sp.spawnCreep(body, name, { memory: { role: 'harvester' } });
        continue;
      }

      // Queue spawn requests up to targetHarvesters
      const queuedHarvesters = queue.reduce((acc, r) => acc + (r.role === 'harvester' ? 1 : 0), 0);
      if (harvesterCount + queuedHarvesters < targetHarvesters) {
        const { body } = bestBodyForRole('harvester', room.energyCapacityAvailable);
        const req = { role: 'harvester', body, requestedAt: Game.time, priority: 1, fallbackAfter: SpawnConfig.queue.defaultFallbackAfter };
        queue.push(req);
        MemoryManager.set(queuePath, queue);
      }

      // Process queue: attempt to spawn highest-priority request
      const currentQueue = (MemoryManager.get<any[]>(queuePath, []) || []).slice();
      if (currentQueue.length > 0 && !sp.spawning) {
        currentQueue.sort((a, b) => (b.priority || 0) - (a.priority || 0) || (a.requestedAt - b.requestedAt));
        const req = currentQueue[0];
        const baseName = `spawn_${req.role}_${Game.time}`;
        const name = `${baseName}_${Math.floor(Math.random() * 10000)}`;
        const res = sp.spawnCreep(req.body, name, { memory: { role: req.role } });
        if (res === OK) {
          // remove first matched request from persisted queue
          const persisted = MemoryManager.get<any[]>(queuePath, []) || [];
          const idx = persisted.findIndex(r => r.requestedAt === req.requestedAt && r.role === req.role);
          if (idx >= 0) persisted.splice(idx, 1);
          MemoryManager.set(queuePath, persisted);
        } else if (res === ERR_NOT_ENOUGH_ENERGY) {
          const age = (Game.time || 0) - (req.requestedAt || 0);
          const fallbackAfter = req.fallbackAfter || 25;
          if (age >= fallbackAfter) {
            // build emergency body from available energy
            const energy = room.energyAvailable || 0;
            const emergency = bestBodyForRole(req.role, energy).body;
            const fname = `${baseName}_emg_${Math.floor(Math.random() * 10000)}`;
            const fres = sp.spawnCreep(emergency, fname, { memory: { role: req.role } });
            if (fres === OK) {
              const persisted = MemoryManager.get<any[]>(queuePath, []) || [];
              const idx = persisted.findIndex(r => r.requestedAt === req.requestedAt && r.role === req.role);
              if (idx >= 0) persisted.splice(idx, 1);
              MemoryManager.set(queuePath, persisted);
            }
          }
        } else {
          console.log(`spawnCreep failed: ${res}`);
          const persisted = MemoryManager.get<any[]>(queuePath, []) || [];
          const idx = persisted.findIndex(r => r.requestedAt === req.requestedAt && r.role === req.role);
          if (idx >= 0) persisted.splice(idx, 1);
          MemoryManager.set(queuePath, persisted);
        }
      }
    }
  }
}

export const spawnManager = new SpawnManager();
