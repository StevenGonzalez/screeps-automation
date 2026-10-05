import {
  ROLE_POWER_ATTACKER,
  ROLE_POWER_HEALER,
  ROLE_POWER_CARRIER,
  ROLE_DEPOSIT_MINER,
  ROLE_DEPOSIT_HAULER,
  ROLE_SK_GUARDIAN,
  ROLE_SK_MINER,
  ROLE_SK_HAULER,
} from "../config/config.roles";
import { getSkMembers, isOpPaused } from "./orchestrator.sourcekeeper";
import { MAX_BODY_PART_COUNT } from "../config/config.spawning";
import {
  calculateBodyPartCost,
  trackedSpawn,
  bodyBudget,
  buildBoostQueue,
  boostMemory,
} from "./orchestrator.spawning.shared";
import { buildRemoteHaulerBody } from "./orchestrator.spawning.remote";
import { heraldNomads, heraldNomadsIdle } from "../services/services.herald";
import { holdsUnsoldDeposit } from "./orchestrator.terminal";

// Cracking ops are included so a member lost mid-fight gets replaced. A home
// that cannot build the full healer body cannot field a squad at all.
function getPowerSquadForRoom(room: Room): PowerBankOp | undefined {
  if (room.energyCapacityAvailable < calculateBodyPartCost(buildPowerHealerBody())) return undefined;
  return Memory.powerOps?.find(
    (o) => o.homeRoom === room.name && (o.phase === "forming" || o.phase === "cracking")
  );
}

function getPowerSquadMembersById(opId: number): Creep[] {
  const result: Creep[] = [];
  for (const name in Game.creeps) {
    const c = Game.creeps[name];
    if (c.memory.powerOpId === opId) result.push(c);
  }
  return result;
}

export function shouldSpawnPowerCreep(room: Room): boolean {
  const op = getPowerSquadForRoom(room);
  if (!op) return false;
  const members = getPowerSquadMembersById(op.id);
  return (
    members.filter((c) => c.memory.role === ROLE_POWER_ATTACKER).length < op.requiredAttackers ||
    members.filter((c) => c.memory.role === ROLE_POWER_HEALER).length < op.requiredHealers ||
    members.filter((c) => c.memory.role === ROLE_POWER_CARRIER).length < op.requiredCarriers
  );
}

export function spawnNextPowerCreep(room: Room, spawn: StructureSpawn): boolean {
  const op = getPowerSquadForRoom(room);
  if (!op) return false;

  const members = getPowerSquadMembersById(op.id);
  const attackers = members.filter((c) => c.memory.role === ROLE_POWER_ATTACKER).length;
  const healers = members.filter((c) => c.memory.role === ROLE_POWER_HEALER).length;
  const carriers = members.filter((c) => c.memory.role === ROLE_POWER_CARRIER).length;

  let roleToSpawn: string | null = null;
  if (attackers < op.requiredAttackers) roleToSpawn = ROLE_POWER_ATTACKER;
  else if (healers < op.requiredHealers) roleToSpawn = ROLE_POWER_HEALER;
  else if (carriers < op.requiredCarriers) roleToSpawn = ROLE_POWER_CARRIER;
  if (!roleToSpawn) return false;

  let body: BodyPartConstant[];
  if (roleToSpawn === ROLE_POWER_ATTACKER) {
    body = buildPowerAttackerBody();
  } else if (roleToSpawn === ROLE_POWER_HEALER) {
    body = buildPowerHealerBody();
  } else {
    body = buildPowerCarrierBody();
  }

  if (room.energyAvailable < calculateBodyPartCost(body)) return false;

  const res = trackedSpawn(room, spawn, body, {
    memory: {
      role: roleToSpawn,
      homeRoom: room.name,
      powerOpId: op.id,
    },
  });
  if (res === OK) {
    console.log(`[Power] Spawning ${roleToSpawn} for op #${op.id} -> ${op.roomName}`);
  }
  return res === OK;
}

// Unboosted TOUGH is only hit points the healers already cover, while ATTACK is
// what cracks the bank; a 2:1 body also crawls there off-road. So: all ATTACK,
// one MOVE each.
export function buildPowerAttackerBody(): BodyPartConstant[] {
  return [
    ...Array(25).fill(ATTACK),
    ...Array(25).fill(MOVE),
  ] as BodyPartConstant[];
}

