import { runTower, selectRoomAttackTarget } from "../roles/role.tower";

const THREAT_NOTIFY_COOLDOWN = 200;

// ── Safemode thresholds ───────────────────────────────────────────────────────
const SAFEMODE_SPAWN_HP_RATIO   = 0.50;  // spawn below 50% HP
const SAFEMODE_TOWER_HP_RATIO   = 0.25;  // any tower below 25% HP
const SAFEMODE_STORAGE_HP_RATIO = 0.25;  // storage below 25% HP (dismantlers)
const SAFEMODE_TERMINAL_HP_RATIO = 0.25; // terminal below 25% HP
const SAFEMODE_MIN_TOWER_ENERGY = 50;    // towers considered "drained" below this
const SAFEMODE_OVERWHELMED_COUNT = 3;    // attacker count threshold for overwhelmed check

export function loop() {
  for (const roomName in Game.rooms) {
    const room = Game.rooms[roomName];
    if (!room.controller?.my) continue;

    // One hostile scan per room per tick, shared by notification, safe-mode checks,
    // and tower targeting — these previously ran three separate FIND_HOSTILE_CREEPS.
    const hostiles = room.find(FIND_HOSTILE_CREEPS);

    notifyOnHostiles(room, hostiles);
    checkSafeMode(room, hostiles);

    const towerIds = room.memory.towerIds ?? [];
    if (towerIds.length === 0) continue;

    // Compute the room-wide attack target once — all towers focus the same creep.
    const attackTarget = selectRoomAttackTarget(hostiles);

    for (const id of towerIds) {
      const tower = Game.getObjectById(id) as StructureTower | null;
      if (tower) runTower(tower, attackTarget);
    }
  }
}

// ── Safe mode ─────────────────────────────────────────────────────────────────

function checkSafeMode(room: Room, hostiles: Creep[]): void {
  const controller = room.controller;
  if (!controller?.my) return;
  if (controller.safeMode) return;            // already active
  if (!controller.safeModeAvailable) return;  // no charges

  const attackers = hostiles.filter((c) =>
    c.body.some(
      (p) => p.type === ATTACK || p.type === RANGED_ATTACK || p.type === WORK
    )
  );
  if (attackers.length === 0) return;

  // Trigger 1: any spawn critically damaged
  for (const spawn of room.find(FIND_MY_SPAWNS)) {
    if (spawn.hits < spawn.hitsMax * SAFEMODE_SPAWN_HP_RATIO) {
      activateSafeMode(room, controller, `spawn at ${pct(spawn)}% HP`);
      return;
    }
  }

  // Trigger 2: any tower critically damaged (losing towers means losing DPS permanently)
  const towerIds = room.memory.towerIds ?? [];
  for (const id of towerIds) {
    const tower = Game.getObjectById(id) as StructureTower | null;
    if (tower && tower.hits < tower.hitsMax * SAFEMODE_TOWER_HP_RATIO) {
      activateSafeMode(room, controller, `tower at ${pct(tower)}% HP`);
      return;
    }
  }

  // Trigger 3: storage being dismantled (attackers with WORK parts present)
  const hasDismantlers = attackers.some((c) => c.body.some((p) => p.type === WORK));
  if (hasDismantlers) {
    if (room.storage && room.storage.hits < room.storage.hitsMax * SAFEMODE_STORAGE_HP_RATIO) {
      activateSafeMode(room, controller, `storage at ${pct(room.storage)}% HP`);
      return;
    }
    if (room.terminal && room.terminal.hits < room.terminal.hitsMax * SAFEMODE_TERMINAL_HP_RATIO) {
      activateSafeMode(room, controller, `terminal at ${pct(room.terminal)}% HP`);
      return;
    }
  }

  // Defender count is needed by both remaining triggers — scan once.
  const myFighters = room.find(FIND_MY_CREEPS, {
    filter: (c) => c.body.some((p) => p.type === ATTACK || p.type === RANGED_ATTACK),
  });

  // Trigger 4: towers drained + no defenders + sufficient attacker count
  if (towerIds.length > 0) {
    const allTowersDrained = towerIds.every((id) => {
      const t = Game.getObjectById(id) as StructureTower | null;
      return !t || t.store[RESOURCE_ENERGY] < SAFEMODE_MIN_TOWER_ENERGY;
    });
    if (allTowersDrained) {
      if (myFighters.length === 0 && attackers.length >= SAFEMODE_OVERWHELMED_COUNT) {
        activateSafeMode(room, controller, "towers drained, no defenders");
        return;
      }
    }
  }

  // Trigger 5: overwhelmed with no fighters at all
  if (attackers.length >= SAFEMODE_OVERWHELMED_COUNT && myFighters.length === 0 && towerIds.length === 0) {
    activateSafeMode(room, controller, `overwhelmed by ${attackers.length} attackers, no towers or defenders`);
  }
}

function activateSafeMode(room: Room, controller: StructureController, reason: string): void {
  const result = controller.activateSafeMode();
  if (result === OK) {
    const msg = `[SafeMode] Activated in ${room.name} — ${reason}`;
    console.log(msg);
    Game.notify(msg, 30);
  }
}

function pct(s: { hits: number; hitsMax: number }): number {
  return Math.floor((s.hits / s.hitsMax) * 100);
}

// ── Hostile notification ──────────────────────────────────────────────────────

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
