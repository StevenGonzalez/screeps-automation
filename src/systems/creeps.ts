import { ROLE_HARVESTER } from "../config/roles";
import { runHarvester } from "../roles/harvester";

export function loop() {
  for (const name in Game.creeps) {
    const creep = Game.creeps[name];
    processCreep(creep);
  }
}

function processCreep(creep: Creep) {
  if (creep.memory.role === ROLE_HARVESTER) {
    runHarvester(creep);
  }
}
