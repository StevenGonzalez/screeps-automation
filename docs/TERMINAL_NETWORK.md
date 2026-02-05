# Terminal Network - Inter-Colony Resource Sharing

## Overview

The **Terminal Network** provides fully automated resource distribution across all your colonies. It intelligently identifies needs and surpluses, then coordinates terminal transfers to maximize efficiency.

## Key Features

### 🔄 Automatic Resource Balancing
- Monitors all colony terminals every 100 ticks
- Identifies resource needs based on colony phase and situation
- Matches surpluses to needs with intelligent prioritization
- Considers transfer costs to avoid wasteful shipments

### 🚨 Emergency Response
- Detects colonies under attack (threat level ≥ 7)
- Identifies bootstrapping colonies running low on energy
- Sends immediate emergency transfers
- Finds nearest source colony automatically

### 📦 Smart Distribution
- **Energy**: Maintains 20k+ in all colonies, emergency below 10k
- **Minerals**: Distributes to developing colonies (3k each mineral)
- **Compounds**: Shares boost compounds for combat operations
- **Priority System**: Critical > High > Medium > Low

### 📊 Statistics & Monitoring
- Tracks total transfers, energy shared, minerals shared
- Shows pending transfers in real-time
- Monitors terminal status (energy, capacity, cooldown)
- Historical transfer data

---

## How It Works

### Resource Needs Detection

The system identifies needs based on colony phase:

**Bootstrap/Developing Colonies:**
- Energy < 20k → High priority (50k target)
- Energy < 10k → Critical priority
- Each mineral < 1k → Medium priority (3k target)

**Mature/Powerhouse Colonies:**
- Energy < 20k → High priority
- Boost compounds < 500 → Medium priority (1k target)
- Combat minerals needed for lab production

**Under Attack (Threat ≥ 7):**
- Energy < 5k → EMERGENCY (20k immediate transfer)

### Resource Surplus Detection

Mature/Powerhouse colonies share when they have:

**Energy Surplus:**
- Amount > 100k
- Shares: Amount - 75k (keeps 75k reserve)

**Mineral Surplus:**
- Amount > 10k per mineral
- Shares: Amount - 5k (keeps 5k reserve)

**Compound Surplus:**
- Amount > 2k per compound
- Shares: Amount - 1k (keeps 1k reserve)

### Transfer Scheduling

```typescript
Match Algorithm:
1. Sort needs by priority (Critical → High → Medium → Low)
2. For each need:
   - Find surplus of same resource
   - Calculate transfer amount (min of need/surplus/10k max)
   - Calculate energy cost (distance-based)
   - Skip if cost > 10% of transfer amount
   - Schedule transfer for next available terminal cooldown
3. Execute transfers one per tick per colony
```

---

## Console Commands

### View Network Status
```javascript
Game.kha.network()
```

**Output:**
```
═══════════════════════════════════════════════════════
🌐 TERMINAL NETWORK
═══════════════════════════════════════════════════════

📊 Statistics:
  Total transfers: 127
  Energy shared: 2,450,000
  Minerals shared: 85,000
  Compounds shared: 12,500

📦 Pending Transfers (3):
  W5N1 → W5N2: 20000 energy
  W6N1 → W5N2: 3000 H
  W5N1 → W4N1: 1000 XGH2O

🏛️ Colony Terminal Status:
  W5N1: 125,000 energy, 215,000/300,000 used, cooldown 0
  W5N2: 8,000 energy, 45,000/300,000 used, cooldown 5
  W6N1: 95,000 energy, 180,000/300,000 used, cooldown 0
  W4N1: 45,000 energy, 120,000/300,000 used, cooldown 0
═══════════════════════════════════════════════════════
```

### Force Emergency Energy Transfer
```javascript
Game.kha.sendEnergy('W5N2', 30000)
```

Immediately schedules an emergency energy transfer to the specified room.

---

## Integration

### With Expansion System
New colonies automatically receive resources:
```typescript
// Bootstrap colony detected
Phase: 'bootstrap', Energy: 2k
→ Terminal Network: Emergency 10k energy transfer
→ Terminal Network: 3k of each mineral (H, O, U, L, K, Z, X)
```

### With Combat System
Colonies preparing for war receive compounds:
```typescript
// War preparation detected
WarCouncil: Planning attack on E5N5
→ Terminal Network: Send XUH2O (attack boost)
→ Terminal Network: Send XLHO2 (heal boost)  
→ Terminal Network: Send XZHO2 (move boost)
```

