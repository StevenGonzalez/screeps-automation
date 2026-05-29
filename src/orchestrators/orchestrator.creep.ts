import {
  ROLE_HARVESTER,
  ROLE_UPGRADER,
  ROLE_BUILDER,
  ROLE_REPAIRER,
  ROLE_MINER,
  ROLE_HAULER,
  ROLE_MINERAL_MINER,
  ROLE_SCOUT,
  ROLE_REMOTE_MINER,
  ROLE_REMOTE_HAULER,
  ROLE_RESERVER,
  ROLE_KNIGHT,
  ROLE_WIZARD,
  ROLE_PALADIN,
  ROLE_CLAIMER,
  ROLE_PIONEER,
  ROLE_CHEMIST,
  ROLE_POWER_ATTACKER,
  ROLE_POWER_HEALER,
  ROLE_POWER_CARRIER,
} from "../config/config.roles";
import { runHarvester } from "../roles/role.harvester";
import { runUpgrader } from "../roles/role.upgrader";
import { runBuilder } from "../roles/role.builder";
import { runRepairer } from "../roles/role.repairer";
import { runMiner } from "../roles/role.miner";
import { runHauler } from "../roles/role.hauler";
import { runMineralMiner } from "../roles/role.mineral_miner";
import { runScout } from "../roles/role.scout";
import { runRemoteMiner } from "../roles/role.remote_miner";
import { runRemoteHauler } from "../roles/role.remote_hauler";
import { runReserver } from "../roles/role.reserver";
import { runKnight } from "../roles/role.knight";
import { runWizard } from "../roles/role.wizard";
import { runPaladin } from "../roles/role.paladin";
import { runClaimer } from "../roles/role.claimer";
import { runPioneer } from "../roles/role.pioneer";
import { runChemist } from "../roles/role.chemist";
import { runPowerAttacker } from "../roles/role.powerattacker";
import { runPowerHealer } from "../roles/role.powerhealer";
import { runPowerCarrier } from "../roles/role.powercarrier";

export function loop() {
  for (const name in Game.creeps) {
    const creep = Game.creeps[name];
    processCreep(creep);
  }
}

function processCreep(creep: Creep) {
  const role = creep.memory.role;

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
  } else if (role === ROLE_MINERAL_MINER) {
    runMineralMiner(creep);
  } else if (role === ROLE_SCOUT) {
    runScout(creep);
  } else if (role === ROLE_REMOTE_MINER) {
    runRemoteMiner(creep);
  } else if (role === ROLE_REMOTE_HAULER) {
    runRemoteHauler(creep);
  } else if (role === ROLE_RESERVER) {
    runReserver(creep);
  } else if (role === ROLE_KNIGHT) {
    runKnight(creep);
  } else if (role === ROLE_WIZARD) {
    runWizard(creep);
  } else if (role === ROLE_PALADIN) {
    runPaladin(creep);
  } else if (role === ROLE_CLAIMER) {
    runClaimer(creep);
  } else if (role === ROLE_PIONEER) {
    runPioneer(creep);
  } else if (role === ROLE_CHEMIST) {
    runChemist(creep);
  } else if (role === ROLE_POWER_ATTACKER) {
    runPowerAttacker(creep);
  } else if (role === ROLE_POWER_HEALER) {
    runPowerHealer(creep);
  } else if (role === ROLE_POWER_CARRIER) {
    runPowerCarrier(creep);
  }
}
