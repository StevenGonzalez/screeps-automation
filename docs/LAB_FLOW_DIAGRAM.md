# Lab Automation Visual Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                     LAB AUTOMATION SYSTEM                           │
│                "Through alchemy, power manifests"                   │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  EVERY 100 TICKS - AUTO PRODUCTION PLANNING                         │
└─────────────────────────────────────────────────────────────────────┘

    ChaosSanctum.run()
         │
         ├─ autoProduction enabled? ──────┐
         │                                 │
         │                          [YES]  │  [NO]
         │                                 │   │
         │                                 ▼   └──> Skip planning
         │                      planAutoProduction()
         │                                 │
         │                                 ▼
         │                   ReactionPlanner.planProduction()
         │                                 │
         │                    ┌────────────┴────────────┐
         │                    │  Check all compounds    │
         │                    │  - XUH2O: need 2500     │
         │                    │  - XUHO2: need 4000     │
         │                    │  - OH: need 8000        │
         │                    └────────────┬────────────┘
         │                                 │
         │                    ┌────────────┴────────────┐
         │                    │  Calculate priorities   │
         │                    │  - XUHO2: 90 × 0.8 = 72 │
         │                    │  - XUH2O: 100 × 0.83 = 83│
         │                    │  - OH: 30 × 0.8 = 24    │
         │                    └────────────┬────────────┘
         │                                 │
         │                                 ▼
         │                      [XUH2O, XUHO2, OH, ...]
         │                                 │
         ├─────────────────────────────────┘
         │
         ▼
    For each priority compound:
         │
         ├─> getReactionChain(XUH2O)
         │        │
         │        ├─> Ingredient 1: UH2O (compound!)
         │        │    │
         │        │    ├─> getReactionChain(UH2O)
         │        │    │    │
         │        │    │    ├─> Ingredient 1: UH (compound!)
         │        │    │    │    │
         │        │    │    │    └─> getReactionChain(UH)
         │        │    │    │         │
         │        │    │    │         └─> [U + H] ──> [UH]
         │        │    │    │
         │        │    │    └─> Ingredient 2: OH (compound!)
         │        │    │         │
         │        │    │         └─> getReactionChain(OH)
         │        │    │              │
         │        │    │              └─> [O + H] ──> [OH]
         │        │    │
         │        │    └─> Chain: [OH, UH, UH2O]
         │        │
         │        └─> Ingredient 2: X (base mineral)
         │             │
         │             └─> Full chain: [OH, UH, UH2O, XUH2O]
         │
         └─> queueReaction() for each step
              │
              ├─> Queue OH (3000 units)
              ├─> Queue UH (3000 units)
              ├─> Queue UH2O (3000 units)
              └─> Queue XUH2O (3000 units)


┌─────────────────────────────────────────────────────────────────────┐
│  EVERY TICK - EXECUTION                                             │
└─────────────────────────────────────────────────────────────────────┘

    ChaosSanctum.run()
         │
         └─> currentReaction?
              │
              ├─[NO]──> Pop next from queue ──> currentReaction
              │
              └─[YES]─> executeReaction()
                         │
                         ├─> Check input labs
                         │    │
                         │    ├─> Lab 1: Has O (oxygen)?
                         │    │    └─> ✓ 2500 units
                         │    │
                         │    └─> Lab 2: Has H (hydrogen)?
                         │         └─> ✓ 3000 units
                         │
                         ├─> Run reactions on all output labs
                         │    │
                         │    ├─> Lab 3.runReaction(Lab1, Lab2) ──> OK
                         │    ├─> Lab 4.runReaction(Lab1, Lab2) ──> OK
                         │    ├─> Lab 5.runReaction(Lab1, Lab2) ──> OK
                         │    └─> Lab 6.runReaction(Lab1, Lab2) ──> COOLDOWN
                         │
                         └─> Check completion
                              │
                              ├─> Produced: 850 OH
                              ├─> Target: 3000 OH
                              └─> Continue...
                              
                              (Later)
                              │
                              ├─> Produced: 3000 OH ✓
                              └─> Clear currentReaction
                                   │
                                   └─> Pop next reaction (UH)


