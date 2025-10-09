/**
 * Creep Actions Library
 *
 * Centralized, reusable actions for all creep behaviors.
 * Provides consistent, optimized implementations of common tasks.
 */

/// <reference types="@types/screeps" />

import { CreepPersonality } from "./personality";
import { style } from "../path.styles";

// Extend global interfaces for our custom memory properties
declare global {
  interface CreepMemory {
    role?: string;
    silent?: boolean;
    hasGreeted?: boolean;
    [key: string]: any;
  }
}

export enum ActionResult {
  SUCCESS = "success",
  IN_PROGRESS = "in_progress",
  FAILED = "failed",
  TARGET_NOT_FOUND = "target_not_found",
  NO_CAPACITY = "no_capacity",
  NO_RESOURCES = "no_resources",
}

export interface ActionOptions {
  visualizePathStyle?: PolyStyle;
  reusePath?: number;
  serializeMemory?: boolean;
  maxOps?: number;
  heuristicWeight?: number;
  maxRooms?: number;
  silent?: boolean; // Option to suppress creep speech
}

export class CreepActions {
  /**
   * Move to a target position or object with optimal pathfinding
   */
  static moveTo(
    creep: Creep,
    target: RoomPosition | { pos: RoomPosition },
    options: ActionOptions = {}
  ): ActionResult {
    const defaultOptions: ActionOptions = {
      visualizePathStyle: style("move"),
      reusePath: 10,
      serializeMemory: true,
      maxOps: 4000,
      heuristicWeight: 1.2,
    };

    const moveOptions = { ...defaultOptions, ...options };

    try {
      const result = creep.moveTo(target, moveOptions);

      switch (result) {
        case OK:
          return ActionResult.IN_PROGRESS;
        case ERR_NO_PATH:
        case ERR_INVALID_TARGET:
          return ActionResult.FAILED;
        case ERR_TIRED:
          return ActionResult.IN_PROGRESS;
        default:
          return ActionResult.FAILED;
      }
    } catch (error) {
      console.log(`MoveTo error for ${creep.name}: ${error}`);
      return ActionResult.FAILED;
    }
  }

  /**
   * Harvest from a source with optimal positioning and error handling
   */
  static harvestSource(
    creep: Creep,
    sourceId: string,
    options: ActionOptions = {}
  ): ActionResult {
    const source = Game.getObjectById<Source>(sourceId);

    if (!source) {
      return ActionResult.TARGET_NOT_FOUND;
    }

    // Check if creep is full
    if (creep.store.getFreeCapacity() === 0) {
      return ActionResult.NO_CAPACITY;
    }

    // Check if source has energy
    if (source.energy === 0) {
      return ActionResult.NO_RESOURCES;
    }

    const result = creep.harvest(source);

    switch (result) {
      case OK:
        // Creep speaks when successfully harvesting
        if (!options.silent) {
          CreepPersonality.speak(creep, "harvest");
        }
        return ActionResult.SUCCESS;
      case ERR_NOT_IN_RANGE:
        this.moveTo(creep, source, { visualizePathStyle: style("harvest") });
        if (!options.silent && Math.random() < 0.1) {
          CreepPersonality.speak(creep, "move");
        }
        return ActionResult.IN_PROGRESS;
      case ERR_NOT_ENOUGH_RESOURCES:
        return ActionResult.NO_RESOURCES;
      case ERR_NOT_OWNER:
      case ERR_BUSY:
      case ERR_INVALID_TARGET:
        return ActionResult.FAILED;
      default:
        return ActionResult.FAILED;
    }
  }

  /**
   * Transfer resources to a structure with smart targeting
   */
  static transferToStructure(
    creep: Creep,
    structureId: string,
    resourceType: ResourceConstant = RESOURCE_ENERGY,
    amount?: number,
    options: ActionOptions = {}
  ): ActionResult {
    const structure = Game.getObjectById<AnyStoreStructure>(structureId);

    if (!structure) {
      return ActionResult.TARGET_NOT_FOUND;
    }

    // Check if creep has resources
    if (creep.store[resourceType] === 0) {
      return ActionResult.NO_RESOURCES;
    }

    // Check if structure has capacity
    if (structure.store.getFreeCapacity(resourceType) === 0) {
      return ActionResult.NO_CAPACITY;
    }

    const result = creep.transfer(structure, resourceType, amount);

    switch (result) {
      case OK:
        if (!options.silent) {
          CreepPersonality.speak(creep, "transfer");
        }
        return ActionResult.SUCCESS;
      case ERR_NOT_IN_RANGE:
        this.moveTo(creep, structure, {
          visualizePathStyle: style("transfer"),
        });
        return ActionResult.IN_PROGRESS;
      case ERR_FULL:
        return ActionResult.NO_CAPACITY;
      case ERR_NOT_ENOUGH_RESOURCES:
        return ActionResult.NO_RESOURCES;
      case ERR_INVALID_TARGET:
      case ERR_INVALID_ARGS:
        return ActionResult.FAILED;
      default:
        return ActionResult.FAILED;
    }
  }

