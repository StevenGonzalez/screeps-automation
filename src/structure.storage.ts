/**
 * Storage Structure Management
 *
 * Handles intelligent storage operations including energy distribution,
 * resource balancing, and integration with room logistics.
 */

/// <reference types="@types/screeps" />

/**
 * Manage all storage structures in a room
 */
export function manageStorageStructures(room: Room): StorageStatus {
  const storages = room.find(FIND_MY_STRUCTURES, {
    filter: (s) => s.structureType === STRUCTURE_STORAGE,
  }) as StructureStorage[];

  const containers = room.find(FIND_STRUCTURES, {
    filter: (s) => s.structureType === STRUCTURE_CONTAINER,
  }) as StructureContainer[];

  if (storages.length === 0 && containers.length === 0) {
    return {
      totalEnergy: 0,
      totalCapacity: 0,
      fillRatio: 0,
      needsWithdrawal: [],
      needsDeposit: [],
      distributionPlan: null,
    };
  }

  const status = analyzeStorageStatus(storages, containers);

  // Execute storage operations
  if (storages.length > 0) {
    executeStorageLogistics(storages[0], room, status);
  }

  // Manage container operations
  manageContainers(containers, room, status);

  return status;
}

/**
 * Analyze current storage status and needs
 */
function analyzeStorageStatus(
  storages: StructureStorage[],
  containers: StructureContainer[]
): StorageStatus {
  let totalEnergy = 0;
  let totalCapacity = 0;
  const needsWithdrawal: StorageStructure[] = [];
  const needsDeposit: StorageStructure[] = [];

  // Analyze main storage
  for (const storage of storages) {
    totalEnergy += storage.store.getUsedCapacity(RESOURCE_ENERGY);
    totalCapacity += storage.store.getCapacity(RESOURCE_ENERGY);

    if (storage.store.getFreeCapacity(RESOURCE_ENERGY) < 50000) {
      needsWithdrawal.push({
        structure: storage,
        priority: "high",
        resourceType: RESOURCE_ENERGY,
        amount: storage.store.getUsedCapacity(RESOURCE_ENERGY) * 0.2,
      });
    }

    if (storage.store.getUsedCapacity(RESOURCE_ENERGY) > 100000) {
      needsDeposit.push({
        structure: storage,
        priority: "low",
        resourceType: RESOURCE_ENERGY,
        amount: 50000,
      });
    }
  }

  // Analyze containers
  for (const container of containers) {
    totalEnergy += container.store.getUsedCapacity(RESOURCE_ENERGY);
    totalCapacity += container.store.getCapacity(RESOURCE_ENERGY);

    const fillRatio =
      container.store.getUsedCapacity(RESOURCE_ENERGY) /
      container.store.getCapacity(RESOURCE_ENERGY);

    if (fillRatio > 0.9) {
      needsWithdrawal.push({
        structure: container,
        priority: "medium",
        resourceType: RESOURCE_ENERGY,
        amount: container.store.getUsedCapacity(RESOURCE_ENERGY) * 0.5,
      });
    }

    if (fillRatio < 0.3 && isSourceContainer(container)) {
      needsDeposit.push({
        structure: container,
        priority: "high",
        resourceType: RESOURCE_ENERGY,
        amount: container.store.getFreeCapacity(RESOURCE_ENERGY),
      });
    }
  }

  const distributionPlan = createDistributionPlan(
    storages,
    containers,
    needsWithdrawal,
    needsDeposit
  );

  return {
    totalEnergy,
    totalCapacity,
    fillRatio: totalCapacity > 0 ? totalEnergy / totalCapacity : 0,
    needsWithdrawal,
    needsDeposit,
    distributionPlan,
  };
}

/**
 * Execute storage logistics operations
 */
function executeStorageLogistics(
  storage: StructureStorage,
  room: Room,
  status: StorageStatus
): void {
  // Prioritize filling extensions and spawns
  fillCriticalStructures(storage, room);

  // Balance energy with containers
  balanceContainerEnergy(storage, room, status);

  // Manage overflow to prevent waste
  handleStorageOverflow(storage, room);
}

/**
 * Fill critical structures (spawns, extensions, towers)
 */
