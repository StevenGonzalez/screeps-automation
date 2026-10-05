import { ROLE_MINER, ROLE_HAULER } from "../config/config.roles";
import {
  getThreatInfo,
  getThreatSeverity,
  refreshBlockade,
  isBlockaded,
} from "../services/services.combat";
import { isEnergyEmergency } from "../services/services.creep";
import { spawnTownsfolk } from "./orchestrator.spawning.town";
import {
  countByRoleInRoom,
  getRoomPhase,
  SPAWN_IDLE_RECHECK,
  spawnOrdersThisTick,
} from "./orchestrator.spawning.shared";
import {
  hasEnergyGatherers,
  countHomeHaulers,
  CONTROLLER_DOWNGRADE_SAFETY,
  shouldSpawnHauler,
  spawnHauler,
  shouldSpawnMiner,
  shouldSpawnHarvester,
  shouldSpawnUpgrader,
  shouldSpawnBuilder,
  shouldSpawnRepairer,
  shouldSpawnFiller,
  spawnFiller,
  spawnEmergencyHarvester,
  shouldSpawnMineralMiner,
  spawnRepairer,
  spawnMineralMiner,
  spawnHarvester,
  spawnUpgrader,
  spawnBuilder,
  spawnMiner,
  shouldSpawnApothecary,
  spawnApothecary,
} from "./orchestrator.spawning.economy";
import {
  shouldSpawnScout,
  spawnScout,
  shouldSpawnScoreHunter,
  spawnScoreHunter,
  shouldSpawnRemoteMiner,
  spawnRemoteMiner,
  shouldSpawnRemoteHauler,
  spawnRemoteHauler,
  reassignStrayHaulers,
  shouldSpawnReserver,
  spawnReserver,
} from "./orchestrator.spawning.remote";
import {
  shouldSpawnKnight,
  spawnKnight,
  shouldSpawnWizard,
  spawnWizard,
  shouldSpawnCleric,
  spawnCleric,
  shouldSpawnConqueror,
  spawnConqueror,
  spawnUnclaimer,
  shouldSpawnSettler,
  spawnSettler,
  shouldSpawnOffensiveCreep,
  shouldSpawnDrainLeech,
  spawnDrainLeech,
  spawnNextOffensiveCreep,
  shouldSpawnDefender,
  spawnNextDefender,
  shouldSpawnRemoteDefender,
  spawnRemoteDefender,
  sendIdleRemoteKnights,
} from "./orchestrator.spawning.military";
import {
  shouldSpawnPowerCreep,
  spawnNextPowerCreep,
  shouldSpawnDepositCreep,
  spawnNextDepositCreep,
  spawnSkCreeps,
} from "./orchestrator.spawning.ops";

export {
  getActiveRemoteRooms,
  getPickedRemoteRoomNames,
  planRemoteSource,
  buildRemoteHaulerBody,
  buildReserverBody,
} from "./orchestrator.spawning.remote";
export {
  buildKnightBody,
  buildWizardBody,
  buildClericBody,
  buildDrainerBody,
  buildSiegerBody,
  findUnclaimTarget,
  buildUnclaimerBody,
} from "./orchestrator.spawning.military";
export { buildPowerAttackerBody, buildSkGuardianBody } from "./orchestrator.spawning.ops";

// How often each home checks for merchants whose remote is no longer worked.
const STRAY_HAULER_INTERVAL = 10;

// A spawn that finds nothing to raise looks again only SPAWN_IDLE_RECHECK
// ticks later. Each look walks the whole spawn order, about half a CPU a
// castle, and all three castles' spawns stood idle on most ticks. A creep
// that falls due waits at most two ticks more. A room with a hostile in it
// that can do harm looks every tick, so a raid is answered at once; a scout
// does not count.
const idleUntil: Record<string, number> = {};

