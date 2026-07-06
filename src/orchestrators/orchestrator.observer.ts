import {
  ROLE_POWER_ATTACKER,
  ROLE_POWER_HEALER,
  ROLE_POWER_CARRIER,
} from "../config/config.roles";
import { getScoreScanRooms, scoreHunterSupported } from "./orchestrator.score";

const POWER_BANK_MIN_POWER = 2000;
const POWER_BANK_MIN_TICKS = 3000;
const DEPOSIT_MAX_COOLDOWN = 100;
const DEPOSIT_MIN_TICKS = 3000;
const DEPOSIT_HARD_TIMEOUT = 20000;
const POWER_FORMING_TIMEOUT = 2000;
const CRACKING_TIMEOUT = 3000;
const COLLECTING_TIMEOUT = 300;
const SQUAD_ATTACKERS = 2;
const SQUAD_HEALERS = 3;
const OBSERVER_SCAN_RANGE = 10;
const SCORE_SCAN_RANGE = 4;
const SCORE_SCAN_REBUILD_INTERVAL = 1500;
const POWER_PROCESS_ENERGY_FLOOR = 100000;

export function loop() {
  for (const roomName in Game.rooms) {
    const room = Game.rooms[roomName];
    if (!room.controller?.my) continue;
    runObserver(room);
    scanVisibleHighwayRooms(room.name);
    runPowerSpawn(room);
  }
  updatePowerOps();
  updateDepositOps();
}

function runObserver(room: Room) {
  if (!room.memory.observerId) return;
  const observer = Game.getObjectById(room.memory.observerId) as StructureObserver | null;
  if (!observer) { room.memory.observerId = undefined; return; }

  if (scoreHunterSupported() && Game.time % 2 === 0) {
    if (scanScoreRegion(room, observer)) return;
  }
  scanHighways(room, observer);
}

function scanScoreRegion(room: Room, observer: StructureObserver): boolean {
  let queue = room.memory.scoreScanQueue;
  if (!queue || queue.length === 0 || Game.time % SCORE_SCAN_REBUILD_INTERVAL === 0) {
    queue = room.memory.scoreScanQueue = getScoreScanRooms(room.name, SCORE_SCAN_RANGE);
    if (queue.length === 0) return false;
  }
  const target = queue.shift()!;
  queue.push(target);
  observer.observeRoom(target);
  return true;
}

function scanHighways(room: Room, observer: StructureObserver): void {
  if (!room.memory.observerScanQueue || room.memory.observerScanQueue.length === 0) {
    room.memory.observerScanQueue = buildHighwayScanQueue(room.name);
    if (room.memory.observerScanQueue.length === 0) return;
  }
  const queue = room.memory.observerScanQueue;
  const target = queue.shift()!;
  queue.push(target);
  observer.observeRoom(target);
}

function scanVisibleHighwayRooms(homeRoomName: string) {
  for (const roomName in Game.rooms) {
    if (!isHighwayRoom(roomName)) continue;
    if (Game.map.getRoomLinearDistance(homeRoomName, roomName) > OBSERVER_SCAN_RANGE) continue;
    checkForPowerBanks(roomName);
    checkForDeposits(roomName);
  }
}

function checkForPowerBanks(roomName: string) {
  const room = Game.rooms[roomName];
  if (!room) return;

  const existing = (Memory.powerOps ?? []).find(
    (op) => op.roomName === roomName && op.phase !== "done"
  );
  if (existing) return;

  const banks = room.find(FIND_STRUCTURES, {
    filter: (s) => s.structureType === STRUCTURE_POWER_BANK,
  }) as StructurePowerBank[];

  if (banks.length === 0) return;
  const bank = banks[0];
  if (bank.power < POWER_BANK_MIN_POWER) return;
  if (bank.ticksToDecay < POWER_BANK_MIN_TICKS) return;

  const ownedRooms = Object.values(Game.rooms).filter((r) => r.controller?.my);
  if (ownedRooms.length === 0) return;
  const homeRoom = ownedRooms.reduce((best, r) => {
    const d = Game.map.getRoomLinearDistance(r.name, roomName);
    const bd = Game.map.getRoomLinearDistance(best.name, roomName);
    return d < bd ? r : best;
  });

  if (!Memory.powerOps) Memory.powerOps = [];
  if (!Memory.nextPowerOpId) Memory.nextPowerOpId = 1;

  const carriers = Math.min(6, Math.ceil(bank.power / 1250));
  const op: PowerBankOp = {
    id: Memory.nextPowerOpId++,
    bankId: bank.id as Id<StructurePowerBank>,
    roomName,
    homeRoom: homeRoom.name,
    power: bank.power,
    phase: "forming",
    startedAt: Game.time,
    requiredAttackers: SQUAD_ATTACKERS,
    requiredHealers: SQUAD_HEALERS,
    requiredCarriers: carriers,
  };
  Memory.powerOps.push(op);
  console.log(
    `[Observer] Power bank in ${roomName}: ${bank.power} power, ${bank.ticksToDecay} ticks. ` +
    `Op #${op.id} - ${SQUAD_ATTACKERS}A/${SQUAD_HEALERS}H/${carriers}C from ${homeRoom.name}`
  );
}

