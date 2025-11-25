// src/spawning/spawnManager.ts
import { bestBodyForRole } from './bodyFactory';
import { MemoryManager } from '../memory/memoryManager';
import { SpawnConfig } from '../config';
import { getRoomRepairStats } from '../creeps/behaviors/repair';

interface SpawnRequest {
  role: string;
  body: BodyPartConstant[];
  priority: number;
  requestedAt: number;
  fallbackAfter: number;
  containerId?: string;
}

export class SpawnManager {
  run() {
    const spawns = Object.values(Game.spawns);
    for (const sp of spawns) {
      if (sp.spawning) continue;
      this.runForSpawn(sp);
    }
  }

  private runForSpawn(spawn: StructureSpawn) {
    const room = spawn.room;
    const queuePath = `rooms.${room.name}.spawnQueue`;
    
    const creepsInRoom = this.getCreepsInRoom(room);
    
    this.handleEmergencyHarvesterSpawn(spawn, creepsInRoom, queuePath);
    this.enqueueMiners(room, creepsInRoom, queuePath);
    this.enqueueHaulers(room, creepsInRoom, queuePath);
    this.enqueueHarvesters(room, creepsInRoom, queuePath);
    this.enqueueRepairers(room, creepsInRoom, queuePath);
    this.enqueueUpgraders(room, creepsInRoom, queuePath);
    this.enqueueBuilders(room, creepsInRoom, queuePath);
    this.processQueue(spawn, room, queuePath);
  }

  private getCreepsInRoom(room: Room): Creep[] {
    return Object.values(Game.creeps).filter(c => c.room.name === room.name);
  }

  private countCreepsByRole(creeps: Creep[], role: string): number {
    return creeps.reduce((acc, c) => acc + (c.memory.role === role ? 1 : 0), 0);
  }

  private countQueuedByRole(queuePath: string, role: string): number {
    const queue = MemoryManager.get<SpawnRequest[]>(queuePath, []) || [];
    return queue.reduce((acc, r) => acc + (r.role === role ? 1 : 0), 0);
  }

  private handleEmergencyHarvesterSpawn(spawn: StructureSpawn, creeps: Creep[], queuePath: string) {
    const harvesterCount = this.countCreepsByRole(creeps, 'harvester');
    const minerCount = this.countCreepsByRole(creeps, 'miner');
    
    // Only spawn emergency harvester if we have no harvesters AND no miners
    if (harvesterCount === 0 && minerCount === 0) {
      const { body } = bestBodyForRole('harvester', spawn.room.energyAvailable || SpawnConfig.harvesterEnergyStep);
      const name = `harv_${Game.time}`;
      spawn.spawnCreep(body, name, { memory: { role: 'harvester' } });
    }
  }

  private enqueueMiners(room: Room, creeps: Creep[], queuePath: string) {
    const assignmentsPath = `rooms.${room.name}.minerAssignments`;
    const assignments = MemoryManager.get<Record<string, string>>(assignmentsPath, {}) || {};

    for (const cid in Object.assign({}, assignments)) {
      const minerName = assignments[cid];
      if (minerName && !Game.creeps[minerName]) {
        delete assignments[cid];
      }
    }

    const builtContainers = room.find(FIND_STRUCTURES, {
      filter: (s) => s.structureType === STRUCTURE_CONTAINER,
    }) as StructureContainer[];

    const safeContainers = builtContainers.filter(c => this.isSafeContainer(c));

    for (const container of safeContainers) {
      const assignedMiner = assignments[container.id];
      if (assignedMiner && Game.creeps[assignedMiner]) continue;

      const queuedForContainer = this.countQueuedForContainer(queuePath, container.id);
      if (queuedForContainer > 0) continue;

      const { body } = bestBodyForRole('miner', room.energyCapacityAvailable);
      const req: SpawnRequest = {
        role: 'miner',
        body,
        requestedAt: Game.time,
        priority: 60,
        fallbackAfter: SpawnConfig.queue.defaultFallbackAfter,
        containerId: container.id,
      };
      this.addToQueue(queuePath, req);
    }

    MemoryManager.set(assignmentsPath, assignments);
  }

  private isSafeContainer(container: StructureContainer): boolean {
    const source = container.pos.findInRange(FIND_SOURCES, 1)[0];
    if (!source) return false;

    const room = Game.rooms[source.pos.roomName];
    if (!room) return false;

    if (room.controller && room.controller.owner && !room.controller.my) {
      return false;
    }

    const hostiles = source.pos.findInRange(FIND_HOSTILE_CREEPS, 5);
    return hostiles.length === 0;
  }

  private countQueuedForContainer(queuePath: string, containerId: string): number {
    const queue = MemoryManager.get<SpawnRequest[]>(queuePath, []) || [];
    return queue.reduce((acc, r) => acc + (r.role === 'miner' && r.containerId === containerId ? 1 : 0), 0);
  }

