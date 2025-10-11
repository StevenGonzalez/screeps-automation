import { ROLE_HARVESTER, ROLE_UPGRADER } from "../config/config.roles";
import { runHarvester } from "../roles/role.harvester";
import { runUpgrader } from "../roles/role.upgrader";

export function loop() {
  for (const name in Game.creeps) {
    const creep = Game.creeps[name];
    processCreep(creep);
  }
}

function processCreep(creep: Creep) {
  if (creep.memory.role === ROLE_HARVESTER) {
    runHarvester(creep);
  } else if (creep.memory.role === ROLE_UPGRADER) {
    runUpgrader(creep);
  }
}
