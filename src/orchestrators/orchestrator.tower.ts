import { runTower, selectRoomAttackTarget } from "../roles/role.tower";
import { getThreatInfo, getThreatSeverity, structureDamagePerTick } from "../services/services.combat";
import { isAlly } from "../services/services.allies";

const THREAT_NOTIFY_COOLDOWN = 200;

const SAFEMODE_SPAWN_HP_RATIO   = 0.50;
const SAFEMODE_TOWER_HP_RATIO   = 0.25;
const SAFEMODE_STORAGE_HP_RATIO = 0.25;
const SAFEMODE_TERMINAL_HP_RATIO = 0.25;
const SAFEMODE_MIN_TOWER_ENERGY = 50;
const SAFEMODE_OVERWHELMED_COUNT = 3;

const SAFEMODE_LOW_CHARGE = 1;
const SAFEMODE_SPAWN_PREDICT_TICKS = 12;
const SAFEMODE_SPAWN_PREDICT_HP_RATIO = 0.80;
const SAFEMODE_LETHAL_DPS = 400;

export function loop() {
  for (const roomName in Game.rooms) {
    const room = Game.rooms[roomName];
    if (!room.controller?.my) continue;

    const hostiles = room.find(FIND_HOSTILE_CREEPS, {
      filter: (c) => !isAlly(c.owner?.username),
    });

    notifyOnHostiles(room, hostiles);
    checkSafeMode(room, hostiles);

    const towerIds = room.memory.towerIds ?? [];
    if (towerIds.length === 0) continue;

    const attackTarget = selectRoomAttackTarget(hostiles, room);

    const hasHostiles = hostiles.length > 0;
    for (const id of towerIds) {
      const tower = Game.getObjectById(id) as StructureTower | null;
      if (tower) runTower(tower, attackTarget, hasHostiles);
    }
  }
}

function checkSafeMode(room: Room, hostiles: Creep[]): void {
  const controller = room.controller;
  if (!controller?.my) return;
  if (controller.safeMode) return;
  if (!controller.safeModeAvailable) return;

  const attackers = hostiles.filter((c) =>
    c.body.some(
      (p) => p.type === ATTACK || p.type === RANGED_ATTACK || p.type === WORK
    )
  );
  if (attackers.length === 0) return;

  const lastCharge = controller.safeModeAvailable <= SAFEMODE_LOW_CHARGE;
  const severity = getThreatSeverity(room);
  const incomingDps = structureDamagePerTick(attackers);
  const lethalDps = incomingDps >= SAFEMODE_LETHAL_DPS;
  const trivialThreat = (severity === "low" || severity === "medium") && !lethalDps;
  const conserve = lastCharge && trivialThreat;

  const breaching = isBreachingForce(room, attackers, severity);
  const forceThatCanFinish = breaching || lethalDps;

  for (const spawn of room.find(FIND_MY_SPAWNS)) {
    if (spawn.hits < spawn.hitsMax * SAFEMODE_SPAWN_HP_RATIO) {
      if (conserve) break;
      activateSafeMode(room, controller, `spawn at ${pct(spawn)}% HP`);
      return;
    }
  }

  if (!conserve && forceThatCanFinish) {
    for (const spawn of room.find(FIND_MY_SPAWNS)) {
      if (spawn.hits >= spawn.hitsMax * SAFEMODE_SPAWN_PREDICT_HP_RATIO) continue;
      const ticksToDie = ticksUntilDestroyed(room, spawn);
      if (ticksToDie !== undefined && ticksToDie <= SAFEMODE_SPAWN_PREDICT_TICKS) {
        activateSafeMode(
          room,
          controller,
          `spawn at ${pct(spawn)}% HP, projected loss in ~${ticksToDie} ticks`
        );
        return;
      }
    }
  }

  const towerIds = room.memory.towerIds ?? [];
  if (forceThatCanFinish && !conserve) {
    for (const id of towerIds) {
      const tower = Game.getObjectById(id) as StructureTower | null;
      if (tower && tower.hits < tower.hitsMax * SAFEMODE_TOWER_HP_RATIO) {
        activateSafeMode(room, controller, `tower at ${pct(tower)}% HP under breaching force`);
        return;
      }
    }
  }

  const hasDismantlers = attackers.some((c) => c.body.some((p) => p.type === WORK));
  if (hasDismantlers && !conserve) {
    if (room.storage && room.storage.hits < room.storage.hitsMax * SAFEMODE_STORAGE_HP_RATIO) {
      activateSafeMode(room, controller, `storage at ${pct(room.storage)}% HP`);
      return;
    }
    if (room.terminal && room.terminal.hits < room.terminal.hitsMax * SAFEMODE_TERMINAL_HP_RATIO) {
      activateSafeMode(room, controller, `terminal at ${pct(room.terminal)}% HP`);
      return;
    }
  }

  const myFighters = room.find(FIND_MY_CREEPS, {
    filter: (c) => c.body.some((p) => p.type === ATTACK || p.type === RANGED_ATTACK),
  });

  const overwhelmed =
    attackers.length >= SAFEMODE_OVERWHELMED_COUNT && myFighters.length * 2 < attackers.length;

  if (towerIds.length > 0 && !conserve) {
    const allTowersDrained = towerIds.every((id) => {
      const t = Game.getObjectById(id) as StructureTower | null;
      return !t || t.store[RESOURCE_ENERGY] < SAFEMODE_MIN_TOWER_ENERGY;
    });
    if (allTowersDrained && overwhelmed) {
      activateSafeMode(room, controller, "towers drained, defenders overwhelmed");
      return;
    }
  }

  if (overwhelmed && towerIds.length === 0 && !conserve) {
    activateSafeMode(room, controller, `overwhelmed by ${attackers.length} attackers, no towers`);
  }
}

function isBreachingForce(room: Room, attackers: Creep[], severity: string): boolean {
  if (severity === "high") return true;

  let breachParts = 0;
  for (const c of attackers) {
    for (const p of c.body) {
      if (p.hits <= 0) continue;
      if (p.type === ATTACK || p.type === WORK) breachParts++;
    }
  }
  return breachParts >= 10 && attackers.length >= SAFEMODE_OVERWHELMED_COUNT;
}

function ticksUntilDestroyed(
  room: Room,
  target: { hits: number; pos: RoomPosition }
): number | undefined {
  const { hostiles } = getThreatInfo(room);
  if (hostiles.length === 0) return undefined;

  const dps = structureDamagePerTick(hostiles);
  if (dps <= 0) return undefined;
  return Math.ceil(target.hits / dps);
}

function activateSafeMode(room: Room, controller: StructureController, reason: string): void {
  const result = controller.activateSafeMode();
  if (result === OK) {
    const msg = `[SafeMode] Activated in ${room.name} - ${reason}`;
    console.log(msg);
    Game.notify(msg, 30);
  }
}

function pct(s: { hits: number; hitsMax: number }): number {
  return Math.floor((s.hits / s.hitsMax) * 100);
}

function notifyOnHostiles(room: Room, hostiles: Creep[]): void {
  if (hostiles.length === 0) return;

  if (!Memory.threatNotifyLastTick) Memory.threatNotifyLastTick = {};

  const last = Memory.threatNotifyLastTick[room.name] ?? 0;
  if (Game.time - last < THREAT_NOTIFY_COOLDOWN) return;

  const message = `[Threat] ${room.name}: ${hostiles.length} hostile creeps at tick ${Game.time}`;
  console.log(message);
  Game.notify(message, 30);
  Memory.threatNotifyLastTick[room.name] = Game.time;
}