  /**
   * Withdraw resources from a structure
   */
  static withdrawFromStructure(
    creep: Creep,
    structureId: string,
    resourceType: ResourceConstant = RESOURCE_ENERGY,
    amount?: number,
    options: ActionOptions = {}
  ): ActionResult {
    const structure = Game.getObjectById<AnyStoreStructure>(structureId);

    if (!structure) {
      return ActionResult.TARGET_NOT_FOUND;
    }

    // Check if creep has capacity
    if (creep.store.getFreeCapacity(resourceType) === 0) {
      return ActionResult.NO_CAPACITY;
    }

    // Check if structure has resources
    if (structure.store[resourceType] === 0) {
      return ActionResult.NO_RESOURCES;
    }

    const result = creep.withdraw(structure, resourceType, amount);

    switch (result) {
      case OK:
        if (!options.silent) {
          CreepPersonality.speak(creep, "withdraw");
        }
        return ActionResult.SUCCESS;
      case ERR_NOT_IN_RANGE:
        this.moveTo(creep, structure, {
          visualizePathStyle: style("withdraw"),
        });
        return ActionResult.IN_PROGRESS;
      case ERR_FULL:
        return ActionResult.NO_CAPACITY;
      case ERR_NOT_ENOUGH_RESOURCES:
        return ActionResult.NO_RESOURCES;
      default:
        return ActionResult.FAILED;
    }
  }

  /**
   * Build a construction site with optimal positioning
   */
  static buildStructure(
    creep: Creep,
    constructionSiteId: string,
    options: ActionOptions = {}
  ): ActionResult {
    const site = Game.getObjectById<ConstructionSite>(constructionSiteId);

    if (!site) {
      return ActionResult.TARGET_NOT_FOUND;
    }

    // Check if creep has energy
    if (creep.store.energy === 0) {
      return ActionResult.NO_RESOURCES;
    }

    const result = creep.build(site);

    switch (result) {
      case OK:
        // Celebrate building progress
        if (!options.silent) {
          CreepPersonality.speak(creep, "build");
        }
        return ActionResult.SUCCESS;
      case ERR_NOT_IN_RANGE:
        this.moveTo(creep, site, { visualizePathStyle: style("build") });
        return ActionResult.IN_PROGRESS;
      case ERR_NOT_ENOUGH_RESOURCES:
        return ActionResult.NO_RESOURCES;
      case ERR_INVALID_TARGET:
        return ActionResult.TARGET_NOT_FOUND;
      default:
        return ActionResult.FAILED;
    }
  }

  /**
   * Repair a structure with damage priority
   */
  static repairStructure(
    creep: Creep,
    structureId: string,
    options: ActionOptions = {}
  ): ActionResult {
    const structure = Game.getObjectById<Structure>(structureId);

    if (!structure) {
      return ActionResult.TARGET_NOT_FOUND;
    }

    // Check if creep has energy
    if (creep.store.energy === 0) {
      return ActionResult.NO_RESOURCES;
    }

    // Check if structure needs repair
    if (structure.hits === structure.hitsMax) {
      return ActionResult.SUCCESS;
    }

    const result = creep.repair(structure);

    switch (result) {
      case OK:
        if (!options.silent) {
          CreepPersonality.speak(creep, "repair");
        }
        return ActionResult.SUCCESS;
      case ERR_NOT_IN_RANGE:
        this.moveTo(creep, structure, { visualizePathStyle: style("repair") });
        return ActionResult.IN_PROGRESS;
      case ERR_NOT_ENOUGH_RESOURCES:
        return ActionResult.NO_RESOURCES;
      case ERR_INVALID_TARGET:
        return ActionResult.TARGET_NOT_FOUND;
      default:
        return ActionResult.FAILED;
    }
  }

  /**
   * Upgrade room controller with optimal positioning
   */
  static upgradeController(
    creep: Creep,
    controllerId: string,
    options: ActionOptions = {}
  ): ActionResult {
    const controller = Game.getObjectById<StructureController>(controllerId);

    if (!controller) {
      return ActionResult.TARGET_NOT_FOUND;
    }

    // Check if creep has energy
    if (creep.store.energy === 0) {
      return ActionResult.NO_RESOURCES;
    }

    const result = creep.upgradeController(controller);

    switch (result) {
      case OK:
        if (!options.silent) {
          CreepPersonality.speak(creep, "upgrade");
        }
        return ActionResult.SUCCESS;
      case ERR_NOT_IN_RANGE:
        this.moveTo(creep, controller, {
          visualizePathStyle: style("upgrade"),
        });
        return ActionResult.IN_PROGRESS;
      case ERR_NOT_ENOUGH_RESOURCES:
        return ActionResult.NO_RESOURCES;
      case ERR_INVALID_TARGET:
        return ActionResult.TARGET_NOT_FOUND;
      default:
        return ActionResult.FAILED;
    }
  }

