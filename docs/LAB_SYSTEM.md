# Lab Automation System

## Overview

The Lab Gateway system provides **fully automatic compound production** using intelligent reaction planning and multi-tier compound chains.

## Features

### 🎯 Automatic Production Planning
- Analyzes current stock levels every 100 ticks
- Prioritizes high-value boost compounds (Tier 4 > Tier 3 > Tier 2 > Tier 1)
- Automatically queues reaction chains for needed compounds

### ⚗️ Reaction Chain Resolution
- Handles complex multi-tier production (e.g., XUH2O requires UH → UH2O → XUH2O)
- Automatically produces prerequisite compounds
- Tracks ingredient requirements across entire chain

### 📊 Stock Management
- Target stock levels by tier:
  - **Tier 4 (Catalyzed)**: 3,000 units (XUH2O, XUHO2, etc.)
  - **Tier 3 (Boosted)**: 5,000 units (UH2O, KH2O, etc.)
  - **Tier 2 (Advanced)**: 2,000 units (UH, KH, etc.)
  - **Tier 1 (Base)**: 10,000 units (OH, G, etc.)

### 🔄 Continuous Operation
- 2 input labs (closest to storage)
- Remaining labs as output labs
- Automatic resource distribution via HaulerArbiter
- Production continues until target stock reached

## Boost Priority

Compounds are prioritized by their boost effectiveness:

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
| 55 | XGHO2 | Tough +300% |
| 50 | XKH2O | Carry +100% |

## Console Commands

### View Lab Status
```javascript
Game.kha.labs()           // Show all colonies
Game.kha.labs('W1N1')     // Show specific colony
```

**Output:**
- Lab count (input/output)
- Auto-production status
- Current reaction
- Queue (next 3 reactions)
- Top compound stocks

### Queue Production
```javascript
Game.kha.produce('XUH2O', 3000)          // All colonies
Game.kha.produce('XUHO2', 5000, 'W1N1')  // Specific colony
```

Automatically queues the full reaction chain:
- To make XUH2O: queues U+H → UH, UH+OH → UH2O, UH2O+X → XUH2O

### Control Auto-Production
```javascript
Game.kha.autoLabs('W1N1', true)   // Enable
Game.kha.autoLabs('W1N1', false)  // Disable
Game.kha.autoLabs('W1N1')         // Toggle
```

When enabled (default), automatically plans production based on stock levels.

## How It Works

### 1. Planning Phase (every 100 ticks)
```typescript
// ReactionPlanner.planProduction()
1. Check stock levels for all compounds
2. Calculate priority scores (base priority × need ratio)
3. Return top 5 compounds to produce
```

### 2. Chain Resolution
```typescript
// ReactionPlanner.getReactionChain(product)
1. Get ingredients for product
2. If ingredient is compound, recursively get its chain
3. Return ordered list: [prerequisite1, prerequisite2, ..., product]
```

Example for XUH2O:
```
Tier 1: OH (O + H)
Tier 2: UH (U + H)
Tier 3: UH2O (UH + OH)
Tier 4: XUH2O (UH2O + X)
```

### 3. Ingredient Check
```typescript
// ReactionPlanner.canProduce(product, amount, storage, terminal)
1. Get ingredient requirements
2. Check storage + terminal for both ingredients
3. Return true if >= amount available
```

### 4. Execution
```typescript
// LabGateway.executeReaction()
1. Verify input labs have correct resources (>100 units)
2. Run outputLab.runReaction(inputLab1, inputLab2) on all output labs
3. Check if target amount reached
4. Move to next queued reaction
```

## Integration

### With HaulerArbiter
- Haulers automatically refill input labs
- Empty output labs when reactions complete
- Transfer compounds to storage/terminal

### With MarketManager
- Can buy missing base minerals automatically
- Sell excess compounds for profit

### With WarCouncil
- Request specific boosts for combat squads
- Auto-produce combat compounds (attack, heal, ranged)

## Memory Structure

```typescript
interface LabGatewayMemory {
  reactionQueue: ReactionTask[];        // Queued reactions
  currentReaction: ReactionTask | null; // Current production
  autoProduction: boolean;              // Auto-planning enabled
  lastProductionCheck: number;          // Last planning tick
}

interface ReactionTask {
  product: MineralCompoundConstant;
  amount: number;
  ingredient1: ResourceConstant;
  ingredient2: ResourceConstant;
}
```

## Reaction Database

Complete database of 28 compounds across 4 tiers:

**Tier 1 (Base):**
- OH, ZK, UL, G

**Tier 2 (Advanced):**
- UH, UO, KH, KO, LH, LO, ZH, ZO, GH, GO

**Tier 3 (Boosted):**
- UH2O, UHO2, KH2O, KHO2, LH2O, LHO2, ZH2O, ZHO2, GH2O, GHO2

**Tier 4 (Catalyzed):**
- XUH2O, XUHO2, XKH2O, XKHO2, XLH2O, XLHO2, XZH2O, XZHO2, XGH2O, XGHO2

## Performance

- **CPU Impact**: ~0.5-1.0 CPU per tick with active reactions
- **Planning Check**: Every 100 ticks (~0.1 CPU)
- **Lab Operations**: Scales with number of output labs
- **Memory Usage**: Minimal (~500 bytes per colony)

## Best Practices

1. **Build at least 6 labs** for efficient production (2 input, 4 output)
2. **Place labs near storage** to minimize hauler travel time
3. **Keep auto-production enabled** for hands-off operation
4. **Stock base minerals** (H, O, U, K, L, Z, X) via mining or market
5. **Monitor with `Game.kha.labs()`** to verify production

## Future Enhancements

- [ ] Boost request system for creeps
- [ ] Commodity production (battery, wire, etc.)
- [ ] Multi-room reaction coordination
- [ ] Lab cooldown optimization
- [ ] Automatic mineral buying when low
