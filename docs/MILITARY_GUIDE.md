# Military System

> **Status**: Implemented. Towers fire automatically via `orchestrator.tower.ts` and
> safe mode is handled automatically. Offensive squad warfare (formations + tactics),
> organized home defense (Knight, Wizard, Cleric), and the WarCouncil intel/targeting
> layer are live. Squad coordination lives in `orchestrators/orchestrator.military.ts`;
> combat targeting and formation geometry live in `services/services.combat.ts`.

---

## Overview
The military system provides squad-based combat with formation movement, tactical
behaviors, intelligent target prioritization, and boosted combat creeps. A single
offensive operation runs at a time (`Memory.militaryOp`), commanded from the console.

## Key Features
- **Squad Coordinator**: 4 formations × 5 tactics, with a leader-led cohesion model
  so the squad commits as one body instead of trickling in piecemeal.
- **Formation Movement**: followers hold positions relative to the squad leader; the
  leader only advances when the squad is together (cohesive), which also stages the
  group at each room border before pushing in.
- **Intelligent Targeting**: priority-based selection for both creeps (healers first)
  and structures (spawns/towers first, then economy), with rampart-shield breaking.
- **Role-Based Combat**: Knight (melee/tank), Wizard (ranged kiter), Cleric (healer),
  Sieger (boosted dismantler for breaching).
- **Dynamic Adaptation**: auto-retreat on sustained casualties (tactic-dependent
  threshold), heal at home, then resume; wizards kite automatically.
- **Boost Integration**: combat creeps auto-request the best available boost for their
  combat part (attack / ranged / heal / dismantle) and are boosted at the labs.
- **WarCouncil**: scans visible rooms, scores them 0–10, ranks enemy targets, and can
  optionally auto-launch attacks against soft targets.
- **Console Control**: real-time command and control via `Game.arca`.

## Console Commands

### Launch Attack
```javascript
Game.arca.attack('W2N1');                       // box / assault, auto-scaled squad
Game.arca.attack('W2N1', 'wedge', 'siege');     // choose formation + tactic
Game.arca.attack('W2N1', 'box', 'assault', { knights: 4, clerics: 2, siegers: 1 });
// Parameters:
//   targetRoom:   room to attack
//   formation:    'line' | 'box' | 'wedge' | 'scatter'   (default 'box')
//   tactic:       'assault' | 'siege' | 'raid' | 'defend' (default 'assault')
//   composition:  optional { knights, wizards, clerics, siegers } override.
//                 Omitted roles fall back to an intel-scaled recommendation.
```
The home room is chosen automatically as the closest owned room to the target.

### Check Squad Status
```javascript
Game.arca.squads();
// Shows phase, formation, tactic, required vs current composition,
// average HP, how many units have reached the target room, and a per-creep list.
```

### Change Formation (Mid-Battle)
```javascript
Game.arca.formation('wedge');   // line | box | wedge | scatter
```

### Change Tactic (Mid-Battle)
```javascript
Game.arca.tactic('siege');      // assault | siege | raid | defend | retreat
```
`tactic('retreat')` falls the squad back home and holds there until you issue a new
tactic. The safety auto-retreat (on low HP) stays active under every tactic and
preserves your chosen tactic when the squad re-engages after healing.

### Recall All Units
```javascript
Game.arca.recall();             // abort the op and stand all units down
// (Game.arca.retreat() and Game.arca.military() remain as aliases.)
```

### WarCouncil
```javascript
Game.arca.warcouncil();         // show ranked enemy rooms + auto-attack status
Game.arca.warcouncil(true);     // enable auto-attack on soft targets
Game.arca.warcouncil(false);    // disable (default)
```

## Formations

Offsets are relative to the leader (slot 0). Members are slotted front-to-back by role
— tanks/siegers front, healers center, ranged back — so each formation expresses its
doctrine. The formation reorients naturally as the leader moves.

### Line
Wide single row. Best for corridor fighting and spreading out along a front.

### Box (Default)
Layered 3-wide block: knights front, clerics center, wizards back. Best balanced
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
Siegers dismantle structures with towers prioritized first (cut defensive fire),
while knights screen them and clerics keep them alive. Best for fortified rooms.