  /**
   * Attack a target with optimal positioning and body part efficiency
   */
  static attackTarget(
    creep: Creep,
    targetId: string,
    options: ActionOptions = {}
  ): ActionResult {
    const target = Game.getObjectById<Creep | Structure>(targetId);

    if (!target) {
      return ActionResult.TARGET_NOT_FOUND;
    }

    // Check if creep has attack parts
    if (!creep.body.some((part) => part.type === ATTACK)) {
      return ActionResult.FAILED;
    }

    const result = creep.attack(target);

    switch (result) {
      case OK:
        if (!options.silent) {
          CreepPersonality.speak(creep, "attack");
        }
        return ActionResult.SUCCESS;
      case ERR_NOT_IN_RANGE:
        this.moveTo(creep, target, { visualizePathStyle: style("attack") });
        return ActionResult.IN_PROGRESS;
      case ERR_INVALID_TARGET:
        return ActionResult.TARGET_NOT_FOUND;
      default:
        return ActionResult.FAILED;
    }
  }

  /**
   * Heal a target (creep) with optimal positioning
   */
  static healTarget(
    creep: Creep,
    targetId: string,
    options: ActionOptions = {}
  ): ActionResult {
    const target = Game.getObjectById<Creep>(targetId);

    if (!target) {
      return ActionResult.TARGET_NOT_FOUND;
    }

    // Check if creep has heal parts
    if (!creep.body.some((part) => part.type === HEAL)) {
      return ActionResult.FAILED;
    }

    // Check if target needs healing
    if (target.hits === target.hitsMax) {
      return ActionResult.SUCCESS;
    }

    const result = creep.heal(target);

    switch (result) {
      case OK:
        if (!options.silent) {
          CreepPersonality.speak(creep, "heal");
        }
        return ActionResult.SUCCESS;
      case ERR_NOT_IN_RANGE:
        // Try ranged heal first
        const rangedResult = creep.rangedHeal(target);
        if (rangedResult === OK) {
          if (!options.silent) {
            CreepPersonality.speak(creep, "heal");
          }
          return ActionResult.SUCCESS;
        }

        this.moveTo(creep, target, { visualizePathStyle: style("heal") });
        return ActionResult.IN_PROGRESS;
      case ERR_INVALID_TARGET:
        return ActionResult.TARGET_NOT_FOUND;
      default:
        return ActionResult.FAILED;
    }
  }

  /**
   * Find and move to the nearest structure of a given type
   */
  static findAndMoveTo(
    creep: Creep,
    structureType: StructureConstant,
    filter?: (structure: Structure) => boolean
  ): { result: ActionResult; target?: Structure } {
    const structures = creep.room.find(FIND_STRUCTURES, {
      filter: (s: Structure) => {
        return s.structureType === structureType && (!filter || filter(s));
      },
    });

    if (structures.length === 0) {
      return { result: ActionResult.TARGET_NOT_FOUND };
    }

    const target = creep.pos.findClosestByRange(structures);
    if (!target) {
      return { result: ActionResult.TARGET_NOT_FOUND };
    }

    const moveResult = this.moveTo(creep, target);
    return { result: moveResult, target };
  }

  /**
   * Smart energy collection - finds best source based on availability and distance
   */
  static collectEnergy(creep: Creep): ActionResult {
    // Priority: Containers > Storage > Terminal > Sources

    // 1. Try containers with energy
    const containers = creep.room.find(FIND_STRUCTURES, {
      filter: (s: StructureContainer) =>
        s.structureType === STRUCTURE_CONTAINER && s.store.energy > 0,
    }) as StructureContainer[];

    if (containers.length > 0) {
      const container = creep.pos.findClosestByRange(containers);
      if (container) {
        return this.withdrawFromStructure(creep, container.id);
      }
    }

    // 2. Try storage
    const storage = creep.room.storage;
    if (storage && storage.store.energy > 100) {
      return this.withdrawFromStructure(creep, storage.id);
    }

    // 3. Try terminal
    const terminal = creep.room.terminal;
    if (terminal && terminal.store.energy > 100) {
      return this.withdrawFromStructure(creep, terminal.id);
    }

    // 4. Fallback to sources
    const sources = creep.room.find(FIND_SOURCES, {
      filter: (s: Source) => s.energy > 0,
    });

    if (sources.length > 0) {
      const source = creep.pos.findClosestByRange(sources);
      if (source) {
        return this.harvestSource(creep, source.id);
      }
    }

    return ActionResult.NO_RESOURCES;
  }

