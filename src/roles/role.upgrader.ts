import {
  getSources,
  isCreepFull,
  harvestFromSource,
} from "../services/services.creep";

export function runUpgrader(creep: Creep) {
  if (isCreepFull(creep)) {
    if (creep.upgradeController(creep.room.controller!) === ERR_NOT_IN_RANGE) {
      creep.moveTo(creep.room.controller!);
    }
  } else {
    const sources = getSources(creep.room);
    if (sources.length > 0) {
      harvestFromSource(creep, sources[0]);
    }
  }
}
