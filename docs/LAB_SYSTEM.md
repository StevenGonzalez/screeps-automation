# Lab System _(planned)_

> **Status**: Fully planned, not yet implemented. Alchemists (`role.mineral_miner.ts`) extract raw minerals to storage, but no lab automation exists yet.

---

## What Exists: Mineral Extraction

**Alchemist** creeps (RCL 6+) mine the room's mineral deposit and haul the output to storage. This is the raw material supply chain that the lab system will eventually consume.

---

## Planned: ChaosSanctum Lab Automation _(RCL 6+)_

The **ChaosSanctum** will manage fully automatic compound production:

### Production Planning
- Analyzes stock levels every 100 ticks
- Prioritizes high-value boost compounds (Tier 4 > Tier 3 > Tier 2 > Tier 1)
- Queues full reaction chains automatically

### Reaction Chain Resolution
- Handles multi-tier dependencies (e.g., XUH2O requires UH → UH2O → XUH2O)
- Tracks ingredient requirements across the full chain

### Target Stock Levels
| Tier | Examples | Target |
|------|----------|--------|
| Tier 4 (Catalyzed) | XUH2O, XUHO2 | 3,000 |
| Tier 3 (Boosted) | UH2O, KH2O | 5,000 |
| Tier 2 (Advanced) | UH, KH | 2,000 |
| Tier 1 (Base) | OH, G | 10,000 |

### Boost Priority

| Priority | Compound | Effect |
|----------|----------|--------|
| 100 | XUH2O | Attack +300% |
| 90 | XUHO2 | Heal +300% |
| 85 | XKHO2 | Ranged Attack +300% |
| 80 | XLH2O | Build +100% |
| 75 | XLHO2 | Repair +100% |
| 70 | XZH2O | Dismantle +300% |
| 65 | XZHO2 | Move -100% fatigue |
| 60 | XGH2O | Upgrade +100% |

### Lab Layout
- 2 input labs (closest to storage) loaded with reagents
- Remaining labs as output labs running `runReaction()`
- Haulers refill inputs and drain outputs automatically

### Console Commands _(planned)_
```javascript
Game.arca.labs()                          // View all colony lab status
Game.arca.produce('XUH2O', 3000)         // Queue compound production
Game.arca.autoLabs('W1N1', true)         // Toggle auto-production
```

### Reaction Database

**Tier 1:** OH, ZK, UL, G  
**Tier 2:** UH, UO, KH, KO, LH, LO, ZH, ZO, GH, GO  
**Tier 3:** UH2O, UHO2, KH2O, KHO2, LH2O, LHO2, ZH2O, ZHO2, GH2O, GHO2  
**Tier 4:** XUH2O, XUHO2, XKH2O, XKHO2, XLH2O, XLHO2, XZH2O, XZHO2, XGH2O, XGHO2
