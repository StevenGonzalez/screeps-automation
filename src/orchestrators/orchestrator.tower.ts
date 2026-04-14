import { runTower } from "../roles/role.tower";

const THREAT_NOTIFY_COOLDOWN = 200;

export function loop() {
  for (const roomName in Game.rooms) {
    const room = Game.rooms[roomName];
    if (room.controller && room.controller.my) {
      notifyOnHostiles(room);
    }
    const towers = room.find(FIND_STRUCTURES, {
      filter: (s) => s.structureType === STRUCTURE_TOWER,
    }) as StructureTower[];
    for (const tower of towers) {
      runTower(tower);
    }
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
