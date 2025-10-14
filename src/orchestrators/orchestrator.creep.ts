import {
  ROLE_HARVESTER,
  ROLE_UPGRADER,
  ROLE_BUILDER,
} from "../config/config.roles";
import { runHarvester } from "../roles/role.harvester";
import { runUpgrader } from "../roles/role.upgrader";
import { runBuilder } from "../roles/role.builder";

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
  } else if (creep.memory.role === ROLE_BUILDER) {
    runBuilder(creep);
  }
}
