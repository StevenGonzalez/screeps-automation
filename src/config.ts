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
    criticalThreshold: 0.75,
    generalThreshold: 0.5,
    minRampartHits: 10000,
    maxRampartHits: 50000,
    repairRoads: true,
    repairContainers: true,
    priority: 35,
    fallbackAfter: 25,
    minToWorkFraction: 0.5,
    maxRepairers: 2,
    minDamagedStructures: 3,
  },

  queue: {
    defaultFallbackAfter: 25,
  },
};

export default { SpawnConfig };
