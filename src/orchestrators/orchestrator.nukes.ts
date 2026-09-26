import { ROLE_REPAIRER } from "../config/config.roles";

const NUKE_IMPACT_DAMAGE = 10_000_000;
const NUKE_SPLASH_DAMAGE = 5_000_000;

const REINFORCE_BUFFER_BASE = 600_000;
const REINFORCE_BUFFER_PER_OVERLAP = 400_000;

const TOWER_REPAIR_EFFICIENCY = 0.5;
const EVAC_DECISION_WINDOW = 5000;
const EVAC_SAFETY_TICKS = 50;

const EVAC_MIN_SEND = 100;

const CRITICAL_TYPES = new Set<StructureConstant>([
  STRUCTURE_SPAWN,
  STRUCTURE_STORAGE,
  STRUCTURE_TERMINAL,
  STRUCTURE_TOWER,
  STRUCTURE_NUKER,
  STRUCTURE_POWER_SPAWN,
  STRUCTURE_FACTORY,
  STRUCTURE_LAB,
]);

export function loop(): void {
  for (const roomName in Game.rooms) {
    const room = Game.rooms[roomName];
    if (!room.controller?.my) continue;

    const nukes = room.find(FIND_NUKES);
    if (nukes.length === 0) {
      if (room.memory.nukeDefense) delete room.memory.nukeDefense;
      if (room.memory.nukeAlert) delete room.memory.nukeAlert;
      continue;
    }

    notify(room, nukes);
    reinforce(room, nukes);
  }
}

function notify(room: Room, nukes: Nuke[]): void {
  const earliest = nukes.reduce((min, n) => Math.min(min, n.timeToLand), Infinity);
  const land = Game.time + earliest;
  const prev = room.memory.nukeAlert;
  if (prev && prev.count === nukes.length && prev.land === land) return;
  room.memory.nukeAlert = { count: nukes.length, land };
  const msg = `[Nuke] ${room.name}: ${nukes.length} inbound - first impact in ${earliest} ticks (tick ${land})`;
  console.log(msg);
  Game.notify(msg, 60);
}

function reinforce(room: Room, nukes: Nuke[]): void {
  const critical = room.find(FIND_MY_STRUCTURES, {
    filter: (s) => CRITICAL_TYPES.has(s.structureType),
  });

  const tiles: Record<string, number> = {};
  for (const s of critical) {
    let damage = 0;
    let overlap = 0;
    for (const n of nukes) {
      const range = s.pos.getRangeTo(n.pos);
      if (range === 0) {
        damage += NUKE_IMPACT_DAMAGE;
        overlap++;
      } else if (range <= 2) {
        damage += NUKE_SPLASH_DAMAGE;
        overlap++;
      }
    }
    if (damage === 0) continue;

    const buffer =
      REINFORCE_BUFFER_BASE + Math.max(0, overlap - 1) * REINFORCE_BUFFER_PER_OVERLAP;
    tiles[`${s.pos.x},${s.pos.y}`] = damage + buffer;

    const hasRampart = s.pos
      .lookFor(LOOK_STRUCTURES)
      .some((st) => st.structureType === STRUCTURE_RAMPART);
    const rampartQueued = s.pos
      .lookFor(LOOK_CONSTRUCTION_SITES)
      .some((cs) => cs.structureType === STRUCTURE_RAMPART);
    if (!hasRampart && !rampartQueued) {
      room.createConstructionSite(s.pos.x, s.pos.y, STRUCTURE_RAMPART);
    }
  }

  room.memory.nukeDefense = { tiles, updatedAt: Game.time };

  considerEvacuation(room, nukes, tiles);
}

function considerEvacuation(
  room: Room,
  nukes: Nuke[],
  tiles: Record<string, number>
): void {
  const terminal = room.terminal;
  if (!terminal) return;

  const earliest = nukes.reduce((min, n) => Math.min(min, n.timeToLand), Infinity);
  if (!isFinite(earliest)) return;
  // Decide late: by then the repairers the nuke triggers are alive and counted,
  // and the terminal still has ample cooldowns left to empty itself.
  if (earliest > EVAC_DECISION_WINDOW) return;

  const storeStructures: Structure[] = [];
  if (terminal) storeStructures.push(terminal);
  if (room.storage) storeStructures.push(room.storage);

  const threatensStore = storeStructures.some(
    (s) => tiles[`${s.pos.x},${s.pos.y}`] !== undefined
  );
  if (!threatensStore) return;

  if (!canReinforceInTime(room, storeStructures, tiles, earliest)) evacuate(room, terminal);
}

