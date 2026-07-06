# Terminal Network

> **Status**: Implemented. `orchestrators/orchestrator.terminal.ts` handles market
> mineral selling, base-mineral buying for lab chains, ghodium acquisition for
> nukers, and inter-room balancing of energy, minerals, and ghodium.

---

## Market Trading (per room)

Each owned room with a terminal:

- **Sells** excess minerals to nearby buy orders: when terminal stock of the room's
  mineral type is >= 1,000, up to 1,000/transaction, within 10 rooms, priced above
  0.5 credits/unit. Requires >= 1,000 energy in the terminal to cover the fee.
- **Buys** base minerals for lab chains (rooms with active labs) when stock runs
  low: every 500 ticks, tops up toward 3,000 each (`H O Z K U L X`), capped at
  1,000/deal and a max price of 50.

---

## Ghodium for Nukers

Ghodium (G) loads the offensive nukers (see [NUKER_SYSTEM.md](NUKER_SYSTEM.md)).
The terminal keeps a per-room G reserve so a nuker can always be topped off:

- Each room's **ghodium target** = the lab base-mineral target (3,000, for lab
  rooms) **plus** one `NUKER_GHODIUM_RESERVE` (5,000) when the room has a nuker.
  The nuker reserve sits strictly on top of the lab target, so lab/boost ghodium is
  never cannibalized.
- **Buys** G from the market (every 500 ticks, max price 8, up to 1,000/deal) when
  the room is below its target.

---

## Inter-Room Balancing

Re-planned every 100 ticks across all owned rooms with terminals. Each pass queues
at most one transfer per category by writing a `room.memory.pendingSend`, which the
owning room's terminal executes once loaded and off cooldown (and, for non-energy,
once it has the energy to pay the fee).

- **Energy** - donors (storage > 200k) send 30k to the poorest receivers
  (storage < 50k). One energy transfer queued per pass.
- **Minerals** - lab rooms short on a base mineral (< 500 combined) pull up to
  1,000 from a donor with a genuine surplus (>= 2,000 + the amount).
- **Ghodium** - rooms below their ghodium target pull up to 1,000 from a donor that
  can spare it without dropping below its own target (lab target + nuker reserve).

All transfers skip pairs more than 10 rooms apart.

---

## Console Command

```javascript
Game.arca.network()   // per-room storage/terminal energy, pending sends, and mineral stocks
```

(There is no `Game.arca.sendEnergy()` - inter-room energy moves are planned
automatically by the balancing pass, not commanded manually.)

The family's money moves to every corner of the operation.