function buildPowerHealerBody(): BodyPartConstant[] {
  return [
    ...Array(25).fill(MOVE),
    ...Array(25).fill(HEAL),
  ] as BodyPartConstant[];
}

function buildPowerCarrierBody(): BodyPartConstant[] {
  return [
    ...Array(25).fill(CARRY),
    ...Array(25).fill(MOVE),
  ] as BodyPartConstant[];
}

function getDepositOpForRoom(room: Room): DepositOp | undefined {
  return Memory.depositOps?.find((o) => o.homeRoom === room.name && o.phase === "mining");
}

function getDepositMembersById(opId: number): Creep[] {
  const result: Creep[] = [];
  for (const name in Game.creeps) {
    const c = Game.creeps[name];
    if (c.memory.depositOpId === opId) result.push(c);
  }
  return result;
}

export function shouldSpawnDepositCreep(room: Room): boolean {
  const op = getDepositOpForRoom(room);
  if (!op) return false;
  const members = getDepositMembersById(op.id);
  const short =
    members.filter((c) => c.memory.role === ROLE_DEPOSIT_MINER).length < op.requiredMiners ||
    members.filter((c) => c.memory.role === ROLE_DEPOSIT_HAULER).length < op.requiredHaulers;
  if (!short) return false;
  // A haul pays only once it sells. Embercrag's nomads dug silicon from two
  // deposits at once, some five gold a tick in creeps, while 1100 from their
  // earlier hauls sat unsold in its terminal: its only buyers stood 88 rooms
  // off, where the gold a deal burns left less than the floor a sale holds to.
  // The creeps out there finish their work; none are raised to follow until
  // the haul sells.
  if (holdsUnsoldDeposit(room, op.depositType)) {
    if (!op.unsold) heraldNomadsIdle(room.name, op.depositType);
    op.unsold = true;
    return false;
  }
  delete op.unsold;
  return true;
}

export function spawnNextDepositCreep(room: Room, spawn: StructureSpawn): boolean {
  const op = getDepositOpForRoom(room);
  if (!op) return false;

  const members = getDepositMembersById(op.id);
  const miners = members.filter((c) => c.memory.role === ROLE_DEPOSIT_MINER).length;
  const haulers = members.filter((c) => c.memory.role === ROLE_DEPOSIT_HAULER).length;

  let roleToSpawn: string;
  let body: BodyPartConstant[];
  const energy = room.energyCapacityAvailable;
  if (miners < op.requiredMiners) {
    roleToSpawn = ROLE_DEPOSIT_MINER;
    body = buildDepositMinerBody(energy);
  } else if (haulers < op.requiredHaulers) {
    roleToSpawn = ROLE_DEPOSIT_HAULER;
    body = buildRemoteHaulerBody(bodyBudget(room, "capacity"));
  } else {
    return false;
  }

  if (room.energyAvailable < calculateBodyPartCost(body)) return false;
  const res = trackedSpawn(room, spawn, body, {
    memory: { role: roleToSpawn, homeRoom: room.name, targetRoom: op.roomName, depositOpId: op.id },
  });
  if (res === OK) {
    console.log(`[Deposit] Spawning ${roleToSpawn} for op #${op.id} -> ${op.roomName}`);
    if (roleToSpawn === ROLE_DEPOSIT_MINER && !op.heralded) {
      op.heralded = true;
      heraldNomads(room.name, op.roomName, op.depositType);
    }
  }
  return res === OK;
}

function buildDepositMinerBody(availableEnergy: number): BodyPartConstant[] {
  const group: BodyPartConstant[] = [WORK, WORK, CARRY, MOVE, MOVE];
  const groupCost = calculateBodyPartCost(group);
  const maxGroups = Math.min(
    Math.floor(MAX_BODY_PART_COUNT / group.length),
    Math.floor(availableEnergy / groupCost)
  );
  const groups = Math.max(1, maxGroups);
  const body: BodyPartConstant[] = [];
  for (let i = 0; i < groups; i++) body.push(...group);
  return body;
}