function fillCriticalStructures(storage: StructureStorage, room: Room): void {
  if (storage.store.getUsedCapacity(RESOURCE_ENERGY) < 50000) return;

  const criticalStructures = room.find(FIND_MY_STRUCTURES, {
    filter: (s) =>
      (s.structureType === STRUCTURE_EXTENSION ||
        s.structureType === STRUCTURE_SPAWN ||
        s.structureType === STRUCTURE_TOWER) &&
      s.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
  });

  // This creates demand that haulers will fulfill
  if (criticalStructures.length > 0) {
    const throttle = getStorageLogThrottle(room);
    const cooldown = 100; // log at most once per 100 ticks per room
    if (Game.time - throttle.room.criticalStructuresLast >= cooldown) {
      console.log(
        `🏪 Storage: ${criticalStructures.length} structures need energy`
      );
      throttle.room.criticalStructuresLast = Game.time;
    }
  }
}

/**
 * Balance energy between storage and containers
 */
function balanceContainerEnergy(
  storage: StructureStorage,
  room: Room,
  status: StorageStatus
): void {
  const containers = room.find(FIND_STRUCTURES, {
    filter: (s) => s.structureType === STRUCTURE_CONTAINER,
  }) as StructureContainer[];

  for (const container of containers) {
    const fillRatio =
      container.store.getUsedCapacity(RESOURCE_ENERGY) /
      container.store.getCapacity(RESOURCE_ENERGY);

    // Move energy from overfull containers to storage
    if (
      fillRatio > 0.8 &&
      storage.store.getFreeCapacity(RESOURCE_ENERGY) > 10000
    ) {
      // Haulers will handle the actual transfer; throttle repetitive logs
      const state = getContainerLogState(room, container.id);
      const cooldown = 300;
      if (!state.overfull || Game.time - state.lastEmptying >= cooldown) {
        console.log(
          `📦 Container ${container.id} needs emptying (${Math.round(
            fillRatio * 100
          )}% full)`
        );
        state.lastEmptying = Game.time;
      }
      state.overfull = true;
    } else {
      const state = getContainerLogState(room, container.id);
      state.overfull = false;
    }

    // Move energy from storage to underfull source containers
    if (
      fillRatio < 0.2 &&
      isSourceContainer(container) &&
      storage.store.getUsedCapacity(RESOURCE_ENERGY) > 100000
    ) {
      const state = getContainerLogState(room, container.id);
      const cooldown = 300;
      if (!state.needsFill || Game.time - state.lastFilling >= cooldown) {
        console.log(
          `📦 Source container ${container.id} needs filling (${Math.round(
            fillRatio * 100
          )}% full)`
        );
        state.lastFilling = Game.time;
      }
      state.needsFill = true;
    } else if (isSourceContainer(container)) {
      const state = getContainerLogState(room, container.id);
      state.needsFill = false;
    }
  }
}

/**
 * Handle storage overflow situations
 */
function handleStorageOverflow(storage: StructureStorage, room: Room): void {
  const energyRatio =
    storage.store.getUsedCapacity(RESOURCE_ENERGY) /
    storage.store.getCapacity(RESOURCE_ENERGY);

  if (energyRatio > 0.95) {
    const throttle = getStorageLogThrottle(room);
    const cooldown = 300; // avoid spamming while above threshold
    if (
      !throttle.room.overflowActive ||
      Game.time - throttle.room.overflowLast >= cooldown
    ) {
      console.log(
        `🚨 Storage overflow warning! (${Math.round(energyRatio * 100)}% full)`
      );
      throttle.room.overflowLast = Game.time;
    }
    throttle.room.overflowActive = true;

    // Emergency: boost upgrader work if controller isn't maxed
    const controller = room.controller;
    if (controller && controller.level < 8) {
      const boostCooldown = 500;
      if (Game.time - throttle.room.boostLast >= boostCooldown) {
        console.log(`⚡ Boosting controller upgrade due to energy overflow`);
        throttle.room.boostLast = Game.time;
      }
    }
  } else {
    const throttle = getStorageLogThrottle(room);
    throttle.room.overflowActive = false;
  }
}

/**
 * Manage container operations
 */
