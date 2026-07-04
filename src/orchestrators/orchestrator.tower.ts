import { runTower, selectRoomAttackTarget } from "../roles/role.tower";
import { getThreatInfo, getThreatSeverity, structureDamagePerTick } from "../services/services.combat";
import { isAlly } from "../services/services.allies";

const THREAT_NOTIFY_COOLDOWN = 200;

// ── Safemode thresholds ───────────────────────────────────────────────────────
const SAFEMODE_SPAWN_HP_RATIO   = 0.50;  // spawn below 50% HP
const SAFEMODE_TOWER_HP_RATIO   = 0.25;  // any tower below 25% HP
const SAFEMODE_STORAGE_HP_RATIO = 0.25;  // storage below 25% HP (dismantlers)
const SAFEMODE_TERMINAL_HP_RATIO = 0.25; // terminal below 25% HP
const SAFEMODE_MIN_TOWER_ENERGY = 50;    // towers considered "drained" below this
const SAFEMODE_OVERWHELMED_COUNT = 3;    // attacker count threshold for overwhelmed check

// ── Safe-mode conservation ──────────────────────────────────────────────────────
// Safe mode is a finite, precious resource (a fresh room has very few charges). The
// guards below stop us from spending the LAST charge on a threat that can't actually
// take the room — a lone harasser or a tower-drainer that only chips structures.
//
// We only veto on the FINAL charge: with charges to spare we keep the original, eager
// triggers so a genuine assault is always answered.
const SAFEMODE_LOW_CHARGE = 1;            // "this is our last charge" — be conservative
// A spawn loses this fraction of its max HP per tick of sustained hostile melee/ranged
// fire (DPS / hitsMax). When projected destruction lands within the predictive window
// AND defenders can't stop it, fire BEFORE the spawn reaches 50% rather than after.
const SAFEMODE_SPAWN_PREDICT_TICKS = 12;  // fire if a spawn will die within this many ticks
const SAFEMODE_SPAWN_PREDICT_HP_RATIO = 0.80; // ...and it's already taking real damage (<80% HP)
// Absolute incoming structure DPS (boost-aware, includes ranged + WORK dismantle) at or above
// which a threat is treated as a genuine assault regardless of its severity BUCKET. A spawn
// has ~5000 HP, so ≥400/tick destroys it inside the predictive window — the severity
// thresholds under-rate lethal ranged/dismantle/boosted forces, and this closes that gap so a
// last safe-mode charge is never conserved-against a force that can actually take the room.
const SAFEMODE_LETHAL_DPS = 400;

