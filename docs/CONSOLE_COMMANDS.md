# Console Command Cheat Sheet

Every command is a method on the global **`Game.arca`** object — type it into the Screeps
console (bottom of the game screen) and press Enter.

**Read this first:** the bot runs itself. Mining, hauling, building, spawning, tower defense,
repairs, RCL progression, remote mining, and lab/factory automation all happen with **zero
input from you**. These commands exist only to:

1. **See** what the bot is doing (the `status/list` commands — totally safe, read-only).
2. **Decide** the things the bot deliberately leaves to you (who to attack, where to expand).
3. **Override** in an emergency (siege lockdown, manual safe mode).

If you do nothing, the bot grows a healthy empire on its own. You reach for these when you want
to *direct* it or when something's on fire.

Arguments in `'quotes'` are room names like `'W1N1'`. `?` marks an optional argument.

---

## ⭐ Start here — the 5 you'll actually use

| Command | What it tells you / does | When |
|---|---|---|
| `Game.arca.ops()` | One-screen overview of every active operation (expansion, war, SK) | Whenever you wonder "what's my bot doing right now?" |
| `Game.arca.threat()` | Per-room: threat level, hostiles, tower energy, safe mode, **blockade** | Anytime you suspect you're under attack |
| `Game.arca.network()` | Energy + minerals in every room's storage/terminal | Checking economic health |
| `Game.arca.expand()` | Ranked list of good rooms to claim next | When you're ready to grow |
| `Game.arca.cpu()` | Per-subsystem CPU usage, highest first | If the game feels slow / you're near your CPU limit |

---

## 🛡️ Defense & emergencies