### With Defense System
Colonies under attack receive emergency energy:
```typescript
// Threat detected
DefenseGateway: Threat level 8, Energy: 4k
→ Terminal Network: EMERGENCY 20k energy transfer
→ Result: Towers remain operational
```

### With Lab System
Lab production is distributed to colonies:
```typescript
// Lab production complete
LabGateway: Produced 3000 XGH2O
Terminal: 5000 XGH2O (surplus)
→ Terminal Network: Share 2000 XGH2O with combat colonies
```

---

## Transfer Cost Optimization

Energy cost for transfers is distance-based:

```typescript
Formula: Math.ceil(amount * (1 - Math.exp(-distance / 30)))

Examples:
- 1 room away: ~3% energy cost
- 5 rooms away: ~15% energy cost
- 10 rooms away: ~28% energy cost
- 20 rooms away: ~48% energy cost

Network Rule: Skip transfer if cost > 10% of amount
```

This ensures only efficient transfers occur.

---

## Priority System

Transfers are prioritized:

| Priority | Conditions | Action |
|----------|-----------|--------|
| **EMERGENCY** | Under attack, energy < 5k | Immediate transfer |
| **Critical** | Energy < 10k | High priority queue |
| **High** | Energy < 20k | Normal priority queue |
| **Medium** | Minerals/compounds needed | Low priority queue |
| **Low** | Optimization transfers | Background queue |

---

## Best Practices

### 1. Build Terminals Early
- Terminals unlock at RCL 6
- Network activates with 2+ terminals
- More terminals = better resource flow

### 2. Maintain Energy Reserves
- Keep 50k+ in mature colonies
- Emergency threshold: 20k
- Critical threshold: 10k

### 3. Centralize Lab Production
- One colony produces compounds
- Network distributes to all colonies
- Reduces duplicate lab setups

### 4. Monitor Network Status
- Check `Game.kha.network()` regularly
- Watch for repeated transfers (indicates imbalance)
- Verify emergency transfers reach destination

### 5. Plan for Expansion
- New colonies drain energy initially
- Ensure parent colony has 100k+ before expanding
- Network will auto-supply new colony

---

## Configuration

### Energy Thresholds

Edit `TerminalNetwork.ts` `identifyResourceNeeds()`:

```typescript
// Low energy threshold
if (energyAmount < 20000) {  // Change to 30000 for higher reserve

// Critical energy threshold  
priority: energyAmount < 10000 ? 'critical' : 'high',  // Adjust as needed
```

### Mineral Distribution

Edit mineral target for developing colonies:

```typescript
// Current: 3k target per mineral
amount: 3000 - amount,  // Change to 5000 for larger stockpiles
```

### Compound Thresholds

Edit boost compound minimums:

```typescript
// Current: 500 minimum, 1k target
if (amount < 500 && this.hasLabProduction(colony)) {
  amount: 1000 - amount,  // Adjust targets
```

### Transfer Maximums

Edit max transfer per shipment:

```typescript
// Current: 10k max per transfer
Math.min(need.amount, matchingSurplus.amount, 10000)  // Increase if needed
```

---

## Performance

- **CPU Impact**: ~0.5-1.0 CPU per tick (with active transfers)
- **Balancing Frequency**: Every 100 ticks
- **Emergency Checks**: Every tick
- **Memory Usage**: ~1KB per 10 transfers
- **Transfer Limit**: 1 per terminal per tick (game limitation)

---

## Troubleshooting

### Transfers Not Happening

**Check:**
- Both colonies have terminals
- Source has surplus (check `Game.kha.network()`)
- Terminal not on cooldown
- Transfer cost not excessive (> 10%)

**Solution:**
```javascript
// Check terminal status
Game.kha.network()

// Verify colony phases
Object.values(Game.kha.highCharities).forEach(hc => 
  console.log(`${hc.name}: ${hc.memory.phase}`)
)
```

### Colony Still Low on Energy

**Check:**
- Network identifies the need? (`Game.kha.network()`)
- Nearby colony has surplus?
- Transfer scheduled but not executed yet?

**Solution:**
```javascript
// Force immediate transfer
Game.kha.sendEnergy('W5N2', 30000)

// Check if colony is classified as needy
const net = Game.kha.terminalNetwork;
// Will show in needs list if detected
```

### Excessive Transfers (Ping-Pong)