  private enqueueHaulers(room: Room, creeps: Creep[], queuePath: string) {
    const minerCount = this.countCreepsByRole(creeps, 'miner');
    if (minerCount === 0) return;

    const haulerCount = this.countCreepsByRole(creeps, 'hauler');
    const queuedHaulers = this.countQueuedByRole(queuePath, 'hauler');
    
    const desiredHaulers = Math.max(1, Math.ceil(minerCount * 1.5));

    if (haulerCount + queuedHaulers < desiredHaulers) {
      const { body } = bestBodyForRole('hauler', room.energyCapacityAvailable);
      const req: SpawnRequest = {
        role: 'hauler',
        body,
        requestedAt: Game.time,
        priority: 55,
        fallbackAfter: SpawnConfig.queue.defaultFallbackAfter,
      };
      this.addToQueue(queuePath, req);
    }
  }

  private enqueueHarvesters(room: Room, creeps: Creep[], queuePath: string) {
    const harvesterCount = this.countCreepsByRole(creeps, 'harvester');
    const queuedHarvesters = this.countQueuedByRole(queuePath, 'harvester');
    const minerCount = this.countCreepsByRole(creeps, 'miner');
    
    // If we have any miners, don't spawn harvesters (haulers will handle transport)
    if (minerCount > 0) {
      return;
    }
    
    // Normal harvester logic when no miners
    const desiredHarvesters = Math.max(1, Math.floor(room.energyCapacityAvailable / 300));
    const sourcesCount = room.find(FIND_SOURCES).length;
    const maxHarvesters = Math.max(1, sourcesCount * SpawnConfig.maxHarvestersPerSource);
    const targetHarvesters = Math.min(desiredHarvesters, maxHarvesters);

    if (harvesterCount + queuedHarvesters < targetHarvesters) {
      const { body } = bestBodyForRole('harvester', room.energyCapacityAvailable);
      const req: SpawnRequest = { 
        role: 'harvester', 
        body, 
        requestedAt: Game.time, 
        priority: 50, 
        fallbackAfter: SpawnConfig.queue.defaultFallbackAfter 
      };
      this.addToQueue(queuePath, req);
    }
  }

  private enqueueUpgraders(room: Room, creeps: Creep[], queuePath: string) {
    const controller = room.controller;
    if (!controller || !controller.my) return;

    const currentUpgraders = this.countCreepsByRole(creeps, 'upgrader');
    const queuedUpgraders = this.countQueuedByRole(queuePath, 'upgrader');

    let desiredUpgraders = 0;
    if (!room.storage) {
      if (room.energyCapacityAvailable >= SpawnConfig.upgrader.energyThreshold2) {
        desiredUpgraders = 2;
      } else if (room.energyCapacityAvailable >= SpawnConfig.upgrader.energyThreshold1) {
        desiredUpgraders = 1;
      }
    } else {
      const stored = room.storage.store[RESOURCE_ENERGY] || 0;
      desiredUpgraders = Math.min(3, Math.floor(stored / 5000) + 1);
    }

    if (controller.ticksToDowngrade && controller.ticksToDowngrade < 1500) {
      desiredUpgraders = Math.max(desiredUpgraders, 1);
    }

    if (currentUpgraders + queuedUpgraders < desiredUpgraders) {
      const needed = desiredUpgraders - (currentUpgraders + queuedUpgraders);
      for (let i = 0; i < needed; i++) {
        const { body } = bestBodyForRole('upgrader', room.energyCapacityAvailable);
        const req: SpawnRequest = { 
          role: 'upgrader', 
          body, 
          priority: SpawnConfig.upgrader.priority, 
          requestedAt: Game.time, 
          fallbackAfter: SpawnConfig.upgrader.fallbackAfter 
        };
        this.addToQueue(queuePath, req);
      }
    }
  }

  private enqueueRepairers(room: Room, creeps: Creep[], queuePath: string) {
    // Get repair statistics for intelligent spawn decisions
    const repairStats = getRoomRepairStats(room);
    const totalDamaged = repairStats.totalDamaged;
    
    // Only spawn repairers if there's meaningful repair work
    if (totalDamaged < SpawnConfig.repairer.minDamagedStructures) return;
    
    const currentRepairers = this.countCreepsByRole(creeps, 'repairer');
    const queuedRepairers = this.countQueuedByRole(queuePath, 'repairer');
    
    // Calculate desired repairers based on damage
    let desiredRepairers = 0;
    
    // High priority: critical structures or ramparts are damaged
    if (repairStats.criticalDamaged > 0 || repairStats.rampartsLow > 0) {
      desiredRepairers = Math.min(SpawnConfig.repairer.maxRepairers, 2);
    } 
    // Medium priority: extensions or significant general damage
    else if (repairStats.extensionsDamaged > 2 || totalDamaged >= 10) {
      desiredRepairers = Math.min(SpawnConfig.repairer.maxRepairers, 1);
    }
    // Low priority: some roads/containers need repair
    else if (totalDamaged >= SpawnConfig.repairer.minDamagedStructures) {
      desiredRepairers = 1;
    }
    
    // Don't spawn if we already have enough repairers working or queued
    if (currentRepairers + queuedRepairers < desiredRepairers) {
      const needed = desiredRepairers - (currentRepairers + queuedRepairers);
      for (let i = 0; i < needed; i++) {
        const { body } = bestBodyForRole('repairer', room.energyCapacityAvailable);
        const req: SpawnRequest = { 
          role: 'repairer', 
          body, 
          priority: SpawnConfig.repairer.priority, 
          requestedAt: Game.time, 
          fallbackAfter: SpawnConfig.repairer.fallbackAfter 
        };
        this.addToQueue(queuePath, req);
      }
    }
  }

