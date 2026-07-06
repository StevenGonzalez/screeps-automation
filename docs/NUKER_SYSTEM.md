# Nuker System (Offensive)

> **Status**: Implemented. `orchestrators/orchestrator.nuker.ts` keeps the nuker
> (built at RCL 8) loaded so it can fire. Launching is **manual only** —
> `Game.arca.launchNuke(...)`. Nothing ever auto-launches.

> **Not to be confused with** `orchestrator.nukes.ts`, which is the *defensive*
> side — reinforcing ramparts on impact tiles when an **incoming** nuke is
> detected. This page is about loading and firing **our own** nuker.

---

## Loading the Nuker

Per owned room with a `StructureNuker`, each tick the orchestrator decides what (if
anything) the nuker still needs and drives a borrowed **bagman** (hauler) to fetch
it from storage/terminal and transfer it in. Like the factory, it borrows an idle
hauler rather than using a dedicated role; it runs **after** the creep orchestrator
in `main.ts`, so its intents win for the tick. It also runs **after** the terminal,
so ghodium that was just transferred in is available to load the same tick.

Fill rules:

- **Ghodium first.** G (capacity 5,000) is the scarce ingredient and a nuke needs
  both, so it's loaded before energy — no surplus gate, take whatever is in stores.
- **Energy** (capacity 300,000) is loaded only while **storage energy exceeds
  250,000**, and never drawn below that line — so a 300k fill can't starve
  spawns/upgraders. Capped at 1,000/tick.

Ghodium acquisition (market buys + inter-room transfers) happens in the **terminal**
(see [TERMINAL_NETWORK.md](TERMINAL_NETWORK.md)), which reads
`NUKER_GHODIUM_RESERVE` (5,000) to know how much G to keep per nuker room.

---

## Launching (manual)

```javascript
Game.arca.nuker()                              // load status per room (energy %, ghodium %, cooldown, ready)
Game.arca.launchNuke('W1N1', 'W5N5', 25, 25)   // launch at room coordinates
Game.arca.launchNuke('W1N1', 'NUKE_HERE')      // launch at a flag's position
```

`launchNuke` validates before firing and returns a clear error otherwise:
- the room must have a nuker and it must be off cooldown,
- energy must be 300,000 and ghodium 5,000 (fully loaded),
- the target must be within nuker range (`NUKE_RANGE`).

On success it launches and posts a `Game.notify` alert. Impact lands in
`NUKE_LAND_TIME` ticks. This is destructive and is never triggered automatically.
