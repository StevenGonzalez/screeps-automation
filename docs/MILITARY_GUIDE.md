# Military System

> **Status**: Implemented. Towers fire automatically via `orchestrator.tower.ts` and
> safe mode is handled automatically. Offensive squad warfare (formations + tactics),
> organized home defense (Biter, Spitter, Licker), and the WarCouncil intel/targeting
> layer are live. Squad coordination lives in `orchestrators/orchestrator.military.ts`;
> combat targeting and formation geometry live in `services/services.combat.ts`.

---

## Overview
The military system provides squad-based combat with formation movement, tactical
behaviors, intelligent target prioritization, and boosted combat creeps. Offensive
operations run **concurrently - one per home room** (`Memory.militaryOps`, keyed by
home room), with extra targets lined up in an offensive **queue**
(`Memory.militaryQueue`). A separate **DefenseCouncil** auto-raises a standing
defensive squad whenever an owned room is meaningfully threatened
(`Memory.defenseOps`). All of this is live, not planned.

## Key Features
- **Squad Coordinator**: 4 formations x 5 tactics, with a leader-led cohesion model
  so the squad commits as one body instead of trickling in piecemeal.
- **Formation Movement**: followers hold positions relative to the squad leader; the
  leader only advances when the squad is together (cohesive), which also stages the
  group at each room border before pushing in.
- **Intelligent Targeting**: priority-based selection for both creeps (healers first)
  and structures (spawns/towers first, then economy), with rampart-shield breaking.
- **Role-Based Combat**: Biter (melee/tank), Spitter (ranged kiter), Licker (healer),
  Chewer (boosted dismantler for breaching).
- **Dynamic Adaptation**: auto-retreat on sustained casualties (tactic-dependent
  threshold), heal at home, then resume; spitters kite automatically.
- **Boost Integration**: combat creeps auto-request the best available boost for their
  combat part (attack / ranged / heal / dismantle) and are boosted at the labs.
- **WarCouncil**: scans visible rooms, scores them 0-10, ranks enemy targets, and can
  optionally auto-launch attacks against soft targets.
- **DefenseCouncil**: automatically raises a standing defensive squad when an owned
  room is under a meaningful (healer-backed / tower-overwhelming) threat, and stands
  it down once the room stays clear.
- **Concurrent ops + queue**: one offensive op per home room runs independently;
  further targets auto-start against free home rooms from a queue.
- **Console Control**: real-time command and control via `Game.arca`.

## Console Commands

### Launch Attack
```javascript
Game.arca.attack('W2N1');                       // box / assault, auto-scaled squad
Game.arca.attack('W2N1', 'wedge', 'siege');     // choose formation + tactic
Game.arca.attack('W2N1', 'box', 'assault', { biters: 4, lickers: 2, chewers: 1 });
Game.arca.attack('W2N1', 'box', 'assault', undefined, 'W1N1'); // force funding home
// Parameters:
//   targetRoom:   room to attack
//   formation:    'line' | 'box' | 'wedge' | 'scatter'   (default 'box')
//   tactic:       'assault' | 'siege' | 'raid' | 'defend' (default 'assault')
//   composition:  optional { biters, spitters, lickers, chewers } override.
//                 Omitted roles fall back to an intel-scaled recommendation.
//   homeRoom:     optional funding home; default is the closest owned room.
```
**Concurrency is one op per home room.** If the chosen home is already running an
op, the target is automatically **queued** and auto-starts when that home (or
another free, capable home) frees up. A capable home is RCL 5+ with >= 50k storage
energy. Remove a queued target with `Game.arca.dequeueAttack('W2N1')`.

### Check Squad Status
```javascript
Game.arca.squads();
// Shows every active op (one per home room): phase, formation, tactic, required vs
// current composition, average HP, how many units reached the target, a per-creep
// list, plus the offensive queue. (Game.arca.military() is an alias.)
Game.arca.ops();      // one-line overview of ALL pipelines (expansion, offensive, SK)
```

### Change Formation (Mid-Battle)
```javascript
Game.arca.formation('wedge');          // applies to ALL active ops
Game.arca.formation('wedge', 'W1N1');  // ...or just the op funded by W1N1
```

### Change Tactic (Mid-Battle)
```javascript
Game.arca.tactic('siege');             // applies to ALL active ops
Game.arca.tactic('siege', 'W1N1');     // ...or just the op funded by W1N1
```
`tactic('retreat')` falls the squad back home and holds there until you issue a new
tactic. The safety auto-retreat (on low HP) stays active under every tactic and
preserves your chosen tactic when the squad re-engages after healing.

### Recall Units
```javascript
Game.arca.recall();             // abort every op and stand all units down
Game.arca.recall('W1N1');       // ...or just the op funded by W1N1
// (Game.arca.retreat() is an alias for recall() with no argument.)
```

### WarCouncil
```javascript
Game.arca.warcouncil();         // show ranked enemy rooms + auto-attack status
Game.arca.warcouncil(true);     // enable auto-attack on soft targets
Game.arca.warcouncil(false);    // disable (default)
```

### Defense status
```javascript
Game.arca.threat();             // per-room threat severity/score, hostiles, towers, safemode
Game.arca.safemode('W1N1');     // manually activate safe mode in a room
```

## Formations

Offsets are relative to the leader (slot 0). Members are slotted front-to-back by role
- tanks/chewers front, healers center, ranged back - so each formation expresses its
doctrine. The formation reorients naturally as the leader moves.

### Line
Wide single row. Best for corridor fighting and spreading out along a front.

### Box (Default)
Layered 3-wide block: biters front, lickers center, spitters back. Best balanced
formation for most engagements.

### Wedge
V-shape with the leader at the point. Best for aggressive pushes and breaking a line.