export function loop() {
  for (const roomName in Game.rooms) {
    const room = Game.rooms[roomName];
    if (!room.controller?.my) continue;
    refreshBlockade(room);
    if (Game.time % STRAY_HAULER_INTERVAL === 0) reassignStrayHaulers(room);
    sendIdleRemoteKnights(room);
    const spawns = room.find(FIND_MY_SPAWNS) as StructureSpawn[];
    for (const spawn of spawns) {
      if (spawn.spawning) continue;
      if ((idleUntil[spawn.id] ?? 0) > Game.time && getThreatInfo(room).score === 0) continue;
      const orders = spawnOrdersThisTick();
      processRoomSpawning(room, spawn);
      if (spawnOrdersThisTick() === orders) idleUntil[spawn.id] = Game.time + SPAWN_IDLE_RECHECK;
    }
  }
}

// WORK counts: nobody can harvest in a room we own, so a WORK creep here is a
// dismantler or a builder of something hostile.
function hasArmedHostiles(room: Room): boolean {
  return getThreatInfo(room).hostiles.some((c) =>
    c.body.some(
      (p) => p.hits > 0 && (p.type === ATTACK || p.type === RANGED_ATTACK || p.type === WORK)
    )
  );
}

const ECONOMY_CRITICAL_STORAGE = 25_000;

function isEconomyCritical(room: Room): boolean {
  if (!room.storage) return isEnergyEmergency(room);
  return room.storage.store[RESOURCE_ENERGY] < ECONOMY_CRITICAL_STORAGE;
}

