import {
  ROLE_HARVESTER,
  ROLE_MINER,
  ROLE_HAULER,
  ROLE_UPGRADER,
  ROLE_BUILDER,
  ROLE_REPAIRER,
} from "../config/config.roles";

const TELEMETRY_INTERVAL = 25;
const MILESTONE_ROLES = [ROLE_MINER, ROLE_HAULER, ROLE_UPGRADER, ROLE_BUILDER, ROLE_REPAIRER];
const LINE_ROLES = [
  ROLE_HARVESTER,
  ROLE_MINER,
  ROLE_HAULER,
  ROLE_UPGRADER,
  ROLE_BUILDER,
  ROLE_REPAIRER,
];

function isEnabled(): boolean {
  if (Memory.bootstrapTelemetry !== undefined) return Memory.bootstrapTelemetry;
  return Game.shard?.name === "sim";
}

export function loop(): void {
  if (!isEnabled()) return;
  for (const name in Game.rooms) {
    const room = Game.rooms[name];
    if (room.controller?.my) reportRoom(room);
  }
}

function countRolesInRoom(room: Room): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const name in Game.creeps) {
    const creep = Game.creeps[name];
    if ((creep.memory.homeRoom ?? creep.room.name) !== room.name) continue;
    counts[creep.memory.role] = (counts[creep.memory.role] ?? 0) + 1;
  }
  return counts;
}

function reportRoom(room: Room): void {
  const controller = room.controller!;
  const rcl = controller.level;

  const lastRcl = (Memory.bootstrapRcl ??= {});
  const prevRcl = lastRcl[room.name];
  if (prevRcl !== undefined && rcl !== prevRcl) {
    console.log(`[BOOT ${room.name}] t=${Game.time} RCL ${prevRcl}->${rcl}`);
  }
  lastRcl[room.name] = rcl;

  const counts = countRolesInRoom(room);

  const seenByRoom = (Memory.bootstrapSeen ??= {});
  const seen = (seenByRoom[room.name] ??= []);
  for (const role of MILESTONE_ROLES) {
    if ((counts[role] ?? 0) > 0 && !seen.includes(role)) {
      seen.push(role);
      console.log(`[BOOT ${room.name}] t=${Game.time} first ${role}`);
    }
  }

  if (Game.time % TELEMETRY_INTERVAL !== 0) return;

  const spawns = room.find(FIND_MY_SPAWNS);
  const spawnState = spawns.some((s) => s.spawning) ? "busy" : "IDLE";
  const droppedEnergy = room
    .find(FIND_DROPPED_RESOURCES)
    .filter((r) => r.resourceType === RESOURCE_ENERGY)
    .reduce((sum, r) => sum + r.amount, 0);
  const sites = room.find(FIND_CONSTRUCTION_SITES).length;
  const progressPct = controller.progressTotal
    ? Math.floor((controller.progress / controller.progressTotal) * 100)
    : 0;
  const store = room.storage?.store[RESOURCE_ENERGY] ?? 0;
  const roleSummary = LINE_ROLES.map((r) => `${r}=${counts[r] ?? 0}`).join(" ");

  console.log(
    `[BOOT ${room.name}] t=${Game.time} rcl=${rcl}(${progressPct}%) ` +
      `e=${room.energyAvailable}/${room.energyCapacityAvailable} store=${store} | ` +
      `${roleSummary} | sites=${sites} dropped=${droppedEnergy} spawn=${spawnState}`
  );
}