### Scatter
Dispersed with gaps between units. Best for blunting tower splash and area fire.

## Tactics

### Assault (default)
Advance in formation, engage all hostiles, then raze structures (spawns first, then
towers and the economy). Best for wiping an enemy room.

### Siege
Chewers dismantle structures with towers prioritized first (cut defensive fire),
while biters screen them and lickers keep them alive. Best for fortified rooms.

### Raid
Hit-and-run. Same advance, but the auto-retreat threshold is high (55% avg HP) so the
squad strikes and pulls back to heal before committing again. Completes once spawns
and towers are gone.

### Defend
Hold within 3 tiles of the target room center and engage only nearby hostiles. Does
not self-complete - recall to end it. Best for holding a position or contested room.

### Retreat
All units fall back to the home spawn. Auto-triggered when average squad HP drops
below the tactic's threshold (assault 40%, siege 35%, raid 55%, defend 30%); the squad
heals at home to 85% and then resumes the prior tactic.

## Combat Roles

### Biter () - `biter`
Melee tank. TOUGH front-loaded so armor absorbs hits before ATTACK parts die. Usually
the squad leader. Boosted with the attack line (UH -> UH2O -> XUH2O).

### Spitter () - `spitter`
Ranged kiter. Holds enemies at range 3, uses `rangedMassAttack` when 3+ are close,
otherwise focuses the squad's priority target. Boosted with the ranged line
(KO -> KHO2 -> XKHO2).

### Licker () - `licker`
Healer. Heals the lowest-HP% squad member (range 1 `heal`, range 3 `rangedHeal`),
self-heals, and stays in the formation's protected center. Boosted with the heal line
(LO -> LHO2 -> XLHO2). Also spawns for home defense during high-threat scenarios.

### Chewer () - `chewer`
Boosted dismantler. TOUGH soaks tower fire while WORK parts dismantle ramparts and
raze structures far faster than melee. Operates only as part of an operation - too
fragile to act alone. Boosted with the dismantle line (ZH -> ZH2O -> XZH2O).

## Target Priority System

### Creeps (focus fire, lowest score first)
1. **Healers** - eliminate support first (they undo your damage)
2. **Attackers / Ranged** - neutralize what can actually hurt the squad
3. **Workers / Dismantlers**
4. **Unarmed** (claimers, haulers, scouts)

Nearly-dead hostiles are bumped up a tier (finish the kill); ties break by proximity
then remaining HP, so the whole squad concentrates fire.

### Structures (lowest number = struck first)
Spawn (10) -> Tower (15) -> Nuker (20) -> Terminal (25) -> Lab (30) -> Storage (35) ->
Power Spawn (40) -> Observer (45) -> Extension (60) -> Link (70) -> Extractor (80) ->
Container (90). **Siege** flips towers to the top. If the chosen target sits under a
rampart, the rampart is broken first.

## Integration with Existing Systems

### Spawn Queue
- Defensive Biters/Spitters/Lickers jump the economy queue under threat (high-severity
  raids take priority over munchers - a dead muncher respawns, a dead spawn does not).
- Offensive squad creeps spawn at full energy capacity for max-strength bodies, in
  formation order (biters -> chewers -> spitters -> lickers).

### DefenseCouncil (automatic standing defense)
Runs every 5 ticks inside `orchestrator.military.ts`, separate from the manual
offensive ops. Each owned room is its own theatre:

- **Trigger**: a room whose threat is high-severity, or whose threat score >= 150
  (~ a healer-backed raid towers can't comfortably out-damage), gets a `DefenseOp`
  declared in `Memory.defenseOps[roomName]`.
- **Spawning**: the spawn orchestrator reads `getDefenseOp(room)` and raises the
  needed biters/lickers/spitters, jumping the economy queue. Composition scales with
  the threat score (up to 4 biters, 2 lickers, +1 spitter for ranged-heavy raids).
- **Behavior**: defenders rally and fight **inside** the threatened room only. They
  focus-fire with the same healers-first priority as offensive squads, hold near the
  rally point, and refuse to chase hostiles onto room-edge exit tiles (so a kiting
  raider can't peel them out of the room).
- **Stand-down**: once the room stays clear for 25 ticks the op is cleared and the
  defenders are released.
- **Safe mode**: the DefenseCouncil never triggers or cancels safe mode. It fights
  before and alongside it; towers still trigger safe mode as a last resort.

> Bootstrapping child rooms get a related hook: when an in-progress expansion's child
> room is invaded, `Memory.expansion.needsDefender` is set and the funding home spawns
> a defender (see [EXPANSION_SYSTEM.md](EXPANSION_SYSTEM.md)).

### Towers
Towers focus-fire one target room-wide and auto-trigger safe mode when structures are
critically damaged (`orchestrator.tower.ts`).

### WarCouncil (offensive intel)
- Scans visible non-owned rooms every 50 ticks into `Memory.intel`, scoring threat 0-10.
- Ranks enemy rooms for targeting (lowest threat first).
- Optional auto-attack (off by default) launches against soft, nearby enemy rooms,
  rate-limited to once per 1000 ticks. It only uses a **free, capable** home (RCL 5+,
  50k+ energy, not already running an op) and respects the per-home concurrency limit.

## Tips
1. **Start with box/assault** for standard attacks; the squad auto-scales to defenses.
2. **Watch HP** with `Game.arca.squads()` - the squad auto-retreats and re-pushes.
3. **Use wedge for offense, box for defense, scatter against towers.**
4. **Use siege** (with chewers) against fortified rooms; towers fall first.
5. **Scout first** - `Game.arca.warcouncil()` shows what intel knows about a target.
6. **Energy reserve** - keep the home room healthy before launching; offensive bodies
   are expensive and spawn at full capacity.
