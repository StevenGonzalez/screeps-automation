/**
 * Nuke defense. Scans owned rooms for incoming nukes, raises the alarm, and turns
 * the long flight time (NUKE_LAND_TIME ≈ 50,000 ticks) into a reinforcement window:
 * it ensures every critical structure in a blast is under a rampart and records the
 * HP each of those ramparts must reach to survive. Repairers and towers read that
 * record (via services.creep) and pour energy into the threatened ramparts.
 */

const NUKE_IMPACT_DAMAGE = 10_000_000; // dealt to the landing tile (range 0)
const NUKE_SPLASH_DAMAGE = 5_000_000;  // dealt to every tile within range 2

// Reinforcement headroom over the raw incoming damage. A single splash gets the base
// buffer; every ADDITIONAL nuke overlapping the same tile adds more, because stacked
// strikes mean the rampart must also absorb whatever chip damage / repair lag accrued
// from the earlier hits before the next lands — so the survival margin must grow with
// the number of stressors converging on one tile rather than staying flat.
const REINFORCE_BUFFER_BASE = 600_000;       // headroom for a single splash
const REINFORCE_BUFFER_PER_OVERLAP = 400_000; // extra headroom per extra nuke on the tile

// Repair we assume a room can muster against a threatened rampart, used ONLY to decide
// whether reinforcement can win the race (and thus whether to evacuate). Deliberately
// conservative: real repair is energy- and creep-limited, so we under-promise here and
// would rather evacuate a room we could *just barely* have saved than lose its stores.
const TOWER_REPAIR_EFFICIENCY = 0.5;  // discount tower repair (range falloff, split duty, energy)
const REPAIRER_ASSUMED_WORK = 20;     // assumed combined WORK parts across repairers
const EVAC_SAFETY_TICKS = 50;         // stop trusting repair this many ticks before impact

// Don't bother sending dust; terminals have a minimum useful send and a per-send fee.
const EVAC_MIN_SEND = 100;

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
    let overlap = 0; // how many nukes actually strike this tile (splash or direct)
    for (const n of nukes) {
      const range = s.pos.getRangeTo(n.pos);
      // The landing tile takes BOTH the impact hit and the splash (it is within
      // range 2 of itself), i.e. 15M; the rest of the 5x5 takes 5M splash.
      if (range === 0) {
        damage += NUKE_IMPACT_DAMAGE + NUKE_SPLASH_DAMAGE;
        overlap++;
      } else if (range <= 2) {
        damage += NUKE_SPLASH_DAMAGE;
        overlap++;
      }
    }
    if (damage === 0) continue;

    // Scale the survival buffer by how many nukes converge on this tile. One splash gets
    // the base headroom; each additional overlapping strike adds more, since the rampart
    // must also cover repair lag between successive impacts.
    const buffer =
      REINFORCE_BUFFER_BASE + Math.max(0, overlap - 1) * REINFORCE_BUFFER_PER_OVERLAP;
    tiles[`${s.pos.x},${s.pos.y}`] = damage + buffer;

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

  // If the storage/terminal ramparts can't be reinforced in time, salvage their contents.
  considerEvacuation(room, nukes, tiles);
}

// ── Terminal evacuation ──────────────────────────────────────────────────────────
//
// When a strike can't be survived, the terminal's high-value contents (and as much of
// storage as we can shuttle into the terminal) are worth more shipped to another owned
// room than vaporized. We only evacuate the resources we can actually send: the terminal
// sends what IT holds, so we move what's already staged there each tick before impact.
// Reinforcement always takes precedence — if the ramparts WILL hold, we keep everything.
function considerEvacuation(
  room: Room,
  nukes: Nuke[],
  tiles: Record<string, number>
): void {
  const terminal = room.terminal;
  if (!terminal) return; // nothing to send with, and nothing to send from

  // Soonest impact governs the deadline.
  const earliest = nukes.reduce((min, n) => Math.min(min, n.timeToLand), Infinity);
  if (!isFinite(earliest)) return;

  // Will the terminal/storage ramparts survive? If either store-bearing structure sits on
  // a threatened tile whose required HP we CANNOT reach in time, we must evacuate.
  const storeStructures: Structure[] = [];
  if (terminal) storeStructures.push(terminal);
  if (room.storage) storeStructures.push(room.storage);

  let mustEvacuate = false;
  for (const s of storeStructures) {
    const required = tiles[`${s.pos.x},${s.pos.y}`];
    if (required === undefined) continue; // this store isn't in a blast — safe
    if (!canReinforceInTime(room, s.pos, required, earliest)) {
      mustEvacuate = true;
      break;
    }
  }
  if (!mustEvacuate) return;

  evacuate(room, terminal);
}