function updatePowerOps() {
  if (!Memory.powerOps?.length) return;
  for (const op of Memory.powerOps) {
    if (op.phase !== "done") updatePowerOp(op);
  }
  Memory.powerOps = Memory.powerOps.filter((op) => op.phase !== "done");
}

function updatePowerOp(op: PowerBankOp) {
  const members = getPowerSquadMembers(op.id);

  switch (op.phase) {
    case "forming": {
      if (Game.time - op.startedAt > POWER_FORMING_TIMEOUT) {
        console.log(`[Power] Op #${op.id} timed out forming (${op.roomName}) - aborting`);
        disbandSquad(op.id);
        op.phase = "done";
        return;
      }
      if (op.bankId && Game.rooms[op.roomName]) {
        const bank = Game.getObjectById(op.bankId) as StructurePowerBank | null;
        if (!bank) { op.phase = "done"; return; }
      }
      const attackers = members.filter((c) => c.memory.role === ROLE_POWER_ATTACKER).length;
      const healers = members.filter((c) => c.memory.role === ROLE_POWER_HEALER).length;
      const carriers = members.filter((c) => c.memory.role === ROLE_POWER_CARRIER).length;
      if (
        attackers >= op.requiredAttackers &&
        healers >= op.requiredHealers &&
        carriers >= op.requiredCarriers
      ) {
        op.phase = "cracking";
        op.crackingStartedAt = Game.time;
        console.log(`[Power] Op #${op.id} squad formed - cracking ${op.roomName}`);
      }
      break;
    }

    case "cracking": {
      if (members.length === 0) {
        console.log(`[Power] Op #${op.id} all members lost - aborting`);
        op.phase = "done";
        return;
      }
      if (Game.time - (op.crackingStartedAt ?? op.startedAt) > CRACKING_TIMEOUT) {
        console.log(`[Power] Op #${op.id} cracking timed out (${op.roomName}) - aborting`);
        disbandSquad(op.id);
        op.phase = "done";
        return;
      }
      if (Game.rooms[op.roomName]) {
        const bank = op.bankId ? Game.getObjectById(op.bankId) as StructurePowerBank | null : null;
        if (!bank) {
          op.phase = "collecting";
          op.collectingStartedAt = Game.time;
          console.log(`[Power] Op #${op.id} bank cracked - collecting`);
        }
      }
      break;
    }

    case "collecting": {
      const bankRoom = Game.rooms[op.roomName];
      let powerStillVisible = false;
      if (bankRoom) {
        const groundPower =
          bankRoom
            .find(FIND_DROPPED_RESOURCES, { filter: (r) => r.resourceType === RESOURCE_POWER })
            .reduce((sum, r) => sum + r.amount, 0) +
          bankRoom
            .find(FIND_RUINS)
            .reduce((sum, r) => sum + (r.store.getUsedCapacity(RESOURCE_POWER) ?? 0), 0);
        powerStillVisible = groundPower > 0;
        if (groundPower === 0) op.collected = true;
      }

      const stillCarrying = members.some(
        (c) => (c.store.getUsedCapacity(RESOURCE_POWER) ?? 0) > 0
      );

      if (stillCarrying || powerStillVisible) op.collectingStartedAt = Game.time;
      if (Game.time - (op.collectingStartedAt ?? Game.time) > COLLECTING_TIMEOUT) {
        console.log(`[Power] Op #${op.id} collection timed out`);
        op.phase = "done";
        return;
      }

      if (op.collected && !stillCarrying) {
        console.log(`[Power] Op #${op.id} collection complete`);
        op.phase = "done";
      }
      break;
    }
  }
}

function disbandSquad(opId: number) {
  for (const name in Game.creeps) {
    const c = Game.creeps[name];
    if (c.memory.powerOpId === opId) delete c.memory.powerOpId;
  }
}

export function getPowerSquadMembers(opId: number): Creep[] {
  const result: Creep[] = [];
  for (const name in Game.creeps) {
    const c = Game.creeps[name];
    if (c.memory.powerOpId === opId) result.push(c);
  }
  return result;
}