  private enqueueBuilders(room: Room, creeps: Creep[], queuePath: string) {
    const constructionSites = room.find(FIND_MY_CONSTRUCTION_SITES).length;
    if (constructionSites === 0) return;

    const currentBuilders = this.countCreepsByRole(creeps, 'builder');
    const queuedBuilders = this.countQueuedByRole(queuePath, 'builder');
    const desiredBuilders = Math.min(
      SpawnConfig.builder.maxBuilders, 
      Math.ceil(constructionSites / SpawnConfig.builder.sitesPerBuilder)
    );

    if (currentBuilders + queuedBuilders < desiredBuilders) {
      const needed = desiredBuilders - (currentBuilders + queuedBuilders);
      for (let i = 0; i < needed; i++) {
        const { body } = bestBodyForRole('builder', room.energyCapacityAvailable);
        const req: SpawnRequest = { 
          role: 'builder', 
          body, 
          priority: SpawnConfig.builder.priority, 
          requestedAt: Game.time, 
          fallbackAfter: SpawnConfig.builder.fallbackAfter 
        };
        this.addToQueue(queuePath, req);
      }
    }
  }

  private addToQueue(queuePath: string, req: SpawnRequest) {
    const queue = MemoryManager.get<SpawnRequest[]>(queuePath, []) || [];
    queue.push(req);
    MemoryManager.set(queuePath, queue);
  }

  private processQueue(spawn: StructureSpawn, room: Room, queuePath: string) {
    const queue = (MemoryManager.get<SpawnRequest[]>(queuePath, []) || []).slice();
    if (queue.length === 0 || spawn.spawning) return;

    queue.sort((a, b) => (b.priority || 0) - (a.priority || 0) || (a.requestedAt - b.requestedAt));
    const req = queue[0];

    const result = this.attemptSpawn(spawn, req, room);
    if (result) {
      this.removeFromQueue(queuePath, req);
    }
  }

  private attemptSpawn(spawn: StructureSpawn, req: SpawnRequest, room: Room): boolean {
    const baseName = `spawn_${req.role}_${Game.time}`;
    const name = `${baseName}_${Math.floor(Math.random() * 10000)}`;
    
    const memory: any = { role: req.role };
    if (req.containerId) {
      memory.containerId = req.containerId;
    }
    
    const res = spawn.spawnCreep(req.body, name, { memory });

    if (res === OK) {
      if (req.role === 'miner' && req.containerId) {
        const assignmentsPath = `rooms.${room.name}.minerAssignments`;
        const assignments = MemoryManager.get<Record<string, string>>(assignmentsPath, {}) || {};
        assignments[req.containerId] = name;
        MemoryManager.set(assignmentsPath, assignments);
      }
      return true;
    } else if (res === ERR_NOT_ENOUGH_ENERGY) {
      return this.tryEmergencySpawn(spawn, req, room, baseName);
    } else {
      console.log(`spawnCreep failed: ${res}`);
      return true;
    }
  }

  private tryEmergencySpawn(spawn: StructureSpawn, req: SpawnRequest, room: Room, baseName: string): boolean {
    const age = Game.time - req.requestedAt;
    const fallbackAfter = req.fallbackAfter || 25;
    
    if (age >= fallbackAfter) {
      const emergency = bestBodyForRole(req.role, room.energyAvailable).body;
      const fname = `${baseName}_emg_${Math.floor(Math.random() * 10000)}`;
      
      const memory: any = { role: req.role };
      if (req.containerId) {
        memory.containerId = req.containerId;
      }
      
      const fres = spawn.spawnCreep(emergency, fname, { memory });
      
      if (fres === OK && req.role === 'miner' && req.containerId) {
        const assignmentsPath = `rooms.${room.name}.minerAssignments`;
        const assignments = MemoryManager.get<Record<string, string>>(assignmentsPath, {}) || {};
        assignments[req.containerId] = fname;
        MemoryManager.set(assignmentsPath, assignments);
      }
      
      return fres === OK;
    }
    return false;
  }

  private removeFromQueue(queuePath: string, req: SpawnRequest) {
    const queue = MemoryManager.get<SpawnRequest[]>(queuePath, []) || [];
    const idx = queue.findIndex(r => r.requestedAt === req.requestedAt && r.role === req.role);
    if (idx >= 0) {
      queue.splice(idx, 1);
      MemoryManager.set(queuePath, queue);
    }
  }
}

export const spawnManager = new SpawnManager();