export function spawnSkCreeps(room: Room, spawn: StructureSpawn): boolean {
  const ops = (Memory.skOps ?? []).filter(
    (o) => o.homeRoom === room.name && !isOpPaused(o)
  );
  for (const op of ops) {
    const members = getSkMembers(op.id);
    const guardians = members.filter((c) => c.memory.role === ROLE_SK_GUARDIAN).length;
    if (guardians < 1) return spawnSkGuardian(room, spawn, op);

    if (!op.discovered || op.sourceIds.length === 0) continue;

    const need = op.sourceIds.length;
    const miners = members.filter((c) => c.memory.role === ROLE_SK_MINER);
    const taken = new Set(miners.map((m) => m.memory.skSourceId));
    const freeSource = op.sourceIds.find((id) => !taken.has(id));
    if (miners.length < need && freeSource) return spawnSkMiner(room, spawn, op, freeSource);

    const haulers = members.filter((c) => c.memory.role === ROLE_SK_HAULER).length;
    if (haulers < need) return spawnSkHauler(room, spawn, op);
  }
  return false;
}

export function buildSkGuardianBody(availableEnergy: number): BodyPartConstant[] {
  const groupCost = BODYPART_COST[RANGED_ATTACK] + BODYPART_COST[HEAL] + 2 * BODYPART_COST[MOVE];
  const maxGroups = Math.min(
    Math.floor(MAX_BODY_PART_COUNT / 4),
    Math.floor(availableEnergy / groupCost)
  );
  const groups = Math.max(5, maxGroups);
  return [
    ...Array(groups).fill(RANGED_ATTACK),
    ...Array(groups * 2).fill(MOVE),
    ...Array(groups).fill(HEAL),
  ] as BodyPartConstant[];
}

function spawnSkGuardian(room: Room, spawn: StructureSpawn, op: SourceKeeperOp): boolean {
  const body = buildSkGuardianBody(room.energyCapacityAvailable);
  if (room.energyAvailable < calculateBodyPartCost(body)) return false;
  const healParts = body.filter((p) => p === HEAL).length;
  const queue = buildBoostQueue(room, "healer", healParts, 0);
  const res = trackedSpawn(room, spawn, body, {
    memory: { role: ROLE_SK_GUARDIAN, homeRoom: room.name, skOpId: op.id, ...boostMemory(queue) },
  });
  if (res === OK) console.log(`[SK] Spawning guardian for ${op.roomName}`);
  return res === OK;
}

function buildSkMinerBody(availableEnergy: number): BodyPartConstant[] {
  const maxWork = 7;
  const workCost = BODYPART_COST[WORK];
  const moveCost = BODYPART_COST[MOVE];
  let work = Math.min(maxWork, Math.floor(availableEnergy / (workCost + moveCost / 2)));
  work = Math.max(3, work);
  const move = Math.max(2, Math.ceil(work / 2));
  return [...Array(work).fill(WORK), ...Array(move).fill(MOVE)] as BodyPartConstant[];
}

function spawnSkMiner(
  room: Room,
  spawn: StructureSpawn,
  op: SourceKeeperOp,
  sourceId: Id<Source>
): boolean {
  const body = buildSkMinerBody(room.energyCapacityAvailable);
  if (room.energyAvailable < calculateBodyPartCost(body)) return false;
  const res = trackedSpawn(room, spawn, body, {
    memory: { role: ROLE_SK_MINER, homeRoom: room.name, skOpId: op.id, skSourceId: sourceId },
  });
  if (res === OK) console.log(`[SK] Spawning ${ROLE_SK_MINER} for ${op.roomName}`);
  return res === OK;
}

function spawnSkHauler(room: Room, spawn: StructureSpawn, op: SourceKeeperOp): boolean {
  const allowedEnergy = bodyBudget(room, "capacity");
  const body = buildRemoteHaulerBody(allowedEnergy);
  if (room.energyAvailable < calculateBodyPartCost(body)) return false;
  const res = trackedSpawn(room, spawn, body, {
    memory: { role: ROLE_SK_HAULER, homeRoom: room.name, skOpId: op.id },
  });
  if (res === OK) console.log(`[SK] Spawning packer for ${op.roomName}`);
  return res === OK;
}