// True if the rampart over `pos` can be repaired from its current HP up to `required`
// before impact, given a conservative estimate of the room's repair throughput. Tower
// repair is discounted and repairers are assumed (not counted live) so the estimate is
// stable; we stop trusting repair a safety margin before impact.
function canReinforceInTime(
  room: Room,
  pos: RoomPosition,
  required: number,
  ticksToLand: number
): boolean {
  const rampart = pos
    .lookFor(LOOK_STRUCTURES)
    .find((s) => s.structureType === STRUCTURE_RAMPART) as StructureRampart | undefined;
  const currentHp = rampart?.hits ?? 0;

  // A rampart can never exceed its RCL cap (RAMPART_HITS_MAX), so if the survival HP the tile
  // needs is above that ceiling — e.g. stacked nukes on a low-RCL store structure — no amount
  // of repair can save it. Report "can't reinforce" so the caller evacuates the contents
  // instead of trusting a physically-unreachable HP target and losing everything at impact.
  const rcl = room.controller?.level ?? 0;
  const rampartCap = RAMPART_HITS_MAX[rcl] ?? 0;
  if (required > rampartCap) return false;

  const deficit = required - currentHp;
  if (deficit <= 0) return true; // already strong enough

  const usableTicks = Math.max(0, ticksToLand - EVAC_SAFETY_TICKS);
  if (usableTicks === 0) return false;

  const towers = (room.memory.towerIds ?? []).filter((id) => Game.getObjectById(id)).length;
  const repairPerTick =
    towers * TOWER_POWER_REPAIR * TOWER_REPAIR_EFFICIENCY +
    REPAIRER_ASSUMED_WORK * REPAIR_POWER;

  return repairPerTick * usableTicks >= deficit;
}

// Ship the terminal's high-value contents to the nearest safe owned room. One send per
// tick (the terminal goes on cooldown after a send), highest-value resource first, so a
// multi-tick countdown drains the most precious stock earliest. Energy goes last because
// it's cheap and pays the send fees for everything else.
function evacuate(room: Room, terminal: StructureTerminal): void {
  if (terminal.cooldown > 0) return;

  const dest = nearestSafeOwnedRoom(room.name);
  if (!dest) return; // nowhere safe to send — keep what we have rather than lose it to a void

  // Priority: minerals/ghodium/commodities/boosts first, energy last. We sort everything
  // the terminal currently holds with energy forced to the back.
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
      // Sending energy costs energy (the fee), so only ship the surplus above the fee.
      const dist = Game.map.getRoomLinearDistance(room.name, dest);
      const amount = Math.floor(have / (1 + (1 - Math.exp(-dist / 30))));
      if (amount < EVAC_MIN_SEND) continue;
      if (terminal.send(RESOURCE_ENERGY, amount, dest) === OK) {
        console.log(`[Nuke] ${room.name}: evacuated ${amount} energy → ${dest}`);
      }
      return; // one send per tick
    }

    // Non-energy: ensure the terminal has energy to pay the fee, else skip to the next
    // resource (we'd rather evacuate something we CAN pay for than stall on a costly one).
    // The fee is a pure distance/amount formula (matches Game.market.calcTransactionCost) —
    // computed locally so evacuation still works on servers with no market (e.g. Season).
    const dist = Game.map.getRoomLinearDistance(room.name, dest);
    const fee = Math.ceil(have * (1 - Math.exp(-dist / 30)));
    if ((terminal.store[RESOURCE_ENERGY] ?? 0) < fee) {
      // Try a smaller, affordable chunk so we still rescue part of the stock.
      const spareEnergy = terminal.store[RESOURCE_ENERGY] ?? 0;
      const perUnitCost = fee / have;
      const affordable = perUnitCost > 0 ? Math.floor(spareEnergy / perUnitCost) : 0;
      if (affordable < EVAC_MIN_SEND) continue;
      if (terminal.send(rc, affordable, dest) === OK) {
        console.log(`[Nuke] ${room.name}: evacuated ${affordable} ${rc} → ${dest} (partial)`);
      }
      return;
    }

    if (terminal.send(rc, have, dest) === OK) {
      console.log(`[Nuke] ${room.name}: evacuated ${have} ${rc} → ${dest}`);
    }
    return; // one send per tick
  }
}

// Nearest owned room (with a terminal, off cooldown irrelevant for receiving) that is NOT
// itself under nuke fire — so we never evacuate into another doomed room or a non-existent
// one. Returns undefined when no safe destination exists.
function nearestSafeOwnedRoom(from: string): string | undefined {
  let best: string | undefined;
  let bestDist = Infinity;
  for (const name in Game.rooms) {
    if (name === from) continue;
    const r = Game.rooms[name];
    if (!r.controller?.my || !r.terminal) continue;
    // Skip rooms that themselves have an inbound nuke — don't pour stock into a target.
    if (r.find(FIND_NUKES).length > 0) continue;
    const dist = Game.map.getRoomLinearDistance(from, name);
    if (dist < bestDist) {
      bestDist = dist;
      best = name;
    }
  }
  return best;
}
