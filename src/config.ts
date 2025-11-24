// src/config.ts
// Centralized tuning values for spawning and roles

export const SpawnConfig = {
  maxHarvestersPerSource: 2,
  harvesterEnergyStep: 300,

  upgrader: {
    energyThreshold1: 300,
    energyThreshold2: 550,
    priority: 40,
    fallbackAfter: 25,
    // fraction of capacity required before switching from acquiring -> working
    minToWorkFraction: 0.5,
  },

  builder: {
    sitesPerBuilder: 3,
    maxBuilders: 3,
    priority: 30,
    fallbackAfter: 25,
    minToWorkFraction: 0.5,
  },

  queue: {
    defaultFallbackAfter: 25,
  },
};

export default { SpawnConfig };