function manageContainers(
  containers: StructureContainer[],
  room: Room,
  status: StorageStatus
): void {
  for (const container of containers) {
    maintainContainer(container, room);
    optimizeContainerUsage(container, room, status);
  }
}

/**
 * Maintain container health and efficiency
 */
function maintainContainer(container: StructureContainer, room: Room): void {
  // Check if container needs repair with rate-limited logging
  const health = container.hits / Math.max(1, container.hitsMax);
  const log = getContainerRepairLog(room);
  const entry = (log[container.id] as {
    lastLog: number;
    lastHits: number;
  }) || {
    lastLog: 0,
    lastHits: container.hits,
  };

  // Update lastHits baseline if repaired
  if (container.hits > entry.lastHits) entry.lastHits = container.hits;

  // Only log if severely damaged or has dropped significantly since last log, and respect cooldown
  const severeDamage = health <= 0.5; // 50%
  const significantDrop = entry.lastHits - container.hits >= 25000; // 25k hits drop
  const cooldown = severeDamage ? 200 : 600; // shorter cooldown for severe

  if (
    (severeDamage || significantDrop) &&
    Game.time - entry.lastLog >= cooldown
  ) {
    console.log(
      `🔧 Container ${container.id} needs repair (${container.hits}/${container.hitsMax})`
    );
    entry.lastLog = Game.time;
    entry.lastHits = container.hits;
    log[container.id] = entry;
  }

  // Report container efficiency
  const fillRatio =
    container.store.getUsedCapacity() / container.store.getCapacity();
  // Sample this per room, not per container, to reduce spam
  const sampleThrottle = getStorageLogThrottle(room);
  const sampleCooldown = 300;
  if (
    Game.time - sampleThrottle.room.containerFillSampleLast >=
    sampleCooldown
  ) {
    console.log(
      `📊 Container ${container.id}: ${Math.round(fillRatio * 100)}% full`
    );
    sampleThrottle.room.containerFillSampleLast = Game.time;
  }
}

function getContainerRepairLog(room: Room): {
  [id: string]: { lastLog: number; lastHits: number };
} {
  if (!Memory.rooms) Memory.rooms = {} as any;
  if (!Memory.rooms[room.name]) (Memory.rooms as any)[room.name] = {};
  const r = (Memory.rooms as any)[room.name];
  if (!r.storage) r.storage = {};
  if (!r.storage.containerRepairLog) r.storage.containerRepairLog = {};
  return r.storage.containerRepairLog as {
    [id: string]: { lastLog: number; lastHits: number };
  };
}

// Room-level storage log throttles/state
function getStorageLogThrottle(room: Room): any {
  if (!Memory.rooms) Memory.rooms = {} as any;
  if (!Memory.rooms[room.name]) (Memory.rooms as any)[room.name] = {};
  const r = (Memory.rooms as any)[room.name];
  if (!r.storage) r.storage = {};
  if (!r.storage.logThrottle) r.storage.logThrottle = {};
  if (!r.storage.logThrottle.room)
    r.storage.logThrottle.room = {
      criticalStructuresLast: 0,
      overflowLast: 0,
      overflowActive: false,
      boostLast: 0,
      containerFillSampleLast: 0,
    };
  if (!r.storage.logThrottle.containers) r.storage.logThrottle.containers = {};
  return r.storage.logThrottle;
}

// Per-container log state holder (not yet used everywhere)
function getContainerLogState(
  room: Room,
  id: Id<StructureContainer> | string
): any {
  const throttle = getStorageLogThrottle(room);
  if (!throttle.containers[id])
    throttle.containers[id] = {
      lastEmptying: 0,
      lastFilling: 0,
      overfull: false,
      needsFill: false,
      sourceState: "normal" as "full" | "empty" | "normal",
      lastSourceExtrema: 0,
      controllerLow: false,
      lastControllerLow: 0,
    };
  return throttle.containers[id];
}

/**
 * Optimize individual container usage
 */
function optimizeContainerUsage(
  container: StructureContainer,
  room: Room,
  status: StorageStatus
): void {
  const isSource = isSourceContainer(container);
  const isController = isControllerContainer(container);

  if (isSource) {
    manageSourceContainer(container, room);
  } else if (isController) {
    manageControllerContainer(container, room);
  } else {
    manageGeneralContainer(container, room);
  }
}

