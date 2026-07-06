# Lab Automation Visual Flow

```
+---------------------------------------------------------------------+
|                     LAB AUTOMATION SYSTEM                           |
|                "Through alchemy, power manifests"                   |
+---------------------------------------------------------------------+

+---------------------------------------------------------------------+
|  EVERY 100 TICKS - AUTO PRODUCTION PLANNING                         |
+---------------------------------------------------------------------+

    orchestrator.labs: processLabSystem(room)
         |
         +- queue empty AND autoEnabled? -+
         |                                 |
         |                          [YES]  |  [NO]
         |                                 |   |
         |                                 v   +--> Skip planning
         |                      planAutoProduction()
         |                                 |
         |                                 v
         |              Walk AUTO_PRODUCTION_TARGETS in order:
         |                    +------------+------------+
         |                    |  First under-stocked    |
         |                    |  compound (have < target)|
         |                    |  - XUH2O: 3000          |
         |                    |  - XUHO2: 3000          |
         |                    |  - OH:    10000         |
         |                    +------------+------------+
         |                                 |
         |                                 v
         |             Queue ONE compound's chain per cycle
         |                                 |
         +---------------------------------+
         |
         v
    resolveChain() expands the chosen compound:
         |
         +-> resolveChain(XUH2O)
         |        |
         |        +-> Ingredient 1: UH2O (compound!)
         |        |    |
         |        |    +-> resolveChain(UH2O)
         |        |    |    |
         |        |    |    +-> Ingredient 1: UH (compound!)
         |        |    |    |    |
         |        |    |    |    +-> resolveChain(UH)
         |        |    |    |         |
         |        |    |    |         +-> [U + H] --> [UH]
         |        |    |    |
         |        |    |    +-> Ingredient 2: OH (compound!)
         |        |    |         |
         |        |    |         +-> resolveChain(OH)
         |        |    |              |
         |        |    |              +-> [O + H] --> [OH]
         |        |    |
         |        |    +-> Chain: [OH, UH, UH2O]
         |        |
         |        +-> Ingredient 2: X (base mineral)
         |             |
         |             +-> Full chain: [OH, UH, UH2O, XUH2O]
         |
         +-> push each step onto labSystem.queue
              |
              +-> Queue OH (3000 units)
              +-> Queue UH (3000 units)
              +-> Queue UH2O (3000 units)
              +-> Queue XUH2O (3000 units)


+---------------------------------------------------------------------+
|  EVERY TICK - EXECUTION                                             |
+---------------------------------------------------------------------+

    orchestrator.labs: processLabSystem(room)
         |
         +-> activeCompound?
              |
              +-[NO]--> Pop next from queue --> currentReaction
              |
              +-[YES]-> run reactions for activeCompound
                         |
                         +-> Check input labs
                         |    |
                         |    +-> Lab 1: Has O (oxygen)?
                         |    |    +-> yes 2500 units
                         |    |
                         |    +-> Lab 2: Has H (hydrogen)?
                         |         +-> yes 3000 units
                         |
                         +-> Run reactions on all output labs
                         |    |
                         |    +-> Lab 3.runReaction(Lab1, Lab2) --> OK
                         |    +-> Lab 4.runReaction(Lab1, Lab2) --> OK
                         |    +-> Lab 5.runReaction(Lab1, Lab2) --> OK
                         |    +-> Lab 6.runReaction(Lab1, Lab2) --> COOLDOWN
                         |
                         +-> Check completion
                              |
                              +-> Produced: 850 OH
                              +-> Target: 3000 OH
                              +-> Continue...
                              
                              (Later)
                              |
                              +-> Produced: 3000 OH yes
                              +-> Clear activeCompound + shift queue
                                   |
                                   +-> Pop next reaction (UH)


+---------------------------------------------------------------------+
|  INTEGRATION WITH OTHER SYSTEMS                                     |
+---------------------------------------------------------------------+

    chemist (role)               orchestrator.terminal       military system
         |                            |                          |
         +-> Fill input labs          +-> Buy missing minerals  +-> Request boosts
         |    from storage            |    (H, O, X, etc.)      |    for combat creeps
         |                             |                          |
         +-> Empty output labs        +-> Sell excess           +-> XUH2O for attack
         |    to storage                   minerals                  XUHO2 for heal
         |                                                            XKHO2 for ranged
         +-> Transport between
              labs efficiently


+---------------------------------------------------------------------+
|  REACTION TIER PYRAMID                                              |
+---------------------------------------------------------------------+

 Auto-production targets the T4 boosts (+ OH, G); lower tiers are made
 only as chain intermediates. The planner walks AUTO_PRODUCTION_TARGETS
 in list order and tops up the first under-stocked compound.

                         TIER 4 (Catalyzed)
                    +----------------------+
                    | XUH2O, XUHO2, XKHO2  |  Auto target: 3k each
                    | XZHO2, XGH2O         |  (XZHO2 2k)
                    +----------+-----------+
                               |
                    +----------+------------------+
                    |   TIER 3 (Boosted)          |
              +-----+------+           +----------+-----+
              | UH2O, UHO2 |           | KH2O, KHO2     |  intermediate
              | LH2O, LHO2 |           | ZH2O, ZHO2     |  (made as needed)
              +-----+------+           +----------+-----+
                    |                             |
         +----------+------------+----------------+----------+
         |  TIER 2 (Advanced)    |                           |
    +----+----+            +-----+-----+            +-------+------+
    | UH, UO  |            | KH, KO    |            | LH, LO       |  intermediate
    | ZH, ZO  |            | GH, GO    |            |              |  (made as needed)
    +----+----+            +-----+-----+            +-------+------+
         |                       |                          |
         +-----------------------+--------------------------+
                                 |
                    +------------+------------+
                    |   TIER 1 (Base)         |
                    |   OH, G, ZK, UL         |  OH auto 10k, G auto 5k
                    |                         |
                    +------------+------------+
                                 |
                    +------------+------------+
                    |   BASE MINERALS         |
                    |   H, O, U, K, L, Z, X   |  From mining/market
                    +-------------------------+


+---------------------------------------------------------------------+
|  CONSOLE COMMANDS                                                   |
+---------------------------------------------------------------------+

    Game.arca.labs()
         |
         +-->  LAB STATUS
              =======================================
               W1N1
                Labs: 6 (2 input, 4 output)
                Auto-production: yes Enabled
                Current: 3000x OH
                Queue: 3 reactions
                  1. 3000x UH
                  2. 3000x UH2O
                  3. 3000x XUH2O
                Top compounds:
                  XUH2O: 1,250
                  XUHO2: 2,800
                  OH: 8,500
              =======================================

    Game.arca.produce('XUH2O', 3000, 'W1N1')
         |
         +-->  Queued reaction: 3000x OH
               Queued reaction: 3000x UH
               Queued reaction: 3000x UH2O
               Queued reaction: 3000x XUH2O

    Game.arca.autoLabs('W1N1', true)
         |
         +--> yes Enabled auto-production in W1N1
```