// Repairers and towers share one budget across every threatened tile, so the
// question is whether the combined deficit fits, not whether any one tile does.
function canReinforceInTime(
  room: Room,
  storeStructures: Structure[],
  tiles: Record<string, number>,
  ticksToLand: number
): boolean {
  const rcl = room.controller?.level ?? 0;
  const rampartCap = RAMPART_HITS_MAX[rcl] ?? 0;
  for (const s of storeStructures) {
    const required = tiles[`${s.pos.x},${s.pos.y}`];
    if (required !== undefined && required > rampartCap) return false;
  }

  let deficit = 0;
  for (const key in tiles) {
    const [x, y] = key.split(",").map(Number);
    const rampart = room
      .lookForAt(LOOK_STRUCTURES, x, y)
      .find((s) => s.structureType === STRUCTURE_RAMPART) as StructureRampart | undefined;
    // Repair past a rampart's hitsMax is impossible, so count each tile only up to it.
    deficit += Math.max(0, Math.min(tiles[key], rampartCap) - (rampart?.hits ?? 0));
  }
  if (deficit <= 0) return true;

  const usableTicks = Math.max(0, ticksToLand - EVAC_SAFETY_TICKS);
  if (usableTicks === 0) return false;

  const towers = (room.memory.towerIds ?? []).filter((id) => {
    const tower = Game.getObjectById(id);
    return tower && tower.store[RESOURCE_ENERGY] > 0;
  }).length;
  let repairerWork = 0;
  for (const c of room.find(FIND_MY_CREEPS)) {
    if (c.memory.role !== ROLE_REPAIRER) continue;
    repairerWork += c.getActiveBodyparts(WORK);
  }
  const repairPerTick =
    towers * TOWER_POWER_REPAIR * TOWER_REPAIR_EFFICIENCY + repairerWork * REPAIR_POWER;

  return repairPerTick * usableTicks >= deficit;
}

function evacuate(room: Room, terminal: StructureTerminal): void {
  if (terminal.cooldown > 0) return;

  const dest = nearestSafeOwnedRoom(room.name);
  if (!dest) return;

  const contents = Object.keys(terminal.store) as ResourceConstant[];
  contents.sort((a, b) => {
    if (a === RESOURCE_ENERGY) return 1;
    if (b === RESOURCE_ENERGY) return -1;
    return (terminal.store[b] ?? 0) - (terminal.store[a] ?? 0);
  });

  for (const rc of contents) {
    const have = terminal.store.getUsedCapacity(rc) ?? 0;
    if (have < EVAC_MIN_SEND) continue;

    if (rc === RESOURCE_ENERGY) {
      const dist = Game.map.getRoomLinearDistance(room.name, dest);
      const amount = Math.floor(have / (1 + (1 - Math.exp(-dist / 30))));
      if (amount < EVAC_MIN_SEND) continue;
      if (terminal.send(RESOURCE_ENERGY, amount, dest) === OK) {
        console.log(`[Nuke] ${room.name}: evacuated ${amount} energy -> ${dest}`);
      }
      return;
    }

    const dist = Game.map.getRoomLinearDistance(room.name, dest);
    const fee = Math.ceil(have * (1 - Math.exp(-dist / 30)));
    if ((terminal.store[RESOURCE_ENERGY] ?? 0) < fee) {
      const spareEnergy = terminal.store[RESOURCE_ENERGY] ?? 0;
      const perUnitCost = fee / have;
      const affordable = perUnitCost > 0 ? Math.floor(spareEnergy / perUnitCost) : 0;
      if (affordable < EVAC_MIN_SEND) continue;
      if (terminal.send(rc, affordable, dest) === OK) {
        console.log(`[Nuke] ${room.name}: evacuated ${affordable} ${rc} -> ${dest} (partial)`);
      }
      return;
    }

    if (terminal.send(rc, have, dest) === OK) {
      console.log(`[Nuke] ${room.name}: evacuated ${have} ${rc} -> ${dest}`);
    }
    return;
  }
}

function nearestSafeOwnedRoom(from: string): string | undefined {
  let best: string | undefined;
  let bestDist = Infinity;
  for (const name in Game.rooms) {
    if (name === from) continue;
    const r = Game.rooms[name];
    if (!r.controller?.my || !r.terminal) continue;
    if (r.find(FIND_NUKES).length > 0) continue;
    const dist = Game.map.getRoomLinearDistance(from, name);
    if (dist < bestDist) {
      bestDist = dist;
      best = name;
    }
  }
  return best;
}