function checkForDeposits(roomName: string) {
  const room = Game.rooms[roomName];
  if (!room) return;

  const existing = (Memory.depositOps ?? []).find(
    (op) => op.roomName === roomName && op.phase !== "done"
  );
  if (existing) return;

  const deposits = room.find(FIND_DEPOSITS);
  if (deposits.length === 0) return;
  const deposit = deposits.reduce((best, d) => (d.lastCooldown < best.lastCooldown ? d : best));
  if (deposit.lastCooldown > DEPOSIT_MAX_COOLDOWN) return;
  if (deposit.ticksToDecay < DEPOSIT_MIN_TICKS) return;

  const ownedRooms = Object.values(Game.rooms).filter((r) => r.controller?.my);
  if (ownedRooms.length === 0) return;
  const homeRoom = ownedRooms.reduce((best, r) => {
    const d = Game.map.getRoomLinearDistance(r.name, roomName);
    const bd = Game.map.getRoomLinearDistance(best.name, roomName);
    return d < bd ? r : best;
  });

  if (!Memory.depositOps) Memory.depositOps = [];
  if (!Memory.nextDepositOpId) Memory.nextDepositOpId = 1;

  const distance = Game.map.getRoomLinearDistance(homeRoom.name, roomName);
  const haulers = distance >= 4 ? 2 : 1;
  const op: DepositOp = {
    id: Memory.nextDepositOpId++,
    depositId: deposit.id,
    roomName,
    homeRoom: homeRoom.name,
    depositType: deposit.depositType,
    phase: "mining",
    startedAt: Game.time,
    lastCooldown: deposit.lastCooldown,
    requiredMiners: 1,
    requiredHaulers: haulers,
  };
  Memory.depositOps.push(op);
  console.log(
    `[Observer] Deposit (${deposit.depositType}) in ${roomName}: cooldown ${deposit.lastCooldown}, ` +
    `${deposit.ticksToDecay} ticks. Op #${op.id} - 1 miner/${haulers} haulers from ${homeRoom.name}`
  );
}

function updateDepositOps() {
  if (!Memory.depositOps?.length) return;
  for (const op of Memory.depositOps) {
    if (op.phase !== "done") updateDepositOp(op);
  }
  Memory.depositOps = Memory.depositOps.filter((op) => op.phase !== "done");
}

function updateDepositOp(op: DepositOp) {
  if (Game.time - op.startedAt > DEPOSIT_HARD_TIMEOUT) {
    console.log(`[Deposit] Op #${op.id} hard-timed-out (${op.roomName}) - ending`);
    endDepositOp(op);
    return;
  }

  if (Game.rooms[op.roomName]) {
    const deposit = op.depositId ? Game.getObjectById(op.depositId) : null;
    if (!deposit) {
      console.log(`[Deposit] Op #${op.id} deposit gone (${op.roomName}) - ending`);
      endDepositOp(op);
      return;
    }
    op.lastCooldown = deposit.lastCooldown;
    if (deposit.lastCooldown > DEPOSIT_MAX_COOLDOWN || deposit.ticksToDecay < DEPOSIT_MIN_TICKS) {
      console.log(
        `[Deposit] Op #${op.id} exhausted (${op.roomName}, cooldown ${deposit.lastCooldown}) - ending`
      );
      endDepositOp(op);
    }
  }
}

function endDepositOp(op: DepositOp) {
  op.phase = "done";
}

export function getDepositSquadMembers(opId: number): Creep[] {
  const result: Creep[] = [];
  for (const name in Game.creeps) {
    const c = Game.creeps[name];
    if (c.memory.depositOpId === opId) result.push(c);
  }
  return result;
}

function runPowerSpawn(room: Room) {
  if (!room.memory.powerSpawnId) return;
  const ps = Game.getObjectById(room.memory.powerSpawnId) as StructurePowerSpawn | null;
  if (!ps) { room.memory.powerSpawnId = undefined; return; }
  if (ps.power === 0) return;
  if (ps.store[RESOURCE_ENERGY] < 50) return;
  const storedEnergy = room.storage?.store[RESOURCE_ENERGY] ?? 0;
  if (storedEnergy < POWER_PROCESS_ENERGY_FLOOR) return;
  ps.processPower();
}

function buildHighwayScanQueue(homeRoomName: string): string[] {
  const result: string[] = [];
  for (let dx = -12; dx <= 12; dx++) {
    for (let dy = -12; dy <= 12; dy++) {
      const roomName = offsetRoom(homeRoomName, dx, dy);
      if (!roomName || roomName === homeRoomName) continue;
      if (!isHighwayRoom(roomName)) continue;
      if (Game.map.getRoomLinearDistance(homeRoomName, roomName) > OBSERVER_SCAN_RANGE) continue;
      result.push(roomName);
    }
  }
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function offsetRoom(roomName: string, dx: number, dy: number): string | null {
  const m = roomName.match(/^([WE])(\d+)([NS])(\d+)$/);
  if (!m) return null;
  let wx = m[1] === "E" ? parseInt(m[2], 10) : -(parseInt(m[2], 10) + 1);
  let wy = m[3] === "S" ? parseInt(m[4], 10) : -(parseInt(m[4], 10) + 1);
  wx += dx;
  wy += dy;
  const newEw = wx >= 0 ? "E" : "W";
  const newNs = wy >= 0 ? "S" : "N";
  return `${newEw}${wx >= 0 ? wx : -(wx + 1)}${newNs}${wy >= 0 ? wy : -(wy + 1)}`;
}

function isHighwayRoom(roomName: string): boolean {
  const m = roomName.match(/^[WE](\d+)[NS](\d+)$/);
  if (!m) return false;
  return parseInt(m[1], 10) % 10 === 0 || parseInt(m[2], 10) % 10 === 0;
}