**Check:**
- Colonies alternating send/receive
- Both colonies near same threshold

**Solution:**
Adjust thresholds to have clear separation:
- Surplus: 100k → shares down to 75k
- Need: < 20k → receives up to 50k
- Gap prevents ping-pong

### Emergency Transfers Draining Parent

**Check:**
- Parent colony energy level
- Multiple colonies requesting simultaneously

**Solution:**
```typescript
// Add minimum reserve for emergency source
if (energyAmount < 50000) continue; // Requires 50k surplus
```

---

## Advanced Features

### Custom Resource Distribution

Add custom resource needs:

```typescript
// In identifyResourceNeeds()
if (colony.warCouncil.isPreparing()) {
  needs.push({
    roomName: colony.name,
    resourceType: RESOURCE_CATALYZED_UTRIUM_ACID,
    amount: 5000,
    priority: 'high',
    reason: 'War preparation'
  });
}
```

### Conditional Sharing

Disable sharing from specific colonies:

```typescript
// In identifyResourceSurpluses()
if (colony.name === 'W5N1') {
  continue; // W5N1 never shares
}
```

### Resource Routing

Route resources through intermediate colonies:

```typescript
// Multi-hop transfers for distant colonies
// Calculate optimal route using pathfinding
```

---

## Statistics

Track network performance:

```typescript
Memory.terminalNetwork.statistics = {
  totalTransfers: 127,      // Lifetime transfers
  energyShared: 2450000,    // Total energy distributed
  mineralsShared: 85000,    // Total minerals distributed  
  compoundsShared: 12500    // Total compounds distributed
}
```

View with `Game.kha.network()`

---

## Integration Examples

### New Colony Bootstrap
```
Tick 1000: Colony W5N2 claimed
  → Phase: 'bootstrap'
  → Energy: 0
  → Terminal: Not built yet

Tick 5000: Terminal constructed
  → Network detects: Energy 0 < 20k
  → Finds W5N1 with 120k energy
  → Schedules: 50k energy transfer

Tick 5050: Transfer arrives
  → W5N2 energy: 50k
  → Status: HIGH → Normal
  → Bootstrapping continues

Tick 5100: Mineral needs detected
  → Schedules: 3k H, O, U, L, K, Z, X

Tick 5500: Minerals arrive
  → Lab construction begins
  → Colony becomes self-sufficient
```

### Attack Response
```
Tick 10000: Enemy enters W6N1
  → DefenseGateway threat: 8/10
  → Energy: 8k (low from tower usage)
  → Network: EMERGENCY detected

Tick 10001: Emergency transfer
  → Finds W5N1 (nearest, 95k energy)
  → Sends 20k energy immediately
  → Status: CRITICAL → HIGH

Tick 10050: Transfer arrives
  → Energy: 28k
  → Towers operational
  → Defense continues
  → Enemy repelled
```

### Lab Production Distribution
```
Tick 15000: W5N1 lab completes
  → Produced: 5000 XGH2O (upgrade boost)
  → Terminal: 7000 XGH2O total
  → Surplus: 6000 (7k - 1k reserve)

Tick 15100: Network balances
  → W6N1 needs: 1000 XGH2O (mature colony)
  → W4N1 needs: 1000 XGH2O (powerhouse)
  → Schedules both transfers

Tick 15150: Transfers complete
  → W6N1: 1000 XGH2O (boosting ready)
  → W4N1: 1000 XGH2O (boosting ready)
  → W5N1: 5000 XGH2O remaining
  → All colonies prepared for operations
```

---

## Future Enhancements

- [ ] Predictive balancing (anticipate needs before critical)
- [ ] Multi-hop routing for distant colonies (reduce costs)
- [ ] Resource prioritization (prefer closer sources)
- [ ] Dynamic threshold adjustment (learn optimal levels)
- [ ] Commodity distribution (for factory production)
- [ ] Power distribution network
- [ ] Trade route optimization (minimize total energy cost)

---

## Summary

The Terminal Network provides **fully automated resource sharing** across your empire. Once you have 2+ terminals, the network:

✅ Automatically balances energy, minerals, and compounds  
✅ Responds to emergencies within 1 tick  
✅ Optimizes transfer costs (skips inefficient transfers)  
✅ Supports expansion, combat, and development  
✅ Provides full visibility with console commands

**Zero maintenance required** - the network runs autonomously!

**For Aiur is shared by all! 🌐**
