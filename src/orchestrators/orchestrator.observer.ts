import {
  ROLE_POWER_ATTACKER,
  ROLE_POWER_HEALER,
  ROLE_POWER_CARRIER,
} from "../config/config.roles";

const POWER_BANK_MIN_POWER = 2000;
const POWER_BANK_MIN_TICKS = 3000;
const POWER_FORMING_TIMEOUT = 2000;
// Abandon a crack that never lands (squad too weak, or pushed out of the room so we lose
// the eyes that would detect the bank breaking) instead of hanging in 'cracking' forever.
const CRACKING_TIMEOUT = 3000;
const COLLECTING_TIMEOUT = 300;
const SQUAD_ATTACKERS = 2;
const SQUAD_HEALERS = 3;
const OBSERVER_SCAN_RANGE = 10;

export function loop() {
  for (const roomName in Game.rooms) {
    const room = Game.rooms[roomName];
    if (!room.controller?.my) continue;
    runObserver(room);
    scanVisibleHighwayRooms(room.name);
    runPowerSpawn(room);
  }
  updatePowerOps();
}

function runObserver(room: Room) {
  if (!room.memory.observerId) return;
  const observer = Game.getObjectById(room.memory.observerId) as StructureObserver | null;
  if (!observer) { room.memory.observerId = undefined; return; }

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

  // Find closest owned room
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
    `Op #${op.id} — ${SQUAD_ATTACKERS}A/${SQUAD_HEALERS}H/${carriers}C from ${homeRoom.name}`
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
        console.log(`[Power] Op #${op.id} timed out forming (${op.roomName}) — aborting`);
        disbandSquad(op.id);
        op.phase = "done";
        return;
      }
      // Verify bank still exists if room is visible
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
        console.log(`[Power] Op #${op.id} squad formed — cracking ${op.roomName}`);
      }
      break;
    }

    case "cracking": {
      if (members.length === 0) {
        console.log(`[Power] Op #${op.id} all members lost — aborting`);
        op.phase = "done";
        return;
      }
      if (Game.time - (op.crackingStartedAt ?? op.startedAt) > CRACKING_TIMEOUT) {
        console.log(`[Power] Op #${op.id} cracking timed out (${op.roomName}) — aborting`);
        disbandSquad(op.id);
        op.phase = "done";
        return;
      }
      // Room visible via our creeps inside it
      if (Game.rooms[op.roomName]) {
        const bank = op.bankId ? Game.getObjectById(op.bankId) as StructurePowerBank | null : null;
        if (!bank) {
          op.phase = "collecting";
          op.collectingStartedAt = Game.time;
          console.log(`[Power] Op #${op.id} bank cracked — collecting`);
        }
      }
      break;
    }

    case "collecting": {
      const elapsed = Game.time - (op.collectingStartedAt ?? Game.time);
      const allHome = members.length > 0 && members.every((c) => c.room.name === op.homeRoom);
      if (elapsed > COLLECTING_TIMEOUT || allHome) {
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

function runPowerSpawn(room: Room) {
  if (!room.memory.powerSpawnId) return;
  const ps = Game.getObjectById(room.memory.powerSpawnId) as StructurePowerSpawn | null;
  if (!ps) { room.memory.powerSpawnId = undefined; return; }
  if (ps.power === 0) return;
  if (ps.store[RESOURCE_ENERGY] < 50) return; // POWER_PROCESS_COST = 50
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
  // Shuffle so repeated runs don't always start at the same rooms
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
