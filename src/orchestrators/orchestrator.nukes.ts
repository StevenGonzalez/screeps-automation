/**
 * Nuke defense. Scans owned rooms for incoming nukes, raises the alarm, and turns
 * the long flight time (NUKE_LAND_TIME ≈ 50,000 ticks) into a reinforcement window:
 * it ensures every critical structure in a blast is under a rampart and records the
 * HP each of those ramparts must reach to survive. Repairers and towers read that
 * record (via services.creep) and pour energy into the threatened ramparts.
 */

const NUKE_IMPACT_DAMAGE = 10_000_000; // dealt to the landing tile (range 0)
const NUKE_SPLASH_DAMAGE = 5_000_000;  // dealt to every tile within range 2
const REINFORCE_BUFFER = 600_000;      // HP headroom over raw incoming damage

// Structures worth protecting from a nuke. Walls/ramparts/roads/containers are not
// worth reinforcing against a strike that can simply land elsewhere.
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
  // Re-alert when the threat changes (a new nuke arrives), not every tick.
  if (prev && prev.count === nukes.length && prev.land === land) return;
  room.memory.nukeAlert = { count: nukes.length, land };
  const msg = `[Nuke] ${room.name}: ${nukes.length} inbound — first impact in ${earliest} ticks (tick ${land})`;
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
    for (const n of nukes) {
      const range = s.pos.getRangeTo(n.pos);
      // The landing tile takes BOTH the impact hit and the splash (it is within
      // range 2 of itself), i.e. 15M; the rest of the 5x5 takes 5M splash.
      if (range === 0) damage += NUKE_IMPACT_DAMAGE + NUKE_SPLASH_DAMAGE;
      else if (range <= 2) damage += NUKE_SPLASH_DAMAGE;
    }
    if (damage === 0) continue;

    tiles[`${s.pos.x},${s.pos.y}`] = damage + REINFORCE_BUFFER;

    // Ensure the structure sits under a rampart so it can be reinforced at all.
    // Skip if one already exists or is already queued, so we don't spam failing
    // createConstructionSite calls every tick while the site is being built.
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
}