/**
 * Manage source-adjacent containers
 */
function manageSourceContainer(
  container: StructureContainer,
  room: Room
): void {
  const fillRatio =
    container.store.getUsedCapacity(RESOURCE_ENERGY) /
    container.store.getCapacity(RESOURCE_ENERGY);

  const state = getContainerLogState(room, container.id);
  const prev = state.sourceState || "normal";
  let next: "full" | "empty" | "normal" = "normal";
  if (fillRatio > 0.9) next = "full";
  else if (fillRatio < 0.1) next = "empty";

  if (next !== prev) {
    const cooldown = 300;
    if (Game.time - state.lastSourceExtrema >= cooldown) {
      if (next === "full")
        console.log(`⛏️ Source container full - need more haulers`);
      if (next === "empty")
        console.log(`⛏️ Source container empty - harvesters may be idle`);
      state.lastSourceExtrema = Game.time;
    }
    state.sourceState = next;
  }
}

/**
 * Manage controller-adjacent containers
 */
function manageControllerContainer(
  container: StructureContainer,
  room: Room
): void {
  const fillRatio =
    container.store.getUsedCapacity(RESOURCE_ENERGY) /
    container.store.getCapacity(RESOURCE_ENERGY);

  const state = getContainerLogState(room, container.id);
  const low = fillRatio < 0.3 && room.controller && room.controller.level < 8;
  const cooldown = 300;
  if (low) {
    if (
      !state.controllerLow ||
      Game.time - state.lastControllerLow >= cooldown
    ) {
      console.log(`🏛️ Controller container low - upgraders may idle soon`);
      state.lastControllerLow = Game.time;
    }
    state.controllerLow = true;
  } else {
    state.controllerLow = false;
  }
}

/**
 * Manage general-purpose containers
 */
function manageGeneralContainer(
  container: StructureContainer,
  room: Room
): void {
  // General container logic - could be used for mineral storage, etc.
  const totalUsed = container.store.getUsedCapacity();
  if (totalUsed === 0 && Game.time % 500 === 0) {
    console.log(
      `📦 Empty container at ${container.pos} - consider repositioning`
    );
  }
}

/**
 * Create energy distribution plan
 */
function createDistributionPlan(
  storages: StructureStorage[],
  containers: StructureContainer[],
  withdrawals: StorageStructure[],
  deposits: StorageStructure[]
): DistributionPlan | null {
  if (withdrawals.length === 0 && deposits.length === 0) return null;

  return {
    withdrawalTargets: withdrawals.sort(
      (a, b) => getPriority(b.priority) - getPriority(a.priority)
    ),
    depositTargets: deposits.sort(
      (a, b) => getPriority(b.priority) - getPriority(a.priority)
    ),
    recommendedHaulers: Math.ceil((withdrawals.length + deposits.length) / 3),
  };
}

/**
 * Helper functions
 */
function isSourceContainer(container: StructureContainer): boolean {
  return (
    container.room.find(FIND_SOURCES, {
      filter: (source) => container.pos.isNearTo(source),
    }).length > 0
  );
}

function isControllerContainer(container: StructureContainer): boolean {
  return container.room.controller
    ? container.pos.isNearTo(container.room.controller)
    : false;
}

function getPriority(priority: string): number {
  switch (priority) {
    case "high":
      return 3;
    case "medium":
      return 2;
    case "low":
      return 1;
    default:
      return 0;
  }
}

/**
 * Type definitions
 */
export interface StorageStatus {
  totalEnergy: number;
  totalCapacity: number;
  fillRatio: number;
  needsWithdrawal: StorageStructure[];
  needsDeposit: StorageStructure[];
  distributionPlan: DistributionPlan | null;
}

export interface StorageStructure {
  structure: StructureStorage | StructureContainer;
  priority: "high" | "medium" | "low";
  resourceType: ResourceConstant;
  amount: number;
}

export interface DistributionPlan {
  withdrawalTargets: StorageStructure[];
  depositTargets: StorageStructure[];
  recommendedHaulers: number;
}