| Command | Does | When |
|---|---|---|
| `Game.arca.threat()` | Threat report across all your rooms | First thing to run when attacked |
| `Game.arca.lockdown('W1N1')` | **Stops spawning any creep that leaves the room** — for when enemies camp your exits and kill everything that walks out | You're being besieged/blockaded (auto-detects too, this forces it) |
| `Game.arca.lockdown('W1N1', false)` | Lifts the lockdown, resumes normal operations | Once the campers leave |
| `Game.arca.lockdown()` | Lists blockade status of every room | Checking if a lockdown is active |
| `Game.arca.safemode('W1N1')` | Manually triggers safe mode (enemies can't act inside your room) | A raid is about to destroy your spawn and the bot hasn't auto-triggered |
| `Game.arca.nukes()` | Inbound nuke status + rampart reinforcement progress | You got a nuke warning |

---

## 🌱 Expansion (claiming new rooms)

The bot won't claim rooms on its own unless you turn on auto-expand. This is a **you decide**
area.

| Command | Does | When |
|---|---|---|
| `Game.arca.expand()` | Shows the best scouted rooms to claim (score, sources, distance) | Deciding where to grow — **run this first** |
| `Game.arca.claim('W2N1')` | Immediately claims a room (needs a free GCL slot) | You picked a target and want it now |
| `Game.arca.queueExpand('W2N1')` | Adds a room to the expansion pipeline (claims it when a slot frees) | Lining up several expansions |
| `Game.arca.dequeueExpand('W2N1')` | Removes a queued target | Changed your mind |
| `Game.arca.autoexpand(true)` | Bot claims the best candidate automatically whenever GCL allows | You want fully hands-off growth |
| `Game.arca.status()` | Current expansion + the queued pipeline | Tracking an in-progress claim |
| `Game.arca.cancel()` | Aborts the active expansion | An expansion is going badly |

---

## ⚔️ Offense & war

Attacking other players is **always your call** — the bot never starts a war unless you enable
the WarCouncil.

| Command | Does | When |
|---|---|---|
| `Game.arca.attack('W2N1')` | Launches an auto-scaled squad at a room (box/assault by default) | You want to take out a target |
| `Game.arca.attack('W2N1', 'wedge', 'siege')` | Same, but pick formation + tactic | Attacking a fortified room |
| `Game.arca.squads()` | Live status of all attack squads (composition, HP, location) | Watching a battle |
| `Game.arca.formation('scatter')` | Change formation mid-fight (`line`/`box`/`wedge`/`scatter`) | Enemy towers are shredding your clustered squad |
| `Game.arca.tactic('retreat')` | Change tactic mid-fight (`assault`/`siege`/`raid`/`defend`/`retreat`) | Pull back a losing squad |
| `Game.arca.recall()` | Stand down **all** ops and bring squads home | Call off a war |
| `Game.arca.drain('W2N1', 2)` | Send decoys to bleed a room's tower energy before assaulting | Softening a heavily-towered target |
| `Game.arca.stopDrain('W2N1')` | Stop draining | Done softening |
| `Game.arca.warcouncil(true)` | Toggle **automatic** target selection + attacking | You want the bot to pick and attack enemies itself |

---

## 🧪 Economy: labs, factory, minerals

Mostly automatic once you hit the right RCL. Touch these only to force specific production.

| Command | Does | When |
|---|---|---|
| `Game.arca.labs()` | Lab system status per room (active reaction, queue, stock) | RCL 6+, checking boost production |
| `Game.arca.produce('XUH2O', 3000)` | Queue a specific compound (auto-resolves the full reaction chain) | You want a boost the auto-planner isn't making |
| `Game.arca.autoLabs('W1N1', false)` | Turn a room's auto lab production on/off | Freeing labs for manual work |
| `Game.arca.factory()` | Factory/commodity production status | RCL 7+, checking the factory |
| `Game.arca.produceCommodity('W1N1', 'battery')` | Force a specific commodity | Making something specific to sell |
| `Game.arca.autoFactory('W1N1', true)` | Toggle factory auto-production | — |
| `Game.arca.network()` | Energy + mineral stocks across all rooms | Economic overview |

---

## ⚡ Advanced income: power, deposits, source keepers

High-RCL opportunistic income. All auto-managed once launched; these are status + manual start.

| Command | Does | When |
|---|---|---|
| `Game.arca.power()` | Power-bank operation + PowerSpawn status | Running power harvesting (RCL 8) |
| `Game.arca.powercreeps()` | Power creep (Operator) level, location, powers | Managing power creeps |
| `Game.arca.deposits()` | Highway deposit-mining operation status | Deposit mining active |
| `Game.arca.sk('W5N4')` | Start mining a Source Keeper room (or, no arg, show status) | RCL 7+ with spare military capacity |
| `Game.arca.skstop('W5N4')` | Cancel an SK mining op | — |

---

## ☢️ Nukes (RCL 8)

| Command | Does | When |
|---|---|---|
| `Game.arca.nuker()` | Your nuker load status (energy/ghodium/cooldown) | Prepping an offensive nuke |
| `Game.arca.launchNuke('W1N1', 'W5N5', 25, 25)` | **Fires a nuke** at a target (or a flag by name). Manual only — never automatic | You mean it |
| `Game.arca.nukes()` | Inbound-nuke defense status | Under nuke threat |

---

## 🔧 Utility

| Command | Does | When |
|---|---|---|
| `Game.arca.cpu()` | Per-subsystem CPU breakdown | Diagnosing slow ticks / CPU limit |
| `Game.arca.traffic(false)` | Disable the traffic manager (falls back to vanilla movement) | Kill-switch if creep movement ever misbehaves |

---

## The mental model

- **Green-field peace:** you barely touch the console. Maybe `Game.arca.ops()` and
  `Game.arca.expand()` now and then to grow.
- **Under attack:** `Game.arca.threat()` → then `lockdown` / `safemode` as needed.
- **Going aggressive:** `Game.arca.attack(...)` + `squads()` to watch, `formation`/`tactic`/
  `recall` to steer.
- **Everything else** is the bot doing its job. The status commands (`ops`, `threat`, `network`,
  `labs`, `factory`, `squads`) are all read-only and safe to spam — use them to learn what the
  bot is up to.
