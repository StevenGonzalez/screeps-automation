export const SpawnConfig = {
  maxHarvestersPerSource: 2,
  harvesterEnergyStep: 300,

  upgrader: {
    energyThreshold1: 300,
    energyThreshold2: 550,
    priority: 40,
    fallbackAfter: 25,
    minToWorkFraction: 0.5,
  },

  builder: {
    sitesPerBuilder: 3,
    maxBuilders: 3,
    priority: 30,
    fallbackAfter: 25,
    minToWorkFraction: 0.5,
  },

  repairer: {
    criticalThreshold: 0.9,  // Start repairing critical structures at 90% (was 75%)
    generalThreshold: 0.7,   // Start repairing general structures at 70% (was 50%)
    minRampartHits: 10000,   // Emergency threshold for ramparts
    maxRampartHits: 100000,  // Keep ramparts topped off to 100k (was 50k)
    repairRoads: true,
    repairContainers: true,
    priority: 35,
    fallbackAfter: 25,
    minToWorkFraction: 0.5,
    maxRepairers: 2,
    minDamagedStructures: 1, // Spawn repairer if even 1 structure needs work (was 3)
  },

  queue: {
    defaultFallbackAfter: 25,
  },
};

export default { SpawnConfig };
