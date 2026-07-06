# Factory System

> **Status**: Implemented. `orchestrators/orchestrator.factory.ts` operates the
> factory (placed at RCL 7) to produce commodities, choosing what to make from
> `config/config.factory.ts` and moving ingredients in / product out via a
> borrowed hauler.

---

## What It Does

Per owned room with a built factory, each tick:

1. **Plan** (every `FACTORY_PLAN_INTERVAL` = 50 ticks, when auto is on): pick the
   highest-priority under-stocked commodity whose factory-level gate is met and
   whose ingredients are all obtainable from the room's stores.
2. **Produce**: call `factory.produce()` whenever the factory holds all ingredients
   and is off cooldown.
3. **Haul**: borrow an idle, empty **bagman** (hauler) and drive it for one tick to
   load the next missing ingredient, or evict finished product / stale ingredients
   back to storage (eviction has priority so the 50k factory store never deadlocks).

The factory loop runs **after** the creep orchestrator in `main.ts`, so its
move/withdraw/transfer intents override whatever the borrowed hauler queued that
tick. There is no dedicated factory-hauler role - it reuses a bagman.

---

## Commodity Tiers (`config.factory.ts`)

The actual recipes (components, output amount, cooldown, required factory level)
come from the game's runtime `COMMODITIES` constant. The config only decides which
commodities the bot will auto-produce, in what priority order, and the stock target
for each.

| Tier | Level gate | Commodities | Target |
|------|-----------|-------------|--------|
| 0 - energy compaction | any | `battery` | 10,000 |
| 1 - compressed base minerals | any | `utrium_bar`, `lemergium_bar`, `zynthium_bar`, `keanium_bar`, `oxidant`, `reductant`, `purifier`, `ghodium_melt` | 2-3,000 |
| 2 - basic deposit commodities | **level 1+** | `wire`, `cell`, `alloy`, `condensate` | 2,000 |

The orchestrator walks this list and makes the first target that is under-stocked,
has its ingredients available, and clears its level gate.

> Tier-2 ingredients (the compressed silicon/metal/biomass/mist bars) come from raw
> **highway deposits**, harvested by the deposit-mining system on the observer scan.
> Without it, Tier-2 can only run on market-bought raw materials. See
> [OBSERVER_SYSTEM.md](OBSERVER_SYSTEM.md#deposit-mining-orchestratorobserverts-rcl-8).

### Factory-level gating (PWR_OPERATE_FACTORY)

Tier-0 and Tier-1 commodities need no leveled factory. Tier-2 commodities carry
`COMMODITIES[...].level === 1`, so the factory must have been **leveled to 1** via
the `PWR_OPERATE_FACTORY` power before they're attempted. Factory levelling is
driven by `orchestrator.powercreep.ts`; this orchestrator only *reads*
`factory.level` to gate Tier-2.

### Energy protection

Battery and the compressed-mineral bars consume energy. A storage reserve of 50,000
(`FACTORY_MIN_RESERVE_ENERGY`) is never touched, so making commodities can't starve
the colony economy.

> Note: selling commodities on the market is **not** handled here - the factory just
> builds a stockpile. Vending is left to the terminal.

---

## Console Commands

```javascript
Game.arca.factory()                         // factory status per room (active, level, cd, stock vs target)
Game.arca.produceCommodity('W1N1', 'battery') // force a commodity until the next auto-plan
Game.arca.autoFactory('W1N1', true)         // toggle auto-production for a room
```

`produceCommodity` refuses a commodity whose required factory level exceeds the
current level, telling you to level it via `PWR_OPERATE_FACTORY`.