┌─────────────────────────────────────────────────────────────────────┐
│  INTEGRATION WITH OTHER SYSTEMS                                     │
└─────────────────────────────────────────────────────────────────────┘

    HaulerWarlord                MarketManager              WarCouncil
         │                            │                          │
         ├─> Fill input labs          ├─> Buy missing minerals  ├─> Request boosts
         │    from storage            │    (H, O, X, etc.)      │    for squads
         │                             │                          │
         ├─> Empty output labs        └─> Sell excess           └─> XUH2O for attack
         │    to storage                   compounds                 XUHO2 for heal
         │                                                            XKHO2 for ranged
         └─> Transport between
              labs efficiently


┌─────────────────────────────────────────────────────────────────────┐
│  REACTION TIER PYRAMID                                              │
└─────────────────────────────────────────────────────────────────────┘

                         TIER 4 (Catalyzed)
                    ┌──────────────────────┐
                    │ XUH2O, XUHO2, XKHO2  │  Target: 3k each
                    │ XLH2O, XLHO2, etc.   │  Priority: 50-100
                    └──────────┬───────────┘
                               │
                    ┌──────────┴──────────────────┐
                    │   TIER 3 (Boosted)          │
              ┌─────┴──────┐           ┌──────────┴─────┐
              │ UH2O, UHO2 │           │ KH2O, KHO2     │  Target: 5k
              │ LH2O, LHO2 │           │ ZH2O, ZHO2     │  Priority: 36-45
              └─────┬──────┘           └──────────┬─────┘
                    │                             │
         ┌──────────┴────────────┬────────────────┴──────────┐
         │  TIER 2 (Advanced)    │                           │
    ┌────┴────┐            ┌─────┴─────┐            ┌───────┴──────┐
    │ UH, UO  │            │ KH, KO    │            │ LH, LO       │  Target: 2k
    │ ZH, ZO  │            │ GH, GO    │            │              │  Priority: 11-20
    └────┬────┘            └─────┬─────┘            └───────┬──────┘
         │                       │                          │
         └───────────────────────┴──────────────────────────┘
                                 │
                    ┌────────────┴────────────┐
                    │   TIER 1 (Base)         │
                    │   OH, G, ZK, UL         │  Target: 10k
                    │                         │  Priority: 4-30
                    └────────────┬────────────┘
                                 │
                    ┌────────────┴────────────┐
                    │   BASE MINERALS         │
                    │   H, O, U, K, L, Z, X   │  From mining/market
                    └─────────────────────────┘


┌─────────────────────────────────────────────────────────────────────┐
│  CONSOLE COMMANDS                                                   │
└─────────────────────────────────────────────────────────────────────┘

    Game.arca.labs()
         │
         └──> ⚗️ LAB STATUS
              ═══════════════════════════════════════
              📍 W1N1
                Labs: 6 (2 input, 4 output)
                Auto-production: ✅ Enabled
                Current: 3000x OH
                Queue: 3 reactions
                  1. 3000x UH
                  2. 3000x UH2O
                  3. 3000x XUH2O
                Top compounds:
                  XUH2O: 1,250
                  XUHO2: 2,800
                  OH: 8,500
              ═══════════════════════════════════════

    Game.arca.produce('XUH2O', 3000, 'W1N1')
         │
         └──> ⚗️ Queued reaction: 3000x OH
              ⚗️ Queued reaction: 3000x UH
              ⚗️ Queued reaction: 3000x UH2O
              ⚗️ Queued reaction: 3000x XUH2O

    Game.arca.autoLabs('W1N1', true)
         │
         └──> ✅ Enabled auto-production in W1N1
```