  /**
   * Smart energy delivery - finds best target based on priority and capacity
   */
  static deliverEnergy(creep: Creep): ActionResult {
    // Priority: Spawns/Extensions > Towers > Storage > Terminal

    // 1. Fill spawns and extensions first
    const energyStructures = creep.room.find(FIND_STRUCTURES, {
      filter: (s: StructureSpawn | StructureExtension) =>
        (s.structureType === STRUCTURE_SPAWN ||
          s.structureType === STRUCTURE_EXTENSION) &&
        s.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
    });

    if (energyStructures.length > 0) {
      const target = creep.pos.findClosestByRange(energyStructures);
      if (target) {
        return this.transferToStructure(creep, target.id);
      }
    }

    // 2. Fill towers (if below 50% capacity)
    const towers = creep.room.find(FIND_STRUCTURES, {
      filter: (s: StructureTower) =>
        s.structureType === STRUCTURE_TOWER &&
        s.store.getFreeCapacity(RESOURCE_ENERGY) >
          s.store.getCapacity(RESOURCE_ENERGY) * 0.5,
    });

    if (towers.length > 0) {
      const tower = creep.pos.findClosestByRange(towers);
      if (tower) {
        return this.transferToStructure(creep, tower.id);
      }
    }

    // 3. Fill storage
    const storage = creep.room.storage;
    if (storage && storage.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
      return this.transferToStructure(creep, storage.id);
    }

    // 4. Fill terminal
    const terminal = creep.room.terminal;
    if (terminal && terminal.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
      return this.transferToStructure(creep, terminal.id);
    }

    return ActionResult.NO_CAPACITY;
  }

  /**
   * Flee from hostile creeps to the nearest safe position
   */
  static fleeFromHostiles(creep: Creep): ActionResult {
    const hostiles = creep.pos.findInRange(FIND_HOSTILE_CREEPS, 5);

    if (hostiles.length === 0) {
      return ActionResult.SUCCESS;
    }

    // Find safe positions away from hostiles
    const terrain = creep.room.getTerrain();
    const safePositions: RoomPosition[] = [];

    for (let x = 1; x < 49; x++) {
      for (let y = 1; y < 49; y++) {
        if (terrain.get(x, y) !== TERRAIN_MASK_WALL) {
          const pos = new RoomPosition(x, y, creep.room.name);
          const nearbyHostiles = pos.findInRange(FIND_HOSTILE_CREEPS, 3);

          if (nearbyHostiles.length === 0) {
            safePositions.push(pos);
          }
        }
      }
    }

    if (safePositions.length === 0) {
      return ActionResult.FAILED;
    }

    const safePos = creep.pos.findClosestByRange(safePositions);
    if (safePos) {
      // Creep panics when fleeing
      CreepPersonality.speak(creep, "flee", true); // Force speech when fleeing
      return this.moveTo(creep, safePos, { visualizePathStyle: style("flee") });
    }

    return ActionResult.FAILED;
  }

  /**
   * Enhanced run method that includes personality updates
   * Call this for each creep every tick to add personality
   */
  static runWithPersonality(creep: Creep, actionCallback: () => void): void {
    // Execute the creep's main action
    actionCallback();

    // Add contextual personality
    CreepPersonality.contextualSpeak(creep);

    // Handle spawn greeting (first few ticks)
    if (
      !creep.memory.hasGreeted &&
      creep.ticksToLive &&
      creep.ticksToLive > 1495
    ) {
      const greeting = CreepPersonality.getSpawnPhrase(
        creep.memory.role || "worker"
      );
      creep.say(greeting, true);
      creep.memory.hasGreeted = true;
    }
  }

  /**
   * Quick utility to make any creep celebrate
   */
  static makeCreepCelebrate(creep: Creep, achievement?: string): void {
    if (achievement) {
      CreepPersonality.celebrate(creep, achievement);
    } else {
      CreepPersonality.speak(creep, "celebrate", true);
    }
  }

  /**
   * Set a creep to silent mode (no speech)
   */
  static setSilent(creep: Creep, silent = true): void {
    creep.memory.silent = silent;
  }

  /**
   * Get speech statistics for all creeps
   */
  static getSpeechStats(): { speaking: number; silent: number; total: number } {
    let speaking = 0;
    let silent = 0;

    for (const creepName in Game.creeps) {
      const creep = Game.creeps[creepName];
      if (creep.memory.silent) {
        silent++;
      } else {
        speaking++;
      }
    }

    return { speaking, silent, total: speaking + silent };
  }
}
