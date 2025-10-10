import {
  getClosestSpawn,
  getSources,
  harvestFromSource,
  isCreepFull,
  transferEnergyTo,
} from "../services/creep";

export function runHarvester(creep: Creep) {
  if (isCreepFull(creep)) {
    const spawn = getClosestSpawn(creep.room, creep.pos);
    if (spawn) {
      transferEnergyTo(creep, spawn);
    }
  } else {
    const sources = getSources(creep.room);
    harvestFromSource(creep, sources[0]);
  }
}
