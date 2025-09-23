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
    console.log(
      `🏪 Storage: ${criticalStructures.length} structures need energy`
    );
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
      // Haulers will handle the actual transfer
      console.log(
        `📦 Container ${container.id} needs emptying (${Math.round(
          fillRatio * 100
        )}% full)`
      );
    }

    // Move energy from storage to underfull source containers
    if (
      fillRatio < 0.2 &&
      isSourceContainer(container) &&
      storage.store.getUsedCapacity(RESOURCE_ENERGY) > 100000
    ) {
      console.log(
        `📦 Source container ${container.id} needs filling (${Math.round(
          fillRatio * 100
        )}% full)`
      );
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
    console.log(
      `🚨 Storage overflow warning! (${Math.round(energyRatio * 100)}% full)`
    );

    // Emergency: boost upgrader work if controller isn't maxed
    const controller = room.controller;
    if (controller && controller.level < 8) {
      console.log(`⚡ Boosting controller upgrade due to energy overflow`);
    }
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
  // Check if container needs repair
  if (container.hits < container.hitsMax * 0.8) {
    console.log(
      `🔧 Container ${container.id} needs repair (${container.hits}/${container.hitsMax})`
    );
  }

  // Report container efficiency
  const fillRatio =
    container.store.getUsedCapacity() / container.store.getCapacity();
  if (Game.time % 100 === 0) {
    // Report every 100 ticks
    console.log(
      `📊 Container ${container.id}: ${Math.round(fillRatio * 100)}% full`
    );
  }
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

  if (fillRatio > 0.9) {
    console.log(`⛏️ Source container full - need more haulers`);
  }

  if (fillRatio < 0.1) {
    console.log(`⛏️ Source container empty - harvesters may be idle`);
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

  if (fillRatio < 0.3 && room.controller && room.controller.level < 8) {
    console.log(`🏛️ Controller container low - upgraders may idle soon`);
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
