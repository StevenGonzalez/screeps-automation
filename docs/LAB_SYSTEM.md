# Lab System

> **Status**: Implemented. `orchestrators/orchestrator.labs.ts` runs full compound
> production — multi-tier reaction chains, T4 boost auto-production, and creep
> boosting. Prospectors (`role.mineral_miner.ts`) supply the raw minerals; the
> apothecary (`role.apothecary.ts`) ferries reagents into the labs and product out.

---

## Mineral Supply

**Prospector** creeps (RCL 6+) mine the room's mineral deposit and haul the output
to storage. Base minerals the room lacks are bought / balanced in by the terminal
(see [TERMINAL_NETWORK.md](TERMINAL_NETWORK.md)). This is the raw-material feed the
lab system consumes.

---

## How It Works (`orchestrator.labs.ts`)

Per owned room, every tick:

1. **Periodic planning** (every `LAB_PLAN_INTERVAL` = 100 ticks): identify the
   labs and, if the queue is empty and auto-production is on, queue the next
   under-stocked auto-production target.
2. **Boosting** (`runBoosts`): any creep with `memory.boostCompound` set and not
   yet boosted is boosted at an output lab holding ≥30 of that compound (used by
   the military system to boost combat creeps).
3. **Reactions**: advance the queue and run `runReaction()` on every output lab
   while both input labs hold their reagents.

### Lab identity

Labs are split by proximity to storage:
- **2 input labs** — the two closest to storage (easiest for the apothecary to
  load with reagents).
- **Output labs** — all remaining labs, each running `runReaction()`.

IDs are cached in `room.memory.labSystem` and only recomputed when invalid.

### Reaction-chain resolution

`services/services.labs.ts` (`resolveChain`) expands a requested compound into the
full ordered list of reactions needed, accounting for existing stock — e.g.
`XUH2O` resolves to whatever subset of `UH → UH2O → XUH2O` is still missing. Each
queue entry is `{ compound, amount }`; the orchestrator works the queue head until
the produced amount meets the target, then pops it.

### Auto-production targets

When auto-production is on (default) and the queue is empty, the planner tops up the
first under-stocked compound from `AUTO_PRODUCTION_TARGETS` (one compound per
planning cycle):

| Compound | Target | Use |
|----------|--------|-----|
| XUH2O | 3,000 | catalyzed attack boost (T4) |
| XUHO2 | 3,000 | catalyzed heal / dismantle line (T4) |
| XKHO2 | 3,000 | catalyzed ranged-attack boost (T4) |
| XZHO2 | 2,000 | catalyzed fatigue reduction (T4) |
| XGH2O | 3,000 | catalyzed harvest/upgrade boost (T4) |
| OH | 10,000 | universal intermediate |
| G | 5,000 | catalyst / ghodium ingredient |

---

## Console Commands

```javascript
Game.arca.labs()                       // lab status for every owned room
Game.arca.produce('XUHO2', 3000)       // queue a compound in the best lab room
Game.arca.produce('XUHO2', 3000, 'W1N1') // ...in a specific room
Game.arca.autoLabs('W1N1', true)       // toggle auto-production for a room
```

`Game.arca.labs()` reports the active compound, queue, input/output lab counts,
auto flag, current reagents, and stock-vs-target for the auto-production compounds.

---

## Reaction Database

`REACTION_RECIPES` in `services/services.labs.ts` maps each compound to its two
reagents and underpins `resolveChain`.

**Tier 1:** OH, ZK, UL, G
**Tier 2:** UH, UO, KH, KO, LH, LO, ZH, ZO, GH, GO
**Tier 3:** UH2O, UHO2, KH2O, KHO2, LH2O, LHO2, ZH2O, ZHO2, GH2O, GHO2
**Tier 4:** XUH2O, XUHO2, XKH2O, XKHO2, XLH2O, XLHO2, XZH2O, XZHO2, XGH2O, XGHO2
