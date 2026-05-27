import { runTower } from "../roles/role.tower";

const THREAT_NOTIFY_COOLDOWN = 200;

export function loop() {
  for (const roomName in Game.rooms) {
    const room = Game.rooms[roomName];
    if (!room.controller?.my) continue;
    notifyOnHostiles(room);
    checkSafeMode(room);
    const towerIds = room.memory.towerIds ?? [];
    for (const id of towerIds) {
      const tower = Game.getObjectById(id);
      if (tower) runTower(tower);
    }
  }
}

function checkSafeMode(room: Room): void {
  const controller = room.controller;
  if (!controller?.my) return;
  if (controller.safeMode) return;
  if (!controller.safeModeAvailable) return;

  // Only consider creeps that can actually damage structures
  const attackers = room.find(FIND_HOSTILE_CREEPS, {
    filter: (c) =>
      c.body.some(
        (p) => p.type === ATTACK || p.type === RANGED_ATTACK || p.type === WORK
      ),
  });
  if (attackers.length === 0) return;

  // Trigger 1: any spawn is below 50% HP
  const spawns = room.find(FIND_MY_SPAWNS);
  for (const spawn of spawns) {
    if (spawn.hits < spawn.hitsMax * 0.5) {
      controller.activateSafeMode();
      const pct = Math.floor((spawn.hits / spawn.hitsMax) * 100);
      console.log(`[SafeMode] Activated in ${room.name} — spawn at ${pct}% HP`);
      Game.notify(`[SafeMode] ${room.name}: spawn under attack (${pct}% HP)`, 30);
      return;
    }
  }

  // Trigger 2: overwhelmed — 3+ attackers and no friendly fighters alive
  const myFighters = room.find(FIND_MY_CREEPS, {
    filter: (c) =>
      c.body.some((p) => p.type === ATTACK || p.type === RANGED_ATTACK),
  });
  if (attackers.length >= 3 && myFighters.length === 0) {
    controller.activateSafeMode();
    console.log(
      `[SafeMode] Activated in ${room.name} — overwhelmed by ${attackers.length} attackers`
    );
    Game.notify(
      `[SafeMode] ${room.name}: overwhelmed by ${attackers.length} attackers`,
      30
    );
  }
}

function notifyOnHostiles(room: Room): void {
  const hostiles = room.find(FIND_HOSTILE_CREEPS);
  if (hostiles.length === 0) return;

  if (!Memory.threatNotifyLastTick) {
    Memory.threatNotifyLastTick = {};
  }

  const last = Memory.threatNotifyLastTick[room.name] || 0;
  if (Game.time - last < THREAT_NOTIFY_COOLDOWN) return;

  const message = `[Threat] ${room.name}: ${hostiles.length} hostile creeps at tick ${Game.time}`;
  console.log(message);
  Game.notify(message, 30);
  Memory.threatNotifyLastTick[room.name] = Game.time;
}
