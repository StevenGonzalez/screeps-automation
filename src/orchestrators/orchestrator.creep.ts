import {
  ROLE_HARVESTER,
  ROLE_UPGRADER,
  ROLE_BUILDER,
  ROLE_REPAIRER,
  ROLE_MINER,
  ROLE_HAULER,
  normalizeRole,
} from "../config/config.roles";
import { runHarvester } from "../roles/role.harvester";
import { runUpgrader } from "../roles/role.upgrader";
import { runBuilder } from "../roles/role.builder";
import { runRepairer } from "../roles/role.repairer";
import { runMiner } from "../roles/role.miner";
import { runHauler } from "../roles/role.hauler";

export function loop() {
  for (const name in Game.creeps) {
    const creep = Game.creeps[name];
    processCreep(creep);
  }
}

function processCreep(creep: Creep) {
  const role = normalizeRole(creep.memory.role);
  if (role && creep.memory.role !== role) {
    creep.memory.role = role;
  }

  if (role === ROLE_HARVESTER) {
    runHarvester(creep);
  } else if (role === ROLE_UPGRADER) {
    runUpgrader(creep);
  } else if (role === ROLE_BUILDER) {
    runBuilder(creep);
  } else if (role === ROLE_REPAIRER) {
    runRepairer(creep);
  } else if (role === ROLE_MINER) {
    runMiner(creep);
  } else if (role === ROLE_HAULER) {
    runHauler(creep);
  }
}