export function processRoomSpawning(room: Room, spawn: StructureSpawn) {
  if (!hasEnergyGatherers(room)) {
    if (shouldSpawnDefender(room) && spawnNextDefender(room, spawn)) return;
    spawnEmergencyHarvester(room, spawn);
    return;
  }

  const { score: threatScore } = getThreatInfo(room);
  const threatSeverity = getThreatSeverity(room);
  const phase = getRoomPhase(room);

  const blockaded = isBlockaded(room);

  if (shouldSpawnHarvester(room) && spawnHarvester(room, spawn)) return;

  if (shouldSpawnDefender(room) && spawnNextDefender(room, spawn)) return;

  const hasEconomyFloor =
    countByRoleInRoom(ROLE_MINER, room) >= 1 && countByRoleInRoom(ROLE_HAULER, room) >= 1;
  if (threatSeverity === "high" && phase !== "bootstrap" && hasEconomyFloor) {
    if (shouldSpawnKnight(room, threatScore) && spawnKnight(room, spawn)) return;
    if (shouldSpawnWizard(room, threatScore) && spawnWizard(room, spawn)) return;
    if (shouldSpawnCleric(room, threatScore) && spawnCleric(room, spawn)) return;
  }

  // The filler is what moves stored energy into spawn and extensions, so it is
  // the only reason room.energyAvailable ever climbs once storage exists. Miner
  // and hauler both hold the spawn while they save up for a full-size body; if
  // the filler sat behind that hold it could never be replaced, and the energy
  // the hold is waiting for would never arrive.
  if (shouldSpawnFiller(room) && spawnFiller(room, spawn)) return;
  // A miner with no hauler behind it fills its container and nothing reaches
  // the core, so the first hauler goes ahead of any further miner.
  const needsFirstHauler =
    countHomeHaulers(room) === 0 && countByRoleInRoom(ROLE_MINER, room) >= 1;
  if (needsFirstHauler && shouldSpawnHauler(room) && spawnHauler(room, spawn)) return;
  if (shouldSpawnMiner(room) && spawnMiner(room, spawn)) return;
  if (shouldSpawnHauler(room) && spawnHauler(room, spawn)) return;

  if (
    room.controller?.my &&
    room.controller.ticksToDowngrade < CONTROLLER_DOWNGRADE_SAFETY &&
    shouldSpawnUpgrader(room) &&
    spawnUpgrader(room, spawn)
  )
    return;

  if (isEnergyEmergency(room)) {
    if (!blockaded) {
      if (shouldSpawnRemoteDefender(room) && spawnRemoteDefender(room, spawn)) return;
      if (shouldSpawnRemoteMiner(room) && spawnRemoteMiner(room, spawn)) return;
      if (shouldSpawnRemoteHauler(room) && spawnRemoteHauler(room, spawn)) return;
      if (shouldSpawnReserver(room) && spawnReserver(room, spawn)) return;
    }
    return;
  }

  // Towers only arrive at RCL 3, so a bootstrap room has nothing else to fight
  // with. Only hostiles that can actually hit something justify a defender.
  if (hasArmedHostiles(room)) {
    if (shouldSpawnKnight(room, threatScore) && spawnKnight(room, spawn)) return;
    if (shouldSpawnWizard(room, threatScore) && spawnWizard(room, spawn)) return;
    if (shouldSpawnCleric(room, threatScore) && spawnCleric(room, spawn)) return;
  }

  // A remote miner is the cheapest creep there is for what it brings in, and the
  // merchants already walking its road earn nothing while its post stands empty.
  // With one spawn, waiting behind a long repairer or builder body left a source
  // idle for a couple of hundred ticks.
  if (!blockaded && shouldSpawnRemoteMiner(room) && spawnRemoteMiner(room, spawn)) return;
  // An envoy is a few parts, and one late lets its remote's reservation lapse,
  // which halves the remote's sources. At the end of the line Grimford's relief
  // for the Misty Thicket waited behind a merchant, a porter, an enchanter and
  // another porter while the reservation stayed down.
  if (!blockaded && shouldSpawnReserver(room) && spawnReserver(room, spawn)) return;
  if (shouldSpawnRepairer(room) && spawnRepairer(room, spawn)) return;
  if (shouldSpawnBuilder(room) && spawnBuilder(room, spawn)) return;
  if (shouldSpawnUpgrader(room) && spawnUpgrader(room, spawn)) return;

  // The town comes after the castle's own workers but ahead of expeditions,
  // scouts and vendors. Townsfolk take a few ticks of spawn time each, and a
  // castle sending pilgrims keeps its spawn so busy that a town at the end of
  // the line was never raised at all. The town keeps its own, lower storage
  // gate: storage settles near the upgraders' 10k floor, so the
  // economy-critical line below would never let it grow.
  if (!blockaded && spawnTownsfolk(room, spawn)) return;

  if (!blockaded && shouldSpawnScoreHunter(room) && spawnScoreHunter(room, spawn)) return;

  const economyCritical = isEconomyCritical(room);

  if (!blockaded && !economyCritical && Memory.expansion?.homeRoom === room.name) {
    if (shouldSpawnConqueror() && spawnConqueror(room, spawn)) return;
    if (shouldSpawnSettler(room) && spawnSettler(room, spawn)) return;
  }

  if (!blockaded && !economyCritical && shouldSpawnOffensiveCreep(room) && spawnNextOffensiveCreep(room, spawn)) return;
  if (!blockaded && !economyCritical && shouldSpawnDrainLeech(room) && spawnDrainLeech(room, spawn)) return;
  if (!blockaded && !economyCritical && spawnUnclaimer(room, spawn)) return;
  if (!blockaded && shouldSpawnScout(room) && spawnScout(room, spawn)) return;
  if (!blockaded && shouldSpawnRemoteDefender(room) && spawnRemoteDefender(room, spawn)) return;
  if (!blockaded && shouldSpawnRemoteHauler(room) && spawnRemoteHauler(room, spawn)) return;

  if (!blockaded && shouldSpawnPowerCreep(room) && spawnNextPowerCreep(room, spawn)) return;
  if (!blockaded && shouldSpawnDepositCreep(room) && spawnNextDepositCreep(room, spawn)) return;
  if (!blockaded && spawnSkCreeps(room, spawn)) return;
  if (shouldSpawnApothecary(room) && spawnApothecary(room, spawn)) return;
  if (shouldSpawnMineralMiner(room) && spawnMineralMiner(room, spawn)) return;
}
