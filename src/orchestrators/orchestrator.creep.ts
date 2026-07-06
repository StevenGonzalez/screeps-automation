import {
  ROLE_HARVESTER,
  ROLE_UPGRADER,
  ROLE_BUILDER,
  ROLE_REPAIRER,
  ROLE_MINER,
  ROLE_HAULER,
  ROLE_FILLER,
  ROLE_MINERAL_MINER,
  ROLE_SCOUT,
  ROLE_REMOTE_MINER,
  ROLE_REMOTE_HAULER,
  ROLE_RESERVER,
  ROLE_KNIGHT,
  ROLE_WIZARD,
  ROLE_CLERIC,
  ROLE_SIEGER,
  ROLE_DRAINER,
  ROLE_CONQUEROR,
  ROLE_SETTLER,
  ROLE_APOTHECARY,
  ROLE_POWER_ATTACKER,
  ROLE_POWER_HEALER,
  ROLE_POWER_CARRIER,
  ROLE_DEPOSIT_MINER,
  ROLE_DEPOSIT_HAULER,
  ROLE_SK_GUARDIAN,
  ROLE_SK_MINER,
  ROLE_SK_HAULER,
  ROLE_SCORE_HUNTER,
} from "../config/config.roles";
import { runHarvester } from "../roles/role.harvester";
import { runUpgrader } from "../roles/role.upgrader";
import { runBuilder } from "../roles/role.builder";
import { runRepairer } from "../roles/role.repairer";
import { runMiner } from "../roles/role.miner";
import { runHauler } from "../roles/role.hauler";
import { runFiller } from "../roles/role.filler";
import { runMineralMiner } from "../roles/role.mineral_miner";
import { runScout } from "../roles/role.scout";
import { runRemoteMiner } from "../roles/role.remote_miner";
import { runRemoteHauler } from "../roles/role.remote_hauler";
import { runReserver } from "../roles/role.reserver";
import { runKnight } from "../roles/role.knight";
import { runWizard } from "../roles/role.wizard";
import { runCleric } from "../roles/role.cleric";
import { runSieger } from "../roles/role.sieger";
import { runDrainer } from "../roles/role.drainer";
import { runConqueror } from "../roles/role.conqueror";
import { runSettler } from "../roles/role.settler";
import { runApothecary } from "../roles/role.apothecary";
import { runPowerAttacker } from "../roles/role.powerattacker";
import { runPowerHealer } from "../roles/role.powerhealer";
import { runPowerCarrier } from "../roles/role.powercarrier";
import { runDepositMiner } from "../roles/role.depositminer";
import { runDepositHauler } from "../roles/role.deposithauler";
import { runSkGuardian } from "../roles/role.sk_guardian";
import { runSkMiner } from "../roles/role.sk_miner";
import { runSkHauler } from "../roles/role.sk_hauler";
import { runScoreHunter } from "../roles/role.scoreHunter";
import { resolveTraffic } from "../services/services.movement";
import { recordRole } from "../services/services.profiler";

const ROLE_HANDLERS: Record<string, (creep: Creep) => void> = {
  [ROLE_HARVESTER]: runHarvester,
  [ROLE_UPGRADER]: runUpgrader,
  [ROLE_BUILDER]: runBuilder,
  [ROLE_REPAIRER]: runRepairer,
  [ROLE_MINER]: runMiner,
  [ROLE_HAULER]: runHauler,
  [ROLE_FILLER]: runFiller,
  [ROLE_MINERAL_MINER]: runMineralMiner,
  [ROLE_SCOUT]: runScout,
  [ROLE_REMOTE_MINER]: runRemoteMiner,
  [ROLE_REMOTE_HAULER]: runRemoteHauler,
  [ROLE_RESERVER]: runReserver,
  [ROLE_KNIGHT]: runKnight,
  [ROLE_WIZARD]: runWizard,
  [ROLE_CLERIC]: runCleric,
  [ROLE_SIEGER]: runSieger,
  [ROLE_DRAINER]: runDrainer,
  [ROLE_CONQUEROR]: runConqueror,
  [ROLE_SETTLER]: runSettler,
  [ROLE_APOTHECARY]: runApothecary,
  [ROLE_POWER_ATTACKER]: runPowerAttacker,
  [ROLE_POWER_HEALER]: runPowerHealer,
  [ROLE_POWER_CARRIER]: runPowerCarrier,
  [ROLE_DEPOSIT_MINER]: runDepositMiner,
  [ROLE_DEPOSIT_HAULER]: runDepositHauler,
  [ROLE_SK_GUARDIAN]: runSkGuardian,
  [ROLE_SK_MINER]: runSkMiner,
  [ROLE_SK_HAULER]: runSkHauler,
  [ROLE_SCORE_HUNTER]: runScoreHunter,
};

const GENERAL_CHATTER = ["capisce?", "just biz", "nothin'", "fuhgeddit", "respect", "you square"];
const ROLE_CHATTER: Record<string, string[]> = {
  [ROLE_KNIGHT]: ["*cracks*", "boss says", "break it", "knuckles"],
  [ROLE_WIZARD]: ["from here", "pop pop", "no witness"],
  [ROLE_CLERIC]: ["hold still", "patch up", "breathe"],
  [ROLE_SIEGER]: ["wreckin'", "open up", "demo time"],
  [ROLE_DRAINER]: ["hey ugly", "over here", "catch me"],
  [ROLE_CONQUEROR]: ["ours now", "moving in", "new turf"],
  [ROLE_SETTLER]: ["new joint", "settin' up", "our block"],
  [ROLE_HAULER]: ["the goods", "the drop", "cash run"],
  [ROLE_UPGRADER]: ["laundry", "clean cash", "washin'"],
  [ROLE_MINER]: ["diggin'", "the vein"],
  [ROLE_RESERVER]: ["protection", "we collect"],
};

const SAY_PERIOD = 30;
function maybeChatter(creep: Creep): void {
  let hash = 0;
  for (let i = 0; i < creep.name.length; i++) hash = (hash + creep.name.charCodeAt(i)) | 0;
  if ((Game.time + hash) % SAY_PERIOD !== 0) return;
  const lines = ROLE_CHATTER[creep.memory.role] ?? GENERAL_CHATTER;
  const eventNo = (Game.time + hash) / SAY_PERIOD;
  creep.say(lines[Math.abs(eventNo + hash) % lines.length], true);
}

export function loop() {
  const profile = Memory.profileRoles === true;
  for (const name in Game.creeps) {
    const creep = Game.creeps[name];
    if (creep.spawning) continue;
    const handler = ROLE_HANDLERS[creep.memory.role];
    if (handler) {
      if (profile) {
        const start = Game.cpu.getUsed();
        handler(creep);
        recordRole(creep.memory.role, Game.cpu.getUsed() - start);
      } else {
        handler(creep);
      }
      maybeChatter(creep);
    } else if (Game.time % 100 === 0) {
      console.log(`[creep] no handler for role "${creep.memory.role}" on ${name}`);
    }
  }
  resolveTraffic();
}