export function loop() {
  for (const roomName in Game.rooms) {
    const room = Game.rooms[roomName];
    if (!room.controller?.my) continue;

    // One hostile scan per room per tick, shared by notification, safe-mode checks,
    // and tower targeting — these previously ran three separate FIND_HOSTILE_CREEPS.
    // Allies are excluded here (Screeps lists allied creeps under FIND_HOSTILE_CREEPS): we
    // must never shoot them or count them toward the "overwhelmed" safe-mode trigger.
    const hostiles = room.find(FIND_HOSTILE_CREEPS, {
      filter: (c) => !isAlly(c.owner?.username),
    });

    notifyOnHostiles(room, hostiles);
    checkSafeMode(room, hostiles);

    const towerIds = room.memory.towerIds ?? [];
    if (towerIds.length === 0) continue;

    // Compute the room-wide attack target once — all towers focus the same creep.
    const attackTarget = selectRoomAttackTarget(hostiles, room);

    const hasHostiles = hostiles.length > 0;
    for (const id of towerIds) {
      const tower = Game.getObjectById(id) as StructureTower | null;
      if (tower) runTower(tower, attackTarget, hasHostiles);
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

  // Conservation gate: are we down to our last safe-mode charge? When so, refuse to
  // spend it on a low/medium threat (a harasser or a drain-attacker that can't finish
  // the job). The boost-aware severity (getThreatSeverity) sees through TOUGH/heal/attack
  // boosts, so a small-but-deadly boosted squad still reads "high" and is allowed through.
  const lastCharge = controller.safeModeAvailable <= SAFEMODE_LOW_CHARGE;
  const severity = getThreatSeverity(room);
  // Absolute incoming structure DPS (boost-aware, includes ranged + WORK dismantle). The
  // severity BUCKETS under-rate lethal ranged/dismantle/boosted forces (a 3000-dps boosted
  // melee reads "medium", a 1600-dps ranged raid reads "low"), so a genuinely lethal DPS
  // overrides the "trivial" classification and is never conserved-against on the last charge.
  const incomingDps = structureDamagePerTick(attackers);
  const lethalDps = incomingDps >= SAFEMODE_LETHAL_DPS;
  const trivialThreat = (severity === "low" || severity === "medium") && !lethalDps;
  // On the final charge, only a real assault may consume it — where "real" is now a "high"
  // severity OR a lethal raw DPS, so a small boosted ranged/dismantle raid can't slip through.
  const conserve = lastCharge && trivialThreat;

  // A force that can actually breach: enough bodies plus the dismantle/melee power to
  // chew through ramparts, a high boost-aware severity, OR a lethal raw DPS. A pure
  // tower-drainer (a few RANGED_ATTACK kiters with no breaching mass and low total DPS)
  // won't clear this bar, so it can chip towers all day without inducing a wasted safe mode.
  const breaching = isBreachingForce(room, attackers, severity);
  const forceThatCanFinish = breaching || lethalDps;

  // Trigger 1: any spawn critically damaged
  for (const spawn of room.find(FIND_MY_SPAWNS)) {
    if (spawn.hits < spawn.hitsMax * SAFEMODE_SPAWN_HP_RATIO) {
      if (conserve) break; // don't burn the last charge on a trivial threat
      activateSafeMode(room, controller, `spawn at ${pct(spawn)}% HP`);
      return;
    }
  }

  // Trigger 1b (predictive): a spawn is already taking damage and projected incoming
  // hostile DPS (boost-aware, via getThreatInfo) will destroy it within the next several
  // ticks faster than defenders can intervene. Fire EARLY rather than waiting for 50%.
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

  // Trigger 2: any tower critically damaged. Losing towers means losing DPS permanently,
  // but a drain-attacker that merely chips towers (no force that can finish the room)
  // must NOT be able to trick us into spending a charge — gate on a real breaching force.
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

  // Trigger 3: storage being dismantled (attackers with WORK parts present)
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

  // Defender count is needed by both remaining triggers — scan once.
  const myFighters = room.find(FIND_MY_CREEPS, {
    filter: (c) => c.body.some((p) => p.type === ATTACK || p.type === RANGED_ATTACK),
  });

  // Our defenders should veto the last-resort safe mode only while they can plausibly
  // hold. If the attackers more than double our fighters, the room is being overrun and
  // a few defenders shouldn't suppress the trigger. (With zero defenders this is always
  // true for any attacker, preserving the original "no defenders" behavior.)
  const overwhelmed =
    attackers.length >= SAFEMODE_OVERWHELMED_COUNT && myFighters.length * 2 < attackers.length;

  // Trigger 4: towers drained + defenders overwhelmed
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

  // Trigger 5: overwhelmed with no towers at all
  if (overwhelmed && towerIds.length === 0 && !conserve) {
    activateSafeMode(room, controller, `overwhelmed by ${attackers.length} attackers, no towers`);
  }
}

// A "breaching force" is one that can plausibly take the room — not a kiting drainer that
// only chips towers from outside the walls. Two ways to qualify:
//   • high boost-aware severity (a small boosted assault still reads "high"), or
//   • enough bodies AND raw breaching power (melee ATTACK or WORK dismantle parts) to
//     grind through ramparts. RANGED_ATTACK-only harassers have no breaching mass and
//     therefore can never trip a tower/structure safe-mode trigger on their own.
function isBreachingForce(room: Room, attackers: Creep[], severity: string): boolean {
  if (severity === "high") return true;

  // Count live melee + dismantle parts across all attackers; these are what actually
  // remove rampart HP (ranged fire is splashy chip damage, not a wall-breaker).
  let breachParts = 0;
  for (const c of attackers) {
    for (const p of c.body) {
      if (p.hits <= 0) continue;
      if (p.type === ATTACK || p.type === WORK) breachParts++;
    }
  }
  // Roughly a full melee/dismantle creep's worth of working parts present, with enough
  // bodies to absorb tower fire while they work. Tuned to exclude a lone harasser.
  return breachParts >= 10 && attackers.length >= SAFEMODE_OVERWHELMED_COUNT;
}

// Estimate how many ticks until `target` is destroyed by sustained hostile fire. Returns
// undefined only when there is no incoming damage at all. Uses the boost-aware room DPS
// (ATTACK + RANGED + WORK dismantle) so a boosted squad's true output is respected.
//
// No tower-repair credit is applied: whenever a spawn is under fire there IS an attack target,
// and a tower that fires cannot also repair the same tick (runTower attacks and returns). The
// previous version credited ~400 HP/tower/tick of phantom repair that never happens during a
// fight, so it concluded the spawn was "not dying" and this predictive trigger never fired.
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