### Raid
Hit-and-run. Same advance, but the auto-retreat threshold is high (55% avg HP) so the
squad strikes and pulls back to heal before committing again. Completes once spawns
and towers are gone.

### Defend
Hold within 3 tiles of the target room center and engage only nearby hostiles. Does
not self-complete — recall to end it. Best for holding a position or contested room.

### Retreat
All units fall back to the home spawn. Auto-triggered when average squad HP drops
below the tactic's threshold (assault 40%, siege 35%, raid 55%, defend 30%); the squad
heals at home to 85% and then resumes the prior tactic.

## Combat Roles

### Knight (⚔️) — `knight`
Melee tank. TOUGH front-loaded so armor absorbs hits before ATTACK parts die. Usually
the squad leader. Boosted with the attack line (UH → UH₂O → XUH₂O).

### Wizard (🏹) — `wizard`
Ranged kiter. Holds enemies at range 3, uses `rangedMassAttack` when 3+ are close,
otherwise focuses the squad's priority target. Boosted with the ranged line
(KO → KHO₂ → XKHO₂).

### Cleric (➕) — `cleric`
Healer. Heals the lowest-HP% squad member (range 1 `heal`, range 3 `rangedHeal`),
self-heals, and stays in the formation's protected center. Boosted with the heal line
(LO → LHO₂ → XLHO₂). Also spawns for home defense during high-threat scenarios.

### Sieger (🔧) — `sapper`
Boosted dismantler. TOUGH soaks tower fire while WORK parts dismantle ramparts and
raze structures far faster than melee. Operates only as part of an operation — too
fragile to act alone. Boosted with the dismantle line (ZH → ZH₂O → XZH₂O).

## Target Priority System

### Creeps (focus fire, lowest score first)
1. **Healers** — eliminate support first (they undo your damage)
2. **Attackers / Ranged** — neutralize what can actually hurt the squad
3. **Workers / Dismantlers**
4. **Unarmed** (claimers, haulers, scouts)

Nearly-dead hostiles are bumped up a tier (finish the kill); ties break by proximity
then remaining HP, so the whole squad concentrates fire.

### Structures (lowest number = struck first)
Spawn (10) → Tower (15) → Nuker (20) → Terminal (25) → Lab (30) → Storage (35) →
Power Spawn (40) → Observer (45) → Extension (60) → Link (70) → Extractor (80) →
Container (90). **Siege** flips towers to the top. If the chosen target sits under a
rampart, the rampart is broken first.

## Integration with Existing Systems

### Spawn Queue
- Defensive Knights/Wizards/Clerics jump the economy queue under threat (high-severity
  raids take priority over miners — a dead miner respawns, a dead spawn does not).
- Offensive squad creeps spawn at full energy capacity for max-strength bodies, in
  formation order (knights → siegers → wizards → clerics).

### Home Defense
- **Knights** engage hostiles and retreat to spawn when critically injured.
- **Wizards** kite and mass-attack clustered raiders.
- **Clerics** heal Knights and injured friendlies, scaling up in high-threat scenarios.
- Towers focus-fire one target room-wide and auto-trigger safe mode when structures
  are critically damaged.

### WarCouncil
- Scans visible non-owned rooms every 50 ticks into `Memory.intel`, scoring threat 0–10.
- Ranks enemy rooms for targeting (lowest threat first).
- Optional auto-attack (off by default) launches against soft, nearby enemy rooms,
  rate-limited to once per 1000 ticks and gated on a capable home (RCL 5+, 50k+ energy).

## Tips
1. **Start with box/assault** for standard attacks; the squad auto-scales to defenses.
2. **Watch HP** with `Game.arca.squads()` — the squad auto-retreats and re-pushes.
3. **Use wedge for offense, box for defense, scatter against towers.**
4. **Use siege** (with siegers) against fortified rooms; towers fall first.
5. **Scout first** — `Game.arca.warcouncil()` shows what intel knows about a target.
6. **Energy reserve** — keep the home room healthy before launching; offensive bodies
   are expensive and spawn at full capacity.
