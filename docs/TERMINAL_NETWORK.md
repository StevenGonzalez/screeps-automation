# Terminal Network _(planned)_

> **Status**: The full cross-colony Terminal Network is planned. What currently exists is single-room mineral selling via the market.

---

## What Exists: Mineral Selling (`orchestrator.terminal.ts`)

Each owned room with a terminal automatically sells excess minerals to nearby buy orders on the market.

### Rules
- Sells when terminal holds **≥ 1,000** units of the room's mineral type
- Sells up to **1,000 units per transaction**
- Only fills orders within **10 rooms** of the seller
- Requires **≥ 1,000 energy** in the terminal to cover transfer cost
- Only fills orders priced above **0.5 credits/unit**

### Output
```
[W1N1] Sold 1000 H @ 1.23 = 1230 credits
```

---

## Planned: Multi-Colony Resource Network _(RCL 6+)_

When multiple colonies each have terminals, a network layer will coordinate automatic resource sharing:

- **Energy sharing**: Bootstrap and under-attack colonies receive emergency transfers
- **Mineral distribution**: Colonies share raw minerals to supply lab chains
- **Compound distribution**: Boost compounds produced by one lab colony shared to all
- **Console commands**: `Game.arca.network()`, `Game.arca.sendEnergy(room, amount)`

The wealth of Lorencia flows to every corner of the empire.
