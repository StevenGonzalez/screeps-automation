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
  ROLE_UNCLAIMER,
  ROLE_TOWNSFOLK,
  ROLE_MINSTREL,
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
import { runUnclaimer } from "../roles/role.unclaimer";
import { runTownsfolk } from "../roles/role.townsfolk";
import { runMinstrel } from "../roles/role.minstrel";
import { resolveTraffic, shelterFromHostiles } from "../services/services.movement";
import { recordRole } from "../services/services.profiler";
import { cryFor, heraldRooms } from "../services/services.herald";
import { townFeast, townSeason, townStorm } from "../services/services.town";
import { TownSeason } from "../config/config.town";

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
  [ROLE_UNCLAIMER]: runUnclaimer,
  [ROLE_TOWNSFOLK]: runTownsfolk,
  [ROLE_MINSTREL]: runMinstrel,
};

// creep.say shows at most 10 characters, so every line fits in 10.
const GENERAL_CHATTER = ["for Crown!", "gold?", "huzzah!", "long live!", "ale later", "hark!", "onward!", "dragons?!"];
const ROLE_CHATTER: Record<string, string[]> = {
  [ROLE_MINER]: ["dig dig", "gold vein!", "rock+stone"],
  [ROLE_HARVESTER]: ["new here", "spiders!", "rats?!"],
  [ROLE_HAULER]: ["make way", "heavy!", "gold run"],
  [ROLE_FILLER]: ["ale's up!", "refilled", "tavern!"],
  [ROLE_UPGRADER]: ["by runes", "it glows!", "Crown +1"],
  [ROLE_BUILDER]: ["stone up", "mortar!", "new wall"],
  [ROLE_REPAIRER]: ["clang!", "mended", "anvil!"],
  [ROLE_MINERAL_MINER]: ["gems!", "rare ore", "shiny!"],
  [ROLE_SCOUT]: ["caw!", "caw caw", "I see you"],
  [ROLE_REMOTE_MINER]: ["fine ore!", "good rates", "for sale!"],
  [ROLE_REMOTE_HAULER]: ["gold only", "fair trade", "wares!"],
  [ROLE_RESERVER]: ["by decree", "king's law", "claimed"],
  [ROLE_KNIGHT]: ["for Crown!", "Have at ye", "no mercy"],
  [ROLE_WIZARD]: ["Burn!", "Hexed!", "Doom!"],
  [ROLE_CLERIC]: ["heal!", "blessed!", "stay close"],
  [ROLE_SIEGER]: ["smash!", "ram it!", "wall down"],
  [ROLE_DRAINER]: ["hit me!", "over here!", "tanking"],
  [ROLE_CONQUEROR]: ["kneel!", "my castle", "bow!"],
  [ROLE_UNCLAIMER]: ["begone!", "usurped", "no king!"],
  [ROLE_SETTLER]: ["new home!", "long road", "finally!"],
  [ROLE_TOWNSFOLK]: ["warm bread", "nice day", "hail Arca!", "tax again?", "gold up"],
  [ROLE_MINSTREL]: ["encore!", "a coin?", "♪ tra la ♪"],
};

// Every creep talks of the weather now and then, and of the feast on a feast day.
const SEASON_CHATTER: Record<TownSeason, string[]> = {
  spring: ["fresh air", "rain again", "blossoms"],
  summer: ["hot!", "thirsty", "sunburnt"],
  autumn: ["leaves!", "chilly", "harvest!"],
  winter: ["brr!", "cold feet", "snow!"],
};
const FEAST_CHATTER = ["feast!", "ale!", "fair day!"];
const STORM_CHATTER = ["rain!", "soaked!", "thunder!"];
const WEATHER_EVERY = 4;

const SAY_PERIOD = 30;

// What a creep says this tick unprompted, if anything: a line every
// SAY_PERIOD ticks, staggered by name so the room does not speak at once.
export function chatterLine(creep: Creep): string | undefined {
  let hash = 0;
  for (let i = 0; i < creep.name.length; i++) hash = (hash + creep.name.charCodeAt(i)) | 0;
  if ((Game.time + hash) % SAY_PERIOD !== 0) return undefined;
  const eventNo = (Game.time + hash) / SAY_PERIOD;
  const pick = Math.abs(eventNo + hash);
  if (pick % WEATHER_EVERY === 0) {
    const weather = townFeast(Game.time)
      ? FEAST_CHATTER
      : townStorm(Game.time)
        ? STORM_CHATTER
        : SEASON_CHATTER[townSeason(Game.time)];
    return weather[(pick / WEATHER_EVERY) % weather.length];
  }
  const lines = ROLE_CHATTER[creep.memory.role] ?? GENERAL_CHATTER;
  return lines[pick % lines.length];
}

function maybeChatter(creep: Creep): void {
  const line = cryFor(creep) ?? chatterLine(creep);
  if (line) creep.say(line, true);
}

export function loop() {
  const profile = Memory.profileRoles === true;
  heraldRooms();
  for (const name in Game.creeps) {
    const creep = Game.creeps[name];
    if (creep.spawning) continue;
    const handler = ROLE_HANDLERS[creep.memory.role];
    if (handler) {
      try {
        if (profile) {
          const start = Game.cpu.getUsed();
          if (!shelterFromHostiles(creep)) handler(creep);
          recordRole(creep.memory.role, Game.cpu.getUsed() - start);
        } else if (!shelterFromHostiles(creep)) {
          handler(creep);
        }
        maybeChatter(creep);
      } catch (e: unknown) {
        const msg = e instanceof Error ? `${e.message}\n${e.stack}` : String(e);
        console.log(`[ERROR] Creep ${name} (${creep.memory.role}) threw: ${msg}`);
      }
    } else if (Game.time % 100 === 0) {
      console.log(`[creep] no handler for role "${creep.memory.role}" on ${name}`);
    }
  }
  resolveTraffic();
}
