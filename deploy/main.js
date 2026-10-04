'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

const ROLE_BUILDER = "mason";
const ROLE_HARVESTER = "villager";
const ROLE_UPGRADER = "enchanter";
const ROLE_REPAIRER = "blacksmith";
const ROLE_MINER = "miner";
const ROLE_HAULER = "porter";
const ROLE_FILLER = "barmaid";
const ROLE_MINERAL_MINER = "jeweler";
const ROLE_SCOUT = "raven";
const ROLE_REMOTE_MINER = "peddler";
const ROLE_REMOTE_HAULER = "merchant";
const ROLE_RESERVER = "envoy";
const ROLE_KNIGHT = "dragonknight";
const ROLE_WIZARD = "darkwizard";
const ROLE_CLERIC = "cleric";
const ROLE_SIEGER = "ravager";
const ROLE_DRAINER = "gladiator";
const ROLE_CONQUEROR = "darklord";
const ROLE_SETTLER = "pilgrim";
const ROLE_APOTHECARY = "goblin";
const ROLE_POWER_ATTACKER = "reaver";
const ROLE_POWER_HEALER = "acolyte";
const ROLE_POWER_CARRIER = "looter";
const ROLE_DEPOSIT_MINER = "nomad";
const ROLE_DEPOSIT_HAULER = "caravan";
const ROLE_SK_GUARDIAN = "lancer";
const ROLE_SK_MINER = "delver";
const ROLE_SK_HAULER = "packmule";
const ROLE_SCORE_HUNTER = "seeker";
const ROLE_UNCLAIMER = "usurper";
const ROLE_TOWNSFOLK = "townsfolk";
const ROLE_MINSTREL = "minstrel";
const ROLE_TITLES = {
    [ROLE_BUILDER]: "Mason",
    [ROLE_HARVESTER]: "Villager",
    [ROLE_UPGRADER]: "Enchanter",
    [ROLE_REPAIRER]: "Blacksmith",
    [ROLE_MINER]: "Miner",
    [ROLE_HAULER]: "Porter",
    [ROLE_FILLER]: "Barmaid",
    [ROLE_MINERAL_MINER]: "Jeweler",
    [ROLE_SCOUT]: "Raven",
    [ROLE_REMOTE_MINER]: "Peddler",
    [ROLE_REMOTE_HAULER]: "Merchant",
    [ROLE_RESERVER]: "Envoy",
    [ROLE_KNIGHT]: "Dragon Knight",
    [ROLE_WIZARD]: "Dark Wizard",
    [ROLE_CLERIC]: "Cleric",
    [ROLE_SIEGER]: "Ravager",
    [ROLE_DRAINER]: "Gladiator",
    [ROLE_CONQUEROR]: "Dark Lord",
    [ROLE_SETTLER]: "Pilgrim",
    [ROLE_APOTHECARY]: "Goblin",
    [ROLE_POWER_ATTACKER]: "Reaver",
    [ROLE_POWER_HEALER]: "Acolyte",
    [ROLE_POWER_CARRIER]: "Looter",
    [ROLE_DEPOSIT_MINER]: "Nomad",
    [ROLE_DEPOSIT_HAULER]: "Caravan",
    [ROLE_SK_GUARDIAN]: "Lancer",
    [ROLE_SK_MINER]: "Delver",
    [ROLE_SK_HAULER]: "Packmule",
    [ROLE_SCORE_HUNTER]: "Seeker",
    [ROLE_UNCLAIMER]: "Usurper",
    [ROLE_TOWNSFOLK]: "Yeoman",
    [ROLE_MINSTREL]: "Minstrel",
};
const ENERGY_DEPOSIT_PRIORITY = {
    [ROLE_HARVESTER]: [
        STRUCTURE_SPAWN,
        STRUCTURE_EXTENSION,
        STRUCTURE_CONTAINER,
        STRUCTURE_STORAGE,
    ],
};

const SIGNATURES = [
    "By order of the Crown, this land now answers to the castle.",
    "Traveling merchants welcome. Raiders will be hanged at the gate.",
    "The siege is over. We won. Please wipe your boots.",
    "Taxes are due in gold. Pay at the castle gate.",
    "Warded by our enchanters. Do not touch.",
    "Here be dragons. And us. Mostly us.",
    "Our knights patrol these walls. Mind your step.",
    "The Crown sends its regards. Now leave.",
    "The bones were cast. Your claim did not survive them.",
    "Something stirs beneath the barrows. This land is under our protection.",
    "Trade, barter, pass through. Just don't stay.",
    "A dark wizard lives here. Knock at your own risk.",
];
function pickSignature(roomName) {
    var _a;
    if (!Memory.rooms)
        Memory.rooms = {};
    if (!Memory.rooms[roomName])
        Memory.rooms[roomName] = {};
    const meta = Memory.rooms[roomName];
    if (meta.lastSignedIndex === undefined) {
        const next = (((_a = Memory.sigRotation) !== null && _a !== void 0 ? _a : -1) + 1) % SIGNATURES.length;
        Memory.sigRotation = next;
        meta.lastSignedIndex = next;
    }
    return SIGNATURES[meta.lastSignedIndex];
}

const ALLIES_SEGMENT = 90;
const PROTOCOL_VERSION = 1;
function getAllies() {
    if (!Memory.allies)
        Memory.allies = [];
    return Memory.allies;
}
function isAlly(username) {
    if (!username)
        return false;
    return getAllies().includes(username);
}
let outgoing = [];
let outgoingTick = -1;
function requestHelp(req) {
    if (outgoingTick !== Game.time) {
        outgoing = [];
        outgoingTick = Game.time;
    }
    outgoing.push(req);
}
const incoming = {};
const VALID_TYPES = new Set([
    "resource", "defense", "attack", "work", "economy", "room",
]);
function sanitizeRequest(raw) {
    if (!raw || typeof raw !== "object")
        return null;
    const r = raw;
    if (typeof r.type !== "string" || !VALID_TYPES.has(r.type))
        return null;
    const req = { type: r.type };
    if (typeof r.roomName === "string")
        req.roomName = r.roomName;
    if (typeof r.resourceType === "string")
        req.resourceType = r.resourceType;
    if (typeof r.amount === "number" && isFinite(r.amount))
        req.amount = r.amount;
    const p = typeof r.priority === "number" && isFinite(r.priority) ? r.priority : 0.5;
    req.priority = Math.max(0, Math.min(1, p));
    return req;
}
let foreignIndex = 0;
function runAllies() {
    const toSend = outgoingTick === Game.time || outgoingTick === Game.time - 1 ? outgoing : [];
    outgoing = [];
    outgoingTick = Game.time;
    writeOutgoingSegment(toSend);
    readForeignSegment();
    requestNextForeignSegment();
}
function writeOutgoingSegment(requests) {
    try {
        if (requests.length === 0 && getAllies().length === 0)
            return;
        RawMemory.setActiveSegments([ALLIES_SEGMENT]);
        const payload = {
            v: PROTOCOL_VERSION,
            time: Game.time,
            requests,
        };
        const json = JSON.stringify(payload);
        if (json.length < 100 * 1024) {
            RawMemory.segments[ALLIES_SEGMENT] = json;
            RawMemory.setPublicSegments([ALLIES_SEGMENT]);
        }
    }
    catch (e) {
    }
}
function readForeignSegment() {
    try {
        const fs = RawMemory.foreignSegment;
        if (!fs || fs.id !== ALLIES_SEGMENT || typeof fs.data !== "string")
            return;
        if (!isAlly(fs.username))
            return;
        const parsed = JSON.parse(fs.data);
        if (!parsed || parsed.v !== PROTOCOL_VERSION)
            return;
        const requests = [];
        if (Array.isArray(parsed.requests)) {
            for (const raw of parsed.requests) {
                const req = sanitizeRequest(raw);
                if (req)
                    requests.push(req);
            }
        }
        incoming[fs.username] = {
            time: typeof parsed.time === "number" ? parsed.time : Game.time,
            requests,
        };
    }
    catch (e) {
    }
}
function requestNextForeignSegment() {
    try {
        const allies = getAllies();
        for (const username in incoming) {
            if (!allies.includes(username))
                delete incoming[username];
        }
        if (allies.length === 0) {
            RawMemory.setActiveForeignSegment(null);
            return;
        }
        if (foreignIndex >= allies.length)
            foreignIndex = 0;
        const target = allies[foreignIndex];
        foreignIndex = (foreignIndex + 1) % allies.length;
        RawMemory.setActiveForeignSegment(target, ALLIES_SEGMENT);
    }
    catch (e) {
    }
}

const BOOST_TIMEOUT = 50;
function seekBoost(creep) {
    var _a, _b, _c;
    if (!creep.memory.boostCompound && ((_a = creep.memory.boostQueue) === null || _a === void 0 ? void 0 : _a.length)) {
        creep.memory.boostCompound = creep.memory.boostQueue.shift();
        if (creep.memory.boostQueue.length === 0)
            delete creep.memory.boostQueue;
    }
    const compound = creep.memory.boostCompound;
    if (!compound)
        return false;
    if (((_b = creep.ticksToLive) !== null && _b !== void 0 ? _b : 0) < 1500 - BOOST_TIMEOUT) {
        delete creep.memory.boostCompound;
        delete creep.memory.boostQueue;
        return false;
    }
    const ls = creep.room.memory.labSystem;
    if (!((_c = ls === null || ls === void 0 ? void 0 : ls.outputLabIds) === null || _c === void 0 ? void 0 : _c.length)) {
        delete creep.memory.boostCompound;
        delete creep.memory.boostQueue;
        return false;
    }
    const boostLab = ls.outputLabIds
        .map((id) => Game.getObjectById(id))
        .filter((l) => l !== null)
        .find((l) => { var _a; return ((_a = l.store.getUsedCapacity(compound)) !== null && _a !== void 0 ? _a : 0) >= 30; });
    if (!boostLab) {
        const wait = creep.room.storage;
        if (wait && !creep.pos.inRangeTo(wait, 3))
            creep.moveTo(wait, { range: 3, reusePath: 10 });
        return true;
    }
    if (!creep.pos.isNearTo(boostLab)) {
        creep.moveTo(boostLab, { reusePath: 5 });
    }
    return true;
}
function advanceBoost(creep) {
    var _a;
    if ((_a = creep.memory.boostQueue) === null || _a === void 0 ? void 0 : _a.length) {
        creep.memory.boostCompound = creep.memory.boostQueue.shift();
        if (creep.memory.boostQueue.length === 0)
            delete creep.memory.boostQueue;
    }
    else {
        creep.memory.boosted = true;
        delete creep.memory.boostCompound;
    }
}
const SEVERITY_MEDIUM = 80;
const SEVERITY_HIGH = 160;
function getThreatSeverity(room) {
    const { score } = getThreatInfo(room);
    if (score === 0)
        return "none";
    if (score < SEVERITY_MEDIUM)
        return "low";
    if (score < SEVERITY_HIGH)
        return "medium";
    return "high";
}
const ATTACK_BOOST_MULT = { UH: 2, UH2O: 3, XUH2O: 4 };
const RANGED_BOOST_MULT = { KO: 2, KHO2: 3, XKHO2: 4 };
const HEAL_BOOST_MULT$1 = { LO: 2, LHO2: 3, XLHO2: 4 };
const TOUGH_DAMAGE_MULT$1 = { GO: 0.7, GHO2: 0.5, XGHO2: 0.3 };
const DISMANTLE_BOOST_MULT = { ZH: 2, ZH2O: 3, XZH2O: 4 };
const THREAT_BASE_PER_CREEP = 10;
const DAMAGE_DIVISOR = 30;
const HEAL_WEIGHT = 0.10;
const EHP_DIVISOR = 1000;
let threatCacheTick = -1;
const threatCache = {};
function canDealDamage(creep) {
    return creep.body.some((p) => p.hits > 0 &&
        (p.type === ATTACK ||
            p.type === RANGED_ATTACK ||
            p.type === WORK ||
            p.type === HEAL));
}
function creepThreatScore(c) {
    var _a, _b, _c, _d, _e;
    if (!canDealDamage(c))
        return 0;
    let attackPower = 0;
    let rangedPower = 0;
    let dismantlePower = 0;
    let healPower = 0;
    let effectiveHp = 0;
    for (const part of c.body) {
        if (part.hits <= 0)
            continue;
        switch (part.type) {
            case ATTACK:
                attackPower += ATTACK_POWER * (part.boost ? (_a = ATTACK_BOOST_MULT[part.boost]) !== null && _a !== void 0 ? _a : 1 : 1);
                effectiveHp += 100;
                break;
            case RANGED_ATTACK:
                rangedPower += RANGED_ATTACK_POWER * (part.boost ? (_b = RANGED_BOOST_MULT[part.boost]) !== null && _b !== void 0 ? _b : 1 : 1);
                effectiveHp += 100;
                break;
            case WORK:
                dismantlePower += DISMANTLE_POWER * (part.boost ? (_c = DISMANTLE_BOOST_MULT[part.boost]) !== null && _c !== void 0 ? _c : 1 : 1);
                effectiveHp += 100;
                break;
            case HEAL:
                healPower += HEAL_POWER * (part.boost ? (_d = HEAL_BOOST_MULT$1[part.boost]) !== null && _d !== void 0 ? _d : 1 : 1);
                effectiveHp += 100;
                break;
            case TOUGH: {
                const dmgMult = part.boost ? (_e = TOUGH_DAMAGE_MULT$1[part.boost]) !== null && _e !== void 0 ? _e : 1 : 1;
                effectiveHp += 100 / dmgMult;
                break;
            }
            default:
                effectiveHp += 100;
                break;
        }
    }
    return (THREAT_BASE_PER_CREEP +
        (attackPower + rangedPower + dismantlePower) / DAMAGE_DIVISOR +
        healPower * HEAL_WEIGHT +
        effectiveHp / EHP_DIVISOR);
}
function structureDamagePerTick(hostiles) {
    var _a, _b, _c;
    let dps = 0;
    for (const c of hostiles) {
        for (const p of c.body) {
            if (p.hits <= 0)
                continue;
            if (p.type === ATTACK)
                dps += ATTACK_POWER * (p.boost ? (_a = ATTACK_BOOST_MULT[p.boost]) !== null && _a !== void 0 ? _a : 1 : 1);
            else if (p.type === RANGED_ATTACK)
                dps += RANGED_ATTACK_POWER * (p.boost ? (_b = RANGED_BOOST_MULT[p.boost]) !== null && _b !== void 0 ? _b : 1 : 1);
            else if (p.type === WORK)
                dps += DISMANTLE_POWER * (p.boost ? (_c = DISMANTLE_BOOST_MULT[p.boost]) !== null && _c !== void 0 ? _c : 1 : 1);
        }
    }
    return dps;
}
function summarizeHostiles(hostiles) {
    var _a, _b, _c, _d;
    const s = { heal: 0, damage: 0, hits: 0 };
    for (const c of hostiles) {
        for (const p of c.body) {
            if (p.hits <= 0)
                continue;
            const boost = p.boost;
            if (p.type === HEAL)
                s.heal += HEAL_POWER * (boost ? (_a = HEAL_BOOST_MULT$1[boost]) !== null && _a !== void 0 ? _a : 1 : 1);
            else if (p.type === ATTACK)
                s.damage += ATTACK_POWER * (boost ? (_b = ATTACK_BOOST_MULT[boost]) !== null && _b !== void 0 ? _b : 1 : 1);
            else if (p.type === RANGED_ATTACK)
                s.damage += RANGED_ATTACK_POWER * (boost ? (_c = RANGED_BOOST_MULT[boost]) !== null && _c !== void 0 ? _c : 1 : 1);
            s.hits += p.type === TOUGH && boost ? p.hits / ((_d = TOUGH_DAMAGE_MULT$1[boost]) !== null && _d !== void 0 ? _d : 1) : p.hits;
        }
    }
    return s;
}
const DEFENDER_KILL_TICKS = 600;
function meleeDefendersToWin(enemy, body, cap) {
    const attack = body.filter((p) => p === ATTACK).length * ATTACK_POWER;
    const hits = body.length * 100;
    for (let n = 1; n < cap; n++) {
        const net = n * attack - enemy.heal;
        if (net <= 0)
            continue;
        const ticks = enemy.hits / net;
        if (ticks <= DEFENDER_KILL_TICKS && n * hits > enemy.damage * ticks)
            return n;
    }
    return cap;
}
function getThreatInfo(room) {
    if (threatCacheTick !== Game.time) {
        threatCacheTick = Game.time;
        for (const name in threatCache)
            delete threatCache[name];
    }
    const cached = threatCache[room.name];
    if (cached)
        return cached;
    const hostiles = room
        .find(FIND_HOSTILE_CREEPS)
        .filter((c) => { var _a; return !isAlly((_a = c.owner) === null || _a === void 0 ? void 0 : _a.username); });
    let score = 0;
    for (const c of hostiles) {
        score += creepThreatScore(c);
    }
    const info = { hostiles, score };
    threatCache[room.name] = info;
    return info;
}
const BLOCKADE_STICKY_TICKS = 1500;
const BLOCKADE_BORDER_BAND = 3;
function isArmedHostile(c) {
    if (!isPlayerCreep(c))
        return false;
    return c.body.some((p) => p.hits > 0 && (p.type === ATTACK || p.type === RANGED_ATTACK));
}
function inBorderBandFacingHome(exitDir, x, y) {
    const b = BLOCKADE_BORDER_BAND;
    switch (exitDir) {
        case "1":
            return y >= 49 - b;
        case "5":
            return y <= b;
        case "3":
            return x <= b;
        case "7":
            return x >= 49 - b;
        default:
            return false;
    }
}
function countExitGuards(room) {
    var _a;
    const exits = (_a = Game.map.describeExits(room.name)) !== null && _a !== void 0 ? _a : {};
    let guards = 0;
    for (const dir in exits) {
        const adjName = exits[dir];
        if (!adjName)
            continue;
        const adj = Game.rooms[adjName];
        if (!adj)
            continue;
        for (const c of adj.find(FIND_HOSTILE_CREEPS)) {
            if (isArmedHostile(c) && inBorderBandFacingHome(dir, c.pos.x, c.pos.y))
                guards++;
        }
    }
    return guards;
}
function refreshBlockade(room) {
    const guards = countExitGuards(room);
    const existing = room.memory.blockade;
    if (guards > 0) {
        if (existing) {
            existing.until = Game.time + BLOCKADE_STICKY_TICKS;
            existing.guards = guards;
        }
        else {
            room.memory.blockade = {
                detectedAt: Game.time,
                until: Game.time + BLOCKADE_STICKY_TICKS,
                guards,
            };
            console.log(`[Blockade] ${room.name}: ${guards} hostile(s) camping the exits - suppressing all outbound roles`);
        }
        return;
    }
    if (existing && !existing.manual && Game.time >= existing.until) {
        delete room.memory.blockade;
        console.log(`[Blockade] ${room.name}: exits clear - resuming outbound roles`);
    }
}
function isBlockaded(room) {
    const b = room.memory.blockade;
    if (!b)
        return false;
    return b.manual === true || Game.time < b.until;
}
function hostileCombatTier(creep) {
    const hasHeal = creep.body.some((p) => p.type === HEAL && p.hits > 0);
    if (hasHeal)
        return 0;
    const hasRanged = creep.body.some((p) => p.type === RANGED_ATTACK && p.hits > 0);
    if (hasRanged)
        return 1;
    const hasAttack = creep.body.some((p) => p.type === ATTACK && p.hits > 0);
    if (hasAttack)
        return 1;
    const hasWork = creep.body.some((p) => p.type === WORK && p.hits > 0);
    if (hasWork)
        return 2;
    return 3;
}
function selectHostileTarget(fromPos, hostiles) {
    if (hostiles.length === 0)
        return null;
    let best = null;
    let bestScore = Infinity;
    for (const c of hostiles) {
        let tier = hostileCombatTier(c);
        if (c.hits < c.hitsMax * 0.3)
            tier = Math.max(0, tier - 1);
        const range = fromPos.getRangeTo(c);
        const score = tier * 1000000 + range * 1000 + c.hits;
        if (score < bestScore) {
            bestScore = score;
            best = c;
        }
    }
    return best;
}
const STRUCTURE_ATTACK_PRIORITY = {
    [STRUCTURE_SPAWN]: 10,
    [STRUCTURE_TOWER]: 15,
    [STRUCTURE_NUKER]: 20,
    [STRUCTURE_TERMINAL]: 25,
    [STRUCTURE_LAB]: 30,
    [STRUCTURE_STORAGE]: 35,
    [STRUCTURE_POWER_SPAWN]: 40,
    [STRUCTURE_OBSERVER]: 45,
    [STRUCTURE_EXTENSION]: 60,
    [STRUCTURE_LINK]: 70,
    [STRUCTURE_EXTRACTOR]: 80,
    [STRUCTURE_CONTAINER]: 90,
};
let structureTargetCacheTick = -1;
const structureTargetCache = {};
function getAttackableStructures(room) {
    if (structureTargetCacheTick !== Game.time) {
        structureTargetCacheTick = Game.time;
        for (const name in structureTargetCache)
            delete structureTargetCache[name];
    }
    const cached = structureTargetCache[room.name];
    if (cached)
        return cached;
    const list = room.find(FIND_STRUCTURES, {
        filter: (s) => {
            if (s.structureType === STRUCTURE_CONTROLLER)
                return false;
            if (s.structureType === STRUCTURE_KEEPER_LAIR)
                return false;
            if (s.structureType === STRUCTURE_POWER_BANK)
                return false;
            if (s.structureType === STRUCTURE_WALL)
                return true;
            const rampart = s.structureType === STRUCTURE_RAMPART;
            if (rampart && !(s.hits > 0))
                return false;
            const owned = s.owner;
            if (owned)
                return !s.my && !isAlly(owned.username);
            return rampart;
        },
    });
    structureTargetCache[room.name] = list;
    return list;
}
function selectStructureTarget(room, fromPos, tactic) {
    const all = getAttackableStructures(room);
    if (all.length === 0)
        return null;
    const priorityOf = (s) => {
        var _a;
        if (s.structureType === STRUCTURE_TOWER && tactic === "siege")
            return 0;
        return (_a = STRUCTURE_ATTACK_PRIORITY[s.structureType]) !== null && _a !== void 0 ? _a : 999;
    };
    const valuable = all.filter((s) => s.structureType !== STRUCTURE_WALL && s.structureType !== STRUCTURE_RAMPART);
    let chosen = null;
    if (valuable.length > 0) {
        let bestScore = Infinity;
        for (const s of valuable) {
            const score = priorityOf(s) * 10000 + fromPos.getRangeTo(s);
            if (score < bestScore) {
                bestScore = score;
                chosen = s;
            }
        }
    }
    if (!chosen)
        return null;
    const shield = chosen.pos
        .lookFor(LOOK_STRUCTURES)
        .find((s) => s.structureType === STRUCTURE_RAMPART);
    if (shield && shield.hits > 0)
        return shield;
    return chosen;
}
function massAttackDamage(pos, hostiles) {
    let total = 0;
    for (const h of hostiles) {
        const range = pos.getRangeTo(h);
        if (range === 1)
            total += 10;
        else if (range === 2)
            total += 4;
        else if (range === 3)
            total += 1;
    }
    return total;
}
function preferMassAttack(pos, hostiles) {
    return massAttackDamage(pos, hostiles) > RANGED_ATTACK_POWER;
}
function allyInMassAttackRange(pos) {
    if (getAllies().length === 0)
        return false;
    if (pos.findInRange(FIND_HOSTILE_CREEPS, 3).some((c) => { var _a; return isAlly((_a = c.owner) === null || _a === void 0 ? void 0 : _a.username); }))
        return true;
    return pos
        .findInRange(FIND_HOSTILE_STRUCTURES, 3)
        .some((s) => { var _a; return isAlly((_a = s.owner) === null || _a === void 0 ? void 0 : _a.username); });
}
const TOWER_OPTIMAL_RANGE = 5;
const TOWER_FALLOFF_RANGE = 20;
const TOWER_MAX_PENALTY = 40;
function towerDamageFraction(range) {
    if (range <= TOWER_OPTIMAL_RANGE)
        return 1;
    if (range >= TOWER_FALLOFF_RANGE)
        return 0.25;
    const span = TOWER_FALLOFF_RANGE - TOWER_OPTIMAL_RANGE;
    return 1 - ((range - TOWER_OPTIMAL_RANGE) / span) * 0.75;
}
function buildTowerCostMatrix(room, towers) {
    const matrix = new PathFinder.CostMatrix();
    for (const s of room.find(FIND_STRUCTURES)) {
        if (s.structureType === STRUCTURE_ROAD) {
            if (matrix.get(s.pos.x, s.pos.y) === 0)
                matrix.set(s.pos.x, s.pos.y, 1);
        }
        else if (s.structureType === STRUCTURE_RAMPART
            ? !s.my
            : OBSTACLE_OBJECT_TYPES.includes(s.structureType)) {
            matrix.set(s.pos.x, s.pos.y, 255);
        }
    }
    if (towers.length > 0) {
        for (let x = 1; x < 49; x++) {
            for (let y = 1; y < 49; y++) {
                const base = matrix.get(x, y);
                if (base >= 255)
                    continue;
                let penalty = 0;
                for (const t of towers) {
                    const range = Math.max(Math.abs(t.pos.x - x), Math.abs(t.pos.y - y));
                    if (range > TOWER_FALLOFF_RANGE)
                        continue;
                    penalty += Math.round(TOWER_MAX_PENALTY * towerDamageFraction(range));
                }
                if (penalty > 0)
                    matrix.set(x, y, Math.min(254, (base || 1) + penalty));
            }
        }
    }
    return matrix;
}
function breachGoal(room) {
    const spawn = room.find(FIND_HOSTILE_SPAWNS)[0];
    if (spawn)
        return spawn;
    const target = selectStructureTarget(room, new RoomPosition(25, 25, room.name), "siege");
    if (target && target.structureType !== STRUCTURE_WALL && target.structureType !== STRUCTURE_RAMPART) {
        return target;
    }
    if (room.controller)
        return room.controller;
    return target;
}
function planBreach(room, fromPos) {
    const goal = breachGoal(room);
    if (!goal)
        return null;
    const barrierAt = new Map();
    for (const s of room.find(FIND_STRUCTURES)) {
        if (s.structureType === STRUCTURE_WALL || s.structureType === STRUCTURE_RAMPART) {
            if (s.hits > 0) {
                barrierAt.set(s.pos.x * 50 + s.pos.y, s);
            }
        }
    }
    if (barrierAt.size === 0)
        return null;
    const matrix = new PathFinder.CostMatrix();
    for (const [packed, b] of barrierAt) {
        const x = Math.floor(packed / 50);
        const y = packed % 50;
        const cost = Math.min(250, 5 + Math.floor(b.hits / 200000));
        matrix.set(x, y, cost);
    }
    const result = PathFinder.search(fromPos, { pos: goal.pos, range: 1 }, {
        maxRooms: 1,
        plainCost: 2,
        swampCost: 5,
        roomCallback: (rn) => (rn === room.name ? matrix : false),
    });
    if (result.path.length === 0 && !fromPos.isNearTo(goal.pos))
        return null;
    const pathBarriers = [];
    let focus = null;
    for (const pos of result.path) {
        const b = barrierAt.get(pos.x * 50 + pos.y);
        if (b) {
            if (!focus)
                focus = b;
            pathBarriers.push(pos);
        }
    }
    if (!focus)
        return null;
    return { focusId: focus.id, focusPos: focus.pos, pathBarriers };
}
function assessTowers(room) {
    const towers = room.find(FIND_HOSTILE_STRUCTURES, {
        filter: (s) => s.structureType === STRUCTURE_TOWER,
    });
    let totalEnergy = 0;
    for (const t of towers)
        totalEnergy += t.store[RESOURCE_ENERGY];
    return {
        count: towers.length,
        totalEnergy,
        maxEnergy: towers.length * TOWER_CAPACITY,
    };
}
function towersAreDrained(status) {
    if (status.count === 0)
        return true;
    return status.totalEnergy < status.count * TOWER_ENERGY_COST * 10;
}
const FORMATION_LAYOUTS = {
    box: [
        [0, 0], [1, 0], [-1, 0],
        [0, 1], [1, 1], [-1, 1],
        [0, 2], [1, 2], [-1, 2],
    ],
    line: [
        [0, 0], [1, 0], [-1, 0], [2, 0], [-2, 0], [3, 0], [-3, 0], [4, 0], [-4, 0],
    ],
    wedge: [
        [0, 0], [1, 1], [-1, 1], [2, 2], [-2, 2], [3, 3], [-3, 3], [0, 2], [0, 4],
    ],
    scatter: [
        [0, 0], [2, 0], [-2, 0], [0, 2], [2, 2], [-2, 2], [0, -2], [2, -2], [-2, -2],
    ],
};
function formationOffset(formation, slot) {
    var _a;
    const layout = (_a = FORMATION_LAYOUTS[formation]) !== null && _a !== void 0 ? _a : FORMATION_LAYOUTS.box;
    if (slot < layout.length)
        return layout[slot];
    const extra = slot - layout.length;
    return [extra % 2 === 0 ? 1 : -1, 3 + Math.floor(extra / 2)];
}
function isSourceKeeperRoom(roomName) {
    const m = roomName.match(/^[WE](\d+)[NS](\d+)$/);
    if (!m)
        return false;
    const x = parseInt(m[1], 10) % 10;
    const y = parseInt(m[2], 10) % 10;
    const inCluster = x >= 4 && x <= 6 && y >= 4 && y <= 6;
    const isCentre = x === 5 && y === 5;
    return inCluster && !isCentre;
}
function isSourceKeeper(creep) {
    var _a;
    return ((_a = creep.owner) === null || _a === void 0 ? void 0 : _a.username) === "Source Keeper";
}
function isInvaderCreep(creep) {
    var _a;
    return ((_a = creep.owner) === null || _a === void 0 ? void 0 : _a.username) === "Invader";
}
function findInvaderCore(room) {
    var _a;
    const cores = room.find(FIND_HOSTILE_STRUCTURES, {
        filter: (s) => s.structureType === STRUCTURE_INVADER_CORE,
    });
    return (_a = cores[0]) !== null && _a !== void 0 ? _a : null;
}
function invaderStrength(room) {
    const s = summarizeHostiles(room.find(FIND_HOSTILE_CREEPS).filter(isInvaderCreep));
    const core = findInvaderCore(room);
    if (core)
        s.hits += core.hits;
    return s;
}
function isPlayerCreep(creep) {
    var _a;
    const u = (_a = creep.owner) === null || _a === void 0 ? void 0 : _a.username;
    return u !== undefined && u !== "Source Keeper" && u !== "Invader" && !isAlly(u);
}
function evaluateRoomThreatLevel(room) {
    var _a, _b, _c, _d;
    let level = 0;
    if ((_a = room.controller) === null || _a === void 0 ? void 0 : _a.safeMode)
        return 10;
    const towers = room.find(FIND_HOSTILE_STRUCTURES, {
        filter: (s) => s.structureType === STRUCTURE_TOWER,
    }).length;
    level += towers * 2;
    const rcl = (_c = (_b = room.controller) === null || _b === void 0 ? void 0 : _b.level) !== null && _c !== void 0 ? _c : 0;
    if ((_d = room.controller) === null || _d === void 0 ? void 0 : _d.owner)
        level += Math.min(3, Math.ceil(rcl / 3));
    const { score } = getThreatInfo(room);
    level += Math.min(3, Math.floor(score / 100));
    return Math.min(10, level);
}

const TOWN = {
    watchRcl: 4,
    cottagesByRcl: { 5: 1, 6: 1, 7: 2, 8: 3 },
    militiaByRcl: { 5: 2, 6: 4, 7: 8, 8: 12 },
    storageGate: 10000,
    lookoutRcl: 8,
    maxLookouts: 4,
    perimeterBuiltRatio: 0.9,
    barrierHits: 20000,
    retryInterval: 1500,
    postsPerSide: 3,
    squareFallbackTiles: 6,
    squareMinRange: 3,
    squareMaxRange: 10,
    cottageControllerClearance: 4,
    cottageResourceClearance: 3,
    cottageMaxRange: 14,
};
const TOWN_DAY_LENGTH = 1000;
const TOWN_DAWN_HOUR = 5;
const TOWN_PHASES = [
    { name: "dawn", start: 0 },
    { name: "day", start: 100 },
    { name: "dusk", start: 600 },
    { name: "night", start: 700 },
];
const TOWN_DAYS_PER_SEASON = 7;
const TOWN_STORM_ODDS = 5;
const TOWN_DRAGON_ODDS = 6;
const TOWN_DRAGON_FLIGHT = 48;
const TOWN_MOON_DAYS = 8;
const TOWN_MOON_NAMES = [
    "new moon",
    "waxing crescent",
    "first quarter",
    "waxing gibbous",
    "full moon",
    "waning gibbous",
    "last quarter",
    "waning crescent",
];
const TOWN_HOWL_EVERY = 50;
const TOWN_HOWL_TICKS = 6;
const TOWN_AURORA_ODDS = 3;
const TOWN_STAR_ODDS = 15;
const TOWN_STAR_TICKS = 8;
const TOWN_SEASONS = ["spring", "summer", "autumn", "winter"];
const TOWN_FEASTS = {
    spring: "Sowing Feast",
    summer: "Midsummer Fair",
    autumn: "Harvest Home",
    winter: "Yule Feast",
};
const COTTAGE_FAMILIES = [
    "Aldermere",
    "Blackwood",
    "Cotter",
    "Fairweather",
    "Holloway",
    "Marsh",
    "Thatcher",
    "Wren",
];

function townClock(time) {
    const t = time % TOWN_DAY_LENGTH;
    let phase = TOWN_PHASES[0].name;
    for (const p of TOWN_PHASES)
        if (t >= p.start)
            phase = p.name;
    return {
        phase,
        hour: (Math.floor((t * 24) / TOWN_DAY_LENGTH) + TOWN_DAWN_HOUR) % 24,
    };
}
function townSeason(time) {
    const day = Math.floor(time / TOWN_DAY_LENGTH);
    return TOWN_SEASONS[Math.floor(day / TOWN_DAYS_PER_SEASON) % TOWN_SEASONS.length];
}
function townFeast(time) {
    const day = Math.floor(time / TOWN_DAY_LENGTH);
    return day % TOWN_DAYS_PER_SEASON === 0 ? TOWN_FEASTS[townSeason(time)] : undefined;
}
function townStorm(time) {
    if (townFeast(time) || townSeason(time) === "winter")
        return false;
    const day = Math.floor(time / TOWN_DAY_LENGTH);
    return (Math.imul(day, 2654435761) >>> 16) % TOWN_STORM_ODDS === 0;
}
function dayHash(day, salt) {
    let h = Math.imul(day ^ salt, 0x9e3779b1);
    h ^= h >>> 15;
    h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13;
    return h >>> 0;
}
function townDragon(time) {
    if (townFeast(time))
        return undefined;
    const day = Math.floor(time / TOWN_DAY_LENGTH);
    const h = dayHash(day, 0x5bd1e995);
    if (h % TOWN_DRAGON_ODDS !== 0)
        return undefined;
    const start = 100 + ((h >>> 8) % 550);
    const t = (time % TOWN_DAY_LENGTH) - start;
    if (t < 0 || t >= TOWN_DRAGON_FLIGHT)
        return undefined;
    const dir = (h >>> 4) & 1 ? 1 : -1;
    const fromY = 8 + ((h >>> 18) % 34);
    const toY = 8 + ((h >>> 24) % 34);
    const f = t / (TOWN_DRAGON_FLIGHT - 1);
    return { t, x: dir === 1 ? -6 + 62 * f : 55 - 62 * f, y: fromY + (toY - fromY) * f, dir, day };
}
function townMoon(time) {
    return Math.floor(time / TOWN_DAY_LENGTH) % TOWN_MOON_DAYS;
}
function isFullMoon(time) {
    return townMoon(time) === TOWN_MOON_DAYS / 2;
}
const NIGHT_START = TOWN_PHASES.find((p) => p.name === "night").start;
function townHowl(time) {
    if (!isFullMoon(time))
        return undefined;
    const night = (time % TOWN_DAY_LENGTH) - NIGHT_START;
    if (night < 0)
        return undefined;
    const t = night % TOWN_HOWL_EVERY;
    if (t >= TOWN_HOWL_TICKS)
        return undefined;
    const n = Math.floor(night / TOWN_HOWL_EVERY);
    const h = dayHash(Math.floor(time / TOWN_DAY_LENGTH) * 16 + n, 0x27d4eb2f);
    return { t, n, x: h & 1 ? 46.5 : 2.5, y: 14 + ((h >>> 4) % 28) };
}
function townAurora(time) {
    if (townSeason(time) !== "winter" || townClock(time).phase !== "night")
        return false;
    return dayHash(Math.floor(time / TOWN_DAY_LENGTH), 0x165667b1) % TOWN_AURORA_ODDS === 0;
}
function townFallingStar(time) {
    if (townClock(time).phase !== "night" || townStorm(time))
        return undefined;
    const window = Math.floor(time / TOWN_STAR_TICKS);
    const h = dayHash(window, 0x2c1b3c6d);
    if (h % TOWN_STAR_ODDS !== 0)
        return undefined;
    return { t: time % TOWN_STAR_TICKS, x: 12 + ((h >>> 8) % 34), y: 2 + ((h >>> 16) % 10) };
}
function isNightfall(phase) {
    return phase === "dusk" || phase === "night";
}
function cottageLayout(c) {
    const walls = [];
    const beds = [];
    for (let dy = 0; dy < 5; dy++) {
        for (let dx = 0; dx < 5; dx++) {
            const k = `${c.x + dx},${c.y + dy}`;
            const edge = dx === 0 || dy === 0 || dx === 4 || dy === 4;
            if (!edge)
                beds.push(k);
            else if (k !== c.door)
                walls.push(k);
        }
    }
    return { walls, door: c.door, beds };
}
function bedTiles(town) {
    if (!town)
        return [];
    const beds = [];
    for (const c of town.cottages)
        beds.push(...cottageLayout(c).beds);
    return beds;
}
function townBarrierTiles(town) {
    const out = new Set();
    if (!town)
        return out;
    for (const c of town.cottages) {
        const l = cottageLayout(c);
        for (const k of l.walls)
            out.add(k);
        out.add(l.door);
        for (const k of l.beds)
            out.add(k);
    }
    for (const k of town.posts)
        out.add(k);
    if (town.fountain)
        out.add(town.fountain);
    return out;
}
function townFootprint(town) {
    const out = townBarrierTiles(town);
    if (town)
        for (const k of town.square)
            out.add(k);
    return out;
}
function parseTile(k) {
    const comma = k.indexOf(",");
    return { x: +k.slice(0, comma), y: +k.slice(comma + 1) };
}
let spotTick = -1;
const spotClaims = new Map();
function claimKey(roomName, tile) {
    return `${roomName}:${tile}`;
}
function spotIndex() {
    if (spotTick !== Game.time) {
        spotTick = Game.time;
        spotClaims.clear();
        for (const name in Game.creeps) {
            const c = Game.creeps[name];
            const spot = c.memory.townSpot;
            if (!spot || c.memory.townSpotTick === undefined)
                continue;
            if (Game.time - c.memory.townSpotTick > 1)
                continue;
            spotClaims.set(claimKey(c.room.name, spot), name);
        }
    }
    return spotClaims;
}
function spotHolder(roomName, tile) {
    return spotIndex().get(claimKey(roomName, tile));
}
function claimSpot(creep, candidates, near = creep.pos) {
    const index = spotIndex();
    const room = creep.room.name;
    const held = creep.memory.townSpot;
    const holdsFresh = held !== undefined &&
        creep.memory.townSpotTick !== undefined &&
        Game.time - creep.memory.townSpotTick <= 1 &&
        index.get(claimKey(room, held)) === creep.name;
    if (holdsFresh && candidates.includes(held)) {
        creep.memory.townSpotTick = Game.time;
        return held;
    }
    let best = null;
    let bestRange = Infinity;
    let bestWalk = Infinity;
    for (const k of candidates) {
        const holder = index.get(claimKey(room, k));
        if (holder && holder !== creep.name)
            continue;
        const { x, y } = parseTile(k);
        const r = Math.max(Math.abs(x - near.x), Math.abs(y - near.y));
        const walk = Math.max(Math.abs(x - creep.pos.x), Math.abs(y - creep.pos.y));
        if (r < bestRange || (r === bestRange && walk < bestWalk)) {
            bestRange = r;
            bestWalk = walk;
            best = k;
        }
    }
    if (held && index.get(claimKey(room, held)) === creep.name)
        index.delete(claimKey(room, held));
    if (!best) {
        delete creep.memory.townSpot;
        delete creep.memory.townSpotTick;
        return null;
    }
    creep.memory.townSpot = best;
    creep.memory.townSpotTick = Game.time;
    index.set(claimKey(room, best), creep.name);
    return best;
}
function goToSpot(creep, tile) {
    const { x, y } = parseTile(tile);
    if (creep.pos.x === x && creep.pos.y === y)
        return;
    creep.moveTo(new RoomPosition(x, y, creep.room.name), { reusePath: 20 });
}
function parkOn(creep, candidates, near) {
    if (candidates.length === 0)
        return false;
    const spot = claimSpot(creep, candidates, near);
    if (!spot)
        return false;
    goToSpot(creep, spot);
    return true;
}
function parkIdle(creep, kind) {
    var _a;
    const town = creep.room.memory.town;
    if (!town || !((_a = creep.room.controller) === null || _a === void 0 ? void 0 : _a.my))
        return false;
    if (kind === "watch" && parkOn(creep, town.posts))
        return true;
    return parkOn(creep, town.square);
}

const MAX_ENTRIES = 40;
function entries() {
    if (!Memory.chronicle)
        Memory.chronicle = [];
    if (Memory.chronicleEpoch === undefined)
        Memory.chronicleEpoch = Game.time;
    return Memory.chronicle;
}
function write(entry) {
    const log = entries();
    log.push(entry);
    if (log.length > MAX_ENTRIES)
        log.splice(0, log.length - MAX_ENTRIES);
    console.log(`[Chronicle] ${entry.text}`);
}
function chronicle(text) {
    write({ t: Game.time, text });
}
function annal(key, n) {
    if (!Memory.annals)
        Memory.annals = { since: Game.time, gold: 0, slain: 0, fallen: 0 };
    Memory.annals[key] += n;
}
function formatK(n) {
    if (n >= 1000000)
        return `${(n / 1000000).toFixed(1)}M`;
    if (n >= 1000)
        return `${(n / 1000).toFixed(1)}K`;
    return String(n);
}
function tally(key, n, describe, window) {
    var _a, _b;
    const log = entries();
    for (let i = log.length - 1; i >= 0; i--) {
        const e = log[i];
        if (e.key !== key)
            continue;
        if (Game.time - ((_a = e.last) !== null && _a !== void 0 ? _a : e.t) > window)
            break;
        e.n = ((_b = e.n) !== null && _b !== void 0 ? _b : 0) + n;
        e.last = Game.time;
        e.text = describe(e.n);
        return;
    }
    write({ t: Game.time, text: describe(n), key, n, last: Game.time });
}
function chronicleDate(t) {
    var _a;
    const epoch = (_a = Memory.chronicleEpoch) !== null && _a !== void 0 ? _a : t;
    const day = Math.floor((t - epoch) / TOWN_DAY_LENGTH) + 1;
    return `Day ${day}, ${townClock(t).phase}`;
}
function recentChronicle(count) {
    var _a;
    return ((_a = Memory.chronicle) !== null && _a !== void 0 ? _a : []).slice(-count);
}
const NAME_HEADS = [
    "Ash", "Raven", "Black", "Iron", "Grim", "Thorn", "Wolf", "Dusk",
    "Storm", "Ember", "Hollow", "Frost", "Gloam", "Bramble", "Crow", "Stone",
];
const NAME_TAILS = ["hold", "moor", "keep", "spire", "fell", "gate", "watch", "barrow", "crag", "mere", "ford", "reach"];
function nameHash(roomName) {
    let h = 2166136261;
    for (let i = 0; i < roomName.length; i++) {
        h ^= roomName.charCodeAt(i);
        h = Math.imul(h, 16777619) >>> 0;
    }
    return h;
}
function castleName(roomName) {
    var _a, _b;
    const given = (_b = (_a = Memory.rooms) === null || _a === void 0 ? void 0 : _a[roomName]) === null || _b === void 0 ? void 0 : _b.townName;
    if (given)
        return given;
    const h = nameHash(roomName);
    const head = NAME_HEADS[h % NAME_HEADS.length];
    let t = (h >>> 8) % NAME_TAILS.length;
    if (NAME_TAILS[t][0] === head[head.length - 1])
        t = (t + 1) % NAME_TAILS.length;
    return head + NAME_TAILS[t];
}
const EPITHETS = [
    "the Red", "the Grey", "the Bold", "the Pale", "the Grim", "the Silent", "the Wanderer", "the Elder",
    "the Black", "Ironhand", "the Unbowed", "the Fair", "the Cunning", "the Restless", "the Far-Seeing", "the Stern",
];
function lordName(username) {
    return `${username} ${EPITHETS[nameHash(username) % EPITHETS.length]}`;
}
const WILD_HEADS = [
    "Ashen", "Bleak", "Gallows", "Weeping", "Black", "Wolf", "Raven", "Thorn",
    "Misty", "Grey", "Witch", "Bone", "Sorrow", "Cinder", "Hollow", "Crow",
    "Blood", "Shadow", "Dread", "Barrow", "Silent", "Rotting", "Howling", "Wither",
];
const WILD_LANDS = [
    "Moor", "Fen", "Wood", "Vale", "Heath", "Marsh", "Waste", "Mire",
    "Glen", "Weald", "Forest", "March", "Bog", "Reach", "Thicket", "Scar",
];
function wildsName(roomName) {
    let h = nameHash(roomName);
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
    h = (h ^ (h >>> 16)) >>> 0;
    return `${WILD_HEADS[(h >>> 4) % WILD_HEADS.length]} ${WILD_LANDS[(h >>> 12) % WILD_LANDS.length]}`;
}

const TOWN_NAMES = [
    "Ravenhold", "Blackmoor", "Ashfall", "Grimward", "Thornkeep", "Duskmere",
    "Ironvale", "Wolfsbane", "Hollowmere", "Cinderfell", "Stormwatch", "Gallowgate",
    "Bleakharrow", "Mournspire", "Frosthaven",
];
const LANDMARKS = {
    spawn: ["barracks", "barracks"],
    tower: ["watchtower", "watchtowers"],
    storage: ["treasury", "treasuries"],
    terminal: ["trading post", "trading posts"],
    lab: ["alchemy lab", "alchemy labs"],
    factory: ["workshop", "workshops"],
    extractor: ["jeweler's mine", "jeweler's mines"],
    observer: ["seeing-stone", "seeing-stones"],
    powerSpawn: ["power shrine", "power shrines"],
    nuker: ["doom engine", "doom engines"],
};
const STRUCTURE_PLANNER = {
    roadPadding: 0,
    rampartPadding: 1,
    towerOffsetsFromSpawn: [
        { x: 2, y: 0 },
        { x: -2, y: 0 },
        { x: 0, y: 2 },
        { x: 0, y: -2 },
    ],
    planInterval: 50,
    maxActiveConstructionSites: 8,
    maxRoadConstructionSites: 15,
    maxPerimeterConstructionSites: 10,
    plannedCleanupInterval: 1000,
    plannedCleanupUnseenAge: 10000,
    rampartOnTopFor: [
        STRUCTURE_CONTAINER,
        STRUCTURE_SPAWN,
        STRUCTURE_STORAGE,
        STRUCTURE_EXTENSION,
        STRUCTURE_TOWER,
        STRUCTURE_LAB,
        STRUCTURE_NUKER,
        STRUCTURE_POWER_SPAWN,
        STRUCTURE_OBSERVER,
        STRUCTURE_TERMINAL,
        STRUCTURE_FACTORY,
    ],
};
const PLANNER_KEYS = {
    CONTAINER_PREFIX: "container",
    CONTAINER_SOURCE_PREFIX: "container_source_",
    CONTAINER_CONTROLLER: "container_controller",
    CONTAINER_MINERAL_PREFIX: "container_mineral_",
    EXTRACTOR_PREFIX: "extractor_",
    LINK_CONTROLLER: "link_controller",
    LINK_SOURCE_PREFIX: "link_source_",
    ROAD_PREFIX: "road_",
    CONNECTOR_PREFIX: "connector_",
    RAMPARTS_KEY: "ramparts",
    CASTLE_STAMP_KEY: "castle_stamp",
    STAMP_SPAWN_PREFIX: "stamp_spawn_",
    STAMP_STORAGE_KEY: "stamp_storage",
    STAMP_TERMINAL_KEY: "stamp_terminal",
    STAMP_FACTORY_KEY: "stamp_factory",
    STAMP_TOWER_PREFIX: "stamp_tower_",
    STAMP_EXTENSION_KEY: "stamp_extensions",
    STAMP_LAB_KEY: "stamp_labs",
    STAMP_NUKER_KEY: "stamp_nuker",
    STAMP_POWER_SPAWN_KEY: "stamp_power_spawn",
    STAMP_OBSERVER_KEY: "stamp_observer",
    STAMP_LINK_KEY: "stamp_link",
    STAMP_ROAD_KEY: "stamp_roads",
    STAMP_RAMPART_KEY: "stamp_ramparts",
    STAMP_WALL_KEY: "stamp_walls",
    CARDINAL_ROAD_PREFIX: "cardinal_road_",
    TOWN_WALL_KEY: "town_walls",
    TOWN_RAMPART_KEY: "town_ramparts",
};
const STAMP_PLANNER = {
    halfSize: 6,
};
const PERIMETER_PLANNER = {
    minRcl: 3,
    margin: 2,
    minEdge: 2,
    maxEdge: 47,
    replanInterval: 1500,
};

const CASTLE_STAMP = [
    { dx: 0, dy: 0, type: "spawn", minRcl: 1, critical: true },
    { dx: -2, dy: 0, type: "spawn", minRcl: 7, critical: true },
    { dx: 2, dy: 0, type: "spawn", minRcl: 8, critical: true },
    { dx: 0, dy: 2, type: "storage", minRcl: 4, critical: true },
    { dx: 0, dy: -2, type: "terminal", minRcl: 6, critical: true },
    { dx: 0, dy: -4, type: "factory", minRcl: 7, critical: true },
    { dx: 0, dy: -6, type: "observer", minRcl: 8 },
    { dx: 2, dy: -4, type: "power_spawn", minRcl: 8, critical: true },
    { dx: -2, dy: -4, type: "nuker", minRcl: 8 },
    { dx: 1, dy: 3, type: "link", minRcl: 5 },
    { dx: -4, dy: -4, type: "tower", minRcl: 3 },
    { dx: 4, dy: -4, type: "tower", minRcl: 5 },
    { dx: -4, dy: 4, type: "tower", minRcl: 5 },
    { dx: 4, dy: 4, type: "tower", minRcl: 6 },
    { dx: -4, dy: 0, type: "tower", minRcl: 7 },
    { dx: 4, dy: 0, type: "tower", minRcl: 8 },
    { dx: 3, dy: 2, type: "lab", minRcl: 6 },
    { dx: 4, dy: 2, type: "lab", minRcl: 6 },
    { dx: 3, dy: 3, type: "lab", minRcl: 6 },
    { dx: 4, dy: 3, type: "lab", minRcl: 7 },
    { dx: 5, dy: 2, type: "lab", minRcl: 7 },
    { dx: 5, dy: 3, type: "lab", minRcl: 7 },
    { dx: 3, dy: 4, type: "lab", minRcl: 7 },
    { dx: 5, dy: 4, type: "lab", minRcl: 8 },
    { dx: 3, dy: 1, type: "lab", minRcl: 8 },
    { dx: 4, dy: 1, type: "lab", minRcl: 8 },
    { dx: -1, dy: 0, type: "road", minRcl: 1 },
    { dx: 1, dy: 0, type: "road", minRcl: 1 },
    { dx: -3, dy: 0, type: "road", minRcl: 1 },
    { dx: 3, dy: 0, type: "road", minRcl: 1 },
    { dx: -5, dy: 0, type: "road", minRcl: 1 },
    { dx: 5, dy: 0, type: "road", minRcl: 1 },
    { dx: 0, dy: -1, type: "road", minRcl: 1 },
    { dx: 0, dy: 1, type: "road", minRcl: 1 },
    { dx: 0, dy: -3, type: "road", minRcl: 1 },
    { dx: 0, dy: 3, type: "road", minRcl: 1 },
    { dx: 0, dy: -5, type: "road", minRcl: 1 },
    { dx: 0, dy: 5, type: "road", minRcl: 1 },
    { dx: -1, dy: -1, type: "road", minRcl: 1 },
    { dx: -2, dy: -2, type: "road", minRcl: 1 },
    { dx: -3, dy: -3, type: "road", minRcl: 1 },
    { dx: 1, dy: -1, type: "road", minRcl: 1 },
    { dx: 2, dy: -2, type: "road", minRcl: 1 },
    { dx: 3, dy: -3, type: "road", minRcl: 1 },
    { dx: -1, dy: 1, type: "road", minRcl: 1 },
    { dx: -2, dy: 2, type: "road", minRcl: 1 },
    { dx: -3, dy: 3, type: "road", minRcl: 1 },
    { dx: 1, dy: 1, type: "road", minRcl: 1 },
    { dx: 2, dy: 2, type: "road", minRcl: 1 },
    { dx: 1, dy: 2, type: "road", minRcl: 1 },
    { dx: -1, dy: 2, type: "road", minRcl: 1 },
    { dx: 1, dy: -2, type: "road", minRcl: 1 },
    { dx: -1, dy: -2, type: "road", minRcl: 1 },
    { dx: 1, dy: -4, type: "road", minRcl: 1 },
    { dx: -1, dy: -4, type: "road", minRcl: 1 },
];
const MERCHANT_RING_ROAD_RADII = new Set([3, 5]);
const MERCHANT_RING_MAX_RADIUS = STAMP_PLANNER.halfSize;
const MERCHANT_RING_TARGET = 60;
function chebyshev(dx, dy) {
    return Math.max(Math.abs(dx), Math.abs(dy));
}
function isReservedLane(dx, dy) {
    if (dx === 0 && dy === 0)
        return false;
    const onSpoke = dx === 0 || dy === 0 || Math.abs(dx) === Math.abs(dy);
    return onSpoke || MERCHANT_RING_ROAD_RADII.has(chebyshev(dx, dy));
}
const STAMP_OCCUPIED_OFFSETS = new Set(CASTLE_STAMP.map((c) => `${c.dx},${c.dy}`));
const CORE_STRUCTURE_OFFSETS = new Set(CASTLE_STAMP.filter((c) => c.type !== "road").map((c) => `${c.dx},${c.dy}`));
function computeMerchantRingExtensionOffsets() {
    const offsets = [];
    const selected = new Set();
    const walkableNeighbors = (dx, dy) => {
        let n = 0;
        for (let ax = -1; ax <= 1; ax++) {
            for (let ay = -1; ay <= 1; ay++) {
                if (ax === 0 && ay === 0)
                    continue;
                const k = `${dx + ax},${dy + ay}`;
                if (CORE_STRUCTURE_OFFSETS.has(k) || selected.has(k))
                    continue;
                n++;
            }
        }
        return n;
    };
    for (let r = 1; r <= MERCHANT_RING_MAX_RADIUS && offsets.length < MERCHANT_RING_TARGET; r++) {
        const ring = [];
        for (let dx = -r; dx <= r; dx++) {
            for (let dy = -r; dy <= r; dy++) {
                if (chebyshev(dx, dy) !== r)
                    continue;
                if (Math.abs(dx) === r && Math.abs(dy) === r)
                    continue;
                if (isReservedLane(dx, dy))
                    continue;
                if (STAMP_OCCUPIED_OFFSETS.has(`${dx},${dy}`))
                    continue;
                ring.push({ dx, dy });
            }
        }
        ring.sort((a, b) => Math.atan2(a.dy, a.dx) - Math.atan2(b.dy, b.dx));
        for (const { dx, dy } of ring) {
            if (offsets.length >= MERCHANT_RING_TARGET)
                break;
            if (walkableNeighbors(dx, dy) < 1)
                continue;
            let strands = false;
            for (let ax = -1; ax <= 1 && !strands; ax++) {
                for (let ay = -1; ay <= 1; ay++) {
                    if (ax === 0 && ay === 0)
                        continue;
                    const nk = `${dx + ax},${dy + ay}`;
                    if (selected.has(nk) && walkableNeighbors(dx + ax, dy + ay) <= 1) {
                        strands = true;
                        break;
                    }
                }
            }
            if (strands)
                continue;
            offsets.push({ dx, dy });
            selected.add(`${dx},${dy}`);
        }
    }
    return offsets;
}
const MERCHANT_RING_EXTENSION_OFFSETS = computeMerchantRingExtensionOffsets();

const BLUEPRINT_VERSION = 2;
const SIZE$1 = 50;
const idx$1 = (x, y) => y * SIZE$1 + x;
const tx = (i) => i % SIZE$1;
const ty = (i) => (i - (i % SIZE$1)) / SIZE$1;
const cheb$1 = (a, b) => Math.max(Math.abs(tx(a) - tx(b)), Math.abs(ty(a) - ty(b)));
const NEIGHBOURS$2 = [
    [-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1],
];
const FREE = 0;
const SOLID = 1;
const ROAD = 2;
const OPEN = 3;
const UNREACHED = 0x3fffffff;
const HEADINGS = [
    [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1],
];
const BEND_COST = [0, 1, 4, 12, 40];
const STEP_SCALE = 4;
function pinnedTypes() {
    return new Set([
        STRUCTURE_SPAWN, STRUCTURE_STORAGE, STRUCTURE_TERMINAL, STRUCTURE_TOWER,
        STRUCTURE_LAB, STRUCTURE_LINK, STRUCTURE_FACTORY, STRUCTURE_POWER_SPAWN,
        STRUCTURE_NUKER, STRUCTURE_OBSERVER,
    ]);
}
const LAB_FLOWERS = [
    {
        labs: [[1, 0], [2, 0], [0, 1], [2, 1], [3, 1], [0, 2], [1, 2], [3, 2], [1, 3], [2, 3]],
        roads: [[0, 0], [1, 1], [2, 2], [3, 3]],
    },
    {
        labs: [[1, 0], [2, 0], [0, 1], [1, 1], [3, 1], [0, 2], [2, 2], [3, 2], [1, 3], [2, 3]],
        roads: [[3, 0], [2, 1], [1, 2], [0, 3]],
    },
];
const TRUNK_RCL = 2;
const MINERAL_RCL = 6;
const LINK_ORDER = (tag, farSource) => {
    if (tag === "storage")
        return 0;
    if (tag && tag === farSource)
        return 1;
    if (tag === "controller")
        return 2;
    return 3;
};
class Planner {
    constructor(input) {
        var _a;
        this.input = input;
        this.terrain = new Uint8Array(SIZE$1 * SIZE$1);
        this.occ = new Uint8Array(SIZE$1 * SIZE$1);
        this.oldRoad = new Uint8Array(SIZE$1 * SIZE$1);
        this.avoid = new Uint8Array(SIZE$1 * SIZE$1);
        this.drafts = [];
        this.byTile = new Map();
        this.oldExtensions = [];
        this.oldContainers = [];
        this.oldExtensionAt = new Uint8Array(SIZE$1 * SIZE$1);
        this.trunkRcl = new Map();
        this.exits = {};
        this.order = 0;
        this.anchor = -1;
        this.hub = -1;
        this.reach = null;
        for (let y = 0; y < SIZE$1; y++) {
            for (let x = 0; x < SIZE$1; x++) {
                const m = input.terrain(x, y);
                const i = idx$1(x, y);
                if (m & TERRAIN_MASK_WALL) {
                    this.terrain[i] = 1;
                    this.occ[i] = SOLID;
                }
                else if (m & TERRAIN_MASK_SWAMP) {
                    this.terrain[i] = 2;
                }
            }
        }
        const natural = [input.controller, ...input.sources, ...(input.mineral ? [input.mineral] : [])];
        for (const n of natural)
            this.occ[idx$1(n.x, n.y)] = SOLID;
        const pinned = pinnedTypes();
        for (const s of input.structures) {
            const i = idx$1(s.x, s.y);
            if (s.type === STRUCTURE_ROAD)
                this.oldRoad[i] = 1;
            else if (s.type === STRUCTURE_RAMPART || s.type === STRUCTURE_EXTRACTOR)
                continue;
            else if (s.type === STRUCTURE_CONTAINER)
                this.oldContainers.push(i);
            else if (s.type === STRUCTURE_EXTENSION) {
                this.oldExtensions.push(i);
                this.oldExtensionAt[i] = 1;
            }
            else if (pinned.has(s.type))
                this.add(s.type, i, { built: true });
            else
                this.occ[i] = SOLID;
        }
        for (const k of (_a = input.avoid) !== null && _a !== void 0 ? _a : []) {
            const comma = k.indexOf(",");
            const i = idx$1(+k.slice(0, comma), +k.slice(comma + 1));
            this.avoid[i] = 1;
            if (this.occ[i] === FREE)
                this.occ[i] = OPEN;
        }
    }
    run() {
        this.anchor = this.pickAnchor();
        if (this.anchor < 0)
            return null;
        this.hub = this.placeStorage();
        if (this.hub < 0)
            return null;
        this.placeLabs();
        this.placeStamp();
        this.placeTrunks();
        this.fillRemaining();
        return this.finish();
    }
    inner(i) {
        const x = tx(i);
        const y = ty(i);
        return x >= 1 && x <= 48 && y >= 1 && y <= 48;
    }
    passable(i) {
        return this.inner(i) && this.occ[i] !== SOLID;
    }
    buildable(i) {
        const x = tx(i);
        const y = ty(i);
        return x >= 2 && x <= 47 && y >= 2 && y <= 47 && this.occ[i] === FREE;
    }
    moveCost(i) {
        if (this.avoid[i])
            return 50;
        if (this.occ[i] === ROAD)
            return 1;
        if (this.oldExtensionAt[i] && this.occ[i] === FREE)
            return 30;
        if (this.oldRoad[i])
            return 1;
        return this.terrain[i] === 2 ? 10 : 2;
    }
    at(x, y) {
        if (x < 0 || y < 0 || x >= SIZE$1 || y >= SIZE$1)
            return -1;
        return idx$1(x, y);
    }
    neighbours(i) {
        const out = [];
        const x = tx(i);
        const y = ty(i);
        for (const [dx, dy] of NEIGHBOURS$2) {
            const n = this.at(x + dx, y + dy);
            if (n >= 0)
                out.push(n);
        }
        return out;
    }
    add(type, i, opts = {}) {
        const d = { type, i, built: !!opts.built, tag: opts.tag, order: this.order++, minRcl: opts.minRcl };
        this.drafts.push(d);
        this.byTile.set(i, d);
        if (type !== STRUCTURE_CONTAINER && type !== STRUCTURE_EXTRACTOR)
            this.occ[i] = SOLID;
        else if (this.occ[i] === FREE)
            this.occ[i] = OPEN;
        return d;
    }
    remove(d) {
        this.drafts.splice(this.drafts.indexOf(d), 1);
        this.byTile.delete(d.i);
        this.occ[d.i] = FREE;
    }
    count(type) {
        let n = 0;
        for (const d of this.drafts)
            if (d.type === type)
                n++;
        return n;
    }
    want(type) {
        return CONTROLLER_STRUCTURES[type][8];
    }
    hubStarts() {
        return this.neighbours(this.hub).filter((n) => this.passable(n));
    }
    dijkstra() {
        const dist = new Int32Array(SIZE$1 * SIZE$1).fill(UNREACHED);
        const heap = new MinHeap();
        for (const s of this.hubStarts()) {
            dist[s] = 0;
            heap.push(0, s);
        }
        while (heap.size > 0) {
            const [d, i] = heap.pop();
            if (d > dist[i])
                continue;
            for (const n of this.neighbours(i)) {
                if (!this.passable(n))
                    continue;
                const nd = d + this.moveCost(n);
                if (nd < dist[n]) {
                    dist[n] = nd;
                    heap.push(nd, n);
                }
            }
        }
        return { dist };
    }
    roadDijkstra() {
        const states = SIZE$1 * SIZE$1 * 8;
        const cost = new Int32Array(states).fill(UNREACHED);
        const parent = new Int32Array(states).fill(-1);
        const heap = new MinHeap();
        const hx = tx(this.hub);
        const hy = ty(this.hub);
        for (const s of this.hubStarts()) {
            const h = HEADINGS.findIndex(([dx, dy]) => dx === tx(s) - hx && dy === ty(s) - hy);
            cost[s * 8 + h] = 0;
            heap.push(0, s * 8 + h);
        }
        while (heap.size > 0) {
            const [d, st] = heap.pop();
            if (d > cost[st])
                continue;
            const i = st >> 3;
            const h = st & 7;
            const x = tx(i);
            const y = ty(i);
            for (let nh = 0; nh < 8; nh++) {
                const n = this.at(x + HEADINGS[nh][0], y + HEADINGS[nh][1]);
                if (n < 0 || !this.passable(n))
                    continue;
                const turn = Math.abs(nh - h);
                const nd = d + this.moveCost(n) * STEP_SCALE + BEND_COST[Math.min(turn, 8 - turn)];
                const ns = n * 8 + nh;
                if (nd < cost[ns]) {
                    cost[ns] = nd;
                    parent[ns] = st;
                    heap.push(nd, ns);
                }
            }
        }
        const dist = new Int32Array(SIZE$1 * SIZE$1).fill(UNREACHED);
        const best = new Int32Array(SIZE$1 * SIZE$1).fill(-1);
        for (let st = 0; st < states; st++) {
            const i = st >> 3;
            if (cost[st] < dist[i]) {
                dist[i] = cost[st];
                best[i] = st;
            }
        }
        const road = (to) => {
            const out = [];
            for (let st = best[to]; st >= 0; st = parent[st])
                out.push(st >> 3);
            return out;
        };
        return { dist, road };
    }
    flood() {
        const seen = new Uint8Array(SIZE$1 * SIZE$1);
        const queue = this.hubStarts();
        for (const s of queue)
            seen[s] = 1;
        for (let head = 0; head < queue.length; head++) {
            for (const n of this.neighbours(queue[head])) {
                if (seen[n] || !this.passable(n))
                    continue;
                seen[n] = 1;
                queue.push(n);
            }
        }
        return seen;
    }
    hasAccess(i, seen) {
        return this.neighbours(i).some((n) => seen[n] === 1);
    }
    placeChecked(type, i, tag) {
        if (!this.reach)
            this.reach = this.flood();
        const before = this.reach;
        const d = this.add(type, i, { tag });
        const after = this.flood();
        let ok = this.hasAccess(i, after);
        for (let t = 0; ok && t < SIZE$1 * SIZE$1; t++) {
            if (before[t] && !after[t] && (this.occ[t] === ROAD || this.occ[t] === OPEN))
                ok = false;
        }
        for (const other of this.drafts) {
            if (!ok)
                break;
            if (other === d || other.type === STRUCTURE_CONTAINER || other.type === STRUCTURE_EXTRACTOR)
                continue;
            if (this.hasAccess(other.i, before) && !this.hasAccess(other.i, after))
                ok = false;
        }
        if (!ok) {
            this.remove(d);
            return false;
        }
        this.reach = after;
        return true;
    }
    pickAnchor() {
        if (this.input.anchor)
            return idx$1(this.input.anchor.x, this.input.anchor.y);
        const spawn = this.drafts.find((d) => d.type === STRUCTURE_SPAWN);
        if (spawn)
            return spawn.i;
        const core = CASTLE_STAMP.filter((c) => c.type !== "road" && c.type !== "lab");
        const must = CASTLE_STAMP.filter((c) => c.type === "spawn" && c.minRcl === 1 || c.type === "storage");
        const pois = [...this.input.sources, this.input.controller];
        let best = -1;
        let bestScore = -Infinity;
        for (let y = 8; y <= 41; y++) {
            for (let x = 8; x <= 41; x++) {
                if (must.some((c) => !this.buildable(idx$1(x + c.dx, y + c.dy))))
                    continue;
                let score = 0;
                for (const c of core)
                    if (this.buildable(idx$1(x + c.dx, y + c.dy)))
                        score += 3;
                for (const c of CASTLE_STAMP) {
                    if (c.type === "road" && this.occ[idx$1(x + c.dx, y + c.dy)] !== SOLID)
                        score += 1;
                }
                for (const p of pois) {
                    const r = Math.max(Math.abs(p.x - x), Math.abs(p.y - y));
                    score -= r * 0.3;
                    if (r < 8)
                        score -= (8 - r) * 2;
                }
                if (score > bestScore) {
                    bestScore = score;
                    best = idx$1(x, y);
                }
            }
        }
        if (best >= 0)
            this.add(STRUCTURE_SPAWN, best);
        return best;
    }
    placeStorage() {
        const built = this.drafts.find((d) => d.type === STRUCTURE_STORAGE);
        if (built)
            return built.i;
        const cell = CASTLE_STAMP.find((c) => c.type === "storage");
        const ax = tx(this.anchor);
        const ay = ty(this.anchor);
        const stamp = this.at(ax + cell.dx, ay + cell.dy);
        if (stamp >= 0 && this.buildable(stamp))
            return this.add(STRUCTURE_STORAGE, stamp).i;
        let best = -1;
        let bestD = Infinity;
        for (let i = 0; i < SIZE$1 * SIZE$1; i++) {
            if (!this.buildable(i))
                continue;
            const open = this.neighbours(i).filter((n) => this.passable(n)).length;
            if (open < 4)
                continue;
            const d = cheb$1(i, this.anchor);
            if (d >= 2 && d < bestD) {
                bestD = d;
                best = i;
            }
        }
        return best >= 0 ? this.add(STRUCTURE_STORAGE, best).i : -1;
    }
    placeLabs() {
        const oldLabs = this.drafts.filter((d) => d.type === STRUCTURE_LAB);
        const oldLabTiles = new Set(oldLabs.map((d) => d.i));
        const ax = tx(this.anchor);
        const ay = ty(this.anchor);
        const kept = new Set();
        for (const c of CASTLE_STAMP) {
            if (c.type === "lab" || c.type === "tower")
                continue;
            const i = this.at(ax + c.dx, ay + c.dy);
            if (i >= 0)
                kept.add(i);
        }
        const oldExt = new Set(this.oldExtensions);
        const { dist } = this.dijkstra();
        let best = null;
        for (let y = 2; y <= 44; y++) {
            for (let x = 2; x <= 44; x++) {
                for (const flower of LAB_FLOWERS) {
                    const labs = flower.labs.map(([dx, dy]) => idx$1(x + dx, y + dy));
                    const roads = flower.roads.map(([dx, dy]) => idx$1(x + dx, y + dy));
                    if (labs.some((i) => !oldLabTiles.has(i) && (!this.buildable(i) || kept.has(i))))
                        continue;
                    if (roads.some((i) => !this.passable(i) || this.byTile.has(i)))
                        continue;
                    const reach = Math.min(...roads.map((i) => dist[i]));
                    if (reach >= UNREACHED)
                        continue;
                    let score = -reach;
                    for (const i of labs) {
                        if (oldLabTiles.has(i))
                            score += 1000;
                        if (oldExt.has(i))
                            score -= 3;
                    }
                    if (!best || score > best.score)
                        best = { labs, roads, score };
                }
            }
        }
        for (const d of oldLabs)
            if (!best || !best.labs.includes(d.i))
                this.remove(d);
        if (!best)
            return;
        for (const i of best.labs)
            if (!this.byTile.has(i))
                this.add(STRUCTURE_LAB, i);
        for (const i of best.roads)
            if (this.occ[i] === FREE)
                this.occ[i] = OPEN;
    }
    placeStamp() {
        var _a;
        const ax = tx(this.anchor);
        const ay = ty(this.anchor);
        for (const c of CASTLE_STAMP) {
            const i = this.at(ax + c.dx, ay + c.dy);
            if (i < 0)
                continue;
            if (c.type === "road") {
                if (this.occ[i] === FREE)
                    this.occ[i] = OPEN;
                continue;
            }
            if (c.type === "lab" || c.type === "storage")
                continue;
            if (c.type === "link") {
                if (this.storageLink() || !this.buildable(i) || cheb$1(i, this.hub) > 2)
                    continue;
                this.add(STRUCTURE_LINK, i, { tag: "storage" });
                continue;
            }
            const type = (c.type === "power_spawn" ? STRUCTURE_POWER_SPAWN : c.type);
            if (((_a = this.byTile.get(i)) === null || _a === void 0 ? void 0 : _a.type) === type)
                continue;
            if (this.count(type) >= this.want(type))
                continue;
            if (this.buildable(i))
                this.add(type, i);
        }
    }
    storageLink() {
        const tagged = this.drafts.find((d) => d.tag === "storage");
        if (tagged)
            return tagged;
        const near = this.drafts.find((d) => d.type === STRUCTURE_LINK && !d.tag && cheb$1(d.i, this.hub) <= 2);
        if (near)
            near.tag = "storage";
        return near;
    }
    placeTrunks() {
        const { dist: start } = this.dijkstra();
        const sources = [...this.input.sources].sort((a, b) => this.bestNear(start, idx$1(a.x, a.y), 1) - this.bestNear(start, idx$1(b.x, b.y), 1));
        for (const s of sources)
            this.trunkTo(idx$1(s.x, s.y), 1, `source:${s.id}`, TRUNK_RCL);
        const c = this.input.controller;
        this.trunkTo(idx$1(c.x, c.y), 2, "controller", TRUNK_RCL);
        const m = this.input.mineral;
        if (m) {
            const end = this.trunkTo(idx$1(m.x, m.y), 1, `mineral:${m.id}`, MINERAL_RCL);
            if (end >= 0)
                this.add(STRUCTURE_EXTRACTOR, idx$1(m.x, m.y), { tag: `mineral:${m.id}`, minRcl: MINERAL_RCL });
        }
        for (const side of ["top", "right", "bottom", "left"])
            this.trunkToExit(side);
    }
    bestNear(dist, target, range) {
        let best = UNREACHED;
        for (let i = 0; i < SIZE$1 * SIZE$1; i++) {
            if (cheb$1(i, target) <= range && dist[i] < best)
                best = dist[i];
        }
        return best;
    }
    trunkTo(target, range, tag, rcl) {
        var _a;
        const { dist, road } = this.roadDijkstra();
        let end = (_a = this.oldContainers.find((i) => cheb$1(i, target) <= range && dist[i] < UNREACHED)) !== null && _a !== void 0 ? _a : -1;
        for (const onRoad of [false, true]) {
            if (end >= 0)
                break;
            let best = UNREACHED;
            for (let i = 0; i < SIZE$1 * SIZE$1; i++) {
                if (cheb$1(i, target) > range || !this.passable(i) || (this.occ[i] === ROAD) !== onRoad)
                    continue;
                if (this.byTile.has(i) || dist[i] >= best)
                    continue;
                best = dist[i];
                end = i;
            }
        }
        if (end < 0)
            return -1;
        for (const i of road(end).slice(1))
            this.markRoad(i, rcl);
        this.add(STRUCTURE_CONTAINER, end, {
            tag,
            minRcl: tag.startsWith("mineral:") ? MINERAL_RCL : undefined,
        });
        if (!tag.startsWith("mineral:"))
            this.placeEndLink(target, end, tag);
        for (let i = 0; i < SIZE$1 * SIZE$1; i++) {
            if (this.occ[i] !== FREE)
                continue;
            const nearTarget = tag === "controller"
                ? cheb$1(i, target) <= 3 && cheb$1(i, end) <= 1
                : cheb$1(i, target) <= 1;
            if (nearTarget)
                this.occ[i] = OPEN;
        }
        return end;
    }
    placeEndLink(target, container, tag) {
        const reach = tag === "controller" ? 3 : 2;
        const old = this.drafts.find((d) => d.type === STRUCTURE_LINK && d.built && !d.tag && cheb$1(d.i, container) <= reach &&
            (tag !== "controller" || cheb$1(d.i, target) <= 3));
        if (old) {
            old.tag = tag;
            return;
        }
        let best = -1;
        let bestScore = Infinity;
        for (const n of this.neighbours(container)) {
            if (!this.buildable(n))
                continue;
            const r = cheb$1(n, target);
            if (tag === "controller" ? r > 3 : false)
                continue;
            const score = tag === "controller" ? r : r <= 1 ? 1 : 0;
            if (score < bestScore) {
                bestScore = score;
                best = n;
            }
        }
        if (best >= 0)
            this.add(STRUCTURE_LINK, best, { tag });
    }
    trunkToExit(side) {
        const edge = [];
        for (let k = 1; k < SIZE$1 - 1; k++) {
            const [x, y] = side === "top" ? [k, 0] : side === "bottom" ? [k, SIZE$1 - 1] : side === "left" ? [0, k] : [SIZE$1 - 1, k];
            if (this.terrain[idx$1(x, y)] !== 1)
                edge.push(idx$1(x, y));
        }
        if (edge.length === 0)
            return;
        const { dist, road } = this.roadDijkstra();
        let end = -1;
        let best = UNREACHED;
        for (const e of edge) {
            for (const n of this.neighbours(e)) {
                if (dist[n] < best) {
                    best = dist[n];
                    end = n;
                }
            }
        }
        if (end < 0)
            return;
        const path = road(end);
        this.exits[side] = path.map((i) => ({ x: tx(i), y: ty(i) }));
        for (const i of path)
            if (this.occ[i] === FREE)
                this.occ[i] = OPEN;
    }
    markRoad(i, rcl) {
        var _a;
        if (this.avoid[i])
            return;
        this.occ[i] = ROAD;
        this.trunkRcl.set(i, Math.min((_a = this.trunkRcl.get(i)) !== null && _a !== void 0 ? _a : 8, rcl));
    }
    fillRemaining() {
        const { dist } = this.dijkstra();
        const access = (i) => {
            let best = UNREACHED;
            for (const n of this.neighbours(i))
                if (this.passable(n) && dist[n] < best)
                    best = dist[n];
            return best;
        };
        const ax = tx(this.anchor);
        const ay = ty(this.anchor);
        const onLattice = (i) => (((tx(i) + ty(i) - ax - ay) % 4) + 4) % 4 === 0 || (((tx(i) - ty(i) - ax + ay) % 4) + 4) % 4 === 0;
        const lattice = [];
        for (let i = 0; i < SIZE$1 * SIZE$1; i++) {
            if (!this.buildable(i) || onLattice(i))
                continue;
            const d = access(i);
            if (d < UNREACHED)
                lattice.push({ i, d });
        }
        lattice.sort((a, b) => a.d - b.d || a.i - b.i);
        if (!this.storageLink()) {
            const near = lattice
                .concat(this.openNear(this.hub, 2, access))
                .filter((c) => cheb$1(c.i, this.hub) <= 2)
                .sort((a, b) => a.d - b.d);
            for (const c of near) {
                if (this.buildable(c.i) && this.placeChecked(STRUCTURE_LINK, c.i, "storage"))
                    break;
            }
        }
        const fill = (type, candidates) => {
            for (const c of candidates) {
                if (this.count(type) >= this.want(type))
                    return;
                if (this.buildable(c.i))
                    this.placeChecked(type, c.i);
            }
        };
        const old = this.oldExtensions
            .map((i) => ({ i, d: access(i) }))
            .filter((c) => c.d < UNREACHED)
            .sort((a, b) => a.d - b.d);
        fill(STRUCTURE_EXTENSION, old);
        for (const type of [
            STRUCTURE_SPAWN, STRUCTURE_TOWER, STRUCTURE_TERMINAL, STRUCTURE_POWER_SPAWN,
            STRUCTURE_FACTORY, STRUCTURE_NUKER, STRUCTURE_OBSERVER,
        ]) {
            fill(type, lattice);
        }
        fill(STRUCTURE_EXTENSION, lattice);
    }
    openNear(center, range, access) {
        const out = [];
        for (let i = 0; i < SIZE$1 * SIZE$1; i++) {
            if (cheb$1(i, center) > range || !this.buildable(i))
                continue;
            const d = access(i);
            if (d < UNREACHED)
                out.push({ i, d });
        }
        return out;
    }
    finish() {
        var _a;
        const entries = [];
        const byType = new Map();
        for (const d of this.drafts) {
            if (!byType.has(d.type))
                byType.set(d.type, []);
            byType.get(d.type).push(d);
        }
        const farSource = this.farSourceTag();
        const rclOf = new Map();
        for (const [type, list] of byType) {
            list.sort((a, b) => Number(b.built) - Number(a.built) ||
                (type === STRUCTURE_LINK ? LINK_ORDER(a.tag, farSource) - LINK_ORDER(b.tag, farSource) : 0) ||
                a.order - b.order);
            const caps = CONTROLLER_STRUCTURES[type];
            list.forEach((d, n) => {
                var _a;
                let rcl = 1;
                while (rcl <= 8 && caps[rcl] <= n)
                    rcl++;
                if (rcl > 8)
                    return;
                rcl = Math.max(rcl, (_a = d.minRcl) !== null && _a !== void 0 ? _a : 1);
                rclOf.set(d, rcl);
                entries.push({ type: d.type, x: tx(d.i), y: ty(d.i), rcl, ...(d.tag ? { tag: d.tag } : {}) });
            });
        }
        const roadRcl = new Map(this.trunkRcl);
        const { dist, road } = this.roadDijkstra();
        for (const [d, rcl] of rclOf) {
            if (d.tag && d.tag !== "storage")
                continue;
            if (d.type === STRUCTURE_CONTAINER || d.type === STRUCTURE_EXTRACTOR)
                continue;
            let door = -1;
            for (const n of this.neighbours(d.i)) {
                if (this.passable(n) && (door < 0 || dist[n] < dist[door]))
                    door = n;
            }
            if (door < 0 || dist[door] >= UNREACHED)
                continue;
            for (const i of road(door)) {
                roadRcl.set(i, Math.min((_a = roadRcl.get(i)) !== null && _a !== void 0 ? _a : 8, rcl));
            }
        }
        for (const [i, rcl] of roadRcl) {
            if (this.byTile.has(i) || this.avoid[i])
                continue;
            entries.push({ type: STRUCTURE_ROAD, x: tx(i), y: ty(i), rcl });
        }
        return {
            anchor: { x: tx(this.anchor), y: ty(this.anchor) },
            hub: { x: tx(this.hub), y: ty(this.hub) },
            entries,
            exits: this.exits,
        };
    }
    farSourceTag() {
        let best;
        let bestD = -1;
        for (const s of this.input.sources) {
            const d = cheb$1(idx$1(s.x, s.y), this.hub);
            if (d > bestD) {
                bestD = d;
                best = `source:${s.id}`;
            }
        }
        return best;
    }
}
class MinHeap {
    constructor() {
        this.keys = [];
        this.vals = [];
    }
    get size() {
        return this.keys.length;
    }
    push(key, val) {
        const k = this.keys;
        const v = this.vals;
        let i = k.length;
        k.push(key);
        v.push(val);
        while (i > 0) {
            const p = (i - 1) >> 1;
            if (k[p] <= key)
                break;
            k[i] = k[p];
            v[i] = v[p];
            i = p;
        }
        k[i] = key;
        v[i] = val;
    }
    pop() {
        const k = this.keys;
        const v = this.vals;
        const top = [k[0], v[0]];
        const lastK = k.pop();
        const lastV = v.pop();
        const n = k.length;
        if (n > 0) {
            let i = 0;
            for (;;) {
                const l = 2 * i + 1;
                if (l >= n)
                    break;
                const r = l + 1;
                const c = r < n && k[r] < k[l] ? r : l;
                if (k[c] >= lastK)
                    break;
                k[i] = k[c];
                v[i] = v[c];
                i = c;
            }
            k[i] = lastK;
            v[i] = lastV;
        }
        return top;
    }
}
function planBlueprint(input) {
    return new Planner(input).run();
}
const TYPE_CODES = {
    spawn: "S", extension: "E", tower: "T", lab: "L", storage: "O", terminal: "M",
    factory: "F", observer: "B", powerSpawn: "P", nuker: "N", link: "K", container: "C",
    extractor: "X", road: "R",
};
const CODE_TYPES = {};
for (const t in TYPE_CODES)
    CODE_TYPES[TYPE_CODES[t]] = t;
function encodeBlueprint(bp, time) {
    const exits = {};
    for (const side in bp.exits) {
        exits[side] = bp.exits[side].map((p) => `${p.x},${p.y}`).join(";");
    }
    return {
        v: BLUEPRINT_VERSION,
        at: time,
        anchor: bp.anchor,
        hub: bp.hub,
        s: bp.entries
            .map((e) => `${TYPE_CODES[e.type]}${e.x},${e.y},${e.rcl}${e.tag ? `,${e.tag}` : ""}`)
            .join(";"),
        exits,
    };
}
function decodeBlueprint(mem) {
    const entries = [];
    for (const part of mem.s ? mem.s.split(";") : []) {
        const [x, y, rcl, ...tag] = part.slice(1).split(",");
        const e = { type: CODE_TYPES[part[0]], x: +x, y: +y, rcl: +rcl };
        if (tag.length > 0)
            e.tag = tag.join(",");
        entries.push(e);
    }
    const exits = {};
    for (const side in mem.exits) {
        exits[side] = mem.exits[side].split(";").map((k) => {
            const [x, y] = k.split(",");
            return { x: +x, y: +y };
        });
    }
    return { anchor: mem.anchor, hub: mem.hub, entries, exits };
}
const decoded = {};
function readBlueprint(room) {
    const mem = room.memory.blueprint;
    if (!mem)
        return null;
    const hit = decoded[room.name];
    if (hit && hit.at === mem.at)
        return hit.bp;
    const bp = decodeBlueprint(mem);
    decoded[room.name] = { at: mem.at, bp };
    return bp;
}
function blueprintInput(room) {
    const terrain = room.getTerrain();
    const structures = [];
    for (const s of room.find(FIND_STRUCTURES)) {
        const t = s.structureType;
        if (t === STRUCTURE_CONTROLLER)
            continue;
        const theirs = s.my === false;
        structures.push({ type: theirs ? "obstacle" : t, x: s.pos.x, y: s.pos.y });
    }
    const spawn = room.find(FIND_MY_SPAWNS)[0];
    const cached = room.memory.castleAnchor;
    const anchorSpawn = cached && room.find(FIND_MY_SPAWNS).some((s) => s.pos.x === cached.x && s.pos.y === cached.y)
        ? cached
        : spawn
            ? { x: spawn.pos.x, y: spawn.pos.y }
            : undefined;
    const mineral = room.find(FIND_MINERALS)[0];
    const avoid = townFootprint(room.memory.town);
    return {
        terrain: (x, y) => terrain.get(x, y),
        controller: { x: room.controller.pos.x, y: room.controller.pos.y },
        sources: room.find(FIND_SOURCES).map((s) => ({ id: s.id, x: s.pos.x, y: s.pos.y })),
        mineral: mineral ? { id: mineral.id, x: mineral.pos.x, y: mineral.pos.y } : null,
        structures,
        anchor: anchorSpawn,
        avoid,
    };
}
function blueprintIsCurrent(room) {
    const mem = room.memory.blueprint;
    if (!mem || mem.v !== BLUEPRINT_VERSION)
        return false;
    const spawns = room.find(FIND_MY_SPAWNS);
    if (spawns.length === 0)
        return true;
    return spawns.some((s) => s.pos.x === mem.anchor.x && s.pos.y === mem.anchor.y);
}
function planRoomBlueprint(room) {
    const bp = planBlueprint(blueprintInput(room));
    if (!bp)
        return null;
    room.memory.blueprint = encodeBlueprint(bp, Game.time);
    room.memory.castleAnchor = bp.anchor;
    return bp;
}
function keptRoadTiles(room) {
    var _a, _b, _c;
    const bp = readBlueprint(room);
    if (!bp)
        return null;
    const lanes = (_b = (_a = room.memory.blueprint) === null || _a === void 0 ? void 0 : _a.lanes) !== null && _b !== void 0 ? _b : [];
    const hit = decoded[room.name];
    const key = lanes.join();
    if (hit.roads && hit.lanes === key)
        return hit.roads;
    const out = new Set();
    for (const e of bp.entries)
        if (e.type === STRUCTURE_ROAD)
            out.add(`${e.x},${e.y}`);
    for (const side of lanes) {
        for (const p of (_c = bp.exits[side]) !== null && _c !== void 0 ? _c : [])
            out.add(`${p.x},${p.y}`);
    }
    hit.roads = out;
    hit.lanes = key;
    return out;
}
const AGE_NAMES = {
    1: "Founding",
    2: "Palisade",
    3: "Watchtower",
    4: "Keep",
    5: "Linked Halls",
    6: "Alchemy",
    7: "Kingdom",
    8: "Empire",
};
function describeBlueprint(room) {
    var _a, _b, _c, _d, _e;
    const bp = readBlueprint(room);
    if (!bp)
        return [`[Blueprint] ${room.name}: no plan yet`];
    const rcl = (_b = (_a = room.controller) === null || _a === void 0 ? void 0 : _a.level) !== null && _b !== void 0 ? _b : 0;
    const standing = new Set();
    for (const s of room.find(FIND_STRUCTURES))
        standing.add(`${s.pos.x},${s.pos.y}:${s.structureType}`);
    const lines = [`[Blueprint] ${room.name}: anchor ${bp.anchor.x},${bp.anchor.y}, storage ${bp.hub.x},${bp.hub.y}, now RCL ${rcl}`];
    for (let age = 1; age <= 8; age++) {
        const counts = new Map();
        let built = 0;
        let total = 0;
        for (const e of bp.entries) {
            if (e.rcl !== age)
                continue;
            total++;
            if (standing.has(`${e.x},${e.y}:${e.type}`))
                built++;
            counts.set(e.type, ((_c = counts.get(e.type)) !== null && _c !== void 0 ? _c : 0) + 1);
        }
        if (total === 0)
            continue;
        const what = [...counts].map(([t, n]) => `${n} ${t}`).join(", ");
        const mark = age <= rcl ? `${built}/${total} built` : "to come";
        lines.push(`  Age ${age} ${AGE_NAMES[age]}: ${what} (${mark})`);
    }
    const kept = keptRoadTiles(room);
    let roads = 0;
    let stray = 0;
    for (const s of room.find(FIND_STRUCTURES)) {
        if (s.structureType !== STRUCTURE_ROAD)
            continue;
        roads++;
        if (!kept.has(`${s.pos.x},${s.pos.y}`))
            stray++;
    }
    const lanes = (_e = (_d = room.memory.blueprint) === null || _d === void 0 ? void 0 : _d.lanes) !== null && _e !== void 0 ? _e : [];
    lines.push(`  Roads: ${roads} standing, ${stray} off the plan and left to decay; exit roads in use: ${lanes.join(", ") || "none"}`);
    return lines;
}

let assignmentCacheTick = -1;
const assignedContainerIdsByRoomAndRole = {};
let roomStructuresCacheTick = -1;
const roomStructuresCache = {};
let roomContainersCacheTick = -1;
const roomContainersCache = {};
function getAssignedContainerIdsByRole(room, role) {
    if (assignmentCacheTick !== Game.time) {
        assignmentCacheTick = Game.time;
        for (const key of Object.keys(assignedContainerIdsByRoomAndRole)) {
            delete assignedContainerIdsByRoomAndRole[key];
        }
    }
    const cacheKey = `${room.name}:${role}`;
    if (!assignedContainerIdsByRoomAndRole[cacheKey]) {
        const taken = new Set();
        for (const creepName in Game.creeps) {
            const creep = Game.creeps[creepName];
            if (creep.room.name !== room.name)
                continue;
            if (creep.memory.role !== role)
                continue;
            const assigned = creep.memory.assignedContainerId;
            if (assigned)
                taken.add(assigned.toString());
        }
        assignedContainerIdsByRoomAndRole[cacheKey] = taken;
    }
    return assignedContainerIdsByRoomAndRole[cacheKey];
}
function closestByPath(pos, targets) {
    var _a;
    return (_a = pos.findClosestByPath(targets, { ignoreCreeps: true })) !== null && _a !== void 0 ? _a : null;
}
function getRoomStructures(room) {
    if (roomStructuresCacheTick !== Game.time) {
        roomStructuresCacheTick = Game.time;
        for (const key of Object.keys(roomStructuresCache)) {
            delete roomStructuresCache[key];
        }
    }
    if (!roomStructuresCache[room.name]) {
        roomStructuresCache[room.name] = room.find(FIND_STRUCTURES);
    }
    return roomStructuresCache[room.name];
}
function getRoomContainers(room) {
    if (roomContainersCacheTick !== Game.time) {
        roomContainersCacheTick = Game.time;
        for (const key of Object.keys(roomContainersCache)) {
            delete roomContainersCache[key];
        }
    }
    if (!roomContainersCache[room.name]) {
        roomContainersCache[room.name] = getRoomStructures(room).filter((s) => s.structureType === STRUCTURE_CONTAINER);
    }
    return roomContainersCache[room.name];
}
function findBalancedSource(creep) {
    var _a;
    const sources = getSafeSources(creep.room);
    if (sources.length === 0)
        return null;
    const harvestersPerSource = {};
    for (const s of sources)
        harvestersPerSource[s.id] = 0;
    for (const name in Game.creeps) {
        const c = Game.creeps[name];
        if (c.name === creep.name)
            continue;
        if (c.room.name !== creep.room.name)
            continue;
        const assignedId = c.memory.assignedSourceId;
        if (assignedId && harvestersPerSource[assignedId] !== undefined) {
            harvestersPerSource[assignedId]++;
        }
    }
    let best = null;
    let bestCount = Infinity;
    for (const source of sources) {
        const count = (_a = harvestersPerSource[source.id]) !== null && _a !== void 0 ? _a : 0;
        if (count < bestCount || (count === bestCount && best && creep.pos.getRangeTo(source) < creep.pos.getRangeTo(best))) {
            best = source;
            bestCount = count;
        }
    }
    return best;
}
function getSources(room) {
    if (Memory.sources)
        delete Memory.sources;
    if (Memory.sourcesLastScan)
        delete Memory.sourcesLastScan;
    return room.find(FIND_SOURCES);
}
function harvestFromSource(creep, source) {
    if (creep.harvest(source) === ERR_NOT_IN_RANGE) {
        creep.moveTo(source, { reusePath: 50 });
    }
}
const SOURCE_DANGER_RANGE = 5;
let dangerTick$1 = -1;
const dangerByRoom = {};
function getDangerPositions(room) {
    var _a;
    if (dangerTick$1 !== Game.time) {
        dangerTick$1 = Game.time;
        for (const k in dangerByRoom)
            delete dangerByRoom[k];
    }
    if (!dangerByRoom[room.name]) {
        if ((_a = room.controller) === null || _a === void 0 ? void 0 : _a.safeMode) {
            dangerByRoom[room.name] = [];
            return dangerByRoom[room.name];
        }
        const positions = [];
        for (const c of room.find(FIND_HOSTILE_CREEPS)) {
            if (c.getActiveBodyparts(ATTACK) > 0 || c.getActiveBodyparts(RANGED_ATTACK) > 0) {
                positions.push(c.pos);
            }
        }
        for (const s of room.find(FIND_STRUCTURES)) {
            if (s.structureType === STRUCTURE_KEEPER_LAIR)
                positions.push(s.pos);
        }
        dangerByRoom[room.name] = positions;
    }
    return dangerByRoom[room.name];
}
function isPositionSafe(room, pos) {
    const dangers = getDangerPositions(room);
    if (dangers.length === 0)
        return true;
    for (const d of dangers) {
        if (pos.getRangeTo(d) <= SOURCE_DANGER_RANGE)
            return false;
    }
    return true;
}
function isSourceSafe(source) {
    return isPositionSafe(source.room, source.pos);
}
let safeSourceTick = -1;
const safeSourceCache = {};
function getSafeSources(room) {
    if (safeSourceTick !== Game.time) {
        safeSourceTick = Game.time;
        for (const k in safeSourceCache)
            delete safeSourceCache[k];
    }
    if (!safeSourceCache[room.name]) {
        const sources = getSources(room);
        const safe = sources.filter(isSourceSafe);
        safeSourceCache[room.name] = safe.length > 0 ? safe : sources;
    }
    return safeSourceCache[room.name];
}
function getMinerContainerIds(room) {
    var _a;
    if ((_a = room.memory.minerContainerIds) === null || _a === void 0 ? void 0 : _a.length) {
        return room.memory.minerContainerIds;
    }
    const sources = getSources(room);
    const containers = getRoomContainers(room);
    const minerIds = [];
    for (const c of containers) {
        for (const s of sources) {
            if (c.pos.getRangeTo(s.pos) <= 1) {
                minerIds.push(c.id);
                break;
            }
        }
    }
    return minerIds;
}
function findContainersForSource(room, source) {
    const containers = getRoomContainers(room);
    return containers.filter((container) => container.pos.getRangeTo(source.pos) <= 1);
}
function findUnclaimedMinerAssignment(room) {
    const sources = getSafeSources(room);
    const takenContainerIds = getAssignedContainerIdsByRole(room, ROLE_MINER);
    for (const source of sources) {
        const containers = findContainersForSource(room, source);
        for (const container of containers) {
            if (!takenContainerIds.has(container.id)) {
                takenContainerIds.add(container.id);
                return { source, container };
            }
        }
    }
    return null;
}
function findUnclaimedHaulerAssignment(room) {
    const minerIds = new Set(getMinerContainerIds(room).map((id) => id.toString()));
    if (minerIds.size === 0)
        return null;
    const containers = getRoomContainers(room).filter((c) => minerIds.has(c.id.toString()));
    const takenContainerIds = getAssignedContainerIdsByRole(room, ROLE_HAULER);
    for (const container of containers) {
        if (!takenContainerIds.has(container.id)) {
            takenContainerIds.add(container.id);
            return container;
        }
    }
    return null;
}

let criticalRepairCacheTick = -1;
const criticalRepairByRoom = {};
let towerRepairCacheTick = -1;
const towerRepairByRoom = {};
let nukeTargetCacheTick = -1;
const nukeTargetByRoom = {};
function findClosestConstructionSite(creep) {
    const sites = creep.room.find(FIND_MY_CONSTRUCTION_SITES);
    if (!sites || sites.length === 0)
        return null;
    const ranked = sites
        .map((s) => ({ s, p: sitePriority(s) }))
        .sort((a, b) => a.p - b.p);
    let i = 0;
    while (i < ranked.length) {
        const tier = ranked[i].p;
        const group = [];
        while (i < ranked.length && ranked[i].p === tier) {
            group.push(ranked[i].s);
            i++;
        }
        const reachable = closestByPath(creep.pos, group);
        if (reachable)
            return reachable;
    }
    return null;
}
const SITE_BUILD_PRIORITY = {
    [STRUCTURE_SPAWN]: 0,
    [STRUCTURE_EXTENSION]: 1,
    [STRUCTURE_CONTAINER]: 2,
    [STRUCTURE_TOWER]: 3,
    [STRUCTURE_STORAGE]: 4,
    [STRUCTURE_TERMINAL]: 5,
    [STRUCTURE_LINK]: 6,
    [STRUCTURE_EXTRACTOR]: 6,
    [STRUCTURE_LAB]: 7,
    [STRUCTURE_FACTORY]: 8,
    [STRUCTURE_NUKER]: 9,
    [STRUCTURE_POWER_SPAWN]: 9,
    [STRUCTURE_OBSERVER]: 9,
    [STRUCTURE_RAMPART]: 10,
    [STRUCTURE_ROAD]: 11,
};
const SOURCE_CONTAINER_PRIORITY = 2;
const CONTROLLER_CONTAINER_PRIORITY = 4;
const MINERAL_CONTAINER_PRIORITY = 12;
function sitePriority(s) {
    var _a;
    if (s.structureType === STRUCTURE_CONTAINER) {
        if (s.pos.findInRange(FIND_SOURCES, 1).length > 0)
            return SOURCE_CONTAINER_PRIORITY;
        if (s.pos.findInRange(FIND_MINERALS, 1).length > 0)
            return MINERAL_CONTAINER_PRIORITY;
        return CONTROLLER_CONTAINER_PRIORITY;
    }
    return (_a = SITE_BUILD_PRIORITY[s.structureType]) !== null && _a !== void 0 ? _a : 11;
}
function isHigherBuildPriority(a, b) {
    const pa = sitePriority(a);
    const pb = sitePriority(b);
    if (pa !== pb)
        return pa < pb;
    const ra = a.progress / a.progressTotal;
    const rb = b.progress / b.progressTotal;
    if (ra !== rb)
        return ra > rb;
    return a.id < b.id;
}
let buildTargetTick = -1;
const buildTargetByRoom = {};
function isEnergyEmergency(room) {
    const cap = room.energyCapacityAvailable;
    if (cap === 0)
        return false;
    if (!room.storage)
        return room.energyAvailable / cap < 0.25;
    return room.energyAvailable / cap < 0.25 && room.storage.store[RESOURCE_ENERGY] < 50000;
}
function getRoomBuildTarget(room) {
    if (buildTargetTick !== Game.time) {
        buildTargetTick = Game.time;
        for (const k of Object.keys(buildTargetByRoom))
            delete buildTargetByRoom[k];
    }
    if (buildTargetByRoom[room.name] === undefined) {
        let best = null;
        for (const s of room.find(FIND_MY_CONSTRUCTION_SITES)) {
            if (!isPositionSafe(room, s.pos))
                continue;
            if (!best || isHigherBuildPriority(s, best))
                best = s;
        }
        buildTargetByRoom[room.name] = best ? best.id : null;
    }
    const id = buildTargetByRoom[room.name];
    return id ? Game.getObjectById(id) : null;
}
const RAMPART_TARGET_HP = {
    2: 10000,
    3: 20000,
    4: 50000,
    5: 100000,
    6: 300000,
    7: 1000000,
    8: 10000000,
};
function getRampartTargetHP(rcl) {
    var _a;
    return (_a = RAMPART_TARGET_HP[Math.min(8, Math.max(2, rcl))]) !== null && _a !== void 0 ? _a : 10000;
}
const ON_TOP_RAMPART_TARGET_HP = {
    2: 10000,
    3: 20000,
    4: 50000,
    5: 100000,
    6: 150000,
    7: 200000,
    8: 300000,
};
const PERIMETER_SOFT_CAP_HP = 1000000;
const PERIMETER_FULL_TARGET_STORAGE = 100000;
function barrierTargetFn(room) {
    var _a, _b, _c, _d, _e, _f;
    const rcl = (_b = (_a = room.controller) === null || _a === void 0 ? void 0 : _a.level) !== null && _b !== void 0 ? _b : 0;
    let perimeter = getRampartTargetHP(rcl);
    if (((_d = (_c = room.storage) === null || _c === void 0 ? void 0 : _c.store[RESOURCE_ENERGY]) !== null && _d !== void 0 ? _d : 0) <= PERIMETER_FULL_TARGET_STORAGE) {
        perimeter = Math.min(perimeter, PERIMETER_SOFT_CAP_HP);
    }
    const onTop = Math.min(perimeter, ON_TOP_RAMPART_TARGET_HP[Math.min(8, Math.max(2, rcl))]);
    const ring = room.memory.perimeterTiles;
    const perimeterSet = ring ? new Set(ring) : undefined;
    const nukeTiles = (_f = (_e = room.memory.nukeDefense) === null || _e === void 0 ? void 0 : _e.tiles) !== null && _f !== void 0 ? _f : {};
    let covered;
    const coveredTiles = () => {
        if (!covered) {
            covered = new Set();
            for (const s of room.find(FIND_STRUCTURES)) {
                const t = s.structureType;
                if (t === STRUCTURE_RAMPART || t === STRUCTURE_ROAD || t === STRUCTURE_WALL)
                    continue;
                covered.add(`${s.pos.x},${s.pos.y}`);
            }
        }
        return covered;
    };
    const town = townBarrierTiles(room.memory.town);
    const townTarget = Math.min(perimeter, TOWN.barrierHits);
    return (s) => {
        if (s.structureType !== STRUCTURE_WALL && s.structureType !== STRUCTURE_RAMPART)
            return 0;
        const k = `${s.pos.x},${s.pos.y}`;
        if (town.has(k))
            return townTarget;
        if (s.structureType === STRUCTURE_WALL)
            return perimeter;
        if (!perimeterSet || perimeterSet.has(k))
            return perimeter;
        if (coveredTiles().has(k) || k in nukeTiles)
            return onTop;
        return 0;
    };
}
function isDamaged(s) {
    return s.hits < s.hitsMax;
}
function keptUp(room) {
    const roads = keptRoadTiles(room);
    if (!roads)
        return () => true;
    return (s) => s.structureType !== STRUCTURE_ROAD || roads.has(`${s.pos.x},${s.pos.y}`);
}
function decayRescueFloor(s) {
    switch (s.structureType) {
        case STRUCTURE_RAMPART:
            return 2000;
        case STRUCTURE_ROAD:
            return s.hitsMax * 0.35;
        case STRUCTURE_CONTAINER:
            return s.hitsMax * 0.1;
        default:
            return 0;
    }
}
function findClosestRepairTarget(creep) {
    const kept = keptUp(creep.room);
    const repairTargets = getRoomStructures(creep.room).filter((s) => s.structureType !== STRUCTURE_WALL &&
        s.structureType !== STRUCTURE_RAMPART &&
        isDamaged(s) &&
        kept(s));
    if (repairTargets.length === 0)
        return null;
    return closestByPath(creep.pos, repairTargets) || null;
}
const CRITICAL_DEFENSE_HITS = 1000;
const BREACH_DANGER_FLOOR = 50000;
const TOWER_DEFENSE_REPAIR_FLOOR = 300000;
function findCriticalDefenseTarget(creep) {
    if (getDangerPositions(creep.room).length === 0)
        return null;
    const critical = getRoomStructures(creep.room).filter((s) => (s.structureType === STRUCTURE_RAMPART || s.structureType === STRUCTURE_WALL) &&
        s.hits < CRITICAL_DEFENSE_HITS);
    if (critical.length === 0)
        return null;
    return closestByPath(creep.pos, critical) || null;
}
function getNukeRampartTarget(room) {
    if (nukeTargetCacheTick !== Game.time) {
        nukeTargetCacheTick = Game.time;
        for (const k in nukeTargetByRoom)
            delete nukeTargetByRoom[k];
    }
    if (!(room.name in nukeTargetByRoom)) {
        nukeTargetByRoom[room.name] = computeNukeRampartTarget(room);
    }
    return nukeTargetByRoom[room.name];
}
function computeNukeRampartTarget(room) {
    const def = room.memory.nukeDefense;
    if (!def)
        return null;
    let worst = null;
    let worstDeficit = 0;
    for (const key in def.tiles) {
        const required = def.tiles[key];
        const [x, y] = key.split(",").map(Number);
        const rampart = room
            .lookForAt(LOOK_STRUCTURES, x, y)
            .find((s) => s.structureType === STRUCTURE_RAMPART);
        if (!rampart)
            continue;
        const deficit = Math.min(required, rampart.hitsMax) - rampart.hits;
        if (deficit > worstDeficit) {
            worstDeficit = deficit;
            worst = rampart;
        }
    }
    return worst;
}
function findMostCriticalRepairTarget(creep) {
    const nukeTarget = getNukeRampartTarget(creep.room);
    if (nukeTarget)
        return nukeTarget;
    if (criticalRepairCacheTick !== Game.time) {
        criticalRepairCacheTick = Game.time;
        for (const k in criticalRepairByRoom)
            delete criticalRepairByRoom[k];
    }
    const rn = creep.room.name;
    if (rn in criticalRepairByRoom)
        return criticalRepairByRoom[rn];
    const targetOf = barrierTargetFn(creep.room);
    const isBarrier = (st) => st.structureType === STRUCTURE_WALL || st.structureType === STRUCTURE_RAMPART;
    const kept = keptUp(creep.room);
    const structures = getRoomStructures(creep.room).filter((st) => (!isBarrier(st) || targetOf(st) > 0) && kept(st));
    const dying = structures.filter((st) => {
        const floor = decayRescueFloor(st);
        return floor > 0 && st.hits < floor;
    });
    if (dying.length > 0) {
        const result = dying.reduce((a, b) => (a.hits < b.hits ? a : b));
        criticalRepairByRoom[rn] = result;
        return result;
    }
    const criticalBarriers = structures.filter((st) => isBarrier(st) && st.hits < Math.min(BREACH_DANGER_FLOOR, targetOf(st) * 0.5));
    if (criticalBarriers.length > 0) {
        const result = criticalBarriers.reduce((a, b) => (a.hits < b.hits ? a : b));
        criticalRepairByRoom[rn] = result;
        return result;
    }
    const nonDefensive = structures.filter((st) => st.structureType !== STRUCTURE_WALL &&
        st.structureType !== STRUCTURE_RAMPART &&
        st.hits < st.hitsMax * 0.8);
    if (nonDefensive.length > 0) {
        const isRoad = (st) => st.structureType === STRUCTURE_ROAD;
        const lowestFraction = (a, b) => a.hits / a.hitsMax < b.hits / b.hitsMax ? a : b;
        const nonRoad = nonDefensive.filter((st) => !isRoad(st));
        const tier = nonRoad.length > 0 ? nonRoad : nonDefensive;
        const result = tier.reduce(lowestFraction);
        criticalRepairByRoom[rn] = result;
        return result;
    }
    const belowTarget = structures.filter((st) => isBarrier(st) && st.hits < targetOf(st));
    const result = belowTarget.length > 0
        ? belowTarget.reduce((a, b) => (a.hits < b.hits ? a : b))
        : null;
    criticalRepairByRoom[rn] = result;
    return result;
}
function findTowerRepairTarget(room) {
    var _a, _b;
    const nukeTarget = getNukeRampartTarget(room);
    if (nukeTarget)
        return nukeTarget;
    if (towerRepairCacheTick !== Game.time) {
        towerRepairCacheTick = Game.time;
        for (const k in towerRepairByRoom)
            delete towerRepairByRoom[k];
    }
    if (room.name in towerRepairByRoom)
        return towerRepairByRoom[room.name];
    const rcl = (_b = (_a = room.controller) === null || _a === void 0 ? void 0 : _a.level) !== null && _b !== void 0 ? _b : 0;
    const towerWallThreshold = Math.min(50000, Math.max(5000, getRampartTargetHP(rcl) * 0.05));
    const targetOf = barrierTargetFn(room);
    const kept = keptUp(room);
    const candidates = getRoomStructures(room).filter((st) => {
        if (!kept(st))
            return false;
        if (st.structureType === STRUCTURE_RAMPART || st.structureType === STRUCTURE_WALL) {
            return st.hits < Math.min(towerWallThreshold, targetOf(st));
        }
        return st.hits < st.hitsMax * 0.4;
    });
    const result = candidates.length === 0
        ? null
        : candidates.reduce((a, b) => (a.hits < b.hits ? a : b));
    towerRepairByRoom[room.name] = result;
    return result;
}
function findTowerDefenseRepairTarget(room) {
    var _a, _b;
    const rcl = (_b = (_a = room.controller) === null || _a === void 0 ? void 0 : _a.level) !== null && _b !== void 0 ? _b : 0;
    const floor = Math.min(TOWER_DEFENSE_REPAIR_FLOOR, getRampartTargetHP(rcl));
    const breakers = room
        .find(FIND_HOSTILE_CREEPS)
        .filter((c) => c.body.some((p) => (p.type === ATTACK || p.type === WORK) && p.hits > 0));
    let worst = null;
    let worstThreatened = null;
    for (const s of getRoomStructures(room)) {
        if (s.structureType !== STRUCTURE_RAMPART && s.structureType !== STRUCTURE_WALL)
            continue;
        if (s.hits >= floor)
            continue;
        const barrier = s;
        if (!worst || s.hits < worst.hits)
            worst = barrier;
        if (!breakers.some((c) => c.pos.getRangeTo(s.pos) <= 3))
            continue;
        if (!worstThreatened || s.hits < worstThreatened.hits)
            worstThreatened = barrier;
    }
    return worstThreatened !== null && worstThreatened !== void 0 ? worstThreatened : worst;
}

let claimTick = -1;
const claims = new Map();
function claimIndex() {
    var _a;
    if (claimTick !== Game.time) {
        claimTick = Game.time;
        claims.clear();
        for (const name in Game.creeps) {
            const c = Game.creeps[name];
            const id = c.memory.fillTargetId;
            if (id)
                addClaim(id, name, (_a = c.store[RESOURCE_ENERGY]) !== null && _a !== void 0 ? _a : 0);
        }
    }
    return claims;
}
function addClaim(targetId, creepName, amount) {
    let byCreep = claims.get(targetId);
    if (!byCreep) {
        byCreep = new Map();
        claims.set(targetId, byCreep);
    }
    byCreep.set(creepName, amount);
}
function setFillTarget(creep, targetId) {
    var _a, _b;
    const index = claimIndex();
    const old = creep.memory.fillTargetId;
    if (old)
        (_a = index.get(old)) === null || _a === void 0 ? void 0 : _a.delete(creep.name);
    creep.memory.fillTargetId = targetId;
    if (targetId)
        addClaim(targetId, creep.name, (_b = creep.store[RESOURCE_ENERGY]) !== null && _b !== void 0 ? _b : 0);
}
function energyClaimedByOthers(targetId, creep) {
    const byCreep = claimIndex().get(targetId);
    if (!byCreep)
        return 0;
    let total = 0;
    for (const [name, amount] of byCreep)
        if (name !== creep.name)
            total += amount;
    return total;
}
const HANDOFF_ROLES = new Set([ROLE_BUILDER, ROLE_REPAIRER]);
function wantsHandoff(c) {
    return (HANDOFF_ROLES.has(c.memory.role) &&
        !c.spawning &&
        !c.memory.working &&
        c.store.getFreeCapacity(RESOURCE_ENERGY) > 0);
}
function findHandoffTarget(creep, maxRange) {
    const candidates = creep.room.find(FIND_MY_CREEPS, {
        filter: (c) => c.name !== creep.name &&
            wantsHandoff(c) &&
            creep.pos.getRangeTo(c) <= maxRange &&
            energyClaimedByOthers(c.id, creep) < c.store.getFreeCapacity(RESOURCE_ENERGY),
    });
    if (candidates.length === 0)
        return null;
    return creep.pos.findClosestByRange(candidates);
}
function meetIncomingHandoff(creep) {
    var _a;
    const byCreep = claimIndex().get(creep.id);
    if (!byCreep)
        return false;
    let carrier = null;
    for (const name of byCreep.keys()) {
        const c = Game.creeps[name];
        if (!c || c.room.name !== creep.room.name || ((_a = c.store[RESOURCE_ENERGY]) !== null && _a !== void 0 ? _a : 0) === 0)
            continue;
        if (!carrier || creep.pos.getRangeTo(c) < creep.pos.getRangeTo(carrier))
            carrier = c;
    }
    if (!carrier)
        return false;
    if (!creep.pos.isNearTo(carrier))
        creep.moveTo(carrier, { range: 1, reusePath: 5 });
    return true;
}

const UPGRADER_STORAGE_FLOOR = 10000;
const KEEP_FUND_FLOOR = 45000;
const UPGRADER_DOWNGRADE_GUARD = 5000;
function nearDowngrade(room) {
    const ctrl = room.controller;
    return !!ctrl && ctrl.my && ctrl.ticksToDowngrade < UPGRADER_DOWNGRADE_GUARD;
}
function savingForKeep(room) {
    var _a;
    const exp = Memory.expansion;
    if (exp && exp.homeRoom === room.name && exp.phase !== "established")
        return true;
    return ((_a = Memory.expansionSavings) === null || _a === void 0 ? void 0 : _a.room) === room.name;
}
function upgraderStorageFloor(room) {
    return savingForKeep(room) ? KEEP_FUND_FLOOR : UPGRADER_STORAGE_FLOOR;
}
function upgradingFunded(room) {
    const storage = room.storage;
    if (!storage)
        return true;
    return storage.store[RESOURCE_ENERGY] > upgraderStorageFloor(room) || nearDowngrade(room);
}

function findEnergyDepositTarget(creep, role) {
    const priorityList = ENERGY_DEPOSIT_PRIORITY[role] || [];
    if (priorityList.length === 0)
        return null;
    const typeSet = new Set(priorityList);
    const mineralContainerId = creep.room.memory.mineralContainerId;
    const all = getRoomStructures(creep.room).filter((s) => typeSet.has(s.structureType) &&
        s.id !== mineralContainerId &&
        "store" in s &&
        s.store.getFreeCapacity(RESOURCE_ENERGY) > 0);
    if (all.length === 0)
        return null;
    const byType = new Map();
    for (const s of all) {
        let bucket = byType.get(s.structureType);
        if (!bucket) {
            bucket = [];
            byType.set(s.structureType, bucket);
        }
        bucket.push(s);
    }
    for (const structureType of priorityList) {
        const bucket = byType.get(structureType);
        if (bucket && bucket.length > 0) {
            return closestByPath(creep.pos, bucket);
        }
    }
    return null;
}
function acquireEnergy(creep, opts) {
    const bufferOnly = !!(opts === null || opts === void 0 ? void 0 : opts.bufferOnly);
    const minerIds = bufferOnly
        ? new Set(getMinerContainerIds(creep.room).map((id) => id))
        : null;
    if (creep.memory.energySourceId) {
        const cached = Game.getObjectById(creep.memory.energySourceId);
        if (cached &&
            cached.store[RESOURCE_ENERGY] > 0 &&
            !(minerIds && minerIds.has(cached.id))) {
            const res = creep.withdraw(cached, RESOURCE_ENERGY);
            if (res === ERR_NOT_IN_RANGE) {
                creep.moveTo(cached, { reusePath: 50 });
                return true;
            }
            if (res === OK)
                return true;
        }
        creep.memory.energySourceId = undefined;
    }
    const droppedInRange = bufferOnly
        ? []
        : creep.pos.findInRange(FIND_DROPPED_RESOURCES, 8, {
            filter: (d) => d.resourceType === RESOURCE_ENERGY && d.amount > 0,
        });
    if (droppedInRange.length > 0) {
        const dropped = droppedInRange.reduce((a, b) => (a.amount > b.amount ? a : b));
        const res = creep.pickup(dropped);
        if (res === ERR_NOT_IN_RANGE) {
            creep.moveTo(dropped, { reusePath: 5 });
            return true;
        }
        return res === OK;
    }
    const upgradeId = creep.room.memory.upgradeContainerId;
    const storeTargets = getRoomStructures(creep.room).filter((s) => (s.structureType === STRUCTURE_CONTAINER ||
        s.structureType === STRUCTURE_STORAGE) &&
        "store" in s &&
        s.store[RESOURCE_ENERGY] > 0 &&
        !(minerIds && minerIds.has(s.id)));
    const nonUpgrade = upgradeId
        ? storeTargets.filter((s) => s.id !== upgradeId)
        : storeTargets;
    const storeTarget = nonUpgrade.length > 0
        ? closestByPath(creep.pos, nonUpgrade)
        : storeTargets.length > 0
            ? closestByPath(creep.pos, storeTargets)
            : null;
    if (storeTarget) {
        creep.memory.energySourceId = storeTarget.id;
        const res = creep.withdraw(storeTarget, RESOURCE_ENERGY);
        if (res === ERR_NOT_IN_RANGE) {
            creep.moveTo(storeTarget, { reusePath: 50 });
            return true;
        }
        return res === OK;
    }
    const controllerLinks = creep.memory.role === ROLE_UPGRADER ? undefined : creep.room.memory.controllerLinkIds;
    const links = getRoomStructures(creep.room).filter((s) => s.structureType === STRUCTURE_LINK &&
        s.store[RESOURCE_ENERGY] > 0 &&
        !(controllerLinks === null || controllerLinks === void 0 ? void 0 : controllerLinks.includes(s.id)));
    if (links.length > 0) {
        const link = closestByPath(creep.pos, links);
        if (link) {
            creep.memory.energySourceId = link.id;
            const res = creep.withdraw(link, RESOURCE_ENERGY);
            if (res === ERR_NOT_IN_RANGE) {
                creep.moveTo(link, { reusePath: 50 });
                return true;
            }
            return res === OK;
        }
    }
    const tomb = creep.pos.findClosestByPath(FIND_TOMBSTONES, {
        ignoreCreeps: true,
        filter: (t) => t.store && t.store[RESOURCE_ENERGY] > 0,
    });
    if (tomb) {
        const res = creep.withdraw(tomb, RESOURCE_ENERGY);
        if (res === ERR_NOT_IN_RANGE) {
            creep.moveTo(tomb, { reusePath: 50 });
            return true;
        }
        return res === OK;
    }
    const activeSafe = getSafeSources(creep.room).filter((s) => s.energy > 0);
    const source = closestByPath(creep.pos, activeSafe);
    if (source) {
        const res = creep.harvest(source);
        if (res === ERR_NOT_IN_RANGE) {
            creep.moveTo(source, { reusePath: 50 });
            return true;
        }
        return res === OK;
    }
    return false;
}
function pickupDroppedResource(creep, resource) {
    const res = creep.pickup(resource);
    if (res === ERR_NOT_IN_RANGE) {
        creep.moveTo(resource);
        return true;
    }
    return res === OK;
}
function withdrawFromContainer(creep, container) {
    const res = creep.withdraw(container, RESOURCE_ENERGY);
    if (res === ERR_NOT_IN_RANGE) {
        creep.moveTo(container);
        return true;
    }
    return res === OK;
}
function mayBorrowHauler(room, haulers) {
    if (haulers.length < 2)
        return false;
    if (room.energyAvailable < room.energyCapacityAvailable)
        return false;
    return room.find(FIND_HOSTILE_CREEPS).length === 0;
}
function isCreepEmpty(creep) {
    return creep.store[RESOURCE_ENERGY] === 0;
}
function isCreepFull(creep) {
    return creep.store.getFreeCapacity() === 0;
}
function transferEnergyTo(creep, target) {
    if (creep.transfer(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
        creep.moveTo(target, { reusePath: 5 });
    }
}
function getClosestContainerOrStorage(creep) {
    const allTargets = getRoomStructures(creep.room).filter((s) => (s.structureType === STRUCTURE_CONTAINER ||
        s.structureType === STRUCTURE_STORAGE) &&
        "store" in s &&
        s.store[RESOURCE_ENERGY] > 0);
    if (allTargets.length === 0)
        return null;
    const upgradeId = creep.room.memory.upgradeContainerId;
    let nonUpgrade = allTargets;
    if (upgradeId)
        nonUpgrade = allTargets.filter((s) => s.id !== upgradeId);
    if (nonUpgrade.length > 0)
        return closestByPath(creep.pos, nonUpgrade);
    return closestByPath(creep.pos, allTargets);
}
function findClosestMinerContainerWithEnergy(creep) {
    const ids = getMinerContainerIds(creep.room);
    if (!ids || ids.length === 0)
        return null;
    const containers = ids
        .map((id) => Game.getObjectById(id))
        .filter(Boolean);
    const withEnergy = containers.filter((c) => c.store && c.store[RESOURCE_ENERGY] > 0);
    if (withEnergy.length === 0)
        return null;
    return closestByPath(creep.pos, withEnergy) || null;
}
const UPGRADE_CONTAINER_REFILL_BELOW = 1000;
const UPGRADE_CONTAINER_FILLERS = 1;
let upgradeFillerTick = -1;
const upgradeFillerIdsByRoom = {};
function getUpgradeContainerFillerIds(room) {
    if (upgradeFillerTick !== Game.time) {
        upgradeFillerTick = Game.time;
        for (const k in upgradeFillerIdsByRoom)
            delete upgradeFillerIdsByRoom[k];
    }
    if (!upgradeFillerIdsByRoom[room.name]) {
        const haulerIds = [];
        for (const name in Game.creeps) {
            const c = Game.creeps[name];
            if (c.room.name === room.name && c.memory.role === ROLE_HAULER)
                haulerIds.push(c.id);
        }
        haulerIds.sort();
        upgradeFillerIdsByRoom[room.name] = new Set(haulerIds.slice(0, UPGRADE_CONTAINER_FILLERS));
    }
    return upgradeFillerIdsByRoom[room.name];
}
function findDepositTargetExcludingMiner(creep) {
    var _a;
    const minerIds = getMinerContainerIds(creep.room).map((id) => id.toString());
    const upgradeId = creep.room.memory.upgradeContainerId;
    const upgradeCont = upgradeId
        ? Game.getObjectById(upgradeId)
        : null;
    const upgradeIsDropTarget = !!upgradeCont &&
        upgradeCont.store.getFreeCapacity(RESOURCE_ENERGY) > 0 &&
        minerIds.indexOf(upgradeCont.id) === -1;
    const coreFull = creep.room.energyAvailable >= creep.room.energyCapacityAvailable;
    if (upgradeIsDropTarget &&
        coreFull &&
        upgradingFunded(creep.room) &&
        ((_a = upgradeCont.store[RESOURCE_ENERGY]) !== null && _a !== void 0 ? _a : 0) < UPGRADE_CONTAINER_REFILL_BELOW &&
        getUpgradeContainerFillerIds(creep.room).has(creep.id)) {
        return upgradeCont;
    }
    const storage = creep.room.storage;
    if (storage && storage.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
        return storage;
    }
    if (upgradeIsDropTarget) {
        return upgradeCont;
    }
    const nonMinerContainers = getRoomContainers(creep.room).filter((container) => minerIds.indexOf(container.id) === -1 &&
        container.store.getFreeCapacity(RESOURCE_ENERGY) > 0);
    if (nonMinerContainers.length > 0) {
        return closestByPath(creep.pos, nonMinerContainers) || null;
    }
    return null;
}
function findEmptiestTower(room) {
    const towers = getRoomStructures(room).filter((s) => s.structureType === STRUCTURE_TOWER &&
        s.store.getFreeCapacity(RESOURCE_ENERGY) > 0);
    if (towers.length === 0)
        return null;
    return towers.reduce((a, b) => a.store.getUsedCapacity(RESOURCE_ENERGY) < b.store.getUsedCapacity(RESOURCE_ENERGY) ? a : b);
}
function findCoreFillTarget(creep) {
    var _a;
    const targets = getRoomStructures(creep.room).filter((s) => (s.structureType === STRUCTURE_SPAWN ||
        s.structureType === STRUCTURE_EXTENSION ||
        s.structureType === STRUCTURE_TOWER) &&
        "store" in s &&
        s.store.getFreeCapacity(RESOURCE_ENERGY) > energyClaimedByOthers(s.id, creep));
    if (targets.length === 0)
        return null;
    return (_a = creep.pos.findClosestByPath(targets, { ignoreCreeps: true })) !== null && _a !== void 0 ? _a : null;
}

function upgradeController(creep) {
    const controller = creep.room.controller;
    if (!controller)
        return;
    if (creep.upgradeController(controller) === ERR_NOT_IN_RANGE) {
        creep.moveTo(controller, { reusePath: 50 });
        return;
    }
    signControllerIfNeeded(creep, controller);
}
const SIGN_RECHECK_INTERVAL = 5000;
function signControllerIfNeeded(creep, controller) {
    const lastSigned = creep.room.memory.lastSigned;
    if (lastSigned !== undefined && Game.time - lastSigned < SIGN_RECHECK_INTERVAL)
        return false;
    const desiredSignature = pickSignature(creep.room.name);
    const currentSign = controller.sign;
    if ((currentSign === null || currentSign === void 0 ? void 0 : currentSign.username) === "Screeps")
        return false;
    const myUsername = creep.owner.username;
    const needsSign = !currentSign ||
        currentSign.username !== myUsername ||
        currentSign.text !== desiredSignature;
    if (!needsSign)
        return false;
    if (creep.pos.getRangeTo(controller.pos) > 1) {
        creep.moveTo(controller, { range: 1, reusePath: 5 });
        return true;
    }
    creep.signController(controller, desiredSignature);
    creep.room.memory.lastSigned = Game.time;
    return true;
}
function buildAtConstructionSite(creep, site) {
    const res = creep.build(site);
    if (res === ERR_NOT_IN_RANGE)
        return creep.moveTo(site, { reusePath: 50 });
    return res;
}
function repairStructure(creep, target) {
    const res = creep.repair(target);
    if (res === ERR_NOT_IN_RANGE)
        return creep.moveTo(target, { reusePath: 50 });
    return res;
}
function findSmartEnergyFallbackTarget(creep) {
    if (creep.getActiveBodyparts(WORK) === 0)
        return null;
    const site = getRoomBuildTarget(creep.room);
    if (site)
        return { kind: "build", target: site };
    const repairTarget = findClosestRepairTarget(creep);
    if (repairTarget)
        return { kind: "repair", target: repairTarget };
    const controller = creep.room.controller;
    if (controller && controller.my)
        return { kind: "upgrade", target: controller };
    return null;
}
function performSmartEnergyFallback(creep) {
    const fallback = findSmartEnergyFallbackTarget(creep);
    if (!fallback)
        return false;
    if (fallback.kind === "build") {
        const res = buildAtConstructionSite(creep, fallback.target);
        if (res === ERR_NOT_ENOUGH_RESOURCES)
            return false;
        return true;
    }
    if (fallback.kind === "repair") {
        const res = repairStructure(creep, fallback.target);
        if (res === ERR_NOT_ENOUGH_RESOURCES)
            return false;
        return true;
    }
    upgradeController(creep);
    return true;
}
function putSurplusEnergyToWork(creep) {
    if (performSmartEnergyFallback(creep))
        return;
    upgradeController(creep);
}
const REMOTE_INVADER_WINDOW = 1500;
const REMOTE_PLAYER_WINDOW = 2000;
const REMOTE_PLAYER_WINDOW_MAX = 20000;
const RIVAL_CHRONICLE_WINDOW = 5000;
function assignedRemoteEntry(creep) {
    var _a, _b;
    const home = creep.memory.homeRoom;
    const target = creep.memory.targetRoom;
    if (!home || !target)
        return undefined;
    return (_b = (_a = Memory.rooms[home]) === null || _a === void 0 ? void 0 : _a.remoteRooms) === null || _b === void 0 ? void 0 : _b.find((r) => r.roomName === target);
}
function isAssignedRemoteContested(creep) {
    const entry = assignedRemoteEntry(creep);
    if (!entry)
        return false;
    if (entry.hostile)
        return true;
    return entry.invaderUntil !== undefined && entry.invaderUntil > Game.time;
}
function flagRemoteInvader(creep) {
    const entry = assignedRemoteEntry(creep);
    if (entry)
        markRemoteInvader(entry, creep.room);
}
function markRemoteInvader(entry, room) {
    const fresh = entry.invaderUntil === undefined || entry.invaderUntil <= Game.time;
    entry.invaderUntil = Game.time + REMOTE_INVADER_WINDOW;
    entry.invaderStrength = invaderStrength(room);
    if (!fresh)
        return;
    chronicle(findInvaderCore(room)
        ? `Invaders raised a stronghold in the ${wildsName(entry.roomName)}. The vendors flee the road.`
        : `Raiders fell upon the vendors in the ${wildsName(entry.roomName)}.`);
}
function flagRemoteDamage(creep) {
    const hostiles = creep.room.find(FIND_HOSTILE_CREEPS);
    if (hostiles.some(isPlayerCreep))
        flagRemotePlayer(creep);
    else
        flagRemoteInvader(creep);
}
function flagRemotePlayer(creep) {
    const entry = assignedRemoteEntry(creep);
    if (!entry)
        return;
    const player = creep.room.find(FIND_HOSTILE_CREEPS).find(isPlayerCreep);
    markRemotePlayerHostile(entry, player === null || player === void 0 ? void 0 : player.owner.username);
}
function markRemotePlayerHostile(entry, who) {
    var _a, _b;
    const avoided = entry.hostile && entry.hostileUntil !== undefined && entry.hostileUntil > Game.time;
    if (!avoided) {
        entry.hostileStrikes = ((_a = entry.hostileStrikes) !== null && _a !== void 0 ? _a : 0) + 1;
        const text = `${who ? `The men of ${lordName(who)}` : "Strangers"} hold the ${wildsName(entry.roomName)}. The vendors keep away.`;
        tally(`rival:${entry.roomName}`, 1, () => text, RIVAL_CHRONICLE_WINDOW);
    }
    const window = Math.min(REMOTE_PLAYER_WINDOW * 2 ** (((_b = entry.hostileStrikes) !== null && _b !== void 0 ? _b : 1) - 1), REMOTE_PLAYER_WINDOW_MAX);
    entry.hostile = true;
    entry.hostileUntil = Game.time + window;
    if (who)
        entry.rival = who;
}
function clearRemotePlayerHostile(entry) {
    var _a, _b;
    entry.hostile = false;
    delete entry.rival;
    let strikes = (_a = entry.hostileStrikes) !== null && _a !== void 0 ? _a : 0;
    let since = Math.min((_b = entry.hostileUntil) !== null && _b !== void 0 ? _b : Game.time, Game.time);
    while (strikes > 0 && Game.time - since >= REMOTE_PLAYER_WINDOW) {
        strikes--;
        since += REMOTE_PLAYER_WINDOW;
    }
    entry.hostileStrikes = strikes;
    entry.hostileUntil = strikes > 0 ? since : undefined;
}
function isAssignedRemoteInvaded(creep) {
    var _a;
    const until = (_a = assignedRemoteEntry(creep)) === null || _a === void 0 ? void 0 : _a.invaderUntil;
    return until !== undefined && until > Game.time;
}
function clearRemoteInvader(creep) {
    const entry = assignedRemoteEntry(creep);
    if (!entry)
        return;
    if (entry.invaderUntil !== undefined) {
        if (entry.invaderUntil > Game.time) {
            chronicle(`The ${wildsName(entry.roomName)} is safe again. The vendors take to the road.`);
        }
        entry.invaderUntil = undefined;
    }
    delete entry.invaderStrength;
}

function hasMiner(source) {
    return (source.pos.findInRange(FIND_MY_CREEPS, 1, {
        filter: (c) => c.memory.role === ROLE_MINER,
    }).length > 0);
}
function runHarvester(creep) {
    if (creep.memory.working === undefined)
        creep.memory.working = false;
    if (creep.memory.working && isCreepEmpty(creep)) {
        creep.memory.working = false;
    }
    if (!creep.memory.working && isCreepFull(creep)) {
        creep.memory.working = true;
    }
    if (creep.memory.working) {
        const depositTarget = findEnergyDepositTarget(creep, ROLE_HARVESTER);
        const backIntoContainer = (depositTarget === null || depositTarget === void 0 ? void 0 : depositTarget.structureType) === STRUCTURE_CONTAINER &&
            getSafeSources(creep.room).every(hasMiner);
        if (depositTarget && !backIntoContainer) {
            transferEnergyTo(creep, depositTarget);
        }
        else {
            putSurplusEnergyToWork(creep);
        }
        return;
    }
    let source = null;
    if (creep.memory.assignedSourceId) {
        source = Game.getObjectById(creep.memory.assignedSourceId);
        if (!source || !isSourceSafe(source)) {
            creep.memory.assignedSourceId = undefined;
            source = null;
        }
    }
    if (!source) {
        source = findBalancedSource(creep);
        if (source)
            creep.memory.assignedSourceId = source.id;
    }
    if (!source)
        return;
    const current = source;
    if (hasMiner(current)) {
        const uncovered = getSafeSources(creep.room).find((s) => s.id !== current.id && !hasMiner(s));
        if (uncovered) {
            creep.memory.assignedSourceId = uncovered.id;
            harvestFromSource(creep, uncovered);
            return;
        }
        acquireEnergy(creep);
        return;
    }
    harvestFromSource(creep, current);
}

function runUpgrader(creep) {
    var _a;
    if (creep.memory.working === undefined)
        creep.memory.working = false;
    if ((creep.memory.boostCompound || ((_a = creep.memory.boostQueue) === null || _a === void 0 ? void 0 : _a.length)) && seekBoost(creep))
        return;
    if (creep.memory.working && isCreepEmpty(creep)) {
        creep.memory.working = false;
    }
    if (!creep.memory.working && isCreepFull(creep)) {
        creep.memory.working = true;
    }
    if (creep.memory.working) {
        upgradeController(creep);
        return;
    }
    const controllerLink = findControllerLink(creep);
    if (controllerLink && controllerLink.store[RESOURCE_ENERGY] > 0) {
        const res = creep.withdraw(controllerLink, RESOURCE_ENERGY);
        if (res === ERR_NOT_IN_RANGE) {
            creep.moveTo(controllerLink, { reusePath: 50 });
        }
        if (res === OK || res === ERR_NOT_IN_RANGE)
            return;
    }
    const upgradeId = creep.room.memory.upgradeContainerId;
    if (upgradeId) {
        const upgradeCont = Game.getObjectById(upgradeId);
        if (upgradeCont && upgradeCont.store[RESOURCE_ENERGY] > 0) {
            if (withdrawFromContainer(creep, upgradeCont))
                return;
        }
    }
    const storage = creep.room.storage;
    if (storage && upgradingFunded(creep.room) && storage.store[RESOURCE_ENERGY] > 0) {
        if (creep.withdraw(storage, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
            creep.moveTo(storage, { reusePath: 50 });
        }
        return;
    }
    if (storage && !nearDowngrade(creep.room))
        return;
    acquireEnergy(creep);
}
const CONTROLLER_LINK_SCAN_TTL = 200;
function findControllerLink(creep) {
    var _a;
    const room = creep.room;
    const controller = room.controller;
    if (!controller)
        return null;
    if (!room.memory.controllerLinkIds ||
        Game.time - ((_a = room.memory.controllerLinkScanTick) !== null && _a !== void 0 ? _a : 0) > CONTROLLER_LINK_SCAN_TTL) {
        const found = controller.pos.findInRange(FIND_MY_STRUCTURES, 3, {
            filter: (s) => s.structureType === STRUCTURE_LINK,
        });
        room.memory.controllerLinkIds = found.map((l) => l.id);
        room.memory.controllerLinkScanTick = Game.time;
    }
    const links = room.memory.controllerLinkIds
        .map((id) => Game.getObjectById(id))
        .filter(Boolean);
    if (links.length === 0)
        return null;
    return links.reduce((a, b) => a.store[RESOURCE_ENERGY] > b.store[RESOURCE_ENERGY] ? a : b);
}

function runBuilder(creep) {
    if (creep.memory.working === undefined)
        creep.memory.working = false;
    if (creep.memory.working && isCreepEmpty(creep)) {
        creep.memory.working = false;
    }
    if (!creep.memory.working && isCreepFull(creep)) {
        creep.memory.working = true;
    }
    if (!creep.memory.working) {
        if (meetIncomingHandoff(creep))
            return;
        const acquired = acquireEnergy(creep, { bufferOnly: !!creep.room.storage });
        if (acquired || isCreepEmpty(creep))
            return;
        creep.memory.working = true;
    }
    if (creep.room.storage && isEnergyEmergency(creep.room)) {
        const fill = findCoreFillTarget(creep);
        if (fill)
            transferEnergyTo(creep, fill);
        return;
    }
    const critical = findCriticalDefenseTarget(creep);
    if (critical) {
        const r = repairStructure(creep, critical);
        if (r === ERR_NOT_ENOUGH_RESOURCES)
            creep.memory.working = false;
        if (r !== ERR_NO_PATH)
            return;
    }
    const site = getRoomBuildTarget(creep.room);
    if (site) {
        const res = buildAtConstructionSite(creep, site);
        if (res === ERR_NOT_ENOUGH_RESOURCES) {
            creep.memory.working = false;
            return;
        }
        if (res !== ERR_NO_PATH)
            return;
        const reachable = findClosestConstructionSite(creep);
        if (reachable && reachable.id !== site.id) {
            const r2 = buildAtConstructionSite(creep, reachable);
            if (r2 === ERR_NOT_ENOUGH_RESOURCES)
                creep.memory.working = false;
            if (r2 !== ERR_NO_PATH)
                return;
        }
    }
    const repairTarget = findClosestRepairTarget(creep);
    if (repairTarget) {
        const r = repairStructure(creep, repairTarget);
        if (r === ERR_NOT_ENOUGH_RESOURCES)
            creep.memory.working = false;
        if (r !== ERR_NO_PATH)
            return;
    }
    putSurplusEnergyToWork(creep);
}

function runRepairer(creep) {
    if (creep.memory.working === undefined)
        creep.memory.working = false;
    if (creep.memory.working && isCreepEmpty(creep)) {
        creep.memory.working = false;
    }
    if (!creep.memory.working && isCreepFull(creep)) {
        creep.memory.working = true;
    }
    if (!creep.memory.working) {
        if (meetIncomingHandoff(creep))
            return;
        if (creep.room.storage) {
            acquireEnergy(creep, { bufferOnly: true });
            return;
        }
        const container = getClosestContainerOrStorage(creep);
        if (container) {
            if (creep.withdraw(container, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                creep.moveTo(container, { reusePath: 50 });
            }
            return;
        }
        const sources = getSources(creep.room);
        if (sources.length > 0)
            harvestFromSource(creep, sources[0]);
        return;
    }
    const target = findMostCriticalRepairTarget(creep);
    if (target) {
        const res = repairStructure(creep, target);
        if (res === ERR_NOT_IN_RANGE)
            return;
        if (res === ERR_NOT_ENOUGH_RESOURCES)
            creep.memory.working = false;
        return;
    }
    putSurplusEnergyToWork(creep);
}

const LINK_TRANSFER_THRESHOLD = 400;
const LINK_MIN_TRANSFER = 150;
const LINK_SINK_HEADROOM = 100;
const CONTROLLER_LINK_LOW = 400;
function loop$l() {
    var _a;
    for (const roomName in Game.rooms) {
        const room = Game.rooms[roomName];
        if (!((_a = room.controller) === null || _a === void 0 ? void 0 : _a.my))
            continue;
        processRoomLinks(room);
    }
}
function processRoomLinks(room) {
    const links = getRoomLinks(room);
    if (links.length < 2)
        return;
    const funded = upgradingFunded(room);
    const roles = getLinkRoles(room, links);
    const { sources, sinks: allSinks } = classifyLinks(room, links);
    const sinks = funded ? allSinks : allSinks.filter((l) => roles[l.id] !== "controller");
    let hungry = funded ? findHungryControllerLink(room, links) : null;
    for (const src of sources) {
        if (src.cooldown > 0)
            continue;
        const available = src.store[RESOURCE_ENERGY];
        if (available < LINK_MIN_TRANSFER)
            continue;
        const sink = hungry !== null && hungry !== void 0 ? hungry : pickSink(sinks, src);
        if (!sink)
            continue;
        const deficit = sink.store.getFreeCapacity(RESOURCE_ENERGY);
        if (Math.min(available, deficit) < LINK_MIN_TRANSFER)
            continue;
        if (src.transferEnergy(sink) === OK && sink === hungry)
            hungry = null;
    }
    if (!hungry)
        return;
    const relay = findRelayLink(room);
    if (relay &&
        relay.cooldown === 0 &&
        relay.store[RESOURCE_ENERGY] >= LINK_MIN_TRANSFER) {
        relay.transferEnergy(hungry);
    }
}
function getRoomLinks(room) {
    var _a;
    return ((_a = room.memory.linkIds) !== null && _a !== void 0 ? _a : [])
        .map((id) => Game.getObjectById(id))
        .filter(Boolean);
}
function findHungryControllerLink(room, links) {
    const roles = getLinkRoles(room, links);
    let best = null;
    for (const link of links) {
        if (roles[link.id] !== "controller")
            continue;
        if (link.store[RESOURCE_ENERGY] >= CONTROLLER_LINK_LOW)
            continue;
        if (!best || link.store[RESOURCE_ENERGY] < best.store[RESOURCE_ENERGY]) {
            best = link;
        }
    }
    return best;
}
function findRelayLink(room) {
    var _a;
    if (!room.storage || !upgradingFunded(room))
        return null;
    const links = getRoomLinks(room);
    if (links.length < 2)
        return null;
    if (!findHungryControllerLink(room, links))
        return null;
    const roles = getLinkRoles(room, links);
    return (_a = links.find((l) => roles[l.id] === "storage")) !== null && _a !== void 0 ? _a : null;
}
function sourceLinksHaveOutlet(room) {
    if (upgradingFunded(room))
        return true;
    const links = getRoomLinks(room);
    const roles = getLinkRoles(room, links);
    return links.some((l) => roles[l.id] === "storage");
}
const linkRoleCache = {};
function getLinkRoles(room, links) {
    var _a, _b;
    const storage = room.storage;
    const signature = `${links.map((l) => l.id).join(",")}|${(_a = storage === null || storage === void 0 ? void 0 : storage.id) !== null && _a !== void 0 ? _a : ""}`;
    const cached = linkRoleCache[room.name];
    if (cached && cached.signature === signature)
        return cached.roles;
    const minerContainers = ((_b = room.memory.minerContainerIds) !== null && _b !== void 0 ? _b : [])
        .map((id) => Game.getObjectById(id))
        .filter(Boolean);
    const controller = room.controller;
    const roles = {};
    for (const link of links) {
        const nearMiner = minerContainers.some((c) => link.pos.getRangeTo(c.pos) <= 2);
        const nearController = controller && link.pos.getRangeTo(controller.pos) <= 3;
        const nearStorage = storage && link.pos.getRangeTo(storage.pos) <= 2;
        if (nearMiner && !nearController && !nearStorage) {
            roles[link.id] = "source";
        }
        else if (nearController) {
            roles[link.id] = "controller";
        }
        else if (nearStorage) {
            roles[link.id] = "storage";
        }
        else {
            roles[link.id] = "neutral";
        }
    }
    linkRoleCache[room.name] = { signature, roles };
    return roles;
}
function classifyLinks(room, links) {
    const roles = getLinkRoles(room, links);
    const sources = [];
    const sinks = [];
    for (const link of links) {
        const role = roles[link.id];
        if (role === "source") {
            sources.push(link);
        }
        else if (role === "controller" || role === "storage") {
            sinks.push(link);
        }
        else {
            if (link.store[RESOURCE_ENERGY] > LINK_TRANSFER_THRESHOLD) {
                sources.push(link);
            }
            else {
                sinks.push(link);
            }
        }
    }
    return { sources, sinks };
}
function pickSink(sinks, src) {
    let best = null;
    let bestFree = LINK_SINK_HEADROOM - 1;
    for (const sink of sinks) {
        if (sink.id === src.id)
            continue;
        const free = sink.store.getFreeCapacity(RESOURCE_ENERGY);
        if (free > bestFree) {
            best = sink;
            bestFree = free;
        }
    }
    return best;
}

const CONTAINER_REPAIR_THRESHOLD = 0.9;
function runMiner(creep) {
    var _a;
    if (!creep.memory.assignedSourceId || !creep.memory.assignedContainerId) {
        const assignment = findUnclaimedMinerAssignment(creep.room);
        if (assignment) {
            creep.memory.assignedSourceId = assignment.source.id;
            creep.memory.assignedContainerId = assignment.container.id;
        }
    }
    if (creep.memory.assignedSourceId && creep.memory.assignedContainerId) {
        const source = Game.getObjectById(creep.memory.assignedSourceId);
        const container = Game.getObjectById(creep.memory.assignedContainerId);
        if (!container) {
            creep.memory.assignedSourceId = undefined;
            creep.memory.assignedContainerId = undefined;
            return;
        }
        if (source && !isSourceSafe(source)) {
            creep.memory.assignedSourceId = undefined;
            creep.memory.assignedContainerId = undefined;
            return;
        }
        if (source && container) {
            if (!creep.pos.isEqualTo(container.pos)) {
                creep.moveTo(container.pos, { reusePath: 50 });
                if (creep.pos.isNearTo(source))
                    creep.harvest(source);
                return;
            }
            if (container.hits < container.hitsMax * CONTAINER_REPAIR_THRESHOLD &&
                creep.store[RESOURCE_ENERGY] > 0) {
                creep.repair(container);
                return;
            }
            if (creep.store.getFreeCapacity() === 0 && sourceLinksHaveOutlet(creep.room)) {
                const link = findAdjacentLink(creep);
                if (link && link.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
                    creep.transfer(link, RESOURCE_ENERGY);
                }
            }
            harvestFromSource(creep, source);
            return;
        }
    }
    const sources = getSafeSources(creep.room);
    for (const source of sources) {
        const containers = creep.room.find(FIND_STRUCTURES, {
            filter: (s) => s.structureType === STRUCTURE_CONTAINER &&
                s.pos.getRangeTo(source.pos) <= 1,
        });
        if (containers.length > 0) {
            const container = containers[0];
            if (!creep.pos.isEqualTo(container.pos)) {
                creep.moveTo(container.pos, { reusePath: 50 });
                if (creep.pos.isNearTo(source))
                    creep.harvest(source);
                return;
            }
            harvestFromSource(creep, source);
            return;
        }
    }
    if (sources.length > 0) {
        const source = (_a = creep.pos.findClosestByRange(sources)) !== null && _a !== void 0 ? _a : sources[0];
        harvestFromSource(creep, source);
    }
}
function findAdjacentLink(creep) {
    const links = creep.pos.findInRange(FIND_MY_STRUCTURES, 1, {
        filter: (s) => s.structureType === STRUCTURE_LINK,
    });
    if (links.length === 0)
        return null;
    return links.reduce((a, b) => a.store.getFreeCapacity(RESOURCE_ENERGY) > b.store.getFreeCapacity(RESOURCE_ENERGY) ? a : b);
}

const HANDOFF_RANGE = 10;
let fillerCheckTick = -1;
const roomHasFiller = {};
function hasActiveFiller(room) {
    if (fillerCheckTick !== Game.time) {
        fillerCheckTick = Game.time;
        for (const k in roomHasFiller)
            delete roomHasFiller[k];
    }
    if (!(room.name in roomHasFiller)) {
        roomHasFiller[room.name] = room
            .find(FIND_MY_CREEPS)
            .some((c) => c.memory.role === ROLE_FILLER && !c.spawning);
    }
    return roomHasFiller[room.name];
}
function runHauler(creep) {
    var _a, _b;
    if ((creep.memory.boostCompound || ((_a = creep.memory.boostQueue) === null || _a === void 0 ? void 0 : _a.length)) && seekBoost(creep))
        return;
    const assignedId = creep.memory.assignedContainerId;
    if (assignedId &&
        (!Game.getObjectById(assignedId) || !getMinerContainerIds(creep.room).includes(assignedId))) {
        creep.memory.assignedContainerId = undefined;
    }
    if (!creep.memory.assignedContainerId) {
        const assignment = findUnclaimedHaulerAssignment(creep.room);
        if (assignment) {
            creep.memory.assignedContainerId = assignment.id;
        }
    }
    const storageModel = !!creep.room.storage && hasActiveFiller(creep.room);
    if (creep.memory.working === undefined)
        creep.memory.working = false;
    if (creep.memory.working && creep.store[RESOURCE_ENERGY] === 0) {
        creep.memory.working = false;
        creep.memory.coreRelief = undefined;
    }
    if (!creep.memory.working && creep.store.getFreeCapacity(RESOURCE_ENERGY) === 0) {
        creep.memory.working = true;
    }
    if (!creep.memory.working) {
        setFillTarget(creep, undefined);
        if (collectEnergy$1(creep, storageModel))
            return;
        if (creep.store[RESOURCE_ENERGY] === 0)
            return;
        creep.memory.working = true;
    }
    if (getThreatInfo(creep.room).hostiles.length > 0) {
        const tower = findEmptiestTower(creep.room);
        if (tower) {
            setFillTarget(creep, tower.id);
            transferEnergyTo(creep, tower);
            return;
        }
    }
    if (!storageModel || creep.memory.coreRelief) {
        if (creep.memory.fillTargetId) {
            const cached = Game.getObjectById(creep.memory.fillTargetId);
            if (cached &&
                "structureType" in cached &&
                "store" in cached &&
                cached.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
                transferEnergyTo(creep, cached);
                return;
            }
            setFillTarget(creep, undefined);
        }
        const coreTarget = findCoreFillTarget(creep);
        if (coreTarget) {
            setFillTarget(creep, coreTarget.id);
            transferEnergyTo(creep, coreTarget);
            return;
        }
    }
    const pending = creep.room.memory.pendingSend;
    if (pending && pending.resource === RESOURCE_ENERGY) {
        const termId = creep.room.memory.terminalId;
        const terminal = termId ? Game.getObjectById(termId) : null;
        if (terminal && ((_b = terminal.store[RESOURCE_ENERGY]) !== null && _b !== void 0 ? _b : 0) < pending.loadTarget) {
            setFillTarget(creep, terminal.id);
            transferEnergyTo(creep, terminal);
            return;
        }
    }
    const handoff = findHandoffTarget(creep, HANDOFF_RANGE);
    if (handoff) {
        setFillTarget(creep, handoff.id);
        transferEnergyTo(creep, handoff);
        return;
    }
    const depositTarget = findDepositTargetExcludingMiner(creep);
    if (depositTarget) {
        setFillTarget(creep, depositTarget.id);
        if (Memory.debugHaulers === creep.room.name)
            debugDeposit(creep, depositTarget);
        transferEnergyTo(creep, depositTarget);
        return;
    }
    const farHandoff = findHandoffTarget(creep, Infinity);
    if (farHandoff) {
        setFillTarget(creep, farHandoff.id);
        transferEnergyTo(creep, farHandoff);
        return;
    }
    const fallback = findSmartEnergyFallbackTarget(creep);
    if (fallback) {
        if (fallback.kind === "build") {
            buildAtConstructionSite(creep, fallback.target);
            return;
        }
        if (fallback.kind === "repair") {
            repairStructure(creep, fallback.target);
            return;
        }
        upgradeController(creep);
        return;
    }
    parkNearCore(creep);
}
function parkNearCore(creep) {
    var _a;
    if (parkIdle(creep, "square"))
        return;
    const anchor = (_a = creep.room.storage) !== null && _a !== void 0 ? _a : creep.room.find(FIND_MY_SPAWNS)[0];
    if (anchor && !creep.pos.inRangeTo(anchor, 1)) {
        creep.moveTo(anchor, { reusePath: 20, range: 1 });
    }
}
function debugDeposit(creep, target) {
    const terrain = creep.room.getTerrain();
    const ring = [];
    for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0)
                continue;
            const x = target.pos.x + dx;
            const y = target.pos.y + dy;
            if (x < 0 || x > 49 || y < 0 || y > 49) {
                ring.push("x");
                continue;
            }
            const occupant = creep.room
                .lookForAt(LOOK_CREEPS, x, y)
                .find((c) => c.my);
            if (occupant)
                ring.push(occupant.memory.role[0]);
            else if (terrain.get(x, y) === TERRAIN_MASK_WALL)
                ring.push("#");
            else
                ring.push(".");
        }
    }
    const search = PathFinder.search(creep.pos, { pos: target.pos, range: 1 }, { plainCost: 2, swampCost: 10, maxOps: 500 });
    const step = search.path[0];
    let stepInfo = "none";
    if (step) {
        const onStep = creep.room.lookForAt(LOOK_CREEPS, step.x, step.y).find((c) => c.my);
        stepInfo = `${step.x},${step.y}:${onStep ? onStep.memory.role[0] : "free"}`;
    }
    const t = target;
    console.log(`[H ${creep.name}] pos=${creep.pos.x},${creep.pos.y} st=${creep.store[RESOURCE_ENERGY]} ` +
        `-> ${t.structureType}@${target.pos.x},${target.pos.y} range=${creep.pos.getRangeTo(target)} ` +
        `next=${stepInfo} ring=[${ring.join("")}]`);
}
const DIVERT_RANGE = 10;
function collectEnergy$1(creep, storageModel) {
    const carried = creep.store[RESOURCE_ENERGY];
    const nearbyOnly = carried > 0;
    const dropped = creep.room.find(FIND_DROPPED_RESOURCES, {
        filter: (d) => d.resourceType === RESOURCE_ENERGY && d.amount > 50,
    });
    if (dropped.length > 0) {
        const pile = creep.pos.findClosestByRange(dropped);
        if (!nearbyOnly || creep.pos.getRangeTo(pile) <= DIVERT_RANGE) {
            pickupDroppedResource(creep, pile);
            return true;
        }
    }
    let container = null;
    const assignedId = creep.memory.assignedContainerId;
    if (assignedId) {
        const assigned = Game.getObjectById(assignedId);
        if (assigned && assigned.store[RESOURCE_ENERGY] >= 100)
            container = assigned;
    }
    if (!container)
        container = findClosestMinerContainerWithEnergy(creep);
    if (container &&
        container.store[RESOURCE_ENERGY] >= 100 &&
        (!nearbyOnly || creep.pos.getRangeTo(container) <= DIVERT_RANGE)) {
        withdrawFromContainer(creep, container);
        return true;
    }
    if (carried === 0) {
        const storage = creep.room.storage;
        const baseNeedsEnergy = creep.room.energyAvailable < creep.room.energyCapacityAvailable;
        if (storage && baseNeedsEnergy && storage.store[RESOURCE_ENERGY] > 0) {
            if (storageModel)
                creep.memory.coreRelief = true;
            if (creep.withdraw(storage, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                creep.moveTo(storage, { reusePath: 20 });
            }
            return true;
        }
        if (storageModel)
            return false;
        if (baseNeedsEnergy) {
            acquireEnergy(creep);
            return true;
        }
    }
    return false;
}

const NUKER_GHODIUM_RESERVE = NUKER_GHODIUM_CAPACITY;
const STORAGE_ENERGY_SURPLUS = 250000;
const MAX_FILL_PER_TICK = 1000;
function loop$k() {
    var _a;
    for (const roomName in Game.rooms) {
        const room = Game.rooms[roomName];
        if (!((_a = room.controller) === null || _a === void 0 ? void 0 : _a.my))
            continue;
        processNuker(room);
    }
}
function processNuker(room) {
    const nuker = resolveNuker(room);
    if (!nuker)
        return;
    const job = findFillJob(room, nuker);
    if (!job && !courierHoldsCargo$1(room)) {
        releaseCourier$1(room);
        return;
    }
    commandCourier$1(room, nuker, job);
}
function courierHoldsCargo$1(room) {
    var _a, _b;
    const name = (_a = room.memory.nukerSystem) === null || _a === void 0 ? void 0 : _a.courierName;
    const courier = name ? Game.creeps[name] : undefined;
    return !!courier && ((_b = courier.store.getUsedCapacity()) !== null && _b !== void 0 ? _b : 0) > 0;
}
function resolveNuker(room) {
    if (!room.memory.nukerSystem)
        room.memory.nukerSystem = {};
    const ns = room.memory.nukerSystem;
    if (ns.nukerId) {
        const cached = Game.getObjectById(ns.nukerId);
        if (cached)
            return cached;
        delete ns.nukerId;
    }
    const nuker = room.find(FIND_MY_STRUCTURES, {
        filter: (s) => s.structureType === STRUCTURE_NUKER,
    })[0];
    if (!nuker)
        return null;
    ns.nukerId = nuker.id;
    return nuker;
}
function findFillJob(room, nuker) {
    var _a;
    return (_a = findGhodiumJob(room, nuker)) !== null && _a !== void 0 ? _a : findEnergyJob(room, nuker);
}
function findGhodiumJob(room, nuker) {
    var _a, _b;
    const need = NUKER_GHODIUM_CAPACITY - ((_a = nuker.store.getUsedCapacity(RESOURCE_GHODIUM)) !== null && _a !== void 0 ? _a : 0);
    if (need <= 0)
        return null;
    for (const src of [room.storage, room.terminal]) {
        if (!src)
            continue;
        const avail = (_b = src.store.getUsedCapacity(RESOURCE_GHODIUM)) !== null && _b !== void 0 ? _b : 0;
        if (avail <= 0)
            continue;
        return {
            resource: RESOURCE_GHODIUM,
            source: src,
            amount: Math.min(need, avail, MAX_FILL_PER_TICK),
        };
    }
    return null;
}
function findEnergyJob(room, nuker) {
    var _a, _b;
    const need = NUKER_ENERGY_CAPACITY - ((_a = nuker.store.getUsedCapacity(RESOURCE_ENERGY)) !== null && _a !== void 0 ? _a : 0);
    if (need <= 0)
        return null;
    const storage = room.storage;
    if (!storage)
        return null;
    const storageEnergy = (_b = storage.store.getUsedCapacity(RESOURCE_ENERGY)) !== null && _b !== void 0 ? _b : 0;
    if (storageEnergy <= STORAGE_ENERGY_SURPLUS)
        return null;
    const spendable = storageEnergy - STORAGE_ENERGY_SURPLUS;
    const amount = Math.min(need, spendable, MAX_FILL_PER_TICK);
    if (amount <= 0)
        return null;
    return { resource: RESOURCE_ENERGY, source: storage, amount };
}
function commandCourier$1(room, nuker, job) {
    var _a, _b, _c;
    const storage = room.storage;
    if (!storage)
        return;
    const courier = acquireCourier$1(room);
    if (!courier)
        return;
    const carried = Object.keys(courier.store).filter((r) => { var _a; return ((_a = courier.store.getUsedCapacity(r)) !== null && _a !== void 0 ? _a : 0) > 0; });
    if (carried.length > 0) {
        const r = carried[0];
        const carriedAmount = (_a = courier.store.getUsedCapacity(r)) !== null && _a !== void 0 ? _a : 0;
        const space = (_b = nuker.store.getFreeCapacity(r)) !== null && _b !== void 0 ? _b : 0;
        if (space > 0) {
            if (courier.transfer(nuker, r, Math.min(carriedAmount, space)) === ERR_NOT_IN_RANGE) {
                courier.moveTo(nuker, { reusePath: 5 });
            }
        }
        else {
            const dest = [storage, room.terminal].find((s) => { var _a; return s && ((_a = s.store.getFreeCapacity(r)) !== null && _a !== void 0 ? _a : 0) > 0; });
            if (!dest) {
                courier.drop(r);
                return;
            }
            if (courier.transfer(dest, r) === ERR_NOT_IN_RANGE)
                courier.moveTo(dest, { reusePath: 5 });
        }
        return;
    }
    if (!job)
        return;
    const amount = Math.min((_c = courier.store.getFreeCapacity()) !== null && _c !== void 0 ? _c : 0, job.amount);
    if (amount <= 0)
        return;
    if (courier.withdraw(job.source, job.resource, amount) === ERR_NOT_IN_RANGE) {
        courier.moveTo(job.source, { reusePath: 5 });
    }
}
function acquireCourier$1(room) {
    var _a, _b;
    const ns = room.memory.nukerSystem;
    const haulers = room.find(FIND_MY_CREEPS, {
        filter: (c) => c.memory.role === ROLE_HAULER && c.spawning !== true,
    });
    const mayBorrow = mayBorrowHauler(room, haulers);
    if (ns.courierName) {
        const existing = Game.creeps[ns.courierName];
        if (existing && existing.room.name === room.name && existing.memory.role === ROLE_HAULER) {
            const holdsNonEnergy = ((_a = existing.store.getUsedCapacity()) !== null && _a !== void 0 ? _a : 0) > ((_b = existing.store[RESOURCE_ENERGY]) !== null && _b !== void 0 ? _b : 0);
            if (mayBorrow || holdsNonEnergy)
                return existing;
        }
        delete ns.courierName;
    }
    if (!mayBorrow)
        return null;
    const nuker = ns.nukerId ? Game.getObjectById(ns.nukerId) : null;
    const pool = haulers.filter((c) => { var _a; return ((_a = c.store.getUsedCapacity()) !== null && _a !== void 0 ? _a : 0) === 0; });
    if (pool.length === 0)
        return null;
    const chosen = nuker
        ? pool.reduce((best, c) => (c.pos.getRangeTo(nuker) < best.pos.getRangeTo(nuker) ? c : best))
        : pool[0];
    ns.courierName = chosen.name;
    return chosen;
}
function releaseCourier$1(room) {
    const ns = room.memory.nukerSystem;
    if (ns)
        delete ns.courierName;
}
function statusFor(room) {
    var _a, _b, _c;
    const ns = room.memory.nukerSystem;
    const nuker = (ns === null || ns === void 0 ? void 0 : ns.nukerId)
        ? Game.getObjectById(ns.nukerId)
        : (_a = room.find(FIND_MY_STRUCTURES, {
            filter: (s) => s.structureType === STRUCTURE_NUKER,
        })[0]) !== null && _a !== void 0 ? _a : null;
    if (!nuker)
        return null;
    const energy = (_b = nuker.store.getUsedCapacity(RESOURCE_ENERGY)) !== null && _b !== void 0 ? _b : 0;
    const ghodium = (_c = nuker.store.getUsedCapacity(RESOURCE_GHODIUM)) !== null && _c !== void 0 ? _c : 0;
    return {
        room: room.name,
        energy,
        energyCapacity: NUKER_ENERGY_CAPACITY,
        ghodium,
        ghodiumCapacity: NUKER_GHODIUM_CAPACITY,
        cooldown: nuker.cooldown,
        ready: nuker.cooldown === 0 &&
            energy >= NUKER_ENERGY_CAPACITY &&
            ghodium >= NUKER_GHODIUM_CAPACITY,
    };
}
function describeNukers() {
    var _a;
    const out = [];
    for (const rn in Game.rooms) {
        const room = Game.rooms[rn];
        if (!((_a = room.controller) === null || _a === void 0 ? void 0 : _a.my))
            continue;
        const s = statusFor(room);
        if (s)
            out.push(s);
    }
    return out;
}
function launchNukeFrom(fromRoom, target) {
    var _a, _b, _c;
    const room = Game.rooms[fromRoom];
    if (!((_a = room === null || room === void 0 ? void 0 : room.controller) === null || _a === void 0 ? void 0 : _a.my))
        return `${fromRoom} is not a room you own`;
    const nuker = room.find(FIND_MY_STRUCTURES, {
        filter: (s) => s.structureType === STRUCTURE_NUKER,
    })[0];
    if (!nuker)
        return `${fromRoom} has no nuker (built at RCL 8)`;
    if (nuker.cooldown > 0)
        return `nuker on cooldown for ${nuker.cooldown} more ticks`;
    const energy = (_b = nuker.store.getUsedCapacity(RESOURCE_ENERGY)) !== null && _b !== void 0 ? _b : 0;
    const ghodium = (_c = nuker.store.getUsedCapacity(RESOURCE_GHODIUM)) !== null && _c !== void 0 ? _c : 0;
    if (energy < NUKER_ENERGY_CAPACITY) {
        return `nuker not fully loaded: energy ${energy}/${NUKER_ENERGY_CAPACITY}`;
    }
    if (ghodium < NUKER_GHODIUM_CAPACITY) {
        return `nuker not fully loaded: ghodium ${ghodium}/${NUKER_GHODIUM_CAPACITY}`;
    }
    const dist = Game.map.getRoomLinearDistance(fromRoom, target.roomName);
    if (dist > NUKE_RANGE) {
        return `target ${target.roomName} is ${dist} rooms away - nuker range is ${NUKE_RANGE}`;
    }
    const res = nuker.launchNuke(target);
    if (res !== OK)
        return `launchNuke failed with code ${res}`;
    return null;
}

const FACTORY_PLAN_INTERVAL = 50;
const FACTORY_MIN_RESERVE_ENERGY = 50000;
const FACTORY_BATTERY_MIN_ENERGY = 400000;
const FACTORY_MIN_RESERVE_MINERAL = 3000;
const FACTORY_MAX_INPUT_LOAD = 6000;
const FACTORY_PRODUCT_EVICT_THRESHOLD = 1000;
const FACTORY_RESOLVE_MAX_DEPTH = 8;
const COMMODITY_TARGETS = [
    { commodity: RESOURCE_BATTERY, target: 10000, requiresLevel: 0, value: 1 },
    { commodity: RESOURCE_UTRIUM_BAR, target: 3000, requiresLevel: 0, value: 2 },
    { commodity: RESOURCE_LEMERGIUM_BAR, target: 3000, requiresLevel: 0, value: 2 },
    { commodity: RESOURCE_ZYNTHIUM_BAR, target: 3000, requiresLevel: 0, value: 2 },
    { commodity: RESOURCE_KEANIUM_BAR, target: 3000, requiresLevel: 0, value: 2 },
    { commodity: RESOURCE_OXIDANT, target: 3000, requiresLevel: 0, value: 2 },
    { commodity: RESOURCE_REDUCTANT, target: 3000, requiresLevel: 0, value: 2 },
    { commodity: RESOURCE_PURIFIER, target: 2000, requiresLevel: 0, value: 2 },
    { commodity: RESOURCE_GHODIUM_MELT, target: 2000, requiresLevel: 0, value: 2 },
    { commodity: RESOURCE_WIRE, target: 2000, requiresLevel: 0, value: 5 },
    { commodity: RESOURCE_CELL, target: 2000, requiresLevel: 0, value: 5 },
    { commodity: RESOURCE_ALLOY, target: 2000, requiresLevel: 0, value: 5 },
    { commodity: RESOURCE_CONDENSATE, target: 2000, requiresLevel: 0, value: 5 },
    { commodity: RESOURCE_COMPOSITE, target: 1000, requiresLevel: 1, value: 8 },
    { commodity: RESOURCE_CRYSTAL, target: 500, requiresLevel: 2, value: 12 },
    { commodity: RESOURCE_LIQUID, target: 500, requiresLevel: 3, value: 16 },
    { commodity: RESOURCE_SWITCH, target: 600, requiresLevel: 1, value: 10 },
    { commodity: RESOURCE_TRANSISTOR, target: 300, requiresLevel: 2, value: 20 },
    { commodity: RESOURCE_MICROCHIP, target: 150, requiresLevel: 3, value: 40 },
    { commodity: RESOURCE_CIRCUIT, target: 60, requiresLevel: 4, value: 70 },
    { commodity: RESOURCE_DEVICE, target: 30, requiresLevel: 5, value: 110 },
    { commodity: RESOURCE_PHLEGM, target: 600, requiresLevel: 1, value: 10 },
    { commodity: RESOURCE_TISSUE, target: 300, requiresLevel: 2, value: 20 },
    { commodity: RESOURCE_MUSCLE, target: 150, requiresLevel: 3, value: 40 },
    { commodity: RESOURCE_ORGANOID, target: 60, requiresLevel: 4, value: 70 },
    { commodity: RESOURCE_ORGANISM, target: 30, requiresLevel: 5, value: 110 },
    { commodity: RESOURCE_TUBE, target: 600, requiresLevel: 1, value: 10 },
    { commodity: RESOURCE_FIXTURES, target: 300, requiresLevel: 2, value: 20 },
    { commodity: RESOURCE_FRAME, target: 150, requiresLevel: 3, value: 40 },
    { commodity: RESOURCE_HYDRAULICS, target: 60, requiresLevel: 4, value: 70 },
    { commodity: RESOURCE_MACHINE, target: 30, requiresLevel: 5, value: 110 },
    { commodity: RESOURCE_CONCENTRATE, target: 600, requiresLevel: 1, value: 10 },
    { commodity: RESOURCE_EXTRACT, target: 300, requiresLevel: 2, value: 20 },
    { commodity: RESOURCE_SPIRIT, target: 150, requiresLevel: 3, value: 40 },
    { commodity: RESOURCE_EMANATION, target: 60, requiresLevel: 4, value: 70 },
    { commodity: RESOURCE_ESSENCE, target: 30, requiresLevel: 5, value: 110 },
];
const MANAGED_COMMODITIES = new Set(COMMODITY_TARGETS.map((t) => t.commodity));
const COMMODITY_VALUE = new Map(COMMODITY_TARGETS.map((t) => [t.commodity, t.value]));
const COMMODITY_TERMINAL_STOCK = 2000;

const REACTION_RECIPES = {
    OH: ['O', 'H'],
    ZK: ['Z', 'K'],
    UL: ['U', 'L'],
    G: ['ZK', 'UL'],
    UH: ['U', 'H'],
    UO: ['U', 'O'],
    KH: ['K', 'H'],
    KO: ['K', 'O'],
    LH: ['L', 'H'],
    LO: ['L', 'O'],
    ZH: ['Z', 'H'],
    ZO: ['Z', 'O'],
    GH: ['G', 'H'],
    GO: ['G', 'O'],
    UH2O: ['UH', 'OH'],
    UHO2: ['UO', 'OH'],
    KH2O: ['KH', 'OH'],
    KHO2: ['KO', 'OH'],
    LH2O: ['LH', 'OH'],
    LHO2: ['LO', 'OH'],
    ZH2O: ['ZH', 'OH'],
    ZHO2: ['ZO', 'OH'],
    GH2O: ['GH', 'OH'],
    GHO2: ['GO', 'OH'],
    XUH2O: ['UH2O', 'X'],
    XUHO2: ['UHO2', 'X'],
    XKH2O: ['KH2O', 'X'],
    XKHO2: ['KHO2', 'X'],
    XLH2O: ['LH2O', 'X'],
    XLHO2: ['LHO2', 'X'],
    XZH2O: ['ZH2O', 'X'],
    XZHO2: ['ZHO2', 'X'],
    XGH2O: ['GH2O', 'X'],
    XGHO2: ['GHO2', 'X'],
};
function resolveChain(compound, amount, room) {
    var _a, _b, _c;
    const post = [];
    const visited = new Set();
    function dfs(c) {
        if (visited.has(c) || !REACTION_RECIPES[c])
            return;
        visited.add(c);
        const [a, b] = REACTION_RECIPES[c];
        dfs(a);
        dfs(b);
        post.push(c);
    }
    dfs(compound);
    const grossNeed = new Map([[compound, amount]]);
    const netNeed = new Map();
    for (let i = post.length - 1; i >= 0; i--) {
        const c = post[i];
        const have = room ? getStockForCompound(c, room) : 0;
        const net = Math.max(0, ((_a = grossNeed.get(c)) !== null && _a !== void 0 ? _a : 0) - have);
        if (net <= 0)
            continue;
        netNeed.set(c, net);
        const [a, b] = REACTION_RECIPES[c];
        grossNeed.set(a, ((_b = grossNeed.get(a)) !== null && _b !== void 0 ? _b : 0) + net);
        grossNeed.set(b, ((_c = grossNeed.get(b)) !== null && _c !== void 0 ? _c : 0) + net);
    }
    const result = [];
    for (const c of post) {
        if (netNeed.has(c))
            result.push({ compound: c, amount: netNeed.get(c) });
    }
    return result;
}
function boostedPartType(compound) {
    for (const part of Object.keys(BOOSTS)) {
        if (BOOSTS[part][compound])
            return part;
    }
    return undefined;
}
function getBoostRequests(room) {
    var _a;
    const requests = new Map();
    for (const c of room.find(FIND_MY_CREEPS)) {
        if (c.memory.boosted)
            continue;
        const pending = [c.memory.boostCompound, ...((_a = c.memory.boostQueue) !== null && _a !== void 0 ? _a : [])];
        pending.forEach((compound, i) => {
            var _a;
            if (!compound)
                return;
            const part = boostedPartType(compound);
            if (!part)
                return;
            const parts = c.body.filter((b) => b.type === part && !b.boost).length;
            if (parts === 0)
                return;
            const amount = ((_a = requests.get(compound)) !== null && _a !== void 0 ? _a : 0) + parts * LAB_BOOST_MINERAL;
            if (i > 0 && getStockForCompound(compound, room) < amount)
                return;
            requests.set(compound, amount);
        });
    }
    return requests;
}
function assignBoostLabs(outputLabs, compounds) {
    const assigned = new Map();
    const taken = new Set();
    const unplaced = [];
    for (const compound of compounds) {
        const lab = outputLabs.find((l) => l.mineralType === compound && !taken.has(l.id));
        if (lab) {
            assigned.set(compound, lab);
            taken.add(lab.id);
        }
        else {
            unplaced.push(compound);
        }
    }
    for (const compound of unplaced) {
        const lab = [...outputLabs].reverse().find((l) => !taken.has(l.id));
        if (!lab)
            break;
        assigned.set(compound, lab);
        taken.add(lab.id);
    }
    return assigned;
}
function getStockForCompound(compound, room) {
    var _a, _b, _c, _d;
    const rc = compound;
    return (((_b = (_a = room.storage) === null || _a === void 0 ? void 0 : _a.store.getUsedCapacity(rc)) !== null && _b !== void 0 ? _b : 0) +
        ((_d = (_c = room.terminal) === null || _c === void 0 ? void 0 : _c.store.getUsedCapacity(rc)) !== null && _d !== void 0 ? _d : 0));
}
const BASE_MINERAL_SET = new Set(["H", "O", "U", "L", "K", "Z", "X"]);
function queuedBaseMineralNeed(queue, producedOnFirst = 0) {
    const need = new Map();
    queue.forEach((entry, i) => {
        var _a;
        const recipe = REACTION_RECIPES[entry.compound];
        if (!recipe)
            return;
        const amount = i === 0 ? Math.max(0, entry.amount - producedOnFirst) : entry.amount;
        for (const input of recipe) {
            if (BASE_MINERAL_SET.has(input))
                need.set(input, ((_a = need.get(input)) !== null && _a !== void 0 ? _a : 0) + amount);
        }
    });
    return need;
}
function labMineralNeed(room) {
    var _a, _b;
    const ls = room.memory.labSystem;
    return queuedBaseMineralNeed((_a = ls === null || ls === void 0 ? void 0 : ls.queue) !== null && _a !== void 0 ? _a : [], (ls === null || ls === void 0 ? void 0 : ls.activeCompound) ? (_b = ls.lastProduced) !== null && _b !== void 0 ? _b : 0 : 0);
}
function labInputStock(room, resource) {
    var _a, _b, _c;
    let total = getStockForCompound(resource, room);
    for (const id of (_b = (_a = room.memory.labSystem) === null || _a === void 0 ? void 0 : _a.inputLabIds) !== null && _b !== void 0 ? _b : []) {
        const lab = Game.getObjectById(id);
        total += (_c = lab === null || lab === void 0 ? void 0 : lab.store.getUsedCapacity(resource)) !== null && _c !== void 0 ? _c : 0;
    }
    return total;
}
function incomingSends(room, resource) {
    var _a;
    let total = 0;
    for (const name in Game.rooms) {
        const pending = (_a = Game.rooms[name].memory) === null || _a === void 0 ? void 0 : _a.pendingSend;
        if (pending && pending.to === room.name && pending.resource === resource)
            total += pending.amount;
    }
    return total;
}
function labMineralShortfall(room) {
    const shortfall = new Map();
    for (const [mineral, need] of labMineralNeed(room)) {
        const missing = need - labInputStock(room, mineral) - incomingSends(room, mineral);
        if (missing > 0)
            shortfall.set(mineral, missing);
    }
    return shortfall;
}

const TERMINAL_CONFIG = {
    MINERAL_SELL_THRESHOLD: 1000,
    MINERAL_MAX_TRADE_AMOUNT: 1000,
    MIN_PRICE_RATIO: 0.5,
    COMMODITY_MIN_PRICE_RATIO: 0.9,
    MAX_TRADE_DISTANCE: 10,
    MIN_TERMINAL_ENERGY: 1000,
};
const BUY_CONFIG = {
    INTERVAL: 500,
    RETRY_AFTER_DEAL: 20,
    TARGET_STOCK: 3000,
    MAX_PRICE_RATIO: 1.2,
    MAX_AMOUNT: 5000,
    MIN_AMOUNT: 100,
    MAX_ENERGY_COST_RATIO: 0.3,
};
const MINERAL_LAB_RESERVE = 20000;
const MINERAL_TERMINAL_CAP = 20000;
const GHODIUM_CONFIG = {
    INTERVAL: 500,
    MAX_PRICE: 8,
    MAX_AMOUNT: 1000,
    TRANSFER_AMOUNT: 1000,
};
const NETWORK_CONFIG = {
    PLAN_INTERVAL: 100,
    ENERGY_RICH_THRESHOLD: 200000,
    ENERGY_POOR_THRESHOLD: 50000,
    ENERGY_TRANSFER_AMOUNT: 30000,
    ENERGY_MAX_TRANSFERS_PER_PASS: 4,
    MINERAL_SURPLUS_THRESHOLD: 2000,
    MINERAL_TRANSFER_AMOUNT: 3000,
    MAX_DISTANCE: 10,
};
const MARKET_MAKER_CONFIG = {
    MANAGE_INTERVAL: 50,
    MAX_ACTIVE_ORDERS: 12,
    MIN_SELL_SURPLUS: 5000,
    ORDER_LOT: 5000,
    TOPUP_THRESHOLD: 1000,
    UNDERCUT: 0.001,
    MIN_CREDITS_TO_POST: 10000,
    PRICE_FLOOR_RATIO: 0.9,
    REPRICE_TOLERANCE: 0.15,
};
const ENERGY_TRADE_CONFIG = {
    INTERVAL: 100,
    SELL_STORAGE_THRESHOLD: 400000,
    SELL_KEEP: 350000,
    SELL_MIN_PRICE: 2,
    SELL_MAX_AMOUNT: 5000,
    BUY_STORAGE_THRESHOLD: 30000,
    BUY_MAX_PRICE: 1,
    BUY_MAX_AMOUNT: 5000,
    MIN_CREDITS_TO_BUY: 50000,
};
const PRICE_HISTORY_LEN = 20;
const BASE_MINERALS = ['H', 'O', 'Z', 'K', 'U', 'L', 'X'];
const NON_SELLABLE = new Set([...BASE_MINERALS, RESOURCE_GHODIUM, RESOURCE_ENERGY]);
const SEND_STALL_TIMEOUT = 1500;
const orderBookCache = {};
const ORDER_BOOK_CACHE_TTL = 15;
function getMarketOrders(resource, filter) {
    let hit = orderBookCache[resource];
    if (!hit || Game.time - hit.tick >= ORDER_BOOK_CACHE_TTL) {
        hit = { tick: Game.time, orders: Game.market.getAllOrders({ resourceType: resource }) };
        orderBookCache[resource] = hit;
    }
    return hit.orders.filter(filter);
}
const historyAvgCache = {};
let historyAvgCacheTick = -Infinity;
const HISTORY_CACHE_TTL = 100;
function getMarketHistoryAvg(resource) {
    if (Game.time - historyAvgCacheTick >= HISTORY_CACHE_TTL) {
        for (const k in historyAvgCache)
            delete historyAvgCache[k];
        historyAvgCacheTick = Game.time;
    }
    if (resource in historyAvgCache)
        return historyAvgCache[resource];
    const history = Game.market.getHistory(resource);
    const avg = history.length > 0 ? history[history.length - 1].avgPrice : undefined;
    historyAvgCache[resource] = avg;
    return avg;
}
function loop$j() {
    var _a;
    if (Game.time % NETWORK_CONFIG.PLAN_INTERVAL === 0) {
        planNetworkBalancing();
    }
    for (const roomName in Game.rooms) {
        const room = Game.rooms[roomName];
        if (!((_a = room.controller) === null || _a === void 0 ? void 0 : _a.my))
            continue;
        try {
            processTerminal(room);
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.log(`[Terminal] Error in ${room.name}: ${msg}`);
        }
    }
}
function processTerminal(room) {
    var _a, _b, _c, _d, _e, _f, _g;
    const terminalId = room.memory.terminalId;
    if (!terminalId)
        return;
    const terminal = Game.getObjectById(terminalId);
    if (!terminal) {
        room.memory.terminalId = undefined;
        return;
    }
    if (terminal.cooldown > 0)
        return;
    if (executePendingSend(room, terminal))
        return;
    if (terminal.store[RESOURCE_ENERGY] < TERMINAL_CONFIG.MIN_TERMINAL_ENERGY)
        return;
    if (!Game.market)
        return;
    const mineralId = room.memory.mineralId;
    const mineral = mineralId ? Game.getObjectById(mineralId) : null;
    if (mineralId && !mineral)
        room.memory.mineralId = undefined;
    if (mineral) {
        const mineralType = mineral.mineralType;
        const sellable = sellableMineral(room, terminal, mineralType);
        if (sellable >= TERMINAL_CONFIG.MINERAL_SELL_THRESHOLD) {
            if (attemptMineralSale(room, terminal, mineralType, sellable))
                return;
        }
    }
    if ((_b = (_a = room.memory.labSystem) === null || _a === void 0 ? void 0 : _a.inputLabIds) === null || _b === void 0 ? void 0 : _b.length) {
        if (Game.time >= ((_c = room.memory.nextMarketBuyTick) !== null && _c !== void 0 ? _c : 0)) {
            const bought = buyMissingMinerals(room, terminal);
            room.memory.nextMarketBuyTick =
                Game.time + (bought ? BUY_CONFIG.RETRY_AFTER_DEAL : BUY_CONFIG.INTERVAL);
            if (bought)
                return;
        }
    }
    const lastGBuy = (_d = room.memory.lastGhodiumBuyTick) !== null && _d !== void 0 ? _d : 0;
    if (Game.time - lastGBuy >= GHODIUM_CONFIG.INTERVAL) {
        if (buyMissingGhodium(room, terminal)) {
            room.memory.lastGhodiumBuyTick = Game.time;
            return;
        }
    }
    const lastCommoditySale = (_e = room.memory.lastCommoditySaleTick) !== null && _e !== void 0 ? _e : 0;
    if (Game.time - lastCommoditySale >= COMMODITY_SALE_INTERVAL) {
        room.memory.lastCommoditySaleTick = Game.time;
        if (attemptCommoditySale(room, terminal))
            return;
        if (attemptRawSale(room, terminal))
            return;
    }
    const lastEnergyTrade = (_f = room.memory.lastEnergyTradeTick) !== null && _f !== void 0 ? _f : 0;
    if (Game.time - lastEnergyTrade >= ENERGY_TRADE_CONFIG.INTERVAL) {
        if (tradeEnergy(room, terminal)) {
            room.memory.lastEnergyTradeTick = Game.time;
            return;
        }
    }
    const lastOrderManage = (_g = room.memory.lastOrderManageTick) !== null && _g !== void 0 ? _g : 0;
    if (Game.time - lastOrderManage >= MARKET_MAKER_CONFIG.MANAGE_INTERVAL) {
        manageSellOrders(room, terminal);
        room.memory.lastOrderManageTick = Game.time;
    }
}
function sellableMineral(room, terminal, mineralType) {
    var _a, _b, _c, _d;
    const inTerminal = (_a = terminal.store.getUsedCapacity(mineralType)) !== null && _a !== void 0 ? _a : 0;
    const pending = room.memory.pendingSend;
    const reserved = (pending === null || pending === void 0 ? void 0 : pending.resource) === mineralType ? pending.loadTarget : 0;
    const total = ((_c = (_b = room.storage) === null || _b === void 0 ? void 0 : _b.store.getUsedCapacity(mineralType)) !== null && _c !== void 0 ? _c : 0) + inTerminal;
    const keep = Math.max(MINERAL_LAB_RESERVE, (_d = labMineralNeed(room).get(mineralType)) !== null && _d !== void 0 ? _d : 0);
    return Math.max(0, Math.min(inTerminal - reserved, total - keep));
}
function terminalStockJob(room) {
    var _a, _b, _c, _d;
    const storage = room.storage;
    const terminal = room.terminal;
    if (!storage || !terminal || terminal.store.getFreeCapacity() <= 0)
        return null;
    const pending = room.memory.pendingSend;
    if (pending && pending.resource !== RESOURCE_ENERGY) {
        const rc = pending.resource;
        const amount = Math.min(pending.loadTarget - ((_a = terminal.store.getUsedCapacity(rc)) !== null && _a !== void 0 ? _a : 0), (_b = storage.store.getUsedCapacity(rc)) !== null && _b !== void 0 ? _b : 0);
        if (amount > 0)
            return { resource: rc, amount };
    }
    for (const { resource, keep } of saleStock(room)) {
        const inTerminal = (_c = terminal.store.getUsedCapacity(resource)) !== null && _c !== void 0 ? _c : 0;
        const inStorage = (_d = storage.store.getUsedCapacity(resource)) !== null && _d !== void 0 ? _d : 0;
        const staged = Math.min(MINERAL_TERMINAL_CAP, inStorage + inTerminal - keep);
        const amount = Math.min(staged - inTerminal, inStorage);
        if (amount >= TERMINAL_CONFIG.MINERAL_SELL_THRESHOLD)
            return { resource, amount };
    }
    return null;
}
const DEPOSIT_KEEP = 5000;
const POWER_KEEP = 10000;
function saleStock(room) {
    var _a, _b;
    const out = [];
    const mineralId = room.memory.mineralId;
    const mineral = mineralId ? Game.getObjectById(mineralId) : null;
    if (mineral) {
        const rc = mineral.mineralType;
        out.push({ resource: rc, keep: Math.max(MINERAL_LAB_RESERVE, (_a = labMineralNeed(room).get(rc)) !== null && _a !== void 0 ? _a : 0) });
    }
    const depositKeep = ((_b = room.memory.factorySystem) === null || _b === void 0 ? void 0 : _b.factoryId) ? DEPOSIT_KEEP : 0;
    for (const rc of [RESOURCE_SILICON, RESOURCE_METAL, RESOURCE_BIOMASS, RESOURCE_MIST]) {
        out.push({ resource: rc, keep: depositKeep });
    }
    out.push({ resource: RESOURCE_POWER, keep: room.memory.powerSpawnId ? POWER_KEEP : 0 });
    return out;
}
function sellableRaw(room, terminal, resource, keep) {
    var _a, _b, _c;
    const inTerminal = (_a = terminal.store.getUsedCapacity(resource)) !== null && _a !== void 0 ? _a : 0;
    const total = ((_c = (_b = room.storage) === null || _b === void 0 ? void 0 : _b.store.getUsedCapacity(resource)) !== null && _c !== void 0 ? _c : 0) + inTerminal;
    return Math.max(0, Math.min(inTerminal, total - keep));
}
function attemptRawSale(room, terminal) {
    for (const { resource, keep } of saleStock(room)) {
        if (BASE_MINERALS.includes(resource))
            continue;
        const sellable = sellableRaw(room, terminal, resource, keep);
        if (sellable < TERMINAL_CONFIG.MINERAL_SELL_THRESHOLD)
            continue;
        if (sellResourceToMarket(room, terminal, resource, sellable, TERMINAL_CONFIG.MINERAL_MAX_TRADE_AMOUNT, TERMINAL_CONFIG.COMMODITY_MIN_PRICE_RATIO)) {
            return true;
        }
    }
    return false;
}
function ghodiumTarget(room) {
    var _a, _b;
    let target = 0;
    if ((_b = (_a = room.memory.labSystem) === null || _a === void 0 ? void 0 : _a.inputLabIds) === null || _b === void 0 ? void 0 : _b.length)
        target += BUY_CONFIG.TARGET_STOCK;
    if (roomHasNuker(room))
        target += NUKER_GHODIUM_RESERVE;
    return target;
}
function roomHasNuker(room) {
    const ns = room.memory.nukerSystem;
    if ((ns === null || ns === void 0 ? void 0 : ns.nukerId) && Game.getObjectById(ns.nukerId))
        return true;
    return (room.find(FIND_MY_STRUCTURES, {
        filter: (s) => s.structureType === STRUCTURE_NUKER,
    }).length > 0);
}
function ghodiumStock(room) {
    var _a, _b, _c, _d;
    return (((_b = (_a = room.storage) === null || _a === void 0 ? void 0 : _a.store.getUsedCapacity(RESOURCE_GHODIUM)) !== null && _b !== void 0 ? _b : 0) +
        ((_d = (_c = room.terminal) === null || _c === void 0 ? void 0 : _c.store.getUsedCapacity(RESOURCE_GHODIUM)) !== null && _d !== void 0 ? _d : 0));
}
function buyMissingGhodium(room, terminal) {
    const target = ghodiumTarget(room);
    if (target <= 0)
        return false;
    const stock = ghodiumStock(room);
    if (stock >= target)
        return false;
    const needed = target - stock;
    const orders = getMarketOrders(RESOURCE_GHODIUM, (o) => o.type === ORDER_SELL &&
        o.resourceType === RESOURCE_GHODIUM &&
        o.price <= GHODIUM_CONFIG.MAX_PRICE &&
        !!o.roomName &&
        energyCostPerUnit(Math.min(needed, o.amount, GHODIUM_CONFIG.MAX_AMOUNT), room.name, o.roomName) <=
            BUY_CONFIG.MAX_ENERGY_COST_RATIO);
    if (orders.length === 0)
        return false;
    orders.sort((a, b) => a.price - b.price);
    const best = orders[0];
    const amount = affordableTradeAmount(terminal, room.name, best.roomName, Math.min(needed, best.amount, GHODIUM_CONFIG.MAX_AMOUNT));
    if (amount <= 0)
        return false;
    const result = Game.market.deal(best.id, amount, room.name);
    if (result === OK) {
        console.log(`[Terminal] ${room.name}: Bought ${amount} G @ ${best.price.toFixed(2)} for nuker reserve (stock was ${stock}/${target})`);
        return true;
    }
    return false;
}
function executePendingSend(room, terminal) {
    var _a, _b;
    const pending = room.memory.pendingSend;
    if (!pending)
        return false;
    if (pending.queuedAt === undefined) {
        pending.queuedAt = Game.time;
    }
    else if (Game.time - pending.queuedAt > SEND_STALL_TIMEOUT) {
        console.log(`[Network] Abandoning stuck send in ${room.name} (${pending.amount} ${pending.resource} -> ${pending.to})`);
        delete room.memory.pendingSend;
        return false;
    }
    if (terminal.cooldown > 0)
        return false;
    const rc = pending.resource;
    const inTerminal = (_a = terminal.store.getUsedCapacity(rc)) !== null && _a !== void 0 ? _a : 0;
    if (inTerminal < pending.loadTarget)
        return false;
    if (rc !== RESOURCE_ENERGY) {
        const dist = Game.map.getRoomLinearDistance(room.name, pending.to);
        const fee = Math.ceil(pending.amount * (1 - Math.exp(-dist / 30)));
        if (((_b = terminal.store[RESOURCE_ENERGY]) !== null && _b !== void 0 ? _b : 0) < fee + 100)
            return false;
    }
    const result = terminal.send(rc, pending.amount, pending.to);
    if (result === OK) {
        console.log(`[Network] ${room.name} -> ${pending.to}: ${pending.amount} ${pending.resource}`);
        delete room.memory.pendingSend;
        return true;
    }
    else if (result !== ERR_TIRED && result !== ERR_NOT_ENOUGH_RESOURCES) {
        console.log(`[Network] Send failed (${result}), clearing pending send in ${room.name}`);
        delete room.memory.pendingSend;
    }
    return false;
}
function planNetworkBalancing() {
    var _a, _b, _c;
    const infos = [];
    for (const roomName in Game.rooms) {
        const room = Game.rooms[roomName];
        if (!((_a = room.controller) === null || _a === void 0 ? void 0 : _a.my) || !room.terminal)
            continue;
        infos.push({
            room,
            terminal: room.terminal,
            storageEnergy: (_c = (_b = room.storage) === null || _b === void 0 ? void 0 : _b.store[RESOURCE_ENERGY]) !== null && _c !== void 0 ? _c : 0,
        });
    }
    if (infos.length < 2)
        return;
    planEnergyTransfers(infos);
    planMineralTransfers(infos);
    planGhodiumTransfers(infos);
}
function planEnergyTransfers(infos) {
    const gclScale = Math.min(2, 1 + (Game.gcl.level - 1) * 0.1);
    const richThreshold = NETWORK_CONFIG.ENERGY_RICH_THRESHOLD * gclScale;
    const poorThreshold = NETWORK_CONFIG.ENERGY_POOR_THRESHOLD / gclScale;
    const receivers = infos
        .filter((i) => !i.room.memory.pendingSend && i.storageEnergy < poorThreshold)
        .sort((a, b) => a.storageEnergy - b.storageEnergy);
    const donors = infos
        .filter((i) => !i.room.memory.pendingSend && i.storageEnergy > richThreshold)
        .sort((a, b) => b.storageEnergy - a.storageEnergy);
    let queued = 0;
    for (const receiver of receivers) {
        if (queued >= NETWORK_CONFIG.ENERGY_MAX_TRANSFERS_PER_PASS)
            break;
        if (donors.length === 0)
            break;
        const donor = donors.find((d) => {
            if (d.room.name === receiver.room.name)
                return false;
            return Game.map.getRoomLinearDistance(d.room.name, receiver.room.name) <= NETWORK_CONFIG.MAX_DISTANCE;
        });
        if (!donor)
            continue;
        const dist = Game.map.getRoomLinearDistance(donor.room.name, receiver.room.name);
        const amount = NETWORK_CONFIG.ENERGY_TRANSFER_AMOUNT;
        const fee = Math.ceil(amount * (1 - Math.exp(-dist / 30)));
        const loadTarget = amount + fee;
        donor.room.memory.pendingSend = { resource: RESOURCE_ENERGY, amount, loadTarget, to: receiver.room.name };
        console.log(`[Network] Planned: ${amount} energy ${donor.room.name}->${receiver.room.name} (fee ~${fee})`);
        donors.splice(donors.indexOf(donor), 1);
        queued++;
    }
}
function planMineralTransfers(infos) {
    var _a, _b;
    for (const receiver of infos) {
        if (receiver.room.memory.pendingSend)
            continue;
        if (!((_b = (_a = receiver.room.memory.labSystem) === null || _a === void 0 ? void 0 : _a.inputLabIds) === null || _b === void 0 ? void 0 : _b.length))
            continue;
        for (const [mineral, missing] of labMineralShortfall(receiver.room)) {
            if (missing < BUY_CONFIG.MIN_AMOUNT)
                continue;
            const amount = Math.min(missing, NETWORK_CONFIG.MINERAL_TRANSFER_AMOUNT);
            const donor = findMineralDonor(receiver.room, mineral, amount);
            if (!donor)
                continue;
            donor.memory.pendingSend = { resource: mineral, amount, loadTarget: amount, to: receiver.room.name };
            console.log(`[Network] Planned: ${amount} ${mineral} ${donor.name}->${receiver.room.name}`);
            break;
        }
    }
}
function findMineralDonor(receiver, mineral, amount) {
    var _a, _b, _c, _d, _e;
    for (const name in Game.rooms) {
        const donor = Game.rooms[name];
        if (donor.name === receiver.name || !((_a = donor.controller) === null || _a === void 0 ? void 0 : _a.my) || !donor.terminal)
            continue;
        if (donor.memory.pendingSend)
            continue;
        if (Game.map.getRoomLinearDistance(donor.name, receiver.name) > NETWORK_CONFIG.MAX_DISTANCE)
            continue;
        const stock = ((_c = (_b = donor.storage) === null || _b === void 0 ? void 0 : _b.store.getUsedCapacity(mineral)) !== null && _c !== void 0 ? _c : 0) +
            ((_d = donor.terminal.store.getUsedCapacity(mineral)) !== null && _d !== void 0 ? _d : 0);
        const ownNeed = (_e = labMineralNeed(donor).get(mineral)) !== null && _e !== void 0 ? _e : 0;
        if (stock - ownNeed - NETWORK_CONFIG.MINERAL_SURPLUS_THRESHOLD >= amount)
            return donor;
    }
    return undefined;
}
function planGhodiumTransfers(infos) {
    for (const receiver of infos) {
        if (receiver.room.memory.pendingSend)
            continue;
        const target = ghodiumTarget(receiver.room);
        if (target <= 0)
            continue;
        const receiverStock = ghodiumStock(receiver.room);
        if (receiverStock >= target)
            continue;
        const amount = Math.min(target - receiverStock, GHODIUM_CONFIG.TRANSFER_AMOUNT);
        if (amount <= 0)
            continue;
        const donor = infos.find((d) => {
            if (d.room.name === receiver.room.name || d.room.memory.pendingSend)
                return false;
            const dist = Game.map.getRoomLinearDistance(d.room.name, receiver.room.name);
            if (dist > NETWORK_CONFIG.MAX_DISTANCE)
                return false;
            const surplus = ghodiumStock(d.room) - ghodiumTarget(d.room);
            return surplus >= amount;
        });
        if (!donor)
            continue;
        donor.room.memory.pendingSend = {
            resource: RESOURCE_GHODIUM,
            amount,
            loadTarget: amount,
            to: receiver.room.name,
        };
        console.log(`[Network] Planned: ${amount} G ${donor.room.name}->${receiver.room.name} (nuker reserve)`);
        break;
    }
}
function affordableTradeAmount(terminal, fromRoom, toRoom, want) {
    var _a;
    if (want <= 0)
        return 0;
    const spare = ((_a = terminal.store[RESOURCE_ENERGY]) !== null && _a !== void 0 ? _a : 0) - TERMINAL_CONFIG.MIN_TERMINAL_ENERGY;
    if (spare <= 0)
        return 0;
    const cost = Game.market.calcTransactionCost(want, fromRoom, toRoom);
    if (cost <= spare)
        return want;
    return Math.floor((want * spare) / cost);
}
function attemptMineralSale(room, terminal, mineralType, availableAmount) {
    if (terminal.cooldown > 0)
        return false;
    return sellResourceToMarket(room, terminal, mineralType, availableAmount, TERMINAL_CONFIG.MINERAL_MAX_TRADE_AMOUNT, TERMINAL_CONFIG.MIN_PRICE_RATIO);
}
function energyUnitValue() {
    var _a;
    return (_a = getMarketHistoryAvg(RESOURCE_ENERGY)) !== null && _a !== void 0 ? _a : ENERGY_TRADE_CONFIG.SELL_MIN_PRICE;
}
function energyCostPerUnit(amount, fromRoom, toRoom) {
    if (amount <= 0)
        return 0;
    return Game.market.calcTransactionCost(amount, fromRoom, toRoom) / amount;
}
function sellResourceToMarket(room, terminal, resource, availableAmount, maxTradeAmount, minPriceRatio) {
    const avgPrice = getMarketHistoryAvg(resource);
    if (avgPrice === undefined)
        return false;
    const recentAvg = recentAvgPrice(resource);
    let floor = avgPrice * minPriceRatio;
    if (recentAvg !== undefined) {
        floor = Math.max(floor, recentAvg * minPriceRatio);
    }
    const energyValue = energyUnitValue();
    let bestNet = floor;
    let bestPrice = 0;
    let bestOrderId = null;
    let bestOrderRoom = "";
    let bestOrderAmount = 0;
    const orders = getMarketOrders(resource, (order) => {
        if (order.type !== ORDER_BUY || order.resourceType !== resource)
            return false;
        if (!order.roomName || order.amount <= 0)
            return false;
        return (Game.map.getRoomLinearDistance(room.name, order.roomName) <
            TERMINAL_CONFIG.MAX_TRADE_DISTANCE);
    });
    for (const order of orders) {
        const lot = Math.min(availableAmount, order.amount, maxTradeAmount);
        const net = order.price - energyCostPerUnit(lot, room.name, order.roomName) * energyValue;
        if (net >= bestNet && (bestOrderId === null || net > bestNet)) {
            bestNet = net;
            bestPrice = order.price;
            bestOrderId = order.id;
            bestOrderRoom = order.roomName;
            bestOrderAmount = order.amount;
        }
    }
    if (!bestOrderId)
        return false;
    const tradeAmount = affordableTradeAmount(terminal, room.name, bestOrderRoom, Math.min(availableAmount, bestOrderAmount, maxTradeAmount));
    if (tradeAmount <= 0)
        return false;
    const result = Game.market.deal(bestOrderId, tradeAmount, room.name);
    if (result === OK) {
        recordPrice(resource, bestPrice);
        console.log(`[Terminal] ${room.name}: Sold ${tradeAmount} ${resource} @ ${bestPrice.toFixed(2)}`);
        return true;
    }
    if (result !== ERR_NOT_ENOUGH_RESOURCES && result !== ERR_FULL) {
        console.log(`[Terminal] Market deal failed: ${result} for ${resource}`);
    }
    return false;
}
function recordPrice(resource, price) {
    var _a;
    var _b;
    if (!(price > 0))
        return;
    if (!Memory.marketPrices)
        Memory.marketPrices = {};
    const arr = ((_a = (_b = Memory.marketPrices)[resource]) !== null && _a !== void 0 ? _a : (_b[resource] = []));
    arr.push(Math.round(price * 1000) / 1000);
    while (arr.length > PRICE_HISTORY_LEN)
        arr.shift();
}
function recentAvgPrice(resource) {
    var _a;
    const arr = (_a = Memory.marketPrices) === null || _a === void 0 ? void 0 : _a[resource];
    if (!arr || arr.length === 0)
        return undefined;
    let sum = 0;
    for (const p of arr)
        sum += p;
    return sum / arr.length;
}
const COMMODITY_SELL_MIN_LOT = 100;
const COMMODITY_MAX_TRADE = 5000;
const COMMODITY_SALE_INTERVAL = 20;
function attemptCommoditySale(room, terminal) {
    var _a;
    if (terminal.cooldown > 0)
        return false;
    for (const c of MANAGED_COMMODITIES) {
        const rc = c;
        if (feedsLocalRecipe(room, rc))
            continue;
        const amount = (_a = terminal.store.getUsedCapacity(rc)) !== null && _a !== void 0 ? _a : 0;
        if (amount < COMMODITY_SELL_MIN_LOT)
            continue;
        if (sellResourceToMarket(room, terminal, rc, amount, COMMODITY_MAX_TRADE, TERMINAL_CONFIG.COMMODITY_MIN_PRICE_RATIO)) {
            return true;
        }
    }
    return false;
}
function feedsLocalRecipe(room, resource) {
    var _a, _b, _c;
    const factoryId = (_a = room.memory.factorySystem) === null || _a === void 0 ? void 0 : _a.factoryId;
    const factory = factoryId ? Game.getObjectById(factoryId) : null;
    if (!factory)
        return false;
    const level = (_b = factory.level) !== null && _b !== void 0 ? _b : 0;
    for (const c of MANAGED_COMMODITIES) {
        const def = COMMODITIES[c];
        if (!def)
            continue;
        if (def.level !== undefined && def.level !== level)
            continue;
        if (((_c = def.components[resource]) !== null && _c !== void 0 ? _c : 0) > 0)
            return true;
    }
    return false;
}
function buyMissingMinerals(room, terminal) {
    var _a;
    const shortfall = labMineralShortfall(room);
    for (const mineral of BASE_MINERALS) {
        const needed = (_a = shortfall.get(mineral)) !== null && _a !== void 0 ? _a : 0;
        if (needed < BUY_CONFIG.MIN_AMOUNT)
            continue;
        if (findMineralDonor(room, mineral, Math.min(needed, NETWORK_CONFIG.MINERAL_TRANSFER_AMOUNT)))
            continue;
        const avg = getMarketHistoryAvg(mineral);
        if (avg === undefined)
            continue;
        const maxPrice = avg * BUY_CONFIG.MAX_PRICE_RATIO;
        const orders = getMarketOrders(mineral, (o) => o.type === ORDER_SELL &&
            o.resourceType === mineral &&
            !!o.roomName &&
            o.amount > 0 &&
            o.price <= maxPrice);
        const lot = (o) => Math.min(needed, o.amount, BUY_CONFIG.MAX_AMOUNT);
        const viable = orders.filter((o) => energyCostPerUnit(lot(o), room.name, o.roomName) <= BUY_CONFIG.MAX_ENERGY_COST_RATIO);
        if (viable.length === 0)
            continue;
        viable.sort((a, b) => a.price - b.price);
        const best = viable[0];
        const amount = affordableTradeAmount(terminal, room.name, best.roomName, lot(best));
        if (amount <= 0)
            continue;
        const result = Game.market.deal(best.id, amount, room.name);
        if (result === OK) {
            console.log(`[Terminal] ${room.name}: Bought ${amount} ${mineral} @ ${best.price.toFixed(2)} for labs (short ${needed})`);
            return true;
        }
    }
    return false;
}
function tradeEnergy(room, terminal) {
    var _a, _b, _c;
    if (terminal.cooldown > 0)
        return false;
    const storageEnergy = (_b = (_a = room.storage) === null || _a === void 0 ? void 0 : _a.store[RESOURCE_ENERGY]) !== null && _b !== void 0 ? _b : 0;
    if (room.memory.pendingSend)
        return false;
    if (storageEnergy > ENERGY_TRADE_CONFIG.SELL_STORAGE_THRESHOLD) {
        const surplus = storageEnergy - ENERGY_TRADE_CONFIG.SELL_KEEP;
        const inTerminal = (_c = terminal.store.getUsedCapacity(RESOURCE_ENERGY)) !== null && _c !== void 0 ? _c : 0;
        const sellable = Math.min(surplus, inTerminal - TERMINAL_CONFIG.MIN_TERMINAL_ENERGY, ENERGY_TRADE_CONFIG.SELL_MAX_AMOUNT);
        if (sellable >= 1000) {
            if (sellEnergyToMarket(room, terminal, sellable))
                return true;
        }
    }
    if (storageEnergy < ENERGY_TRADE_CONFIG.BUY_STORAGE_THRESHOLD &&
        Game.market.credits > ENERGY_TRADE_CONFIG.MIN_CREDITS_TO_BUY) {
        if (buyCheapEnergy(room, terminal))
            return true;
    }
    return false;
}
function sellEnergyToMarket(room, terminal, amount) {
    let best = null;
    const orders = getMarketOrders(RESOURCE_ENERGY, (o) => {
        if (o.type !== ORDER_BUY || o.resourceType !== RESOURCE_ENERGY)
            return false;
        if (!o.roomName || o.amount <= 0)
            return false;
        if (o.price < ENERGY_TRADE_CONFIG.SELL_MIN_PRICE)
            return false;
        return (Game.map.getRoomLinearDistance(room.name, o.roomName) < TERMINAL_CONFIG.MAX_TRADE_DISTANCE);
    });
    const energyValue = energyUnitValue();
    const net = (o) => o.price - energyCostPerUnit(Math.min(amount, o.amount), room.name, o.roomName) * energyValue;
    let bestNet = ENERGY_TRADE_CONFIG.SELL_MIN_PRICE;
    for (const o of orders) {
        const n = net(o);
        if (n >= bestNet && (!best || n > bestNet)) {
            best = o;
            bestNet = n;
        }
    }
    if (!best || !best.roomName)
        return false;
    const want = Math.min(amount, best.amount);
    const dealAmount = affordableTradeAmount(terminal, room.name, best.roomName, want);
    if (dealAmount < 1000)
        return false;
    const result = Game.market.deal(best.id, dealAmount, room.name);
    if (result === OK) {
        recordPrice(RESOURCE_ENERGY, best.price);
        console.log(`[Terminal] ${room.name}: Sold ${dealAmount} surplus energy @ ${best.price.toFixed(2)}`);
        return true;
    }
    return false;
}
function buyCheapEnergy(room, terminal) {
    const orders = getMarketOrders(RESOURCE_ENERGY, (o) => {
        if (o.type !== ORDER_SELL || o.resourceType !== RESOURCE_ENERGY)
            return false;
        if (!o.roomName || o.amount <= 0)
            return false;
        if (o.price > ENERGY_TRADE_CONFIG.BUY_MAX_PRICE)
            return false;
        if (Game.map.getRoomLinearDistance(room.name, o.roomName) >= TERMINAL_CONFIG.MAX_TRADE_DISTANCE) {
            return false;
        }
        const ratio = energyCostPerUnit(Math.min(o.amount, ENERGY_TRADE_CONFIG.BUY_MAX_AMOUNT), room.name, o.roomName);
        return ratio < 1 && o.price / (1 - ratio) <= ENERGY_TRADE_CONFIG.BUY_MAX_PRICE;
    });
    if (orders.length === 0)
        return false;
    orders.sort((a, b) => a.price - b.price);
    const best = orders[0];
    const want = Math.min(best.amount, ENERGY_TRADE_CONFIG.BUY_MAX_AMOUNT);
    const amount = affordableTradeAmount(terminal, room.name, best.roomName, want);
    if (amount < 1000)
        return false;
    const result = Game.market.deal(best.id, amount, room.name);
    if (result === OK) {
        console.log(`[Terminal] ${room.name}: Bought ${amount} energy @ ${best.price.toFixed(2)} (room low)`);
        return true;
    }
    return false;
}
function manageSellOrders(room, terminal) {
    var _a;
    if (Game.market.credits < MARKET_MAKER_CONFIG.MIN_CREDITS_TO_POST)
        return;
    const myOrders = Object.values(Game.market.orders);
    const mySellCount = myOrders.filter((o) => o.type === ORDER_SELL).length;
    const candidates = new Set();
    const mineralId = room.memory.mineralId;
    const mineral = mineralId ? Game.getObjectById(mineralId) : null;
    if (mineral)
        candidates.add(mineral.mineralType);
    for (const c of MANAGED_COMMODITIES) {
        const rc = c;
        if (!NON_SELLABLE.has(rc) && !feedsLocalRecipe(room, rc))
            candidates.add(rc);
    }
    for (const resource of candidates) {
        const surplus = mineral && resource === mineral.mineralType
            ? sellableMineral(room, terminal, mineral.mineralType)
            : (_a = terminal.store.getUsedCapacity(resource)) !== null && _a !== void 0 ? _a : 0;
        if (surplus < MARKET_MAKER_CONFIG.MIN_SELL_SURPLUS)
            continue;
        const fair = fairSellPrice(resource);
        if (fair === undefined)
            continue;
        const existing = myOrders.find((o) => o.type === ORDER_SELL && o.resourceType === resource && o.roomName === room.name);
        if (existing) {
            reconcileOrder(room, terminal, existing, resource, surplus, fair);
            continue;
        }
        if (mySellCount >= MARKET_MAKER_CONFIG.MAX_ACTIVE_ORDERS)
            continue;
        const lot = Math.min(surplus, MARKET_MAKER_CONFIG.ORDER_LOT);
        const fee = fair * lot * 0.05;
        if (Game.market.credits < MARKET_MAKER_CONFIG.MIN_CREDITS_TO_POST + fee)
            continue;
        const result = Game.market.createOrder({
            type: ORDER_SELL,
            resourceType: resource,
            price: fair,
            totalAmount: lot,
            roomName: room.name,
        });
        if (result === OK) {
            console.log(`[Terminal] ${room.name}: Posted sell order ${lot} ${resource} @ ${fair.toFixed(3)}`);
        }
        return;
    }
}
function fairSellPrice(resource) {
    const floorAvg = recentAvgPrice(resource);
    const histAvg = getMarketHistoryAvg(resource);
    let bestAsk;
    const asks = getMarketOrders(resource, (o) => o.type === ORDER_SELL &&
        o.resourceType === resource &&
        o.amount > 0 &&
        !(o.id in Game.market.orders));
    for (const o of asks) {
        if (bestAsk === undefined || o.price < bestAsk)
            bestAsk = o.price;
    }
    let price = bestAsk !== undefined ? bestAsk - MARKET_MAKER_CONFIG.UNDERCUT : histAvg;
    if (price === undefined || price <= 0)
        return undefined;
    if (floorAvg !== undefined) {
        price = Math.max(price, floorAvg * MARKET_MAKER_CONFIG.PRICE_FLOOR_RATIO);
    }
    return Math.round(price * 1000) / 1000;
}
function reconcileOrder(room, terminal, order, resource, surplus, fair) {
    const drift = Math.abs(order.price - fair) / fair;
    if (drift > MARKET_MAKER_CONFIG.REPRICE_TOLERANCE) {
        Game.market.cancelOrder(order.id);
        console.log(`[Terminal] ${room.name}: Cancelled stale ${resource} order @ ${order.price.toFixed(3)} (fair ${fair.toFixed(3)})`);
        return;
    }
    if (order.remainingAmount < MARKET_MAKER_CONFIG.TOPUP_THRESHOLD) {
        const addBy = Math.min(surplus, MARKET_MAKER_CONFIG.ORDER_LOT - order.remainingAmount);
        if (addBy > 0) {
            const fee = fair * addBy * 0.05;
            if (Game.market.credits >= MARKET_MAKER_CONFIG.MIN_CREDITS_TO_POST + fee) {
                const result = Game.market.extendOrder(order.id, addBy);
                if (result === OK) {
                    console.log(`[Terminal] ${room.name}: Topped up ${resource} order by ${addBy}`);
                }
            }
        }
    }
}

const POWER_SPAWN_POWER_LOW = 50;
const POWER_SPAWN_ENERGY_STORAGE_FLOOR = 100000;
const TERMINAL_ENERGY_TARGET = 10000;
const TERMINAL_ENERGY_DRAIN_SLACK = 5000;
const TERMINAL_FILL_STORAGE_FLOOR = 20000;
function runFiller(creep) {
    var _a, _b;
    const storage = creep.room.storage;
    const underThreat = getThreatInfo(creep.room).hostiles.length > 0;
    const coreTarget = (_a = (underThreat ? findEmptiestTower(creep.room) : null)) !== null && _a !== void 0 ? _a : getCoreFillTarget(creep);
    if (carryingPower(creep)) {
        deliverPower(creep, storage);
        return;
    }
    const stockCarried = carriedStock(creep);
    if (stockCarried) {
        deliverStock(creep, stockCarried, storage);
        return;
    }
    const relay = coreTarget ? null : findRelayLink(creep.room);
    const terminalJob = coreTarget || relay ? null : getTerminalEnergyJob(creep.room, storage);
    const powerSpawn = coreTarget ? null : getPowerSpawn(creep.room);
    const target = (_b = coreTarget !== null && coreTarget !== void 0 ? coreTarget : ((terminalJob === null || terminalJob === void 0 ? void 0 : terminalJob.kind) === "fill" ? terminalJob.terminal : null)) !== null && _b !== void 0 ? _b : (!relay && !terminalJob && powerSpawn && powerSpawnWantsEnergy(powerSpawn, storage)
        ? powerSpawn
        : null);
    if (creep.store[RESOURCE_ENERGY] === 0) {
        if (powerSpawn && loadPower(creep, powerSpawn, storage))
            return;
        if (!target) {
            if (relay && storage && relay.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
                if (creep.withdraw(storage, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                    creep.moveTo(storage, { reusePath: 20 });
                }
                return;
            }
            if ((terminalJob === null || terminalJob === void 0 ? void 0 : terminalJob.kind) === "drain") {
                if (creep.withdraw(terminalJob.terminal, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                    creep.moveTo(terminalJob.terminal, { range: 1, reusePath: 20 });
                }
                return;
            }
            const stock = relay || !storage ? null : terminalStockJob(creep.room);
            if (stock && storage) {
                const amount = Math.min(creep.store.getFreeCapacity(), stock.amount);
                if (creep.withdraw(storage, stock.resource, amount) === ERR_NOT_IN_RANGE) {
                    creep.moveTo(storage, { range: 1, reusePath: 20 });
                }
                return;
            }
            if (!underThreat && collectLoot(creep))
                return;
            if (storage && !creep.pos.isNearTo(storage)) {
                creep.moveTo(storage, { range: 1, reusePath: 20 });
            }
            return;
        }
        if ((terminalJob === null || terminalJob === void 0 ? void 0 : terminalJob.kind) === "fill" && storage) {
            if (creep.withdraw(storage, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                creep.moveTo(storage, { range: 1, reusePath: 20 });
            }
            return;
        }
        const source = findFillerSource(creep, storage);
        if (source) {
            if (creep.withdraw(source, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                creep.moveTo(source, { reusePath: 10 });
            }
        }
        else if (storage && !creep.pos.isNearTo(storage)) {
            creep.moveTo(storage, { range: 1, reusePath: 20 });
        }
        return;
    }
    if (target) {
        if (creep.transfer(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
            creep.moveTo(target, { reusePath: 10 });
        }
        return;
    }
    if (relay && relay.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
        if (creep.transfer(relay, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
            creep.moveTo(relay, { reusePath: 20 });
        }
        return;
    }
    if (storage && storage.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
        if (creep.transfer(storage, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
            creep.moveTo(storage, { reusePath: 20 });
        }
    }
}
function getCoreFillTarget(creep) {
    var _a;
    const cachedId = creep.memory.fillTargetId;
    if (cachedId) {
        const cached = Game.getObjectById(cachedId);
        if (cached &&
            ((_a = cached.room) === null || _a === void 0 ? void 0 : _a.name) === creep.room.name &&
            cached.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
            return cached;
        }
        setFillTarget(creep, undefined);
    }
    const target = findCoreFillTarget(creep);
    if (target)
        setFillTarget(creep, target.id);
    return target;
}
function getTerminalEnergyJob(room, storage) {
    var _a, _b;
    const terminal = room.terminal;
    if (!terminal || !storage)
        return null;
    const pending = room.memory.pendingSend;
    const want = Math.max(TERMINAL_ENERGY_TARGET, (pending === null || pending === void 0 ? void 0 : pending.resource) === RESOURCE_ENERGY ? pending.loadTarget : 0);
    const have = (_a = terminal.store[RESOURCE_ENERGY]) !== null && _a !== void 0 ? _a : 0;
    if (have < want &&
        ((_b = storage.store[RESOURCE_ENERGY]) !== null && _b !== void 0 ? _b : 0) > TERMINAL_FILL_STORAGE_FLOOR &&
        terminal.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
        return { kind: "fill", terminal };
    }
    if (have > want + TERMINAL_ENERGY_DRAIN_SLACK && storage.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
        return { kind: "drain", terminal };
    }
    return null;
}
function getPowerSpawn(room) {
    const id = room.memory.powerSpawnId;
    return id ? Game.getObjectById(id) : null;
}
function powerSpawnWantsEnergy(ps, storage) {
    var _a;
    return (((_a = storage === null || storage === void 0 ? void 0 : storage.store[RESOURCE_ENERGY]) !== null && _a !== void 0 ? _a : 0) > POWER_SPAWN_ENERGY_STORAGE_FLOOR &&
        ps.store.getFreeCapacity(RESOURCE_ENERGY) > 0);
}
function carryingPower(creep) {
    var _a;
    return ((_a = creep.store[RESOURCE_POWER]) !== null && _a !== void 0 ? _a : 0) > 0;
}
function loadPower(creep, ps, storage) {
    var _a, _b;
    const inSpawn = (_a = ps.store[RESOURCE_POWER]) !== null && _a !== void 0 ? _a : 0;
    if (inSpawn >= POWER_SPAWN_POWER_LOW)
        return false;
    const source = [storage, creep.room.terminal].find((s) => { var _a; return !!s && ((_a = s.store[RESOURCE_POWER]) !== null && _a !== void 0 ? _a : 0) > 0; });
    if (!source)
        return false;
    const amount = Math.min(POWER_SPAWN_POWER_CAPACITY - inSpawn, (_b = source.store[RESOURCE_POWER]) !== null && _b !== void 0 ? _b : 0, creep.store.getFreeCapacity());
    if (amount <= 0)
        return false;
    if (creep.withdraw(source, RESOURCE_POWER, amount) === ERR_NOT_IN_RANGE) {
        creep.moveTo(source, { range: 1, reusePath: 20 });
    }
    return true;
}
function deliverPower(creep, storage) {
    const ps = getPowerSpawn(creep.room);
    const dest = [ps, creep.room.terminal, storage].find((s) => s && s.store.getFreeCapacity(RESOURCE_POWER) > 0);
    if (!dest) {
        creep.drop(RESOURCE_POWER);
        return;
    }
    if (creep.transfer(dest, RESOURCE_POWER) === ERR_NOT_IN_RANGE) {
        creep.moveTo(dest, { range: 1, reusePath: 20 });
    }
}
function collectLoot(creep) {
    const room = creep.room;
    if (![room.terminal, room.storage].some((s) => s && s.store.getFreeCapacity() > 0))
        return false;
    const looted = (store) => Object.keys(store).find((r) => r !== RESOURCE_ENERGY && typeof store[r] === "number" && store[r] > 0);
    const drop = creep.pos.findClosestByRange(FIND_DROPPED_RESOURCES, {
        filter: (d) => d.resourceType !== RESOURCE_ENERGY,
    });
    if (drop) {
        if (creep.pickup(drop) === ERR_NOT_IN_RANGE)
            creep.moveTo(drop, { range: 1, reusePath: 20 });
        return true;
    }
    const tomb = creep.pos.findClosestByRange(FIND_TOMBSTONES, { filter: (t) => !!looted(t.store) });
    const resource = tomb && looted(tomb.store);
    if (tomb && resource) {
        if (creep.withdraw(tomb, resource) === ERR_NOT_IN_RANGE)
            creep.moveTo(tomb, { range: 1, reusePath: 20 });
        return true;
    }
    return false;
}
function carriedStock(creep) {
    return Object.keys(creep.store).find((r) => r !== RESOURCE_ENERGY && r !== RESOURCE_POWER && typeof creep.store[r] === "number" && creep.store[r] > 0);
}
function deliverStock(creep, resource, storage) {
    const dest = [creep.room.terminal, storage].find((s) => s && s.store.getFreeCapacity(resource) > 0);
    if (!dest) {
        creep.drop(resource);
        return;
    }
    if (creep.transfer(dest, resource) === ERR_NOT_IN_RANGE) {
        creep.moveTo(dest, { range: 1, reusePath: 20 });
    }
}
function findFillerSource(creep, storage) {
    var _a;
    if (storage) {
        const link = getRoomStructures(creep.room).find((s) => s.structureType === STRUCTURE_LINK &&
            s.pos.inRangeTo(storage.pos, 2) &&
            s.store[RESOURCE_ENERGY] > 0);
        if (link)
            return link;
        if (storage.store[RESOURCE_ENERGY] > 0)
            return storage;
    }
    const upgradeId = creep.room.memory.upgradeContainerId;
    const containers = getRoomStructures(creep.room).filter((s) => s.structureType === STRUCTURE_CONTAINER &&
        s.id !== upgradeId &&
        s.store[RESOURCE_ENERGY] > 0);
    if (containers.length > 0) {
        return (_a = creep.pos.findClosestByPath(containers, { ignoreCreeps: true })) !== null && _a !== void 0 ? _a : null;
    }
    return null;
}

function runMineralMiner(creep) {
    var _a, _b;
    const mineralId = creep.room.memory.mineralId;
    if (!mineralId)
        return;
    const mineral = Game.getObjectById(mineralId);
    if (!mineral)
        return;
    const containerId = creep.room.memory.mineralContainerId;
    if (!containerId)
        return;
    const container = Game.getObjectById(containerId);
    if (!container)
        return;
    const depleted = mineral.mineralAmount === 0;
    const carrying = creep.store.getUsedCapacity() > 0;
    const harvestYield = creep.getActiveBodyparts(WORK) * HARVEST_MINERAL_POWER;
    const spilled = container.store.getUsedCapacity() > 0;
    if (creep.store.getFreeCapacity() < harvestYield ||
        (depleted && carrying && !spilled)) {
        const terminalId = creep.room.memory.terminalId;
        const terminal = terminalId
            ? Game.getObjectById(terminalId)
            : null;
        const storage = creep.room.storage;
        const mineralType = mineral.mineralType;
        const surplus = !!storage &&
            !!terminal &&
            ((_a = storage.store.getUsedCapacity(mineralType)) !== null && _a !== void 0 ? _a : 0) >= MINERAL_LAB_RESERVE &&
            ((_b = terminal.store.getUsedCapacity(mineralType)) !== null && _b !== void 0 ? _b : 0) < MINERAL_TERMINAL_CAP &&
            terminal.store.getFreeCapacity() > 0;
        const target = surplus
            ? terminal
            : storage && storage.store.getFreeCapacity() > 0
                ? storage
                : terminal && terminal.store.getFreeCapacity() > 0
                    ? terminal
                    : storage !== null && storage !== void 0 ? storage : terminal;
        if (!target)
            return;
        for (const resourceType in creep.store) {
            const amount = creep.store[resourceType];
            if (amount > 0) {
                const res = creep.transfer(target, resourceType);
                if (res === ERR_NOT_IN_RANGE)
                    creep.moveTo(target, { reusePath: 20 });
                break;
            }
        }
        return;
    }
    if (depleted && !spilled) {
        creep.suicide();
        return;
    }
    if (!creep.pos.isEqualTo(container.pos)) {
        creep.moveTo(container.pos, { reusePath: 50 });
        return;
    }
    const space = creep.store.getFreeCapacity() - (depleted ? 0 : harvestYield);
    if (spilled && space > 0) {
        for (const resourceType in container.store) {
            const amount = container.store[resourceType];
            if (amount > 0) {
                creep.withdraw(container, resourceType, Math.min(amount, space));
                break;
            }
        }
    }
    if (depleted)
        return;
    const result = creep.harvest(mineral);
    if (result === ERR_NOT_IN_RANGE) {
        creep.moveTo(mineral, { reusePath: 50 });
    }
}

const TOWER_REPAIR_ENERGY_THRESHOLD = 0.7;
const TOWER_DEFENSE_REPAIR_MIN_ENERGY = 400;
const TWR_POWER_ATTACK = 600;
const TWR_OPTIMAL_RANGE = 5;
const TWR_FALLOFF_RANGE = 20;
const TWR_FALLOFF = 0.75;
const HEAL_RANGE = 1;
const RANGED_HEAL_RANGE = 3;
const ENGAGE_RANGE = 3;
const HEAL_BOOST_MULT = { LO: 2, LHO2: 3, XLHO2: 4 };
const TOUGH_DAMAGE_MULT = { GO: 0.7, GHO2: 0.5, XGHO2: 0.3 };
function runTower(tower, attackTarget, hasHostiles) {
    var _a;
    if (tower.store[RESOURCE_ENERGY] === 0)
        return;
    if (attackTarget) {
        tower.attack(attackTarget);
        return;
    }
    if (hasHostiles) {
        const wounded = tower.room.find(FIND_MY_CREEPS, {
            filter: (c) => c.hits < c.hitsMax &&
                c.pos.x > 1 && c.pos.x < 48 && c.pos.y > 1 && c.pos.y < 48,
        });
        if (wounded.length > 0) {
            const target = tower.pos.findClosestByRange(wounded);
            if (target) {
                tower.heal(target);
                return;
            }
        }
    }
    if (hasHostiles && tower.store[RESOURCE_ENERGY] >= TOWER_DEFENSE_REPAIR_MIN_ENERGY) {
        const barrier = findTowerDefenseRepairTarget(tower.room);
        if (barrier) {
            tower.repair(barrier);
            return;
        }
    }
    if (!hasHostiles &&
        tower.store[RESOURCE_ENERGY] / ((_a = tower.store.getCapacity(RESOURCE_ENERGY)) !== null && _a !== void 0 ? _a : 1) >
            TOWER_REPAIR_ENERGY_THRESHOLD) {
        const repairTarget = findTowerRepairTarget(tower.room);
        if (repairTarget)
            tower.repair(repairTarget);
    }
}
function selectRoomAttackTarget(roomHostiles, room) {
    const hostiles = roomHostiles.filter((c) => inTowerReach(c, room));
    if (hostiles.length === 0) {
        if (room)
            delete room.memory.lastTowerTargetId;
        return null;
    }
    const towers = activeTowers(room);
    let best = hostiles[0];
    let bestScore = Infinity;
    for (const c of hostiles) {
        const score = targetScore(c, hostiles, towers);
        if (score < bestScore) {
            bestScore = score;
            best = c;
        }
    }
    if (room === null || room === void 0 ? void 0 : room.memory.lastTowerTargetId) {
        const prev = hostiles.find((c) => c.id === room.memory.lastTowerTargetId);
        if (prev &&
            isDamageable(prev, hostiles, towers) === isDamageable(best, hostiles, towers) &&
            hostileTier(prev) === hostileTier(best)) {
            best = prev;
        }
    }
    if (!isDamageable(best, hostiles, towers) && room) {
        const pressing = [best, ...hostiles.filter((c) => c !== best)].find((c) => shouldKeepFiring(room, c));
        if (!pressing) {
            delete room.memory.lastTowerTargetId;
            return null;
        }
        best = pressing;
    }
    if (room)
        room.memory.lastTowerTargetId = best.id;
    return best;
}
function inTowerReach(creep, room) {
    if (creep.pos.x > 1 && creep.pos.x < 48 && creep.pos.y > 1 && creep.pos.y < 48)
        return true;
    return !!room && shouldKeepFiring(room, creep);
}
function shouldKeepFiring(room, target) {
    const engaged = room
        .find(FIND_MY_CREEPS)
        .some((c) => c.pos.getRangeTo(target) <= ENGAGE_RANGE &&
        c.body.some((p) => (p.type === ATTACK || p.type === RANGED_ATTACK) && p.hits > 0));
    if (engaged)
        return true;
    const active = (type) => target.body.some((p) => p.type === type && p.hits > 0);
    if (active(WORK) || active(ATTACK)) {
        if (target.pos.findInRange(FIND_STRUCTURES, 1).some(isOurs))
            return true;
    }
    if (active(RANGED_ATTACK)) {
        if (target.pos.findInRange(FIND_STRUCTURES, 3).some(isOurs))
            return true;
    }
    return false;
}
function isOurs(s) {
    if (s.structureType === STRUCTURE_WALL)
        return true;
    return "my" in s && s.my;
}
function towersCanHold(room, hostiles) {
    const towers = activeTowers(room);
    if (towers.length === 0)
        return false;
    const groupHeal = summarizeHostiles(hostiles).heal;
    let ticks = 0;
    for (const c of hostiles) {
        if (!inTowerReach(c, room))
            continue;
        const net = effectiveTowerDamage(c, towers) - groupHeal;
        if (net <= 0)
            return false;
        ticks += Math.ceil(c.hits / net);
    }
    let energy = 0;
    for (const t of towers)
        energy += t.store[RESOURCE_ENERGY];
    return energy >= ticks * towers.length * TOWER_ENERGY_COST;
}
function targetScore(creep, hostiles, towers) {
    const damageablePenalty = isDamageable(creep, hostiles, towers) ? 0 : 100000;
    return damageablePenalty + hostileTier(creep) * 10000 + creep.hits;
}
function isDamageable(creep, hostiles, towers) {
    return effectiveTowerDamage(creep, towers) > incomingHeal(creep, hostiles);
}
function effectiveTowerDamage(creep, towers) {
    let total = 0;
    for (const tower of towers)
        total += towerDamageAtRange(tower.pos.getRangeTo(creep));
    return damageAfterTough(creep, total);
}
function damageAfterTough(creep, raw) {
    var _a;
    let remaining = raw;
    let dealt = 0;
    for (const part of creep.body) {
        if (remaining <= 0)
            break;
        if (part.hits <= 0)
            continue;
        const mult = part.type === TOUGH && part.boost ? (_a = TOUGH_DAMAGE_MULT[part.boost]) !== null && _a !== void 0 ? _a : 1 : 1;
        const toBreak = part.hits / mult;
        if (remaining <= toBreak) {
            dealt += remaining * mult;
            remaining = 0;
        }
        else {
            dealt += part.hits;
            remaining -= toBreak;
        }
    }
    return dealt + remaining;
}
function towerDamageAtRange(range) {
    let effectiveRange = range;
    if (effectiveRange < TWR_OPTIMAL_RANGE)
        effectiveRange = TWR_OPTIMAL_RANGE;
    if (effectiveRange > TWR_FALLOFF_RANGE)
        effectiveRange = TWR_FALLOFF_RANGE;
    const falloff = ((effectiveRange - TWR_OPTIMAL_RANGE) / (TWR_FALLOFF_RANGE - TWR_OPTIMAL_RANGE)) * TWR_FALLOFF;
    return Math.floor(TWR_POWER_ATTACK * (1 - falloff));
}
function incomingHeal(creep, hostiles) {
    var _a;
    let heal = 0;
    for (const ally of hostiles) {
        const range = ally.pos.getRangeTo(creep);
        if (range > RANGED_HEAL_RANGE)
            continue;
        const power = range <= HEAL_RANGE ? HEAL_POWER : RANGED_HEAL_POWER;
        for (const p of ally.body) {
            if (p.type !== HEAL || p.hits <= 0)
                continue;
            heal += power * (p.boost ? (_a = HEAL_BOOST_MULT[p.boost]) !== null && _a !== void 0 ? _a : 1 : 1);
        }
    }
    return heal;
}
function activeTowers(room) {
    var _a;
    if (!room)
        return [];
    const towerIds = (_a = room.memory.towerIds) !== null && _a !== void 0 ? _a : [];
    const towers = [];
    for (const id of towerIds) {
        const tower = Game.getObjectById(id);
        if (tower && tower.store[RESOURCE_ENERGY] >= TOWER_ENERGY_COST)
            towers.push(tower);
    }
    return towers;
}
function hostileTier(creep) {
    if (creep.body.some((p) => p.type === HEAL && p.hits > 0))
        return 0;
    if (creep.body.some((p) => p.type === RANGED_ATTACK && p.hits > 0))
        return 1;
    if (creep.body.some((p) => p.type === ATTACK && p.hits > 0))
        return 2;
    if (creep.body.some((p) => p.type === WORK && p.hits > 0))
        return 2;
    return 3;
}

const KITE_RANGE$2 = 3;
const DEFENSE_THREAT_SCORE = 150;
const DEFENSE_SCAN_INTERVAL = 2;
const DEFENSE_CLEAR_TICKS = 25;
const DEFENSE_HOLD_RADIUS = 6;
const DEFENSE_CHASE_RADIUS = 12;
let rampartCacheTick = -1;
const defensiveRampartCache = {};
function recordHostilePlayers(hostiles, ownRoom) {
    const wc = Memory.warCouncil;
    if (!wc)
        return;
    for (const c of hostiles) {
        if (!isPlayerCreep(c))
            continue;
        const armed = c.body.some((p) => p.hits > 0 && (p.type === ATTACK || p.type === RANGED_ATTACK || p.type === CLAIM));
        if (!armed && !(ownRoom && canDealDamage(c)))
            continue;
        if (!wc.hostilePlayers)
            wc.hostilePlayers = {};
        wc.hostilePlayers[c.owner.username] = Game.time;
    }
}
function runDefenseCouncil() {
    var _a, _b, _c;
    if (Game.time % DEFENSE_SCAN_INTERVAL !== 0)
        return;
    if (!Memory.defenseOps)
        Memory.defenseOps = {};
    const ops = Memory.defenseOps;
    for (const roomName in Game.rooms) {
        const room = Game.rooms[roomName];
        if (!((_a = room.controller) === null || _a === void 0 ? void 0 : _a.my))
            continue;
        const { score, hostiles } = getThreatInfo(room);
        const severity = getThreatSeverity(room);
        const existing = ops[roomName];
        recordHostilePlayers(hostiles, true);
        for (const remote of (_b = room.memory.remoteRooms) !== null && _b !== void 0 ? _b : []) {
            const r = Game.rooms[remote.roomName];
            if (r)
                recordHostilePlayers(getThreatInfo(r).hostiles, false);
        }
        const controllerAttacker = hostiles.some((c) => c.body.some((p) => p.type === CLAIM));
        const meaningful = (severity === "high" || score >= DEFENSE_THREAT_SCORE || controllerAttacker) &&
            !towersCanHold(room, hostiles);
        if (meaningful) {
            if (existing) {
                existing.lastThreatTick = Game.time;
                existing.threatScore = score;
                Object.assign(existing, recommendDefense(score));
            }
            else {
                ops[roomName] = {
                    room: roomName,
                    startedAt: Game.time,
                    lastThreatTick: Game.time,
                    threatScore: score,
                    ...recommendDefense(score),
                };
                console.log(`[Defense] ${roomName}: threat detected (score ${score}) - raising defenders`);
            }
        }
        else if (existing && Game.time - existing.lastThreatTick >= DEFENSE_CLEAR_TICKS) {
            console.log(`[Defense] ${roomName}: threat cleared - standing down defenders`);
            clearDefenseOp(roomName);
        }
    }
    for (const roomName in ops) {
        const room = Game.rooms[roomName];
        if ((_c = room === null || room === void 0 ? void 0 : room.controller) === null || _c === void 0 ? void 0 : _c.my)
            continue;
        if (!room && Game.time - ops[roomName].lastThreatTick < DEFENSE_CLEAR_TICKS)
            continue;
        clearDefenseOp(roomName);
    }
}
function requestAllyDefense() {
    const ops = Memory.defenseOps;
    if (!ops || getAllies().length === 0)
        return;
    for (const roomName in ops) {
        const op = ops[roomName];
        if (op.threatScore < DEFENSE_THREAT_SCORE)
            continue;
        if (Game.time - op.lastThreatTick > DEFENSE_SCAN_INTERVAL)
            continue;
        requestHelp({
            type: "defense",
            roomName,
            priority: Math.min(1, op.threatScore / (DEFENSE_THREAT_SCORE * 4)),
        });
    }
}
function recommendDefense(score) {
    const requiredMelee = Math.max(1, Math.min(6, 2 + Math.floor((score - DEFENSE_THREAT_SCORE) / 70)));
    const requiredHealers = Math.max(0, Math.min(3, 1 + Math.floor((score - DEFENSE_THREAT_SCORE) / 110)));
    const requiredRanged = score >= DEFENSE_THREAT_SCORE + 60
        ? Math.min(2, 1 + Math.floor((score - DEFENSE_THREAT_SCORE - 60) / 150))
        : 0;
    return { requiredMelee, requiredRanged, requiredHealers };
}
function clearDefenseOp(roomName) {
    for (const creep of Object.values(Game.creeps)) {
        if (creep.memory.defensiveTarget === roomName)
            delete creep.memory.defensiveTarget;
    }
    if (Memory.defenseOps)
        delete Memory.defenseOps[roomName];
}
function getDefenseOp(roomName) {
    var _a;
    return (_a = Memory.defenseOps) === null || _a === void 0 ? void 0 : _a[roomName];
}
function getDefenders(roomName) {
    return Object.values(Game.creeps).filter((c) => c.memory.defensiveTarget === roomName);
}
function defenseRallyPoint(roomName) {
    const room = Game.rooms[roomName];
    const spawn = room === null || room === void 0 ? void 0 : room.find(FIND_MY_SPAWNS)[0];
    if (spawn)
        return spawn.pos;
    return new RoomPosition(25, 25, roomName);
}
function isNearEdge(pos) {
    return pos.x <= 1 || pos.x >= 48 || pos.y <= 1 || pos.y >= 48;
}
function towerFocus(creep, hostiles, reach) {
    var _a, _b;
    if (!((_a = creep.room.controller) === null || _a === void 0 ? void 0 : _a.my))
        return null;
    const id = (_b = creep.room.memory) === null || _b === void 0 ? void 0 : _b.lastTowerTargetId;
    if (!id)
        return null;
    const focus = hostiles.find((h) => h.id === id);
    return focus && creep.pos.getRangeTo(focus) <= reach ? focus : null;
}
function selectDefenseTarget(creep, rally, hostiles, reach) {
    var _a;
    const focus = towerFocus(creep, hostiles, reach);
    if (focus)
        return focus;
    const engageable = hostiles.filter((h) => !isNearEdge(h.pos) && rally.getRangeTo(h) <= DEFENSE_CHASE_RADIUS);
    const target = selectHostileTarget(creep.pos, engageable);
    if (target)
        return target;
    return (_a = creep.pos.findInRange(hostiles, 1)[0]) !== null && _a !== void 0 ? _a : null;
}
function defenseMoveToward(creep, rally, target, range) {
    const toTarget = creep.pos.getRangeTo(target);
    if (toTarget <= range) {
        if (isNearEdge(creep.pos))
            creep.moveTo(rally, { range: DEFENSE_HOLD_RADIUS, reusePath: 5 });
        return;
    }
    if (rally.getRangeTo(target) > DEFENSE_CHASE_RADIUS) {
        defenseHold(creep, rally);
        return;
    }
    creep.moveTo(target, { range, reusePath: 1 });
}
function defenseHold(creep, rally) {
    if (creep.pos.getRangeTo(rally) > DEFENSE_HOLD_RADIUS || isNearEdge(creep.pos)) {
        creep.moveTo(rally, { range: DEFENSE_HOLD_RADIUS, reusePath: 5 });
    }
}
function getDefensiveRamparts(room) {
    if (rampartCacheTick !== Game.time) {
        rampartCacheTick = Game.time;
        for (const k in defensiveRampartCache)
            delete defensiveRampartCache[k];
    }
    if (!defensiveRampartCache[room.name]) {
        const terrain = room.getTerrain();
        defensiveRampartCache[room.name] = room.find(FIND_MY_STRUCTURES, {
            filter: (s) => s.structureType === STRUCTURE_RAMPART &&
                !isNearEdge(s.pos) &&
                terrain.get(s.pos.x, s.pos.y) !== TERRAIN_MASK_WALL,
        });
    }
    return defensiveRampartCache[room.name];
}
function rampartIsStandable(rampart, self) {
    const blocked = rampart.pos
        .lookFor(LOOK_STRUCTURES)
        .some((s) => s.structureType !== STRUCTURE_RAMPART &&
        OBSTACLE_OBJECT_TYPES.includes(s.structureType));
    if (blocked)
        return false;
    return !rampart.pos.lookFor(LOOK_CREEPS).some((c) => c.name !== self.name);
}
function isOnRampart(creep) {
    return creep.pos
        .lookFor(LOOK_STRUCTURES)
        .some((s) => s.structureType === STRUCTURE_RAMPART);
}
function anchorOnRampart(creep, anchorPos, range) {
    const ramparts = getDefensiveRamparts(creep.room);
    if (ramparts.length === 0)
        return false;
    if (isOnRampart(creep) && creep.pos.getRangeTo(anchorPos) <= range)
        return true;
    let best = null;
    let bestDist = Infinity;
    for (const r of ramparts) {
        if (!rampartIsStandable(r, creep))
            continue;
        const d = r.pos.getRangeTo(anchorPos);
        if (d < bestDist) {
            bestDist = d;
            best = r;
        }
    }
    if (!best)
        return isOnRampart(creep);
    if (range > 0 && bestDist > range)
        return false;
    if (!creep.pos.isEqualTo(best.pos))
        creep.moveTo(best, { range: 0, reusePath: 5 });
    return true;
}
function isBreaching(room, hostile) {
    return room
        .find(FIND_MY_STRUCTURES)
        .some((s) => s.structureType !== STRUCTURE_RAMPART && hostile.pos.getRangeTo(s) <= 1);
}
function runDefensiveKnight(creep, roomName) {
    const rally = defenseRallyPoint(roomName);
    if (creep.room.name !== roomName) {
        creep.moveTo(rally, { range: DEFENSE_HOLD_RADIUS, reusePath: 10 });
        return;
    }
    const { hostiles } = getThreatInfo(creep.room);
    const target = selectDefenseTarget(creep, rally, hostiles, 1);
    if (target) {
        meleeStrike(creep, target, hostiles);
        if (!anchorOnRampart(creep, target.pos, 1)) {
            if (getDefensiveRamparts(creep.room).length === 0 || isBreaching(creep.room, target)) {
                defenseMoveToward(creep, rally, target, 1);
            }
            else {
                anchorOnRampart(creep, target.pos, 0);
            }
        }
        return;
    }
    if (!anchorOnRampart(creep, rally, 0))
        defenseHold(creep, rally);
}
function runDefensiveWizard(creep, roomName) {
    const rally = defenseRallyPoint(roomName);
    if (creep.room.name !== roomName) {
        creep.moveTo(rally, { range: DEFENSE_HOLD_RADIUS, reusePath: 10 });
        return;
    }
    const { hostiles } = getThreatInfo(creep.room);
    rangedStrike(creep, selectDefenseTarget(creep, rally, hostiles, KITE_RANGE$2), hostiles);
    const nearest = creep.pos.findClosestByRange(hostiles.filter((h) => !isNearEdge(h.pos) && rally.getRangeTo(h) <= DEFENSE_CHASE_RADIUS));
    if (nearest) {
        if (anchorOnRampart(creep, nearest.pos, 3))
            return;
        const range = creep.pos.getRangeTo(nearest);
        if (range < KITE_RANGE$2) {
            fleeFrom$1(creep, nearest.pos);
        }
        else if (range > KITE_RANGE$2) {
            defenseMoveToward(creep, rally, nearest, KITE_RANGE$2);
        }
        else if (isNearEdge(creep.pos)) {
            defenseHold(creep, rally);
        }
        return;
    }
    if (!anchorOnRampart(creep, rally, 0))
        defenseHold(creep, rally);
}
function runDefensiveCleric(creep, roomName) {
    const rally = defenseRallyPoint(roomName);
    const allies = getDefenders(roomName).filter((c) => c.room.name === creep.room.name);
    const wounded = allies.filter((c) => c.hits < c.hitsMax);
    let healTarget = null;
    if (wounded.length > 0) {
        healTarget = wounded.reduce((a, b) => (a.hits / a.hitsMax < b.hits / b.hitsMax ? a : b));
        const range = creep.pos.getRangeTo(healTarget);
        if (range <= 1)
            creep.heal(healTarget);
        else if (range <= 3)
            creep.rangedHeal(healTarget);
    }
    else if (creep.hits < creep.hitsMax) {
        creep.heal(creep);
    }
    if (creep.room.name !== roomName) {
        creep.moveTo(rally, { range: DEFENSE_HOLD_RADIUS, reusePath: 10 });
        return;
    }
    const anchorPos = healTarget ? healTarget.pos : rally;
    if (anchorOnRampart(creep, anchorPos, 3))
        return;
    if (healTarget && creep.pos.getRangeTo(healTarget) > 1 && !isNearEdge(healTarget.pos)) {
        creep.moveTo(healTarget, { range: 1, reusePath: 1 });
        return;
    }
    defenseHold(creep, rally);
}
function meleeStrike(creep, preferred, hostiles) {
    if (creep.pos.isNearTo(preferred)) {
        creep.attack(preferred);
        return;
    }
    const fallback = selectHostileTarget(creep.pos, creep.pos.findInRange(hostiles, 1));
    if (fallback)
        creep.attack(fallback);
}
function rangedStrike(creep, preferred, hostiles) {
    const inRange = creep.pos.findInRange(hostiles, KITE_RANGE$2);
    if (inRange.length === 0)
        return false;
    if (preferMassAttack(creep.pos, inRange) && !allyInMassAttackRange(creep.pos)) {
        creep.rangedMassAttack();
        return true;
    }
    const target = preferred && creep.pos.getRangeTo(preferred) <= KITE_RANGE$2
        ? preferred
        : selectHostileTarget(creep.pos, inRange);
    if (target)
        creep.rangedAttack(target);
    return true;
}
function fleeFrom$1(creep, threat) {
    const result = PathFinder.search(creep.pos, { pos: threat, range: KITE_RANGE$2 + 1 }, { flee: true, maxRooms: 1, plainCost: 2, swampCost: 5 });
    if (result.path.length > 0) {
        creep.move(creep.pos.getDirectionTo(result.path[0]));
    }
    else {
        creep.move(threat.getDirectionTo(creep.pos));
    }
}

const RALLY_RANGE = 8;
const DEFEND_RADIUS = 3;
const CRITICAL_HP = 0.2;
const BOOST_GRACE_TICKS = 80;
const HOLD_FOR_DRAIN_MAX = 300;
let squadContextTick = -1;
let squadContextKey = "";
let squadContextValue = null;
const SLOT_ORDER = {
    [ROLE_KNIGHT]: 0,
    [ROLE_SIEGER]: 1,
    [ROLE_CLERIC]: 2,
    [ROLE_WIZARD]: 3,
};
function getSquadContext(op) {
    var _a;
    const key = `${op.homeRoom}>${op.targetRoom}`;
    if (squadContextTick === Game.time && squadContextKey === key && squadContextValue) {
        return squadContextValue;
    }
    const members = getSquadMembers(op);
    const ordered = [...members].sort((a, b) => {
        var _a, _b;
        const ra = (_a = SLOT_ORDER[a.memory.role]) !== null && _a !== void 0 ? _a : 9;
        const rb = (_b = SLOT_ORDER[b.memory.role]) !== null && _b !== void 0 ? _b : 9;
        if (ra !== rb)
            return ra - rb;
        return a.id < b.id ? -1 : 1;
    });
    const slotById = {};
    ordered.forEach((c, i) => (slotById[c.id] = i));
    const leader = (_a = ordered[0]) !== null && _a !== void 0 ? _a : null;
    let hpSum = 0;
    let minHp = 1;
    for (const c of members) {
        const pct = c.hits / c.hitsMax;
        hpSum += pct;
        if (pct < minHp)
            minHp = pct;
    }
    const avgHpPct = members.length > 0 ? hpSum / members.length : 1;
    const cohesive = !leader || members.every((c) => c.room.name === leader.room.name);
    squadContextValue = { members, leader, slotById, avgHpPct, minHpPct: minHp, cohesive };
    squadContextTick = Game.time;
    squadContextKey = key;
    return squadContextValue;
}
const breachCache = {};
function breachKey(op) {
    return `${op.homeRoom}>${op.targetRoom}`;
}
function getBreachFocus(op, room, fromPos) {
    var _a;
    const key = breachKey(op);
    const cached = breachCache[key];
    if (cached) {
        const focus = Game.getObjectById(cached.focusId);
        if (focus && ((_a = focus.room) === null || _a === void 0 ? void 0 : _a.name) === room.name && focus.hits) {
            return focus;
        }
        delete breachCache[key];
    }
    const plan = planBreach(room, fromPos);
    if (!plan)
        return null;
    breachCache[key] = plan;
    return Game.getObjectById(plan.focusId);
}
function clearBreachPlan(op) {
    delete breachCache[breachKey(op)];
}
function attackStructureTarget(creep, op) {
    const breach = getBreachFocus(op, creep.room, creep.pos);
    if (breach)
        return breach;
    return selectStructureTarget(creep.room, creep.pos, op.tactic);
}
function getSquadMembers(op) {
    return Object.values(Game.creeps).filter((c) => c.memory.offensiveTarget === op.targetRoom &&
        c.memory.homeRoom === op.homeRoom &&
        c.memory.role !== ROLE_DRAINER);
}
function squadMet(op, members) {
    return (members.filter((c) => c.memory.role === ROLE_KNIGHT).length >= op.requiredMelee &&
        members.filter((c) => c.memory.role === ROLE_WIZARD).length >= op.requiredRanged &&
        members.filter((c) => c.memory.role === ROLE_CLERIC).length >= op.requiredHealers &&
        members.filter((c) => c.memory.role === ROLE_SIEGER).length >= op.requiredSiege);
}
function creepNeedsBoost(creep) {
    var _a, _b;
    return !!creep.memory.boostCompound || ((_b = (_a = creep.memory.boostQueue) === null || _a === void 0 ? void 0 : _a.length) !== null && _b !== void 0 ? _b : 0) > 0;
}
function withinBoostGrace(creep) {
    var _a;
    const age = CREEP_LIFE_TIME - ((_a = creep.ticksToLive) !== null && _a !== void 0 ? _a : CREEP_LIFE_TIME);
    return age <= BOOST_GRACE_TICKS;
}
function squadBoostReady(members) {
    for (const c of members) {
        if (creepNeedsBoost(c) && withinBoostGrace(c))
            return false;
    }
    return true;
}
function runOffensiveKnight(creep, op) {
    var _a;
    const ctx = getSquadContext(op);
    if (op.phase === "forming" || op.phase === "rallying") {
        strikeAdjacent(creep);
        parkNearHomeSpawn$3(creep, op.homeRoom);
        return;
    }
    if (op.phase === "retreating" || op.tactic === "retreat") {
        strikeAdjacent(creep);
        retreatToHome(creep, op.homeRoom);
        return;
    }
    const isLeader = ((_a = ctx.leader) === null || _a === void 0 ? void 0 : _a.id) === creep.id;
    if (creep.hits < creep.hitsMax * CRITICAL_HP && !isLeader) {
        const healer = creep.pos.findClosestByRange(ctx.members, {
            filter: (c) => c.memory.role === ROLE_CLERIC,
        });
        strikeAdjacent(creep);
        if (healer && !creep.pos.isNearTo(healer)) {
            creep.moveTo(healer, { reusePath: 3 });
            return;
        }
    }
    if (creep.room.name !== op.targetRoom) {
        strikeAdjacent(creep);
        transitMove(creep, op, ctx, isLeader);
        return;
    }
    const hostiles = getThreatInfo(creep.room).hostiles;
    const target = selectHostileTarget(creep.pos, hostiles);
    if (target) {
        meleeStrike(creep, target, hostiles);
        if (op.tactic === "defend") {
            holdNearRally(creep, op, ctx, isLeader);
        }
        else if (isLeader) {
            leaderAdvance(creep, op, ctx, target.pos, 1);
        }
        else {
            moveKnightFollower(creep, op, ctx, hostiles);
        }
        return;
    }
    if (op.tactic === "defend") {
        holdNearRally(creep, op, ctx, isLeader);
        return;
    }
    const struct = attackStructureTarget(creep, op);
    if (struct) {
        if (creep.pos.isNearTo(struct))
            creep.attack(struct);
        if (isLeader)
            leaderAdvance(creep, op, ctx, struct.pos, 1);
        else
            moveToSlot(creep, op, ctx);
        return;
    }
    regroup(creep, op, ctx, isLeader);
}
function runOffensiveWizard(creep, op) {
    var _a;
    const ctx = getSquadContext(op);
    if (op.phase === "forming" || op.phase === "rallying") {
        rangedSnapFire(creep);
        parkNearHomeSpawn$3(creep, op.homeRoom);
        return;
    }
    if (op.phase === "retreating" || op.tactic === "retreat") {
        rangedSnapFire(creep);
        retreatToHome(creep, op.homeRoom);
        return;
    }
    const isLeader = ((_a = ctx.leader) === null || _a === void 0 ? void 0 : _a.id) === creep.id;
    if (creep.room.name !== op.targetRoom) {
        rangedSnapFire(creep);
        transitMove(creep, op, ctx, isLeader);
        return;
    }
    const hostiles = getThreatInfo(creep.room).hostiles;
    if (!rangedStrike(creep, selectHostileTarget(creep.pos, hostiles), hostiles) && op.tactic !== "defend") {
        const struct = attackStructureTarget(creep, op);
        if (struct && creep.pos.getRangeTo(struct) <= 3)
            creep.rangedAttack(struct);
    }
    const nearest = creep.pos.findClosestByRange(hostiles);
    if (nearest) {
        const range = creep.pos.getRangeTo(nearest);
        if (range < KITE_RANGE$2) {
            fleeFrom$1(creep, nearest.pos);
        }
        else if (range > KITE_RANGE$2) {
            if (op.tactic === "defend")
                holdNearRally(creep, op, ctx, isLeader);
            else if (isLeader)
                leaderAdvance(creep, op, ctx, nearest.pos, KITE_RANGE$2);
            else
                moveToSlot(creep, op, ctx);
        }
        return;
    }
    if (op.tactic === "defend") {
        holdNearRally(creep, op, ctx, isLeader);
        return;
    }
    const struct = attackStructureTarget(creep, op);
    if (struct) {
        if (isLeader)
            leaderAdvance(creep, op, ctx, struct.pos, KITE_RANGE$2);
        else
            moveToSlot(creep, op, ctx);
        return;
    }
    regroup(creep, op, ctx, isLeader);
}
function runOffensiveCleric(creep, op) {
    var _a;
    const ctx = getSquadContext(op);
    if (op.phase === "forming" || op.phase === "rallying") {
        if (creep.hits < creep.hitsMax)
            creep.heal(creep);
        else
            healBest(creep, ctx, false);
        parkNearHomeSpawn$3(creep, op.homeRoom);
        return;
    }
    if (op.phase === "retreating" || op.tactic === "retreat") {
        healBest(creep, ctx, false);
        retreatToHome(creep, op.homeRoom);
        return;
    }
    const isLeader = ((_a = ctx.leader) === null || _a === void 0 ? void 0 : _a.id) === creep.id;
    const healTarget = healBest(creep, ctx);
    if (creep.room.name !== op.targetRoom) {
        transitMove(creep, op, ctx, isLeader);
        return;
    }
    if (healTarget && creep.pos.getRangeTo(healTarget) > 1 && creep.pos.getRangeTo(healTarget) <= 5) {
        creep.moveTo(healTarget, { range: 1, reusePath: 1 });
        return;
    }
    if (op.tactic === "defend") {
        holdNearRally(creep, op, ctx, isLeader);
        return;
    }
    if (isLeader)
        regroup(creep, op, ctx, isLeader);
    else
        moveToSlot(creep, op, ctx);
}
function runOffensiveSieger(creep, op) {
    var _a;
    const ctx = getSquadContext(op);
    if (op.phase === "forming" || op.phase === "rallying") {
        parkNearHomeSpawn$3(creep, op.homeRoom);
        return;
    }
    if (op.phase === "retreating" || op.tactic === "retreat") {
        retreatToHome(creep, op.homeRoom);
        return;
    }
    const isLeader = ((_a = ctx.leader) === null || _a === void 0 ? void 0 : _a.id) === creep.id;
    if (creep.room.name !== op.targetRoom) {
        transitMove(creep, op, ctx, isLeader);
        return;
    }
    if (op.tactic === "defend") {
        holdNearRally(creep, op, ctx, isLeader);
        return;
    }
    if (op.tactic === "siege" && shouldHoldForDrain(op, creep.room)) {
        holdAtBreachApproach(creep, op, ctx, isLeader);
        return;
    }
    const struct = attackStructureTarget(creep, op);
    if (struct) {
        if (creep.pos.isNearTo(struct))
            creep.dismantle(struct);
        else if (isLeader)
            leaderAdvance(creep, op, ctx, struct.pos, 1);
        else
            moveToSlot(creep, op, ctx);
        return;
    }
    regroup(creep, op, ctx, isLeader);
}
function healBest(creep, ctx, preHeal = true) {
    const wounded = ctx.members.filter((c) => c.hits < c.hitsMax);
    if (wounded.length === 0) {
        const front = ctx.leader;
        if (preHeal && front) {
            const range = creep.pos.getRangeTo(front);
            if (range <= 1)
                creep.heal(front);
            else if (range <= 3)
                creep.rangedHeal(front);
        }
        return null;
    }
    const target = wounded.reduce((a, b) => (a.hits / a.hitsMax < b.hits / b.hitsMax ? a : b));
    const range = creep.pos.getRangeTo(target);
    if (range <= 1)
        creep.heal(target);
    else if (range <= 3)
        creep.rangedHeal(target);
    return target;
}
function rangedSnapFire(creep) {
    const hostiles = getThreatInfo(creep.room).hostiles;
    rangedStrike(creep, towerFocus(creep, hostiles, KITE_RANGE$2), hostiles);
}
function strikeAdjacent(creep) {
    var _a;
    const hostiles = getThreatInfo(creep.room).hostiles;
    const target = (_a = towerFocus(creep, hostiles, 1)) !== null && _a !== void 0 ? _a : selectHostileTarget(creep.pos, creep.pos.findInRange(hostiles, 1));
    if (target)
        creep.attack(target);
}
function moveToSlot(creep, op, ctx) {
    var _a;
    const leader = ctx.leader;
    if (!leader)
        return;
    if (leader.id === creep.id)
        return;
    const slot = (_a = ctx.slotById[creep.id]) !== null && _a !== void 0 ? _a : 0;
    const [dx, dy] = formationOffset(op.formation, slot);
    const x = Math.min(48, Math.max(1, leader.pos.x + dx));
    const y = Math.min(48, Math.max(1, leader.pos.y + dy));
    const dest = new RoomPosition(x, y, leader.room.name);
    if (creep.pos.roomName === dest.roomName && creep.pos.getRangeTo(dest) === 0)
        return;
    creep.moveTo(dest, { reusePath: 1 });
}
function moveKnightFollower(creep, op, ctx, hostiles) {
    const engageable = hostiles.filter((h) => h.pos.x > 1 && h.pos.x < 48 && h.pos.y > 1 && h.pos.y < 48);
    const nearest = creep.pos.findClosestByRange(engageable);
    if (nearest) {
        const range = creep.pos.getRangeTo(nearest);
        if (range === 1)
            return;
        if (range <= 3) {
            creep.moveTo(nearest, { range: 1, reusePath: 1 });
            return;
        }
    }
    moveToSlot(creep, op, ctx);
}
let towerMatrixTick = -1;
const towerMatrixCache = {};
function getTowerMatrix(room) {
    if (towerMatrixTick !== Game.time) {
        towerMatrixTick = Game.time;
        for (const k in towerMatrixCache)
            delete towerMatrixCache[k];
    }
    let m = towerMatrixCache[room.name];
    if (!m) {
        const towers = room.find(FIND_HOSTILE_STRUCTURES, {
            filter: (s) => s.structureType === STRUCTURE_TOWER,
        });
        m = buildTowerCostMatrix(room, towers);
        towerMatrixCache[room.name] = m;
    }
    return m;
}
const FORMATION_SLOT_SLACK = 2;
function blockInFormation(op, ctx) {
    var _a;
    const leader = ctx.leader;
    if (!leader)
        return true;
    for (const c of ctx.members) {
        if (c.id === leader.id)
            continue;
        if (c.room.name !== leader.room.name)
            return false;
        const slot = (_a = ctx.slotById[c.id]) !== null && _a !== void 0 ? _a : 0;
        const [dx, dy] = formationOffset(op.formation, slot);
        const sx = Math.min(48, Math.max(1, leader.pos.x + dx));
        const sy = Math.min(48, Math.max(1, leader.pos.y + dy));
        if (c.pos.getRangeTo(new RoomPosition(sx, sy, leader.room.name)) > FORMATION_SLOT_SLACK) {
            return false;
        }
    }
    return true;
}
function leaderAdvance(creep, op, ctx, dest, range) {
    if (!ctx.cohesive)
        return;
    if (creep.pos.inRangeTo(dest, range))
        return;
    if (creep.room.name === op.targetRoom && !blockInFormation(op, ctx))
        return;
    if (creep.room.name === op.targetRoom) {
        const matrix = getTowerMatrix(creep.room);
        const result = PathFinder.search(creep.pos, { pos: dest, range }, {
            maxRooms: 1,
            plainCost: 2,
            swampCost: 5,
            roomCallback: (rn) => (rn === creep.room.name ? matrix : false),
        });
        if (result.path.length > 0) {
            creep.move(creep.pos.getDirectionTo(result.path[0]));
            return;
        }
    }
    creep.moveTo(dest, { range, reusePath: 3 });
}
function transitMove(creep, op, ctx, isLeader) {
    if (isLeader || !ctx.leader) {
        if (ctx.cohesive || !ctx.leader) {
            creep.moveTo(new RoomPosition(25, 25, op.targetRoom), { reusePath: 10 });
        }
        return;
    }
    if (creep.room.name !== ctx.leader.room.name) {
        creep.moveTo(ctx.leader.pos, { range: 1, reusePath: 10 });
        return;
    }
    moveToSlot(creep, op, ctx);
}
function holdNearRally(creep, op, ctx, isLeader) {
    if (creep.room.name !== op.targetRoom) {
        transitMove(creep, op, ctx, isLeader);
        return;
    }
    const rally = new RoomPosition(25, 25, op.targetRoom);
    if (creep.pos.getRangeTo(rally) > DEFEND_RADIUS) {
        creep.moveTo(rally, { range: DEFEND_RADIUS, reusePath: 5 });
    }
}
function regroup(creep, op, ctx, isLeader) {
    if (isLeader || !ctx.leader) {
        const center = new RoomPosition(25, 25, op.targetRoom);
        if (creep.room.name !== op.targetRoom || !creep.pos.inRangeTo(center, 5)) {
            creep.moveTo(center, { range: 5, reusePath: 10 });
        }
        return;
    }
    moveToSlot(creep, op, ctx);
}
function shouldHoldForDrain(op, room) {
    const status = assessTowers(room);
    if (status.count < 2 || towersAreDrained(status)) {
        delete op.holdSince;
        return false;
    }
    const drainerAlive = Object.values(Game.creeps).some((c) => c.memory.role === ROLE_DRAINER && c.memory.offensiveTarget === op.targetRoom);
    if (!drainerAlive)
        return false;
    if (op.holdSince === undefined)
        op.holdSince = Game.time;
    return Game.time - op.holdSince < HOLD_FOR_DRAIN_MAX;
}
function holdAtBreachApproach(creep, op, ctx, isLeader) {
    const focus = getBreachFocus(op, creep.room, creep.pos);
    const anchor = focus ? focus.pos : new RoomPosition(25, 25, op.targetRoom);
    if (isLeader || !ctx.leader) {
        if (!creep.pos.inRangeTo(anchor, DEFEND_RADIUS)) {
            leaderAdvance(creep, op, ctx, anchor, DEFEND_RADIUS);
        }
        return;
    }
    moveToSlot(creep, op, ctx);
}
const DRAIN_RETREAT_HP = 0.45;
const DRAIN_RESUME_HP = 0.95;
const DRAIN_BAIT_RANGE = 18;
function drainTarget(creep, targetRoom) {
    if (creep.hits < creep.hitsMax)
        creep.heal(creep);
    const hpPct = creep.hits / creep.hitsMax;
    if (hpPct <= DRAIN_RETREAT_HP)
        creep.memory.drainRetreat = true;
    else if (hpPct >= DRAIN_RESUME_HP)
        creep.memory.drainRetreat = false;
    const recovering = creep.memory.drainRetreat === true;
    if (creep.room.name !== targetRoom) {
        if (recovering && hpPct < DRAIN_RESUME_HP)
            return;
        creep.moveTo(new RoomPosition(25, 25, targetRoom), { reusePath: 20 });
        return;
    }
    if (recovering) {
        const exit = creep.pos.findClosestByRange(FIND_EXIT);
        if (exit)
            creep.moveTo(exit, { reusePath: 5 });
        return;
    }
    const towers = creep.room.find(FIND_HOSTILE_STRUCTURES, {
        filter: (s) => s.structureType === STRUCTURE_TOWER && s.store[RESOURCE_ENERGY] > 0,
    });
    const tower = creep.pos.findClosestByRange(towers);
    if (!tower) {
        const exit = creep.pos.findClosestByRange(FIND_EXIT);
        if (exit && creep.pos.getRangeTo(exit) > 3)
            creep.moveTo(exit, { range: 3, reusePath: 10 });
        return;
    }
    const range = creep.pos.getRangeTo(tower);
    if (range > DRAIN_BAIT_RANGE) {
        creep.moveTo(tower, { range: DRAIN_BAIT_RANGE, reusePath: 5 });
    }
    else if (range < DRAIN_BAIT_RANGE - 3) {
        fleeFrom$1(creep, tower.pos);
    }
}
function runOffensiveDrainer(creep, op) {
    if (op.phase === "retreating" || op.tactic === "retreat") {
        if (creep.hits < creep.hitsMax)
            creep.heal(creep);
        retreatToHome(creep, op.homeRoom);
        return;
    }
    drainTarget(creep, op.targetRoom);
}
function runStandaloneDrainer(creep, op) {
    drainTarget(creep, op.targetRoom);
}
function parkNearHomeSpawn$3(creep, homeRoomName) {
    if (creep.room.name !== homeRoomName) {
        creep.moveTo(new RoomPosition(25, 25, homeRoomName), { reusePath: 10 });
        return;
    }
    const spawn = creep.room.find(FIND_MY_SPAWNS)[0];
    if (spawn && creep.pos.getRangeTo(spawn) > RALLY_RANGE) {
        creep.moveTo(spawn, { reusePath: 20 });
    }
}
function retreatToHome(creep, homeRoomName) {
    if (creep.room.name !== homeRoomName) {
        creep.moveTo(new RoomPosition(25, 25, homeRoomName), { reusePath: 5 });
        return;
    }
    const spawn = creep.room.find(FIND_MY_SPAWNS)[0];
    if (spawn && !creep.pos.isNearTo(spawn)) {
        creep.moveTo(spawn, { reusePath: 20 });
    }
}

const MAX_OP_ATTEMPTS = 2;
const FAILED_OP_COOLDOWN = 10000;
function abandonAfterFailedAttempt(op, reason) {
    var _a;
    op.attempts = ((_a = op.attempts) !== null && _a !== void 0 ? _a : 0) + 1;
    if (op.attempts < MAX_OP_ATTEMPTS)
        return false;
    console.log(`[Military] ${op.targetRoom}: ${reason} (${op.attempts} failed attempts) - abandoning op`);
    startTargetCooldown(op.targetRoom);
    removeOp(op);
    return true;
}
function startTargetCooldown(targetRoom) {
    var _a, _b, _c, _d, _e, _f;
    if (!Memory.warCouncil)
        Memory.warCouncil = { autoAttack: false };
    const wc = Memory.warCouncil;
    if (!wc.targetCooldown)
        wc.targetCooldown = {};
    const until = Game.time + FAILED_OP_COOLDOWN;
    wc.targetCooldown[targetRoom] = until;
    const owner = (_d = (_c = (_b = (_a = Game.rooms[targetRoom]) === null || _a === void 0 ? void 0 : _a.controller) === null || _b === void 0 ? void 0 : _b.owner) === null || _c === void 0 ? void 0 : _c.username) !== null && _d !== void 0 ? _d : (_f = (_e = Memory.intel) === null || _e === void 0 ? void 0 : _e[targetRoom]) === null || _f === void 0 ? void 0 : _f.owner;
    if (owner)
        wc.targetCooldown[owner] = until;
}
function onTargetCooldown(wc, key) {
    var _a;
    if (!key)
        return false;
    const until = (_a = wc.targetCooldown) === null || _a === void 0 ? void 0 : _a[key];
    return until !== undefined && Game.time < until;
}
function roomStructurallyCleared(room) {
    if (getThreatInfo(room).hostiles.length > 0)
        return false;
    return (room.find(FIND_HOSTILE_STRUCTURES, {
        filter: (s) => s.structureType !== STRUCTURE_CONTROLLER && s.structureType !== STRUCTURE_RAMPART,
    }).length === 0);
}
function hostileControllerToNeutralize(room) {
    const ctrl = room.controller;
    if (!ctrl)
        return null;
    if (ctrl.my)
        return null;
    if (ctrl.owner || ctrl.reservation)
        return ctrl;
    return null;
}
const UNCLAIM_WINDOW = 100000;
function completeOp(op) {
    var _a;
    const room = Game.rooms[op.targetRoom];
    if (room && roomStructurallyCleared(room) && hostileControllerToNeutralize(room)) {
        Memory.unclaimTargets = (_a = Memory.unclaimTargets) !== null && _a !== void 0 ? _a : {};
        Memory.unclaimTargets[op.targetRoom] = { homeRoom: op.homeRoom, until: Game.time + UNCLAIM_WINDOW };
    }
    removeOp(op);
}
function removeOp(op) {
    clearSquadTargets(op.targetRoom, op.homeRoom);
    clearBreachPlan(op);
    if (Memory.militaryOps)
        delete Memory.militaryOps[op.homeRoom];
}
function clearSquadTargets(targetRoom, homeRoom) {
    for (const creep of Object.values(Game.creeps)) {
        if (creep.memory.offensiveTarget === targetRoom && creep.memory.homeRoom === homeRoom) {
            delete creep.memory.offensiveTarget;
        }
    }
}
function getOffensiveOp(targetRoom, homeRoom) {
    var _a;
    if (!homeRoom)
        return undefined;
    const op = (_a = Memory.militaryOps) === null || _a === void 0 ? void 0 : _a[homeRoom];
    return op && op.targetRoom === targetRoom ? op : undefined;
}
function cancelOp(homeRoom) {
    const ops = Memory.militaryOps;
    if (!ops)
        return 0;
    if (homeRoom) {
        const op = ops[homeRoom];
        if (!op)
            return 0;
        removeOp(op);
        return 1;
    }
    let count = 0;
    for (const hr of Object.keys(ops)) {
        removeOp(ops[hr]);
        count++;
    }
    return count;
}
const DRAIN_DEFAULT_COUNT = 1;
const DRAIN_MAX_COUNT = 4;
function getDrainOp(targetRoom) {
    var _a;
    return (_a = Memory.drainOps) === null || _a === void 0 ? void 0 : _a[targetRoom];
}
function getDrainOpsForHome(homeRoom) {
    const ops = Memory.drainOps;
    if (!ops)
        return [];
    return Object.values(ops).filter((o) => o.homeRoom === homeRoom);
}
function launchDrain(targetRoom, homeRoom, count = DRAIN_DEFAULT_COUNT) {
    var _a, _b, _c;
    if ((_b = (_a = Game.rooms[targetRoom]) === null || _a === void 0 ? void 0 : _a.controller) === null || _b === void 0 ? void 0 : _b.my)
        return `${targetRoom} is your own room`;
    const allyErr = allyTargetError(targetRoom);
    if (allyErr)
        return allyErr;
    const drainers = Math.max(1, Math.min(DRAIN_MAX_COUNT, Math.floor(count)));
    let home = homeRoom;
    if (home) {
        const r = Game.rooms[home];
        if (!((_c = r === null || r === void 0 ? void 0 : r.controller) === null || _c === void 0 ? void 0 : _c.my))
            return `${home} is not a room you own`;
    }
    else {
        let best;
        let bestDist = Infinity;
        for (const rn in Game.rooms) {
            const room = Game.rooms[rn];
            if (!isCapableOffensiveHome(room))
                continue;
            const d = Game.map.getRoomLinearDistance(rn, targetRoom);
            if (d < bestDist) {
                bestDist = d;
                best = room;
            }
        }
        home = best === null || best === void 0 ? void 0 : best.name;
    }
    if (!home)
        return "no capable home room to fund a drain";
    if (!Memory.drainOps)
        Memory.drainOps = {};
    Memory.drainOps[targetRoom] = {
        targetRoom,
        homeRoom: home,
        startedAt: Game.time,
        drainers,
    };
    return null;
}
function stopDrain(targetRoom) {
    var _a;
    if (!((_a = Memory.drainOps) === null || _a === void 0 ? void 0 : _a[targetRoom]))
        return false;
    delete Memory.drainOps[targetRoom];
    return true;
}
function getDrainOps() {
    return Memory.drainOps ? Object.values(Memory.drainOps) : [];
}
function cleanupDrainOps() {
    var _a, _b, _c;
    const ops = Memory.drainOps;
    if (!ops)
        return;
    for (const targetRoom of Object.keys(ops)) {
        const op = ops[targetRoom];
        const home = Game.rooms[op.homeRoom];
        if (!((_a = home === null || home === void 0 ? void 0 : home.controller) === null || _a === void 0 ? void 0 : _a.my) || ((_c = (_b = Game.rooms[targetRoom]) === null || _b === void 0 ? void 0 : _b.controller) === null || _c === void 0 ? void 0 : _c.my)) {
            delete ops[targetRoom];
        }
    }
}
function recommendComposition(targetRoom, tactic) {
    var _a, _b;
    const intel = (_a = Memory.intel) === null || _a === void 0 ? void 0 : _a[targetRoom];
    const towers = (_b = intel === null || intel === void 0 ? void 0 : intel.towers) !== null && _b !== void 0 ? _b : 0;
    const owned = !!(intel === null || intel === void 0 ? void 0 : intel.owner);
    let melee = 2 + Math.min(2, towers);
    let ranged = 1;
    let healers = Math.max(1, Math.min(3, towers));
    let siege = 0;
    if (tactic === "siege" || (owned && towers >= 2))
        siege = 2;
    if (tactic === "raid") {
        melee = 2;
        ranged = 1;
        healers = 1;
        siege = 0;
    }
    const drainers = siege > 0 && towers >= 2 ? 1 : 0;
    return { melee, ranged, healers, siege, drainers };
}
function launchOp(targetRoom, formation, tactic, composition, homeRoom) {
    var _a;
    const allyErr = allyTargetError(targetRoom);
    if (allyErr)
        return allyErr;
    if (!Memory.militaryOps)
        Memory.militaryOps = {};
    const existing = Memory.militaryOps[homeRoom];
    if (existing) {
        return `${homeRoom} already running op against ${existing.targetRoom} (${existing.phase})`;
    }
    const total = composition.melee + composition.ranged + composition.healers + composition.siege;
    if (total <= 0)
        return "squad must have at least one member";
    Memory.militaryOps[homeRoom] = {
        targetRoom,
        homeRoom,
        phase: "forming",
        startedAt: Game.time,
        formation,
        tactic,
        requiredMelee: composition.melee,
        requiredRanged: composition.ranged,
        requiredHealers: composition.healers,
        requiredSiege: composition.siege,
        requiredDrainers: (_a = composition.drainers) !== null && _a !== void 0 ? _a : 0,
    };
    return null;
}
function enqueueOp(targetRoom, formation, tactic, composition, homeRoom) {
    var _a;
    const total = composition.melee + composition.ranged + composition.healers + composition.siege;
    if (total <= 0)
        return "squad must have at least one member";
    const allyErr = allyTargetError(targetRoom);
    if (allyErr)
        return allyErr;
    if (!Memory.militaryQueue)
        Memory.militaryQueue = [];
    if (Memory.militaryQueue.some((q) => q.targetRoom === targetRoom)) {
        return `${targetRoom} is already queued`;
    }
    Memory.militaryQueue.push({
        targetRoom,
        homeRoom,
        formation,
        tactic,
        requiredMelee: composition.melee,
        requiredRanged: composition.ranged,
        requiredHealers: composition.healers,
        requiredSiege: composition.siege,
        requiredDrainers: (_a = composition.drainers) !== null && _a !== void 0 ? _a : 0,
        queuedAt: Game.time,
    });
    return null;
}
function dequeueOp(targetRoom) {
    const queue = Memory.militaryQueue;
    if (!queue)
        return false;
    const before = queue.length;
    Memory.militaryQueue = queue.filter((q) => q.targetRoom !== targetRoom);
    return Memory.militaryQueue.length !== before;
}
function allyTargetError(targetRoom) {
    var _a, _b, _c, _d;
    const ctrl = (_a = Game.rooms[targetRoom]) === null || _a === void 0 ? void 0 : _a.controller;
    const intel = (_b = Memory.intel) === null || _b === void 0 ? void 0 : _b[targetRoom];
    const names = [(_c = ctrl === null || ctrl === void 0 ? void 0 : ctrl.owner) === null || _c === void 0 ? void 0 : _c.username, (_d = ctrl === null || ctrl === void 0 ? void 0 : ctrl.reservation) === null || _d === void 0 ? void 0 : _d.username, intel === null || intel === void 0 ? void 0 : intel.owner, intel === null || intel === void 0 ? void 0 : intel.reservedBy];
    const ally = names.find((u) => isAllyPlayer(u));
    return ally ? `${targetRoom} is held by ally ${ally}` : null;
}
function getMilitaryQueue() {
    var _a;
    return (_a = Memory.militaryQueue) !== null && _a !== void 0 ? _a : [];
}
function isCapableOffensiveHome(room) {
    var _a, _b, _c, _d, _e;
    if (!((_a = room.controller) === null || _a === void 0 ? void 0 : _a.my))
        return false;
    if (((_b = room.controller.level) !== null && _b !== void 0 ? _b : 0) < 5)
        return false;
    if (((_d = (_c = room.storage) === null || _c === void 0 ? void 0 : _c.store[RESOURCE_ENERGY]) !== null && _d !== void 0 ? _d : 0) < 50000)
        return false;
    if ((_e = Memory.militaryOps) === null || _e === void 0 ? void 0 : _e[room.name])
        return false;
    return true;
}
function advanceMilitaryQueue() {
    var _a, _b, _c;
    const queue = Memory.militaryQueue;
    if (!queue || queue.length === 0)
        return;
    const posture = (_a = Memory.empire) === null || _a === void 0 ? void 0 : _a.posture;
    if (posture === "TURTLE" || posture === "RECOVER")
        return;
    for (let i = 0; i < queue.length;) {
        const q = queue[i];
        const target = Game.rooms[q.targetRoom];
        if (((_b = target === null || target === void 0 ? void 0 : target.controller) === null || _b === void 0 ? void 0 : _b.my) || allyTargetError(q.targetRoom)) {
            queue.splice(i, 1);
            continue;
        }
        let home;
        if (q.homeRoom) {
            const room = Game.rooms[q.homeRoom];
            if (room && isCapableOffensiveHome(room))
                home = q.homeRoom;
        }
        else {
            let best;
            let bestDist = Infinity;
            for (const rn in Game.rooms) {
                const room = Game.rooms[rn];
                if (!isCapableOffensiveHome(room))
                    continue;
                const d = Game.map.getRoomLinearDistance(rn, q.targetRoom);
                if (d < bestDist) {
                    bestDist = d;
                    best = room;
                }
            }
            home = best === null || best === void 0 ? void 0 : best.name;
        }
        if (!home) {
            i++;
            continue;
        }
        const err = launchOp(q.targetRoom, q.formation, q.tactic, {
            melee: q.requiredMelee, ranged: q.requiredRanged,
            healers: q.requiredHealers, siege: q.requiredSiege,
            drainers: (_c = q.requiredDrainers) !== null && _c !== void 0 ? _c : 0,
        }, home);
        if (err) {
            i++;
            continue;
        }
        queue.splice(i, 1);
        console.log(`[Military] Queue advanced -> ${home} attacking ${q.targetRoom} (${queue.length} still queued)`);
    }
}
function resolveOps(homeRoom) {
    const ops = Memory.militaryOps;
    if (!ops)
        return [];
    if (homeRoom)
        return ops[homeRoom] ? [ops[homeRoom]] : [];
    return Object.values(ops);
}
function setFormation(formation, homeRoom) {
    const ops = resolveOps(homeRoom);
    for (const op of ops)
        op.formation = formation;
    return ops.length;
}
function setTactic(tactic, homeRoom) {
    const ops = resolveOps(homeRoom);
    for (const op of ops) {
        op.tactic = tactic;
        if (tactic === "retreat") {
            op.phase = "retreating";
        }
        else if (op.phase === "retreating") {
            op.phase = "attacking";
        }
    }
    return ops.length;
}
function getOffensiveOps() {
    return Memory.militaryOps ? Object.values(Memory.militaryOps) : [];
}
function isAllyPlayer(username) {
    if (!username)
        return false;
    const allies = Memory.allies;
    return Array.isArray(allies) && allies.includes(username);
}

const INTEL_TTL = 6000;
const WARCOUNCIL_SCAN_INTERVAL = 50;
const AUTO_ATTACK_INTERVAL = 1000;
const AUTO_ATTACK_MAX_THREAT = 4;
const AUTO_ATTACK_MAX_RANGE = 6;
const HOSTILE_MEMORY_TICKS = 20000;
function runWarCouncil() {
    var _a;
    if (!Memory.warCouncil)
        Memory.warCouncil = { autoAttack: false };
    const wc = Memory.warCouncil;
    if (Game.time - ((_a = wc.lastScan) !== null && _a !== void 0 ? _a : 0) >= WARCOUNCIL_SCAN_INTERVAL) {
        scanIntel();
        wc.lastScan = Game.time;
    }
    if (wc.autoAttack) {
        considerAutoAttack(wc);
    }
}
function scanIntel() {
    var _a, _b;
    if (!Memory.intel)
        Memory.intel = {};
    for (const rn in Game.rooms) {
        const room = Game.rooms[rn];
        if ((_a = room.controller) === null || _a === void 0 ? void 0 : _a.my) {
            delete Memory.intel[rn];
            continue;
        }
        recordRoomIntel(room);
    }
    for (const rn in Memory.intel) {
        if (Game.time - ((_b = Memory.intel[rn].lastSeen) !== null && _b !== void 0 ? _b : 0) > INTEL_TTL)
            delete Memory.intel[rn];
    }
    rebuildPlayerModel();
}
function recordRoomIntel(room) {
    var _a, _b, _c, _d, _e, _f, _g;
    if (!Memory.intel)
        Memory.intel = {};
    const rn = room.name;
    const pack = (p) => p.x * 50 + p.y;
    const towerStructs = room.find(FIND_HOSTILE_STRUCTURES, {
        filter: (s) => s.structureType === STRUCTURE_TOWER,
    });
    const spawnStructs = room.find(FIND_HOSTILE_STRUCTURES, {
        filter: (s) => s.structureType === STRUCTURE_SPAWN,
    });
    const { hostiles } = getThreatInfo(room);
    let combatParts = 0;
    let healParts = 0;
    for (const h of hostiles) {
        for (const p of h.body) {
            if (p.type === ATTACK || p.type === RANGED_ATTACK)
                combatParts++;
            if (p.type === HEAL)
                healParts++;
        }
    }
    const sources = room.find(FIND_SOURCES);
    const minerals = room.find(FIND_MINERALS);
    const storage = room.storage;
    const terminal = room.terminal;
    let barrierTotal = 0;
    let barrierMax = 0;
    const barriers = room.find(FIND_STRUCTURES, {
        filter: (s) => s.structureType === STRUCTURE_RAMPART || s.structureType === STRUCTURE_WALL,
    });
    for (const b of barriers) {
        barrierTotal += b.hits;
        if (b.hits > barrierMax)
            barrierMax = b.hits;
    }
    const nonEnergyLoad = (store) => {
        let total = 0;
        for (const r in store) {
            if (r !== RESOURCE_ENERGY)
                total += store[r];
        }
        return total;
    };
    Memory.intel[rn] = {
        roomName: rn,
        lastSeen: Game.time,
        owner: (_b = (_a = room.controller) === null || _a === void 0 ? void 0 : _a.owner) === null || _b === void 0 ? void 0 : _b.username,
        reservedBy: (_d = (_c = room.controller) === null || _c === void 0 ? void 0 : _c.reservation) === null || _d === void 0 ? void 0 : _d.username,
        rcl: (_f = (_e = room.controller) === null || _e === void 0 ? void 0 : _e.level) !== null && _f !== void 0 ? _f : 0,
        towers: towerStructs.length,
        spawns: spawnStructs.length,
        hostileCreeps: hostiles.length,
        hostileCombatParts: combatParts,
        hostileHealParts: healParts,
        safeMode: (_g = room.controller) === null || _g === void 0 ? void 0 : _g.safeMode,
        threatLevel: evaluateRoomThreatLevel(room),
        controllerPos: room.controller ? pack(room.controller.pos) : undefined,
        spawnPos: spawnStructs.length > 0 ? spawnStructs.map((s) => pack(s.pos)) : undefined,
        towerPos: towerStructs.length > 0 ? towerStructs.map((t) => pack(t.pos)) : undefined,
        sourcePos: sources.length > 0 ? sources.map((s) => pack(s.pos)) : undefined,
        storagePos: storage ? pack(storage.pos) : undefined,
        storageEnergy: storage ? storage.store[RESOURCE_ENERGY] : undefined,
        storageMineral: storage ? nonEnergyLoad(storage.store) : undefined,
        terminalPos: terminal ? pack(terminal.pos) : undefined,
        terminalEnergy: terminal ? terminal.store[RESOURCE_ENERGY] : undefined,
        terminalMineral: terminal ? nonEnergyLoad(terminal.store) : undefined,
        barrierHpTotal: barriers.length > 0 ? barrierTotal : undefined,
        barrierHpMax: barriers.length > 0 ? barrierMax : undefined,
        mineralType: minerals.length > 0 ? minerals[0].mineralType : undefined,
    };
}
function rebuildPlayerModel() {
    var _a, _b, _c, _d, _e;
    if (!Memory.intel)
        return;
    if (!Memory.players)
        Memory.players = {};
    const fresh = {};
    for (const rn in Memory.intel) {
        const intel = Memory.intel[rn];
        const owner = intel.owner;
        if (!owner)
            continue;
        const coords = parseRoomCoords(rn);
        if (!coords)
            continue;
        let p = fresh[owner];
        if (!p) {
            p = fresh[owner] = {
                username: owner,
                rooms: [],
                roomCount: 0,
                maxRcl: 0,
                totalTowers: 0,
                totalSpawns: 0,
                militaryStrength: 0,
                economicStrength: 0,
                centroidX: 0,
                centroidY: 0,
                lastSeen: 0,
            };
        }
        if (p.rooms.length < PLAYER_ROOM_CAP)
            p.rooms.push(rn);
        p.roomCount++;
        p.maxRcl = Math.max(p.maxRcl, intel.rcl);
        p.totalTowers += intel.towers;
        p.totalSpawns += intel.spawns;
        p.militaryStrength += roomMilitaryStrength(intel.towers, (_a = intel.barrierHpMax) !== null && _a !== void 0 ? _a : 0, intel.rcl);
        p.economicStrength +=
            Math.floor((((_b = intel.storageEnergy) !== null && _b !== void 0 ? _b : 0) + ((_c = intel.terminalEnergy) !== null && _c !== void 0 ? _c : 0)) / 1000) +
                ((_d = intel.storageMineral) !== null && _d !== void 0 ? _d : 0) + ((_e = intel.terminalMineral) !== null && _e !== void 0 ? _e : 0);
        p.centroidX += coords.x;
        p.centroidY += coords.y;
        p.lastSeen = Math.max(p.lastSeen, intel.lastSeen);
    }
    for (const u in fresh) {
        const p = fresh[u];
        if (p.roomCount > 0) {
            p.centroidX = Math.round(p.centroidX / p.roomCount);
            p.centroidY = Math.round(p.centroidY / p.roomCount);
        }
    }
    const players = Memory.players;
    for (const u in fresh)
        players[u] = fresh[u];
    for (const u in players) {
        if (fresh[u])
            continue;
        if (Game.time - players[u].lastSeen > INTEL_TTL)
            delete players[u];
    }
}
const PLAYER_ROOM_CAP = 30;
function roomMilitaryStrength(towers, barrierHpMax, rcl) {
    return towers * 100 + Math.floor(barrierHpMax / 100000) * 50 + rcl * 10;
}
function ownMilitaryStrength() {
    var _a;
    let total = 0;
    for (const rn in Game.rooms) {
        const room = Game.rooms[rn];
        if (!((_a = room.controller) === null || _a === void 0 ? void 0 : _a.my))
            continue;
        const towers = room.find(FIND_MY_STRUCTURES, {
            filter: (s) => s.structureType === STRUCTURE_TOWER,
        }).length;
        let barrierMax = 0;
        for (const s of room.find(FIND_STRUCTURES)) {
            if (s.structureType !== STRUCTURE_RAMPART && s.structureType !== STRUCTURE_WALL)
                continue;
            if (s.hits > barrierMax)
                barrierMax = s.hits;
        }
        total += roomMilitaryStrength(towers, barrierMax, room.controller.level);
    }
    return total;
}
function parseRoomCoords(roomName) {
    const m = /^([WE])(\d+)([NS])(\d+)$/.exec(roomName);
    if (!m)
        return null;
    const x = m[1] === "W" ? -parseInt(m[2], 10) : parseInt(m[2], 10);
    const y = m[3] === "N" ? -parseInt(m[4], 10) : parseInt(m[4], 10);
    return { x, y };
}
const WAR_ECONOMY_ENERGY = 100000;
const FORTRESS_BARRIER_HP = 5000000;
const NUKE_BARRIER_HP = 8000000;
const NUKE_MIN_TOWERS = 3;
const NUKE_MIN_RCL = 7;
const NUKE_MAX_LAUNCH = 2;
const AUTO_NUKE_INTERVAL = 1000;
const NUKE_ASSAULT_LEAD = 600;
function targetValue(intel) {
    var _a, _b, _c, _d;
    let value = 0;
    value += Math.floor((((_a = intel.storageEnergy) !== null && _a !== void 0 ? _a : 0) + ((_b = intel.terminalEnergy) !== null && _b !== void 0 ? _b : 0)) / 2000);
    value += Math.floor((((_c = intel.storageMineral) !== null && _c !== void 0 ? _c : 0) + ((_d = intel.terminalMineral) !== null && _d !== void 0 ? _d : 0)) / 200);
    value += intel.rcl * 8;
    return Math.max(1, value);
}
function targetEffort(intel, dist) {
    var _a;
    let effort = 1;
    effort += intel.towers * 6;
    effort += Math.floor(((_a = intel.barrierHpMax) !== null && _a !== void 0 ? _a : 0) / 500000);
    effort += intel.threatLevel * 3;
    effort += dist;
    return effort;
}
function considerAutoAttack(wc) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l;
    if (Game.time - ((_a = wc.lastAutoAttackTick) !== null && _a !== void 0 ? _a : 0) < AUTO_ATTACK_INTERVAL)
        return;
    if (!Memory.intel)
        return;
    maintainWarTarget();
    maintainNukedTargets(wc);
    pruneExpired(wc.targetCooldown, (until) => Game.time >= until);
    pruneExpired(wc.hostilePlayers, (seen) => Game.time - seen > HOSTILE_MEMORY_TICKS);
    const posture = (_b = Memory.empire) === null || _b === void 0 ? void 0 : _b.posture;
    if (posture === "TURTLE" || posture === "RECOVER")
        return;
    const ownedRooms = Object.values(Game.rooms).filter((r) => { var _a; return (_a = r.controller) === null || _a === void 0 ? void 0 : _a.my; });
    if (ownedRooms.length === 0)
        return;
    const freeHomes = ownedRooms.filter((r) => isCapableOffensiveHome(r));
    if (freeHomes.length === 0)
        return;
    const myNames = new Set(ownedRooms.map((r) => { var _a, _b; return (_b = (_a = r.controller) === null || _a === void 0 ? void 0 : _a.owner) === null || _b === void 0 ? void 0 : _b.username; }).filter((u) => !!u));
    const capableHomeCount = freeHomes.length;
    let ourStrength;
    let best = null;
    let bestHome = freeHomes[0].name;
    let bestRatio = 0;
    for (const rn in Memory.intel) {
        const intel = Memory.intel[rn];
        if (!intel.owner || myNames.has(intel.owner))
            continue;
        if (isAllyPlayer(intel.owner))
            continue;
        if (onTargetCooldown(wc, rn) || onTargetCooldown(wc, intel.owner))
            continue;
        if (posture !== "WAR" && !wasHostileToUs(wc, intel.owner))
            continue;
        const theirStrength = (_e = (_d = (_c = Memory.players) === null || _c === void 0 ? void 0 : _c[intel.owner]) === null || _d === void 0 ? void 0 : _d.militaryStrength) !== null && _e !== void 0 ? _e : 0;
        ourStrength !== null && ourStrength !== void 0 ? ourStrength : (ourStrength = ownMilitaryStrength());
        if (theirStrength > ourStrength)
            continue;
        if (intel.safeMode)
            continue;
        if (intel.threatLevel > AUTO_ATTACK_MAX_THREAT)
            continue;
        if (nukeInbound(wc, rn))
            continue;
        const home = freeHomes.reduce((b, r) => Game.map.getRoomLinearDistance(r.name, rn) < Game.map.getRoomLinearDistance(b.name, rn) ? r : b);
        const dist = Game.map.getRoomLinearDistance(home.name, rn);
        if (dist > AUTO_ATTACK_MAX_RANGE)
            continue;
        const isFortress = ((_f = intel.barrierHpMax) !== null && _f !== void 0 ? _f : 0) > FORTRESS_BARRIER_HP;
        if (isFortress) {
            const homeRoom = Game.rooms[home.name];
            const homeEnergy = ((_h = (_g = homeRoom === null || homeRoom === void 0 ? void 0 : homeRoom.storage) === null || _g === void 0 ? void 0 : _g.store[RESOURCE_ENERGY]) !== null && _h !== void 0 ? _h : 0) +
                ((_k = (_j = homeRoom === null || homeRoom === void 0 ? void 0 : homeRoom.terminal) === null || _j === void 0 ? void 0 : _j.store[RESOURCE_ENERGY]) !== null && _k !== void 0 ? _k : 0);
            if (capableHomeCount < 2 && homeEnergy < WAR_ECONOMY_ENERGY)
                continue;
        }
        const ratio = targetValue(intel) / targetEffort(intel, dist);
        if (ratio > bestRatio) {
            bestRatio = ratio;
            best = intel;
            bestHome = home.name;
        }
    }
    if (!best)
        return;
    if (isNukeWorthyFortress(best) && considerAutoNuke(wc, best))
        return;
    const fortified = best.towers >= 2 || ((_l = best.barrierHpMax) !== null && _l !== void 0 ? _l : 0) > 1000000;
    const tactic = fortified ? "siege" : "assault";
    const comp = recommendComposition(best.roomName, tactic);
    const err = launchOp(best.roomName, "box", tactic, comp, bestHome);
    if (!err) {
        wc.lastAutoAttackTick = Game.time;
        if (empireEconomyHealthy()) {
            if (!Memory.empire) {
                Memory.empire = { posture: posture !== null && posture !== void 0 ? posture : "EXPAND", updatedAt: Game.time };
            }
            Memory.empire.warTargetRoom = best.roomName;
            Memory.empire.warTargetPlayer = best.owner;
        }
        console.log(`[WarCouncil] Auto-launch (${tactic}): ${bestHome} -> ${best.roomName} ` +
            `(value/effort ${bestRatio.toFixed(2)}, owner ${best.owner})`);
    }
}
function isNukeWorthyFortress(intel) {
    var _a;
    if (!intel.owner)
        return false;
    if (intel.rcl < NUKE_MIN_RCL)
        return false;
    if (intel.towers < NUKE_MIN_TOWERS)
        return false;
    if (((_a = intel.barrierHpMax) !== null && _a !== void 0 ? _a : 0) < NUKE_BARRIER_HP)
        return false;
    return true;
}
function unpackIntelPos(packed, roomName) {
    const x = Math.floor(packed / 50);
    const y = packed % 50;
    if (x < 0 || x > 49 || y < 0 || y > 49)
        return null;
    return new RoomPosition(x, y, roomName);
}
function nukeAimPoints(intel) {
    var _a, _b;
    const packed = [];
    for (const p of (_a = intel.towerPos) !== null && _a !== void 0 ? _a : [])
        packed.push(p);
    for (const p of (_b = intel.spawnPos) !== null && _b !== void 0 ? _b : [])
        packed.push(p);
    if (packed.length === 0 && intel.controllerPos !== undefined)
        packed.push(intel.controllerPos);
    const seen = new Set();
    const out = [];
    for (const p of packed) {
        if (seen.has(p))
            continue;
        seen.add(p);
        const pos = unpackIntelPos(p, intel.roomName);
        if (pos)
            out.push(pos);
        if (out.length >= NUKE_MAX_LAUNCH)
            break;
    }
    return out;
}
function nukeInbound(wc, roomName) {
    var _a;
    const until = (_a = wc.nukedUntil) === null || _a === void 0 ? void 0 : _a[roomName];
    return until !== undefined && Game.time < until;
}
function maintainNukedTargets(wc) {
    const map = wc.nukedUntil;
    if (!map)
        return;
    for (const rn in map) {
        if (Game.time >= map[rn])
            delete map[rn];
    }
}
function pruneExpired(map, expired) {
    if (!map)
        return;
    for (const k in map)
        if (expired(map[k]))
            delete map[k];
}
function considerAutoNuke(wc, intel) {
    var _a, _b, _c;
    try {
        if (nukeInbound(wc, intel.roomName))
            return true;
        if (Game.time - ((_a = wc.lastAutoNukeTick) !== null && _a !== void 0 ? _a : -AUTO_NUKE_INTERVAL) < AUTO_NUKE_INTERVAL) {
            return false;
        }
        const aimPoints = nukeAimPoints(intel);
        if (aimPoints.length === 0)
            return false;
        let launched = 0;
        for (const point of aimPoints) {
            if (launched >= NUKE_MAX_LAUNCH)
                break;
            for (const rn in Game.rooms) {
                const home = Game.rooms[rn];
                if (!((_b = home.controller) === null || _b === void 0 ? void 0 : _b.my))
                    continue;
                const fireErr = launchNukeFrom(rn, point);
                if (!fireErr) {
                    launched++;
                    console.log(`[WarCouncil] Auto-NUKE: ${rn} -> ${intel.roomName} @${point.x},${point.y} ` +
                        `(fortress: ${intel.towers} towers, barrier ${((_c = intel.barrierHpMax) !== null && _c !== void 0 ? _c : 0).toLocaleString()})`);
                    break;
                }
            }
        }
        if (launched === 0)
            return false;
        wc.lastAutoNukeTick = Game.time;
        if (!wc.nukedUntil)
            wc.nukedUntil = {};
        const until = Game.time + Math.max(0, NUKE_LAND_TIME - NUKE_ASSAULT_LEAD);
        wc.nukedUntil[intel.roomName] = until;
        console.log(`[WarCouncil] ${intel.roomName}: ${launched} nuke(s) inbound - assault deferred until tick ${until}`);
        return true;
    }
    catch (e) {
        console.log(`[WarCouncil] Auto-nuke skipped (guarded error): ${String(e)}`);
        return false;
    }
}
function empireEconomyHealthy() {
    var _a, _b, _c, _d, _e;
    for (const rn in Game.rooms) {
        const room = Game.rooms[rn];
        if (!((_a = room.controller) === null || _a === void 0 ? void 0 : _a.my))
            continue;
        const energy = ((_c = (_b = room.storage) === null || _b === void 0 ? void 0 : _b.store[RESOURCE_ENERGY]) !== null && _c !== void 0 ? _c : 0) + ((_e = (_d = room.terminal) === null || _d === void 0 ? void 0 : _d.store[RESOURCE_ENERGY]) !== null && _e !== void 0 ? _e : 0);
        if (energy >= WAR_ECONOMY_ENERGY)
            return true;
    }
    return false;
}
function wasHostileToUs(wc, username) {
    var _a;
    const seen = (_a = wc.hostilePlayers) === null || _a === void 0 ? void 0 : _a[username];
    return seen !== undefined && Game.time - seen <= HOSTILE_MEMORY_TICKS;
}
function maintainWarTarget() {
    var _a, _b, _c, _d;
    const empire = Memory.empire;
    const warRoom = empire === null || empire === void 0 ? void 0 : empire.warTargetRoom;
    if (!empire || !warRoom)
        return;
    const opActive = Memory.militaryOps
        ? Object.values(Memory.militaryOps).some((op) => op.targetRoom === warRoom)
        : false;
    if (opActive)
        return;
    const room = Game.rooms[warRoom];
    const intel = (_a = Memory.intel) === null || _a === void 0 ? void 0 : _a[warRoom];
    const tookIt = ((_b = room === null || room === void 0 ? void 0 : room.controller) === null || _b === void 0 ? void 0 : _b.my) === true;
    const safeNow = ((_d = (_c = room === null || room === void 0 ? void 0 : room.controller) === null || _c === void 0 ? void 0 : _c.safeMode) !== null && _d !== void 0 ? _d : intel === null || intel === void 0 ? void 0 : intel.safeMode) ? true : false;
    if (tookIt || safeNow || !intel) {
        delete empire.warTargetRoom;
        delete empire.warTargetPlayer;
        console.log(`[WarCouncil] War campaign against ${warRoom} ended - clearing war target.`);
    }
}

const REGROUP_HP_THRESHOLD = 0.85;
const CLEARED_TICKS_NEEDED = 10;
const FORMING_TIMEOUT = 1500;
const FRAGMENT_TIMEOUT = 300;
const RETREAT_THRESHOLD$1 = {
    assault: 0.4,
    siege: 0.35,
    raid: 0.55,
    defend: 0.3,
    retreat: 1.1,
};
function loop$i() {
    var _a, _b, _c, _d, _e;
    runWarCouncil();
    runDefenseCouncil();
    requestAllyDefense();
    cleanupDrainOps();
    migrateMilitaryOps();
    const ops = Memory.militaryOps;
    if (!ops)
        return;
    for (const homeRoomName in ops) {
        const op = ops[homeRoomName];
        op.formation = (_a = op.formation) !== null && _a !== void 0 ? _a : "box";
        op.tactic = (_b = op.tactic) !== null && _b !== void 0 ? _b : "assault";
        op.requiredSiege = (_c = op.requiredSiege) !== null && _c !== void 0 ? _c : 0;
        op.requiredDrainers = (_d = op.requiredDrainers) !== null && _d !== void 0 ? _d : 0;
        const homeRoom = Game.rooms[op.homeRoom];
        if (!((_e = homeRoom === null || homeRoom === void 0 ? void 0 : homeRoom.controller) === null || _e === void 0 ? void 0 : _e.my)) {
            removeOp(op);
            continue;
        }
        const members = getSquadMembers(op);
        switch (op.phase) {
            case "forming":
                runForming(op, members);
                break;
            case "rallying":
                runRallying(op, homeRoom, members);
                break;
            case "attacking":
                runAttacking(op, members);
                break;
            case "retreating":
                runRetreating(op, members);
                break;
        }
    }
    advanceMilitaryQueue();
}
function migrateMilitaryOps() {
    if (!Memory.militaryOps)
        Memory.militaryOps = {};
    const legacy = Memory.militaryOp;
    if (legacy) {
        if (!Memory.militaryOps[legacy.homeRoom]) {
            Memory.militaryOps[legacy.homeRoom] = legacy;
        }
        delete Memory.militaryOp;
    }
}
function runForming(op, members) {
    if (Game.time - op.startedAt > FORMING_TIMEOUT) {
        console.log(`[Military] ${op.targetRoom}: Forming timeout - squad could not be assembled, aborting`);
        removeOp(op);
        return;
    }
    if (squadMet(op, members)) {
        if (!squadBoostReady(members))
            return;
        op.phase = "rallying";
        console.log(`[Military] ${op.targetRoom}: Squad formed (${members.length} creeps) - rallying at spawn`);
    }
}
function runRallying(op, homeRoom, members) {
    if (!squadMet(op, members)) {
        op.phase = "forming";
        op.startedAt = Game.time;
        console.log(`[Military] ${op.targetRoom}: Squad incomplete during rally - reforming`);
        return;
    }
    const spawn = homeRoom.find(FIND_MY_SPAWNS)[0];
    if (!spawn)
        return;
    const allRallied = members.every((c) => c.room.name === op.homeRoom && c.pos.getRangeTo(spawn) <= RALLY_RANGE);
    if (allRallied && squadBoostReady(members)) {
        op.phase = "attacking";
        console.log(`[Military] ${op.targetRoom}: Squad rallied - advancing in ${op.formation}/${op.tactic}!`);
    }
}
function runAttacking(op, members) {
    var _a;
    if (members.length === 0) {
        if (abandonAfterFailedAttempt(op, "All squad members lost"))
            return;
        op.phase = "forming";
        op.startedAt = Game.time;
        op.clearedSince = undefined;
        op.regroupSince = undefined;
        console.log(`[Military] ${op.targetRoom}: All squad members lost - reforming`);
        return;
    }
    const ctx = getSquadContext(op);
    if (!ctx.cohesive) {
        if (!op.regroupSince)
            op.regroupSince = Game.time;
        else if (Game.time - op.regroupSince > FRAGMENT_TIMEOUT) {
            op.phase = "retreating";
            op.regroupSince = undefined;
            op.clearedSince = undefined;
            console.log(`[Military] ${op.targetRoom}: Squad fragmented too long - pulling back to regroup`);
            return;
        }
    }
    else {
        op.regroupSince = undefined;
    }
    if (op.tactic !== "retreat" && ctx.avgHpPct < RETREAT_THRESHOLD$1[op.tactic]) {
        op.phase = "retreating";
        op.clearedSince = undefined;
        op.regroupSince = undefined;
        console.log(`[Military] ${op.targetRoom}: Squad at ${Math.round(ctx.avgHpPct * 100)}% - retreating to regroup`);
        return;
    }
    const targetRoom = Game.rooms[op.targetRoom];
    if (!targetRoom) {
        op.clearedSince = undefined;
        return;
    }
    if ((_a = targetRoom.controller) === null || _a === void 0 ? void 0 : _a.safeMode) {
        console.log(`[Military] ${op.targetRoom}: Safe mode active - standing down`);
        removeOp(op);
        return;
    }
    if (op.tactic === "defend")
        return;
    const hostiles = getThreatInfo(targetRoom).hostiles;
    const ownedStructs = targetRoom.find(FIND_HOSTILE_STRUCTURES, {
        filter: (s) => s.structureType !== STRUCTURE_CONTROLLER && s.structureType !== STRUCTURE_RAMPART,
    });
    const cleared = op.tactic === "raid"
        ? hostiles.length === 0 &&
            !ownedStructs.some((s) => s.structureType === STRUCTURE_SPAWN || s.structureType === STRUCTURE_TOWER)
        : hostiles.length === 0 && ownedStructs.length === 0;
    if (cleared) {
        if (!op.clearedSince) {
            op.clearedSince = Game.time;
        }
        else if (Game.time - op.clearedSince >= CLEARED_TICKS_NEEDED) {
            console.log(`[Military] ${op.targetRoom}: Objective complete - standing down.`);
            completeOp(op);
        }
    }
    else {
        op.clearedSince = undefined;
    }
}
function runRetreating(op, members) {
    if (members.length === 0) {
        if (op.tactic === "retreat") {
            removeOp(op);
            return;
        }
        if (abandonAfterFailedAttempt(op, "All squad members lost"))
            return;
        op.phase = "forming";
        op.startedAt = Game.time;
        op.retreatSince = undefined;
        return;
    }
    if (!op.retreatSince)
        op.retreatSince = Game.time;
    const timedOut = Game.time - op.retreatSince > FRAGMENT_TIMEOUT;
    const allHome = members.every((c) => c.room.name === op.homeRoom);
    if (!allHome && !timedOut)
        return;
    const ctx = getSquadContext(op);
    if (ctx.avgHpPct < REGROUP_HP_THRESHOLD && !timedOut)
        return;
    if (op.tactic === "retreat")
        return;
    op.retreatSince = undefined;
    if (squadMet(op, members)) {
        op.phase = "rallying";
        console.log(`[Military] ${op.targetRoom}: Regrouped - re-rallying for another push (${op.tactic})`);
    }
    else {
        if (abandonAfterFailedAttempt(op, "Squad depleted after retreat"))
            return;
        op.phase = "forming";
        op.startedAt = Game.time;
        console.log(`[Military] ${op.targetRoom}: Squad depleted after retreat - reforming`);
    }
}

const REMOTE_RESCAN_INTERVAL = 3000;
const DEVELOPING_SCAN_INTERVAL = 10;
const ESTABLISHED_SCAN_INTERVAL = 100;
const REMOTE_HOSTILE_EXPIRY = 2000;
const SCOUT_BFS_DEPTH = 2;
const SCOUT_REFRESH_INTERVAL = 10000;
const MAX_PENDING_SCOUT_ROOMS = 4;
const BFS_RUN_INTERVAL = 200;
function loop$h() {
    cleanupDeadCreeps();
    initializeMemory();
    for (const roomName in Game.rooms) {
        const room = Game.rooms[roomName];
        processRoomMemory(room);
    }
    processRemoteRoomDiscovery();
    cleanupEstablishedExpansion();
    if (Game.time % ROOM_MEMORY_GC_INTERVAL === 0)
        collectRoomMemoryGarbage();
}
function cleanupDeadCreeps() {
    for (const name in Memory.creeps) {
        if (!Game.creeps[name]) {
            delete Memory.creeps[name];
        }
    }
}
function initializeMemory() {
    if (!Memory.uuid) {
        Memory.uuid = 0;
    }
}
function processRoomMemory(room) {
    if (!room.controller || !room.controller.my)
        return;
    const scanInterval = room.controller.level <= 3 ? DEVELOPING_SCAN_INTERVAL : ESTABLISHED_SCAN_INTERVAL;
    const structureDestroyed = hasStructureDestroyedEvent(room);
    if (structureDestroyed ||
        !room.memory.lastScan ||
        Game.time - room.memory.lastScan > scanInterval) {
        const spawns = room.find(FIND_MY_SPAWNS);
        room.memory.spawnId = spawns.length > 0 ? spawns[0].id : undefined;
        const sources = room.find(FIND_SOURCES);
        room.memory.sourceIds = sources.map((s) => s.id);
        const minerals = room.find(FIND_MINERALS);
        room.memory.mineralId = minerals.length > 0 ? minerals[0].id : undefined;
        const structures = room.find(FIND_STRUCTURES);
        const byType = (type) => structures.filter((s) => s.structureType === type);
        const containers = byType(STRUCTURE_CONTAINER);
        room.memory.containerIds = containers.map((c) => c.id);
        const minerContainerIds = [];
        for (const c of containers) {
            for (const s of sources) {
                if (c.pos.getRangeTo(s.pos) <= 1) {
                    minerContainerIds.push(c.id);
                    break;
                }
            }
        }
        room.memory.minerContainerIds = minerContainerIds;
        if (room.controller) {
            const controllerContainers = containers.filter((c) => c.pos.getRangeTo(room.controller.pos) <= 2);
            if (controllerContainers.length > 0) {
                const closest = room.controller.pos.findClosestByPath(controllerContainers);
                room.memory.upgradeContainerId = closest
                    ? closest.id
                    : undefined;
            }
            else {
                room.memory.upgradeContainerId = undefined;
            }
        }
        const towers = byType(STRUCTURE_TOWER);
        room.memory.towerIds = towers.map((t) => t.id);
        const links = byType(STRUCTURE_LINK);
        room.memory.linkIds = links.map((l) => l.id);
        const terminals = byType(STRUCTURE_TERMINAL);
        room.memory.terminalId =
            terminals.length > 0 ? terminals[0].id : undefined;
        const extractors = byType(STRUCTURE_EXTRACTOR);
        room.memory.extractorId =
            extractors.length > 0 ? extractors[0].id : undefined;
        if (minerals.length > 0) {
            const mineralContainers = containers.filter((c) => c.pos.getRangeTo(minerals[0].pos) <= 1);
            room.memory.mineralContainerId =
                mineralContainers.length > 0
                    ? mineralContainers[0].id
                    : undefined;
        }
        else {
            room.memory.mineralContainerId = undefined;
        }
        const observers = byType(STRUCTURE_OBSERVER);
        room.memory.observerId =
            observers.length > 0 ? observers[0].id : undefined;
        const powerSpawns = byType(STRUCTURE_POWER_SPAWN);
        room.memory.powerSpawnId =
            powerSpawns.length > 0 ? powerSpawns[0].id : undefined;
        room.memory.lastScan = Game.time;
    }
}
function hasStructureDestroyedEvent(room) {
    const raw = room.getEventLog(true);
    if (!raw.includes(`"event":${EVENT_OBJECT_DESTROYED},`))
        return false;
    return JSON.parse(raw).some((e) => e.event === EVENT_OBJECT_DESTROYED && e.data.type !== "creep");
}
function processRemoteRoomDiscovery() {
    var _a;
    for (const roomName in Game.rooms) {
        const room = Game.rooms[roomName];
        if (!((_a = room.controller) === null || _a === void 0 ? void 0 : _a.my))
            continue;
        pruneRemoteRooms(room);
        discoverAdjacentRooms(room);
        discoverDeepRooms(room);
        refreshVisibleRemoteRooms(room);
    }
}
function discoverDeepRooms(room) {
    var _a, _b, _c, _d;
    if (!room.memory.pendingScoutRooms)
        room.memory.pendingScoutRooms = [];
    const last = (_a = room.memory.lastDeepScout) !== null && _a !== void 0 ? _a : 0;
    if (Game.time - last < BFS_RUN_INTERVAL)
        return;
    room.memory.lastDeepScout = Game.time;
    const skip = room.memory.scoutSkipUntil;
    if (skip) {
        for (const rn in skip)
            if (skip[rn] <= Game.time)
                delete skip[rn];
        if (Object.keys(skip).length === 0)
            delete room.memory.scoutSkipUntil;
    }
    if (room.memory.pendingScoutRooms.length >= MAX_PENDING_SCOUT_ROOMS)
        return;
    const ownedNames = new Set(Object.keys(Game.rooms).filter((rn) => { var _a; return (_a = Game.rooms[rn].controller) === null || _a === void 0 ? void 0 : _a.my; }));
    const intel = (_b = Memory.intel) !== null && _b !== void 0 ? _b : {};
    const isFresh = (rn) => {
        var _a;
        const seen = (_a = intel[rn]) === null || _a === void 0 ? void 0 : _a.lastSeen;
        return seen !== undefined && Game.time - seen < SCOUT_REFRESH_INTERVAL;
    };
    const visited = new Set([room.name]);
    let frontier = [room.name];
    for (let depth = 0; depth < SCOUT_BFS_DEPTH; depth++) {
        const next = [];
        for (const current of frontier) {
            const exits = Game.map.describeExits(current);
            for (const dir in exits) {
                const neighbor = exits[dir];
                if (!neighbor || visited.has(neighbor))
                    continue;
                visited.add(neighbor);
                if (ownedNames.has(neighbor)) {
                    next.push(neighbor);
                    continue;
                }
                const status = Game.map.getRoomStatus(neighbor).status;
                if (status === "closed" || status === "novice" || status === "respawn")
                    continue;
                if (isSourceKeeperRoom(neighbor)) {
                    next.push(neighbor);
                    continue;
                }
                next.push(neighbor);
                if (isFresh(neighbor))
                    continue;
                if (((_d = (_c = room.memory.scoutSkipUntil) === null || _c === void 0 ? void 0 : _c[neighbor]) !== null && _d !== void 0 ? _d : 0) > Game.time)
                    continue;
                if (room.memory.pendingScoutRooms.includes(neighbor))
                    continue;
                if (room.memory.pendingScoutRooms.length >= MAX_PENDING_SCOUT_ROOMS)
                    return;
                const route = Game.map.findRoute(room.name, neighbor);
                if (route === ERR_NO_PATH)
                    continue;
                room.memory.pendingScoutRooms.push(neighbor);
            }
        }
        if (next.length === 0)
            break;
        frontier = next;
    }
}
function pruneRemoteRooms(room) {
    const remotes = room.memory.remoteRooms;
    if (!remotes || remotes.length === 0)
        return;
    const adjacent = new Set(Object.values(Game.map.describeExits(room.name)));
    const keep = remotes.filter((r) => { var _a, _b; return adjacent.has(r.roomName) && !((_b = (_a = Game.rooms[r.roomName]) === null || _a === void 0 ? void 0 : _a.controller) === null || _b === void 0 ? void 0 : _b.my); });
    if (keep.length !== remotes.length)
        room.memory.remoteRooms = keep;
}
const FOREIGN_OWNED_RETRY = 20000;
function applyRemoteControllerStatus(entry, controller, me) {
    var _a;
    if (!controller)
        return false;
    if (controller.owner && !controller.my) {
        entry.hostile = true;
        entry.hostileUntil = Game.time + FOREIGN_OWNED_RETRY;
        return true;
    }
    const reserver = (_a = controller.reservation) === null || _a === void 0 ? void 0 : _a.username;
    if (!reserver || reserver === me || reserver === "Invader")
        return false;
    markRemotePlayerHostile(entry, reserver);
    return true;
}
function discoverAdjacentRooms(room) {
    if (!room.memory.pendingScoutRooms)
        room.memory.pendingScoutRooms = [];
    if (!room.memory.remoteRooms)
        room.memory.remoteRooms = [];
    const knownNames = new Set([
        room.name,
        ...room.memory.remoteRooms.map((r) => r.roomName),
        ...room.memory.pendingScoutRooms,
        ...Object.keys(Game.rooms).filter((rn) => { var _a; return (_a = Game.rooms[rn].controller) === null || _a === void 0 ? void 0 : _a.my; }),
    ]);
    room.memory.pendingScoutRooms = room.memory.pendingScoutRooms.filter((rn) => !room.memory.remoteRooms.some((r) => r.roomName === rn));
    for (const remote of room.memory.remoteRooms) {
        const expired = Game.time - remote.lastSeen > REMOTE_RESCAN_INTERVAL;
        const hostileExpired = remote.hostile &&
            remote.hostileUntil !== undefined &&
            Game.time > remote.hostileUntil;
        if ((expired || hostileExpired) && !room.memory.pendingScoutRooms.includes(remote.roomName)) {
            room.memory.pendingScoutRooms.push(remote.roomName);
        }
    }
    const exits = Game.map.describeExits(room.name);
    for (const dir in exits) {
        const adjacentName = exits[dir];
        if (!adjacentName || knownNames.has(adjacentName))
            continue;
        if (isSourceKeeperRoom(adjacentName) || isHighwayRoom$2(adjacentName))
            continue;
        room.memory.pendingScoutRooms.push(adjacentName);
        knownNames.add(adjacentName);
    }
}
function refreshVisibleRemoteRooms(room) {
    var _a, _b;
    if (!room.memory.remoteRooms)
        return;
    for (const remote of room.memory.remoteRooms) {
        const visible = Game.rooms[remote.roomName];
        if (!visible)
            continue;
        remote.lastSeen = Game.time;
        if (applyRemoteControllerStatus(remote, visible.controller, (_b = (_a = room.controller) === null || _a === void 0 ? void 0 : _a.owner) === null || _b === void 0 ? void 0 : _b.username)) {
            continue;
        }
        if (findInvaderCore(visible))
            markRemoteInvader(remote, visible);
        const hostiles = visible.find(FIND_HOSTILE_CREEPS).filter(canDealDamage);
        const player = hostiles.find(isPlayerCreep);
        if (player) {
            markRemotePlayerHostile(remote, player.owner.username);
            continue;
        }
        if (hostiles.some(isInvaderCreep)) {
            clearRemotePlayerHostile(remote);
            markRemoteInvader(remote, visible);
            continue;
        }
        if (hostiles.length > 0) {
            remote.hostile = true;
            remote.hostileUntil = Game.time + REMOTE_HOSTILE_EXPIRY;
            continue;
        }
        clearRemotePlayerHostile(remote);
        const sources = visible.find(FIND_SOURCES);
        for (const source of sources) {
            let entry = remote.sources.find((s) => s.sourceId === source.id);
            if (!entry) {
                entry = { sourceId: source.id };
                remote.sources.push(entry);
            }
            const containers = source.pos.findInRange(FIND_STRUCTURES, 1, {
                filter: (s) => s.structureType === STRUCTURE_CONTAINER,
            });
            entry.containerId = containers.length > 0 ? containers[0].id : undefined;
        }
    }
}
const ROOM_MEMORY_GC_INTERVAL = 1000;
function collectRoomMemoryGarbage() {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l;
    if (!Memory.rooms)
        return;
    const keep = new Set();
    for (const rn in Game.rooms) {
        keep.add(rn);
        const mem = Memory.rooms[rn];
        if (!((_a = Game.rooms[rn].controller) === null || _a === void 0 ? void 0 : _a.my) || !mem)
            continue;
        for (const r of (_b = mem.remoteRooms) !== null && _b !== void 0 ? _b : [])
            keep.add(r.roomName);
        for (const r of (_c = mem.pendingScoutRooms) !== null && _c !== void 0 ? _c : [])
            keep.add(r);
    }
    for (const op of (_d = Memory.skOps) !== null && _d !== void 0 ? _d : [])
        keep.add(op.roomName);
    for (const op of (_e = Memory.powerOps) !== null && _e !== void 0 ? _e : [])
        keep.add(op.roomName);
    for (const op of (_f = Memory.depositOps) !== null && _f !== void 0 ? _f : [])
        keep.add(op.roomName);
    if (Memory.expansion)
        keep.add(Memory.expansion.roomName);
    for (const q of (_g = Memory.expansionQueue) !== null && _g !== void 0 ? _g : [])
        keep.add(q.roomName);
    if (Memory.militaryOp)
        keep.add(Memory.militaryOp.targetRoom);
    for (const k in (_h = Memory.militaryOps) !== null && _h !== void 0 ? _h : {})
        keep.add(Memory.militaryOps[k].targetRoom);
    for (const q of (_j = Memory.militaryQueue) !== null && _j !== void 0 ? _j : [])
        keep.add(q.targetRoom);
    for (const k in (_k = Memory.defenseOps) !== null && _k !== void 0 ? _k : {})
        keep.add(Memory.defenseOps[k].room);
    for (const k in (_l = Memory.drainOps) !== null && _l !== void 0 ? _l : {})
        keep.add(Memory.drainOps[k].targetRoom);
    for (const rn in Memory.rooms) {
        if (keep.has(rn))
            continue;
        const mem = Memory.rooms[rn];
        if ((mem === null || mem === void 0 ? void 0 : mem.plannedStructures) || (mem === null || mem === void 0 ? void 0 : mem.plannedStructuresMeta))
            continue;
        delete Memory.rooms[rn];
    }
}
const EXPANSION_CLEANUP_DELAY = 1000;
function cleanupEstablishedExpansion() {
    const exp = Memory.expansion;
    if (!exp || exp.phase !== "established")
        return;
    if (!exp.establishedAt) {
        exp.establishedAt = Game.time;
        return;
    }
    if (Game.time - exp.establishedAt > EXPANSION_CLEANUP_DELAY) {
        console.log(`[Expansion] Clearing expansion record for ${exp.roomName}`);
        delete Memory.expansion;
    }
}
function isHighwayRoom$2(roomName) {
    const m = roomName.match(/^[WE](\d+)[NS](\d+)$/);
    if (!m)
        return false;
    return parseInt(m[1], 10) % 10 === 0 || parseInt(m[2], 10) % 10 === 0;
}

const SCOUT_HOSTILE_DURATION = 2000;
const SCOUT_TRAVEL_BUDGET = 150;
function runScout(creep) {
    var _a;
    const homeRoom = creep.memory.homeRoom;
    if (!homeRoom) {
        creep.suicide();
        return;
    }
    if (!creep.memory.targetRoom) {
        if (!assignNextRoom(creep, homeRoom)) {
            returnHome(creep, homeRoom);
            return;
        }
    }
    const targetRoom = creep.memory.targetRoom;
    if (creep.room.name !== targetRoom) {
        const exit = creep.room.findExitTo(targetRoom);
        if (exit === ERR_NO_PATH || exit === ERR_INVALID_ARGS) {
            giveUpOnRoom(creep, homeRoom, targetRoom);
            return;
        }
        creep.memory.scoutTravelTicks = ((_a = creep.memory.scoutTravelTicks) !== null && _a !== void 0 ? _a : 0) + 1;
        if (creep.memory.scoutTravelTicks > SCOUT_TRAVEL_BUDGET) {
            giveUpOnRoom(creep, homeRoom, targetRoom);
            return;
        }
        creep.moveTo(new RoomPosition(25, 25, targetRoom), {
            reusePath: 50,
            range: 20,
            visualizePathStyle: {},
        });
        return;
    }
    surveyRoom(creep, homeRoom, targetRoom);
    creep.memory.scoutTravelTicks = 0;
}
function assignNextRoom(creep, homeRoomName) {
    const mem = Memory.rooms[homeRoomName];
    const pending = mem === null || mem === void 0 ? void 0 : mem.pendingScoutRooms;
    if (!pending || pending.length === 0)
        return false;
    const claimed = new Set();
    for (const name in Game.creeps) {
        const c = Game.creeps[name];
        if (c.id === creep.id)
            continue;
        if (c.memory.role === creep.memory.role && c.memory.homeRoom === homeRoomName && c.memory.targetRoom) {
            claimed.add(c.memory.targetRoom);
        }
    }
    const next = pending.find((r) => !claimed.has(r));
    if (!next)
        return false;
    creep.memory.targetRoom = next;
    creep.memory.scoutTravelTicks = 0;
    return true;
}
function giveUpOnRoom(creep, homeRoomName, targetRoomName) {
    markRoomUnreachable(homeRoomName, targetRoomName);
    creep.memory.targetRoom = undefined;
    creep.memory.scoutTravelTicks = 0;
}
function returnHome(creep, homeRoomName) {
    const home = Game.rooms[homeRoomName];
    if (home) {
        const spawn = home.find(FIND_MY_SPAWNS)[0];
        if (spawn) {
            if (!creep.pos.isNearTo(spawn) || creep.room.name !== homeRoomName) {
                creep.moveTo(spawn, { reusePath: 50 });
            }
            else {
                creep.suicide();
            }
            return;
        }
    }
    creep.suicide();
}
function surveyRoom(creep, homeRoomName, targetRoomName) {
    const homeRoomMemory = Memory.rooms[homeRoomName];
    if (!homeRoomMemory)
        return;
    if (!homeRoomMemory.remoteRooms)
        homeRoomMemory.remoteRooms = [];
    const controller = creep.room.controller;
    if (!(controller === null || controller === void 0 ? void 0 : controller.my))
        recordRoomIntel(creep.room);
    if (homeRoomMemory.pendingScoutRooms) {
        homeRoomMemory.pendingScoutRooms = homeRoomMemory.pendingScoutRooms.filter((r) => r !== targetRoomName);
    }
    creep.memory.targetRoom = undefined;
    if (controller === null || controller === void 0 ? void 0 : controller.my) {
        homeRoomMemory.remoteRooms = homeRoomMemory.remoteRooms.filter((r) => r.roomName !== targetRoomName);
        return;
    }
    let entry = homeRoomMemory.remoteRooms.find((r) => r.roomName === targetRoomName);
    if (!entry && !isAdjacent(homeRoomName, targetRoomName))
        return;
    if (!entry) {
        entry = { roomName: targetRoomName, sources: [], lastSeen: Game.time, hostile: false };
        homeRoomMemory.remoteRooms.push(entry);
    }
    entry.lastSeen = Game.time;
    if (applyRemoteControllerStatus(entry, controller, creep.owner.username))
        return;
    const hostiles = creep.room.find(FIND_HOSTILE_CREEPS);
    const sourceKeepers = hostiles.filter((c) => c.owner.username === "Source Keeper");
    const player = hostiles.find((c) => isPlayerCreep(c) && canDealDamage(c));
    if (player) {
        markRemotePlayerHostile(entry, player.owner.username);
    }
    else if (sourceKeepers.length > 0) {
        entry.hostile = true;
        entry.hostileUntil = Game.time + SCOUT_HOSTILE_DURATION;
    }
    else {
        clearRemotePlayerHostile(entry);
        const sources = creep.room.find(FIND_SOURCES);
        entry.sources = sources.map((s) => {
            const existing = entry.sources.find((es) => es.sourceId === s.id);
            return {
                sourceId: s.id,
                containerId: existing === null || existing === void 0 ? void 0 : existing.containerId,
            };
        });
    }
}
function isAdjacent(homeRoomName, roomName) {
    return Object.values(Game.map.describeExits(homeRoomName)).includes(roomName);
}
const UNREACHABLE_RETRY_TICKS = 10000;
function markRoomUnreachable(homeRoomName, targetRoomName) {
    const mem = Memory.rooms[homeRoomName];
    if (!mem)
        return;
    if (mem.pendingScoutRooms) {
        mem.pendingScoutRooms = mem.pendingScoutRooms.filter((r) => r !== targetRoomName);
    }
    if (!mem.remoteRooms)
        mem.remoteRooms = [];
    let entry = mem.remoteRooms.find((r) => r.roomName === targetRoomName);
    if (!entry && !isAdjacent(homeRoomName, targetRoomName)) {
        if (!mem.scoutSkipUntil)
            mem.scoutSkipUntil = {};
        mem.scoutSkipUntil[targetRoomName] = Game.time + UNREACHABLE_RETRY_TICKS;
        return;
    }
    if (!entry) {
        entry = { roomName: targetRoomName, sources: [], lastSeen: Game.time, hostile: true };
        mem.remoteRooms.push(entry);
    }
    entry.lastSeen = Game.time;
    entry.hostile = true;
    entry.hostileUntil = Game.time + UNREACHABLE_RETRY_TICKS;
}

const KILL_CRIES = ["Slain!", "Begone!", "For Crown!", "Next!", "Fell one!"];
let cryTick = -1;
let creepCries = {};
let roomCries = {};
function freshCries() {
    if (cryTick === Game.time)
        return;
    cryTick = Game.time;
    creepCries = {};
    roomCries = {};
}
function cryFor(creep) {
    var _a;
    if (cryTick !== Game.time)
        return undefined;
    return (_a = creepCries[creep.name]) !== null && _a !== void 0 ? _a : roomCries[creep.room.name];
}
function cryFlight(creep) {
    if (creep.memory.fled)
        return;
    creep.memory.fled = true;
    freshCries();
    creepCries[creep.name] = "Bandits!";
}
function settleFlight(creep) {
    if (creep.memory.fled)
        delete creep.memory.fled;
}
function heraldRooms() {
    var _a;
    freshCries();
    heraldFallen();
    heraldRenown();
    heraldTrade();
    heraldSeason();
    heraldSky();
    const castles = [];
    for (const roomName in Game.rooms) {
        const room = Game.rooms[roomName];
        if ((_a = room.controller) === null || _a === void 0 ? void 0 : _a.my) {
            castles.push(room);
            heraldRise(room);
            heraldVisitors(room);
            heraldWorks(room);
        }
        heraldKills(room);
    }
    heraldDragon(castles);
    heraldWolves(castles);
}
function castleList(castles) {
    const names = castles.map((r) => castleName(r.name));
    const last = names.pop();
    return names.length ? `${names.join(", ")} and ${last}` : last;
}
function heraldRenown() {
    const level = Game.gcl.level;
    const known = Memory.heraldGcl;
    Memory.heraldGcl = level;
    if (known === undefined || level <= known)
        return;
    chronicle(`The Crown's renown grows. The realm may now hold ${level} castles.`);
}
const SEASON_TIDINGS = {
    spring: "Spring comes to the realm. The snow melts from the castle walls.",
    summer: "Summer comes to the realm. The days run long on the vendors' roads.",
    autumn: "Autumn comes to the realm. Leaves blow across the wilds.",
    winter: "Winter comes to the realm. Snow settles on the battlements.",
};
function heraldSeason() {
    const season = townSeason(Game.time);
    const known = Memory.heraldSeason;
    Memory.heraldSeason = season;
    if (known === undefined || known === season)
        return;
    const annals = Memory.annals;
    Memory.annals = { since: Game.time, gold: 0, slain: 0, fallen: 0 };
    if (annals)
        chronicle(annalsLine(known, annals));
    const feast = townFeast(Game.time);
    chronicle(feast ? `${SEASON_TIDINGS[season]} The ${feast} begins.` : SEASON_TIDINGS[season]);
}
function annalsLine(season, a) {
    const whole = a.since <= Game.time - TOWN_DAY_LENGTH * TOWN_DAYS_PER_SEASON;
    const when = whole ? "This season" : "Since the scribes took up their pens";
    const slain = a.slain === 0 ? "slew no foe" : `slew ${a.slain} ${a.slain === 1 ? "foe" : "foes"}`;
    const fallen = a.fallen === 0 ? "lost none of its own" : `buried ${a.fallen} of its own`;
    return `So ends the ${season}. ${when} the realm gathered ${formatK(a.gold)} gold, ${slain} and ${fallen}.`;
}
const TRADE_CHECK_PERIOD = 25;
const TRADE_WINDOW = 1500;
const WARES = {
    energy: "gold",
    H: "hydrogen",
    O: "oxygen",
    U: "utrium",
    L: "lemergium",
    K: "keanium",
    Z: "zynthium",
    X: "catalyst",
};
function heraldTrade() {
    var _a, _b, _c, _d;
    if (Game.time % TRADE_CHECK_PERIOD !== 0)
        return;
    const seen = Memory.heraldTradeAt;
    Memory.heraldTradeAt = Game.time - 1;
    if (seen === undefined)
        return;
    const fresh = (t) => t.time > seen && t.time < Game.time;
    for (const t of Game.market.outgoingTransactions) {
        if (fresh(t))
            chronicleTrade(t, "sold", t.from, (_a = t.recipient) === null || _a === void 0 ? void 0 : _a.username, (_b = t.sender) === null || _b === void 0 ? void 0 : _b.username);
    }
    for (const t of Game.market.incomingTransactions) {
        if (fresh(t))
            chronicleTrade(t, "bought", t.to, (_c = t.sender) === null || _c === void 0 ? void 0 : _c.username, (_d = t.recipient) === null || _d === void 0 ? void 0 : _d.username);
    }
}
function chronicleTrade(t, verb, ours, them, us) {
    var _a;
    if (them !== undefined && them === us)
        return;
    const ware = (_a = WARES[t.resourceType]) !== null && _a !== void 0 ? _a : t.resourceType;
    const partner = them ? `the merchants of ${lordName(them)}` : "the free markets";
    const dir = verb === "sold" ? "to" : "from";
    tally(`trade:${verb}:${ours}:${them !== null && them !== void 0 ? them : ""}:${t.resourceType}`, t.amount, (n) => `${castleName(ours)} ${verb} ${n} ${ware} ${dir} ${partner}.`, TRADE_WINDOW);
}
const VISIT_WINDOW = 1500;
function heraldVisitors(room) {
    for (const c of room.find(FIND_HOSTILE_CREEPS)) {
        if (!isPlayerCreep(c))
            continue;
        const who = c.owner.username;
        const armed = c.body.some((p) => p.type === ATTACK || p.type === RANGED_ATTACK || p.type === WORK);
        const text = armed
            ? `A war party of ${lordName(who)} came in arms to the walls of ${castleName(room.name)}.`
            : `Spies of ${lordName(who)} crept about ${castleName(room.name)}.`;
        tally(`visit:${room.name}:${who}:${armed ? "war" : "spy"}`, 0, () => text, VISIT_WINDOW);
    }
}
const WORKS_CHECK_PERIOD = 100;
const WORKS_WINDOW = 1500;
function heraldWorks(room) {
    var _a, _b, _c;
    if (Game.time % WORKS_CHECK_PERIOD !== 0)
        return;
    const counts = {};
    for (const s of room.find(FIND_MY_STRUCTURES)) {
        if (LANDMARKS[s.structureType])
            counts[s.structureType] = ((_a = counts[s.structureType]) !== null && _a !== void 0 ? _a : 0) + 1;
    }
    const known = room.memory.heraldWorks;
    room.memory.heraldWorks = counts;
    if (!known)
        return;
    for (const type of Object.keys(LANDMARKS)) {
        const gained = ((_b = counts[type]) !== null && _b !== void 0 ? _b : 0) - ((_c = known[type]) !== null && _c !== void 0 ? _c : 0);
        if (gained <= 0)
            continue;
        const [one, many] = LANDMARKS[type];
        const a = /^[aeiou]/.test(one) ? "an" : "a";
        tally(`works:${room.name}:${type}`, gained, (n) => `The masons of ${castleName(room.name)} raise ${n === 1 ? `${a} ${one}` : `${n} ${many}`}.`, WORKS_WINDOW);
    }
}
const DRAGON_CRIES = ["Dragon!", "Look up!", "Hide!", "Run!", "Dragon!!"];
const DRAGON_CRY_PERIOD = 8;
const DRAGON_TIDINGS = [
    (c) => `A dragon passed over ${c}, black against the sky.`,
    (c) => `A dragon crossed the skies of ${c} and was gone.`,
    (c) => `The shadow of a dragon fell across ${c}.`,
];
function heraldDragon(castles) {
    const dragon = townDragon(Game.time);
    if (castles.length === 0 || !dragon || dragon.t % DRAGON_CRY_PERIOD !== 0)
        return;
    for (const room of castles)
        roomCries[room.name] = DRAGON_CRIES[(dragon.t / DRAGON_CRY_PERIOD) % DRAGON_CRIES.length];
    if (dragon.t === 0)
        chronicle(DRAGON_TIDINGS[dragon.day % DRAGON_TIDINGS.length](castleList(castles)));
}
const HOWL_CRIES = ["Wolves!", "Hark!", "Hear that?", "Awoo?!"];
function heraldWolves(castles) {
    const howl = townHowl(Game.time);
    if (castles.length === 0 || !howl || howl.t !== 0)
        return;
    for (const room of castles)
        roomCries[room.name] = HOWL_CRIES[howl.n % HOWL_CRIES.length];
    if (howl.n === 0)
        chronicle(`Wolves howled beneath the full moon outside the walls of ${castleList(castles)}.`);
}
const AURORA_TIDINGS = [
    "The northern lights burned green over the realm.",
    "Green fire danced in the winter sky. The old folk say the dead were dancing.",
    "Ribbons of light rippled over the battlements all night long.",
];
function heraldSky() {
    if (Game.time % TOWN_DAY_LENGTH !== NIGHT_START || !townAurora(Game.time))
        return;
    chronicle(AURORA_TIDINGS[Math.floor(Game.time / TOWN_DAY_LENGTH) % AURORA_TIDINGS.length]);
}
function heraldRise(room) {
    const level = room.controller.level;
    const known = room.memory.heraldLevel;
    room.memory.heraldLevel = level;
    if (known === undefined || level <= known)
        return;
    roomCries[room.name] = "Long live!";
    chronicle(`Hear ye! ${castleName(room.name)} rises to level ${level}. Long live the Crown!`);
}
const BATTLE_WINDOW = 300;
function whereIn(roomName) {
    var _a, _b;
    return ((_b = (_a = Game.rooms[roomName]) === null || _a === void 0 ? void 0 : _a.controller) === null || _b === void 0 ? void 0 : _b.my)
        ? `before the walls of ${castleName(roomName)}`
        : `in the ${wildsName(roomName)}`;
}
function chronicleKill(room) {
    const foe = isSourceKeeperRoom(room.name) ? "lair keeper" : "raider";
    annal("slain", 1);
    tally(`slain:${room.name}`, 1, (n) => `${n === 1 ? "A" : n} ${foe}${n === 1 ? "" : "s"} fell ${whereIn(room.name)}.`, BATTLE_WINDOW);
}
let muster = new Map();
function foeIn(roomName) {
    var _a, _b;
    const hostiles = (_b = (_a = Game.rooms[roomName]) === null || _a === void 0 ? void 0 : _a.find(FIND_HOSTILE_CREEPS)) !== null && _b !== void 0 ? _b : [];
    const player = hostiles.find(isPlayerCreep);
    if (player)
        return `the men of ${lordName(player.owner.username)}`;
    if (hostiles.length === 0)
        return undefined;
    return isSourceKeeperRoom(roomName) ? "a lair keeper" : "raiders";
}
function heraldFallen() {
    var _a;
    const next = new Map();
    for (const name in Game.creeps) {
        const c = Game.creeps[name];
        if (c.spawning)
            continue;
        next.set(name, { room: c.pos.roomName, hurt: c.hits < c.hitsMax, ttl: (_a = c.ticksToLive) !== null && _a !== void 0 ? _a : 0 });
    }
    for (const [name, last] of muster) {
        if (next.has(name) || !last.hurt || last.ttl <= 1)
            continue;
        const foe = foeIn(last.room);
        const by = foe ? ` to ${foe}` : "";
        annal("fallen", 1);
        tally(`fallen:${last.room}`, 1, (n) => `${n === 1 ? name : `${n} of the realm's own`} fell${by} ${whereIn(last.room)}.`, BATTLE_WINDOW);
    }
    muster = next;
}
function heraldKills(room) {
    const raw = room.getEventLog(true);
    if (!raw.includes(`"event":${EVENT_OBJECT_DESTROYED},`))
        return;
    const events = JSON.parse(raw);
    for (const e of events) {
        if (e.event !== EVENT_OBJECT_DESTROYED || e.data.type !== "creep")
            continue;
        const ours = events
            .filter((a) => a.event === EVENT_ATTACK && a.data.targetId === e.objectId)
            .map((a) => Game.getObjectById(a.objectId))
            .filter((o) => !!o && o.my);
        if (ours.length === 0)
            continue;
        chronicleKill(room);
        const creeps = ours.filter((o) => o instanceof Creep);
        if (creeps.length === 0) {
            roomCries[room.name] = "Huzzah!";
            continue;
        }
        for (const c of creeps)
            creepCries[c.name] = KILL_CRIES[(Game.time + c.name.length) % KILL_CRIES.length];
    }
}

const REMOTE_DAMAGE_BACKOFF$1 = 300;
function runRemoteMiner(creep) {
    const { targetRoom, homeRoom, remoteSourceId } = creep.memory;
    if (!targetRoom || !homeRoom || !remoteSourceId) {
        creep.suicide();
        return;
    }
    const tookDamage = creep.memory._hp !== undefined && creep.hits < creep.memory._hp;
    creep.memory._hp = creep.hits;
    if (tookDamage && creep.room.name !== homeRoom) {
        creep.memory.remoteBackoffUntil = Game.time + REMOTE_DAMAGE_BACKOFF$1;
        if (creep.room.name === targetRoom)
            flagRemoteDamage(creep);
    }
    if (creep.memory.remoteBackoffUntil && creep.memory.remoteBackoffUntil > Game.time) {
        if (creep.room.name !== homeRoom)
            moveToRoom$6(creep, homeRoom);
        return;
    }
    const inTarget = creep.room.name === targetRoom;
    const threat = inTarget ? getThreatInfo(creep.room) : null;
    const core = inTarget ? findInvaderCore(creep.room) : null;
    if (core)
        flagRemoteInvader(creep);
    else if (threat && threat.score > 0) {
        if (threat.hostiles.some(isInvaderCreep))
            flagRemoteInvader(creep);
        else if (threat.hostiles.some(isPlayerCreep))
            flagRemotePlayer(creep);
    }
    if (isAssignedRemoteContested(creep) || (threat && threat.score > 0)) {
        cryFlight(creep);
        if (creep.room.name !== homeRoom)
            moveToRoom$6(creep, homeRoom);
        return;
    }
    settleFlight(creep);
    if (inTarget && !core)
        clearRemoteInvader(creep);
    if (creep.room.name !== targetRoom) {
        moveToRoom$6(creep, targetRoom);
        return;
    }
    const source = Game.getObjectById(remoteSourceId);
    if (!source) {
        creep.memory.remoteSourceId = undefined;
        return;
    }
    const container = findOrUpdateContainer(creep, source);
    if (container) {
        if (!creep.pos.isEqualTo(container.pos)) {
            creep.moveTo(container, { reusePath: 30 });
            if (creep.pos.isNearTo(source))
                harvest$1(creep, source);
            return;
        }
        if (container.hits < container.hitsMax * 0.5 && creep.store[RESOURCE_ENERGY] > 0) {
            creep.repair(container);
            return;
        }
        harvest$1(creep, source);
    }
    else {
        const site = source.pos.findInRange(FIND_MY_CONSTRUCTION_SITES, 1, {
            filter: (s) => s.structureType === STRUCTURE_CONTAINER,
        })[0];
        if (site && creep.store[RESOURCE_ENERGY] > 0) {
            if (creep.build(site) === ERR_NOT_IN_RANGE)
                creep.moveTo(site, { reusePath: 30 });
            return;
        }
        if (harvest$1(creep, source) === ERR_NOT_IN_RANGE) {
            creep.moveTo(source, { reusePath: 30 });
        }
    }
}
function harvest$1(creep, source) {
    var _a, _b;
    const res = creep.harvest(source);
    if (res === ERR_NOT_OWNER) {
        if (((_b = (_a = creep.room.controller) === null || _a === void 0 ? void 0 : _a.reservation) === null || _b === void 0 ? void 0 : _b.username) === "Invader") {
            creep.memory.remoteBackoffUntil = Game.time + REMOTE_DAMAGE_BACKOFF$1;
        }
        else {
            flagRemotePlayer(creep);
        }
    }
    return res;
}
function moveToRoom$6(creep, targetRoom) {
    creep.moveTo(new RoomPosition(25, 25, targetRoom), { reusePath: 30, range: 20 });
}
function findOrUpdateContainer(creep, source) {
    if (creep.memory.assignedContainerId) {
        const cached = Game.getObjectById(creep.memory.assignedContainerId);
        if (cached)
            return cached;
        creep.memory.assignedContainerId = undefined;
    }
    const containers = source.pos.findInRange(FIND_STRUCTURES, 1, {
        filter: (s) => s.structureType === STRUCTURE_CONTAINER,
    });
    if (containers.length === 0)
        return null;
    const container = containers[0];
    creep.memory.assignedContainerId = container.id;
    updateRemoteContainerMemory(creep, source, container);
    return container;
}
function updateRemoteContainerMemory(creep, source, container) {
    const homeMemory = Memory.rooms[creep.memory.homeRoom];
    if (!(homeMemory === null || homeMemory === void 0 ? void 0 : homeMemory.remoteRooms))
        return;
    const remoteEntry = homeMemory.remoteRooms.find((r) => r.roomName === creep.room.name);
    if (!remoteEntry)
        return;
    const sourceEntry = remoteEntry.sources.find((s) => s.sourceId === source.id);
    if (sourceEntry)
        sourceEntry.containerId = container.id;
}

const REMOTE_DAMAGE_BACKOFF = 300;
function runRemoteHauler(creep) {
    var _a;
    const { targetRoom, homeRoom } = creep.memory;
    if (!targetRoom || !homeRoom) {
        creep.suicide();
        return;
    }
    const tookDamage = creep.memory._hp !== undefined && creep.hits < creep.memory._hp;
    creep.memory._hp = creep.hits;
    if (tookDamage && creep.room.name !== homeRoom) {
        creep.memory.remoteBackoffUntil = Game.time + REMOTE_DAMAGE_BACKOFF;
        if (creep.room.name === targetRoom)
            flagRemoteDamage(creep);
    }
    if (creep.memory.remoteBackoffUntil && creep.memory.remoteBackoffUntil > Game.time) {
        if (creep.store[RESOURCE_ENERGY] > 0)
            depositEnergy(creep, homeRoom);
        else if (creep.room.name !== homeRoom)
            moveToRoom$5(creep, homeRoom);
        return;
    }
    const inTarget = creep.room.name === targetRoom;
    const threat = inTarget ? getThreatInfo(creep.room) : null;
    const core = inTarget ? findInvaderCore(creep.room) : null;
    if (core)
        flagRemoteInvader(creep);
    else if (threat && threat.score > 0) {
        if (threat.hostiles.some(isInvaderCreep))
            flagRemoteInvader(creep);
        else if (threat.hostiles.some(isPlayerCreep))
            flagRemotePlayer(creep);
    }
    if (isAssignedRemoteContested(creep) || (threat && threat.score > 0)) {
        cryFlight(creep);
        if (creep.store[RESOURCE_ENERGY] > 0) {
            depositEnergy(creep, homeRoom);
        }
        else if (creep.room.name !== homeRoom) {
            moveToRoom$5(creep, homeRoom);
        }
        return;
    }
    settleFlight(creep);
    if (inTarget && !core)
        clearRemoteInvader(creep);
    if (creep.memory.working && creep.store[RESOURCE_ENERGY] === 0) {
        creep.memory.working = false;
    }
    else if (!creep.memory.working &&
        (creep.store.getFreeCapacity(RESOURCE_ENERGY) === 0 ||
            (creep.store[RESOURCE_ENERGY] > 0 && ((_a = creep.ticksToLive) !== null && _a !== void 0 ? _a : Infinity) < 150))) {
        creep.memory.working = true;
    }
    if (!creep.memory.working) {
        collectEnergy(creep, targetRoom);
    }
    else {
        if (creep.room.name !== homeRoom)
            tendRemoteRoad(creep);
        depositEnergy(creep, homeRoom);
    }
}
const ROAD_REPAIR_THRESHOLD = 0.8;
function tendRemoteRoad(creep) {
    if (creep.store[RESOURCE_ENERGY] === 0)
        return;
    if (!creep.body.some((p) => p.type === WORK && p.hits > 0))
        return;
    const road = creep.pos
        .lookFor(LOOK_STRUCTURES)
        .find((s) => s.structureType === STRUCTURE_ROAD && s.hits < s.hitsMax * ROAD_REPAIR_THRESHOLD);
    if (road) {
        creep.repair(road);
        return;
    }
    const site = creep.pos.findInRange(FIND_MY_CONSTRUCTION_SITES, 3, {
        filter: (s) => s.structureType === STRUCTURE_ROAD,
    })[0];
    if (site)
        creep.build(site);
}
function collectEnergy(creep, targetRoom) {
    if (creep.room.name !== targetRoom) {
        moveToRoom$5(creep, targetRoom);
        return;
    }
    const container = findBestContainer(creep);
    const dropped = creep.pos.findClosestByRange(FIND_DROPPED_RESOURCES, {
        filter: (d) => d.resourceType === RESOURCE_ENERGY &&
            d.amount >= 50 &&
            (!container || d.pos.inRangeTo(container, 1)),
    });
    if (container && !dropped) {
        const res = creep.withdraw(container, RESOURCE_ENERGY);
        if (res === ERR_NOT_IN_RANGE)
            creep.moveTo(container, { reusePath: 30 });
        return;
    }
    if (dropped) {
        const res = creep.pickup(dropped);
        if (res === ERR_NOT_IN_RANGE)
            creep.moveTo(dropped, { reusePath: 10 });
        return;
    }
    const source = creep.room.find(FIND_SOURCES)[0];
    if (source && creep.pos.getRangeTo(source) > 3) {
        creep.moveTo(source, { reusePath: 30 });
    }
}
function findBestContainer(creep) {
    var _a;
    const homeMemory = Memory.rooms[creep.memory.homeRoom];
    const remoteEntry = (_a = homeMemory === null || homeMemory === void 0 ? void 0 : homeMemory.remoteRooms) === null || _a === void 0 ? void 0 : _a.find((r) => r.roomName === creep.room.name);
    if (remoteEntry) {
        const candidates = [];
        for (const sourceData of remoteEntry.sources) {
            if (!sourceData.containerId)
                continue;
            const c = Game.getObjectById(sourceData.containerId);
            if (c && c.store[RESOURCE_ENERGY] > 0)
                candidates.push(c);
        }
        if (candidates.length > 0) {
            return candidates.reduce((a, b) => a.store[RESOURCE_ENERGY] > b.store[RESOURCE_ENERGY] ? a : b);
        }
    }
    const sources = creep.room.find(FIND_SOURCES);
    for (const source of sources) {
        const containers = source.pos.findInRange(FIND_STRUCTURES, 1, {
            filter: (s) => s.structureType === STRUCTURE_CONTAINER &&
                s.store[RESOURCE_ENERGY] > 0,
        });
        if (containers.length > 0)
            return containers[0];
    }
    return null;
}
function depositEnergy(creep, homeRoom) {
    if (creep.room.name !== homeRoom) {
        moveToRoom$5(creep, homeRoom);
        return;
    }
    const storage = creep.room.storage;
    if (storage && storage.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
        const res = creep.transfer(storage, RESOURCE_ENERGY);
        if (res === ERR_NOT_IN_RANGE)
            creep.moveTo(storage, { reusePath: 50 });
        return;
    }
    const fillTargets = creep.room.find(FIND_STRUCTURES, {
        filter: (s) => (s.structureType === STRUCTURE_SPAWN ||
            s.structureType === STRUCTURE_EXTENSION) &&
            "store" in s &&
            s.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
    });
    if (fillTargets.length > 0) {
        const target = creep.pos.findClosestByRange(fillTargets);
        const res = creep.transfer(target, RESOURCE_ENERGY);
        if (res === ERR_NOT_IN_RANGE)
            creep.moveTo(target, { reusePath: 50 });
        return;
    }
    const towers = creep.room.find(FIND_STRUCTURES, {
        filter: (s) => s.structureType === STRUCTURE_TOWER &&
            s.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
    });
    if (towers.length > 0) {
        const tower = creep.pos.findClosestByRange(towers);
        const res = creep.transfer(tower, RESOURCE_ENERGY);
        if (res === ERR_NOT_IN_RANGE)
            creep.moveTo(tower, { reusePath: 50 });
        return;
    }
    putSurplusEnergyToWork(creep);
}
function moveToRoom$5(creep, targetRoom) {
    creep.moveTo(new RoomPosition(25, 25, targetRoom), { reusePath: 30, range: 20 });
}

function runReserver(creep) {
    var _a;
    const { targetRoom, homeRoom } = creep.memory;
    if (!targetRoom || !homeRoom) {
        creep.suicide();
        return;
    }
    if (creep.room.name !== targetRoom) {
        moveToRoom$4(creep, targetRoom);
        return;
    }
    const controller = creep.room.controller;
    if (!controller || controller.owner) {
        creep.suicide();
        return;
    }
    const reservedBy = (_a = controller.reservation) === null || _a === void 0 ? void 0 : _a.username;
    const result = reservedBy && reservedBy !== creep.owner.username
        ? creep.attackController(controller)
        : creep.reserveController(controller);
    if (result === ERR_NOT_IN_RANGE) {
        creep.moveTo(controller, { reusePath: 30 });
        return;
    }
    signControllerIfNeeded(creep, controller);
}
function moveToRoom$4(creep, targetRoom) {
    creep.moveTo(new RoomPosition(25, 25, targetRoom), { reusePath: 30, range: 20 });
}

const RETREAT_THRESHOLD = 0.2;
function runKnight(creep) {
    var _a;
    const underImmediateThreat = creep.pos
        .findInRange(FIND_HOSTILE_CREEPS, 8)
        .some((c) => { var _a; return !isAlly((_a = c.owner) === null || _a === void 0 ? void 0 : _a.username); });
    if (!underImmediateThreat &&
        (creep.memory.boostCompound || ((_a = creep.memory.boostQueue) === null || _a === void 0 ? void 0 : _a.length)) &&
        seekBoost(creep)) {
        return;
    }
    if (creep.memory.offensiveTarget) {
        const op = getOffensiveOp(creep.memory.offensiveTarget, creep.memory.homeRoom);
        if (op) {
            runOffensiveKnight(creep, op);
            return;
        }
        delete creep.memory.offensiveTarget;
    }
    if (creep.memory.defensiveTarget) {
        if (getDefenseOp(creep.memory.defensiveTarget)) {
            runDefensiveKnight(creep, creep.memory.defensiveTarget);
            return;
        }
        delete creep.memory.defensiveTarget;
    }
    const target = creep.memory.targetRoom;
    const home = creep.memory.homeRoom;
    if (target && creep.room.name !== target && isAssignedRemoteInvaded(creep)) {
        creep.moveTo(new RoomPosition(25, 25, target), { reusePath: 20 });
        return;
    }
    if (target && home && creep.room.name !== home && creep.room.name !== target) {
        creep.moveTo(new RoomPosition(25, 25, home), { reusePath: 20 });
        return;
    }
    if (creep.hits < creep.hitsMax * RETREAT_THRESHOLD) {
        const cleric = creep.pos.findClosestByRange(FIND_MY_CREEPS, {
            filter: (c) => c.memory.role === ROLE_CLERIC && !c.spawning,
        });
        const refuge = cleric !== null && cleric !== void 0 ? cleric : creep.room.find(FIND_MY_SPAWNS)[0];
        if (refuge) {
            if (!creep.pos.isNearTo(refuge))
                creep.moveTo(refuge, { reusePath: 5 });
            return;
        }
    }
    const hostile = creep.pos.findClosestByRange(FIND_HOSTILE_CREEPS, {
        filter: (c) => { var _a; return !isAlly((_a = c.owner) === null || _a === void 0 ? void 0 : _a.username); },
    });
    if (hostile) {
        if (creep.attack(hostile) === ERR_NOT_IN_RANGE) {
            creep.moveTo(hostile, { reusePath: 3 });
        }
        return;
    }
    const core = findInvaderCore(creep.room);
    if (core) {
        if (creep.attack(core) === ERR_NOT_IN_RANGE) {
            creep.moveTo(core, { reusePath: 3 });
        }
        return;
    }
    if (target && target === creep.room.name) {
        clearRemoteInvader(creep);
        if (home && home !== target) {
            creep.moveTo(new RoomPosition(25, 25, home), { reusePath: 20 });
            return;
        }
    }
    if (parkIdle(creep, "watch"))
        return;
    const spawn = creep.room.find(FIND_MY_SPAWNS)[0];
    if (spawn && !creep.pos.isNearTo(spawn)) {
        creep.moveTo(spawn, { reusePath: 20 });
    }
}

const KITE_RANGE$1 = 3;
function runWizard(creep) {
    var _a;
    if ((creep.memory.boostCompound || ((_a = creep.memory.boostQueue) === null || _a === void 0 ? void 0 : _a.length)) && seekBoost(creep))
        return;
    if (creep.memory.offensiveTarget) {
        const op = getOffensiveOp(creep.memory.offensiveTarget, creep.memory.homeRoom);
        if (op) {
            runOffensiveWizard(creep, op);
            return;
        }
        delete creep.memory.offensiveTarget;
    }
    if (creep.memory.defensiveTarget) {
        if (getDefenseOp(creep.memory.defensiveTarget)) {
            runDefensiveWizard(creep, creep.memory.defensiveTarget);
            return;
        }
        delete creep.memory.defensiveTarget;
    }
    const notAlly = (c) => { var _a; return !isAlly((_a = c.owner) === null || _a === void 0 ? void 0 : _a.username); };
    const hostile = creep.pos.findClosestByRange(FIND_HOSTILE_CREEPS, { filter: notAlly });
    if (!hostile) {
        if (parkIdle(creep, "watch"))
            return;
        const spawn = creep.room.find(FIND_MY_SPAWNS)[0];
        if (spawn && !creep.pos.isNearTo(spawn)) {
            creep.moveTo(spawn, { reusePath: 20 });
        }
        return;
    }
    const range = creep.pos.getRangeTo(hostile);
    const inRangeHostiles = creep.pos.findInRange(FIND_HOSTILE_CREEPS, KITE_RANGE$1, { filter: notAlly });
    if (preferMassAttack(creep.pos, inRangeHostiles) && !allyInMassAttackRange(creep.pos)) {
        creep.rangedMassAttack();
    }
    else if (range <= KITE_RANGE$1) {
        creep.rangedAttack(hostile);
    }
    if (range < KITE_RANGE$1) {
        creep.move(hostile.pos.getDirectionTo(creep.pos));
    }
    else if (range > KITE_RANGE$1) {
        creep.moveTo(hostile, { range: KITE_RANGE$1, reusePath: 5 });
    }
}

const SELF_HEAL_THRESHOLD = 0.5;
const FRONTLINE_ROLES = new Set([ROLE_KNIGHT, ROLE_WIZARD]);
function runCleric(creep) {
    var _a;
    const underImmediateThreat = creep.pos
        .findInRange(FIND_HOSTILE_CREEPS, 8)
        .some((c) => { var _a; return !isAlly((_a = c.owner) === null || _a === void 0 ? void 0 : _a.username); });
    if (!underImmediateThreat &&
        (creep.memory.boostCompound || ((_a = creep.memory.boostQueue) === null || _a === void 0 ? void 0 : _a.length)) &&
        seekBoost(creep)) {
        return;
    }
    if (creep.memory.offensiveTarget) {
        const op = getOffensiveOp(creep.memory.offensiveTarget, creep.memory.homeRoom);
        if (op) {
            runOffensiveCleric(creep, op);
            return;
        }
        delete creep.memory.offensiveTarget;
    }
    if (creep.memory.defensiveTarget) {
        if (getDefenseOp(creep.memory.defensiveTarget)) {
            runDefensiveCleric(creep, creep.memory.defensiveTarget);
            return;
        }
        delete creep.memory.defensiveTarget;
    }
    if (creep.hits < creep.hitsMax * SELF_HEAL_THRESHOLD) {
        creep.heal(creep);
        const spawn = creep.room.find(FIND_MY_SPAWNS)[0];
        if (spawn && !creep.pos.isNearTo(spawn)) {
            creep.moveTo(spawn, { reusePath: 5 });
        }
        return;
    }
    const wounded = creep.room.find(FIND_MY_CREEPS, {
        filter: (c) => c.hits < c.hitsMax,
    });
    if (wounded.length === 0) {
        if (parkIdle(creep, "watch"))
            return;
        const spawn = creep.room.find(FIND_MY_SPAWNS)[0];
        if (spawn && !creep.pos.isNearTo(spawn)) {
            creep.moveTo(spawn, { reusePath: 20 });
        }
        return;
    }
    const fighters = wounded.filter((c) => FRONTLINE_ROLES.has(c.memory.role));
    const target = (fighters.length > 0 ? fighters : wounded).reduce((a, b) => a.hits / a.hitsMax < b.hits / b.hitsMax ? a : b);
    const range = creep.pos.getRangeTo(target);
    if (range <= 1) {
        creep.heal(target);
    }
    else {
        if (range <= 3)
            creep.rangedHeal(target);
        creep.moveTo(target, { reusePath: 5 });
    }
}

function runSieger(creep) {
    var _a;
    if ((creep.memory.boostCompound || ((_a = creep.memory.boostQueue) === null || _a === void 0 ? void 0 : _a.length)) && seekBoost(creep))
        return;
    if (creep.memory.offensiveTarget) {
        const op = getOffensiveOp(creep.memory.offensiveTarget, creep.memory.homeRoom);
        if (op) {
            runOffensiveSieger(creep, op);
            return;
        }
        delete creep.memory.offensiveTarget;
    }
    const spawn = creep.room.find(FIND_MY_SPAWNS)[0];
    if (spawn && !creep.pos.isNearTo(spawn)) {
        creep.moveTo(spawn, { reusePath: 20 });
    }
}

function runDrainer(creep) {
    var _a;
    if ((creep.memory.boostCompound || ((_a = creep.memory.boostQueue) === null || _a === void 0 ? void 0 : _a.length)) && seekBoost(creep))
        return;
    if (creep.memory.offensiveTarget) {
        const op = getOffensiveOp(creep.memory.offensiveTarget, creep.memory.homeRoom);
        if (op) {
            runOffensiveDrainer(creep, op);
            return;
        }
        const drain = getDrainOp(creep.memory.offensiveTarget);
        if (drain) {
            runStandaloneDrainer(creep, drain);
            return;
        }
        delete creep.memory.offensiveTarget;
    }
    const spawn = creep.room.find(FIND_MY_SPAWNS)[0];
    if (spawn && !creep.pos.isNearTo(spawn)) {
        creep.moveTo(spawn, { reusePath: 20 });
    }
}

const RETREAT_HOLD_TICKS$3 = 50;
function runConqueror(creep) {
    var _a, _b, _c;
    const targetRoom = creep.memory.targetRoom;
    if (!targetRoom) {
        creep.suicide();
        return;
    }
    if (((_a = Memory.expansion) === null || _a === void 0 ? void 0 : _a.roomName) !== targetRoom || Memory.expansion.phase !== "claiming") {
        creep.suicide();
        return;
    }
    if (creep.room.name !== targetRoom && ((_b = creep.memory.retreatUntil) !== null && _b !== void 0 ? _b : 0) > Game.time) {
        const { x, y } = creep.pos;
        if (x <= 2 || x >= 47 || y <= 2 || y >= 47) {
            creep.moveTo(new RoomPosition(25, 25, creep.room.name), { range: 20, reusePath: 20 });
        }
        return;
    }
    if (creep.room.name !== targetRoom) {
        const exit = creep.room.findExitTo(targetRoom);
        if (exit === ERR_NO_PATH || exit === ERR_INVALID_ARGS) {
            creep.suicide();
            return;
        }
        creep.moveTo(new RoomPosition(25, 25, targetRoom), { reusePath: 50, range: 20 });
        return;
    }
    const controller = creep.room.controller;
    if (!controller) {
        creep.suicide();
        return;
    }
    if (controller.my) {
        Memory.expansion.phase = "bootstrapping";
        creep.suicide();
        return;
    }
    if (controller.owner) {
        console.log(`[Expansion] Aborting claim of ${targetRoom} - owned by ${controller.owner.username}.`);
        delete Memory.expansion;
        creep.suicide();
        return;
    }
    if (getThreatInfo(creep.room).score > 0) {
        creep.memory.retreatUntil = Game.time + RETREAT_HOLD_TICKS$3;
        const exits = creep.room.find(FIND_EXIT);
        const exit = creep.pos.findClosestByRange(exits);
        if (exit)
            creep.moveTo(exit, { reusePath: 5 });
        return;
    }
    if (controller.reservation &&
        controller.reservation.username !== creep.owner.username) {
        if (creep.attackController(controller) === ERR_NOT_IN_RANGE) {
            creep.moveTo(controller, { reusePath: 10 });
        }
        return;
    }
    const result = creep.claimController(controller);
    if (result === ERR_NOT_IN_RANGE) {
        creep.moveTo(controller, { reusePath: 10 });
    }
    else if (result === OK) {
        Memory.expansion.phase = "bootstrapping";
        console.log(`[Expansion] Claimed ${targetRoom}!`);
        chronicle(`The Crown's banner rises over the ${wildsName(targetRoom)}. The keep of ${castleName(targetRoom)} is founded.`);
        try {
            const sig = pickSignature(creep.room.name);
            const sres = creep.signController(controller, sig);
            if (sres === OK) {
                if (!Memory.rooms)
                    Memory.rooms = {};
                if (!Memory.rooms[creep.room.name])
                    Memory.rooms[creep.room.name] = {};
                Memory.rooms[creep.room.name].lastSigned = Game.time;
            }
        }
        catch (e) {
        }
    }
    else if (result === ERR_GCL_NOT_ENOUGH) {
        console.log(`[Expansion] Can't claim ${targetRoom} - GCL too low. Re-queued.`);
        Memory.expansionQueue = ((_c = Memory.expansionQueue) !== null && _c !== void 0 ? _c : []).filter((q) => q.roomName !== targetRoom);
        Memory.expansionQueue.unshift({ roomName: targetRoom, homeRoom: Memory.expansion.homeRoom, queuedAt: Game.time });
        delete Memory.expansion;
        creep.suicide();
    }
}

const RETREAT_HOLD_TICKS$2 = 50;
function runSettler(creep) {
    var _a, _b;
    const targetRoom = creep.memory.targetRoom;
    if (!targetRoom) {
        creep.suicide();
        return;
    }
    const exp = Memory.expansion;
    if (exp && exp.roomName === targetRoom && exp.phase === "established") {
        creep.suicide();
        return;
    }
    const homeRoom = (_a = creep.memory.homeRoom) !== null && _a !== void 0 ? _a : exp === null || exp === void 0 ? void 0 : exp.homeRoom;
    if (creep.room.name === targetRoom && getThreatInfo(creep.room).score > 0) {
        creep.memory.retreatUntil = Game.time + RETREAT_HOLD_TICKS$2;
        if (homeRoom && homeRoom !== targetRoom) {
            moveToRoom$3(creep, homeRoom);
        }
        else {
            const exits = creep.room.find(FIND_EXIT);
            const exit = creep.pos.findClosestByRange(exits);
            if (exit)
                creep.moveTo(exit, { reusePath: 5 });
        }
        return;
    }
    if (creep.room.name !== targetRoom && ((_b = creep.memory.retreatUntil) !== null && _b !== void 0 ? _b : 0) > Game.time) {
        holdAwayFromEdge(creep);
        return;
    }
    if (creep.room.name !== targetRoom) {
        if (creep.room.name === homeRoom && takeProvisions(creep))
            return;
        moveToRoom$3(creep, targetRoom);
        return;
    }
    if (creep.memory.working && creep.store[RESOURCE_ENERGY] === 0) {
        creep.memory.working = false;
    }
    else if (!creep.memory.working && creep.store.getFreeCapacity() === 0) {
        creep.memory.working = true;
    }
    if (!creep.memory.working) {
        harvest(creep);
        return;
    }
    const spawnSite = creep.room
        .find(FIND_MY_CONSTRUCTION_SITES)
        .find((s) => s.structureType === STRUCTURE_SPAWN);
    if (spawnSite) {
        if (creep.build(spawnSite) === ERR_NOT_IN_RANGE) {
            creep.moveTo(spawnSite, { reusePath: 10 });
        }
        return;
    }
    const site = creep.pos.findClosestByRange(FIND_CONSTRUCTION_SITES);
    if (site) {
        if (creep.build(site) === ERR_NOT_IN_RANGE) {
            creep.moveTo(site, { reusePath: 10 });
        }
        return;
    }
    const spawn = creep.room.find(FIND_MY_SPAWNS)[0];
    if (spawn && spawn.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
        if (creep.transfer(spawn, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
            creep.moveTo(spawn, { reusePath: 20 });
        }
        return;
    }
    const ctrl = creep.room.controller;
    if (ctrl) {
        const exp = Memory.expansion;
        const shouldSign = exp &&
            exp.roomName === creep.room.name &&
            exp.phase === "bootstrapping" &&
            creep.room.memory.lastSigned === undefined;
        if (shouldSign) {
            try {
                const sig = pickSignature(creep.room.name);
                const sres = creep.signController(ctrl, sig);
                if (sres === OK) {
                    if (!Memory.rooms)
                        Memory.rooms = {};
                    if (!Memory.rooms[creep.room.name])
                        Memory.rooms[creep.room.name] = {};
                    Memory.rooms[creep.room.name].lastSigned = Game.time;
                }
            }
            catch (e) { }
        }
        if (creep.upgradeController(ctrl) === ERR_NOT_IN_RANGE) {
            creep.moveTo(ctrl, { reusePath: 20 });
        }
    }
}
const MIN_STOCK = 100;
const PROVISION_FLOOR = 30000;
function takeProvisions(creep) {
    const storage = creep.room.storage;
    if (!(storage === null || storage === void 0 ? void 0 : storage.my) || storage.store[RESOURCE_ENERGY] < PROVISION_FLOOR)
        return false;
    if (creep.store.getFreeCapacity(RESOURCE_ENERGY) === 0)
        return false;
    if (creep.withdraw(storage, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE)
        creep.moveTo(storage, { reusePath: 10 });
    return true;
}
function harvest(creep) {
    const pile = creep.pos.findClosestByRange(FIND_DROPPED_RESOURCES, {
        filter: (r) => r.resourceType === RESOURCE_ENERGY && r.amount >= MIN_STOCK,
    });
    if (pile) {
        if (creep.pickup(pile) === ERR_NOT_IN_RANGE)
            creep.moveTo(pile, { reusePath: 10 });
        return;
    }
    const container = creep.pos.findClosestByRange(FIND_STRUCTURES, {
        filter: (s) => s.structureType === STRUCTURE_CONTAINER && s.store[RESOURCE_ENERGY] >= MIN_STOCK,
    });
    if (container) {
        if (creep.withdraw(container, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
            creep.moveTo(container, { reusePath: 10 });
        }
        return;
    }
    const source = creep.pos.findClosestByRange(FIND_SOURCES_ACTIVE);
    if (!source) {
        if (creep.store[RESOURCE_ENERGY] > 0) {
            creep.memory.working = true;
            return;
        }
        const ctrl = creep.room.controller;
        if (ctrl && !creep.pos.isNearTo(ctrl))
            creep.moveTo(ctrl, { reusePath: 20 });
        return;
    }
    if (creep.harvest(source) === ERR_NOT_IN_RANGE) {
        creep.moveTo(source, { reusePath: 10 });
    }
}
function holdAwayFromEdge(creep) {
    const { x, y } = creep.pos;
    if (x > 2 && x < 47 && y > 2 && y < 47)
        return;
    creep.moveTo(new RoomPosition(25, 25, creep.room.name), { range: 20, reusePath: 20 });
}
function moveToRoom$3(creep, roomName) {
    const exit = creep.room.findExitTo(roomName);
    if (exit === ERR_NO_PATH || exit === ERR_INVALID_ARGS) {
        creep.suicide();
        return;
    }
    creep.moveTo(new RoomPosition(25, 25, roomName), { reusePath: 50, range: 20 });
}

const MIN_REFILL_AMOUNT = 200;
function runApothecary(creep) {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    const room = creep.room;
    const ls = room.memory.labSystem;
    const storage = room.storage;
    if (!ls || !ls.inputLabIds || !ls.outputLabIds || !storage) {
        if (storage && !creep.pos.isNearTo(storage))
            creep.moveTo(storage, { reusePath: 20 });
        return;
    }
    const inputLabs = ls.inputLabIds
        .map((id) => Game.getObjectById(id))
        .filter((l) => l !== null);
    const outputLabs = ls.outputLabIds
        .map((id) => Game.getObjectById(id))
        .filter((l) => l !== null);
    if (inputLabs.length < 2)
        return;
    const carrying = Object.keys(creep.store).filter((r) => creep.store.getUsedCapacity(r) > 0);
    const boostRequests = getBoostRequests(room);
    const boostLabs = assignBoostLabs(outputLabs, boostRequests.keys());
    if (carrying.length > 0) {
        const resource = carrying[0];
        const pendingSend = room.memory.pendingSend;
        if (pendingSend && pendingSend.resource === resource && pendingSend.resource !== RESOURCE_ENERGY) {
            const termId = room.memory.terminalId;
            const terminal = termId ? Game.getObjectById(termId) : null;
            if (terminal && ((_a = terminal.store.getUsedCapacity(resource)) !== null && _a !== void 0 ? _a : 0) < pendingSend.loadTarget) {
                if (creep.transfer(terminal, resource) === ERR_NOT_IN_RANGE) {
                    creep.moveTo(terminal, { reusePath: 5 });
                }
                return;
            }
        }
        for (const [compound, lab] of boostLabs) {
            const fits = resource === RESOURCE_ENERGY
                ? lab.store.getFreeCapacity(RESOURCE_ENERGY) > 0
                : resource === compound && (!lab.mineralType || lab.mineralType === compound);
            if (fits && deliverTo(creep, lab, resource))
                return;
        }
        if (ls.inputCompounds) {
            for (let i = 0; i < 2; i++) {
                const lab = inputLabs[i];
                if (ls.inputCompounds[i] === resource &&
                    (!lab.mineralType || lab.mineralType === resource) &&
                    deliverTo(creep, lab, resource)) {
                    return;
                }
            }
        }
        if (creep.transfer(storage, resource) === ERR_NOT_IN_RANGE) {
            creep.moveTo(storage, { reusePath: 5 });
        }
        return;
    }
    const pendingBoostCompounds = new Set();
    for (const c of creep.room.find(FIND_MY_CREEPS, { filter: (c) => !c.memory.boosted })) {
        if (c.memory.boostCompound)
            pendingBoostCompounds.add(c.memory.boostCompound);
        if (c.memory.boostQueue)
            for (const q of c.memory.boostQueue)
                pendingBoostCompounds.add(q);
    }
    const pendingSend = room.memory.pendingSend;
    if (pendingSend && pendingSend.resource !== RESOURCE_ENERGY) {
        const termId = room.memory.terminalId;
        const terminal = termId ? Game.getObjectById(termId) : null;
        if (terminal) {
            const rc = pendingSend.resource;
            const inTerminal = (_b = terminal.store.getUsedCapacity(rc)) !== null && _b !== void 0 ? _b : 0;
            if (inTerminal < pendingSend.loadTarget) {
                const inStorage = (_c = storage.store.getUsedCapacity(rc)) !== null && _c !== void 0 ? _c : 0;
                if (inStorage > 0) {
                    const amount = Math.min((_d = creep.store.getFreeCapacity()) !== null && _d !== void 0 ? _d : 0, pendingSend.loadTarget - inTerminal, inStorage);
                    if (amount > 0) {
                        if (creep.withdraw(storage, rc, amount) === ERR_NOT_IN_RANGE) {
                            creep.moveTo(storage, { reusePath: 5 });
                        }
                        return;
                    }
                }
            }
        }
    }
    for (const [compound, lab] of boostLabs) {
        if (lab.mineralType && lab.mineralType !== compound) {
            if (creep.withdraw(lab, lab.mineralType) === ERR_NOT_IN_RANGE) {
                creep.moveTo(lab, { reusePath: 5 });
            }
            return;
        }
        const rc = compound;
        const needed = (_e = boostRequests.get(compound)) !== null && _e !== void 0 ? _e : 0;
        const missing = Math.min(needed, LAB_MINERAL_CAPACITY) - ((_f = lab.store.getUsedCapacity(rc)) !== null && _f !== void 0 ? _f : 0);
        if (missing > 0) {
            const src = findStoreWith(room, rc);
            if (src) {
                const amount = Math.min(creep.store.getFreeCapacity(), missing, src.store.getUsedCapacity(rc));
                if (creep.withdraw(src, rc, amount) === ERR_NOT_IN_RANGE) {
                    creep.moveTo(src, { reusePath: 5 });
                }
                return;
            }
        }
        const energyMissing = Math.min((needed / LAB_BOOST_MINERAL) * LAB_BOOST_ENERGY - lab.store[RESOURCE_ENERGY], lab.store.getFreeCapacity(RESOURCE_ENERGY));
        if (energyMissing > 0 && storage.store[RESOURCE_ENERGY] > 0) {
            const amount = Math.min(creep.store.getFreeCapacity(), energyMissing, storage.store[RESOURCE_ENERGY]);
            if (creep.withdraw(storage, RESOURCE_ENERGY, amount) === ERR_NOT_IN_RANGE) {
                creep.moveTo(storage, { reusePath: 5 });
            }
            return;
        }
    }
    for (const outputLab of outputLabs) {
        const resource = Object.keys(outputLab.store).find((r) => {
            var _a;
            return r !== RESOURCE_ENERGY &&
                ((_a = outputLab.store.getUsedCapacity(r)) !== null && _a !== void 0 ? _a : 0) >= LAB_MINERAL_CAPACITY * 0.75 &&
                !pendingBoostCompounds.has(r);
        });
        if (resource) {
            if (creep.withdraw(outputLab, resource) === ERR_NOT_IN_RANGE) {
                creep.moveTo(outputLab, { reusePath: 5 });
            }
            return;
        }
    }
    for (let i = 0; i < 2; i++) {
        if (!ls.inputCompounds)
            break;
        const expected = ls.inputCompounds[i];
        const lab = inputLabs[i];
        const wrong = Object.keys(lab.store).find((r) => { var _a; return r !== expected && ((_a = lab.store.getUsedCapacity(r)) !== null && _a !== void 0 ? _a : 0) > 0; });
        if (wrong) {
            if (creep.withdraw(lab, wrong) === ERR_NOT_IN_RANGE) {
                creep.moveTo(lab, { reusePath: 5 });
            }
            return;
        }
    }
    if (ls.inputCompounds) {
        for (let i = 0; i < 2; i++) {
            const compound = ls.inputCompounds[i];
            const lab = inputLabs[i];
            const labFree = (_g = lab.store.getFreeCapacity(compound)) !== null && _g !== void 0 ? _g : 0;
            if (labFree < MIN_REFILL_AMOUNT)
                continue;
            const src = findStoreWith(room, compound);
            if (!src)
                continue;
            const amount = Math.min((_h = creep.store.getFreeCapacity()) !== null && _h !== void 0 ? _h : 0, labFree, src.store.getUsedCapacity(compound));
            if (creep.withdraw(src, compound, amount) === ERR_NOT_IN_RANGE) {
                creep.moveTo(src, { reusePath: 5 });
            }
            return;
        }
    }
    const idleInputs = !ls.inputCompounds && ls.queue.length === 0 ? inputLabs : [];
    for (const lab of [...outputLabs, ...idleInputs]) {
        const resource = Object.keys(lab.store).find((r) => {
            var _a;
            return r !== RESOURCE_ENERGY &&
                ((_a = lab.store.getUsedCapacity(r)) !== null && _a !== void 0 ? _a : 0) > 0 &&
                !pendingBoostCompounds.has(r);
        });
        if (resource) {
            if (creep.withdraw(lab, resource) === ERR_NOT_IN_RANGE) {
                creep.moveTo(lab, { reusePath: 5 });
            }
            return;
        }
    }
    if (!creep.pos.isNearTo(storage))
        creep.moveTo(storage, { reusePath: 20 });
}
function deliverTo(creep, target, resource) {
    const res = creep.transfer(target, resource);
    if (res === ERR_NOT_IN_RANGE) {
        creep.moveTo(target, { reusePath: 5 });
        return true;
    }
    return res === OK;
}
function findStoreWith(room, resource) {
    return [room.storage, room.terminal].find((s) => !!s && s.store.getUsedCapacity(resource) > 0);
}

function runPowerAttacker(creep) {
    var _a;
    const opId = creep.memory.powerOpId;
    if (opId === undefined) {
        creep.suicide();
        return;
    }
    const op = ((_a = Memory.powerOps) !== null && _a !== void 0 ? _a : []).find((o) => o.id === opId);
    if (!op || op.phase === "done") {
        creep.suicide();
        return;
    }
    if (op.phase === "forming") {
        parkNearHomeSpawn$2(creep, op.homeRoom);
        return;
    }
    if (op.phase === "cracking") {
        if (creep.room.name !== op.roomName) {
            travelToRoom$4(creep, op.roomName);
            return;
        }
        const bank = op.bankId ? Game.getObjectById(op.bankId) : null;
        if (!bank)
            return;
        const healerInRange = creep.pos.findInRange(FIND_MY_CREEPS, 3, {
            filter: (c) => c.memory.role === ROLE_POWER_HEALER && c.memory.powerOpId === opId,
        }).length > 0;
        if (!healerInRange) {
            if (creep.pos.getRangeTo(bank) > 1) {
                creep.moveTo(bank, { reusePath: 5, visualizePathStyle: {} });
            }
            return;
        }
        if (creep.attack(bank) === ERR_NOT_IN_RANGE) {
            creep.moveTo(bank, { reusePath: 5, visualizePathStyle: {} });
        }
        return;
    }
    if (op.phase === "collecting") {
        travelToRoom$4(creep, op.homeRoom);
    }
}
function parkNearHomeSpawn$2(creep, homeRoomName) {
    if (creep.room.name !== homeRoomName) {
        travelToRoom$4(creep, homeRoomName);
        return;
    }
    const spawn = creep.room.find(FIND_MY_SPAWNS)[0];
    if (spawn && creep.pos.getRangeTo(spawn) > 3) {
        creep.moveTo(spawn, { reusePath: 20, visualizePathStyle: {} });
    }
}
function travelToRoom$4(creep, roomName) {
    if (creep.room.name === roomName)
        return;
    creep.moveTo(new RoomPosition(25, 25, roomName), {
        reusePath: 10,
        range: 20,
        visualizePathStyle: {},
    });
}

function runPowerHealer(creep) {
    var _a;
    const opId = creep.memory.powerOpId;
    if (opId === undefined) {
        creep.suicide();
        return;
    }
    const op = ((_a = Memory.powerOps) !== null && _a !== void 0 ? _a : []).find((o) => o.id === opId);
    if (!op || op.phase === "done") {
        creep.suicide();
        return;
    }
    if (op.phase === "forming") {
        parkNearHomeSpawn$1(creep, op.homeRoom);
        return;
    }
    if (op.phase === "cracking") {
        const attackers = Object.values(Game.creeps).filter((c) => c.memory.powerOpId === opId && c.memory.role === ROLE_POWER_ATTACKER);
        let healTarget = null;
        let lowestRatio = 1;
        for (const a of attackers) {
            const ratio = a.hits / a.hitsMax;
            if (ratio < lowestRatio) {
                lowestRatio = ratio;
                healTarget = a;
            }
        }
        if (healTarget) {
            const result = creep.heal(healTarget);
            if (result === ERR_NOT_IN_RANGE) {
                creep.rangedHeal(healTarget);
                creep.moveTo(healTarget, { reusePath: 3, visualizePathStyle: {} });
            }
        }
        else if (attackers.length > 0) {
            creep.moveTo(attackers[0], { reusePath: 3, visualizePathStyle: {} });
        }
        else if (creep.room.name !== op.roomName) {
            travelToRoom$3(creep, op.roomName);
        }
        if (!healTarget && creep.hits < creep.hitsMax) {
            creep.heal(creep);
        }
        return;
    }
    if (op.phase === "collecting") {
        if (creep.hits < creep.hitsMax)
            creep.heal(creep);
        travelToRoom$3(creep, op.homeRoom);
    }
}
function parkNearHomeSpawn$1(creep, homeRoomName) {
    if (creep.room.name !== homeRoomName) {
        travelToRoom$3(creep, homeRoomName);
        return;
    }
    const spawn = creep.room.find(FIND_MY_SPAWNS)[0];
    if (spawn && creep.pos.getRangeTo(spawn) > 3) {
        creep.moveTo(spawn, { reusePath: 20, visualizePathStyle: {} });
    }
}
function travelToRoom$3(creep, roomName) {
    if (creep.room.name === roomName)
        return;
    creep.moveTo(new RoomPosition(25, 25, roomName), {
        reusePath: 10,
        range: 20,
        visualizePathStyle: {},
    });
}

function runPowerCarrier(creep) {
    var _a, _b, _c, _d;
    if (((_a = creep.store.getUsedCapacity(RESOURCE_POWER)) !== null && _a !== void 0 ? _a : 0) > 0) {
        if (creep.room.name !== creep.memory.homeRoom) {
            travelToRoom$2(creep, creep.memory.homeRoom);
            return;
        }
        const target = (_b = creep.room.storage) !== null && _b !== void 0 ? _b : creep.room.terminal;
        if (target) {
            if (creep.transfer(target, RESOURCE_POWER) === ERR_NOT_IN_RANGE) {
                creep.moveTo(target, { reusePath: 5, visualizePathStyle: {} });
            }
            return;
        }
    }
    const opId = creep.memory.powerOpId;
    if (opId === undefined) {
        creep.suicide();
        return;
    }
    const op = ((_c = Memory.powerOps) !== null && _c !== void 0 ? _c : []).find((o) => o.id === opId);
    if (!op || op.phase === "done") {
        creep.suicide();
        return;
    }
    if (op.phase === "forming") {
        parkNearHomeSpawn(creep, op.homeRoom);
        return;
    }
    if (op.phase === "cracking") {
        if (creep.room.name !== op.roomName) {
            travelToRoom$2(creep, op.roomName);
            return;
        }
        const center = new RoomPosition(25, 25, op.roomName);
        if (creep.pos.getRangeTo(center) > 5) {
            creep.moveTo(center, { reusePath: 10, visualizePathStyle: {} });
        }
        return;
    }
    if (op.phase === "collecting") {
        if (creep.store.getFreeCapacity() === 0) {
            travelToRoom$2(creep, op.homeRoom);
            return;
        }
        if (creep.room.name !== op.roomName) {
            travelToRoom$2(creep, op.roomName);
            return;
        }
        const dropped = creep.pos.findClosestByRange(FIND_DROPPED_RESOURCES, {
            filter: (r) => r.resourceType === RESOURCE_POWER,
        });
        if (dropped) {
            if (creep.pickup(dropped) === ERR_NOT_IN_RANGE) {
                creep.moveTo(dropped, { reusePath: 3, visualizePathStyle: {} });
            }
            return;
        }
        const ruins = creep.room.find(FIND_RUINS);
        for (const ruin of ruins) {
            if (((_d = ruin.store.getUsedCapacity(RESOURCE_POWER)) !== null && _d !== void 0 ? _d : 0) > 0) {
                if (creep.withdraw(ruin, RESOURCE_POWER) === ERR_NOT_IN_RANGE) {
                    creep.moveTo(ruin, { reusePath: 3, visualizePathStyle: {} });
                }
                return;
            }
        }
        travelToRoom$2(creep, op.homeRoom);
    }
}
function parkNearHomeSpawn(creep, homeRoomName) {
    if (creep.room.name !== homeRoomName) {
        travelToRoom$2(creep, homeRoomName);
        return;
    }
    const spawn = creep.room.find(FIND_MY_SPAWNS)[0];
    if (spawn && creep.pos.getRangeTo(spawn) > 3) {
        creep.moveTo(spawn, { reusePath: 20, visualizePathStyle: {} });
    }
}
function travelToRoom$2(creep, roomName) {
    if (!roomName || creep.room.name === roomName)
        return;
    creep.moveTo(new RoomPosition(25, 25, roomName), {
        reusePath: 10,
        range: 20,
        visualizePathStyle: {},
    });
}

function runDepositMiner(creep) {
    var _a, _b;
    const opId = creep.memory.depositOpId;
    if (opId === undefined) {
        creep.suicide();
        return;
    }
    const op = ((_a = Memory.depositOps) !== null && _a !== void 0 ? _a : []).find((o) => o.id === opId);
    if (!op || op.phase === "done") {
        deliverAndRetire(creep);
        return;
    }
    if (creep.room.name !== op.roomName) {
        travelToRoom$1(creep, op.roomName);
        return;
    }
    const deposit = op.depositId ? Game.getObjectById(op.depositId) : null;
    if (!deposit)
        return;
    const harvestYield = creep.getActiveBodyparts(WORK) * HARVEST_DEPOSIT_POWER;
    if (((_b = creep.store[op.depositType]) !== null && _b !== void 0 ? _b : 0) > 0) {
        const hauler = creep.pos.findInRange(FIND_MY_CREEPS, 1, {
            filter: (c) => c.memory.role === ROLE_DEPOSIT_HAULER &&
                c.memory.depositOpId === opId &&
                c.store.getFreeCapacity() > 0,
        })[0];
        if (hauler)
            creep.transfer(hauler, op.depositType);
        else if (creep.store.getFreeCapacity() < harvestYield)
            creep.drop(op.depositType);
    }
    if (creep.pos.getRangeTo(deposit) > 1) {
        creep.moveTo(deposit, { reusePath: 10, visualizePathStyle: {} });
        return;
    }
    creep.harvest(deposit);
}
function deliverAndRetire(creep) {
    var _a;
    if (creep.store.getUsedCapacity() === 0) {
        creep.suicide();
        return;
    }
    const home = creep.memory.homeRoom;
    if (home && creep.room.name !== home) {
        travelToRoom$1(creep, home);
        return;
    }
    const target = (_a = creep.room.storage) !== null && _a !== void 0 ? _a : creep.room.terminal;
    if (!target) {
        creep.suicide();
        return;
    }
    const res = Object.keys(creep.store)[0];
    if (!res) {
        creep.suicide();
        return;
    }
    if (creep.transfer(target, res) === ERR_NOT_IN_RANGE) {
        creep.moveTo(target, { reusePath: 5, visualizePathStyle: {} });
    }
}
function travelToRoom$1(creep, roomName) {
    if (!roomName || creep.room.name === roomName)
        return;
    creep.moveTo(new RoomPosition(25, 25, roomName), {
        reusePath: 10,
        range: 20,
        visualizePathStyle: {},
    });
}

const TICKS_PER_ROOM$1 = 50;
const RETURN_SLACK = 50;
function runDepositHauler(creep) {
    var _a, _b;
    if (creep.store.getFreeCapacity() === 0) {
        deliverHome(creep);
        return;
    }
    const opId = creep.memory.depositOpId;
    const op = opId !== undefined
        ? ((_a = Memory.depositOps) !== null && _a !== void 0 ? _a : []).find((o) => o.id === opId)
        : undefined;
    if (!op || op.phase === "done") {
        if (creep.store.getUsedCapacity() > 0) {
            deliverHome(creep);
            return;
        }
        creep.suicide();
        return;
    }
    if (creep.room.name !== op.roomName) {
        travelToRoom(creep, op.roomName);
        return;
    }
    if (creep.store.getUsedCapacity() > 0 && ((_b = creep.ticksToLive) !== null && _b !== void 0 ? _b : Infinity) < returnTripTicks(creep)) {
        deliverHome(creep);
        return;
    }
    const dropped = creep.pos.findClosestByRange(FIND_DROPPED_RESOURCES, {
        filter: (r) => r.resourceType === op.depositType,
    });
    if (dropped) {
        if (creep.pickup(dropped) === ERR_NOT_IN_RANGE) {
            creep.moveTo(dropped, { reusePath: 5, visualizePathStyle: {} });
        }
        return;
    }
    const holder = [
        ...creep.room.find(FIND_TOMBSTONES),
        ...creep.room.find(FIND_RUINS),
    ].find((h) => { var _a; return ((_a = h.store[op.depositType]) !== null && _a !== void 0 ? _a : 0) > 0; });
    if (holder) {
        if (creep.withdraw(holder, op.depositType) === ERR_NOT_IN_RANGE) {
            creep.moveTo(holder, { reusePath: 5, visualizePathStyle: {} });
        }
        return;
    }
    const miner = creep.room
        .find(FIND_MY_CREEPS)
        .find((c) => c.memory.role === ROLE_DEPOSIT_MINER && c.memory.depositOpId === op.id);
    const deposit = op.depositId ? Game.getObjectById(op.depositId) : null;
    if (miner) {
        if (!creep.pos.isNearTo(miner))
            creep.moveTo(miner, { range: 1, reusePath: 5, visualizePathStyle: {} });
    }
    else if (deposit && creep.pos.getRangeTo(deposit) > 2) {
        creep.moveTo(deposit, { reusePath: 10, visualizePathStyle: {} });
    }
}
function returnTripTicks(creep) {
    const home = creep.memory.homeRoom;
    if (!home)
        return RETURN_SLACK;
    return Game.map.getRoomLinearDistance(creep.room.name, home) * TICKS_PER_ROOM$1 + RETURN_SLACK;
}
function deliverHome(creep) {
    var _a;
    const home = creep.memory.homeRoom;
    if (home && creep.room.name !== home) {
        travelToRoom(creep, home);
        return;
    }
    const target = (_a = creep.room.storage) !== null && _a !== void 0 ? _a : creep.room.terminal;
    if (!target)
        return;
    const res = Object.keys(creep.store)[0];
    if (!res)
        return;
    if (creep.transfer(target, res) === ERR_NOT_IN_RANGE) {
        creep.moveTo(target, { reusePath: 5, visualizePathStyle: {} });
    }
}
function travelToRoom(creep, roomName) {
    if (!roomName || creep.room.name === roomName)
        return;
    creep.moveTo(new RoomPosition(25, 25, roomName), {
        reusePath: 10,
        range: 20,
        visualizePathStyle: {},
    });
}

const SK_CONTEST_COOLDOWN = 1000;
const SK_DISCOVERY_TIMEOUT = 3000;
const SK_MIN_HOME_RCL = 7;
const SK_MIN_HOME_ENERGY = 40000;
const SK_MIN_HOME_CAPACITY = 2500;
const SK_MAX_CONCURRENT = 4;
const SK_MAX_PER_HOME = 2;
function loop$g() {
    const ops = Memory.skOps;
    if (!ops || ops.length === 0)
        return;
    for (const op of ops)
        updateOp(op);
    const survivors = ops.filter((op) => {
        if (op.discovered || Game.time - op.startedAt <= SK_DISCOVERY_TIMEOUT)
            return true;
        console.log(`[SK] ${op.roomName}: never reached the room within ${SK_DISCOVERY_TIMEOUT} ticks - abandoning`);
        for (const name in Game.creeps) {
            if (Game.creeps[name].memory.skOpId === op.id) {
                delete Game.creeps[name].memory.skOpId;
                delete Game.creeps[name].memory.skSourceId;
            }
        }
        return false;
    });
    if (survivors.length !== ops.length)
        Memory.skOps = survivors;
}
function updateOp(op) {
    const room = Game.rooms[op.roomName];
    if (room && !op.discovered) {
        op.sourceIds = room.find(FIND_SOURCES).map((s) => s.id);
        op.discovered = true;
        console.log(`[SK] ${op.roomName}: discovered ${op.sourceIds.length} sources`);
    }
    if (room) {
        const playerHostiles = room.find(FIND_HOSTILE_CREEPS, {
            filter: (c) => isPlayerCreep(c) && canDealDamage(c),
        });
        if (playerHostiles.length > 0)
            op.lastFailure = Game.time;
    }
    const guardianAlive = getSkMembers(op.id).some((c) => c.memory.role === ROLE_SK_GUARDIAN);
    op.phase = guardianAlive && op.discovered ? "active" : "forming";
}
function isOpPaused(op) {
    return op.lastFailure !== undefined && Game.time - op.lastFailure < SK_CONTEST_COOLDOWN;
}
function getSkMembers(opId) {
    const result = [];
    for (const name in Game.creeps) {
        if (Game.creeps[name].memory.skOpId === opId)
            result.push(Game.creeps[name]);
    }
    return result;
}
function getSkOp(id) {
    var _a;
    return (_a = Memory.skOps) === null || _a === void 0 ? void 0 : _a.find((o) => o.id === id);
}
function launchSkOp(roomName) {
    var _a;
    if (!isSourceKeeperRoom(roomName))
        return `${roomName} is not a Source Keeper room`;
    if (!Memory.skOps)
        Memory.skOps = [];
    if (Memory.skOps.some((o) => o.roomName === roomName)) {
        return `already mining ${roomName}`;
    }
    if (Memory.skOps.length >= SK_MAX_CONCURRENT) {
        return `at the empire-wide SK op limit (${SK_MAX_CONCURRENT}) - cancel one first`;
    }
    const opsPerHome = {};
    for (const o of Memory.skOps)
        opsPerHome[o.homeRoom] = ((_a = opsPerHome[o.homeRoom]) !== null && _a !== void 0 ? _a : 0) + 1;
    const candidates = Object.values(Game.rooms).filter((r) => {
        var _a, _b, _c, _d, _e;
        return ((_a = r.controller) === null || _a === void 0 ? void 0 : _a.my) &&
            ((_b = r.controller.level) !== null && _b !== void 0 ? _b : 0) >= SK_MIN_HOME_RCL &&
            ((_d = (_c = r.storage) === null || _c === void 0 ? void 0 : _c.store[RESOURCE_ENERGY]) !== null && _d !== void 0 ? _d : 0) >= SK_MIN_HOME_ENERGY &&
            r.energyCapacityAvailable >= SK_MIN_HOME_CAPACITY &&
            ((_e = opsPerHome[r.name]) !== null && _e !== void 0 ? _e : 0) < SK_MAX_PER_HOME;
    });
    if (candidates.length === 0) {
        return `no owned room at RCL ${SK_MIN_HOME_RCL}+ with ${SK_MIN_HOME_ENERGY}+ stored energy, ${SK_MIN_HOME_CAPACITY}+ spawn capacity, and free SK capacity to fund it`;
    }
    const home = candidates.reduce((best, r) => Game.map.getRoomLinearDistance(r.name, roomName) <
        Game.map.getRoomLinearDistance(best.name, roomName)
        ? r
        : best);
    if (Game.map.getRoomLinearDistance(home.name, roomName) > 2) {
        return `nearest capable home with free SK capacity (${home.name}) is too far from ${roomName}`;
    }
    if (!Memory.nextSkOpId)
        Memory.nextSkOpId = 1;
    Memory.skOps.push({
        id: Memory.nextSkOpId++,
        roomName,
        homeRoom: home.name,
        phase: "forming",
        startedAt: Game.time,
        discovered: false,
        sourceIds: [],
    });
    return null;
}
function cancelSkOp(roomName) {
    if (!Memory.skOps)
        return false;
    const op = Memory.skOps.find((o) => o.roomName === roomName);
    if (!op)
        return false;
    for (const name in Game.creeps) {
        if (Game.creeps[name].memory.skOpId === op.id) {
            delete Game.creeps[name].memory.skOpId;
            delete Game.creeps[name].memory.skSourceId;
        }
    }
    Memory.skOps = Memory.skOps.filter((o) => o.id !== op.id);
    return true;
}

const KITE_RANGE = 3;
function runSkGuardian(creep) {
    var _a;
    if ((creep.memory.boostCompound || ((_a = creep.memory.boostQueue) === null || _a === void 0 ? void 0 : _a.length)) && seekBoost(creep))
        return;
    const opId = creep.memory.skOpId;
    const op = opId !== undefined ? getSkOp(opId) : undefined;
    if (!op) {
        delete creep.memory.skOpId;
        idleAtSpawn(creep);
        return;
    }
    if (isOpPaused(op)) {
        if (creep.hits < creep.hitsMax)
            creep.heal(creep);
        if (creep.room.name !== op.homeRoom)
            moveToRoom$2(creep, op.homeRoom);
        return;
    }
    if (creep.room.name !== op.roomName) {
        if (creep.hits < creep.hitsMax)
            creep.heal(creep);
        moveToRoom$2(creep, op.roomName);
        return;
    }
    const hostiles = creep.room.find(FIND_HOSTILE_CREEPS, {
        filter: (c) => isSourceKeeper(c) || c.owner.username === "Invader",
    });
    healSelfOrAlly(creep);
    const target = creep.pos.findClosestByRange(hostiles);
    if (target) {
        const range = creep.pos.getRangeTo(target);
        const cluster = creep.pos.findInRange(hostiles, KITE_RANGE);
        if (preferMassAttack(creep.pos, cluster))
            creep.rangedMassAttack();
        else
            creep.rangedAttack(target);
        if (range < KITE_RANGE)
            creep.move(target.pos.getDirectionTo(creep.pos));
        else if (range > KITE_RANGE)
            creep.moveTo(target, { range: KITE_RANGE, reusePath: 3 });
        return;
    }
    const lairs = creep.room.find(FIND_STRUCTURES, {
        filter: (s) => s.structureType === STRUCTURE_KEEPER_LAIR,
    });
    const pending = lairs.filter((l) => l.ticksToSpawn !== undefined);
    if (pending.length > 0) {
        const next = pending.reduce((a, b) => (a.ticksToSpawn < b.ticksToSpawn ? a : b));
        if (!creep.pos.inRangeTo(next, KITE_RANGE + 1))
            creep.moveTo(next, { range: KITE_RANGE, reusePath: 10 });
        return;
    }
    const center = new RoomPosition(25, 25, op.roomName);
    if (!creep.pos.inRangeTo(center, 5))
        creep.moveTo(center, { range: 5, reusePath: 20 });
}
function healSelfOrAlly(creep) {
    if (creep.hits < creep.hitsMax) {
        creep.heal(creep);
        return;
    }
    const ally = creep.pos.findInRange(FIND_MY_CREEPS, 3, {
        filter: (c) => c.hits < c.hitsMax,
    })[0];
    if (!ally)
        return;
    if (creep.pos.isNearTo(ally))
        creep.heal(ally);
    else
        creep.rangedHeal(ally);
}
function idleAtSpawn(creep) {
    const spawn = creep.room.find(FIND_MY_SPAWNS)[0];
    if (spawn && !creep.pos.isNearTo(spawn))
        creep.moveTo(spawn, { reusePath: 20 });
}
function moveToRoom$2(creep, targetRoom) {
    creep.moveTo(new RoomPosition(25, 25, targetRoom), { reusePath: 30, range: 20 });
}

const KEEPER_DANGER_RANGE$1 = 4;
const RETREAT_HOLD_TICKS$1 = 50;
const GUARDIAN_GUARD_RANGE$1 = 6;
function runSkMiner(creep) {
    var _a;
    const opId = creep.memory.skOpId;
    const op = opId !== undefined ? getSkOp(opId) : undefined;
    if (!op) {
        delete creep.memory.skOpId;
        delete creep.memory.skSourceId;
        creep.suicide();
        return;
    }
    if (isOpPaused(op)) {
        moveToRoom$1(creep, op.homeRoom);
        return;
    }
    if (creep.room.name !== op.roomName) {
        if (((_a = creep.memory.retreatUntil) !== null && _a !== void 0 ? _a : 0) > Game.time) {
            if (creep.pos.x <= 2 || creep.pos.x >= 47 || creep.pos.y <= 2 || creep.pos.y >= 47) {
                creep.moveTo(new RoomPosition(25, 25, creep.room.name), { range: 20, reusePath: 10 });
            }
            return;
        }
        moveToRoom$1(creep, op.roomName);
        return;
    }
    const keeper = creep.pos.findClosestByRange(FIND_HOSTILE_CREEPS, {
        filter: (c) => isSourceKeeper(c),
    });
    if (keeper && creep.pos.getRangeTo(keeper) <= KEEPER_DANGER_RANGE$1) {
        const guardianNear = creep.pos
            .findInRange(FIND_MY_CREEPS, GUARDIAN_GUARD_RANGE$1, {
            filter: (c) => c.memory.role === ROLE_SK_GUARDIAN && c.memory.skOpId === op.id,
        })
            .length > 0;
        if (!guardianNear || creep.hits < creep.hitsMax * 0.4) {
            creep.memory.retreatUntil = Game.time + RETREAT_HOLD_TICKS$1;
            moveToRoom$1(creep, op.homeRoom);
            return;
        }
    }
    const source = creep.memory.skSourceId
        ? Game.getObjectById(creep.memory.skSourceId)
        : null;
    if (!source) {
        const center = new RoomPosition(25, 25, op.roomName);
        if (!creep.pos.inRangeTo(center, 5))
            creep.moveTo(center, { range: 5, reusePath: 20 });
        return;
    }
    if (creep.harvest(source) === ERR_NOT_IN_RANGE) {
        creep.moveTo(source, { range: 1, reusePath: 20 });
    }
}
function moveToRoom$1(creep, targetRoom) {
    creep.moveTo(new RoomPosition(25, 25, targetRoom), { reusePath: 30, range: 20 });
}

const KEEPER_DANGER_RANGE = 5;
const RETREAT_HOLD_TICKS = 50;
const GUARDIAN_GUARD_RANGE = 6;
const DELIVER_TTL = 150;
function runSkHauler(creep) {
    var _a;
    const opId = creep.memory.skOpId;
    const op = opId !== undefined ? getSkOp(opId) : undefined;
    if (!op) {
        delete creep.memory.skOpId;
        if (creep.store.getUsedCapacity(RESOURCE_ENERGY) > 0 && creep.memory.homeRoom) {
            deposit(creep, creep.memory.homeRoom);
        }
        else {
            creep.suicide();
        }
        return;
    }
    if (isOpPaused(op)) {
        deposit(creep, op.homeRoom);
        return;
    }
    const carried = creep.store.getUsedCapacity(RESOURCE_ENERGY);
    if (creep.memory.working && carried === 0) {
        creep.memory.working = false;
    }
    else if (!creep.memory.working &&
        (creep.store.getFreeCapacity(RESOURCE_ENERGY) === 0 ||
            (carried > 0 && ((_a = creep.ticksToLive) !== null && _a !== void 0 ? _a : Infinity) < DELIVER_TTL))) {
        creep.memory.working = true;
    }
    if (creep.memory.working) {
        deposit(creep, op.homeRoom);
    }
    else {
        collect(creep, op);
    }
}
function collect(creep, op) {
    var _a;
    if (creep.room.name !== op.roomName) {
        if (((_a = creep.memory.retreatUntil) !== null && _a !== void 0 ? _a : 0) > Game.time) {
            if (creep.pos.x <= 2 || creep.pos.x >= 47 || creep.pos.y <= 2 || creep.pos.y >= 47) {
                creep.moveTo(new RoomPosition(25, 25, creep.room.name), { range: 20, reusePath: 10 });
            }
            return;
        }
        moveToRoom(creep, op.roomName);
        return;
    }
    const keeper = creep.pos.findClosestByRange(FIND_HOSTILE_CREEPS, {
        filter: (c) => isSourceKeeper(c),
    });
    if (keeper && creep.pos.getRangeTo(keeper) <= KEEPER_DANGER_RANGE) {
        const guardianNear = creep.pos
            .findInRange(FIND_MY_CREEPS, GUARDIAN_GUARD_RANGE, {
            filter: (c) => c.memory.role === ROLE_SK_GUARDIAN && c.memory.skOpId === op.id,
        })
            .length > 0;
        if (!guardianNear) {
            creep.memory.retreatUntil = Game.time + RETREAT_HOLD_TICKS;
            moveToRoom(creep, op.homeRoom);
            return;
        }
    }
    const container = creep.pos.findClosestByPath(FIND_STRUCTURES, {
        ignoreCreeps: true,
        filter: (s) => s.structureType === STRUCTURE_CONTAINER &&
            s.store[RESOURCE_ENERGY] > 0,
    });
    if (container) {
        if (creep.withdraw(container, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
            creep.moveTo(container, { reusePath: 20 });
        }
        return;
    }
    const dropped = creep.pos.findClosestByPath(FIND_DROPPED_RESOURCES, {
        ignoreCreeps: true,
        filter: (d) => d.resourceType === RESOURCE_ENERGY && d.amount >= 50,
    });
    if (dropped) {
        if (creep.pickup(dropped) === ERR_NOT_IN_RANGE)
            creep.moveTo(dropped, { reusePath: 10 });
        return;
    }
    const center = new RoomPosition(25, 25, op.roomName);
    if (!creep.pos.inRangeTo(center, 6))
        creep.moveTo(center, { range: 6, reusePath: 20 });
}
function deposit(creep, homeRoom) {
    if (creep.room.name !== homeRoom) {
        moveToRoom(creep, homeRoom);
        return;
    }
    const storage = creep.room.storage;
    const target = storage && storage.store.getFreeCapacity(RESOURCE_ENERGY) > 0
        ? storage
        : creep.pos.findClosestByPath(FIND_STRUCTURES, {
            ignoreCreeps: true,
            filter: (s) => (s.structureType === STRUCTURE_CONTAINER ||
                s.structureType === STRUCTURE_STORAGE) &&
                "store" in s &&
                s.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
        });
    if (target) {
        if (creep.transfer(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
            creep.moveTo(target, { reusePath: 50 });
        }
        return;
    }
    const spawn = creep.room
        .find(FIND_MY_SPAWNS)
        .find((s) => s.store.getFreeCapacity(RESOURCE_ENERGY) > 0);
    if (spawn) {
        if (creep.transfer(spawn, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
            creep.moveTo(spawn, { reusePath: 50 });
        }
    }
}
function moveToRoom(creep, targetRoom) {
    creep.moveTo(new RoomPosition(25, 25, targetRoom), { reusePath: 30, range: 20 });
}

function getScoreFindConstant() {
    return typeof FIND_SCORES !== "undefined" ? FIND_SCORES : undefined;
}
function scoreHunterSupported() {
    return getScoreFindConstant() !== undefined;
}
function loop$f() {
    var _a, _b;
    const findConstant = getScoreFindConstant();
    if (findConstant === undefined)
        return;
    const targets = (_a = Memory.scoreTargets) !== null && _a !== void 0 ? _a : (Memory.scoreTargets = {});
    const patrol = (_b = Memory.scorePatrol) !== null && _b !== void 0 ? _b : (Memory.scorePatrol = { seen: {} });
    for (const roomName in Game.rooms) {
        const room = Game.rooms[roomName];
        patrol.seen[roomName] = Game.time;
        const scores = room.find(findConstant);
        const seenIds = new Set();
        for (const s of scores) {
            seenIds.add(s.id);
            const existing = targets[s.id];
            targets[s.id] = {
                roomName,
                x: s.pos.x,
                y: s.pos.y,
                value: s.score,
                expiresAt: Game.time + s.ticksToDecay,
                claimedBy: existing === null || existing === void 0 ? void 0 : existing.claimedBy,
            };
        }
        for (const id in targets) {
            if (targets[id].roomName === roomName && !seenIds.has(id))
                delete targets[id];
        }
    }
    for (const id in targets) {
        if (Game.time > targets[id].expiresAt)
            delete targets[id];
    }
    for (const id in targets) {
        const claimant = targets[id].claimedBy;
        if (claimant && !Game.creeps[claimant])
            targets[id].claimedBy = undefined;
    }
    for (const rn in patrol.seen) {
        if (Game.time - patrol.seen[rn] > SEEN_TTL)
            delete patrol.seen[rn];
    }
}
const SEEN_TTL = 50000;
const SCORE_SCOUT_RADIUS = 4;
function homeHasObserver(home) {
    var _a, _b;
    return !!((_b = (_a = Game.rooms[home]) === null || _a === void 0 ? void 0 : _a.memory) === null || _b === void 0 ? void 0 : _b.observerId);
}
function getUnclaimedScoreTargetCount() {
    const targets = Memory.scoreTargets;
    if (!targets)
        return 0;
    let count = 0;
    for (const id in targets)
        if (!targets[id].claimedBy)
            count++;
    return count;
}
function getScoreTarget(id) {
    var _a;
    return (_a = Memory.scoreTargets) === null || _a === void 0 ? void 0 : _a[id];
}
function findNearestScoreInRoom(creep) {
    const findConstant = getScoreFindConstant();
    if (findConstant === undefined)
        return undefined;
    const scores = creep.room.find(findConstant);
    let best;
    let bestRange = Infinity;
    for (const s of scores) {
        const range = creep.pos.getRangeTo(s.pos);
        if (range < bestRange) {
            bestRange = range;
            best = s;
        }
    }
    return best === null || best === void 0 ? void 0 : best.pos;
}
function estimateTravelTicks(fromRoom, toRoom) {
    if (fromRoom === toRoom)
        return 0;
    return Game.map.getRoomLinearDistance(fromRoom, toRoom) * 50 + 25;
}
const TRAVEL_SAFETY_MARGIN = 1.3;
function claimNearestScoreTarget(creep) {
    var _a;
    const targets = Memory.scoreTargets;
    if (!targets)
        return undefined;
    let bestId;
    let bestRate = -Infinity;
    for (const id in targets) {
        const t = targets[id];
        if (t.claimedBy)
            continue;
        const travel = estimateTravelTicks(creep.room.name, t.roomName) * TRAVEL_SAFETY_MARGIN;
        const remaining = t.expiresAt - Game.time;
        if (travel >= remaining)
            continue;
        if (travel >= ((_a = creep.ticksToLive) !== null && _a !== void 0 ? _a : CREEP_LIFE_TIME))
            continue;
        const rate = t.value / Math.max(travel, 1);
        if (rate > bestRate) {
            bestRate = rate;
            bestId = id;
        }
    }
    if (bestId)
        targets[bestId].claimedBy = creep.name;
    return bestId;
}
function pickPatrolRoom(creep) {
    var _a, _b, _c, _d, _e;
    const home = creep.memory.homeRoom;
    if (!home)
        return undefined;
    if (homeHasObserver(home))
        return undefined;
    const myName = (_c = (_b = (_a = Game.rooms[home]) === null || _a === void 0 ? void 0 : _a.controller) === null || _b === void 0 ? void 0 : _b.owner) === null || _c === void 0 ? void 0 : _c.username;
    const region = safeRegionRooms(home, myName, SCORE_SCOUT_RADIUS);
    if (region.length === 0)
        return undefined;
    const fleet = [];
    for (const name in Game.creeps) {
        const c = Game.creeps[name];
        if (c.memory.role === ROLE_SCORE_HUNTER && c.memory.homeRoom === home)
            fleet.push(c);
    }
    fleet.sort((a, b) => (a.name < b.name ? -1 : 1));
    const seen = (_e = (_d = Memory.scorePatrol) === null || _d === void 0 ? void 0 : _d.seen) !== null && _e !== void 0 ? _e : {};
    const reserved = new Set();
    for (const c of fleet) {
        const pick = bestRoom(region, seen, c.pos.roomName, reserved);
        if (c.name === creep.name) {
            return pick !== null && pick !== void 0 ? pick : bestRoom(region, seen, creep.pos.roomName, new Set());
        }
        if (pick)
            reserved.add(pick);
    }
    return undefined;
}
function bestRoom(region, seen, fromRoom, reserved) {
    var _a;
    let best;
    let bestScore = -Infinity;
    for (const room of region) {
        if (room === fromRoom || reserved.has(room))
            continue;
        const staleness = Game.time - ((_a = seen[room]) !== null && _a !== void 0 ? _a : 0);
        const s = staleness - Game.map.getRoomLinearDistance(fromRoom, room) * 50;
        if (s > bestScore) {
            bestScore = s;
            best = room;
        }
    }
    return best;
}
function getScoreScanRooms(homeRoomName, range) {
    var _a, _b, _c;
    const myName = (_c = (_b = (_a = Game.rooms[homeRoomName]) === null || _a === void 0 ? void 0 : _a.controller) === null || _b === void 0 ? void 0 : _b.owner) === null || _c === void 0 ? void 0 : _c.username;
    return safeRegionRooms(homeRoomName, myName, range);
}
function safeRegionRooms(home, myName, range) {
    const result = [];
    const visited = new Set([home]);
    let frontier = [home];
    const homeStatus = Game.map.getRoomStatus(home).status;
    for (let depth = 0; depth < range; depth++) {
        const next = [];
        for (const rn of frontier) {
            const exits = Game.map.describeExits(rn);
            for (const nb of Object.values(exits)) {
                if (!nb || visited.has(nb))
                    continue;
                visited.add(nb);
                if (isHostileOwned(nb, myName) || isSourceKeeperRoom(nb) || isDeathTrapRoom(nb))
                    continue;
                if (Game.map.getRoomStatus(nb).status !== homeStatus)
                    continue;
                result.push(nb);
                next.push(nb);
            }
        }
        frontier = next;
    }
    return result;
}
const SCORE_THREAT_TOLERANCE = 12;
function isDeathTrapRoom(roomName) {
    var _a, _b;
    const intel = (_a = Memory.intel) === null || _a === void 0 ? void 0 : _a[roomName];
    if (!intel)
        return false;
    return ((_b = intel.hostileCombatParts) !== null && _b !== void 0 ? _b : 0) >= SCORE_THREAT_TOLERANCE;
}
function isHostileOwned(roomName, myName) {
    var _a, _b;
    const owner = (_b = (_a = Memory.intel) === null || _a === void 0 ? void 0 : _a[roomName]) === null || _b === void 0 ? void 0 : _b.owner;
    if (!owner)
        return false;
    if (owner === myName)
        return false;
    if (isAlly(owner))
        return false;
    return true;
}

function runScoreHunter(creep) {
    const localScore = findNearestScoreInRoom(creep);
    if (localScore) {
        if (!creep.pos.isEqualTo(localScore)) {
            creep.moveTo(localScore, { reusePath: 5, visualizePathStyle: { stroke: "#ffff00" } });
        }
        return;
    }
    let targetId = creep.memory.targetId;
    let target = targetId ? getScoreTarget(targetId) : undefined;
    if (targetId && !target) {
        creep.memory.targetId = undefined;
        targetId = undefined;
    }
    if (!targetId) {
        targetId = claimNearestScoreTarget(creep);
        if (!targetId) {
            patrol(creep);
            return;
        }
        creep.memory.targetId = targetId;
        target = getScoreTarget(targetId);
    }
    if (!target)
        return;
    const pos = new RoomPosition(target.x, target.y, target.roomName);
    if (!creep.pos.isEqualTo(pos)) {
        creep.moveTo(pos, { reusePath: 20, visualizePathStyle: { stroke: "#ffff00" } });
    }
}
function patrol(creep) {
    if (!creep.memory.targetRoom || creep.room.name === creep.memory.targetRoom) {
        creep.memory.targetRoom = pickPatrolRoom(creep);
    }
    const dest = creep.memory.targetRoom;
    if (dest && creep.room.name !== dest) {
        creep.moveTo(new RoomPosition(25, 25, dest), { reusePath: 30 });
        return;
    }
    if (!dest) {
        const ctrl = creep.room.controller;
        if (ctrl && !creep.pos.inRangeTo(ctrl, 3))
            creep.moveTo(ctrl, { range: 3, reusePath: 30 });
    }
}

function runUnclaimer(creep) {
    var _a, _b;
    const targetRoom = creep.memory.targetRoom;
    const target = targetRoom ? (_a = Memory.unclaimTargets) === null || _a === void 0 ? void 0 : _a[targetRoom] : undefined;
    if (!targetRoom || !target) {
        creep.suicide();
        return;
    }
    if (creep.room.name !== targetRoom) {
        creep.moveTo(new RoomPosition(25, 25, targetRoom), { reusePath: 50, range: 20 });
        return;
    }
    const ctrl = creep.room.controller;
    if (!ctrl || ctrl.my || (!ctrl.owner && !ctrl.reservation)) {
        delete Memory.unclaimTargets[targetRoom];
        creep.suicide();
        return;
    }
    target.blockedUntil = Game.time + ((_b = ctrl.upgradeBlocked) !== null && _b !== void 0 ? _b : 0);
    if (!creep.pos.isNearTo(ctrl)) {
        creep.moveTo(ctrl, { range: 1, reusePath: 10 });
        return;
    }
    const result = creep.attackController(ctrl);
    if (result === OK && ctrl.owner) {
        target.blockedUntil = Game.time + CONTROLLER_ATTACK_BLOCKED_UPGRADE;
        creep.suicide();
    }
}

const SIZE = 50;
const idx = (x, y) => y * SIZE + x;
const tileKey = (x, y) => `${x},${y}`;
const cheb = (ax, ay, bx, by) => Math.max(Math.abs(ax - bx), Math.abs(ay - by));
const NEIGHBOURS$1 = [
    [-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1],
];
const TOWN_KEYS = new Set([PLANNER_KEYS.TOWN_WALL_KEY, PLANNER_KEYS.TOWN_RAMPART_KEY]);
const PASSABLE_TYPES = new Set([STRUCTURE_ROAD, STRUCTURE_RAMPART, STRUCTURE_CONTAINER]);
function isRoadKey(key) {
    return (key.startsWith(PLANNER_KEYS.ROAD_PREFIX) ||
        key.startsWith(PLANNER_KEYS.CONNECTOR_PREFIX) ||
        key === PLANNER_KEYS.STAMP_ROAD_KEY ||
        key.startsWith(PLANNER_KEYS.CARDINAL_ROAD_PREFIX) ||
        key.startsWith("cardinal_connector_"));
}
function buildTownSite(room) {
    var _a, _b, _c, _d;
    const anchor = room.memory.castleAnchor;
    const ringTiles = room.memory.perimeterTiles;
    if (!anchor || !ringTiles || ringTiles.length === 0)
        return null;
    const terrain = room.getTerrain();
    const ownTiles = townFootprint(room.memory.town);
    const ring = new Set(ringTiles);
    const occupied = new Set(ring);
    const structures = new Set();
    const blocked = new Set();
    const mem = ((_a = room.memory.plannedStructures) !== null && _a !== void 0 ? _a : {});
    for (const key of Object.keys(mem)) {
        if (TOWN_KEYS.has(key))
            continue;
        const road = isRoadKey(key);
        const passable = road || key === PLANNER_KEYS.RAMPARTS_KEY || key === PLANNER_KEYS.STAMP_RAMPART_KEY ||
            key.startsWith(PLANNER_KEYS.CONTAINER_PREFIX);
        for (const p of mem[key]) {
            occupied.add(p);
            if (!road)
                structures.add(p);
            if (!passable)
                blocked.add(p);
        }
    }
    const bp = readBlueprint(room);
    for (const e of (_b = bp === null || bp === void 0 ? void 0 : bp.entries) !== null && _b !== void 0 ? _b : []) {
        const k = tileKey(e.x, e.y);
        occupied.add(k);
        if (e.type !== STRUCTURE_ROAD)
            structures.add(k);
        if (!PASSABLE_TYPES.has(e.type))
            blocked.add(k);
    }
    for (const s of room.find(FIND_STRUCTURES)) {
        const k = tileKey(s.pos.x, s.pos.y);
        if (ownTiles.has(k))
            continue;
        if (s.structureType === STRUCTURE_CONTROLLER) {
            occupied.add(k);
            blocked.add(k);
            continue;
        }
        if (s.structureType === STRUCTURE_RAMPART)
            continue;
        occupied.add(k);
        if (s.structureType !== STRUCTURE_ROAD)
            structures.add(k);
        if (!PASSABLE_TYPES.has(s.structureType))
            blocked.add(k);
    }
    for (const s of room.find(FIND_CONSTRUCTION_SITES)) {
        const k = tileKey(s.pos.x, s.pos.y);
        if (ownTiles.has(k))
            continue;
        occupied.add(k);
        if (s.structureType !== STRUCTURE_ROAD)
            structures.add(k);
        if (!PASSABLE_TYPES.has(s.structureType))
            blocked.add(k);
    }
    const clearOf = [];
    for (const s of room.find(FIND_SOURCES)) {
        clearOf.push({ x: s.pos.x, y: s.pos.y, range: TOWN.cottageResourceClearance });
        blocked.add(tileKey(s.pos.x, s.pos.y));
    }
    for (const m of room.find(FIND_MINERALS)) {
        clearOf.push({ x: m.pos.x, y: m.pos.y, range: TOWN.cottageResourceClearance });
        blocked.add(tileKey(m.pos.x, m.pos.y));
    }
    if (room.controller) {
        const c = room.controller.pos;
        clearOf.push({ x: c.x, y: c.y, range: TOWN.cottageControllerClearance });
    }
    const walkable = new Uint8Array(SIZE * SIZE);
    for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE; x++) {
            if (terrain.get(x, y) === TERRAIN_MASK_WALL)
                continue;
            if (blocked.has(tileKey(x, y)))
                continue;
            walkable[idx(x, y)] = 1;
        }
    }
    const reserved = new Set();
    for (const o of [...CASTLE_STAMP, ...MERCHANT_RING_EXTENSION_OFFSETS]) {
        reserved.add(tileKey(anchor.x + o.dx, anchor.y + o.dy));
    }
    for (let dy = -STAMP_PLANNER.halfSize; dy <= STAMP_PLANNER.halfSize; dy++) {
        for (let dx = -STAMP_PLANNER.halfSize; dx <= STAMP_PLANNER.halfSize; dx++) {
            reserved.add(tileKey(anchor.x + dx, anchor.y + dy));
        }
    }
    const interior = floodInterior(terrain, ring, anchor);
    if (!interior)
        return null;
    const storagePos = (_c = room.storage) === null || _c === void 0 ? void 0 : _c.pos;
    const plannedStorage = (_d = mem[PLANNER_KEYS.STAMP_STORAGE_KEY]) === null || _d === void 0 ? void 0 : _d[0];
    const storage = storagePos
        ? { x: storagePos.x, y: storagePos.y }
        : bp
            ? bp.hub
            : plannedStorage
                ? parseTile(plannedStorage)
                : { x: anchor.x, y: anchor.y + 2 };
    return { anchor, occupied, structures, walkable, interior, reserved, clearOf, ring, storage };
}
function floodInterior(terrain, ring, anchor) {
    const inside = new Uint8Array(SIZE * SIZE);
    const queue = [idx(anchor.x, anchor.y)];
    inside[queue[0]] = 1;
    for (let head = 0; head < queue.length; head++) {
        const t = queue[head];
        const x = t % SIZE;
        const y = (t - x) / SIZE;
        if (x === 0 || y === 0 || x === SIZE - 1 || y === SIZE - 1)
            return null;
        for (const [dx, dy] of NEIGHBOURS$1) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= SIZE || ny >= SIZE)
                continue;
            const n = idx(nx, ny);
            if (inside[n])
                continue;
            if (terrain.get(nx, ny) === TERRAIN_MASK_WALL)
                continue;
            if (ring.has(tileKey(nx, ny)))
                continue;
            inside[n] = 1;
            queue.push(n);
        }
    }
    return inside;
}
function reachable(site, extraBlocked = new Set()) {
    const seen = new Uint8Array(SIZE * SIZE);
    const start = idx(site.anchor.x, site.anchor.y);
    const queue = [start];
    seen[start] = 1;
    for (let head = 0; head < queue.length; head++) {
        const t = queue[head];
        const x = t % SIZE;
        const y = (t - x) / SIZE;
        for (const [dx, dy] of NEIGHBOURS$1) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= SIZE || ny >= SIZE)
                continue;
            const n = idx(nx, ny);
            if (seen[n] || !site.walkable[n] || extraBlocked.has(n))
                continue;
            seen[n] = 1;
            queue.push(n);
        }
    }
    return seen;
}
function exitCentroids(terrain) {
    const out = [];
    const sides = [
        { side: "top", at: (i) => [i, 0] },
        { side: "right", at: (i) => [SIZE - 1, i] },
        { side: "bottom", at: (i) => [i, SIZE - 1] },
        { side: "left", at: (i) => [0, i] },
    ];
    for (const { side, at } of sides) {
        let sx = 0;
        let sy = 0;
        let n = 0;
        for (let i = 1; i < SIZE - 1; i++) {
            const [x, y] = at(i);
            if (terrain.get(x, y) === TERRAIN_MASK_WALL)
                continue;
            sx += x;
            sy += y;
            n++;
        }
        if (n > 0)
            out.push({ side, x: sx / n, y: sy / n });
    }
    return out;
}
function planWatchPosts(room, site, avoid) {
    const posts = [];
    const taken = new Set();
    const ringTiles = [...site.ring].map(parseTile);
    for (const exit of exitCentroids(room.getTerrain())) {
        let gate = null;
        let best = Infinity;
        for (const t of ringTiles) {
            const d = Math.hypot(t.x - exit.x, t.y - exit.y);
            if (d < best) {
                best = d;
                gate = t;
            }
        }
        if (!gate)
            continue;
        const candidates = [];
        for (let dy = -3; dy <= 3; dy++) {
            for (let dx = -3; dx <= 3; dx++) {
                const x = gate.x + dx;
                const y = gate.y + dy;
                if (x < 1 || y < 1 || x > SIZE - 2 || y > SIZE - 2)
                    continue;
                const k = tileKey(x, y);
                if (taken.has(k) || avoid.has(k) || site.occupied.has(k))
                    continue;
                if (!site.interior[idx(x, y)] || !site.walkable[idx(x, y)])
                    continue;
                if (!NEIGHBOURS$1.some(([ax, ay]) => site.ring.has(tileKey(x + ax, y + ay))))
                    continue;
                candidates.push({ k, d: Math.hypot(dx, dy) });
            }
        }
        candidates.sort((a, b) => a.d - b.d || (a.k < b.k ? -1 : 1));
        for (const c of candidates.slice(0, TOWN.postsPerSide)) {
            posts.push(c.k);
            taken.add(c.k);
        }
    }
    return posts;
}
function parkable(site, x, y, avoid) {
    if (x < 2 || y < 2 || x > SIZE - 3 || y > SIZE - 3)
        return false;
    const k = tileKey(x, y);
    if (avoid.has(k) || site.occupied.has(k) || site.reserved.has(k))
        return false;
    if (!site.interior[idx(x, y)] || !site.walkable[idx(x, y)])
        return false;
    for (const [dx, dy] of NEIGHBOURS$1) {
        if (site.structures.has(tileKey(x + dx, y + dy)))
            return false;
    }
    return true;
}
function planSquare(site, avoid) {
    const { storage } = site;
    const centres = [];
    for (let y = 3; y < SIZE - 3; y++) {
        for (let x = 3; x < SIZE - 3; x++) {
            const d = cheb(x, y, storage.x, storage.y);
            if (d < TOWN.squareMinRange + 1 || d > TOWN.squareMaxRange)
                continue;
            centres.push({ x, y, d });
        }
    }
    centres.sort((a, b) => a.d - b.d || a.y - b.y || a.x - b.x);
    for (const c of centres) {
        let ok = true;
        for (let dy = -1; dy <= 1 && ok; dy++) {
            for (let dx = -1; dx <= 1 && ok; dx++) {
                if (!parkable(site, c.x + dx, c.y + dy, avoid))
                    ok = false;
            }
        }
        if (!ok)
            continue;
        const square = [];
        for (const [dx, dy] of NEIGHBOURS$1)
            square.push(tileKey(c.x + dx, c.y + dy));
        return { square, fountain: tileKey(c.x, c.y) };
    }
    const loose = [];
    for (let y = 2; y < SIZE - 2; y++) {
        for (let x = 2; x < SIZE - 2; x++) {
            const d = cheb(x, y, storage.x, storage.y);
            if (d < TOWN.squareMinRange || d > TOWN.squareMaxRange)
                continue;
            if (parkable(site, x, y, avoid))
                loose.push({ k: tileKey(x, y), d });
        }
    }
    loose.sort((a, b) => a.d - b.d || (a.k < b.k ? -1 : 1));
    return { square: loose.slice(0, TOWN.squareFallbackTiles).map((l) => l.k) };
}
function doorFor(x, y, anchor) {
    const dx = anchor.x - (x + 2);
    const dy = anchor.y - (y + 2);
    if (Math.abs(dx) >= Math.abs(dy)) {
        return dx > 0
            ? { door: tileKey(x + 4, y + 2), outside: [x + 5, y + 2] }
            : { door: tileKey(x, y + 2), outside: [x - 1, y + 2] };
    }
    return dy > 0
        ? { door: tileKey(x + 2, y + 4), outside: [x + 2, y + 5] }
        : { door: tileKey(x + 2, y), outside: [x + 2, y - 1] };
}
function findCottage(site, avoid, name) {
    const { anchor } = site;
    const minRange = STAMP_PLANNER.halfSize + 3;
    const candidates = [];
    for (let y = 2; y <= SIZE - 7; y++) {
        for (let x = 2; x <= SIZE - 7; x++) {
            const d = cheb(x + 2, y + 2, anchor.x, anchor.y);
            if (d < minRange)
                continue;
            let ok = true;
            let inside = true;
            for (let dy = -1; dy <= 5 && ok; dy++) {
                for (let dx = -1; dx <= 5 && ok; dx++) {
                    const tx = x + dx;
                    const ty = y + dy;
                    const k = tileKey(tx, ty);
                    const inFootprint = dx >= 0 && dy >= 0 && dx <= 4 && dy <= 4;
                    if (avoid.has(k))
                        ok = false;
                    else if (site.structures.has(k))
                        ok = false;
                    else if (inFootprint) {
                        if (!site.walkable[idx(tx, ty)] || site.occupied.has(k) || site.reserved.has(k))
                            ok = false;
                        else if (!site.interior[idx(tx, ty)])
                            inside = false;
                    }
                }
            }
            if (!ok)
                continue;
            if (site.clearOf.some((c) => cheb(c.x, c.y, x + 2, y + 2) <= c.range + 2))
                continue;
            if (!inside && (x < 4 || y < 4 || x + 4 > SIZE - 5 || y + 4 > SIZE - 5))
                continue;
            if (!inside && d > TOWN.cottageMaxRange)
                continue;
            candidates.push({ x, y, d, inside });
        }
    }
    candidates.sort((a, b) => Number(b.inside) - Number(a.inside) || a.d - b.d || a.y - b.y || a.x - b.x);
    const before = reachable(site);
    let tries = 0;
    for (const c of candidates) {
        if (tries++ >= 40)
            break;
        const { door, outside } = doorFor(c.x, c.y, anchor);
        if (!before[idx(outside[0], outside[1])])
            continue;
        const cottage = { x: c.x, y: c.y, door, name, ...(c.inside ? {} : { outside: true }) };
        const walls = new Set();
        for (const w of cottageLayout(cottage).walls) {
            const t = parseTile(w);
            walls.add(idx(t.x, t.y));
        }
        const after = reachable(site, walls);
        let cuts = false;
        for (let t = 0; t < SIZE * SIZE && !cuts; t++) {
            if (before[t] && !after[t] && !walls.has(t))
                cuts = true;
        }
        if (cuts)
            continue;
        return cottage;
    }
    return null;
}
function perimeterMostlyBuilt(room, ring) {
    const built = new Set();
    for (const s of room.find(FIND_STRUCTURES)) {
        if (s.structureType === STRUCTURE_RAMPART || s.structureType === STRUCTURE_WALL) {
            built.add(tileKey(s.pos.x, s.pos.y));
        }
    }
    let n = 0;
    for (const k of ring)
        if (built.has(k))
            n++;
    return n >= ring.length * TOWN.perimeterBuiltRatio;
}
function wantedCottages(room) {
    var _a, _b, _c, _d, _e;
    const rcl = (_b = (_a = room.controller) === null || _a === void 0 ? void 0 : _a.level) !== null && _b !== void 0 ? _b : 0;
    if (((_d = (_c = room.storage) === null || _c === void 0 ? void 0 : _c.store[RESOURCE_ENERGY]) !== null && _d !== void 0 ? _d : 0) < TOWN.storageGate)
        return 0;
    return (_e = TOWN.cottagesByRcl[rcl]) !== null && _e !== void 0 ? _e : 0;
}
function besideDoors(room, ring) {
    var _a, _b;
    const mem = ((_a = room.memory.plannedStructures) !== null && _a !== void 0 ? _a : {});
    const walls = new Set((_b = mem[PLANNER_KEYS.STAMP_WALL_KEY]) !== null && _b !== void 0 ? _b : []);
    for (const s of room.find(FIND_STRUCTURES)) {
        if (s.structureType === STRUCTURE_WALL)
            walls.add(tileKey(s.pos.x, s.pos.y));
    }
    const out = new Set();
    for (const k of ring) {
        if (walls.has(k))
            continue;
        const { x, y } = parseTile(k);
        for (const [dx, dy] of NEIGHBOURS$1)
            out.add(tileKey(x + dx, y + dy));
    }
    return out;
}
function squareStillClear(room, town) {
    var _a, _b, _c;
    if (town.square.length === 0)
        return true;
    const busy = new Set();
    for (const s of room.find(FIND_STRUCTURES)) {
        if (s.structureType === STRUCTURE_ROAD || s.structureType === STRUCTURE_RAMPART)
            continue;
        busy.add(tileKey(s.pos.x, s.pos.y));
    }
    for (const s of room.find(FIND_CONSTRUCTION_SITES))
        busy.add(tileKey(s.pos.x, s.pos.y));
    const mem = ((_a = room.memory.plannedStructures) !== null && _a !== void 0 ? _a : {});
    for (const key of Object.keys(mem)) {
        if (TOWN_KEYS.has(key) || isRoadKey(key))
            continue;
        for (const p of mem[key])
            busy.add(p);
    }
    for (const e of (_c = (_b = readBlueprint(room)) === null || _b === void 0 ? void 0 : _b.entries) !== null && _c !== void 0 ? _c : []) {
        if (e.type !== STRUCTURE_ROAD)
            busy.add(tileKey(e.x, e.y));
    }
    return town.square.every((k) => !busy.has(k));
}
function planTown(room) {
    var _a, _b, _c, _d;
    const rcl = (_b = (_a = room.controller) === null || _a === void 0 ? void 0 : _a.level) !== null && _b !== void 0 ? _b : 0;
    if (rcl < TOWN.watchRcl)
        return;
    const ring = room.memory.perimeterTiles;
    if (!room.memory.castleAnchor || !ring || ring.length === 0)
        return;
    let town = room.memory.town;
    if (!town) {
        if (!perimeterMostlyBuilt(room, ring))
            return;
        town = { posts: [], square: [], cottages: [] };
    }
    const perimeterAt = (_d = (_c = room.memory.plannedStructuresMeta) === null || _c === void 0 ? void 0 : _c[PLANNER_KEYS.STAMP_RAMPART_KEY]) === null || _d === void 0 ? void 0 : _d.createdAt;
    const nearDoors = besideDoors(room, ring);
    const replanWatch = town.perimeterAt !== perimeterAt ||
        !squareStillClear(room, town) ||
        town.posts.some((p) => nearDoors.has(p));
    const wantMore = town.cottages.length < wantedCottages(room) &&
        (town.failedAt === undefined || Game.time - town.failedAt >= TOWN.retryInterval);
    if (replanWatch || wantMore) {
        const site = buildTownSite(room);
        if (!site)
            return;
        room.memory.town = town;
        if (wantMore) {
            const avoid = new Set([...town.posts, ...town.square]);
            if (town.fountain)
                avoid.add(town.fountain);
            for (const c of town.cottages) {
                for (let dy = -1; dy <= 5; dy++) {
                    for (let dx = -1; dx <= 5; dx++)
                        avoid.add(tileKey(c.x + dx, c.y + dy));
                }
            }
            const name = COTTAGE_FAMILIES[town.cottages.length % COTTAGE_FAMILIES.length];
            const cottage = findCottage(site, avoid, name);
            if (cottage) {
                town.cottages.push(cottage);
                delete town.failedAt;
                console.log(`[Town] ${room.name}: the House of ${cottage.name} is raised at ${cottage.x},${cottage.y}` +
                    (cottage.outside ? " (beyond the walls; the ring will be redrawn)" : ""));
                chronicle(`The House of ${cottage.name} settles ${cottage.outside ? "beyond" : "within"} the walls of ${castleName(room.name)}.`);
                if (cottage.outside && room.memory.plannedStructuresMeta) {
                    delete room.memory.plannedStructuresMeta[PLANNER_KEYS.STAMP_RAMPART_KEY];
                }
            }
            else {
                town.failedAt = Game.time;
            }
        }
        if (replanWatch) {
            const avoid = new Set(nearDoors);
            for (const c of town.cottages) {
                for (let dy = -1; dy <= 5; dy++) {
                    for (let dx = -1; dx <= 5; dx++)
                        avoid.add(tileKey(c.x + dx, c.y + dy));
                }
            }
            town.posts = planWatchPosts(room, site, avoid);
            for (const p of town.posts)
                avoid.add(p);
            const { square, fountain } = planSquare(site, avoid);
            town.square = square;
            if (fountain)
                town.fountain = fountain;
            else
                delete town.fountain;
            town.perimeterAt = perimeterAt;
        }
    }
    room.memory.town = town;
    syncTownPlan(room, town);
}
function syncTownPlan(room, town) {
    const walls = new Set();
    const ramparts = new Set();
    for (const c of town.cottages) {
        const l = cottageLayout(c);
        for (const w of l.walls)
            walls.add(w);
        ramparts.add(l.door);
        for (const b of l.beds)
            ramparts.add(b);
    }
    if (town.fountain)
        walls.add(town.fountain);
    for (const p of town.posts)
        ramparts.add(p);
    const built = new Set();
    for (const s of room.find(FIND_STRUCTURES)) {
        if (s.structureType === STRUCTURE_WALL || s.structureType === STRUCTURE_RAMPART) {
            built.add(`${s.structureType}:${s.pos.x},${s.pos.y}`);
        }
    }
    if (!room.memory.plannedStructures)
        room.memory.plannedStructures = {};
    if (!room.memory.plannedStructuresMeta)
        room.memory.plannedStructuresMeta = {};
    const mem = room.memory.plannedStructures;
    const meta = room.memory.plannedStructuresMeta;
    const put = (key, type, tiles) => {
        const todo = [...tiles].filter((k) => !built.has(`${type}:${k}`));
        if (todo.length === 0) {
            delete mem[key];
            delete meta[key];
            return;
        }
        mem[key] = todo;
        if (!meta[key])
            meta[key] = { createdAt: Game.time };
    };
    put(PLANNER_KEYS.TOWN_WALL_KEY, STRUCTURE_WALL, walls);
    put(PLANNER_KEYS.TOWN_RAMPART_KEY, STRUCTURE_RAMPART, ramparts);
}
function townProtectedRects(room) {
    const town = room.memory.town;
    if (!town)
        return [];
    return town.cottages
        .filter((c) => c.outside)
        .map((c) => ({
        x1: Math.max(1, c.x - 1),
        y1: Math.max(1, c.y - 1),
        x2: Math.min(48, c.x + 5),
        y2: Math.min(48, c.y + 5),
    }));
}
function describeTown(room) {
    var _a, _b;
    const town = room.memory.town;
    const name = castleName(room.name);
    if (!town) {
        const rcl = (_b = (_a = room.controller) === null || _a === void 0 ? void 0 : _a.level) !== null && _b !== void 0 ? _b : 0;
        return [
            rcl < TOWN.watchRcl
                ? `[Town] ${name}: no quarter yet - the watch is raised at RCL ${TOWN.watchRcl}`
                : `[Town] ${name}: no quarter yet - waiting on the perimeter (${Math.round(TOWN.perimeterBuiltRatio * 100)}% built)`,
        ];
    }
    const builtAt = new Set();
    for (const s of room.find(FIND_STRUCTURES)) {
        if (s.structureType === STRUCTURE_WALL || s.structureType === STRUCTURE_RAMPART) {
            builtAt.add(`${s.structureType}:${s.pos.x},${s.pos.y}`);
        }
    }
    const lines = [`[Town] ${name} (${room.name})`];
    const postsUp = town.posts.filter((p) => builtAt.has(`${STRUCTURE_RAMPART}:${p}`)).length;
    lines.push(`  Watch posts: ${postsUp}/${town.posts.length} built`);
    lines.push(town.fountain
        ? `  Square: plaza of ${town.square.length} round the fountain at ${town.fountain}` +
            (builtAt.has(`${STRUCTURE_WALL}:${town.fountain}`) ? "" : " (fountain not yet built)")
        : `  Square: ${town.square.length} loose tiles`);
    for (const c of town.cottages) {
        const l = cottageLayout(c);
        const walls = l.walls.filter((w) => builtAt.has(`${STRUCTURE_WALL}:${w}`)).length;
        const beds = l.beds.filter((b) => builtAt.has(`${STRUCTURE_RAMPART}:${b}`)).length;
        lines.push(`  House of ${c.name} at ${c.x},${c.y}: walls ${walls}/${l.walls.length}, beds ${beds}/${l.beds.length}` +
            (c.outside ? " (beyond the old ring)" : ""));
    }
    const want = wantedCottages(room);
    if (town.cottages.length < want) {
        lines.push(town.failedAt !== undefined
            ? `  No room found for cottage ${town.cottages.length + 1}; looking again in ${TOWN.retryInterval - (Game.time - town.failedAt)} ticks`
            : `  Cottage ${town.cottages.length + 1} is planned next`);
    }
    return lines;
}
function razeTown(room) {
    const tiles = townBarrierTiles(room.memory.town);
    let razed = 0;
    for (const s of room.find(FIND_STRUCTURES)) {
        if (s.structureType !== STRUCTURE_WALL && s.structureType !== STRUCTURE_RAMPART)
            continue;
        if (!tiles.has(tileKey(s.pos.x, s.pos.y)))
            continue;
        if (s.destroy() === OK)
            razed++;
    }
    for (const s of room.find(FIND_MY_CONSTRUCTION_SITES)) {
        if (s.structureType !== STRUCTURE_WALL && s.structureType !== STRUCTURE_RAMPART)
            continue;
        if (tiles.has(tileKey(s.pos.x, s.pos.y)))
            s.remove();
    }
    const mem = room.memory.plannedStructures;
    const meta = room.memory.plannedStructuresMeta;
    for (const key of TOWN_KEYS) {
        if (mem)
            delete mem[key];
        if (meta)
            delete meta[key];
    }
    delete room.memory.town;
    return razed;
}

const BOW_RANGE = 3;
const LOOKOUT_DANGER_RANGE = 6;
const LOOKOUT_RETREAT_TICKS = 300;
const LOOKOUT_DEPTH = 3;
const PHASE_CALLS = {
    dawn: ["cock-a-doo!", "morning!", "to the watch"],
    day: ["all's well", "quiet day", "eyes open"],
    dusk: ["lamps lit", "home time", "supper!"],
    night: ["zzz", "g'night", "bar the door"],
};
const SEASON_CALLS = {
    spring: ["blossoms!", "lambs out", "mud again"],
    summer: ["hot one", "hay to cut", "long day"],
    autumn: ["harvest!", "cider time", "leaves down"],
    winter: ["brr!", "snow again", "stoke fires"],
};
const STORM_CALLS = ["storm!", "bar doors", "rain again"];
const FEAST_CALLS = ["Huzzah!", "ale!", "a toast!", "dance!", "sing!"];
const FEAST_CHEER_PERIOD = 100;
const NIGHT_WATCH_CRY_PERIOD = 100;
let watchTick = -1;
let watchmen = {};
function nightWatchman(roomName) {
    if (watchTick !== Game.time) {
        watchTick = Game.time;
        watchmen = {};
    }
    if (!(roomName in watchmen)) {
        const names = [];
        for (const name in Game.creeps) {
            const c = Game.creeps[name];
            const m = c.memory;
            if (m.role === ROLE_TOWNSFOLK && m.job !== "lookout" && m.homeRoom === roomName && !c.spawning)
                names.push(name);
        }
        names.sort();
        const night = Math.floor(Game.time / TOWN_DAY_LENGTH);
        watchmen[roomName] = names.length >= 2 ? names[night % names.length] : undefined;
    }
    return watchmen[roomName];
}
function runTownsfolk(creep) {
    if (creep.memory.job === "lookout")
        runLookout(creep);
    else
        runMilitia(creep);
}
function armed(c) {
    return c.body.some((p) => p.hits > 0 && (p.type === ATTACK || p.type === RANGED_ATTACK || p.type === WORK));
}
function runMilitia(creep) {
    var _a, _b, _c;
    const home = (_a = creep.memory.homeRoom) !== null && _a !== void 0 ? _a : creep.room.name;
    if (creep.room.name !== home) {
        creep.moveTo(new RoomPosition(25, 25, home), { reusePath: 20 });
        return;
    }
    const room = creep.room;
    const hostiles = getThreatInfo(room).hostiles;
    const inReach = hostiles.filter((h) => creep.pos.inRangeTo(h, BOW_RANGE));
    if (inReach.length > 0) {
        creep.rangedAttack(inReach.reduce((a, b) => (a.hits < b.hits ? a : b)));
    }
    const safeMode = ((_c = (_b = room.controller) === null || _b === void 0 ? void 0 : _b.safeMode) !== null && _c !== void 0 ? _c : 0) > 0;
    if (hostiles.length > 0 && !safeMode) {
        if (!creep.memory.working) {
            creep.memory.working = true;
            delete creep.memory.townSpot;
            creep.say("To arms!", true);
        }
        const nearest = creep.pos.findClosestByRange(hostiles);
        if (nearest) {
            const stations = wallStations(room, creep);
            const inBowRange = stations.filter((k) => {
                const { x, y } = parseTile(k);
                return Math.max(Math.abs(x - nearest.pos.x), Math.abs(y - nearest.pos.y)) <= BOW_RANGE;
            });
            if (parkOn(creep, inBowRange, nearest.pos))
                return;
            if (parkOn(creep, firingSteps(room, creep), nearest.pos))
                return;
            if (parkOn(creep, stations, nearest.pos))
                return;
        }
        parkOn(creep, bedTiles(room.memory.town));
        return;
    }
    creep.memory.working = false;
    const clock = townClock(Game.time);
    callThePhase(creep);
    if (isNightfall(clock.phase)) {
        if (nightWatchman(home) === creep.name) {
            if (Game.time % NIGHT_WATCH_CRY_PERIOD === NIGHT_WATCH_CRY_PERIOD / 2)
                creep.say("all's well", true);
            if (parkIdle(creep, "watch"))
                return;
        }
        if (parkOn(creep, bedTiles(room.memory.town)))
            return;
        parkIdle(creep, "square");
        return;
    }
    if (townFeast(Game.time) && parkIdle(creep, "square"))
        return;
    if (parkIdle(creep, "watch"))
        return;
    parkOn(creep, bedTiles(room.memory.town));
}
function callThePhase(creep) {
    const t = Game.time % TOWN_DAY_LENGTH;
    const phase = TOWN_PHASES.find((p) => p.start === t);
    const feasting = townFeast(Game.time) !== undefined && townClock(Game.time).phase === "day";
    let lines;
    if (feasting && t % FEAST_CHEER_PERIOD === 0)
        lines = FEAST_CALLS;
    else if (!phase)
        return;
    else if (phase.name !== "day")
        lines = PHASE_CALLS[phase.name];
    else
        lines = townStorm(Game.time) ? STORM_CALLS : SEASON_CALLS[townSeason(Game.time)];
    let hash = 0;
    for (let i = 0; i < creep.name.length; i++)
        hash = (hash + creep.name.charCodeAt(i)) | 0;
    creep.say(lines[Math.abs(hash) % lines.length], true);
}
function wallStations(room, self) {
    var _a, _b, _c;
    const ring = new Set((_a = room.memory.perimeterTiles) !== null && _a !== void 0 ? _a : []);
    for (const p of (_c = (_b = room.memory.town) === null || _b === void 0 ? void 0 : _b.posts) !== null && _c !== void 0 ? _c : [])
        ring.add(p);
    const standing = new Set();
    for (const c of room.find(FIND_MY_CREEPS)) {
        if (c.name !== self.name)
            standing.add(`${c.pos.x},${c.pos.y}`);
    }
    const out = [];
    for (const s of room.find(FIND_MY_STRUCTURES)) {
        if (s.structureType !== STRUCTURE_RAMPART)
            continue;
        const k = `${s.pos.x},${s.pos.y}`;
        if (ring.has(k) && !standing.has(k))
            out.push(k);
    }
    return out;
}
const stepsByRoom = {};
function firingSteps(room, self) {
    const ringTiles = room.memory.perimeterTiles;
    const anchor = room.memory.castleAnchor;
    if (!ringTiles || ringTiles.length === 0 || !anchor)
        return [];
    const ringKey = ringTiles.join(";");
    let cached = stepsByRoom[room.name];
    if (!cached || cached.ring !== ringKey) {
        const ring = new Set(ringTiles);
        const interior = floodInterior(room.getTerrain(), ring, anchor);
        const steps = new Set();
        if (interior) {
            for (const k of ringTiles) {
                const { x, y } = parseTile(k);
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        const nx = x + dx;
                        const ny = y + dy;
                        if (nx < 0 || ny < 0 || nx > 49 || ny > 49)
                            continue;
                        if (interior[ny * 50 + nx])
                            steps.add(`${nx},${ny}`);
                    }
                }
            }
        }
        cached = stepsByRoom[room.name] = { ring: ringKey, steps: [...steps] };
    }
    const taken = new Set();
    for (const s of room.find(FIND_STRUCTURES)) {
        const t = s.structureType;
        if (t === STRUCTURE_ROAD || t === STRUCTURE_CONTAINER || t === STRUCTURE_RAMPART)
            continue;
        taken.add(`${s.pos.x},${s.pos.y}`);
    }
    for (const c of room.find(FIND_MY_CREEPS)) {
        if (c.name !== self.name)
            taken.add(`${c.pos.x},${c.pos.y}`);
    }
    return cached.steps.filter((k) => !taken.has(k));
}
function runLookout(creep) {
    var _a, _b, _c, _d;
    const home = (_a = creep.memory.homeRoom) !== null && _a !== void 0 ? _a : creep.room.name;
    const target = creep.memory.targetRoom;
    if (!target || (creep.memory.retreatUntil !== undefined && Game.time < creep.memory.retreatUntil)) {
        if (creep.room.name !== home) {
            creep.moveTo(new RoomPosition(25, 25, home), { reusePath: 20 });
        }
        else {
            parkIdle(creep, "square");
        }
        return;
    }
    if (creep.room.name === target) {
        const owner = (_c = (_b = creep.room.controller) === null || _b === void 0 ? void 0 : _b.owner) === null || _c === void 0 ? void 0 : _c.username;
        const claimed = !!owner && !((_d = creep.room.controller) === null || _d === void 0 ? void 0 : _d.my) && !isAlly(owner);
        const danger = claimed ||
            creep.room
                .find(FIND_HOSTILE_CREEPS)
                .some((h) => { var _a; return !isAlly((_a = h.owner) === null || _a === void 0 ? void 0 : _a.username) && armed(h) && creep.pos.inRangeTo(h, LOOKOUT_DANGER_RANGE); });
        if (danger) {
            creep.memory.retreatUntil = Game.time + LOOKOUT_RETREAT_TICKS;
            creep.say("Raiders!", true);
            creep.moveTo(new RoomPosition(25, 25, home), { reusePath: 5 });
            return;
        }
    }
    const post = lookoutPost(creep, home, target);
    if (!post) {
        if (creep.room.name !== target)
            creep.moveTo(new RoomPosition(25, 25, target), { reusePath: 20 });
        return;
    }
    if (!creep.pos.isEqualTo(post))
        creep.moveTo(post, { reusePath: 50 });
}
function lookoutPost(creep, home, target) {
    const cached = creep.memory.lookoutPos;
    if (cached) {
        const { x, y } = parseTile(cached);
        return new RoomPosition(x, y, target);
    }
    const exits = Game.map.describeExits(target);
    if (!exits)
        return null;
    let side;
    for (const dir in exits) {
        if (exits[dir] === home)
            side = dir;
    }
    if (!side)
        return null;
    const terrain = Game.map.getRoomTerrain(target);
    const edge = [];
    let inward = [0, 0];
    for (let i = 1; i < 49; i++) {
        let x = i;
        let y = i;
        if (side === String(TOP)) {
            y = 0;
            inward = [0, 1];
        }
        else if (side === String(BOTTOM)) {
            y = 49;
            inward = [0, -1];
        }
        else if (side === String(LEFT)) {
            x = 0;
            inward = [1, 0];
        }
        else {
            x = 49;
            inward = [-1, 0];
        }
        if (terrain.get(x, y) !== TERRAIN_MASK_WALL)
            edge.push([x, y]);
    }
    if (edge.length === 0)
        return null;
    const mid = edge[Math.floor(edge.length / 2)];
    const gx = mid[0] + inward[0] * LOOKOUT_DEPTH;
    const gy = mid[1] + inward[1] * LOOKOUT_DEPTH;
    for (let r = 0; r <= 3; r++) {
        for (let dy = -r; dy <= r; dy++) {
            for (let dx = -r; dx <= r; dx++) {
                const x = gx + dx;
                const y = gy + dy;
                if (x < 2 || y < 2 || x > 47 || y > 47)
                    continue;
                if (terrain.get(x, y) === TERRAIN_MASK_WALL)
                    continue;
                creep.memory.lookoutPos = `${x},${y}`;
                return new RoomPosition(x, y, target);
            }
        }
    }
    return null;
}
function lookoutTargets(room, workedRemotes) {
    var _a, _b, _c, _d, _e;
    const exits = Game.map.describeExits(room.name);
    if (!exits)
        return [];
    const me = (_b = (_a = room.controller) === null || _a === void 0 ? void 0 : _a.owner) === null || _b === void 0 ? void 0 : _b.username;
    const out = [];
    for (const dir in exits) {
        const name = exits[dir];
        if (!name || workedRemotes.has(name) || isSourceKeeperRoom(name))
            continue;
        if ((_d = (_c = Game.rooms[name]) === null || _c === void 0 ? void 0 : _c.controller) === null || _d === void 0 ? void 0 : _d.my)
            continue;
        const intel = (_e = Memory.intel) === null || _e === void 0 ? void 0 : _e[name];
        if ((intel === null || intel === void 0 ? void 0 : intel.owner) && intel.owner !== me)
            continue;
        if ((intel === null || intel === void 0 ? void 0 : intel.reservedBy) && intel.reservedBy !== me)
            continue;
        out.push(name);
    }
    return out;
}

const STROLL_TICKS = 10;
const VERSE_TICKS = 25;
const HUMS = ["♪ la la ♪", "♪ hey ho ♪", "♪ fa la la", "♪ ♪ ♪"];
const HUM_PERIOD = 4;
const FEAST_VERSES = {
    spring: (feast) => ["Sow the barley, sow the rye,", `the ${feast} drinks the cellars dry!`],
    summer: (feast) => ["The sun is high, the hay is in,", `so let the ${feast} begin!`],
    autumn: (feast) => ["The barns are full, the cider's sweet,", `at ${feast} we drink and eat!`],
    winter: (feast) => ["The snow is deep, the hearth is bright,", `we keep the ${feast} through the night!`],
};
function ballad(room, time) {
    var _a, _b, _c, _d;
    const home = castleName(room.name);
    const verses = [[`Sing of ${home}, its walls of stone,`, "that bow to none but the Crown alone!"]];
    const feast = townFeast(time);
    if (feast)
        verses.push(FEAST_VERSES[townSeason(time)](feast));
    let castles = 0;
    for (const name in Game.rooms) {
        if (!((_a = Game.rooms[name].controller) === null || _a === void 0 ? void 0 : _a.my))
            continue;
        castles++;
        if (name === room.name)
            continue;
        verses.push([`In the ${wildsName(name)} where the cold winds blow,`, `the banners of ${castleName(name)} stand row on row!`]);
    }
    const annals = Memory.annals;
    const slain = (_b = annals === null || annals === void 0 ? void 0 : annals.slain) !== null && _b !== void 0 ? _b : 0;
    if (slain === 0) {
        verses.push([`No raider came to our gates this ${townSeason(time)};`, "they fear our archers, and with reason!"]);
    }
    else {
        verses.push(slain === 1
            ? ["A raider came to steal our gold;", "now it lies in the earth so cold!"]
            : [`${slain} raiders came to steal our gold;`, "now they lie in the earth so cold!"]);
    }
    const gold = (_c = annals === null || annals === void 0 ? void 0 : annals.gold) !== null && _c !== void 0 ? _c : 0;
    if (gold > 0)
        verses.push([`${formatK(gold)} gold the mines have brought,`, "and not a coin of it for naught!"]);
    const fallen = (_d = annals === null || annals === void 0 ? void 0 : annals.fallen) !== null && _d !== void 0 ? _d : 0;
    if (fallen > 0) {
        verses.push([`Pour one out for the ${fallen === 1 ? "one" : fallen} we lost,`, "who held the line and paid the cost."]);
    }
    verses.push(["Raise a cup to the Crown so high,", `whose banners over ${castles} ${castles === 1 ? "castle" : "castles"} fly!`]);
    return verses;
}
function currentVerse(room, time) {
    const verses = ballad(room, time);
    return verses[Math.floor(time / VERSE_TICKS) % verses.length];
}
function runMinstrel(creep) {
    var _a;
    if (!townFeast(Game.time)) {
        creep.suicide();
        return;
    }
    const home = (_a = creep.memory.homeRoom) !== null && _a !== void 0 ? _a : creep.room.name;
    if (creep.room.name !== home) {
        creep.moveTo(new RoomPosition(25, 25, home), { reusePath: 20 });
        return;
    }
    const town = creep.room.memory.town;
    if (!town || town.square.length === 0)
        return;
    const ring = squareRing(town);
    const at = Math.floor(Game.time / STROLL_TICKS) % ring.length;
    for (let i = 0; i < ring.length; i++) {
        const tile = ring[(at + i) % ring.length];
        const holder = spotHolder(creep.room.name, tile);
        if (holder && holder !== creep.name)
            continue;
        parkOn(creep, [tile]);
        break;
    }
    if (Game.time % HUM_PERIOD === 0)
        creep.say(HUMS[(Game.time / HUM_PERIOD) % HUMS.length], true);
}
function squareRing(town) {
    if (!town.fountain)
        return town.square;
    const c = parseTile(town.fountain);
    const angle = (k) => {
        const { x, y } = parseTile(k);
        return Math.atan2(y - c.y, x - c.x);
    };
    return [...town.square].sort((a, b) => angle(a) - angle(b));
}

const STUCK_THRESHOLD = 3;
const COSTMATRIX_TTL = 1000;
const originalMoveTo = Creep.prototype.moveTo;
const costMatrixCache = {};
const stuckState = new Map();
let stuckPruneTick = -1;
function pruneStuckState() {
    if (stuckPruneTick === Game.time)
        return;
    stuckPruneTick = Game.time;
    for (const name of stuckState.keys()) {
        if (!Game.creeps[name])
            stuckState.delete(name);
    }
}
function getRoomCostMatrix(roomName) {
    const cached = costMatrixCache[roomName];
    const room = Game.rooms[roomName];
    if (!room) {
        if (cached && Game.time - cached.tick < COSTMATRIX_TTL)
            return cached.cm;
        return new PathFinder.CostMatrix();
    }
    const structures = room.find(FIND_STRUCTURES);
    if (cached &&
        Game.time - cached.tick < COSTMATRIX_TTL &&
        cached.structures === structures.length) {
        return cached.cm;
    }
    const cm = new PathFinder.CostMatrix();
    for (const s of structures) {
        if (s.structureType === STRUCTURE_ROAD) {
            if (cm.get(s.pos.x, s.pos.y) === 0)
                cm.set(s.pos.x, s.pos.y, 1);
        }
        else if (s.structureType === STRUCTURE_RAMPART) {
            if (!s.my)
                cm.set(s.pos.x, s.pos.y, 255);
        }
        else if (OBSTACLE_OBJECT_TYPES.includes(s.structureType)) {
            cm.set(s.pos.x, s.pos.y, 255);
        }
    }
    costMatrixCache[roomName] = { cm, tick: Game.time, structures: structures.length };
    return cm;
}
function structureCostCallback(roomName) {
    return getRoomCostMatrix(roomName);
}
const creepAwareCache = {};
let creepAwareTick = -1;
function roadCostCallback(roomName) {
    if (creepAwareTick !== Game.time) {
        creepAwareTick = Game.time;
        for (const k in creepAwareCache)
            delete creepAwareCache[k];
    }
    const cached = creepAwareCache[roomName];
    if (cached)
        return cached;
    const base = getRoomCostMatrix(roomName);
    const room = Game.rooms[roomName];
    if (!room)
        return base;
    const cm = base.clone();
    for (const s of room.find(FIND_MY_CONSTRUCTION_SITES)) {
        if (OBSTACLE_OBJECT_TYPES.includes(s.structureType)) {
            cm.set(s.pos.x, s.pos.y, 0xff);
        }
    }
    for (const c of room.find(FIND_CREEPS))
        cm.set(c.pos.x, c.pos.y, 0xff);
    for (const pc of room.find(FIND_POWER_CREEPS))
        cm.set(pc.pos.x, pc.pos.y, 0xff);
    creepAwareCache[roomName] = cm;
    return cm;
}
function creepAwareIn(here) {
    return (roomName) => (roomName === here ? roadCostCallback(roomName) : getRoomCostMatrix(roomName));
}
const ROUTE_TTL = 500;
const DANGER_ROUTE_COST = 10;
const routeCache = new Map();
let routePruneTick = 0;
let blockedMatrix;
let dangerTick = -1;
let myName;
const markedHostile = new Set();
function refreshDangerContext() {
    var _a, _b;
    if (dangerTick === Game.time)
        return;
    dangerTick = Game.time;
    myName = undefined;
    for (const rn in Game.rooms) {
        const ctrl = Game.rooms[rn].controller;
        if ((ctrl === null || ctrl === void 0 ? void 0 : ctrl.my) && ctrl.owner) {
            myName = ctrl.owner.username;
            break;
        }
    }
    markedHostile.clear();
    for (const rn in Memory.rooms) {
        for (const r of (_b = (_a = Memory.rooms[rn]) === null || _a === void 0 ? void 0 : _a.remoteRooms) !== null && _b !== void 0 ? _b : []) {
            if (r.hostile && (r.hostileUntil === undefined || r.hostileUntil > Game.time)) {
                markedHostile.add(r.roomName);
            }
        }
    }
}
function isHighwayRoom$1(roomName) {
    const m = roomName.match(/^[WE](\d+)[NS](\d+)$/);
    if (!m)
        return false;
    return parseInt(m[1], 10) % 10 === 0 || parseInt(m[2], 10) % 10 === 0;
}
function routeRoomCost(roomName, destRoom) {
    var _a, _b, _c;
    if (roomName === destRoom)
        return 1;
    refreshDangerContext();
    if ((_b = (_a = Game.rooms[roomName]) === null || _a === void 0 ? void 0 : _a.controller) === null || _b === void 0 ? void 0 : _b.my)
        return 1;
    const intel = (_c = Memory.intel) === null || _c === void 0 ? void 0 : _c[roomName];
    const owner = intel === null || intel === void 0 ? void 0 : intel.owner;
    if (intel && owner && owner !== myName && !isAlly(owner)) {
        if (intel.towers === undefined || intel.towers > 0)
            return Infinity;
        return DANGER_ROUTE_COST;
    }
    const reservedBy = intel === null || intel === void 0 ? void 0 : intel.reservedBy;
    if (reservedBy && reservedBy !== myName && !isAlly(reservedBy))
        return DANGER_ROUTE_COST;
    if (isSourceKeeperRoom(roomName) || markedHostile.has(roomName))
        return DANGER_ROUTE_COST;
    if (isHighwayRoom$1(roomName))
        return 1;
    return 2;
}
function getRouteRooms(from, to) {
    if (Game.time - routePruneTick >= ROUTE_TTL) {
        routePruneTick = Game.time;
        for (const [k, v] of routeCache)
            if (Game.time - v.tick >= ROUTE_TTL)
                routeCache.delete(k);
    }
    const key = `${from}:${to}`;
    const cached = routeCache.get(key);
    if (cached && Game.time - cached.tick < ROUTE_TTL)
        return cached.rooms;
    const route = Game.map.findRoute(from, to, { routeCallback: (rn) => routeRoomCost(rn, to) });
    const rooms = route === ERR_NO_PATH ? null : new Set([from, to, ...route.map((r) => r.room)]);
    routeCache.set(key, { rooms, tick: Game.time });
    return rooms;
}
function getBlockedMatrix() {
    if (!blockedMatrix) {
        blockedMatrix = new PathFinder.CostMatrix();
        for (let x = 0; x < 50; x++)
            for (let y = 0; y < 50; y++)
                blockedMatrix.set(x, y, 0xff);
    }
    return blockedMatrix;
}
function restrictToRoute(creep, tpos, opts) {
    if (!(tpos instanceof RoomPosition))
        return;
    const allowed = getRouteRooms(creep.pos.roomName, tpos.roomName);
    if (!allowed)
        return;
    const inner = opts.costCallback;
    opts.costCallback = (roomName, cm) => {
        if (!allowed.has(roomName))
            return getBlockedMatrix();
        return inner ? inner(roomName, cm) : cm;
    };
}
Creep.prototype.moveTo = function (...args) {
    var _a, _b;
    const target = args[0];
    if (typeof target === "number") {
        return originalMoveTo.apply(this, args);
    }
    const opts = args[1];
    const tpos = (_a = target === null || target === void 0 ? void 0 : target.pos) !== null && _a !== void 0 ? _a : target;
    const sameRoom = tpos instanceof RoomPosition && tpos.roomName === this.pos.roomName;
    const range = (_b = opts === null || opts === void 0 ? void 0 : opts.range) !== null && _b !== void 0 ? _b : 1;
    const roomBound = sameRoom ? { maxRooms: 1 } : {};
    if (Memory.trafficDisabled) {
        const plainOpts = { ...roomBound, ...(opts !== null && opts !== void 0 ? opts : {}) };
        if (!sameRoom)
            restrictToRoute(this, tpos, plainOpts);
        return originalMoveTo.call(this, target, plainOpts);
    }
    const effectiveOpts = { plainCost: 2, swampCost: 10, ...roomBound, ...(opts !== null && opts !== void 0 ? opts : {}) };
    if (!effectiveOpts.costCallback) {
        effectiveOpts.costCallback = sameRoom ? roadCostCallback : creepAwareIn(this.pos.roomName);
    }
    if (!sameRoom)
        restrictToRoute(this, tpos, effectiveOpts);
    pruneStuckState();
    if (sameRoom && this.pos.getRangeTo(tpos) <= range) {
        stuckState.delete(this.name);
        return originalMoveTo.call(this, target, effectiveOpts);
    }
    const posKey = this.pos.x * 50 + this.pos.y;
    const prev = stuckState.get(this.name);
    if (prev && prev.t === Game.time) {
        return originalMoveTo.call(this, target, effectiveOpts);
    }
    let st = 0;
    if (prev &&
        prev.t === Game.time - 1 &&
        prev.lpr === this.pos.roomName &&
        prev.lp === posKey &&
        this.fatigue === 0) {
        st = prev.st + 1;
    }
    stuckState.set(this.name, { st, lp: posKey, lpr: this.pos.roomName, t: Game.time });
    if (st >= STUCK_THRESHOLD) {
        stuckState.set(this.name, { st: 0, lp: posKey, lpr: this.pos.roomName, t: Game.time });
        const blocker = sameRoom ? registerShove(this, tpos, range) : null;
        if (blocker)
            return this.move(this.pos.getDirectionTo(blocker.pos));
        effectiveOpts.reusePath = 0;
        return originalMoveTo.call(this, target, effectiveOpts);
    }
    return originalMoveTo.call(this, target, effectiveOpts);
};
function fleeFrom(creep, threats, range) {
    const result = PathFinder.search(creep.pos, threats.map((pos) => ({ pos, range })), { flee: true, maxRooms: 1, plainCost: 2, swampCost: 10, roomCallback: roadCostCallback, maxOps: 500 });
    const next = result.path[0];
    if (!next || next.roomName !== creep.pos.roomName)
        return false;
    return creep.move(creep.pos.getDirectionTo(next)) === OK;
}
const CIVILIAN_ROLES = new Set([
    ROLE_HARVESTER,
    ROLE_MINER,
    ROLE_HAULER,
    ROLE_FILLER,
    ROLE_BUILDER,
    ROLE_REPAIRER,
    ROLE_UPGRADER,
    ROLE_MINERAL_MINER,
    ROLE_MINSTREL,
]);
const RANGED_REACH = 4;
const MELEE_REACH = 2;
const SHELTER_DISTANCE = 6;
const BED_SHELTER_RANGE = 12;
const BED_LINGER_RANGE = 3;
function shelterFromHostiles(creep) {
    var _a, _b;
    if (!CIVILIAN_ROLES.has(creep.memory.role))
        return false;
    const { hostiles } = getThreatInfo(creep.room);
    if (hostiles.length === 0)
        return false;
    if (((_a = creep.room.controller) === null || _a === void 0 ? void 0 : _a.my) && creep.room.controller.safeMode)
        return false;
    const here = `${creep.pos.x},${creep.pos.y}`;
    const beds = ((_b = creep.room.controller) === null || _b === void 0 ? void 0 : _b.my) ? bedTiles(creep.room.memory.town) : [];
    const inBed = creep.memory.townSpot === here && beds.includes(here);
    const margin = inBed ? BED_LINGER_RANGE : 0;
    const threats = [];
    for (const h of hostiles) {
        const reach = h.getActiveBodyparts(RANGED_ATTACK) > 0
            ? RANGED_REACH
            : h.getActiveBodyparts(ATTACK) > 0
                ? MELEE_REACH
                : 0;
        if (reach > 0 && creep.pos.inRangeTo(h.pos, reach + margin))
            threats.push(h.pos);
    }
    if (threats.length === 0)
        return false;
    if (inBed) {
        claimSpot(creep, [here]);
        return true;
    }
    const onRampart = creep.pos
        .lookFor(LOOK_STRUCTURES)
        .some((s) => s.structureType === STRUCTURE_RAMPART && s.my);
    if (onRampart)
        return false;
    const bed = shelterBed(creep, beds, threats);
    if (bed) {
        goToSpot(creep, bed);
        return true;
    }
    return fleeFrom(creep, threats, SHELTER_DISTANCE);
}
function walkHome(creep) {
    const home = creep.memory.homeRoom;
    if (!home || creep.room.name === home || !CIVILIAN_ROLES.has(creep.memory.role))
        return false;
    creep.moveTo(new RoomPosition(25, 25, home), { range: 20 });
    return true;
}
function shelterBed(creep, beds, threats) {
    if (beds.length === 0)
        return null;
    const nearestThreat = (x, y) => Math.min(...threats.map((t) => Math.max(Math.abs(t.x - x), Math.abs(t.y - y))));
    const mine = nearestThreat(creep.pos.x, creep.pos.y);
    const usable = beds.filter((k) => {
        const { x, y } = parseTile(k);
        const far = Math.max(Math.abs(creep.pos.x - x), Math.abs(creep.pos.y - y));
        return far <= BED_SHELTER_RANGE && nearestThreat(x, y) >= mine;
    });
    return usable.length > 0 ? claimSpot(creep, usable) : null;
}
let shoveTick = -1;
let pendingShoves = [];
const MAX_SHOVE_PATHFINDS_PER_ROOM = 3;
let shovePathfindTick = -1;
const shovePathfindsThisTick = {};
function registerShove(creep, targetPos, range) {
    var _a, _b;
    const roomName = creep.pos.roomName;
    if (shovePathfindTick !== Game.time) {
        shovePathfindTick = Game.time;
        for (const k in shovePathfindsThisTick)
            delete shovePathfindsThisTick[k];
    }
    if (((_a = shovePathfindsThisTick[roomName]) !== null && _a !== void 0 ? _a : 0) >= MAX_SHOVE_PATHFINDS_PER_ROOM)
        return null;
    shovePathfindsThisTick[roomName] = ((_b = shovePathfindsThisTick[roomName]) !== null && _b !== void 0 ? _b : 0) + 1;
    const result = PathFinder.search(creep.pos, { pos: targetPos, range }, { roomCallback: structureCostCallback, plainCost: 2, swampCost: 10, maxOps: 1000 });
    const next = result.path[0];
    if (!next || next.roomName !== creep.pos.roomName)
        return null;
    const blocker = next.lookFor(LOOK_CREEPS).find((c) => c.my);
    if (!blocker || blocker.fatigue > 0 || isOnWorkingPost(blocker))
        return null;
    if (shoveTick !== Game.time) {
        shoveTick = Game.time;
        pendingShoves = [];
    }
    pendingShoves.push({ stuck: creep, blocker });
    return blocker;
}
function resolveTraffic() {
    if (Memory.trafficDisabled)
        return;
    if (shoveTick !== Game.time)
        return;
    const moved = new Set();
    for (const { stuck, blocker } of pendingShoves) {
        if (moved.has(blocker.name))
            continue;
        if (blocker.fatigue > 0)
            continue;
        if (isOnWorkingPost(blocker))
            continue;
        const dir = blocker.pos.getDirectionTo(stuck.pos);
        if (!dir)
            continue;
        blocker.move(dir);
        moved.add(blocker.name);
    }
    pendingShoves = [];
}
function isOnWorkingPost(creep) {
    const onContainer = creep.pos
        .lookFor(LOOK_STRUCTURES)
        .some((s) => s.structureType === STRUCTURE_CONTAINER);
    if (onContainer)
        return true;
    const isHauler = creep.memory.role === ROLE_HAULER || creep.memory.role === ROLE_REMOTE_HAULER;
    if (!isHauler && creep.pos.findInRange(FIND_SOURCES, 1).length > 0)
        return true;
    const ctrl = creep.room.controller;
    if (creep.memory.role === ROLE_UPGRADER &&
        creep.memory.working &&
        ctrl &&
        creep.pos.inRangeTo(ctrl, 3))
        return true;
    return false;
}

const EMA_ALPHA = 0.1;
const stats = {};
function recordCpu(name, used) {
    var _a;
    const s = (_a = stats[name]) !== null && _a !== void 0 ? _a : (stats[name] = { ema: used, last: used, peak: used });
    s.last = used;
    s.ema = s.ema * (1 - EMA_ALPHA) + used * EMA_ALPHA;
    if (used > s.peak)
        s.peak = used;
}
function getCpuStats() {
    return stats;
}
const roleStats = {};
function recordRole(role, used) {
    var _a;
    const s = (_a = roleStats[role]) !== null && _a !== void 0 ? _a : (roleStats[role] = { ema: used, last: used, peak: used });
    s.last = used;
    s.ema = s.ema * (1 - EMA_ALPHA) + used * EMA_ALPHA;
    if (used > s.peak)
        s.peak = used;
}
function getRoleStats() {
    return roleStats;
}

const ROLE_HANDLERS = {
    [ROLE_HARVESTER]: runHarvester,
    [ROLE_UPGRADER]: runUpgrader,
    [ROLE_BUILDER]: runBuilder,
    [ROLE_REPAIRER]: runRepairer,
    [ROLE_MINER]: runMiner,
    [ROLE_HAULER]: runHauler,
    [ROLE_FILLER]: runFiller,
    [ROLE_MINERAL_MINER]: runMineralMiner,
    [ROLE_SCOUT]: runScout,
    [ROLE_REMOTE_MINER]: runRemoteMiner,
    [ROLE_REMOTE_HAULER]: runRemoteHauler,
    [ROLE_RESERVER]: runReserver,
    [ROLE_KNIGHT]: runKnight,
    [ROLE_WIZARD]: runWizard,
    [ROLE_CLERIC]: runCleric,
    [ROLE_SIEGER]: runSieger,
    [ROLE_DRAINER]: runDrainer,
    [ROLE_CONQUEROR]: runConqueror,
    [ROLE_SETTLER]: runSettler,
    [ROLE_APOTHECARY]: runApothecary,
    [ROLE_POWER_ATTACKER]: runPowerAttacker,
    [ROLE_POWER_HEALER]: runPowerHealer,
    [ROLE_POWER_CARRIER]: runPowerCarrier,
    [ROLE_DEPOSIT_MINER]: runDepositMiner,
    [ROLE_DEPOSIT_HAULER]: runDepositHauler,
    [ROLE_SK_GUARDIAN]: runSkGuardian,
    [ROLE_SK_MINER]: runSkMiner,
    [ROLE_SK_HAULER]: runSkHauler,
    [ROLE_SCORE_HUNTER]: runScoreHunter,
    [ROLE_UNCLAIMER]: runUnclaimer,
    [ROLE_TOWNSFOLK]: runTownsfolk,
    [ROLE_MINSTREL]: runMinstrel,
};
const GENERAL_CHATTER = ["for Crown!", "gold?", "huzzah!", "long live!", "ale later", "hark!", "onward!", "dragons?!"];
const ROLE_CHATTER = {
    [ROLE_MINER]: ["dig dig", "gold vein!", "rock+stone"],
    [ROLE_HARVESTER]: ["new here", "spiders!", "rats?!"],
    [ROLE_HAULER]: ["make way", "heavy!", "gold run"],
    [ROLE_FILLER]: ["ale's up!", "refilled", "tavern!"],
    [ROLE_UPGRADER]: ["by runes", "it glows!", "Crown +1"],
    [ROLE_BUILDER]: ["stone up", "mortar!", "new wall"],
    [ROLE_REPAIRER]: ["clang!", "mended", "anvil!"],
    [ROLE_MINERAL_MINER]: ["gems!", "rare ore", "shiny!"],
    [ROLE_SCOUT]: ["caw!", "caw caw", "I see you"],
    [ROLE_REMOTE_MINER]: ["fine ore!", "good rates", "for sale!"],
    [ROLE_REMOTE_HAULER]: ["gold only", "fair trade", "wares!"],
    [ROLE_RESERVER]: ["by decree", "king's law", "claimed"],
    [ROLE_KNIGHT]: ["for Crown!", "Have at ye", "no mercy"],
    [ROLE_WIZARD]: ["Burn!", "Hexed!", "Doom!"],
    [ROLE_CLERIC]: ["heal!", "blessed!", "stay close"],
    [ROLE_SIEGER]: ["smash!", "ram it!", "wall down"],
    [ROLE_DRAINER]: ["hit me!", "over here!", "tanking"],
    [ROLE_CONQUEROR]: ["kneel!", "my castle", "bow!"],
    [ROLE_UNCLAIMER]: ["begone!", "usurped", "no king!"],
    [ROLE_SETTLER]: ["new home!", "long road", "finally!"],
    [ROLE_TOWNSFOLK]: ["warm bread", "nice day", "hail Arca!", "tax again?", "gold up"],
    [ROLE_MINSTREL]: ["encore!", "a coin?", "♪ tra la ♪"],
};
const SEASON_CHATTER = {
    spring: ["fresh air", "rain again", "blossoms"],
    summer: ["hot!", "thirsty", "sunburnt"],
    autumn: ["leaves!", "chilly", "harvest!"],
    winter: ["brr!", "cold feet", "snow!"],
};
const FEAST_CHATTER = ["feast!", "ale!", "fair day!"];
const STORM_CHATTER = ["rain!", "soaked!", "thunder!"];
const WEATHER_EVERY = 4;
const SAY_PERIOD = 30;
function chatterLine(creep) {
    var _a;
    let hash = 0;
    for (let i = 0; i < creep.name.length; i++)
        hash = (hash + creep.name.charCodeAt(i)) | 0;
    if ((Game.time + hash) % SAY_PERIOD !== 0)
        return undefined;
    const eventNo = (Game.time + hash) / SAY_PERIOD;
    const pick = Math.abs(eventNo + hash);
    if (pick % WEATHER_EVERY === 0) {
        const weather = townFeast(Game.time)
            ? FEAST_CHATTER
            : townStorm(Game.time)
                ? STORM_CHATTER
                : SEASON_CHATTER[townSeason(Game.time)];
        return weather[(pick / WEATHER_EVERY) % weather.length];
    }
    const lines = (_a = ROLE_CHATTER[creep.memory.role]) !== null && _a !== void 0 ? _a : GENERAL_CHATTER;
    return lines[pick % lines.length];
}
function maybeChatter(creep) {
    var _a;
    const line = (_a = cryFor(creep)) !== null && _a !== void 0 ? _a : chatterLine(creep);
    if (line)
        creep.say(line, true);
}
function loop$e() {
    const profile = Memory.profileRoles === true;
    heraldRooms();
    for (const name in Game.creeps) {
        const creep = Game.creeps[name];
        if (creep.spawning)
            continue;
        const handler = ROLE_HANDLERS[creep.memory.role];
        if (handler) {
            try {
                if (profile) {
                    const start = Game.cpu.getUsed();
                    if (!shelterFromHostiles(creep) && !walkHome(creep))
                        handler(creep);
                    recordRole(creep.memory.role, Game.cpu.getUsed() - start);
                }
                else if (!shelterFromHostiles(creep) && !walkHome(creep)) {
                    handler(creep);
                }
                maybeChatter(creep);
            }
            catch (e) {
                const msg = e instanceof Error ? `${e.message}\n${e.stack}` : String(e);
                console.log(`[ERROR] Creep ${name} (${creep.memory.role}) threw: ${msg}`);
            }
        }
        else if (Game.time % 100 === 0) {
            console.log(`[creep] no handler for role "${creep.memory.role}" on ${name}`);
        }
    }
    resolveTraffic();
}

const LAB_STALL_TIMEOUT = 200;
const LAB_SUPPLY_WAIT_TIMEOUT = 3000;
const SUPPLIED_INPUTS = new Set(["H", "O", "U", "L", "K", "Z", "X", "G"]);
const REACTION_INPUT_MIN = 5;
const LAB_PLAN_INTERVAL = 100;
const LAB_TARGET_BENCH_TICKS = 10000;
const AUTO_PRODUCTION_TARGETS = {
    XUH2O: 3000,
    XKHO2: 3000,
    XLHO2: 3000,
    XZH2O: 2000,
    XZHO2: 2000,
    XGH2O: 3000,
    XGHO2: 2000,
    OH: 10000,
    G: 5000,
};
function loop$d() {
    var _a;
    for (const roomName in Game.rooms) {
        const room = Game.rooms[roomName];
        if (!((_a = room.controller) === null || _a === void 0 ? void 0 : _a.my))
            continue;
        processLabSystem(room);
    }
}
function runBoosts(room) {
    var _a, _b;
    const ls = room.memory.labSystem;
    if (!((_a = ls === null || ls === void 0 ? void 0 : ls.outputLabIds) === null || _a === void 0 ? void 0 : _a.length))
        return;
    const outputLabs = ls.outputLabIds
        .map((id) => Game.getObjectById(id))
        .filter((l) => l !== null);
    const waitingCreeps = room.find(FIND_MY_CREEPS, {
        filter: (c) => !!c.memory.boostCompound && !c.memory.boosted,
    });
    for (const creep of waitingCreeps) {
        const compound = creep.memory.boostCompound;
        for (const lab of outputLabs) {
            if (((_b = lab.store.getUsedCapacity(compound)) !== null && _b !== void 0 ? _b : 0) < 30)
                continue;
            if (!lab.pos.isNearTo(creep.pos))
                continue;
            if (lab.boostCreep(creep) === OK) {
                advanceBoost(creep);
            }
            break;
        }
    }
}
function processLabSystem(room) {
    var _a, _b, _c, _d, _e, _f;
    if (!room.memory.labSystem)
        room.memory.labSystem = { queue: [] };
    const ls = room.memory.labSystem;
    const needsPlan = !ls.lastPlanTick || Game.time - ls.lastPlanTick >= LAB_PLAN_INTERVAL;
    if (needsPlan) {
        refreshLabIdentity(room);
        if (ls.queue.length === 0 && ls.autoEnabled !== false) {
            planAutoProduction(room);
        }
        ls.lastPlanTick = Game.time;
    }
    runBoosts(room);
    if (!ls.inputLabIds || !ls.outputLabIds)
        return;
    const inputLabs = ls.inputLabIds
        .map((id) => Game.getObjectById(id))
        .filter((l) => l !== null);
    const outputLabs = ls.outputLabIds
        .map((id) => Game.getObjectById(id))
        .filter((l) => l !== null);
    if (inputLabs.length < 2 || outputLabs.length === 0)
        return;
    if (!ls.activeCompound) {
        if (ls.queue.length === 0)
            return;
        const next = ls.queue[0];
        const recipe = REACTION_RECIPES[next.compound];
        if (!recipe) {
            ls.queue.shift();
            return;
        }
        ls.activeCompound = next.compound;
        ls.inputCompounds = [recipe[0], recipe[1]];
        ls.startStock = producedStock(next.compound, room, outputLabs);
        ls.targetAmount = next.amount;
        ls.lastProduced = 0;
        ls.lastProgressTick = Game.time;
        return;
    }
    if (!ls.inputCompounds)
        return;
    const produced = producedStock(ls.activeCompound, room, outputLabs) - ((_a = ls.startStock) !== null && _a !== void 0 ? _a : 0);
    if (produced >= ((_b = ls.targetAmount) !== null && _b !== void 0 ? _b : 0)) {
        ls.queue.shift();
        if (ls.queue.length === 0)
            delete ls.plannedTarget;
        delete ls.activeCompound;
        delete ls.inputCompounds;
        delete ls.startStock;
        delete ls.targetAmount;
        delete ls.lastProduced;
        delete ls.lastProgressTick;
        return;
    }
    if (produced > ((_c = ls.lastProduced) !== null && _c !== void 0 ? _c : 0)) {
        ls.lastProduced = produced;
        ls.lastProgressTick = Game.time;
    }
    else if (Game.time - ((_d = ls.lastProgressTick) !== null && _d !== void 0 ? _d : Game.time) > stallTimeout(room, ls.inputCompounds)) {
        console.log(`[Labs] ${room.name}: reaction ${ls.activeCompound} stalled (no progress in ` +
            `${stallTimeout(room, ls.inputCompounds)} ticks) - aborting and advancing queue.`);
        const stalled = ls.queue.shift();
        if ((stalled === null || stalled === void 0 ? void 0 : stalled.auto) && ls.plannedTarget) {
            ls.benchedUntil = { ...ls.benchedUntil, [ls.plannedTarget]: Game.time + LAB_TARGET_BENCH_TICKS };
            ls.queue = ls.queue.filter((e) => !e.auto);
            delete ls.plannedTarget;
        }
        delete ls.activeCompound;
        delete ls.inputCompounds;
        delete ls.startStock;
        delete ls.targetAmount;
        delete ls.lastProduced;
        delete ls.lastProgressTick;
        return;
    }
    const rc0 = ls.inputCompounds[0];
    const rc1 = ls.inputCompounds[1];
    if (((_e = inputLabs[0].store.getUsedCapacity(rc0)) !== null && _e !== void 0 ? _e : 0) > 0 &&
        ((_f = inputLabs[1].store.getUsedCapacity(rc1)) !== null && _f !== void 0 ? _f : 0) > 0) {
        const boostLabIds = new Set();
        for (const lab of assignBoostLabs(outputLabs, getBoostRequests(room).keys()).values()) {
            boostLabIds.add(lab.id);
        }
        for (const outputLab of outputLabs) {
            if (boostLabIds.has(outputLab.id))
                continue;
            outputLab.runReaction(inputLabs[0], inputLabs[1]);
        }
    }
}
function stallTimeout(room, inputs) {
    const awaitingSupply = inputs.some((c) => SUPPLIED_INPUTS.has(c) && labInputStock(room, c) < REACTION_INPUT_MIN);
    return awaitingSupply ? LAB_SUPPLY_WAIT_TIMEOUT : LAB_STALL_TIMEOUT;
}
function producedStock(compound, room, outputLabs) {
    var _a, _b, _c;
    const rc = compound;
    let total = (_b = (_a = room.storage) === null || _a === void 0 ? void 0 : _a.store.getUsedCapacity(rc)) !== null && _b !== void 0 ? _b : 0;
    for (const lab of outputLabs)
        total += (_c = lab.store.getUsedCapacity(rc)) !== null && _c !== void 0 ? _c : 0;
    return total;
}
function refreshLabIdentity(room) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m;
    const labs = room.find(FIND_MY_STRUCTURES, {
        filter: (s) => s.structureType === STRUCTURE_LAB,
    });
    if (labs.length < 3)
        return;
    const ls = room.memory.labSystem;
    const cachedCount = ((_b = (_a = ls.inputLabIds) === null || _a === void 0 ? void 0 : _a.length) !== null && _b !== void 0 ? _b : 0) + ((_d = (_c = ls.outputLabIds) === null || _c === void 0 ? void 0 : _c.length) !== null && _d !== void 0 ? _d : 0);
    if (((_e = ls.inputLabIds) === null || _e === void 0 ? void 0 : _e.length) === 2 &&
        ((_g = (_f = ls.outputLabIds) === null || _f === void 0 ? void 0 : _f.length) !== null && _g !== void 0 ? _g : 0) > 0 &&
        cachedCount === labs.length &&
        [...((_h = ls.inputLabIds) !== null && _h !== void 0 ? _h : []), ...((_j = ls.outputLabIds) !== null && _j !== void 0 ? _j : [])].every((id) => Game.getObjectById(id))) {
        return;
    }
    const refPos = (_l = (_k = room.storage) === null || _k === void 0 ? void 0 : _k.pos) !== null && _l !== void 0 ? _l : (_m = room.find(FIND_MY_SPAWNS)[0]) === null || _m === void 0 ? void 0 : _m.pos;
    if (!refPos)
        return;
    const sorted = [...labs].sort((a, b) => a.pos.getRangeTo(refPos) - b.pos.getRangeTo(refPos));
    const central = sorted.filter((lab) => labs.every((other) => other.id === lab.id || lab.pos.getRangeTo(other) <= 2));
    const inputs = (central.length >= 2 ? central : sorted).slice(0, 2);
    const inputIds = new Set(inputs.map((l) => l.id));
    ls.inputLabIds = inputs.map((l) => l.id);
    ls.outputLabIds = labs.filter((l) => !inputIds.has(l.id)).map((l) => l.id);
}
function planAutoProduction(room) {
    var _a, _b;
    const ls = room.memory.labSystem;
    for (const [compound, target] of Object.entries(AUTO_PRODUCTION_TARGETS)) {
        if (((_b = (_a = ls.benchedUntil) === null || _a === void 0 ? void 0 : _a[compound]) !== null && _b !== void 0 ? _b : 0) > Game.time)
            continue;
        const stock = getStockForCompound(compound, room);
        if (stock < target) {
            const chain = resolveChain(compound, target, room);
            if (chain.length > 0) {
                ls.queue.push(...chain.map((e) => ({ ...e, auto: true })));
                ls.plannedTarget = compound;
                return;
            }
        }
    }
}

function factoryCanRun(factory, recipeLevel) {
    var _a, _b;
    if (recipeLevel === 0)
        return true;
    if (((_a = factory.level) !== null && _a !== void 0 ? _a : 0) !== recipeLevel)
        return false;
    return !!((_b = factory.effects) === null || _b === void 0 ? void 0 : _b.some((e) => e.effect === PWR_OPERATE_FACTORY));
}
function getRecipe(commodity) {
    var _a;
    const def = COMMODITIES[commodity];
    if (!def)
        return null;
    return {
        components: def.components,
        amount: def.amount,
        cooldown: def.cooldown,
        level: (_a = def.level) !== null && _a !== void 0 ? _a : 0,
    };
}
function loop$c() {
    var _a;
    for (const roomName in Game.rooms) {
        const room = Game.rooms[roomName];
        if (!((_a = room.controller) === null || _a === void 0 ? void 0 : _a.my))
            continue;
        processFactory(room);
    }
}
function processFactory(room) {
    const factory = resolveFactory(room);
    if (!factory)
        return;
    const fs = room.memory.factorySystem;
    const needsPlan = !fs.lastPlanTick || Game.time - fs.lastPlanTick >= FACTORY_PLAN_INTERVAL;
    if (needsPlan && fs.autoEnabled !== false) {
        fs.activeCommodity = selectCommodity(room, factory);
        fs.lastPlanTick = Game.time;
    }
    const commodity = fs.activeCommodity;
    if (!commodity) {
        commandCourier(room, factory, null);
        return;
    }
    const recipe = getRecipe(commodity);
    if (!recipe) {
        delete fs.activeCommodity;
        return;
    }
    if (factory.cooldown === 0 && hasAllComponents(factory, recipe)) {
        const res = factory.produce(commodity);
        if (res === ERR_INVALID_TARGET || res === ERR_RCL_NOT_ENOUGH) {
            delete fs.activeCommodity;
        }
        else if (res === ERR_BUSY) {
            delete fs.activeCommodity;
            fs.lastPlanTick = 0;
        }
    }
    commandCourier(room, factory, recipe);
}
function resolveFactory(room) {
    if (!room.memory.factorySystem)
        room.memory.factorySystem = {};
    const fs = room.memory.factorySystem;
    if (fs.factoryId) {
        const cached = Game.getObjectById(fs.factoryId);
        if (cached)
            return cached;
        delete fs.factoryId;
    }
    const factory = room.find(FIND_MY_STRUCTURES, {
        filter: (s) => s.structureType === STRUCTURE_FACTORY,
    })[0];
    if (!factory)
        return null;
    fs.factoryId = factory.id;
    return factory;
}
function selectCommodity(room, factory) {
    var _a, _b;
    let best;
    let bestValue = -Infinity;
    const storedEnergy = (_b = (_a = room.storage) === null || _a === void 0 ? void 0 : _a.store.getUsedCapacity(RESOURCE_ENERGY)) !== null && _b !== void 0 ? _b : 0;
    for (const t of COMMODITY_TARGETS) {
        if (!factoryCanRun(factory, t.requiresLevel))
            continue;
        if (t.commodity === RESOURCE_BATTERY && storedEnergy < FACTORY_BATTERY_MIN_ENERGY)
            continue;
        if (t.value <= bestValue)
            continue;
        if (totalStock(room, t.commodity) >= t.target)
            continue;
        const produce = resolveProduction(room, factory, t.commodity);
        if (!produce)
            continue;
        best = produce;
        bestValue = t.value;
    }
    return best;
}
function resolveProduction(room, factory, commodity, depth = 0, seen = new Set()) {
    var _a, _b, _c, _d, _e;
    if (depth > FACTORY_RESOLVE_MAX_DEPTH)
        return null;
    if (seen.has(commodity))
        return null;
    seen.add(commodity);
    const recipe = getRecipe(commodity);
    if (!recipe)
        return null;
    if (!factoryCanRun(factory, recipe.level))
        return null;
    for (const comp in recipe.components) {
        const rc = comp;
        const needPerBatch = (_a = recipe.components[rc]) !== null && _a !== void 0 ? _a : 0;
        if (needPerBatch <= 0)
            continue;
        const inStores = totalStock(room, rc) - mineralReserve(rc) + ((_b = factory.store.getUsedCapacity(rc)) !== null && _b !== void 0 ? _b : 0);
        if (rc === RESOURCE_ENERGY) {
            const spendable = ((_d = (_c = room.storage) === null || _c === void 0 ? void 0 : _c.store.getUsedCapacity(RESOURCE_ENERGY)) !== null && _d !== void 0 ? _d : 0) - FACTORY_MIN_RESERVE_ENERGY +
                ((_e = factory.store.getUsedCapacity(RESOURCE_ENERGY)) !== null && _e !== void 0 ? _e : 0);
            if (spendable < needPerBatch)
                return null;
            continue;
        }
        if (inStores >= needPerBatch)
            continue;
        if (MANAGED_COMMODITIES.has(rc)) {
            const sub = resolveProduction(room, factory, rc, depth + 1, seen);
            if (sub)
                return sub;
            return null;
        }
        return null;
    }
    return commodity;
}
function hasAllComponents(factory, recipe) {
    var _a, _b;
    for (const comp in recipe.components) {
        const rc = comp;
        const need = (_a = recipe.components[rc]) !== null && _a !== void 0 ? _a : 0;
        if (((_b = factory.store.getUsedCapacity(rc)) !== null && _b !== void 0 ? _b : 0) < need)
            return false;
    }
    return true;
}
function commandCourier(room, factory, recipe) {
    var _a, _b, _c;
    const storage = room.storage;
    if (!storage)
        return;
    const wanted = new Set();
    if (recipe) {
        for (const comp in recipe.components)
            wanted.add(comp);
    }
    const evict = findEvictResource(factory, wanted);
    const load = recipe ? findLoadResource(room, factory, recipe) : null;
    if (!evict && !load && !courierHoldsCargo(room)) {
        releaseCourier(room);
        return;
    }
    const courier = acquireCourier(room);
    if (!courier)
        return;
    const carried = Object.keys(courier.store).filter((r) => { var _a; return ((_a = courier.store.getUsedCapacity(r)) !== null && _a !== void 0 ? _a : 0) > 0; });
    if (carried.length > 0) {
        const r = carried[0];
        if ((load && r === load.resource) || (recipe && factoryWantsMore(factory, recipe, r))) {
            if (courier.transfer(factory, r) === ERR_NOT_IN_RANGE)
                courier.moveTo(factory, { reusePath: 5 });
        }
        else {
            const terminal = room.terminal;
            const preferred = MANAGED_COMMODITIES.has(r) &&
                terminal &&
                ((_a = terminal.store.getUsedCapacity(r)) !== null && _a !== void 0 ? _a : 0) < COMMODITY_TERMINAL_STOCK &&
                ((_b = terminal.store.getFreeCapacity(r)) !== null && _b !== void 0 ? _b : 0) > 0
                ? terminal
                : storage;
            const dest = [preferred, storage, terminal].find((s) => { var _a; return s && ((_a = s.store.getFreeCapacity(r)) !== null && _a !== void 0 ? _a : 0) > 0; });
            if (!dest) {
                courier.drop(r);
                return;
            }
            if (courier.transfer(dest, r) === ERR_NOT_IN_RANGE)
                courier.moveTo(dest, { reusePath: 5 });
        }
        return;
    }
    if (evict) {
        if (courier.withdraw(factory, evict) === ERR_NOT_IN_RANGE)
            courier.moveTo(factory, { reusePath: 5 });
        return;
    }
    if (load) {
        const src = load.source;
        const amount = Math.min((_c = courier.store.getFreeCapacity()) !== null && _c !== void 0 ? _c : 0, load.amount);
        if (amount > 0) {
            if (courier.withdraw(src, load.resource, amount) === ERR_NOT_IN_RANGE) {
                courier.moveTo(src, { reusePath: 5 });
            }
        }
    }
}
function findEvictResource(factory, wanted) {
    var _a;
    const held = Object.keys(factory.store);
    for (const r of held) {
        const amt = (_a = factory.store.getUsedCapacity(r)) !== null && _a !== void 0 ? _a : 0;
        if (amt <= 0)
            continue;
        if (!wanted.has(r)) {
            const batched = r === RESOURCE_ENERGY || MANAGED_COMMODITIES.has(r);
            if (!batched || amt >= FACTORY_PRODUCT_EVICT_THRESHOLD)
                return r;
        }
    }
    return null;
}
function inputShortfall(factory, recipe, rc) {
    var _a, _b;
    const need = (_a = recipe.components[rc]) !== null && _a !== void 0 ? _a : 0;
    if (need <= 0)
        return 0;
    const desired = Math.min(FACTORY_MAX_INPUT_LOAD, Math.max(need * 4, need));
    return desired - ((_b = factory.store.getUsedCapacity(rc)) !== null && _b !== void 0 ? _b : 0);
}
function factoryWantsMore(factory, recipe, rc) {
    var _a;
    return inputShortfall(factory, recipe, rc) > 0 && ((_a = factory.store.getFreeCapacity(rc)) !== null && _a !== void 0 ? _a : 0) > 0;
}
function courierHoldsCargo(room) {
    var _a, _b;
    const name = (_a = room.memory.factorySystem) === null || _a === void 0 ? void 0 : _a.courierName;
    const courier = name ? Game.creeps[name] : undefined;
    return !!courier && ((_b = courier.store.getUsedCapacity()) !== null && _b !== void 0 ? _b : 0) > 0;
}
function findLoadResource(room, factory, recipe) {
    var _a, _b;
    const storage = room.storage;
    const terminal = room.terminal;
    for (const comp in recipe.components) {
        const rc = comp;
        const need = (_a = recipe.components[rc]) !== null && _a !== void 0 ? _a : 0;
        if (need <= 0)
            continue;
        const want = inputShortfall(factory, recipe, rc);
        if (want <= 0)
            continue;
        const spare = totalStock(room, rc) - mineralReserve(rc);
        for (const src of [storage, terminal]) {
            if (!src)
                continue;
            let avail = (_b = src.store.getUsedCapacity(rc)) !== null && _b !== void 0 ? _b : 0;
            if (rc === RESOURCE_ENERGY && src === storage) {
                avail = Math.max(0, avail - FACTORY_MIN_RESERVE_ENERGY);
            }
            else if (rc !== RESOURCE_ENERGY) {
                avail = Math.min(avail, spare);
            }
            if (avail <= 0)
                continue;
            return { resource: rc, source: src, amount: Math.min(want, avail) };
        }
    }
    return null;
}
function acquireCourier(room) {
    var _a, _b;
    const fs = room.memory.factorySystem;
    const haulers = room.find(FIND_MY_CREEPS, {
        filter: (c) => c.memory.role === ROLE_HAULER && c.spawning !== true,
    });
    const mayBorrow = mayBorrowHauler(room, haulers);
    if (fs.courierName) {
        const existing = Game.creeps[fs.courierName];
        if (existing && existing.room.name === room.name && existing.memory.role === ROLE_HAULER) {
            const holdsNonEnergy = ((_a = existing.store.getUsedCapacity()) !== null && _a !== void 0 ? _a : 0) > ((_b = existing.store[RESOURCE_ENERGY]) !== null && _b !== void 0 ? _b : 0);
            if (mayBorrow || holdsNonEnergy)
                return existing;
        }
        delete fs.courierName;
    }
    if (!mayBorrow)
        return null;
    const factory = fs.factoryId ? Game.getObjectById(fs.factoryId) : null;
    const pool = haulers.filter((c) => { var _a; return ((_a = c.store.getUsedCapacity()) !== null && _a !== void 0 ? _a : 0) === 0; });
    if (pool.length === 0)
        return null;
    const chosen = factory
        ? pool.reduce((best, c) => (c.pos.getRangeTo(factory) < best.pos.getRangeTo(factory) ? c : best))
        : pool[0];
    fs.courierName = chosen.name;
    return chosen;
}
function releaseCourier(room) {
    const fs = room.memory.factorySystem;
    if (fs)
        delete fs.courierName;
}
const LAB_MINERALS = new Set([
    RESOURCE_HYDROGEN,
    RESOURCE_OXYGEN,
    RESOURCE_UTRIUM,
    RESOURCE_LEMERGIUM,
    RESOURCE_KEANIUM,
    RESOURCE_ZYNTHIUM,
    RESOURCE_CATALYST,
]);
function mineralReserve(resource) {
    if (resource === RESOURCE_GHODIUM)
        return FACTORY_MIN_RESERVE_MINERAL + NUKER_GHODIUM_RESERVE;
    return LAB_MINERALS.has(resource) ? FACTORY_MIN_RESERVE_MINERAL : 0;
}
function totalStock(room, resource) {
    var _a, _b, _c, _d;
    return (((_b = (_a = room.storage) === null || _a === void 0 ? void 0 : _a.store.getUsedCapacity(resource)) !== null && _b !== void 0 ? _b : 0) +
        ((_d = (_c = room.terminal) === null || _c === void 0 ? void 0 : _c.store.getUsedCapacity(resource)) !== null && _d !== void 0 ? _d : 0));
}
function describeFactories() {
    var _a, _b, _c, _d, _e, _f;
    const lines = [];
    for (const rn in Game.rooms) {
        const room = Game.rooms[rn];
        if (!((_a = room.controller) === null || _a === void 0 ? void 0 : _a.my))
            continue;
        const fs = room.memory.factorySystem;
        const factory = (fs === null || fs === void 0 ? void 0 : fs.factoryId)
            ? Game.getObjectById(fs.factoryId)
            : (_b = room.find(FIND_MY_STRUCTURES, {
                filter: (s) => s.structureType === STRUCTURE_FACTORY,
            })[0]) !== null && _b !== void 0 ? _b : null;
        if (!factory)
            continue;
        const level = (_c = factory.level) !== null && _c !== void 0 ? _c : 0;
        const cd = factory.cooldown;
        const active = (_d = fs === null || fs === void 0 ? void 0 : fs.activeCommodity) !== null && _d !== void 0 ? _d : "idle";
        const auto = (fs === null || fs === void 0 ? void 0 : fs.autoEnabled) !== false;
        const used = (_e = factory.store.getUsedCapacity()) !== null && _e !== void 0 ? _e : 0;
        const cap = (_f = factory.store.getCapacity()) !== null && _f !== void 0 ? _f : 0;
        lines.push(`[Factory] ${rn}: active=${active} level=${level} cd=${cd} auto=${auto} store=${used}/${cap}`);
        const parts = COMMODITY_TARGETS.filter((t) => t.requiresLevel <= level)
            .filter((t) => totalStock(room, t.commodity) < t.target)
            .sort((a, b) => { var _a, _b; return ((_a = COMMODITY_VALUE.get(b.commodity)) !== null && _a !== void 0 ? _a : 0) - ((_b = COMMODITY_VALUE.get(a.commodity)) !== null && _b !== void 0 ? _b : 0); })
            .map((t) => `${t.commodity}=${totalStock(room, t.commodity)}/${t.target}`)
            .join("  ");
        if (parts)
            lines.push(`  ${parts}`);
    }
    return lines;
}
function forceCommodity(roomName, commodity) {
    var _a, _b, _c;
    const room = Game.rooms[roomName];
    if (!((_a = room === null || room === void 0 ? void 0 : room.controller) === null || _a === void 0 ? void 0 : _a.my))
        return `${roomName} is not a room you own`;
    if (!COMMODITIES[commodity])
        return `${commodity} is not a valid commodity`;
    const factory = room.find(FIND_MY_STRUCTURES, {
        filter: (s) => s.structureType === STRUCTURE_FACTORY,
    })[0];
    if (!factory)
        return `${roomName} has no factory`;
    const recipe = getRecipe(commodity);
    if (recipe && recipe.level !== 0 && ((_b = factory.level) !== null && _b !== void 0 ? _b : 0) !== recipe.level) {
        return `${commodity} needs a level ${recipe.level} factory (have ${(_c = factory.level) !== null && _c !== void 0 ? _c : 0})`;
    }
    if (!room.memory.factorySystem)
        room.memory.factorySystem = {};
    room.memory.factorySystem.activeCommodity = commodity;
    room.memory.factorySystem.lastPlanTick = Game.time;
    return null;
}
function setAuto(roomName, enabled) {
    var _a;
    const room = Game.rooms[roomName];
    if (!((_a = room === null || room === void 0 ? void 0 : room.controller) === null || _a === void 0 ? void 0 : _a.my))
        return `${roomName} is not a room you own`;
    if (!room.memory.factorySystem)
        room.memory.factorySystem = {};
    room.memory.factorySystem.autoEnabled = enabled;
    return null;
}

const PIXEL_TALLY_WINDOW = 5000;
const PIXEL_REFILL_WINDOW = 5000;
const PIXEL_REFILL_SLACK = 200;
function loop$b() {
    processPixelGeneration();
}
function processPixelGeneration() {
    var _a, _b;
    if (typeof Game.cpu.generatePixel !== "function")
        return;
    if (Memory.pixelGeneration === false)
        return;
    if (Game.cpu.bucket < 10000)
        return;
    const posture = (_a = Memory.empire) === null || _a === void 0 ? void 0 : _a.posture;
    if (posture === "WAR" || posture === "TURTLE")
        return;
    for (const name in Game.rooms) {
        const room = Game.rooms[name];
        if (((_b = room.controller) === null || _b === void 0 ? void 0 : _b.my) && getThreatInfo(room).hostiles.length > 0)
            return;
    }
    if (Game.cpu.generatePixel() === OK) {
        Memory.lastPixelTick = Game.time;
        Memory.pixelRefillPeak = 0;
        tally("pixels", 1, (n) => `The alchemists distilled ${n === 1 ? "a pixel" : `${n} pixels`} from the realm's idle thought.`, PIXEL_TALLY_WINDOW);
    }
}
function inPixelRefill() {
    var _a;
    const last = Memory.lastPixelTick;
    if (last === undefined)
        return false;
    const elapsed = Game.time - last;
    if (elapsed < 0 || elapsed > PIXEL_REFILL_WINDOW)
        return false;
    const bucket = Game.cpu.bucket;
    const peak = Math.max((_a = Memory.pixelRefillPeak) !== null && _a !== void 0 ? _a : 0, bucket);
    if (bucket < peak - PIXEL_REFILL_SLACK) {
        delete Memory.lastPixelTick;
        delete Memory.pixelRefillPeak;
        return false;
    }
    Memory.pixelRefillPeak = peak;
    return true;
}

const BUCKET_RECOVER_THRESHOLD = 3000;
const BUCKET_RECOVER_EXIT = 6000;
const STRATEGY_INTERVAL = 5;
const MULTI_THREAT_RECOVER_COUNT = 2;
const SPAWNLESS_CRIPPLED_LEVEL = 4;
function loop$a() {
    var _a, _b, _c, _d, _e, _f;
    if (Game.time % STRATEGY_INTERVAL !== 0)
        return;
    const ownedRooms = Object.values(Game.rooms).filter((r) => { var _a; return (_a = r.controller) === null || _a === void 0 ? void 0 : _a.my; });
    const highThreatRooms = [];
    let crippled = false;
    for (const room of ownedRooms) {
        const spawns = room.find(FIND_MY_SPAWNS);
        const mem = room.memory;
        const level = (_b = (_a = room.controller) === null || _a === void 0 ? void 0 : _a.level) !== null && _b !== void 0 ? _b : 0;
        if (spawns.length > 0)
            mem.hadSpawn = true;
        else if (level >= 2 &&
            (mem.hadSpawn || level >= SPAWNLESS_CRIPPLED_LEVEL) &&
            ((_c = Memory.expansion) === null || _c === void 0 ? void 0 : _c.roomName) !== room.name) {
            crippled = true;
        }
        if (getThreatSeverity(room) === "high")
            highThreatRooms.push(room.name);
    }
    const bucket = typeof Game.cpu.bucket === "number" ? Game.cpu.bucket : Number.POSITIVE_INFINITY;
    const wasRecovering = ((_d = Memory.empire) === null || _d === void 0 ? void 0 : _d.posture) === "RECOVER";
    const bucketLimit = wasRecovering ? BUCKET_RECOVER_EXIT : BUCKET_RECOVER_THRESHOLD;
    const bucketCritical = bucket < bucketLimit && !inPixelRefill();
    const multiThreat = highThreatRooms.length >= MULTI_THREAT_RECOVER_COUNT;
    const warTargetRoom = (_e = Memory.empire) === null || _e === void 0 ? void 0 : _e.warTargetRoom;
    let posture;
    let reason;
    if (bucketCritical || crippled || multiThreat) {
        posture = "RECOVER";
        reason = bucketCritical
            ? `CPU bucket ${bucket} below ${bucketLimit}`
            : crippled
                ? "owned room lost its last spawn"
                : `${highThreatRooms.length} owned rooms under HIGH threat`;
    }
    else if (highThreatRooms.length > 0) {
        posture = "TURTLE";
        reason = `${highThreatRooms[0]} under HIGH threat`;
    }
    else if (warTargetRoom) {
        posture = "WAR";
        reason = `war target ${warTargetRoom}`;
    }
    else {
        posture = "EXPAND";
        reason = "healthy, no threats or war target";
    }
    const roomPosture = {};
    for (const name of highThreatRooms)
        roomPosture[name] = "TURTLE";
    const prev = Memory.empire;
    const empire = {
        posture,
        updatedAt: Game.time,
        reason,
        roomPosture,
    };
    if (prev === null || prev === void 0 ? void 0 : prev.warTargetRoom)
        empire.warTargetRoom = prev.warTargetRoom;
    if (prev === null || prev === void 0 ? void 0 : prev.warTargetPlayer)
        empire.warTargetPlayer = prev.warTargetPlayer;
    if (!prev || prev.posture !== posture) {
        console.log(`[Strategy] Posture ${(_f = prev === null || prev === void 0 ? void 0 : prev.posture) !== null && _f !== void 0 ? _f : "EXPAND"} -> ${posture} (${reason})`);
    }
    Memory.empire = empire;
}

const METALS = [
    { name: "or", hex: "#d4af37" },
    { name: "argent", hex: "#e6e6e6" },
];
const COLOURS = [
    { name: "gules", hex: "#a3202a" },
    { name: "azure", hex: "#24489c" },
    { name: "vert", hex: "#2f7a3a" },
    { name: "sable", hex: "#1c1c1c" },
    { name: "purpure", hex: "#6a2c8a" },
];
const DIVISIONS = ["plain", "plain", "per pale", "per fess", "per bend", "quarterly"];
const CHARGES = ["a cross", "a saltire", "a chevron", "a fess", "a roundel"];
function armsHash(roomName) {
    let h = 0x811c9dc5 ^ 0x5eed;
    for (let i = 0; i < roomName.length; i++)
        h = Math.imul(h ^ roomName.charCodeAt(i), 0x01000193);
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    return (h ^ (h >>> 16)) >>> 0;
}
function castleArmsOf(roomName) {
    const h = armsHash(roomName);
    const division = DIVISIONS[h % DIVISIONS.length];
    const metal = METALS[(h >>> 4) % METALS.length];
    const colour = COLOURS[(h >>> 8) % COLOURS.length];
    if (division === "plain")
        return { division, field: colour, other: metal, charge: CHARGES[(h >>> 12) % CHARGES.length] };
    const metalFirst = (h >>> 16) & 1;
    return { division, field: metalFirst ? metal : colour, other: metalFirst ? colour : metal };
}
function blazon(roomName) {
    const a = castleArmsOf(roomName);
    if (a.division === "plain")
        return `${a.field.name}, ${a.charge} ${a.other.name}`;
    return `${a.division} ${a.field.name} and ${a.other.name}`;
}
const SHIELD = (() => {
    const pts = [[-1, -1.2], [1, -1.2]];
    const c = -0.22;
    const r = 1 - c;
    const end = Math.atan2(1.2, -c);
    const STEPS = 8;
    for (let i = 0; i <= STEPS; i++) {
        const a = (end * i) / STEPS;
        pts.push([c + r * Math.cos(a), r * Math.sin(a)]);
    }
    for (let i = STEPS - 1; i >= 0; i--) {
        const a = (end * i) / STEPS;
        pts.push([-(c + r * Math.cos(a)), r * Math.sin(a)]);
    }
    return pts;
})();
const HEART_Y = -0.1;
function clip(poly, a, b, c) {
    const out = [];
    for (let i = 0; i < poly.length; i++) {
        const p = poly[i];
        const q = poly[(i + 1) % poly.length];
        const dp = a * p[0] + b * p[1] - c;
        const dq = a * q[0] + b * q[1] - c;
        if (dp <= 0)
            out.push(p);
        if (dp * dq < 0) {
            const t = dp / (dp - dq);
            out.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]);
        }
    }
    return out;
}
function band(x0, y0, angle, w, shape = SHIELD) {
    const nx = -Math.sin(angle);
    const ny = Math.cos(angle);
    const d = nx * x0 + ny * y0;
    return clip(clip(shape, nx, ny, d + w), -nx, -ny, -d + w);
}
function chargePieces(charge) {
    const BEND = Math.atan2(2.4, 2);
    switch (charge) {
        case "a cross":
            return [band(0, 0, Math.PI / 2, 0.22), band(0, HEART_Y, 0, 0.22)];
        case "a saltire":
            return [band(0, HEART_Y, BEND, 0.2), band(0, HEART_Y, -BEND, 0.2)];
        case "a fess":
            return [band(0, HEART_Y, 0, 0.32)];
        case "a chevron": {
            const left = clip(SHIELD, 1, 0, 0);
            const right = clip(SHIELD, -1, 0, 0);
            return [band(0, -0.3, -0.75, 0.2, left), band(0, -0.3, 0.75, 0.2, right)];
        }
        case "a roundel": {
            const pts = [];
            for (let i = 0; i < 16; i++) {
                const a = (2 * Math.PI * i) / 16;
                pts.push([0.5 * Math.cos(a), HEART_Y + 0.5 * Math.sin(a)]);
            }
            return [pts];
        }
    }
}
const piecesCache = new Map();
function armsPieces(roomName) {
    let pieces = piecesCache.get(roomName);
    if (!pieces) {
        pieces = cutArms(castleArmsOf(roomName));
        piecesCache.set(roomName, pieces);
    }
    return pieces;
}
function cutArms(a) {
    const f = a.field.hex;
    const o = a.other.hex;
    switch (a.division) {
        case "plain":
            return [{ points: SHIELD, fill: f }, ...chargePieces(a.charge).map((points) => ({ points, fill: o }))];
        case "per pale":
            return [{ points: clip(SHIELD, 1, 0, 0), fill: f }, { points: clip(SHIELD, -1, 0, 0), fill: o }];
        case "per fess":
            return [{ points: clip(SHIELD, 0, 1, HEART_Y), fill: f }, { points: clip(SHIELD, 0, -1, -HEART_Y), fill: o }];
        case "per bend":
            return [{ points: clip(SHIELD, -1.2, 1, 0), fill: f }, { points: clip(SHIELD, 1.2, -1, 0), fill: o }];
        case "quarterly": {
            const top = clip(SHIELD, 0, 1, HEART_Y);
            const base = clip(SHIELD, 0, -1, -HEART_Y);
            return [
                { points: clip(top, 1, 0, 0), fill: f },
                { points: clip(top, -1, 0, 0), fill: o },
                { points: clip(base, 1, 0, 0), fill: o },
                { points: clip(base, -1, 0, 0), fill: f },
            ];
        }
    }
}
function armsColours(roomName) {
    const a = castleArmsOf(roomName);
    return { field: a.field.hex, other: a.other.hex };
}
function shieldOutline() {
    return SHIELD;
}

const BOOTSTRAP_MIN_RCL = 3;
const BOOTSTRAP_MIN_STORAGE_ENERGY = 10000;
const BOOTSTRAP_INVASION_PAUSE = 200;
const BOOTSTRAP_TIMEOUT = 6000;
const CLAIM_TIMEOUT = 1500;
const CLAIM_FAILED_COOLDOWN = 20000;
const ESTABLISHED_RETENTION = 1000;
const W_SOURCE_FIRST = 50;
const W_SOURCE_SECOND = 60;
const W_SOURCE_EXTRA = 15;
const W_DIST_PENALTY = 6;
const W_MINERAL_NEW = 25;
const W_MINERAL_RARE = 25;
const W_EXIT_PENALTY = 12;
const W_CHOKEPOINT_BONUS = 30;
const W_REMOTE = 35;
const MAX_SCORED_REMOTES = 4;
const W_ENEMY_PENALTY = 20;
const ENEMY_DANGER_RADIUS = 4;
const STRONG_ENEMY_MILITARY = 8;
const W_SWAMP_PENALTY = 40;
const SWAMP_TOLERANCE = 0.35;
const MAX_TERRAIN_SCANS_PER_TICK = 6;
const MAX_CLAIM_RANGE = 4;
const MAX_INTEL_CANDIDATES = 25;
const MAX_CLAIM_ROUTE = 10;
const AUTO_EXPAND_CHECK_INTERVAL = 50;
const MIN_HOME_RCL = 4;
const MIN_HOME_STORAGE_ENERGY = KEEP_FUND_FLOOR - 5000;
const MIN_BUCKET = 5000;
const MAX_CPU_SHARE_TO_EXPAND = 0.55;
function rankExpansionCandidates() {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    const ownedMinerals = scanOwnedMinerals();
    const claimFailed = recentClaimFailures();
    const terrainBudget = { remaining: MAX_TERRAIN_SCANS_PER_TICK };
    const byRoom = new Map();
    const consider = (roomName, home, sourceCount) => {
        const dist = Game.map.getRoomLinearDistance(home, roomName);
        const existing = byRoom.get(roomName);
        if (!existing || dist < existing.dist) {
            byRoom.set(roomName, { home, dist, sourceCount });
        }
    };
    for (const rn in Game.rooms) {
        const room = Game.rooms[rn];
        if (!((_a = room.controller) === null || _a === void 0 ? void 0 : _a.my))
            continue;
        for (const remote of (_b = room.memory.remoteRooms) !== null && _b !== void 0 ? _b : []) {
            if (isRemoteContested(remote))
                continue;
            if (claimFailed.has(remote.roomName))
                continue;
            const remoteIntel = (_c = Memory.intel) === null || _c === void 0 ? void 0 : _c[remote.roomName];
            if (remoteIntel && intelIsHostile(remoteIntel))
                continue;
            const targetRoom = Game.rooms[remote.roomName];
            if ((_d = targetRoom === null || targetRoom === void 0 ? void 0 : targetRoom.controller) === null || _d === void 0 ? void 0 : _d.my)
                continue;
            if (targetRoom && isRoomContested(targetRoom))
                continue;
            consider(remote.roomName, rn, remote.sources.length);
        }
    }
    const homeNames = [];
    for (const rn in Game.rooms) {
        if (canFundKeeps(Game.rooms[rn]))
            homeNames.push(rn);
    }
    if (homeNames.length > 0 && Memory.intel) {
        let intelSeen = 0;
        for (const rn in Memory.intel) {
            if (intelSeen >= MAX_INTEL_CANDIDATES)
                break;
            if (byRoom.has(rn))
                continue;
            if (claimFailed.has(rn))
                continue;
            if ((_f = (_e = Game.rooms[rn]) === null || _e === void 0 ? void 0 : _e.controller) === null || _f === void 0 ? void 0 : _f.my)
                continue;
            const intel = Memory.intel[rn];
            if (intelIsHostile(intel))
                continue;
            if (isSourceKeeperRoom(rn))
                continue;
            let bestHome;
            let bestDist = Infinity;
            for (const hn of homeNames) {
                const d = Game.map.getRoomLinearDistance(hn, rn);
                if (d <= MAX_CLAIM_RANGE && d < bestDist) {
                    bestDist = d;
                    bestHome = hn;
                }
            }
            if (!bestHome)
                continue;
            intelSeen++;
            const sourceCount = (_h = (_g = intel.sourcePos) === null || _g === void 0 ? void 0 : _g.length) !== null && _h !== void 0 ? _h : 0;
            consider(rn, bestHome, sourceCount);
        }
    }
    const candidates = [];
    for (const [roomName, info] of byRoom) {
        if (!isReachable(info.home, roomName))
            continue;
        const scored = scoreCandidate(roomName, info.home, info.dist, info.sourceCount, ownedMinerals, terrainBudget);
        if (scored)
            candidates.push(scored);
    }
    candidates.sort((a, b) => b.score - a.score);
    return candidates;
}
function scoreCandidate(roomName, home, dist, sourceCount, ownedMinerals, terrainBudget) {
    if (sourceCount <= 0)
        return undefined;
    let score = W_SOURCE_FIRST;
    if (sourceCount >= 2)
        score += W_SOURCE_SECOND;
    if (sourceCount >= 3)
        score += (sourceCount - 2) * W_SOURCE_EXTRA;
    score -= dist * W_DIST_PENALTY;
    const mineral = mineralTypeOf(roomName);
    if (mineral && !ownedMinerals.has(mineral)) {
        score += W_MINERAL_NEW;
        if (mineral === RESOURCE_CATALYST)
            score += W_MINERAL_RARE;
    }
    const exitSides = countExitSides(roomName);
    score -= exitSides * W_EXIT_PENALTY;
    if (exitSides <= 2)
        score += W_CHOKEPOINT_BONUS;
    const remotes = countFreeRemoteNeighbours(roomName);
    score += remotes * W_REMOTE;
    score -= enemyProximityPenalty(roomName);
    if (terrainBudget.remaining > 0) {
        const swamp = swampFraction(roomName);
        if (swamp !== undefined) {
            terrainBudget.remaining--;
            if (swamp > SWAMP_TOLERANCE) {
                score -= (swamp - SWAMP_TOLERANCE) * W_SWAMP_PENALTY;
            }
        }
    }
    return {
        room: roomName,
        homeRoom: home,
        score: Math.round(score),
        sources: sourceCount,
        dist,
        remotes,
        exits: exitSides,
        mineral,
    };
}
function scanOwnedMinerals() {
    var _a;
    const owned = new Set();
    for (const rn in Game.rooms) {
        const room = Game.rooms[rn];
        if (!((_a = room.controller) === null || _a === void 0 ? void 0 : _a.my))
            continue;
        const mineral = room.find(FIND_MINERALS)[0];
        if (mineral)
            owned.add(mineral.mineralType);
    }
    return owned;
}
function mineralTypeOf(roomName) {
    var _a, _b;
    const room = Game.rooms[roomName];
    if (room) {
        const mineral = room.find(FIND_MINERALS)[0];
        if (mineral)
            return mineral.mineralType;
    }
    return (_b = (_a = Memory.intel) === null || _a === void 0 ? void 0 : _a[roomName]) === null || _b === void 0 ? void 0 : _b.mineralType;
}
function countExitSides(roomName) {
    const exits = Game.map.describeExits(roomName);
    let n = 0;
    for (const dir in exits) {
        if (exits[dir])
            n++;
    }
    return n;
}
function countFreeRemoteNeighbours(roomName) {
    var _a, _b, _c, _d, _e;
    const exits = Game.map.describeExits(roomName);
    let count = 0;
    for (const dir in exits) {
        if (count >= MAX_SCORED_REMOTES)
            break;
        const neighbor = exits[dir];
        if (!neighbor)
            continue;
        if ((_b = (_a = Game.rooms[neighbor]) === null || _a === void 0 ? void 0 : _a.controller) === null || _b === void 0 ? void 0 : _b.my)
            continue;
        if (isSourceKeeperRoom(neighbor))
            continue;
        const intel = (_c = Memory.intel) === null || _c === void 0 ? void 0 : _c[neighbor];
        if (!intel)
            continue;
        if (intelIsHostile(intel))
            continue;
        const sources = (_e = (_d = intel.sourcePos) === null || _d === void 0 ? void 0 : _d.length) !== null && _e !== void 0 ? _e : 0;
        if (sources > 0)
            count++;
    }
    return count;
}
function enemyProximityPenalty(roomName) {
    if (!Memory.players)
        return 0;
    const coords = roomNameToCoords(roomName);
    if (!coords)
        return 0;
    let penalty = 0;
    for (const username in Memory.players) {
        const p = Memory.players[username];
        if (p.username === myUsername())
            continue;
        if (p.militaryStrength < STRONG_ENEMY_MILITARY)
            continue;
        const d = Math.max(Math.abs(coords.x - p.centroidX), Math.abs(coords.y - p.centroidY));
        if (d <= ENEMY_DANGER_RADIUS) {
            penalty += (ENEMY_DANGER_RADIUS - d + 1) * W_ENEMY_PENALTY;
        }
    }
    return penalty;
}
function isReachable(home, roomName) {
    const route = Game.map.findRoute(home, roomName);
    return route !== ERR_NO_PATH && route.length <= MAX_CLAIM_ROUTE;
}
function recentClaimFailures() {
    const failures = Memory.claimFailures;
    const result = new Set();
    if (!failures)
        return result;
    for (const rn in failures) {
        if (failures[rn] > Game.time)
            result.add(rn);
        else
            delete failures[rn];
    }
    if (result.size === 0)
        delete Memory.claimFailures;
    return result;
}
function swampFraction(roomName) {
    const terrain = Game.map.getRoomTerrain(roomName);
    if (!terrain)
        return undefined;
    let swamp = 0;
    let sampled = 0;
    for (let x = 0; x < 50; x += 5) {
        for (let y = 0; y < 50; y += 5) {
            sampled++;
            if (terrain.get(x, y) === TERRAIN_MASK_SWAMP)
                swamp++;
        }
    }
    return sampled > 0 ? swamp / sampled : undefined;
}
function intelIsHostile(intel) {
    var _a;
    const me = myUsername();
    if (intel.owner && intel.owner !== me)
        return true;
    if (intel.reservedBy && intel.reservedBy !== me)
        return true;
    if (((_a = intel.threatLevel) !== null && _a !== void 0 ? _a : 0) >= 5)
        return true;
    return false;
}
function roomNameToCoords(roomName) {
    const m = roomName.match(/^([WE])(\d+)([NS])(\d+)$/);
    if (!m)
        return undefined;
    const x = m[1] === "W" ? -parseInt(m[2], 10) : parseInt(m[2], 10);
    const y = m[3] === "N" ? -parseInt(m[4], 10) : parseInt(m[4], 10);
    return { x, y };
}
function isRemoteContested(remote) {
    if (remote.hostile)
        return true;
    if (remote.hostileUntil !== undefined && remote.hostileUntil > Game.time)
        return true;
    return false;
}
function isRoomContested(room) {
    const ctrl = room.controller;
    if (ctrl) {
        if (ctrl.owner && !ctrl.my)
            return true;
        if (ctrl.reservation && ctrl.reservation.username !== myUsername()) {
            return true;
        }
    }
    if (getThreatInfo(room).score > 0)
        return true;
    return false;
}
function myUsername() {
    var _a, _b;
    for (const rn in Game.rooms) {
        const owner = (_a = Game.rooms[rn].controller) === null || _a === void 0 ? void 0 : _a.owner;
        if (((_b = Game.rooms[rn].controller) === null || _b === void 0 ? void 0 : _b.my) && owner)
            return owner.username;
    }
    return undefined;
}
function findRemoteRecord(roomName) {
    var _a, _b;
    for (const rn in Game.rooms) {
        const room = Game.rooms[rn];
        if (!((_a = room.controller) === null || _a === void 0 ? void 0 : _a.my))
            continue;
        const rec = ((_b = room.memory.remoteRooms) !== null && _b !== void 0 ? _b : []).find((r) => r.roomName === roomName);
        if (rec)
            return rec;
    }
    return undefined;
}
function canFundKeeps(room) {
    var _a, _b;
    if (!((_a = room.controller) === null || _a === void 0 ? void 0 : _a.my))
        return false;
    if (((_b = room.controller.level) !== null && _b !== void 0 ? _b : 0) < MIN_HOME_RCL)
        return false;
    if (!room.storage)
        return false;
    return getThreatInfo(room).score === 0;
}
function isHomeRoomHealthy(room) {
    return canFundKeeps(room) && room.storage.store[RESOURCE_ENERGY] >= MIN_HOME_STORAGE_ENERGY;
}
function isChildSelfSufficient(child) {
    var _a, _b, _c, _d;
    if (!child)
        return false;
    if (!((_a = child.controller) === null || _a === void 0 ? void 0 : _a.my))
        return false;
    if (((_b = child.controller.level) !== null && _b !== void 0 ? _b : 0) < BOOTSTRAP_MIN_RCL)
        return false;
    if (child.find(FIND_MY_SPAWNS).length === 0)
        return false;
    const localCreeps = child.find(FIND_MY_CREEPS);
    const hasMiner = localCreeps.some((c) => c.memory.role === ROLE_MINER);
    const hasHauler = localCreeps.some((c) => c.memory.role === ROLE_HAULER);
    const storageEnergy = (_d = (_c = child.storage) === null || _c === void 0 ? void 0 : _c.store[RESOURCE_ENERGY]) !== null && _d !== void 0 ? _d : 0;
    const economyOk = (hasMiner && hasHauler) || storageEnergy >= BOOTSTRAP_MIN_STORAGE_ENERGY;
    if (!economyOk)
        return false;
    return true;
}
function clearExpansion(reason) {
    const exp = Memory.expansion;
    if (!exp)
        return;
    console.log(`[Expansion] Cleared ${exp.roomName} (${reason}).`);
    delete Memory.expansion;
    advanceExpansionQueue();
}
function advanceExpansionQueue() {
    var _a, _b;
    if (Memory.expansion)
        return;
    const queue = Memory.expansionQueue;
    if (!queue || queue.length === 0)
        return;
    const ownedRooms = Object.values(Game.rooms).filter((r) => { var _a; return (_a = r.controller) === null || _a === void 0 ? void 0 : _a.my; });
    if (Game.gcl.level <= ownedRooms.length)
        return;
    if (Game.cpu.bucket < MIN_BUCKET)
        return;
    let toExamine = queue.length;
    while (queue.length > 0 && toExamine-- > 0) {
        const next = queue.shift();
        const targetRoom = Game.rooms[next.roomName];
        if ((_a = targetRoom === null || targetRoom === void 0 ? void 0 : targetRoom.controller) === null || _a === void 0 ? void 0 : _a.my)
            continue;
        if ((_b = targetRoom === null || targetRoom === void 0 ? void 0 : targetRoom.controller) === null || _b === void 0 ? void 0 : _b.owner)
            continue;
        const rec = findRemoteRecord(next.roomName);
        if ((targetRoom && isRoomContested(targetRoom)) || (rec && isRemoteContested(rec))) {
            queue.push(next);
            continue;
        }
        const home = resolveFundingHome(next.roomName, next.homeRoom);
        if (!home) {
            queue.unshift(next);
            return;
        }
        Memory.expansion = {
            roomName: next.roomName,
            homeRoom: home,
            phase: "claiming",
            startedAt: Game.time,
        };
        console.log(`[Expansion] Queue advanced -> claiming ${next.roomName} funded by ${home} ` +
            `(${queue.length} still queued)`);
        return;
    }
}
function resolveFundingHome(roomName, preferred, eligible = isHomeRoomHealthy) {
    if (preferred) {
        const room = Game.rooms[preferred];
        if (room && eligible(room))
            return preferred;
    }
    let best;
    let bestDist = Infinity;
    for (const rn in Game.rooms) {
        const room = Game.rooms[rn];
        if (!eligible(room))
            continue;
        const d = Game.map.getRoomLinearDistance(rn, roomName);
        if (d < bestDist) {
            bestDist = d;
            best = room;
        }
    }
    return best === null || best === void 0 ? void 0 : best.name;
}
function enqueueExpansion(roomName, homeRoom) {
    var _a, _b, _c;
    if (((_a = Memory.expansion) === null || _a === void 0 ? void 0 : _a.roomName) === roomName)
        return `${roomName} is already the active expansion`;
    if (!Memory.expansionQueue)
        Memory.expansionQueue = [];
    if (Memory.expansionQueue.some((q) => q.roomName === roomName)) {
        return `${roomName} is already queued`;
    }
    const targetRoom = Game.rooms[roomName];
    if ((_b = targetRoom === null || targetRoom === void 0 ? void 0 : targetRoom.controller) === null || _b === void 0 ? void 0 : _b.my)
        return `${roomName} is already yours`;
    if (((_c = targetRoom === null || targetRoom === void 0 ? void 0 : targetRoom.controller) === null || _c === void 0 ? void 0 : _c.owner) && !targetRoom.controller.my) {
        return `${roomName} is owned by ${targetRoom.controller.owner.username}`;
    }
    Memory.expansionQueue.push({ roomName, homeRoom, queuedAt: Game.time });
    return null;
}
function dequeueExpansion(roomName) {
    const queue = Memory.expansionQueue;
    if (!queue)
        return false;
    const before = queue.length;
    Memory.expansionQueue = queue.filter((q) => q.roomName !== roomName);
    return Memory.expansionQueue.length !== before;
}
function getExpansionQueue() {
    var _a;
    return (_a = Memory.expansionQueue) !== null && _a !== void 0 ? _a : [];
}
function manageActiveExpansion() {
    var _a, _b, _c, _d;
    const exp = Memory.expansion;
    if (!exp)
        return;
    const child = Game.rooms[exp.roomName];
    if (child && ((_a = child.controller) === null || _a === void 0 ? void 0 : _a.owner) && !child.controller.my) {
        clearExpansion(`contested: ${exp.roomName} owned by ${child.controller.owner.username}`);
        return;
    }
    if (exp.phase === "claiming") {
        const rec = findRemoteRecord(exp.roomName);
        if (rec && isRemoteContested(rec)) {
            if (!Memory.expansionQueue)
                Memory.expansionQueue = [];
            if (!Memory.expansionQueue.some((q) => q.roomName === exp.roomName)) {
                Memory.expansionQueue.push({ roomName: exp.roomName, homeRoom: exp.homeRoom, queuedAt: Game.time });
            }
            clearExpansion(`contested: scout flagged ${exp.roomName} hostile pre-claim - re-queued`);
            return;
        }
        if (Game.time - exp.startedAt > CLAIM_TIMEOUT) {
            const claimerInRoom = Object.values(Game.creeps).some((c) => c.memory.role === ROLE_CONQUEROR &&
                c.memory.targetRoom === exp.roomName &&
                c.room.name === exp.roomName);
            if (!claimerInRoom) {
                if (!Memory.claimFailures)
                    Memory.claimFailures = {};
                Memory.claimFailures[exp.roomName] = Game.time + CLAIM_FAILED_COOLDOWN;
                chronicle(`The conqueror never reached the throne in the ${wildsName(exp.roomName)}. The claim is abandoned.`);
                clearExpansion(`claim timed out after ${CLAIM_TIMEOUT} ticks`);
                return;
            }
        }
    }
    if (exp.phase === "bootstrapping") {
        if (exp.bootstrapStartedAt === undefined)
            exp.bootstrapStartedAt = Game.time;
        if (Game.time - exp.bootstrapStartedAt > BOOTSTRAP_TIMEOUT && !isChildSelfSufficient(child)) {
            if (((_b = child === null || child === void 0 ? void 0 : child.controller) === null || _b === void 0 ? void 0 : _b.my) && child.find(FIND_MY_SPAWNS).length > 0) {
                chronicle(`${castleName(exp.homeRoom)} sends no more settlers. ${castleName(exp.roomName)} must stand on its own now.`);
                clearExpansion(`bootstrap timed out after ${BOOTSTRAP_TIMEOUT} ticks`);
                return;
            }
            chronicle(`The settlers of ${castleName(exp.roomName)} could not make it stand. The keep is abandoned.`);
            if ((_c = child === null || child === void 0 ? void 0 : child.controller) === null || _c === void 0 ? void 0 : _c.my)
                child.controller.unclaim();
            clearExpansion(`bootstrap timed out after ${BOOTSTRAP_TIMEOUT} ticks - no spawn, unclaimed`);
            return;
        }
        if (child) {
            const threat = getThreatInfo(child).score;
            if (threat > 0) {
                exp.pausedUntil = Game.time + BOOTSTRAP_INVASION_PAUSE;
                exp.needsDefender = true;
            }
            else {
                if (exp.needsDefender)
                    exp.needsDefender = false;
                if (exp.pausedUntil && exp.pausedUntil <= Game.time)
                    exp.pausedUntil = undefined;
            }
            if (isChildSelfSufficient(child)) {
                exp.phase = "established";
                exp.establishedAt = Game.time;
                exp.needsDefender = false;
                exp.pausedUntil = undefined;
                console.log(`[Expansion] ${exp.roomName} is self-sufficient (RCL ${child.controller.level}, ` +
                    `own spawn built) - established.`);
                chronicle(`${castleName(exp.roomName)} stands on its own, with barracks of its own, and raises its arms: ${blazon(exp.roomName)}. The realm grows.`);
            }
        }
        return;
    }
    if (exp.phase === "established") {
        const since = (_d = exp.establishedAt) !== null && _d !== void 0 ? _d : exp.startedAt;
        if (Game.time - since > ESTABLISHED_RETENTION) {
            clearExpansion("retention window elapsed");
        }
    }
}
const MAX_AUTO_QUEUE_DEPTH = 3;
function isExpansionPostureAllowed() {
    var _a, _b;
    const posture = (_b = (_a = Memory.empire) === null || _a === void 0 ? void 0 : _a.posture) !== null && _b !== void 0 ? _b : "EXPAND";
    return posture === "EXPAND";
}
function loop$9() {
    manageActiveExpansion();
    if (!Memory.expansion)
        advanceExpansionQueue();
    if (Game.time % AUTO_EXPAND_CHECK_INTERVAL !== 0)
        return;
    if (Memory.autoExpand !== false && isExpansionPostureAllowed())
        autoQueue();
    planSavings();
}
function cpuShareUsed() {
    let total = 0;
    const stats = getCpuStats();
    for (const name in stats)
        total += stats[name].ema;
    return Game.cpu.limit ? total / Game.cpu.limit : 0;
}
function autoQueue() {
    var _a, _b, _c;
    if (Game.cpu.bucket < MIN_BUCKET)
        return;
    if (cpuShareUsed() > MAX_CPU_SHARE_TO_EXPAND)
        return;
    const ownedRooms = Object.values(Game.rooms).filter((r) => { var _a; return (_a = r.controller) === null || _a === void 0 ? void 0 : _a.my; });
    const activeCount = Memory.expansion ? 1 : 0;
    const queuedCount = (_b = (_a = Memory.expansionQueue) === null || _a === void 0 ? void 0 : _a.length) !== null && _b !== void 0 ? _b : 0;
    const gclHeadroom = Game.gcl.level - ownedRooms.length;
    const slotsFree = gclHeadroom - activeCount - queuedCount;
    if (slotsFree <= 0)
        return;
    if (!Memory.expansionQueue)
        Memory.expansionQueue = [];
    let enqueued = 0;
    for (const cand of rankExpansionCandidates()) {
        if (Memory.expansionQueue.length >= MAX_AUTO_QUEUE_DEPTH)
            break;
        if (enqueued >= slotsFree)
            break;
        if (((_c = Memory.expansion) === null || _c === void 0 ? void 0 : _c.roomName) === cand.room)
            continue;
        if (Memory.expansionQueue.some((q) => q.roomName === cand.room))
            continue;
        const home = Game.rooms[cand.homeRoom];
        if (!home || !canFundKeeps(home))
            continue;
        Memory.expansionQueue.push({ roomName: cand.room, homeRoom: cand.homeRoom, queuedAt: Game.time });
        enqueued++;
        console.log(`[AutoExpand] Queued ${cand.room} (score=${cand.score}, sources=${cand.sources}, ` +
            `dist=${cand.dist}) funded by ${cand.homeRoom} - GCL ${Game.gcl.level}/${ownedRooms.length + 1}`);
    }
    if (enqueued > 0 && !Memory.expansion)
        advanceExpansionQueue();
}
function planSavings() {
    var _a;
    const next = (_a = Memory.expansionQueue) === null || _a === void 0 ? void 0 : _a[0];
    const home = next ? resolveFundingHome(next.roomName, next.homeRoom, canFundKeeps) : undefined;
    if (!next || !home) {
        delete Memory.expansionSavings;
        return;
    }
    const plan = Memory.expansionSavings;
    if ((plan === null || plan === void 0 ? void 0 : plan.room) === home && plan.target === next.roomName)
        return;
    Memory.expansionSavings = { room: home, target: next.roomName };
    const after = Memory.expansion && Memory.expansion.phase !== "established" ? "the next keep, " : "a keep ";
    chronicle(`${castleName(home)} fills its coffers to found ${after}in the ${wildsName(next.roomName)}.`);
}

const BODY_PATTERNS = {
    [ROLE_HAULER]: [CARRY, CARRY, MOVE],
    [ROLE_FILLER]: [CARRY, CARRY, MOVE],
    [ROLE_APOTHECARY]: [CARRY, CARRY, MOVE],
    [ROLE_BUILDER]: [WORK, CARRY, MOVE],
    [ROLE_REPAIRER]: [WORK, CARRY, MOVE],
    [ROLE_HARVESTER]: [WORK, CARRY, MOVE],
    [ROLE_UPGRADER]: [WORK, WORK, CARRY, MOVE],
};
const MAX_BODY_PART_COUNT = 50;

function getRoomMemory(room) {
    return room.memory;
}

const SAMPLE_EVERY = 5;
const CLOSE_BOOKS_EVERY = 100;
const SMOOTHING = 0.3;
const windows = {};
function storedGold(room) {
    var _a, _b, _c, _d;
    return ((_b = (_a = room.storage) === null || _a === void 0 ? void 0 : _a.store[RESOURCE_ENERGY]) !== null && _b !== void 0 ? _b : 0) + ((_d = (_c = room.terminal) === null || _c === void 0 ? void 0 : _c.store[RESOURCE_ENERGY]) !== null && _d !== void 0 ? _d : 0);
}
function windowFor(room) {
    let w = windows[room.name];
    if (!w) {
        w = { start: Game.time, samples: 0, sampled: {}, exact: {}, stored: storedGold(room) };
        windows[room.name] = w;
    }
    return w;
}
function add(bucket, key, amount) {
    var _a;
    bucket[key] = ((_a = bucket[key]) !== null && _a !== void 0 ? _a : 0) + amount;
}
function recordSpend(roomName, kind, amount) {
    var _a;
    const room = Game.rooms[roomName];
    if (!((_a = room === null || room === void 0 ? void 0 : room.controller) === null || _a === void 0 ? void 0 : _a.my))
        return;
    add(windowFor(room).exact, kind, amount);
}
function remoteHomes(homes) {
    var _a;
    const map = {};
    for (const home of homes) {
        for (const r of (_a = home.memory.remoteRooms) !== null && _a !== void 0 ? _a : [])
            map[r.roomName] = home.name;
    }
    return map;
}
function isMine(id) {
    const obj = Game.getObjectById(id);
    return !!obj && obj.my;
}
function readEvents(room, w, isHome) {
    var _a, _b, _c, _d;
    const events = room.getEventLog();
    if (events.length === 0)
        return;
    const sources = new Set(room.find(FIND_SOURCES).map((s) => s.id));
    const towers = isHome
        ? new Set(((_a = room.memory.towerIds) !== null && _a !== void 0 ? _a : []).map((id) => id))
        : undefined;
    for (const e of events) {
        switch (e.event) {
            case EVENT_HARVEST:
                if (!sources.has(e.data.targetId))
                    break;
                if (!isHome && !isMine(e.objectId))
                    break;
                add(w.sampled, isHome ? "mines" : "vendors", e.data.amount);
                break;
            case EVENT_UPGRADE_CONTROLLER:
                if (isHome)
                    add(w.sampled, "enchant", (_b = e.data.energySpent) !== null && _b !== void 0 ? _b : 0);
                break;
            case EVENT_BUILD:
                if (isHome || isMine(e.objectId))
                    add(w.sampled, "masonry", (_c = e.data.energySpent) !== null && _c !== void 0 ? _c : 0);
                break;
            case EVENT_REPAIR:
                if (towers === null || towers === void 0 ? void 0 : towers.has(e.objectId))
                    add(w.sampled, "smithy", TOWER_ENERGY_COST);
                else if (isHome || isMine(e.objectId))
                    add(w.sampled, "smithy", (_d = e.data.energySpent) !== null && _d !== void 0 ? _d : 0);
                break;
            case EVENT_ATTACK:
            case EVENT_HEAL:
                if (towers === null || towers === void 0 ? void 0 : towers.has(e.objectId))
                    add(w.sampled, "towers", TOWER_ENERGY_COST);
                break;
        }
    }
}
function round1(n) {
    return Math.round(n * 10) / 10;
}
function blend(prev, next) {
    return round1(prev === undefined ? next : prev * (1 - SMOOTHING) + next * SMOOTHING);
}
const INCOME_KEYS = ["mines", "vendors"];
const SPEND_KEYS = ["recruits", "enchant", "masonry", "smithy", "towers"];
function closeBooks(room) {
    const w = windows[room.name];
    if (!w || w.samples === 0)
        return;
    const ticks = Game.time - w.start;
    if (!Memory.exchequer)
        Memory.exchequer = {};
    const prev = Memory.exchequer[room.name];
    const rate = (key) => { var _a, _b; return ((_a = w.sampled[key]) !== null && _a !== void 0 ? _a : 0) / w.samples + ((_b = w.exact[key]) !== null && _b !== void 0 ? _b : 0) / ticks; };
    const books = { at: Game.time, in: {}, out: {} };
    for (const k of INCOME_KEYS)
        books.in[k] = blend(prev === null || prev === void 0 ? void 0 : prev.in[k], rate(k));
    for (const k of SPEND_KEYS)
        books.out[k] = blend(prev === null || prev === void 0 ? void 0 : prev.out[k], rate(k));
    books.trend = blend(prev === null || prev === void 0 ? void 0 : prev.trend, (storedGold(room) - w.stored) / ticks);
    Memory.exchequer[room.name] = books;
    annal("gold", Math.round((rate("mines") + rate("vendors")) * ticks));
    delete windows[room.name];
    windowFor(room);
}
function loop$8() {
    var _a, _b, _c, _d;
    const homes = [];
    for (const name in Game.rooms) {
        const room = Game.rooms[name];
        if ((_a = room.controller) === null || _a === void 0 ? void 0 : _a.my)
            homes.push(room);
    }
    for (const home of homes)
        windowFor(home);
    if (Game.time % SAMPLE_EVERY === 0) {
        const remotes = remoteHomes(homes);
        for (const home of homes) {
            const w = windowFor(home);
            w.samples++;
            readEvents(home, w, true);
        }
        for (const remoteName in remotes) {
            const remote = Game.rooms[remoteName];
            const home = Game.rooms[remotes[remoteName]];
            if (!remote || !home || ((_b = remote.controller) === null || _b === void 0 ? void 0 : _b.my))
                continue;
            readEvents(remote, windowFor(home), false);
        }
    }
    let closed = false;
    for (const home of homes) {
        if (Game.time - windows[home.name].start < CLOSE_BOOKS_EVERY)
            continue;
        closeBooks(home);
        closed = true;
    }
    if (closed && Memory.exchequer) {
        for (const name in Memory.exchequer) {
            if (!((_d = (_c = Game.rooms[name]) === null || _c === void 0 ? void 0 : _c.controller) === null || _d === void 0 ? void 0 : _d.my))
                delete Memory.exchequer[name];
        }
    }
}
function totalIn(books) {
    return INCOME_KEYS.reduce((s, k) => { var _a; return s + ((_a = books.in[k]) !== null && _a !== void 0 ? _a : 0); }, 0);
}
function totalOut(books) {
    return SPEND_KEYS.reduce((s, k) => { var _a; return s + ((_a = books.out[k]) !== null && _a !== void 0 ? _a : 0); }, 0);
}
function describeBooks(books) {
    const part = (label, n) => n && n >= 0.05 ? `${label} ${n.toFixed(1)}` : undefined;
    const income = INCOME_KEYS.map((k) => part(k, books.in[k])).filter(Boolean).join("  ");
    const spend = SPEND_KEYS.map((k) => part(k, books.out[k])).filter(Boolean).join("  ");
    const net = totalIn(books) - totalOut(books);
    const sign = (n) => (n >= 0 ? `+${n.toFixed(1)}` : n.toFixed(1));
    return [
        `Exchequer ${sign(net)}/t  (in ${totalIn(books).toFixed(1)}, out ${totalOut(books).toFixed(1)})`,
        `  in:  ${income || "nothing"}`,
        `  out: ${spend || "nothing"}`,
    ];
}

function buildScaledBody(role, availableEnergy) {
    var _a;
    const pattern = (_a = BODY_PATTERNS[role]) !== null && _a !== void 0 ? _a : [WORK, CARRY, MOVE];
    const patternCost = calculateBodyPartCost(pattern);
    const maxByParts = Math.floor(MAX_BODY_PART_COUNT / pattern.length);
    const maxByEnergy = Math.floor(availableEnergy / patternCost);
    const repeats = Math.max(1, Math.min(maxByParts, maxByEnergy));
    const body = [];
    for (let i = 0; i < repeats; i++)
        body.push(...pattern);
    return body;
}
function calculateBodyPartCost(parts) {
    return parts.reduce((cost, part) => cost + BODYPART_COST[part], 0);
}
let creepCacheTick = -1;
const creepsByRoleCache = {};
function rebuildCreepCache() {
    if (creepCacheTick === Game.time)
        return;
    creepCacheTick = Game.time;
    for (const key of Object.keys(creepsByRoleCache))
        delete creepsByRoleCache[key];
    for (const name in Game.creeps) {
        const creep = Game.creeps[name];
        const role = creep.memory.role;
        if (role) {
            if (!creepsByRoleCache[role])
                creepsByRoleCache[role] = [];
            creepsByRoleCache[role].push(creep);
        }
    }
}
function getCreepsByRole(role) {
    var _a;
    rebuildCreepCache();
    return (_a = creepsByRoleCache[role]) !== null && _a !== void 0 ? _a : [];
}
function getCreepsByRoleInRoom(role, room) {
    return getCreepsByRole(role).filter((creep) => creep.room.name === room.name);
}
let spawningCacheTick = -1;
const spawningCache = {};
let issuedTick = -1;
const issuedThisTick = {};
const issuedNames = new Set();
function freshIssued() {
    if (issuedTick === Game.time)
        return;
    issuedTick = Game.time;
    issuedNames.clear();
    for (const k of Object.keys(issuedThisTick))
        delete issuedThisTick[k];
}
function getIssuedCount(room, role) {
    var _a, _b;
    freshIssued();
    return (_b = (_a = issuedThisTick[room.name]) === null || _a === void 0 ? void 0 : _a[role]) !== null && _b !== void 0 ? _b : 0;
}
function getRoomSpawningCount(room, role) {
    var _a, _b;
    if (spawningCacheTick !== Game.time) {
        spawningCacheTick = Game.time;
        for (const k of Object.keys(spawningCache))
            delete spawningCache[k];
    }
    if (!spawningCache[room.name]) {
        const counts = {};
        const spawns = room.find(FIND_MY_SPAWNS);
        for (const s of spawns) {
            if (!s.spawning)
                continue;
            const mem = Memory.creeps[s.spawning.name];
            if (!(mem === null || mem === void 0 ? void 0 : mem.role))
                continue;
            const r = mem.role;
            counts[r] = ((_a = counts[r]) !== null && _a !== void 0 ? _a : 0) + 1;
        }
        spawningCache[room.name] = counts;
    }
    return ((_b = spawningCache[room.name][role]) !== null && _b !== void 0 ? _b : 0) + getIssuedCount(room, role);
}
const GIVEN_NAMES = [
    "Aldric", "Agnes", "Bertram", "Beatrix", "Brannoc", "Cedric", "Cecily", "Corvin",
    "Dunstan", "Edith", "Edric", "Fulk", "Gareth", "Gisela", "Godric", "Hild",
    "Isolde", "Ivo", "Jocelin", "Kenric", "Leofric", "Lucan", "Maud", "Merek",
    "Mordred", "Morwen", "Osric", "Percival", "Roderick", "Rowena", "Sigmund", "Sybil",
    "Thorne", "Tristan", "Ulric", "Wulfric", "Ysolde", "Varian",
];
function creepName(role, room) {
    var _a;
    freshIssued();
    const title = (_a = ROLE_TITLES[role]) !== null && _a !== void 0 ? _a : role;
    const graves = new Set(room ? room.find(FIND_TOMBSTONES).map((t) => t.creep.name) : []);
    const start = Game.time % GIVEN_NAMES.length;
    for (let i = 0; i < GIVEN_NAMES.length; i++) {
        const name = `${title} ${GIVEN_NAMES[(start + i) % GIVEN_NAMES.length]}`;
        if (!Game.creeps[name] && !Memory.creeps[name] && !issuedNames.has(name) && !graves.has(name))
            return name;
    }
    return `${title} ${Game.time}`;
}
function trackedSpawn(room, spawn, body, opts) {
    var _a, _b;
    const role = opts.memory.role;
    if (getIssuedCount(room, role) > 0)
        return ERR_BUSY;
    const name = creepName(role, room);
    const res = spawn.spawnCreep(body, name, opts);
    if (res === OK) {
        issuedNames.add(name);
        const byRole = (_a = issuedThisTick[room.name]) !== null && _a !== void 0 ? _a : (issuedThisTick[room.name] = {});
        byRole[role] = ((_b = byRole[role]) !== null && _b !== void 0 ? _b : 0) + 1;
        recordSpend(room.name, "recruits", calculateBodyPartCost(body));
    }
    return res;
}
function countByRoleInRoom(role, room) {
    const present = getCreepsByRoleInRoom(role, room).filter((c) => !c.spawning).length;
    return present + getRoomSpawningCount(room, role);
}
const SPAWN_HOLD_LIMIT = 100;
function holdSpawnFor(room, role) {
    const memory = getRoomMemory(room);
    const hold = memory.spawnHold;
    const continuing = hold !== undefined && hold.role === role && Game.time - hold.lastTick <= 1;
    const since = continuing ? hold.since : Game.time;
    memory.spawnHold = { role, since, lastTick: Game.time };
    return Game.time - since < SPAWN_HOLD_LIMIT;
}
const CAPACITY_TARGET_MARGIN = 0.1;
function bodyBudget(room, basis) {
    return basis === "available"
        ? room.energyAvailable
        : Math.floor(room.energyCapacityAvailable * (1 - CAPACITY_TARGET_MARGIN));
}
function spawnLeadTicks(bodyParts, travelTicks) {
    return bodyParts * CREEP_SPAWN_TIME + travelTicks;
}
function isRetiring(creep, lead) {
    const ttl = creep.ticksToLive;
    return ttl !== undefined && ttl <= lead;
}
const FULL_BODY_ENERGY_RATIO = 0.9;
const FULL_BODY_MAX_WAIT = 40;
function waitForFullBody(room, role, needed) {
    const memory = getRoomMemory(room);
    if (!needed || room.energyAvailable >= room.energyCapacityAvailable * FULL_BODY_ENERGY_RATIO) {
        if (memory.bodyWait)
            delete memory.bodyWait[role];
        return false;
    }
    if (!memory.bodyWait)
        memory.bodyWait = {};
    const wait = memory.bodyWait[role];
    const energy = room.energyAvailable;
    if (typeof wait !== "object" || energy > wait.energy) {
        memory.bodyWait[role] = { since: Game.time, energy };
        return true;
    }
    wait.energy = energy;
    if (Game.time - wait.since < FULL_BODY_MAX_WAIT)
        return true;
    delete memory.bodyWait[role];
    return false;
}
function getRoomPhase$1(room) {
    var _a, _b;
    const rcl = (_b = (_a = room.controller) === null || _a === void 0 ? void 0 : _a.level) !== null && _b !== void 0 ? _b : 0;
    if (rcl <= 2)
        return "bootstrap";
    if (rcl <= 4)
        return "developing";
    if (rcl <= 6)
        return "established";
    return "powerhouse";
}
const BOOST_CANDIDATES = {
    melee: ['XUH2O', 'UH2O', 'UH'],
    ranged: ['XKHO2', 'KHO2', 'KO'],
    healer: ['XLHO2', 'LHO2', 'LO'],
    drainer: ['XLHO2', 'LHO2', 'LO'],
    siege: ['XZH2O', 'ZH2O', 'ZH'],
    tough: ['XGHO2', 'GHO2', 'GO'],
    move: ['XZHO2', 'ZHO2', 'ZO'],
    upgrader: ['XGH2O', 'GH2O', 'GH'],
};
function pickBoostCompound(room, roleKey, boostParts) {
    const candidates = BOOST_CANDIDATES[roleKey];
    if (!candidates)
        return undefined;
    const minRequired = boostParts * 30 + 300;
    for (const compound of candidates) {
        if (getStockForCompound(compound, room) >= minRequired)
            return compound;
    }
    return undefined;
}
function buildBoostQueue(room, roleKey, primaryParts, toughParts, moveParts = 0) {
    const queue = [];
    const primary = pickBoostCompound(room, roleKey, primaryParts);
    if (primary)
        queue.push(primary);
    if (toughParts > 0) {
        const tough = pickBoostCompound(room, "tough", toughParts);
        if (tough)
            queue.push(tough);
    }
    if (moveParts > 0) {
        const move = pickBoostCompound(room, "move", moveParts);
        if (move)
            queue.push(move);
    }
    return queue;
}
function boostMemory(queue) {
    if (queue.length === 0)
        return {};
    return {
        boostCompound: queue[0],
        ...(queue.length > 1 ? { boostQueue: queue.slice(1) } : {}),
    };
}

const REMOTE_ROAD_MIN_RCL = 4;
function remoteRoadsEnabled(home) {
    var _a, _b;
    return ((_b = (_a = home.controller) === null || _a === void 0 ? void 0 : _a.level) !== null && _b !== void 0 ? _b : 0) >= REMOTE_ROAD_MIN_RCL && !!home.storage;
}
const REMOTE_PATH_REFRESH = 10000;
const UNREACHABLE_REMOTE_PATH = 999;
const lastSearchTick = {};
function roadCostMatrix(roomName) {
    const cm = new PathFinder.CostMatrix();
    const room = Game.rooms[roomName];
    if (!room)
        return cm;
    for (const s of room.find(FIND_STRUCTURES)) {
        if (s.structureType === STRUCTURE_ROAD) {
            if (cm.get(s.pos.x, s.pos.y) === 0)
                cm.set(s.pos.x, s.pos.y, 1);
        }
        else if (s.structureType === STRUCTURE_RAMPART) {
            if (!s.my)
                cm.set(s.pos.x, s.pos.y, 255);
        }
        else if (OBSTACLE_OBJECT_TYPES.includes(s.structureType)) {
            cm.set(s.pos.x, s.pos.y, 255);
        }
    }
    return cm;
}
function getRemoteSourcePathLength(home, remote, src) {
    var _a;
    const origin = (_a = home.storage) !== null && _a !== void 0 ? _a : home.find(FIND_MY_SPAWNS)[0];
    const container = src.containerId ? Game.getObjectById(src.containerId) : null;
    const target = container !== null && container !== void 0 ? container : Game.getObjectById(src.sourceId);
    if (!origin || !target)
        return src.pathLength;
    const key = `${origin.id}:${target.id}`;
    const fresh = src.pathKey === key &&
        src.pathTick !== undefined &&
        Game.time - src.pathTick < REMOTE_PATH_REFRESH;
    if (fresh || lastSearchTick[home.name] === Game.time)
        return src.pathLength;
    lastSearchTick[home.name] = Game.time;
    const result = PathFinder.search(origin.pos, { pos: target.pos, range: 1 }, {
        plainCost: 2,
        swampCost: 10,
        maxOps: 4000,
        roomCallback: (rn) => rn === home.name || rn === remote.roomName ? roadCostMatrix(rn) : false,
    });
    src.pathKey = key;
    src.pathTick = Game.time;
    if (result.incomplete) {
        src.pathLength = UNREACHABLE_REMOTE_PATH;
        src.roadTiles = undefined;
    }
    else {
        src.pathLength = result.path.length;
        src.roadTiles = result.path
            .filter((p) => p.roomName === remote.roomName)
            .map((p) => `${p.x},${p.y}`)
            .join(";");
    }
    return src.pathLength;
}

function isRemoteCreepRetiring(home, creep) {
    const target = creep.memory.targetRoom;
    if (!target)
        return false;
    const lead = spawnLeadTicks(creep.body.length, remoteTravelTicks(home, target, creep.memory.remoteSourceId));
    return isRetiring(creep, lead);
}
function remoteTravelTicks(home, roomName, sourceId) {
    var _a;
    const remote = (_a = home.memory.remoteRooms) === null || _a === void 0 ? void 0 : _a.find((r) => r.roomName === roomName);
    if (!remote)
        return estimateRemoteDistance(home, roomName);
    const sources = sourceId ? remote.sources.filter((s) => s.sourceId === sourceId) : remote.sources;
    if (sources.length === 0)
        return estimateRemoteDistance(home, roomName);
    return Math.max(...sources.map((s) => getRemoteSourceDistance(home, remote, s)));
}
function isRemoteEligible(room, r, purpose, ignoreInvaders = false) {
    var _a, _b, _c, _d, _e, _f;
    if (r.hostile || r.sources.length === 0)
        return false;
    if (!ignoreInvaders && r.invaderUntil !== undefined && r.invaderUntil > Game.time)
        return false;
    const ctrl = (_a = Game.rooms[r.roomName]) === null || _a === void 0 ? void 0 : _a.controller;
    const intel = (_b = Memory.intel) === null || _b === void 0 ? void 0 : _b[r.roomName];
    const owner = ctrl ? (_c = ctrl.owner) === null || _c === void 0 ? void 0 : _c.username : intel === null || intel === void 0 ? void 0 : intel.owner;
    if ((ctrl === null || ctrl === void 0 ? void 0 : ctrl.my) || owner)
        return false;
    const reservedBy = ctrl ? (_d = ctrl.reservation) === null || _d === void 0 ? void 0 : _d.username : intel === null || intel === void 0 ? void 0 : intel.reservedBy;
    if (!reservedBy || reservedBy === ((_f = (_e = room.controller) === null || _e === void 0 ? void 0 : _e.owner) === null || _f === void 0 ? void 0 : _f.username))
        return true;
    return reservedBy === "Invader" && purpose === "reserve";
}
function getActiveRemoteRooms(room, purpose = "harvest") {
    var _a;
    const picked = pickRemoteSources(room);
    const out = [];
    for (const r of (_a = room.memory.remoteRooms) !== null && _a !== void 0 ? _a : []) {
        if (!isRemoteEligible(room, r, purpose))
            continue;
        const sources = r.sources.filter((s) => picked.has(s.sourceId));
        if (sources.length > 0)
            out.push({ ...r, sources });
    }
    const rank = (r) => Math.min(...r.sources.map((s) => picked.get(s.sourceId)));
    return out.sort((a, b) => rank(a) - rank(b));
}
function getPickedRemoteRoomNames(room) {
    var _a;
    const picked = pickRemoteSources(room);
    const out = new Set();
    for (const r of (_a = room.memory.remoteRooms) !== null && _a !== void 0 ? _a : []) {
        if (r.sources.some((s) => picked.has(s.sourceId)))
            out.add(r.roomName);
    }
    return out;
}
const MAX_REMOTE_SOURCES = 6;
const REMOTE_SPAWN_SHARE = 0.8;
const REMOTE_PICK_HEADROOM = 0.1;
const REMOTE_CPU_BUCKET_FLOOR = 5000;
const REMOTE_ECONOMY_ROLES = new Set([
    ROLE_REMOTE_MINER,
    ROLE_REMOTE_HAULER,
    ROLE_RESERVER,
]);
function remoteSourceOutput(room) {
    const canReserve = room.energyCapacityAvailable >= BODYPART_COST[CLAIM] + BODYPART_COST[MOVE];
    return ((canReserve ? SOURCE_ENERGY_CAPACITY : SOURCE_ENERGY_NEUTRAL_CAPACITY) / ENERGY_REGEN_TIME);
}
function remoteHaulCarry(output, dist) {
    return (output * 2 * dist) / CARRY_CAPACITY;
}
function getRemoteSourceDistance(room, remote, src) {
    var _a;
    return ((_a = getRemoteSourcePathLength(room, remote, src)) !== null && _a !== void 0 ? _a : estimateRemoteDistance(room, remote.roomName));
}
function planRemoteSource(room, remote, src) {
    const capacity = room.energyCapacityAvailable;
    const output = remoteSourceOutput(room);
    const dist = getRemoteSourceDistance(room, remote, src);
    const roads = remoteRoadsEnabled(room);
    const miner = buildRemoteMinerBody(capacity);
    const hauler = buildRemoteHaulerBody(bodyBudget(room, "capacity"), roads);
    const haulerCarry = Math.max(1, hauler.filter((p) => p === CARRY).length);
    const carry = remoteHaulCarry(output, dist) * REMOTE_HAUL_MARGIN;
    const haulerCostPerCarry = calculateBodyPartCost(hauler) / haulerCarry;
    const haulerPartsPerCarry = hauler.length / haulerCarry;
    const reserver = buildReserverBody(capacity);
    const reserverShare = 1 / remote.sources.length;
    const reserverRespawns = CREEP_LIFE_TIME / CREEP_CLAIM_LIFE_TIME;
    const roadTiles = src.roadTiles ? src.roadTiles.split(";").length : dist;
    const decay = (CONTAINER_DECAY / CONTAINER_DECAY_TIME) * REPAIR_COST +
        (roads ? (roadTiles * ROAD_DECAY_AMOUNT * REPAIR_COST) / ROAD_DECAY_TIME : 0);
    const upkeep = calculateBodyPartCost(miner) / CREEP_LIFE_TIME +
        (carry * haulerCostPerCarry) / CREEP_LIFE_TIME +
        (calculateBodyPartCost(reserver) * reserverShare) / CREEP_CLAIM_LIFE_TIME +
        decay;
    const parts = miner.length + carry * haulerPartsPerCarry + reserver.length * reserverShare * reserverRespawns;
    return { profit: output - upkeep, spawnTime: parts * CREEP_SPAWN_TIME };
}
function remoteSpawnBudget(room) {
    var _a;
    const spawns = room.find(FIND_MY_SPAWNS).length;
    let used = 0;
    for (const name in Game.creeps) {
        const c = Game.creeps[name];
        if (REMOTE_ECONOMY_ROLES.has(c.memory.role))
            continue;
        if (((_a = c.memory.homeRoom) !== null && _a !== void 0 ? _a : c.room.name) !== room.name)
            continue;
        used += c.body.length * CREEP_SPAWN_TIME;
    }
    return spawns * CREEP_LIFE_TIME * REMOTE_SPAWN_SHARE - used;
}
const remotePickCache = {};
function pickRemoteSources(room) {
    var _a;
    const cached = remotePickCache[room.name];
    if (cached && cached.tick === Game.time && cached.remotes === room.memory.remoteRooms) {
        return cached.picked;
    }
    const lowCpu = Game.cpu.bucket < REMOTE_CPU_BUCKET_FLOOR && !inPixelRefill();
    const mined = new Set(getCreepsByRole(ROLE_REMOTE_MINER)
        .filter((c) => c.memory.homeRoom === room.name)
        .map((c) => c.memory.remoteSourceId));
    const plans = [];
    for (const r of (_a = room.memory.remoteRooms) !== null && _a !== void 0 ? _a : []) {
        if (!isRemoteEligible(room, r, "reserve", true))
            continue;
        for (const s of r.sources) {
            if (lowCpu && !mined.has(s.sourceId))
                continue;
            const plan = planRemoteSource(room, r, s);
            if (plan.profit > 0)
                plans.push({ sourceId: s.sourceId, ...plan });
        }
    }
    plans.sort((a, b) => b.profit - a.profit);
    const total = remoteSpawnBudget(room);
    let budget = total;
    const picked = new Map();
    for (const p of plans) {
        if (picked.size >= MAX_REMOTE_SOURCES)
            break;
        const reserve = mined.has(p.sourceId) ? 0 : total * REMOTE_PICK_HEADROOM;
        if (p.spawnTime > budget - reserve)
            continue;
        budget -= p.spawnTime;
        picked.set(p.sourceId, picked.size);
    }
    remotePickCache[room.name] = { tick: Game.time, remotes: room.memory.remoteRooms, picked };
    return picked;
}
function getScoutsForRoom(room) {
    return getCreepsByRole(ROLE_SCOUT).filter((c) => c.memory.homeRoom === room.name);
}
function shouldSpawnScout(room) {
    var _a;
    const pending = (_a = room.memory.pendingScoutRooms) !== null && _a !== void 0 ? _a : [];
    if (pending.length === 0)
        return false;
    const assignedRooms = new Set(getScoutsForRoom(room).map((c) => c.memory.targetRoom));
    return pending.some((r) => !assignedRooms.has(r));
}
function spawnScout(room, spawn) {
    var _a;
    const pending = (_a = room.memory.pendingScoutRooms) !== null && _a !== void 0 ? _a : [];
    const assignedRooms = new Set(getScoutsForRoom(room).map((c) => c.memory.targetRoom));
    const target = pending.find((r) => !assignedRooms.has(r));
    if (!target)
        return false;
    const res = trackedSpawn(room, spawn, [MOVE], {
        memory: { role: ROLE_SCOUT, homeRoom: room.name, targetRoom: target },
    });
    return res === OK;
}
const BASELINE_SCORE_PATROLLERS = 3;
const MAX_SCORE_HUNTERS_PER_ROOM = 8;
const ROOMS_PER_HUNTER = 3;
const BASELINE_SCORE_COLLECTORS = 2;
function shouldSpawnScoreHunter(room) {
    if (!scoreHunterSupported())
        return false;
    if (getThreatInfo(room).score > 0)
        return false;
    if (room.energyAvailable < bodyBudget(room, "capacity"))
        return false;
    const unclaimed = getUnclaimedScoreTargetCount();
    let target;
    if (homeHasObserver(room.name)) {
        target = Math.min(MAX_SCORE_HUNTERS_PER_ROOM, Math.max(BASELINE_SCORE_COLLECTORS, unclaimed));
    }
    else {
        const scanRooms = getScoreScanRooms(room.name, SCORE_SCOUT_RADIUS).length;
        if (unclaimed === 0 && scanRooms === 0)
            return false;
        const coverageNeed = Math.ceil(scanRooms / ROOMS_PER_HUNTER);
        target = Math.min(MAX_SCORE_HUNTERS_PER_ROOM, Math.max(BASELINE_SCORE_PATROLLERS, unclaimed, coverageNeed));
    }
    const owned = getCreepsByRole(ROLE_SCORE_HUNTER).filter((c) => !c.spawning && c.memory.homeRoom === room.name);
    return owned.length + getRoomSpawningCount(room, ROLE_SCORE_HUNTER) < target;
}
function spawnScoreHunter(room, spawn) {
    const res = trackedSpawn(room, spawn, [MOVE], {
        memory: { role: ROLE_SCORE_HUNTER, homeRoom: room.name },
    });
    return res === OK;
}
function findUnassignedRemoteSource(room) {
    const covered = new Set(getCreepsByRole(ROLE_REMOTE_MINER)
        .filter((c) => {
        const home = (c.memory.homeRoom && Game.rooms[c.memory.homeRoom]) || room;
        return !isRemoteCreepRetiring(home, c);
    })
        .map((c) => c.memory.remoteSourceId));
    for (const remote of getActiveRemoteRooms(room)) {
        for (const src of remote.sources) {
            if (!covered.has(src.sourceId)) {
                return { roomName: remote.roomName, sourceId: src.sourceId };
            }
        }
    }
    return null;
}
function shouldSpawnRemoteMiner(room) {
    var _a, _b;
    if (((_b = (_a = room.controller) === null || _a === void 0 ? void 0 : _a.level) !== null && _b !== void 0 ? _b : 0) < 3)
        return false;
    const needed = findUnassignedRemoteSource(room) !== null;
    if (waitForFullBody(room, ROLE_REMOTE_MINER, needed))
        return false;
    return needed;
}
function spawnRemoteMiner(room, spawn) {
    const assignment = findUnassignedRemoteSource(room);
    if (!assignment)
        return false;
    const allowedEnergy = bodyBudget(room, "available");
    const body = buildRemoteMinerBody(allowedEnergy);
    if (room.energyAvailable < calculateBodyPartCost(body))
        return false;
    const res = trackedSpawn(room, spawn, body, {
        memory: {
            role: ROLE_REMOTE_MINER,
            homeRoom: room.name,
            targetRoom: assignment.roomName,
            remoteSourceId: assignment.sourceId,
        },
    });
    return res === OK;
}
function estimateRemoteDistance(homeRoom, remoteRoomName) {
    const rooms = Game.map.getRoomLinearDistance(homeRoom.name, remoteRoomName);
    return rooms * 50 + 25;
}
const MAX_REMOTE_HAULERS_PER_ROOM = 6;
const REMOTE_HAUL_MARGIN = 1.2;
const MIN_REMOTE_HAULER_CARRY = 4;
function getRemoteHaulPlans(room) {
    const carryPerHauler = Math.max(1, buildRemoteHaulerBody(bodyBudget(room, "capacity"), remoteRoadsEnabled(room)).filter((p) => p === CARRY).length);
    const output = remoteSourceOutput(room);
    const plans = {};
    for (const remote of getActiveRemoteRooms(room)) {
        let requiredCarry = 0;
        for (const src of remote.sources) {
            requiredCarry += remoteHaulCarry(output, getRemoteSourceDistance(room, remote, src));
        }
        const count = Math.min(MAX_REMOTE_HAULERS_PER_ROOM, Math.max(1, Math.ceil(requiredCarry / carryPerHauler)));
        const carryEach = Math.min(carryPerHauler, Math.max(MIN_REMOTE_HAULER_CARRY, Math.ceil((requiredCarry * REMOTE_HAUL_MARGIN) / count)));
        plans[remote.roomName] = { count, carryEach };
    }
    return plans;
}
function getRemoteHaulerTarget(room) {
    return Object.values(getRemoteHaulPlans(room)).reduce((a, p) => a + p.count, 0);
}
function neediestRemote(activeRooms, plans, haulersByRoom) {
    var _a, _b, _c;
    let neediest = activeRooms[0].roomName;
    let maxShortfall = -Infinity;
    for (const remote of activeRooms) {
        const shortfall = ((_b = (_a = plans[remote.roomName]) === null || _a === void 0 ? void 0 : _a.count) !== null && _b !== void 0 ? _b : 0) - ((_c = haulersByRoom[remote.roomName]) !== null && _c !== void 0 ? _c : 0);
        if (shortfall > maxShortfall) {
            maxShortfall = shortfall;
            neediest = remote.roomName;
        }
    }
    return neediest;
}
function reassignStrayHaulers(room) {
    var _a, _b;
    const haulers = getCreepsByRole(ROLE_REMOTE_HAULER).filter((c) => c.memory.homeRoom === room.name);
    if (haulers.length === 0)
        return;
    const worked = getPickedRemoteRoomNames(room);
    const strays = haulers.filter((c) => { var _a; return !worked.has((_a = c.memory.targetRoom) !== null && _a !== void 0 ? _a : ""); });
    if (strays.length === 0)
        return;
    const activeRooms = getActiveRemoteRooms(room);
    if (activeRooms.length === 0)
        return;
    const haulersByRoom = {};
    for (const h of haulers) {
        if (strays.includes(h))
            continue;
        const r = h.memory.targetRoom;
        haulersByRoom[r] = ((_a = haulersByRoom[r]) !== null && _a !== void 0 ? _a : 0) + 1;
    }
    const plans = getRemoteHaulPlans(room);
    for (const c of strays) {
        const target = neediestRemote(activeRooms, plans, haulersByRoom);
        c.memory.targetRoom = target;
        haulersByRoom[target] = ((_b = haulersByRoom[target]) !== null && _b !== void 0 ? _b : 0) + 1;
    }
}
function shouldSpawnRemoteHauler(room) {
    var _a, _b;
    if (((_b = (_a = room.controller) === null || _a === void 0 ? void 0 : _a.level) !== null && _b !== void 0 ? _b : 0) < 3)
        return false;
    const activeRooms = getActiveRemoteRooms(room);
    if (activeRooms.length === 0)
        return false;
    const haulers = getCreepsByRole(ROLE_REMOTE_HAULER).filter((c) => c.memory.homeRoom === room.name && !isRemoteCreepRetiring(room, c));
    const needed = haulers.length < getRemoteHaulerTarget(room);
    if (waitForFullBody(room, ROLE_REMOTE_HAULER, needed))
        return false;
    return needed;
}
function spawnRemoteHauler(room, spawn) {
    var _a, _b, _c;
    const activeRooms = getActiveRemoteRooms(room);
    if (activeRooms.length === 0)
        return false;
    const haulers = getCreepsByRole(ROLE_REMOTE_HAULER).filter((c) => c.memory.homeRoom === room.name);
    const haulersByRoom = {};
    for (const h of haulers) {
        const r = (_a = h.memory.targetRoom) !== null && _a !== void 0 ? _a : "";
        haulersByRoom[r] = ((_b = haulersByRoom[r]) !== null && _b !== void 0 ? _b : 0) + 1;
    }
    const plans = getRemoteHaulPlans(room);
    const targetRoomName = neediestRemote(activeRooms, plans, haulersByRoom);
    const roads = remoteRoadsEnabled(room);
    const carryEach = (_c = plans[targetRoomName]) === null || _c === void 0 ? void 0 : _c.carryEach;
    const planEnergy = carryEach === undefined
        ? Infinity
        : (roads ? BODYPART_COST[WORK] + BODYPART_COST[MOVE] : 0) +
            carryEach * (BODYPART_COST[CARRY] + BODYPART_COST[MOVE]);
    const allowedEnergy = Math.min(planEnergy, bodyBudget(room, "available"));
    const body = buildRemoteHaulerBody(allowedEnergy, roads);
    if (room.energyAvailable < calculateBodyPartCost(body))
        return false;
    const res = trackedSpawn(room, spawn, body, {
        memory: {
            role: ROLE_REMOTE_HAULER,
            homeRoom: room.name,
            targetRoom: targetRoomName,
        },
    });
    return res === OK;
}
function buildRemoteMinerBody(availableEnergy) {
    const maxWork = 5;
    const groupCost = 2 * BODYPART_COST[WORK] + BODYPART_COST[MOVE];
    const maxGroups = Math.max(1, Math.floor(availableEnergy / groupCost));
    const groups = Math.min(maxGroups, Math.ceil(maxWork / 2));
    const work = Math.min(maxWork, groups * 2);
    const move = groups;
    const body = [];
    for (let i = 0; i < work; i++)
        body.push(WORK);
    for (let i = 0; i < move; i++)
        body.push(MOVE);
    const cost = work * BODYPART_COST[WORK] + move * BODYPART_COST[MOVE];
    if (availableEnergy >= cost + BODYPART_COST[CARRY])
        body.push(CARRY);
    return body;
}
function buildRemoteHaulerBody(availableEnergy, withWork = false) {
    const head = withWork ? [WORK, MOVE] : [];
    const pattern = [CARRY, MOVE];
    const patternCost = calculateBodyPartCost(pattern);
    const maxByParts = Math.floor((MAX_BODY_PART_COUNT - head.length) / pattern.length);
    const maxByEnergy = Math.floor((availableEnergy - calculateBodyPartCost(head)) / patternCost);
    const repeats = Math.max(2, Math.min(maxByParts, maxByEnergy));
    const body = [...head];
    for (let i = 0; i < repeats; i++)
        body.push(...pattern);
    return body;
}
function getReserversForRoom(homeRoom) {
    return getCreepsByRole(ROLE_RESERVER).filter((c) => c.memory.homeRoom === homeRoom.name);
}
const RESERVATION_TOP_UP_TICKS = 1500;
const MAX_RESERVER_CLAIM = 3;
function needsReservation(room, roomName) {
    var _a, _b, _c;
    const ctrl = (_a = Game.rooms[roomName]) === null || _a === void 0 ? void 0 : _a.controller;
    if (!ctrl)
        return true;
    const res = ctrl.reservation;
    if (!res || res.username !== ((_c = (_b = room.controller) === null || _b === void 0 ? void 0 : _b.owner) === null || _c === void 0 ? void 0 : _c.username))
        return true;
    return res.ticksToEnd < RESERVATION_TOP_UP_TICKS;
}
function findReserverTarget(room) {
    var _a, _b;
    if (((_b = (_a = room.controller) === null || _a === void 0 ? void 0 : _a.level) !== null && _b !== void 0 ? _b : 0) < 3)
        return null;
    const covered = new Set(getReserversForRoom(room)
        .filter((c) => !isRemoteCreepRetiring(room, c))
        .map((c) => c.memory.targetRoom));
    for (const r of getActiveRemoteRooms(room, "reserve")) {
        if (!covered.has(r.roomName) && needsReservation(room, r.roomName))
            return r.roomName;
    }
    return null;
}
function shouldSpawnReserver(room) {
    return findReserverTarget(room) !== null;
}
function buildReserverBody(capacity) {
    const pairCost = BODYPART_COST[CLAIM] + BODYPART_COST[MOVE];
    const pairs = Math.max(1, Math.min(MAX_RESERVER_CLAIM, Math.floor(capacity / pairCost)));
    return [...Array(pairs).fill(CLAIM), ...Array(pairs).fill(MOVE)];
}
function spawnReserver(room, spawn) {
    const target = findReserverTarget(room);
    if (!target)
        return false;
    const body = buildReserverBody(room.energyCapacityAvailable);
    if (room.energyAvailable < calculateBodyPartCost(body))
        return false;
    const res = trackedSpawn(room, spawn, body, {
        memory: {
            role: ROLE_RESERVER,
            homeRoom: room.name,
            targetRoom: target,
        },
    });
    return res === OK;
}

const MILITIA_BODY = [RANGED_ATTACK, MOVE];
const LOOKOUT_BODY = [MOVE];
const MINSTREL_BODY = [MOVE];
function townsfolkOf(room) {
    const out = [];
    for (const name in Game.creeps) {
        const mem = Game.creeps[name].memory;
        if (mem.role === ROLE_TOWNSFOLK && mem.homeRoom === room.name)
            out.push(mem);
    }
    return out;
}
function builtBeds(room) {
    const beds = new Set(bedTiles(room.memory.town));
    if (beds.size === 0)
        return 0;
    let n = 0;
    for (const s of room.find(FIND_MY_STRUCTURES)) {
        if (s.structureType === STRUCTURE_RAMPART && beds.has(`${s.pos.x},${s.pos.y}`))
            n++;
    }
    return n;
}
function townCanGrow(room) {
    var _a, _b, _c;
    if (!room.memory.town)
        return false;
    if (((_b = (_a = room.storage) === null || _a === void 0 ? void 0 : _a.store[RESOURCE_ENERGY]) !== null && _b !== void 0 ? _b : 0) < TOWN.storageGate)
        return false;
    return ((_c = Memory.empire) === null || _c === void 0 ? void 0 : _c.posture) !== "RECOVER" && !isEnergyEmergency(room);
}
function nextTownJob(room) {
    var _a, _b, _c;
    const rcl = (_b = (_a = room.controller) === null || _a === void 0 ? void 0 : _a.level) !== null && _b !== void 0 ? _b : 0;
    if (!townCanGrow(room))
        return null;
    const folk = townsfolkOf(room);
    const militia = folk.filter((m) => m.job !== "lookout").length;
    const wantMilitia = Math.min((_c = TOWN.militiaByRcl[rcl]) !== null && _c !== void 0 ? _c : 0, builtBeds(room));
    if (militia < wantMilitia)
        return { job: "militia" };
    if (rcl < TOWN.lookoutRcl)
        return null;
    const posted = new Set(folk.filter((m) => m.job === "lookout").map((m) => m.targetRoom));
    if (posted.size >= TOWN.maxLookouts)
        return null;
    const open = lookoutTargets(room, getPickedRemoteRoomNames(room)).find((r) => !posted.has(r));
    return open ? { job: "lookout", targetRoom: open } : null;
}
function wantsMinstrel(room) {
    var _a;
    if (!((_a = room.memory.town) === null || _a === void 0 ? void 0 : _a.fountain) || !townFeast(Game.time))
        return false;
    if (isNightfall(townClock(Game.time).phase) || !townCanGrow(room))
        return false;
    for (const name in Game.creeps) {
        const mem = Game.creeps[name].memory;
        if (mem.role === ROLE_MINSTREL && mem.homeRoom === room.name)
            return false;
    }
    return true;
}
function spawnMinstrel(room, spawn) {
    const memory = { role: ROLE_MINSTREL, homeRoom: room.name };
    if (trackedSpawn(room, spawn, MINSTREL_BODY, { memory }) !== OK)
        return false;
    chronicle(`A minstrel comes to ${castleName(room.name)} Square for the ${townFeast(Game.time)}.`);
    return true;
}
function spawnTownsfolk(room, spawn) {
    const next = nextTownJob(room);
    if (!next)
        return wantsMinstrel(room) && spawnMinstrel(room, spawn);
    const body = next.job === "militia" ? MILITIA_BODY : LOOKOUT_BODY;
    const memory = {
        role: ROLE_TOWNSFOLK,
        job: next.job,
        homeRoom: room.name,
        ...(next.job === "lookout" ? { targetRoom: next.targetRoom } : {}),
    };
    return trackedSpawn(room, spawn, body, { memory }) === OK;
}

const UNREACHABLE_DISTANCE = 999;
function getMinerTravelTicks(room) {
    var _a, _b;
    const spawn = getSpawnForRoom(room);
    if (!spawn)
        return 0;
    const containers = ((_a = room.memory.minerContainerIds) !== null && _a !== void 0 ? _a : [])
        .map((id) => Game.getObjectById(id))
        .filter(Boolean);
    if (containers.length === 0)
        return 0;
    const distances = getContainerDistances(room, spawn, containers);
    let furthest = 0;
    for (const c of containers) {
        const d = (_b = distances[c.id]) !== null && _b !== void 0 ? _b : 0;
        if (d < UNREACHABLE_DISTANCE)
            furthest = Math.max(furthest, d);
    }
    return furthest;
}
function minerBudget(room) {
    return room.energyCapacityAvailable;
}
function getMinerPopulationTarget(room) {
    var _a;
    return ((_a = room.memory.minerContainerIds) !== null && _a !== void 0 ? _a : []).length;
}
function getMinerReplacementLead(room) {
    const allowed = minerBudget(room);
    return spawnLeadTicks(buildMinerBody(allowed).length, getMinerTravelTicks(room));
}
function hasEnergyGatherers(room) {
    const harvesters = getCreepsByRoleInRoom(ROLE_HARVESTER, room);
    const miners = getCreepsByRoleInRoom(ROLE_MINER, room);
    return harvesters.length + miners.length > 0;
}
function countHomeHaulers(room) {
    const live = getCreepsByRole(ROLE_HAULER).filter((c) => { var _a; return !c.spawning && ((_a = c.memory.homeRoom) !== null && _a !== void 0 ? _a : c.room.name) === room.name; }).length;
    return live + getRoomSpawningCount(room, ROLE_HAULER);
}
function hasCoreRefiller(room) {
    return (countHomeHaulers(room) > 0 ||
        countByRoleInRoom(ROLE_FILLER, room) > 0 ||
        countByRoleInRoom(ROLE_HARVESTER, room) > 0);
}
const SOURCE_WORK_TO_DRAIN = 5;
function countOpenTilesAround(room, pos) {
    const terrain = room.getTerrain();
    let open = 0;
    for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
            if (dx === 0 && dy === 0)
                continue;
            const x = pos.x + dx;
            const y = pos.y + dy;
            if (x < 0 || x > 49 || y < 0 || y > 49)
                continue;
            if (terrain.get(x, y) !== TERRAIN_MASK_WALL)
                open++;
        }
    }
    return open;
}
function getHarvesterCrewTarget(room, minerCount) {
    const sources = getSources(room);
    const uncovered = Math.max(0, sources.length - minerCount);
    if (uncovered === 0)
        return 0;
    const taken = new Set(getCreepsByRoleInRoom(ROLE_MINER, room).map((c) => c.memory.assignedSourceId));
    const work = buildScaledBody(ROLE_HARVESTER, room.energyCapacityAvailable).filter((p) => p === WORK).length;
    const perSource = Math.ceil(SOURCE_WORK_TO_DRAIN / Math.max(1, work));
    return sources
        .filter((s) => !taken.has(s.id))
        .slice(0, uncovered)
        .reduce((sum, s) => sum + Math.min(perSource, countOpenTilesAround(room, s.pos)), 0);
}
function getHarvesterPopulationTarget(room) {
    const minerCount = getCreepsByRoleInRoom(ROLE_MINER, room).length;
    const phase = getRoomPhase$1(room);
    if (phase === "bootstrap")
        return getHarvesterCrewTarget(room, minerCount);
    if (isEnergyEmergency(room))
        return minerCount > 0 ? Math.min(1, 2 - minerCount) : 2;
    if (room.storage && room.storage.store[RESOURCE_ENERGY] > 10000)
        return 0;
    return getHarvesterCrewTarget(room, minerCount);
}
const CONTROLLER_DOWNGRADE_SAFETY = 5000;
const NO_STORAGE_ENERGY_PER_UPGRADER = 1000;
const NO_STORAGE_MAX_UPGRADERS = 5;
const STORAGE_ENERGY_PER_UPGRADER = 20000;
function getContainerEnergy(room) {
    var _a;
    let total = 0;
    for (const id of (_a = room.memory.containerIds) !== null && _a !== void 0 ? _a : []) {
        const container = Game.getObjectById(id);
        if (container)
            total += container.store[RESOURCE_ENERGY];
    }
    return total;
}
function getUpgraderPopulationTarget(room) {
    var _a, _b;
    const controller = room.controller;
    if ((controller === null || controller === void 0 ? void 0 : controller.my) && controller.ticksToDowngrade < CONTROLLER_DOWNGRADE_SAFETY)
        return 1;
    if (isEnergyEmergency(room))
        return 0;
    const phase = getRoomPhase$1(room);
    const rcl = (_b = (_a = room.controller) === null || _a === void 0 ? void 0 : _a.level) !== null && _b !== void 0 ? _b : 0;
    if (rcl >= 8)
        return 1;
    const storage = room.storage;
    if (!storage) {
        const base = phase === "bootstrap" ? 1 : 2;
        const extra = Math.floor(getContainerEnergy(room) / NO_STORAGE_ENERGY_PER_UPGRADER);
        return Math.min(NO_STORAGE_MAX_UPGRADERS, base + extra);
    }
    const cap = phase === "powerhouse" ? 4 : 3;
    const spare = storage.store[RESOURCE_ENERGY] - upgraderStorageFloor(room);
    if (spare <= 0)
        return 0;
    return Math.min(cap, 1 + Math.floor(spare / STORAGE_ENERGY_PER_UPGRADER));
}
let constructionSiteCacheTick = -1;
const constructionSiteCountByRoom = {};
function getConstructionSiteCount(room) {
    if (constructionSiteCacheTick !== Game.time) {
        constructionSiteCacheTick = Game.time;
        for (const k of Object.keys(constructionSiteCountByRoom))
            delete constructionSiteCountByRoom[k];
    }
    if (constructionSiteCountByRoom[room.name] === undefined) {
        constructionSiteCountByRoom[room.name] = room.find(FIND_CONSTRUCTION_SITES).length;
    }
    return constructionSiteCountByRoom[room.name];
}
function getBuilderPopulationTarget(room) {
    var _a, _b;
    if (isEnergyEmergency(room))
        return 0;
    const siteCount = getConstructionSiteCount(room);
    if (siteCount === 0)
        return 0;
    const phase = getRoomPhase$1(room);
    if (phase === "bootstrap")
        return Math.min(3, siteCount);
    const target = Math.ceil(siteCount / 5);
    const buffer = (_b = (_a = room.storage) === null || _a === void 0 ? void 0 : _a.store[RESOURCE_ENERGY]) !== null && _b !== void 0 ? _b : 0;
    const cap = buffer > 30000 ? 5 : 2;
    return Math.min(cap, Math.max(1, target));
}
function getSpawnForRoom(room) {
    const roomMemory = getRoomMemory(room);
    if (!roomMemory.spawnId)
        return null;
    return Game.getObjectById(roomMemory.spawnId);
}
const HAULER_SPAWN = {
    MAX_HAULERS: 6,
    DISTANCE_CACHE_TTL: 500,
    SOURCE_OUTPUT: 10,
    CARRY_CAPACITY: CARRY_CAPACITY,
};
const containerDistanceCache = {};
function getContainerDistances(room, spawn, containers) {
    const key = `${room.name}:${containers.map((c) => c.id).sort().join(",")}`;
    const cache = containerDistanceCache[key];
    if (cache && Game.time - cache.cachedAt < HAULER_SPAWN.DISTANCE_CACHE_TTL) {
        return cache.distances;
    }
    const distances = {};
    for (const c of containers) {
        const result = PathFinder.search(spawn.pos, { pos: c.pos, range: 1 }, {
            plainCost: 2,
            swampCost: 10,
            maxOps: 2000,
        });
        distances[c.id] = result.incomplete ? 999 : result.path.length;
    }
    for (const k in containerDistanceCache) {
        if (Game.time - containerDistanceCache[k].cachedAt >= HAULER_SPAWN.DISTANCE_CACHE_TTL) {
            delete containerDistanceCache[k];
        }
    }
    containerDistanceCache[key] = { distances, cachedAt: Game.time };
    return distances;
}
const HAULER_CARRY_MARGIN = 1.5;
const MIN_HAULER_CARRY = 4;
function getHaulerPlan(room) {
    var _a, _b, _c;
    const containerIds = (_a = room.memory.containerIds) !== null && _a !== void 0 ? _a : [];
    if (containerIds.length === 0)
        return null;
    const containers = containerIds
        .map((id) => Game.getObjectById(id))
        .filter(Boolean);
    if (containers.length === 0)
        return null;
    const minerContainerIds = new Set((_b = room.memory.minerContainerIds) !== null && _b !== void 0 ? _b : []);
    const minerContainers = containers.filter((c) => minerContainerIds.has(c.id));
    const spawn = getSpawnForRoom(room);
    let requiredCarry = 0;
    if (spawn) {
        const distances = getContainerDistances(room, spawn, minerContainers);
        for (const c of minerContainers) {
            const dist = (_c = distances[c.id]) !== null && _c !== void 0 ? _c : 0;
            const roundTrip = dist * 2;
            requiredCarry +=
                (HAULER_SPAWN.SOURCE_OUTPUT * roundTrip) / HAULER_SPAWN.CARRY_CAPACITY;
        }
    }
    const neededCarry = Math.ceil(requiredCarry * HAULER_CARRY_MARGIN);
    const idealRepeats = Math.min(Math.floor(MAX_BODY_PART_COUNT / 3), Math.floor(bodyBudget(room, "capacity") / 150));
    const carryPerIdealHauler = Math.max(1, idealRepeats * 2);
    const count = Math.min(HAULER_SPAWN.MAX_HAULERS, Math.max(minerContainers.length, Math.ceil(neededCarry / carryPerIdealHauler)));
    const share = count > 0 ? 2 * Math.ceil(neededCarry / count / 2) : 0;
    const carryEach = Math.min(carryPerIdealHauler, Math.max(MIN_HAULER_CARRY, share));
    return { count, carryEach };
}
function shouldSpawnHauler(room) {
    const plan = getHaulerPlan(room);
    if (!plan)
        return false;
    const haulers = getCreepsByRole(ROLE_HAULER).filter((c) => { var _a; return !c.spawning && ((_a = c.memory.homeRoom) !== null && _a !== void 0 ? _a : c.room.name) === room.name; });
    const lead = spawnLeadTicks((plan.carryEach / 2) * 3, getMinerTravelTicks(room));
    const haulerCount = haulers.filter((h) => !isRetiring(h, lead)).length +
        getRoomSpawningCount(room, ROLE_HAULER);
    if (haulerCount < plan.count)
        return true;
    if (haulers.length >= HAULER_SPAWN.MAX_HAULERS)
        return false;
    const totalCurrentCarry = haulers.reduce((sum, h) => sum + h.body.filter((p) => p.type === CARRY).length, 0);
    return totalCurrentCarry < plan.count * plan.carryEach * 0.5;
}
function spawnHauler(room, spawn) {
    const existingHaulers = getCreepsByRole(ROLE_HAULER).filter((c) => { var _a; return ((_a = c.memory.homeRoom) !== null && _a !== void 0 ? _a : c.room.name) === room.name; });
    const plan = getHaulerPlan(room);
    const planEnergy = plan ? (plan.carryEach / 2) * calculateBodyPartCost(BODY_PATTERNS[ROLE_HAULER]) : Infinity;
    const allowedEnergy = Math.min(planEnergy, bodyBudget(room, existingHaulers.length === 0 ? "available" : "capacity"));
    const body = buildScaledBody(ROLE_HAULER, allowedEnergy);
    const bodyCost = calculateBodyPartCost(body);
    if (room.energyAvailable < bodyCost) {
        if (existingHaulers.length > 0 && holdSpawnFor(room, ROLE_HAULER))
            return true;
        const affordableEnergy = Math.min(planEnergy, bodyBudget(room, "available"));
        const affordableBody = buildScaledBody(ROLE_HAULER, affordableEnergy);
        if (room.energyAvailable < calculateBodyPartCost(affordableBody)) {
            return false;
        }
        return trackedSpawn(room, spawn, affordableBody, {
            memory: { role: ROLE_HAULER, homeRoom: room.name },
        }) === OK;
    }
    return trackedSpawn(room, spawn, body, {
        memory: { role: ROLE_HAULER, homeRoom: room.name },
    }) === OK;
}
function getMinerWorkTarget(room) {
    const allowed = minerBudget(room);
    return buildMinerBody(allowed).filter((p) => p === WORK).length;
}
function shouldSpawnMiner(room) {
    const workTarget = getMinerWorkTarget(room);
    const lead = getMinerReplacementLead(room);
    const adequate = getCreepsByRoleInRoom(ROLE_MINER, room).filter((c) => !c.spawning &&
        c.body.filter((p) => p.type === WORK).length >= workTarget &&
        !isRetiring(c, lead)).length + getRoomSpawningCount(room, ROLE_MINER);
    return adequate < getMinerPopulationTarget(room);
}
function shouldSpawnHarvester(room) {
    const count = countByRoleInRoom(ROLE_HARVESTER, room);
    const needed = count < getHarvesterPopulationTarget(room);
    if (waitForFullBody(room, ROLE_HARVESTER, needed && count > 0))
        return false;
    return needed;
}
function shouldSpawnUpgrader(room) {
    const needed = countByRoleInRoom(ROLE_UPGRADER, room) < getUpgraderPopulationTarget(room);
    if (waitForFullBody(room, ROLE_UPGRADER, needed))
        return false;
    return needed;
}
function shouldSpawnBuilder(room) {
    const needed = countByRoleInRoom(ROLE_BUILDER, room) < getBuilderPopulationTarget(room);
    if (waitForFullBody(room, ROLE_BUILDER, needed))
        return false;
    return needed;
}
const repairerTargetCache = {};
function getRepairerPopulationTarget(room) {
    var _a, _b;
    if (isEnergyEmergency(room))
        return 0;
    const cached = repairerTargetCache[room.name];
    if (cached && Game.time - cached.tick < 50)
        return cached.value;
    const kept = keptUp(room);
    const worn = room.find(FIND_STRUCTURES, {
        filter: (s) => {
            if (s.structureType === STRUCTURE_WALL || s.structureType === STRUCTURE_RAMPART)
                return false;
            const st = s;
            return "hits" in st && "hitsMax" in st && st.hits < st.hitsMax * 0.8 && kept(st);
        },
    });
    const critical = worn.filter((s) => s.hits < s.hitsMax * 0.5);
    let value = Math.min(2, Math.ceil(critical.length / 5));
    const rcl = (_b = (_a = room.controller) === null || _a === void 0 ? void 0 : _a.level) !== null && _b !== void 0 ? _b : 0;
    if (rcl >= 2) {
        const hasEnergyBuffer = !room.storage || room.storage.store[RESOURCE_ENERGY] > 20000;
        if (hasEnergyBuffer) {
            if (rcl >= 3 && worn.length > 0)
                value = Math.max(value, 1);
            const barrierTarget = barrierTargetFn(room);
            const wallsNeedRepair = room.find(FIND_STRUCTURES, {
                filter: (s) => (s.structureType === STRUCTURE_RAMPART || s.structureType === STRUCTURE_WALL) &&
                    s.hits < barrierTarget(s),
            }).length > 0;
            if (wallsNeedRepair)
                value = Math.min(2, value + 1);
        }
    }
    const nukeDef = room.memory.nukeDefense;
    if (nukeDef && Object.keys(nukeDef.tiles).length > 0) {
        value = Math.max(value, 3);
    }
    repairerTargetCache[room.name] = { value, tick: Game.time };
    return value;
}
function shouldSpawnRepairer(room) {
    const target = getRepairerPopulationTarget(room);
    const needed = target > 0 && countByRoleInRoom(ROLE_REPAIRER, room) < target;
    if (waitForFullBody(room, ROLE_REPAIRER, needed))
        return false;
    return needed;
}
function getFillerPopulationTarget(room) {
    var _a, _b;
    if (!room.storage)
        return 0;
    return ((_b = (_a = room.controller) === null || _a === void 0 ? void 0 : _a.level) !== null && _b !== void 0 ? _b : 0) >= 7 ? 2 : 1;
}
function shouldSpawnFiller(room) {
    const fillers = getCreepsByRoleInRoom(ROLE_FILLER, room).filter((c) => !c.spawning && !isRetiring(c, spawnLeadTicks(c.body.length, 0))).length;
    return fillers + getRoomSpawningCount(room, ROLE_FILLER) < getFillerPopulationTarget(room);
}
function spawnFiller(room, spawn) {
    const allowedEnergy = bodyBudget(room, countByRoleInRoom(ROLE_FILLER, room) === 0 ? "available" : "capacity");
    const body = buildScaledBody(ROLE_FILLER, allowedEnergy);
    if (room.energyAvailable < calculateBodyPartCost(body))
        return false;
    const res = trackedSpawn(room, spawn, body, {
        memory: { role: ROLE_FILLER, homeRoom: room.name },
    });
    return res === OK;
}
function spawnEmergencyHarvester(room, spawn) {
    if (room.energyAvailable < 200)
        return false;
    const sets = Math.min(3, Math.floor(room.energyAvailable / 200));
    const body = [];
    for (let i = 0; i < sets; i++)
        body.push(WORK, CARRY, MOVE);
    const res = trackedSpawn(room, spawn, body, {
        memory: { role: ROLE_HARVESTER, homeRoom: room.name },
    });
    return res === OK;
}
function shouldSpawnMineralMiner(room) {
    if (!room.memory.mineralContainerId)
        return false;
    const container = Game.getObjectById(room.memory.mineralContainerId);
    if (!container)
        return false;
    const mineralId = room.memory.mineralId;
    if (!mineralId)
        return false;
    const mineral = Game.getObjectById(mineralId);
    if (!mineral)
        return false;
    if (mineral.mineralAmount === 0 && container.store.getUsedCapacity() === 0)
        return false;
    const extractorId = room.memory.extractorId;
    if (!extractorId)
        return false;
    const extractor = Game.getObjectById(extractorId);
    if (!extractor)
        return false;
    return countByRoleInRoom(ROLE_MINERAL_MINER, room) === 0;
}
function spawnRepairer(room, spawn) {
    const allowedEnergy = bodyBudget(room, "available");
    const body = buildScaledBody(ROLE_REPAIRER, allowedEnergy);
    const res = trackedSpawn(room, spawn, body, {
        memory: { role: ROLE_REPAIRER, homeRoom: room.name },
    });
    return res === OK;
}
function buildMineralMinerBody(availableEnergy) {
    const workParts = 5;
    const baseMove = 3;
    const baseCost = workParts * BODYPART_COST[WORK] + baseMove * BODYPART_COST[MOVE];
    const unitCost = 2 * BODYPART_COST[CARRY] + BODYPART_COST[MOVE];
    const units = Math.max(1, Math.min(5, Math.floor((availableEnergy - baseCost) / unitCost)));
    return [
        ...Array(workParts).fill(WORK),
        ...Array(units * 2).fill(CARRY),
        ...Array(baseMove + units).fill(MOVE),
    ];
}
function spawnMineralMiner(room, spawn) {
    const allowedEnergy = bodyBudget(room, "available");
    const body = buildMineralMinerBody(allowedEnergy);
    const res = trackedSpawn(room, spawn, body, {
        memory: { role: ROLE_MINERAL_MINER, homeRoom: room.name },
    });
    return res === OK;
}
function spawnHarvester(room, spawn) {
    const allowedEnergy = bodyBudget(room, "available");
    const body = buildScaledBody(ROLE_HARVESTER, allowedEnergy);
    const res = trackedSpawn(room, spawn, body, {
        memory: { role: ROLE_HARVESTER, homeRoom: room.name },
    });
    return res === OK;
}
function buildRcl8UpgraderBody(availableEnergy) {
    const group = [WORK, WORK, WORK, WORK, WORK, CARRY, MOVE];
    const groupCost = calculateBodyPartCost(group);
    const maxGroups = Math.min(3, Math.floor(availableEnergy / groupCost));
    const groups = Math.max(1, maxGroups);
    const body = [];
    for (let i = 0; i < groups; i++)
        body.push(...group);
    return body;
}
function buildUpgraderBody(availableEnergy) {
    const body = buildScaledBody(ROLE_UPGRADER, availableEnergy);
    let left = availableEnergy - calculateBodyPartCost(body);
    const pair = BODYPART_COST[WORK] + BODYPART_COST[MOVE];
    while (left >= pair && body.length + 2 <= MAX_BODY_PART_COUNT) {
        body.push(WORK, MOVE);
        left -= pair;
    }
    if (left >= BODYPART_COST[WORK] && body.length < MAX_BODY_PART_COUNT)
        body.push(WORK);
    return body;
}
function spawnUpgrader(room, spawn) {
    var _a, _b;
    const rcl = (_b = (_a = room.controller) === null || _a === void 0 ? void 0 : _a.level) !== null && _b !== void 0 ? _b : 0;
    const allowedEnergy = bodyBudget(room, rcl >= 8 ? "capacity" : "available");
    const body = rcl >= 8
        ? buildRcl8UpgraderBody(allowedEnergy)
        : buildUpgraderBody(allowedEnergy);
    if (room.energyAvailable < calculateBodyPartCost(body))
        return false;
    let queue = [];
    if (rcl >= 7) {
        const workParts = body.filter((p) => p === WORK).length;
        queue = buildBoostQueue(room, "upgrader", workParts, 0);
    }
    const res = trackedSpawn(room, spawn, body, {
        memory: { role: ROLE_UPGRADER, homeRoom: room.name, ...boostMemory(queue) },
    });
    return res === OK;
}
function spawnBuilder(room, spawn) {
    const allowedEnergy = bodyBudget(room, "available");
    const body = buildScaledBody(ROLE_BUILDER, allowedEnergy);
    const res = trackedSpawn(room, spawn, body, {
        memory: { role: ROLE_BUILDER, homeRoom: room.name },
    });
    return res === OK;
}
function buildMinerBody(availableEnergy) {
    const workCost = BODYPART_COST[WORK];
    const moveCost = BODYPART_COST[MOVE];
    const carryCost = BODYPART_COST[CARRY];
    const maxWork = 5;
    const workParts = Math.min(maxWork, Math.floor((availableEnergy - moveCost - carryCost) / workCost));
    if (workParts <= 0)
        return [WORK, MOVE];
    const body = [];
    for (let i = 0; i < workParts; i++)
        body.push(WORK);
    body.push(CARRY);
    body.push(MOVE);
    return body;
}
function spawnMiner(room, spawn) {
    const existingMiners = getCreepsByRoleInRoom(ROLE_MINER, room).length;
    const allowedEnergy = existingMiners === 0 ? bodyBudget(room, "available") : minerBudget(room);
    const body = buildMinerBody(allowedEnergy);
    if (room.energyAvailable < calculateBodyPartCost(body)) {
        if (existingMiners > 0 && hasCoreRefiller(room) && holdSpawnFor(room, ROLE_MINER))
            return true;
        const affordable = buildMinerBody(bodyBudget(room, "available"));
        return trackedSpawn(room, spawn, affordable, {
            memory: { role: ROLE_MINER, homeRoom: room.name, ...inheritMinerPost(room) },
        }) === OK;
    }
    return trackedSpawn(room, spawn, body, {
        memory: { role: ROLE_MINER, homeRoom: room.name, ...inheritMinerPost(room) },
    }) === OK;
}
function inheritMinerPost(room) {
    var _a;
    const miners = getCreepsByRoleInRoom(ROLE_MINER, room);
    const workTarget = getMinerWorkTarget(room);
    const lead = getMinerReplacementLead(room);
    const holders = {};
    for (const c of miners) {
        const id = c.memory.assignedContainerId;
        if (id)
            holders[id] = ((_a = holders[id]) !== null && _a !== void 0 ? _a : 0) + 1;
    }
    for (const c of miners) {
        const { assignedSourceId, assignedContainerId } = c.memory;
        if (c.spawning || !assignedSourceId || !assignedContainerId)
            continue;
        if (holders[assignedContainerId] > 1)
            continue;
        const undersized = c.body.filter((p) => p.type === WORK).length < workTarget;
        if (!undersized && !isRetiring(c, lead))
            continue;
        return { assignedSourceId, assignedContainerId };
    }
    return {};
}
function shouldSpawnApothecary(room) {
    var _a, _b, _c, _d;
    if (((_b = (_a = room.controller) === null || _a === void 0 ? void 0 : _a.level) !== null && _b !== void 0 ? _b : 0) < 6)
        return false;
    if (!((_d = (_c = room.memory.labSystem) === null || _c === void 0 ? void 0 : _c.inputLabIds) === null || _d === void 0 ? void 0 : _d.length))
        return false;
    return countByRoleInRoom(ROLE_APOTHECARY, room) < 1;
}
const APOTHECARY_MAX_SETS = 5;
function spawnApothecary(room, spawn) {
    const allowedEnergy = Math.min(APOTHECARY_MAX_SETS * calculateBodyPartCost(BODY_PATTERNS[ROLE_APOTHECARY]), bodyBudget(room, "available"));
    const body = buildScaledBody(ROLE_APOTHECARY, allowedEnergy);
    if (room.energyAvailable < calculateBodyPartCost(body))
        return false;
    const res = trackedSpawn(room, spawn, body, {
        memory: { role: ROLE_APOTHECARY },
    });
    return res === OK;
}

function buildKnightBody(availableEnergy) {
    const groupCost = BODYPART_COST[TOUGH] + BODYPART_COST[ATTACK] + 2 * BODYPART_COST[MOVE];
    const maxGroups = Math.min(Math.floor(MAX_BODY_PART_COUNT / 4), Math.floor(availableEnergy / groupCost));
    const groups = Math.max(1, maxGroups);
    return [
        ...Array(groups).fill(TOUGH),
        ...Array(groups).fill(ATTACK),
        ...Array(groups * 2).fill(MOVE),
    ];
}
function buildWizardBody(availableEnergy) {
    const pairCost = BODYPART_COST[MOVE] + BODYPART_COST[RANGED_ATTACK];
    const maxPairs = Math.min(Math.floor(MAX_BODY_PART_COUNT / 2), Math.floor(availableEnergy / pairCost));
    const pairs = Math.max(1, maxPairs);
    return [
        ...Array(pairs).fill(RANGED_ATTACK),
        ...Array(pairs).fill(MOVE),
    ];
}
function buildClericBody(availableEnergy) {
    const pairCost = BODYPART_COST[HEAL] + BODYPART_COST[MOVE];
    const maxPairs = Math.min(Math.floor(MAX_BODY_PART_COUNT / 2), Math.floor(availableEnergy / pairCost));
    const pairs = Math.max(1, maxPairs);
    return [
        ...Array(pairs).fill(MOVE),
        ...Array(pairs).fill(HEAL),
    ];
}
function buildDrainerBody(availableEnergy) {
    const groupCost = BODYPART_COST[TOUGH] + BODYPART_COST[HEAL] + 2 * BODYPART_COST[MOVE];
    const maxGroups = Math.min(Math.floor(MAX_BODY_PART_COUNT / 4), Math.floor(availableEnergy / groupCost));
    const groups = Math.max(1, maxGroups);
    return [
        ...Array(groups).fill(TOUGH),
        ...Array(groups * 2).fill(MOVE),
        ...Array(groups).fill(HEAL),
    ];
}
function buildSiegerBody(availableEnergy) {
    const groupCost = BODYPART_COST[TOUGH] + 2 * BODYPART_COST[WORK] + 3 * BODYPART_COST[MOVE];
    const maxGroups = Math.min(Math.floor(MAX_BODY_PART_COUNT / 6), Math.floor(availableEnergy / groupCost));
    const groups = Math.max(1, maxGroups);
    return [
        ...Array(groups).fill(TOUGH),
        ...Array(groups * 2).fill(WORK),
        ...Array(groups * 3).fill(MOVE),
    ];
}
function countDefendersInRoom(role, room) {
    const present = getCreepsByRoleInRoom(role, room).filter((c) => !c.spawning && !c.memory.offensiveTarget).length;
    return present + getRoomSpawningCount(room, role);
}
function isBreached(room) {
    const core = room.find(FIND_MY_STRUCTURES, {
        filter: (s) => s.structureType === STRUCTURE_SPAWN || s.structureType === STRUCTURE_TOWER,
    });
    const armed = core.some((s) => s.structureType === STRUCTURE_TOWER && s.store[RESOURCE_ENERGY] >= TOWER_ENERGY_COST);
    return !armed || core.some((s) => s.hits < s.hitsMax);
}
function homeNeedsDefenders(room) {
    return !towersCanHold(room, getThreatInfo(room).hostiles);
}
function homeKnightsNeeded(room, cap) {
    const body = buildKnightBody(bodyBudget(room, "capacity"));
    return meleeDefendersToWin(summarizeHostiles(getThreatInfo(room).hostiles), body, cap);
}
function waitForDefenderBody(room, key, needed) {
    return waitForFullBody(room, key, needed && !isBreached(room));
}
const HOME_KNIGHT_CAP = 3;
function shouldSpawnKnight(room, threatScore) {
    const target = Math.max(Math.ceil(threatScore / 40), homeKnightsNeeded(room, HOME_KNIGHT_CAP));
    const needed = homeNeedsDefenders(room) &&
        countDefendersInRoom(ROLE_KNIGHT, room) < Math.min(HOME_KNIGHT_CAP, target);
    if (waitForDefenderBody(room, ROLE_KNIGHT, needed))
        return false;
    return needed;
}
function spawnKnight(room, spawn) {
    const allowedEnergy = bodyBudget(room, "available");
    const body = buildKnightBody(allowedEnergy);
    if (room.energyAvailable < calculateBodyPartCost(body))
        return false;
    const attackParts = body.filter((p) => p === ATTACK).length;
    const toughParts = body.filter((p) => p === TOUGH).length;
    const moveParts = body.filter((p) => p === MOVE).length;
    const queue = buildBoostQueue(room, 'melee', attackParts, toughParts, moveParts);
    const res = trackedSpawn(room, spawn, body, {
        memory: { role: ROLE_KNIGHT, ...boostMemory(queue) },
    });
    return res === OK;
}
function shouldSpawnWizard(room, threatScore) {
    const needed = homeNeedsDefenders(room) &&
        countDefendersInRoom(ROLE_WIZARD, room) < Math.min(2, Math.ceil(threatScore / 60));
    if (waitForDefenderBody(room, ROLE_WIZARD, needed))
        return false;
    return needed;
}
function spawnWizard(room, spawn) {
    const allowedEnergy = bodyBudget(room, "available");
    const body = buildWizardBody(allowedEnergy);
    if (room.energyAvailable < calculateBodyPartCost(body))
        return false;
    const rangedParts = body.filter((p) => p === RANGED_ATTACK).length;
    const queue = buildBoostQueue(room, 'ranged', rangedParts, 0);
    const res = trackedSpawn(room, spawn, body, {
        memory: { role: ROLE_WIZARD, ...boostMemory(queue) },
    });
    return res === OK;
}
function shouldSpawnCleric(room, threatScore) {
    if (threatScore < 100)
        return false;
    const fighters = countDefendersInRoom(ROLE_KNIGHT, room) + countDefendersInRoom(ROLE_WIZARD, room);
    if (fighters === 0)
        return false;
    const needed = homeNeedsDefenders(room) && countDefendersInRoom(ROLE_CLERIC, room) < 1;
    if (waitForDefenderBody(room, ROLE_CLERIC, needed))
        return false;
    return needed;
}
function spawnCleric(room, spawn) {
    const allowedEnergy = bodyBudget(room, "available");
    const body = buildClericBody(allowedEnergy);
    if (room.energyAvailable < calculateBodyPartCost(body))
        return false;
    const healParts = body.filter((p) => p === HEAL).length;
    const queue = buildBoostQueue(room, 'healer', healParts, 0);
    const res = trackedSpawn(room, spawn, body, {
        memory: { role: ROLE_CLERIC, ...boostMemory(queue) },
    });
    return res === OK;
}
function shouldSpawnConqueror() {
    const exp = Memory.expansion;
    if (!exp || exp.phase !== "claiming")
        return false;
    return !getCreepsByRole(ROLE_CONQUEROR).some((c) => c.memory.targetRoom === exp.roomName);
}
function spawnConqueror(room, spawn) {
    const exp = Memory.expansion;
    if (!exp)
        return false;
    const body = [CLAIM, MOVE, MOVE, MOVE, MOVE];
    if (room.energyAvailable < calculateBodyPartCost(body))
        return false;
    const res = trackedSpawn(room, spawn, body, {
        memory: {
            role: ROLE_CONQUEROR,
            homeRoom: room.name,
            targetRoom: exp.roomName,
        },
    });
    if (res !== OK)
        return false;
    chronicle(`A conqueror rides out from ${castleName(room.name)} for the ${wildsName(exp.roomName)}.`);
    return true;
}
const UNCLAIMER_LEAD = 400;
function findUnclaimTarget(room) {
    var _a;
    const targets = Memory.unclaimTargets;
    if (!targets)
        return null;
    for (const name in targets) {
        const t = targets[name];
        if (t.until <= Game.time) {
            delete targets[name];
            continue;
        }
        if (t.homeRoom !== room.name)
            continue;
        if (((_a = t.blockedUntil) !== null && _a !== void 0 ? _a : 0) - UNCLAIMER_LEAD > Game.time)
            continue;
        if (getCreepsByRole(ROLE_UNCLAIMER).some((c) => c.memory.targetRoom === name))
            continue;
        return name;
    }
    return null;
}
function buildUnclaimerBody(capacity) {
    const pairCost = BODYPART_COST[CLAIM] + BODYPART_COST[MOVE];
    const pairs = Math.max(1, Math.min(Math.floor(MAX_BODY_PART_COUNT / 2), Math.floor(capacity / pairCost)));
    return [...Array(pairs).fill(CLAIM), ...Array(pairs).fill(MOVE)];
}
function spawnUnclaimer(room, spawn) {
    const target = findUnclaimTarget(room);
    if (!target)
        return false;
    const body = buildUnclaimerBody(room.energyCapacityAvailable);
    if (room.energyAvailable < calculateBodyPartCost(body))
        return false;
    const res = trackedSpawn(room, spawn, body, {
        memory: { role: ROLE_UNCLAIMER, homeRoom: room.name, targetRoom: target },
    });
    return res === OK;
}
const MAX_SETTLERS = 3;
const PILGRIM_WINDOW = 2000;
function shouldSpawnSettler(room) {
    const exp = Memory.expansion;
    if (!exp || exp.phase !== "bootstrapping" || exp.homeRoom !== room.name)
        return false;
    if (exp.pausedUntil && exp.pausedUntil > Game.time)
        return false;
    const settlers = getCreepsByRole(ROLE_SETTLER).filter((c) => c.memory.targetRoom === exp.roomName);
    const needed = settlers.length < MAX_SETTLERS;
    if (waitForFullBody(room, ROLE_SETTLER, needed))
        return false;
    return needed;
}
function spawnSettler(room, spawn) {
    const exp = Memory.expansion;
    if (!exp)
        return false;
    const allowedEnergy = bodyBudget(room, "available");
    const body = buildScaledBody(ROLE_SETTLER, allowedEnergy);
    const res = trackedSpawn(room, spawn, body, {
        memory: {
            role: ROLE_SETTLER,
            homeRoom: room.name,
            targetRoom: exp.roomName,
        },
    });
    if (res !== OK)
        return false;
    const keep = castleName(exp.roomName);
    tally(`pilgrims:${exp.roomName}`, 1, (n) => `${n === 1 ? "A pilgrim has" : `${n} pilgrims have`} set out from ${castleName(room.name)} to raise the keep of ${keep}.`, PILGRIM_WINDOW);
    return true;
}
function getOffensiveSquadMembers(op) {
    return Object.values(Game.creeps).filter((c) => c.memory.offensiveTarget === op.targetRoom && c.memory.homeRoom === op.homeRoom);
}
function getOffensiveOpForRoom(room) {
    var _a;
    return (_a = Memory.militaryOps) === null || _a === void 0 ? void 0 : _a[room.name];
}
function shouldSpawnOffensiveCreep(room) {
    var _a, _b;
    const op = getOffensiveOpForRoom(room);
    if (!op || op.phase !== "forming")
        return false;
    const members = getOffensiveSquadMembers(op);
    return (members.filter((c) => c.memory.role === ROLE_KNIGHT).length < op.requiredMelee ||
        members.filter((c) => c.memory.role === ROLE_WIZARD).length < op.requiredRanged ||
        members.filter((c) => c.memory.role === ROLE_CLERIC).length < op.requiredHealers ||
        members.filter((c) => c.memory.role === ROLE_SIEGER).length < ((_a = op.requiredSiege) !== null && _a !== void 0 ? _a : 0) ||
        members.filter((c) => c.memory.role === ROLE_DRAINER).length < ((_b = op.requiredDrainers) !== null && _b !== void 0 ? _b : 0));
}
function countDrainLeeches(targetRoom, homeRoom) {
    return Object.values(Game.creeps).filter((c) => c.memory.role === ROLE_DRAINER &&
        c.memory.offensiveTarget === targetRoom &&
        c.memory.homeRoom === homeRoom).length;
}
function firstUnderStrengthDrain(room) {
    for (const op of getDrainOpsForHome(room.name)) {
        if (countDrainLeeches(op.targetRoom, op.homeRoom) < op.drainers)
            return op;
    }
    return null;
}
function shouldSpawnDrainLeech(room) {
    return firstUnderStrengthDrain(room) !== null;
}
function spawnDrainLeech(room, spawn) {
    const op = firstUnderStrengthDrain(room);
    if (!op)
        return false;
    const body = buildDrainerBody(room.energyCapacityAvailable);
    if (room.energyAvailable < calculateBodyPartCost(body))
        return false;
    const healParts = body.filter((p) => p === HEAL).length;
    const toughParts = body.filter((p) => p === TOUGH).length;
    const queue = buildBoostQueue(room, "drainer", healParts, toughParts);
    const res = trackedSpawn(room, spawn, body, {
        memory: {
            role: ROLE_DRAINER,
            homeRoom: room.name,
            offensiveTarget: op.targetRoom,
            ...boostMemory(queue),
        },
    });
    if (res === OK)
        console.log(`[Drain] Spawning ${ROLE_DRAINER}: ${room.name} -> ${op.targetRoom}`);
    return res === OK;
}
function spawnNextOffensiveCreep(room, spawn) {
    var _a, _b;
    const op = getOffensiveOpForRoom(room);
    if (!op)
        return false;
    const members = getOffensiveSquadMembers(op);
    const melee = members.filter((c) => c.memory.role === ROLE_KNIGHT).length;
    const ranged = members.filter((c) => c.memory.role === ROLE_WIZARD).length;
    const healers = members.filter((c) => c.memory.role === ROLE_CLERIC).length;
    const siege = members.filter((c) => c.memory.role === ROLE_SIEGER).length;
    const drainers = members.filter((c) => c.memory.role === ROLE_DRAINER).length;
    let roleToSpawn = null;
    if (melee < op.requiredMelee)
        roleToSpawn = ROLE_KNIGHT;
    else if (drainers < ((_a = op.requiredDrainers) !== null && _a !== void 0 ? _a : 0))
        roleToSpawn = ROLE_DRAINER;
    else if (siege < ((_b = op.requiredSiege) !== null && _b !== void 0 ? _b : 0))
        roleToSpawn = ROLE_SIEGER;
    else if (ranged < op.requiredRanged)
        roleToSpawn = ROLE_WIZARD;
    else if (healers < op.requiredHealers)
        roleToSpawn = ROLE_CLERIC;
    if (!roleToSpawn)
        return false;
    const energy = room.energyCapacityAvailable;
    let body;
    let boostKey;
    let combatPartType;
    if (roleToSpawn === ROLE_KNIGHT) {
        body = buildKnightBody(energy);
        boostKey = "melee";
        combatPartType = ATTACK;
    }
    else if (roleToSpawn === ROLE_SIEGER) {
        body = buildSiegerBody(energy);
        boostKey = "siege";
        combatPartType = WORK;
    }
    else if (roleToSpawn === ROLE_WIZARD) {
        body = buildWizardBody(energy);
        boostKey = "ranged";
        combatPartType = RANGED_ATTACK;
    }
    else if (roleToSpawn === ROLE_DRAINER) {
        body = buildDrainerBody(energy);
        boostKey = "drainer";
        combatPartType = HEAL;
    }
    else {
        body = buildClericBody(energy);
        boostKey = "healer";
        combatPartType = HEAL;
    }
    if (room.energyAvailable < calculateBodyPartCost(body))
        return false;
    const combatParts = body.filter((p) => p === combatPartType).length;
    const toughParts = body.filter((p) => p === TOUGH).length;
    const moveParts = boostKey === "melee" || boostKey === "siege"
        ? body.filter((p) => p === MOVE).length
        : 0;
    const queue = buildBoostQueue(room, boostKey, combatParts, toughParts, moveParts);
    const res = trackedSpawn(room, spawn, body, {
        memory: {
            role: roleToSpawn,
            homeRoom: room.name,
            offensiveTarget: op.targetRoom,
            ...boostMemory(queue),
        },
    });
    if (res === OK) {
        console.log(`[Military] Spawning offensive ${roleToSpawn} for ${op.targetRoom}`);
    }
    return res === OK;
}
function countDefendersByRole(targetRoom, role, homeRoom) {
    const live = getDefenders(targetRoom).filter((c) => !c.spawning && c.memory.role === role).length;
    const adHoc = targetRoom === homeRoom.name
        ? getCreepsByRoleInRoom(role, homeRoom).filter((c) => !c.spawning &&
            !c.memory.defensiveTarget &&
            !c.memory.offensiveTarget &&
            !c.memory.targetRoom).length
        : 0;
    return live + adHoc + getRoomSpawningCount(homeRoom, role);
}
function needsChildRoomDefender(room) {
    const exp = Memory.expansion;
    if (!(exp === null || exp === void 0 ? void 0 : exp.needsDefender) || exp.homeRoom !== room.name)
        return false;
    const existing = getCreepsByRole(ROLE_KNIGHT).filter((c) => c.memory.targetRoom === exp.roomName && c.memory.homeRoom === room.name);
    return existing.length === 0;
}
const DEFENSE_OP_KNIGHT_CAP = 6;
function requiredOpMelee(room, op) {
    return Math.max(op.requiredMelee, homeKnightsNeeded(room, DEFENSE_OP_KNIGHT_CAP));
}
const DEFENSE_OP_BODY_WAIT = "defenseOp";
function shouldSpawnDefender(room) {
    if (needsChildRoomDefender(room))
        return true;
    const op = getDefenseOp(room.name);
    if (!op)
        return false;
    const short = countDefendersByRole(room.name, ROLE_KNIGHT, room) < requiredOpMelee(room, op) ||
        countDefendersByRole(room.name, ROLE_WIZARD, room) < op.requiredRanged ||
        countDefendersByRole(room.name, ROLE_CLERIC, room) < op.requiredHealers;
    if (waitForDefenderBody(room, DEFENSE_OP_BODY_WAIT, short))
        return false;
    return short;
}
function spawnNextDefender(room, spawn) {
    if (needsChildRoomDefender(room)) {
        return spawnChildRoomDefender(room, spawn);
    }
    const op = getDefenseOp(room.name);
    if (!op)
        return false;
    let roleToSpawn = null;
    let combatPartType = ATTACK;
    let boostKey = "melee";
    let body;
    const allowedEnergy = bodyBudget(room, "available");
    if (countDefendersByRole(room.name, ROLE_KNIGHT, room) < requiredOpMelee(room, op)) {
        roleToSpawn = ROLE_KNIGHT;
        combatPartType = ATTACK;
        boostKey = "melee";
        body = buildKnightBody(allowedEnergy);
    }
    else if (countDefendersByRole(room.name, ROLE_WIZARD, room) < op.requiredRanged) {
        roleToSpawn = ROLE_WIZARD;
        combatPartType = RANGED_ATTACK;
        boostKey = "ranged";
        body = buildWizardBody(allowedEnergy);
    }
    else if (countDefendersByRole(room.name, ROLE_CLERIC, room) < op.requiredHealers) {
        roleToSpawn = ROLE_CLERIC;
        combatPartType = HEAL;
        boostKey = "healer";
        body = buildClericBody(allowedEnergy);
    }
    else {
        return false;
    }
    if (room.energyAvailable < calculateBodyPartCost(body))
        return false;
    const combatParts = body.filter((p) => p === combatPartType).length;
    const toughParts = body.filter((p) => p === TOUGH).length;
    const moveParts = boostKey === "melee" ? body.filter((p) => p === MOVE).length : 0;
    const queue = buildBoostQueue(room, boostKey, combatParts, toughParts, moveParts);
    const res = trackedSpawn(room, spawn, body, {
        memory: {
            role: roleToSpawn,
            homeRoom: room.name,
            defensiveTarget: room.name,
            ...boostMemory(queue),
        },
    });
    if (res === OK) {
        console.log(`[Defense] Spawning defensive ${roleToSpawn} for ${room.name}`);
    }
    return res === OK;
}
function spawnChildRoomDefender(room, spawn) {
    const exp = Memory.expansion;
    if (!exp)
        return false;
    const allowedEnergy = bodyBudget(room, "available");
    const body = buildKnightBody(allowedEnergy);
    if (room.energyAvailable < calculateBodyPartCost(body))
        return false;
    const attackParts = body.filter((p) => p === ATTACK).length;
    const toughParts = body.filter((p) => p === TOUGH).length;
    const moveParts = body.filter((p) => p === MOVE).length;
    const queue = buildBoostQueue(room, "melee", attackParts, toughParts, moveParts);
    const res = trackedSpawn(room, spawn, body, {
        memory: {
            role: ROLE_KNIGHT,
            homeRoom: room.name,
            targetRoom: exp.roomName,
            ...boostMemory(queue),
        },
    });
    if (res === OK) {
        console.log(`[Defense] Spawning child-room defender for ${exp.roomName}`);
    }
    return res === OK;
}
const REMOTE_KNIGHT_CAP = 2;
function remoteKnightsNeeded(room, remote) {
    if (!remote.invaderStrength)
        return 1;
    const body = buildKnightBody(bodyBudget(room, "capacity"));
    return meleeDefendersToWin(remote.invaderStrength, body, REMOTE_KNIGHT_CAP);
}
function findRemoteInvaderTarget(room) {
    const remotes = room.memory.remoteRooms;
    if (!remotes)
        return null;
    const worked = getPickedRemoteRoomNames(room);
    for (const r of remotes) {
        if (r.invaderUntil === undefined || r.invaderUntil <= Game.time)
            continue;
        if (!worked.has(r.roomName))
            continue;
        const defending = getCreepsByRole(ROLE_KNIGHT).filter((c) => c.memory.homeRoom === room.name && c.memory.targetRoom === r.roomName).length;
        if (defending < remoteKnightsNeeded(room, r))
            return r.roomName;
    }
    return null;
}
const REMOTE_DEFENDER_BODY_WAIT = "remoteDefender";
function shouldSpawnRemoteDefender(room) {
    const needed = findRemoteInvaderTarget(room) !== null;
    if (waitForFullBody(room, REMOTE_DEFENDER_BODY_WAIT, needed))
        return false;
    return needed;
}
function spawnRemoteDefender(room, spawn) {
    const target = findRemoteInvaderTarget(room);
    if (!target)
        return false;
    const allowedEnergy = bodyBudget(room, "available");
    const body = buildKnightBody(allowedEnergy);
    if (room.energyAvailable < calculateBodyPartCost(body))
        return false;
    const attackParts = body.filter((p) => p === ATTACK).length;
    const toughParts = body.filter((p) => p === TOUGH).length;
    const moveParts = body.filter((p) => p === MOVE).length;
    const queue = buildBoostQueue(room, "melee", attackParts, toughParts, moveParts);
    const res = trackedSpawn(room, spawn, body, {
        memory: {
            role: ROLE_KNIGHT,
            homeRoom: room.name,
            targetRoom: target,
            ...boostMemory(queue),
        },
    });
    if (res === OK)
        console.log(`[Defense] Spawning remote defender for ${target}`);
    return res === OK;
}

function getPowerSquadForRoom(room) {
    var _a;
    if (room.energyCapacityAvailable < calculateBodyPartCost(buildPowerHealerBody()))
        return undefined;
    return (_a = Memory.powerOps) === null || _a === void 0 ? void 0 : _a.find((o) => o.homeRoom === room.name && (o.phase === "forming" || o.phase === "cracking"));
}
function getPowerSquadMembersById(opId) {
    const result = [];
    for (const name in Game.creeps) {
        const c = Game.creeps[name];
        if (c.memory.powerOpId === opId)
            result.push(c);
    }
    return result;
}
function shouldSpawnPowerCreep(room) {
    const op = getPowerSquadForRoom(room);
    if (!op)
        return false;
    const members = getPowerSquadMembersById(op.id);
    return (members.filter((c) => c.memory.role === ROLE_POWER_ATTACKER).length < op.requiredAttackers ||
        members.filter((c) => c.memory.role === ROLE_POWER_HEALER).length < op.requiredHealers ||
        members.filter((c) => c.memory.role === ROLE_POWER_CARRIER).length < op.requiredCarriers);
}
function spawnNextPowerCreep(room, spawn) {
    const op = getPowerSquadForRoom(room);
    if (!op)
        return false;
    const members = getPowerSquadMembersById(op.id);
    const attackers = members.filter((c) => c.memory.role === ROLE_POWER_ATTACKER).length;
    const healers = members.filter((c) => c.memory.role === ROLE_POWER_HEALER).length;
    const carriers = members.filter((c) => c.memory.role === ROLE_POWER_CARRIER).length;
    let roleToSpawn = null;
    if (attackers < op.requiredAttackers)
        roleToSpawn = ROLE_POWER_ATTACKER;
    else if (healers < op.requiredHealers)
        roleToSpawn = ROLE_POWER_HEALER;
    else if (carriers < op.requiredCarriers)
        roleToSpawn = ROLE_POWER_CARRIER;
    if (!roleToSpawn)
        return false;
    let body;
    if (roleToSpawn === ROLE_POWER_ATTACKER) {
        body = buildPowerAttackerBody();
    }
    else if (roleToSpawn === ROLE_POWER_HEALER) {
        body = buildPowerHealerBody();
    }
    else {
        body = buildPowerCarrierBody();
    }
    if (room.energyAvailable < calculateBodyPartCost(body))
        return false;
    const res = trackedSpawn(room, spawn, body, {
        memory: {
            role: roleToSpawn,
            homeRoom: room.name,
            powerOpId: op.id,
        },
    });
    if (res === OK) {
        console.log(`[Power] Spawning ${roleToSpawn} for op #${op.id} -> ${op.roomName}`);
    }
    return res === OK;
}
function buildPowerAttackerBody() {
    return [
        ...Array(25).fill(ATTACK),
        ...Array(25).fill(MOVE),
    ];
}
function buildPowerHealerBody() {
    return [
        ...Array(25).fill(MOVE),
        ...Array(25).fill(HEAL),
    ];
}
function buildPowerCarrierBody() {
    return [
        ...Array(25).fill(CARRY),
        ...Array(25).fill(MOVE),
    ];
}
function getDepositOpForRoom(room) {
    var _a;
    return (_a = Memory.depositOps) === null || _a === void 0 ? void 0 : _a.find((o) => o.homeRoom === room.name && o.phase === "mining");
}
function getDepositMembersById(opId) {
    const result = [];
    for (const name in Game.creeps) {
        const c = Game.creeps[name];
        if (c.memory.depositOpId === opId)
            result.push(c);
    }
    return result;
}
function shouldSpawnDepositCreep(room) {
    const op = getDepositOpForRoom(room);
    if (!op)
        return false;
    const members = getDepositMembersById(op.id);
    return (members.filter((c) => c.memory.role === ROLE_DEPOSIT_MINER).length < op.requiredMiners ||
        members.filter((c) => c.memory.role === ROLE_DEPOSIT_HAULER).length < op.requiredHaulers);
}
function spawnNextDepositCreep(room, spawn) {
    const op = getDepositOpForRoom(room);
    if (!op)
        return false;
    const members = getDepositMembersById(op.id);
    const miners = members.filter((c) => c.memory.role === ROLE_DEPOSIT_MINER).length;
    const haulers = members.filter((c) => c.memory.role === ROLE_DEPOSIT_HAULER).length;
    let roleToSpawn;
    let body;
    const energy = room.energyCapacityAvailable;
    if (miners < op.requiredMiners) {
        roleToSpawn = ROLE_DEPOSIT_MINER;
        body = buildDepositMinerBody(energy);
    }
    else if (haulers < op.requiredHaulers) {
        roleToSpawn = ROLE_DEPOSIT_HAULER;
        body = buildRemoteHaulerBody(bodyBudget(room, "capacity"));
    }
    else {
        return false;
    }
    if (room.energyAvailable < calculateBodyPartCost(body))
        return false;
    const res = trackedSpawn(room, spawn, body, {
        memory: { role: roleToSpawn, homeRoom: room.name, depositOpId: op.id },
    });
    if (res === OK) {
        console.log(`[Deposit] Spawning ${roleToSpawn} for op #${op.id} -> ${op.roomName}`);
    }
    return res === OK;
}
function buildDepositMinerBody(availableEnergy) {
    const group = [WORK, WORK, CARRY, MOVE, MOVE];
    const groupCost = calculateBodyPartCost(group);
    const maxGroups = Math.min(Math.floor(MAX_BODY_PART_COUNT / group.length), Math.floor(availableEnergy / groupCost));
    const groups = Math.max(1, maxGroups);
    const body = [];
    for (let i = 0; i < groups; i++)
        body.push(...group);
    return body;
}
function spawnSkCreeps(room, spawn) {
    var _a;
    const ops = ((_a = Memory.skOps) !== null && _a !== void 0 ? _a : []).filter((o) => o.homeRoom === room.name && !isOpPaused(o));
    for (const op of ops) {
        const members = getSkMembers(op.id);
        const guardians = members.filter((c) => c.memory.role === ROLE_SK_GUARDIAN).length;
        if (guardians < 1)
            return spawnSkGuardian(room, spawn, op);
        if (!op.discovered || op.sourceIds.length === 0)
            continue;
        const need = op.sourceIds.length;
        const miners = members.filter((c) => c.memory.role === ROLE_SK_MINER);
        const taken = new Set(miners.map((m) => m.memory.skSourceId));
        const freeSource = op.sourceIds.find((id) => !taken.has(id));
        if (miners.length < need && freeSource)
            return spawnSkMiner(room, spawn, op, freeSource);
        const haulers = members.filter((c) => c.memory.role === ROLE_SK_HAULER).length;
        if (haulers < need)
            return spawnSkHauler(room, spawn, op);
    }
    return false;
}
function buildSkGuardianBody(availableEnergy) {
    const groupCost = BODYPART_COST[RANGED_ATTACK] + BODYPART_COST[HEAL] + 2 * BODYPART_COST[MOVE];
    const maxGroups = Math.min(Math.floor(MAX_BODY_PART_COUNT / 4), Math.floor(availableEnergy / groupCost));
    const groups = Math.max(5, maxGroups);
    return [
        ...Array(groups).fill(RANGED_ATTACK),
        ...Array(groups * 2).fill(MOVE),
        ...Array(groups).fill(HEAL),
    ];
}
function spawnSkGuardian(room, spawn, op) {
    const body = buildSkGuardianBody(room.energyCapacityAvailable);
    if (room.energyAvailable < calculateBodyPartCost(body))
        return false;
    const healParts = body.filter((p) => p === HEAL).length;
    const queue = buildBoostQueue(room, "healer", healParts, 0);
    const res = trackedSpawn(room, spawn, body, {
        memory: { role: ROLE_SK_GUARDIAN, homeRoom: room.name, skOpId: op.id, ...boostMemory(queue) },
    });
    if (res === OK)
        console.log(`[SK] Spawning guardian for ${op.roomName}`);
    return res === OK;
}
function buildSkMinerBody(availableEnergy) {
    const maxWork = 7;
    const workCost = BODYPART_COST[WORK];
    const moveCost = BODYPART_COST[MOVE];
    let work = Math.min(maxWork, Math.floor(availableEnergy / (workCost + moveCost / 2)));
    work = Math.max(3, work);
    const move = Math.max(2, Math.ceil(work / 2));
    return [...Array(work).fill(WORK), ...Array(move).fill(MOVE)];
}
function spawnSkMiner(room, spawn, op, sourceId) {
    const body = buildSkMinerBody(room.energyCapacityAvailable);
    if (room.energyAvailable < calculateBodyPartCost(body))
        return false;
    const res = trackedSpawn(room, spawn, body, {
        memory: { role: ROLE_SK_MINER, homeRoom: room.name, skOpId: op.id, skSourceId: sourceId },
    });
    if (res === OK)
        console.log(`[SK] Spawning ${ROLE_SK_MINER} for ${op.roomName}`);
    return res === OK;
}
function spawnSkHauler(room, spawn, op) {
    const allowedEnergy = bodyBudget(room, "capacity");
    const body = buildRemoteHaulerBody(allowedEnergy);
    if (room.energyAvailable < calculateBodyPartCost(body))
        return false;
    const res = trackedSpawn(room, spawn, body, {
        memory: { role: ROLE_SK_HAULER, homeRoom: room.name, skOpId: op.id },
    });
    if (res === OK)
        console.log(`[SK] Spawning packer for ${op.roomName}`);
    return res === OK;
}

const STRAY_HAULER_INTERVAL = 10;
function loop$7() {
    var _a;
    for (const roomName in Game.rooms) {
        const room = Game.rooms[roomName];
        if (!((_a = room.controller) === null || _a === void 0 ? void 0 : _a.my))
            continue;
        refreshBlockade(room);
        if (Game.time % STRAY_HAULER_INTERVAL === 0)
            reassignStrayHaulers(room);
        const spawns = room.find(FIND_MY_SPAWNS);
        for (const spawn of spawns) {
            if (!spawn.spawning)
                processRoomSpawning(room, spawn);
        }
    }
}
function hasArmedHostiles(room) {
    return getThreatInfo(room).hostiles.some((c) => c.body.some((p) => p.hits > 0 && (p.type === ATTACK || p.type === RANGED_ATTACK || p.type === WORK)));
}
const ECONOMY_CRITICAL_STORAGE = 25000;
function isEconomyCritical(room) {
    if (!room.storage)
        return isEnergyEmergency(room);
    return room.storage.store[RESOURCE_ENERGY] < ECONOMY_CRITICAL_STORAGE;
}
function processRoomSpawning(room, spawn) {
    var _a, _b;
    if (!hasEnergyGatherers(room)) {
        if (shouldSpawnDefender(room) && spawnNextDefender(room, spawn))
            return;
        spawnEmergencyHarvester(room, spawn);
        return;
    }
    const { score: threatScore } = getThreatInfo(room);
    const threatSeverity = getThreatSeverity(room);
    const phase = getRoomPhase$1(room);
    const blockaded = isBlockaded(room);
    if (shouldSpawnHarvester(room) && spawnHarvester(room, spawn))
        return;
    if (shouldSpawnDefender(room) && spawnNextDefender(room, spawn))
        return;
    const hasEconomyFloor = countByRoleInRoom(ROLE_MINER, room) >= 1 && countByRoleInRoom(ROLE_HAULER, room) >= 1;
    if (threatSeverity === "high" && phase !== "bootstrap" && hasEconomyFloor) {
        if (shouldSpawnKnight(room, threatScore) && spawnKnight(room, spawn))
            return;
        if (shouldSpawnWizard(room, threatScore) && spawnWizard(room, spawn))
            return;
        if (shouldSpawnCleric(room, threatScore) && spawnCleric(room, spawn))
            return;
    }
    if (shouldSpawnFiller(room) && spawnFiller(room, spawn))
        return;
    const needsFirstHauler = countHomeHaulers(room) === 0 && countByRoleInRoom(ROLE_MINER, room) >= 1;
    if (needsFirstHauler && shouldSpawnHauler(room) && spawnHauler(room, spawn))
        return;
    if (shouldSpawnMiner(room) && spawnMiner(room, spawn))
        return;
    if (shouldSpawnHauler(room) && spawnHauler(room, spawn))
        return;
    if (((_a = room.controller) === null || _a === void 0 ? void 0 : _a.my) &&
        room.controller.ticksToDowngrade < CONTROLLER_DOWNGRADE_SAFETY &&
        shouldSpawnUpgrader(room) &&
        spawnUpgrader(room, spawn))
        return;
    if (isEnergyEmergency(room)) {
        if (!blockaded) {
            if (shouldSpawnRemoteDefender(room) && spawnRemoteDefender(room, spawn))
                return;
            if (shouldSpawnRemoteMiner(room) && spawnRemoteMiner(room, spawn))
                return;
            if (shouldSpawnRemoteHauler(room) && spawnRemoteHauler(room, spawn))
                return;
            if (shouldSpawnReserver(room) && spawnReserver(room, spawn))
                return;
        }
        return;
    }
    if (hasArmedHostiles(room)) {
        if (shouldSpawnKnight(room, threatScore) && spawnKnight(room, spawn))
            return;
        if (shouldSpawnWizard(room, threatScore) && spawnWizard(room, spawn))
            return;
        if (shouldSpawnCleric(room, threatScore) && spawnCleric(room, spawn))
            return;
    }
    if (!blockaded && shouldSpawnRemoteMiner(room) && spawnRemoteMiner(room, spawn))
        return;
    if (shouldSpawnRepairer(room) && spawnRepairer(room, spawn))
        return;
    if (shouldSpawnBuilder(room) && spawnBuilder(room, spawn))
        return;
    if (shouldSpawnUpgrader(room) && spawnUpgrader(room, spawn))
        return;
    if (!blockaded && spawnTownsfolk(room, spawn))
        return;
    if (!blockaded && shouldSpawnScoreHunter(room) && spawnScoreHunter(room, spawn))
        return;
    const economyCritical = isEconomyCritical(room);
    if (!blockaded && !economyCritical && ((_b = Memory.expansion) === null || _b === void 0 ? void 0 : _b.homeRoom) === room.name) {
        if (shouldSpawnConqueror() && spawnConqueror(room, spawn))
            return;
        if (shouldSpawnSettler(room) && spawnSettler(room, spawn))
            return;
    }
    if (!blockaded && !economyCritical && shouldSpawnOffensiveCreep(room) && spawnNextOffensiveCreep(room, spawn))
        return;
    if (!blockaded && !economyCritical && shouldSpawnDrainLeech(room) && spawnDrainLeech(room, spawn))
        return;
    if (!blockaded && !economyCritical && spawnUnclaimer(room, spawn))
        return;
    if (!blockaded && shouldSpawnScout(room) && spawnScout(room, spawn))
        return;
    if (!blockaded && shouldSpawnRemoteDefender(room) && spawnRemoteDefender(room, spawn))
        return;
    if (!blockaded && shouldSpawnRemoteHauler(room) && spawnRemoteHauler(room, spawn))
        return;
    if (!blockaded && shouldSpawnReserver(room) && spawnReserver(room, spawn))
        return;
    if (!blockaded && shouldSpawnPowerCreep(room) && spawnNextPowerCreep(room, spawn))
        return;
    if (!blockaded && shouldSpawnDepositCreep(room) && spawnNextDepositCreep(room, spawn))
        return;
    if (!blockaded && spawnSkCreeps(room, spawn))
        return;
    if (shouldSpawnApothecary(room) && spawnApothecary(room, spawn))
        return;
    if (shouldSpawnMineralMiner(room) && spawnMineralMiner(room, spawn))
        return;
}

const SPAWN_SUFFIXES = ["", "-II", "-III", "-IV"];
function baseTownName(spawnName) {
    const dash = spawnName.lastIndexOf("-");
    if (dash > 0 && /^(II|III|IV|\d+)$/.test(spawnName.slice(dash + 1))) {
        return spawnName.slice(0, dash);
    }
    return spawnName;
}
function nextSpawnName(room) {
    var _a;
    const existing = room.find(FIND_MY_SPAWNS);
    const pendingSites = room.find(FIND_MY_CONSTRUCTION_SITES, {
        filter: (s) => s.structureType === STRUCTURE_SPAWN,
    }).length;
    if (existing.length > 0) {
        const base = baseTownName(existing[0].name);
        const slot = existing.length + pendingSites;
        return `${base}${(_a = SPAWN_SUFFIXES[slot]) !== null && _a !== void 0 ? _a : `-${slot + 1}`}`;
    }
    const used = new Set();
    for (const name in Game.spawns)
        used.add(baseTownName(Game.spawns[name].name));
    return TOWN_NAMES.find((t) => !used.has(t));
}
function ensureMemoryRoomStructures(room) {
    if (!room.memory.plannedStructures)
        room.memory.plannedStructures = {};
}
function addPlannedStructureToMemory(room, type, pos) {
    ensureMemoryRoomStructures(room);
    const mem = room.memory.plannedStructures;
    if (!mem[type]) {
        mem[type] = [];
        const meta = room.memory.plannedStructuresMeta ||
            (room.memory.plannedStructuresMeta = {});
        if (!meta[type])
            meta[type] = { createdAt: Game.time };
    }
    const key = `${pos.x},${pos.y}`;
    if (!mem[type].includes(key))
        mem[type].push(key);
}
function structureTypeForKey(key) {
    if (key.startsWith(PLANNER_KEYS.CONTAINER_PREFIX))
        return STRUCTURE_CONTAINER;
    if (key.startsWith(PLANNER_KEYS.ROAD_PREFIX))
        return STRUCTURE_ROAD;
    if (key.startsWith(PLANNER_KEYS.CONNECTOR_PREFIX))
        return STRUCTURE_ROAD;
    if (key === PLANNER_KEYS.RAMPARTS_KEY)
        return STRUCTURE_RAMPART;
    if (key === PLANNER_KEYS.CONTAINER_CONTROLLER)
        return STRUCTURE_CONTAINER;
    if (key === PLANNER_KEYS.LINK_CONTROLLER)
        return STRUCTURE_LINK;
    if (key.startsWith(PLANNER_KEYS.LINK_SOURCE_PREFIX))
        return STRUCTURE_LINK;
    if (key.startsWith(PLANNER_KEYS.EXTRACTOR_PREFIX))
        return STRUCTURE_EXTRACTOR;
    if (key.startsWith(PLANNER_KEYS.STAMP_SPAWN_PREFIX))
        return STRUCTURE_SPAWN;
    if (key.startsWith(PLANNER_KEYS.STAMP_TOWER_PREFIX))
        return STRUCTURE_TOWER;
    if (key === PLANNER_KEYS.STAMP_EXTENSION_KEY)
        return STRUCTURE_EXTENSION;
    if (key === PLANNER_KEYS.STAMP_STORAGE_KEY)
        return STRUCTURE_STORAGE;
    if (key === PLANNER_KEYS.STAMP_TERMINAL_KEY)
        return STRUCTURE_TERMINAL;
    if (key === PLANNER_KEYS.STAMP_FACTORY_KEY)
        return STRUCTURE_FACTORY;
    if (key === PLANNER_KEYS.STAMP_LAB_KEY)
        return STRUCTURE_LAB;
    if (key === PLANNER_KEYS.STAMP_NUKER_KEY)
        return STRUCTURE_NUKER;
    if (key === PLANNER_KEYS.STAMP_POWER_SPAWN_KEY)
        return STRUCTURE_POWER_SPAWN;
    if (key === PLANNER_KEYS.STAMP_OBSERVER_KEY)
        return STRUCTURE_OBSERVER;
    if (key === PLANNER_KEYS.STAMP_LINK_KEY)
        return STRUCTURE_LINK;
    if (key === PLANNER_KEYS.STAMP_ROAD_KEY)
        return STRUCTURE_ROAD;
    if (key === PLANNER_KEYS.STAMP_RAMPART_KEY)
        return STRUCTURE_RAMPART;
    if (key === PLANNER_KEYS.STAMP_WALL_KEY)
        return STRUCTURE_WALL;
    if (key.startsWith(PLANNER_KEYS.CARDINAL_ROAD_PREFIX))
        return STRUCTURE_ROAD;
    if (key.startsWith("cardinal_connector_"))
        return STRUCTURE_ROAD;
    if (key === PLANNER_KEYS.TOWN_WALL_KEY)
        return STRUCTURE_WALL;
    if (key === PLANNER_KEYS.TOWN_RAMPART_KEY)
        return STRUCTURE_RAMPART;
    return null;
}

const UNWALKABLE = -1;
const NORMAL = 0;
const PROTECTED = 1;
const EXIT = 2;
const INF = 1 << 20;
const ROOM_SIZE = 50;
class MaxFlow {
    constructor(vertexCount) {
        this.graph = Array.from({ length: vertexCount }, () => []);
        this.level = new Int32Array(vertexCount);
        this.iter = new Int32Array(vertexCount);
    }
    addEdge(from, to, cap) {
        this.graph[from].push({ to, cap, rev: this.graph[to].length });
        this.graph[to].push({ to: from, cap: 0, rev: this.graph[from].length - 1 });
    }
    bfs(source, sink) {
        this.level.fill(-1);
        const queue = [source];
        this.level[source] = 0;
        for (let head = 0; head < queue.length; head++) {
            const v = queue[head];
            for (const e of this.graph[v]) {
                if (e.cap > 0 && this.level[e.to] < 0) {
                    this.level[e.to] = this.level[v] + 1;
                    queue.push(e.to);
                }
            }
        }
        return this.level[sink] >= 0;
    }
    dfs(v, sink, pushed) {
        if (v === sink)
            return pushed;
        for (; this.iter[v] < this.graph[v].length; this.iter[v]++) {
            const e = this.graph[v][this.iter[v]];
            if (e.cap > 0 && this.level[v] < this.level[e.to]) {
                const d = this.dfs(e.to, sink, Math.min(pushed, e.cap));
                if (d > 0) {
                    e.cap -= d;
                    this.graph[e.to][e.rev].cap += d;
                    return d;
                }
            }
        }
        return 0;
    }
    maxflow(source, sink) {
        let flow = 0;
        while (this.bfs(source, sink)) {
            this.iter.fill(0);
            let f = this.dfs(source, sink, INF);
            while (f > 0) {
                flow += f;
                f = this.dfs(source, sink, INF);
            }
        }
        return flow;
    }
    minCutReachable(source) {
        const reachable = new Uint8Array(this.graph.length);
        const queue = [source];
        reachable[source] = 1;
        for (let head = 0; head < queue.length; head++) {
            const v = queue[head];
            for (const e of this.graph[v]) {
                if (e.cap > 0 && !reachable[e.to]) {
                    reachable[e.to] = 1;
                    queue.push(e.to);
                }
            }
        }
        return reachable;
    }
}
function normaliseRect(r) {
    return {
        x1: Math.max(0, Math.min(r.x1, r.x2)),
        y1: Math.max(0, Math.min(r.y1, r.y2)),
        x2: Math.min(ROOM_SIZE - 1, Math.max(r.x1, r.x2)),
        y2: Math.min(ROOM_SIZE - 1, Math.max(r.y1, r.y2)),
    };
}
function buildGrid(roomName, protect, bounds) {
    const terrain = Game.map.getRoomTerrain(roomName);
    const grid = new Int8Array(ROOM_SIZE * ROOM_SIZE);
    for (let y = 0; y < ROOM_SIZE; y++) {
        for (let x = 0; x < ROOM_SIZE; x++) {
            const idx = y * ROOM_SIZE + x;
            if (terrain.get(x, y) === TERRAIN_MASK_WALL) {
                grid[idx] = UNWALKABLE;
                continue;
            }
            if (x === 0 || y === 0 || x === ROOM_SIZE - 1 || y === ROOM_SIZE - 1) {
                grid[idx] = EXIT;
                continue;
            }
            if (x < bounds.x1 || x > bounds.x2 || y < bounds.y1 || y > bounds.y2) {
                grid[idx] = UNWALKABLE;
                continue;
            }
            grid[idx] = NORMAL;
        }
    }
    for (let y = 1; y < ROOM_SIZE - 1; y++) {
        for (let x = 1; x < ROOM_SIZE - 1; x++) {
            if (x !== 1 && x !== ROOM_SIZE - 2 && y !== 1 && y !== ROOM_SIZE - 2)
                continue;
            const idx = y * ROOM_SIZE + x;
            if (grid[idx] !== NORMAL)
                continue;
            let nearExit = false;
            for (let dy = -1; dy <= 1 && !nearExit; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    const nx = x + dx;
                    const ny = y + dy;
                    const onBorder = nx === 0 || ny === 0 || nx === ROOM_SIZE - 1 || ny === ROOM_SIZE - 1;
                    if (onBorder && terrain.get(nx, ny) !== TERRAIN_MASK_WALL) {
                        nearExit = true;
                        break;
                    }
                }
            }
            if (nearExit)
                grid[idx] = EXIT;
        }
    }
    for (const rect of protect) {
        const r = normaliseRect(rect);
        for (let y = r.y1; y <= r.y2; y++) {
            for (let x = r.x1; x <= r.x2; x++) {
                const idx = y * ROOM_SIZE + x;
                if (grid[idx] !== UNWALKABLE && grid[idx] !== EXIT)
                    grid[idx] = PROTECTED;
            }
        }
    }
    for (let y = 1; y < ROOM_SIZE - 1; y++) {
        for (let x = 1; x < ROOM_SIZE - 1; x++) {
            const idx = y * ROOM_SIZE + x;
            if (grid[idx] !== PROTECTED)
                continue;
            for (const [dx, dy] of NEIGHBOURS) {
                if (grid[(y + dy) * ROOM_SIZE + x + dx] === EXIT) {
                    grid[idx] = NORMAL;
                    break;
                }
            }
        }
    }
    return grid;
}
const NEIGHBOURS = [
    [-1, -1],
    [0, -1],
    [1, -1],
    [-1, 0],
    [1, 0],
    [-1, 1],
    [0, 1],
    [1, 1],
];
function getCutTiles(roomName, protect, options = {}) {
    var _a;
    if (protect.length === 0)
        return [];
    const bounds = normaliseRect((_a = options.bounds) !== null && _a !== void 0 ? _a : { x1: 1, y1: 1, x2: ROOM_SIZE - 2, y2: ROOM_SIZE - 2 });
    const grid = buildGrid(roomName, protect, bounds);
    const tileCount = ROOM_SIZE * ROOM_SIZE;
    const inV = (t) => 2 * t;
    const outV = (t) => 2 * t + 1;
    const SOURCE = 2 * tileCount;
    const SINK = 2 * tileCount + 1;
    const flow = new MaxFlow(2 * tileCount + 2);
    let hasProtected = false;
    let hasNormal = false;
    for (let y = 0; y < ROOM_SIZE; y++) {
        for (let x = 0; x < ROOM_SIZE; x++) {
            const t = y * ROOM_SIZE + x;
            const state = grid[t];
            if (state === UNWALKABLE)
                continue;
            if (state === PROTECTED) {
                hasProtected = true;
                flow.addEdge(SOURCE, inV(t), INF);
                flow.addEdge(inV(t), outV(t), INF);
            }
            else if (state === EXIT) {
                flow.addEdge(inV(t), SINK, INF);
                flow.addEdge(inV(t), outV(t), INF);
            }
            else {
                hasNormal = true;
                flow.addEdge(inV(t), outV(t), 1);
            }
            for (const [dx, dy] of NEIGHBOURS) {
                const nx = x + dx;
                const ny = y + dy;
                if (nx < 0 || ny < 0 || nx >= ROOM_SIZE || ny >= ROOM_SIZE)
                    continue;
                const nt = ny * ROOM_SIZE + nx;
                if (grid[nt] === UNWALKABLE)
                    continue;
                flow.addEdge(outV(t), inV(nt), INF);
            }
        }
    }
    if (!hasProtected || !hasNormal)
        return [];
    flow.maxflow(SOURCE, SINK);
    const reachable = flow.minCutReachable(SOURCE);
    const cut = [];
    for (let t = 0; t < tileCount; t++) {
        if (grid[t] !== NORMAL)
            continue;
        if (reachable[inV(t)] && !reachable[outV(t)]) {
            cut.push(new RoomPosition(t % ROOM_SIZE, Math.floor(t / ROOM_SIZE), roomName));
        }
    }
    if (options.preferCloserToProtected) {
        return cutNearestSource(flow, grid, SINK, tileCount, roomName, inV, outV);
    }
    return cut;
}
function cutNearestSource(flow, grid, sink, tileCount, roomName, inV, outV) {
    const sinkReachable = new Uint8Array(flow.graph.length);
    const queue = [sink];
    sinkReachable[sink] = 1;
    for (let head = 0; head < queue.length; head++) {
        const v = queue[head];
        for (const e of flow.graph[v]) {
            const rev = flow.graph[e.to][e.rev];
            if (rev.cap > 0 && !sinkReachable[e.to]) {
                sinkReachable[e.to] = 1;
                queue.push(e.to);
            }
        }
    }
    const cut = [];
    for (let t = 0; t < tileCount; t++) {
        if (grid[t] !== NORMAL)
            continue;
        if (sinkReachable[outV(t)] && !sinkReachable[inV(t)]) {
            cut.push(new RoomPosition(t % ROOM_SIZE, Math.floor(t / ROOM_SIZE), roomName));
        }
    }
    return cut;
}

function coreBoundingBox(room) {
    const bp = readBlueprint(room);
    if (!bp)
        return null;
    let minX = 50;
    let minY = 50;
    let maxX = -1;
    let maxY = -1;
    for (const e of bp.entries) {
        if (e.type === STRUCTURE_ROAD || e.type === STRUCTURE_CONTAINER || e.type === STRUCTURE_EXTRACTOR)
            continue;
        if (e.tag && e.tag !== "storage")
            continue;
        if (e.x < minX)
            minX = e.x;
        if (e.y < minY)
            minY = e.y;
        if (e.x > maxX)
            maxX = e.x;
        if (e.y > maxY)
            maxY = e.y;
    }
    if (maxX < 0)
        return null;
    return { minX, minY, maxX, maxY };
}
function protectedRects(room, box) {
    const rects = [
        {
            x1: Math.max(1, box.minX),
            y1: Math.max(1, box.minY),
            x2: Math.min(48, box.maxX),
            y2: Math.min(48, box.maxY),
        },
    ];
    const controller = room.controller;
    if (controller) {
        const dx = Math.max(box.minX - controller.pos.x, 0, controller.pos.x - box.maxX);
        const dy = Math.max(box.minY - controller.pos.y, 0, controller.pos.y - box.maxY);
        if (Math.max(dx, dy) <= 5) {
            rects.push({
                x1: Math.max(1, controller.pos.x - 1),
                y1: Math.max(1, controller.pos.y - 1),
                x2: Math.min(48, controller.pos.x + 1),
                y2: Math.min(48, controller.pos.y + 1),
            });
        }
    }
    rects.push(...townProtectedRects(room));
    return rects;
}
function perimeterDoorTiles(room) {
    const bp = readBlueprint(room);
    if (!bp)
        return null;
    const doors = new Set();
    for (const e of bp.entries)
        if (e.type === STRUCTURE_ROAD)
            doors.add(`${e.x},${e.y}`);
    for (const path of Object.values(bp.exits)) {
        for (const p of path !== null && path !== void 0 ? path : [])
            doors.add(`${p.x},${p.y}`);
    }
    return doors;
}
function storePerimeter(room, tiles) {
    var _a;
    const mem = ((_a = room.memory.plannedStructures) !== null && _a !== void 0 ? _a : {});
    mem[PLANNER_KEYS.STAMP_RAMPART_KEY] = [];
    mem[PLANNER_KEYS.STAMP_WALL_KEY] = [];
    if (room.memory.plannedStructuresMeta) {
        delete room.memory.plannedStructuresMeta[PLANNER_KEYS.STAMP_RAMPART_KEY];
    }
    const doors = perimeterDoorTiles(room);
    for (const t of tiles) {
        const door = !doors || doors.has(`${t.x},${t.y}`);
        addPlannedStructureToMemory(room, door ? PLANNER_KEYS.STAMP_RAMPART_KEY : PLANNER_KEYS.STAMP_WALL_KEY, new RoomPosition(t.x, t.y, room.name));
    }
    room.memory.perimeterTiles = tiles.map((t) => `${t.x},${t.y}`);
    if (!room.memory.plannedStructuresMeta)
        room.memory.plannedStructuresMeta = {};
    room.memory.plannedStructuresMeta[PLANNER_KEYS.STAMP_RAMPART_KEY] = {
        createdAt: Game.time,
    };
}
function planBoundingBoxRing(room, box) {
    const { margin, minEdge, maxEdge } = PERIMETER_PLANNER;
    const minX = Math.max(minEdge, box.minX - margin);
    const minY = Math.max(minEdge, box.minY - margin);
    const maxX = Math.min(maxEdge, box.maxX + margin);
    const maxY = Math.min(maxEdge, box.maxY + margin);
    if (minX >= maxX || minY >= maxY)
        return [];
    const terrain = room.getTerrain();
    const tiles = [];
    const seen = new Set();
    const place = (x, y) => {
        const k = `${x},${y}`;
        if (seen.has(k))
            return;
        seen.add(k);
        if (terrain.get(x, y) === TERRAIN_MASK_WALL)
            return;
        tiles.push({ x, y });
    };
    for (let x = minX; x <= maxX; x++) {
        place(x, minY);
        place(x, maxY);
    }
    for (let y = minY + 1; y < maxY; y++) {
        place(minX, y);
        place(maxX, y);
    }
    return tiles;
}
function shouldPlanDefensivePerimeter(rcl) {
    return rcl >= PERIMETER_PLANNER.minRcl;
}
function planDefensivePerimeter(room) {
    var _a, _b, _c, _d, _e;
    const rcl = (_b = (_a = room.controller) === null || _a === void 0 ? void 0 : _a.level) !== null && _b !== void 0 ? _b : 0;
    if (!shouldPlanDefensivePerimeter(rcl))
        return;
    const mem = ((_c = room.memory.plannedStructures) !== null && _c !== void 0 ? _c : {});
    const meta = ((_d = room.memory.plannedStructuresMeta) !== null && _d !== void 0 ? _d : {});
    const lastPlanned = (_e = meta[PLANNER_KEYS.STAMP_RAMPART_KEY]) === null || _e === void 0 ? void 0 : _e.createdAt;
    if (room.memory.perimeterTiles &&
        mem[PLANNER_KEYS.STAMP_WALL_KEY] !== undefined &&
        lastPlanned !== undefined &&
        Game.time - lastPlanned < PERIMETER_PLANNER.replanInterval) {
        return;
    }
    const box = coreBoundingBox(room);
    if (!box)
        return;
    const cut = getCutTiles(room.name, protectedRects(room, box));
    if (cut.length > 0) {
        storePerimeter(room, cut);
        return;
    }
    storePerimeter(room, planBoundingBoxRing(room, box));
}

const BUILD_PRIORITY = {
    [STRUCTURE_SPAWN]: 0,
    [STRUCTURE_EXTENSION]: 1,
    [STRUCTURE_CONTAINER]: 2,
    [STRUCTURE_TOWER]: 3,
    [STRUCTURE_STORAGE]: 4,
    [STRUCTURE_TERMINAL]: 5,
    [STRUCTURE_LINK]: 6,
    [STRUCTURE_EXTRACTOR]: 6,
    [STRUCTURE_LAB]: 7,
    [STRUCTURE_FACTORY]: 8,
    [STRUCTURE_NUKER]: 9,
    [STRUCTURE_POWER_SPAWN]: 9,
    [STRUCTURE_OBSERVER]: 9,
    [STRUCTURE_RAMPART]: 10,
    [STRUCTURE_ROAD]: 11,
};
const PERIMETER_PRIORITY = 12;
const TOWN_PRIORITY = 13;
const MAX_REMOTE_CONTAINER_SITES = 2;
const MAX_REMOTE_ROAD_SITES = 10;
function buildPriority(key) {
    var _a;
    if (key === PLANNER_KEYS.STAMP_RAMPART_KEY || key === PLANNER_KEYS.STAMP_WALL_KEY)
        return PERIMETER_PRIORITY;
    if (key === PLANNER_KEYS.TOWN_WALL_KEY || key === PLANNER_KEYS.TOWN_RAMPART_KEY)
        return TOWN_PRIORITY;
    const type = structureTypeForKey(key);
    return type ? (_a = BUILD_PRIORITY[type]) !== null && _a !== void 0 ? _a : 11 : 11;
}
function cleanupPlannedStructuresGlobal() {
    var _a, _b;
    const interval = STRUCTURE_PLANNER.plannedCleanupInterval ;
    if (Game.time % interval !== 0)
        return;
    for (const rn in Game.rooms) {
        const room = Game.rooms[rn];
        const mem = room.memory.plannedStructures;
        const meta = (_a = room.memory.plannedStructuresMeta) !== null && _a !== void 0 ? _a : {};
        if (!mem)
            continue;
        for (const key of Object.keys(mem)) {
            const arr = (_b = mem[key]) !== null && _b !== void 0 ? _b : [];
            if (arr.length <= 1)
                continue;
            if (key === PLANNER_KEYS.CONTAINER_CONTROLLER ||
                key.startsWith(PLANNER_KEYS.CONTAINER_SOURCE_PREFIX) ||
                key.startsWith(PLANNER_KEYS.CONTAINER_MINERAL_PREFIX)) {
                mem[key] = [arr[0]];
                if (meta[key])
                    meta[key].createdAt = Game.time;
            }
            else {
                const seen = new Set();
                const keep = [];
                for (const p of arr) {
                    if (seen.has(p))
                        continue;
                    const [x, y] = p.split(",").map(Number);
                    if (isNaN(x) || isNaN(y) || x < 0 || x >= 50 || y < 0 || y >= 50)
                        continue;
                    seen.add(p);
                    keep.push(p);
                }
                mem[key] = keep;
                if (meta[key] && mem[key].length === 0)
                    delete meta[key];
            }
        }
    }
    const unseenAge = STRUCTURE_PLANNER.plannedCleanupUnseenAge;
    if (!Memory.rooms)
        return;
    for (const rname of Object.keys(Memory.rooms)) {
        if (Game.rooms[rname])
            continue;
        const rm = Memory.rooms[rname];
        if (!(rm === null || rm === void 0 ? void 0 : rm.plannedStructuresMeta))
            continue;
        let anyRecent = false;
        for (const k of Object.keys(rm.plannedStructuresMeta)) {
            const info = rm.plannedStructuresMeta[k];
            if (!(info === null || info === void 0 ? void 0 : info.createdAt))
                continue;
            if (Game.time - info.createdAt < unseenAge) {
                anyRecent = true;
                break;
            }
        }
        if (!anyRecent) {
            delete rm.plannedStructures;
            delete rm.plannedStructuresMeta;
        }
    }
}
function applyPlannedConstruction(room) {
    var _a, _b, _c, _d, _e, _f;
    if (!room.memory.plannedStructures)
        return;
    const mem = room.memory.plannedStructures;
    const terrain = room.getTerrain();
    const builtByType = new Map();
    const sitesByType = new Map();
    const roadByPos = new Map();
    const roadSiteByPos = new Map();
    const ownBuiltCount = new Map();
    for (const s of room.find(FIND_STRUCTURES)) {
        const t = s.structureType;
        if (!builtByType.has(t))
            builtByType.set(t, new Set());
        builtByType.get(t).add(`${s.pos.x},${s.pos.y}`);
        if (s.my !== false)
            ownBuiltCount.set(t, ((_a = ownBuiltCount.get(t)) !== null && _a !== void 0 ? _a : 0) + 1);
        if (t === STRUCTURE_ROAD)
            roadByPos.set(`${s.pos.x},${s.pos.y}`, s);
    }
    for (const s of room.find(FIND_CONSTRUCTION_SITES)) {
        const t = s.structureType;
        if (!sitesByType.has(t))
            sitesByType.set(t, new Set());
        sitesByType.get(t).add(`${s.pos.x},${s.pos.y}`);
        if (t === STRUCTURE_ROAD)
            roadSiteByPos.set(`${s.pos.x},${s.pos.y}`, s);
    }
    const rampOnTopTypes = new Set(STRUCTURE_PLANNER.rampartOnTopFor);
    const roadCompatible = new Set([
        STRUCTURE_ROAD,
        STRUCTURE_RAMPART,
        STRUCTURE_CONTAINER,
    ]);
    const roadKeys = Object.keys(mem).filter((k) => structureTypeForKey(k) === STRUCTURE_ROAD);
    const conflictedRoadKeys = new Set();
    for (const key of Object.keys(mem)) {
        const type = structureTypeForKey(key);
        if (!type || roadCompatible.has(type))
            continue;
        for (const posStr of mem[key]) {
            const road = roadByPos.get(posStr);
            const roadSite = roadSiteByPos.get(posStr);
            if (!road && !roadSite)
                continue;
            if (road)
                road.destroy();
            if (roadSite)
                roadSite.remove();
            for (const rk of roadKeys) {
                if (mem[rk].indexOf(posStr) !== -1)
                    conflictedRoadKeys.add(rk);
            }
        }
    }
    for (const rk of conflictedRoadKeys) {
        delete mem[rk];
        if (room.memory.plannedStructuresMeta) {
            delete room.memory.plannedStructuresMeta[rk];
        }
    }
    const roadCap = STRUCTURE_PLANNER.maxRoadConstructionSites;
    let roadSiteCount = roadSiteByPos.size;
    if (roadSiteCount > roadCap) {
        for (const [pos, site] of roadSiteByPos) {
            if (roadSiteCount <= roadCap)
                break;
            if (site.progress > 0)
                continue;
            site.remove();
            roadSiteByPos.delete(pos);
            roadSiteCount--;
        }
    }
    const perRoomCap = STRUCTURE_PLANNER.maxActiveConstructionSites;
    let roomSiteCount = 0;
    for (const set of sitesByType.values())
        roomSiteCount += set.size;
    const globalRemaining = MAX_CONSTRUCTION_SITES - Object.keys(Game.constructionSites).length;
    let budget = Math.min(globalRemaining, perRoomCap - roomSiteCount);
    const keys = Object.keys(mem).sort((a, b) => buildPriority(a) - buildPriority(b));
    const prioOfSite = (s) => { var _a; return (_a = BUILD_PRIORITY[s.structureType]) !== null && _a !== void 0 ? _a : 11; };
    let evictPool = null;
    const evictForPriority = (target) => {
        if (evictPool === null) {
            evictPool = room.find(FIND_MY_CONSTRUCTION_SITES)
                .filter((s) => s.progress === 0)
                .sort((a, b) => prioOfSite(a) - prioOfSite(b));
        }
        const victim = evictPool[evictPool.length - 1];
        if (!victim || prioOfSite(victim) <= target)
            return false;
        evictPool.pop();
        victim.remove();
        return true;
    };
    const rcl = (_c = (_b = room.controller) === null || _b === void 0 ? void 0 : _b.level) !== null && _c !== void 0 ? _c : 0;
    const placedByType = new Map();
    const atStructureLimit = (t) => {
        var _a, _b, _c, _d, _e;
        const limit = (_a = CONTROLLER_STRUCTURES[t]) === null || _a === void 0 ? void 0 : _a[rcl];
        if (limit === undefined)
            return false;
        const count = ((_b = ownBuiltCount.get(t)) !== null && _b !== void 0 ? _b : 0) + ((_d = (_c = sitesByType.get(t)) === null || _c === void 0 ? void 0 : _c.size) !== null && _d !== void 0 ? _d : 0) + ((_e = placedByType.get(t)) !== null && _e !== void 0 ? _e : 0);
        return count >= limit;
    };
    const perimeterKeys = {
        [PLANNER_KEYS.STAMP_RAMPART_KEY]: STRUCTURE_RAMPART,
        [PLANNER_KEYS.STAMP_WALL_KEY]: STRUCTURE_WALL,
    };
    const perimeterCap = STRUCTURE_PLANNER.maxPerimeterConstructionSites;
    let perimeterSiteCount = 0;
    for (const [key, type] of Object.entries(perimeterKeys)) {
        const typeSites = sitesByType.get(type);
        if (typeSites && mem[key]) {
            for (const p of mem[key])
                if (typeSites.has(p))
                    perimeterSiteCount++;
        }
    }
    for (const key of keys) {
        const type = structureTypeForKey(key);
        if (!type)
            continue;
        const isRoad = type === STRUCTURE_ROAD;
        const built = builtByType.get(type);
        const sites = sitesByType.get(type);
        const arr = mem[key];
        const keep = [];
        for (const posStr of arr) {
            if (built === null || built === void 0 ? void 0 : built.has(posStr)) {
                if (rampOnTopTypes.has(type)) {
                    const comma = posStr.indexOf(",");
                    const x = +posStr.slice(0, comma);
                    const y = +posStr.slice(comma + 1);
                    addPlannedStructureToMemory(room, PLANNER_KEYS.RAMPARTS_KEY, new RoomPosition(x, y, room.name));
                    const rampartSites = (_d = sitesByType.get(STRUCTURE_RAMPART)) !== null && _d !== void 0 ? _d : new Set();
                    const covered = ((_e = builtByType.get(STRUCTURE_RAMPART)) === null || _e === void 0 ? void 0 : _e.has(posStr)) || rampartSites.has(posStr);
                    if (!covered && budget > 0 && room.createConstructionSite(x, y, STRUCTURE_RAMPART) === OK) {
                        budget--;
                        rampartSites.add(posStr);
                        sitesByType.set(STRUCTURE_RAMPART, rampartSites);
                    }
                }
                continue;
            }
            const comma = posStr.indexOf(",");
            const x = +posStr.slice(0, comma);
            const y = +posStr.slice(comma + 1);
            if (type !== STRUCTURE_EXTRACTOR && terrain.get(x, y) === TERRAIN_MASK_WALL)
                continue;
            keep.push(posStr);
            if (sites === null || sites === void 0 ? void 0 : sites.has(posStr))
                continue;
            if (atStructureLimit(type))
                continue;
            if (budget <= 0) {
                if (!evictForPriority(buildPriority(key)))
                    continue;
                budget++;
            }
            if (isRoad && roadSiteCount >= roadCap)
                continue;
            if (key in perimeterKeys && perimeterSiteCount >= perimeterCap)
                continue;
            let result;
            if (type === STRUCTURE_SPAWN) {
                const name = nextSpawnName(room);
                result = name
                    ? room.createConstructionSite(x, y, STRUCTURE_SPAWN, name)
                    : ERR_NAME_EXISTS;
            }
            else {
                result = room.createConstructionSite(x, y, type);
            }
            if (result === OK) {
                budget--;
                placedByType.set(type, ((_f = placedByType.get(type)) !== null && _f !== void 0 ? _f : 0) + 1);
                if (isRoad)
                    roadSiteCount++;
                if (key in perimeterKeys)
                    perimeterSiteCount++;
            }
        }
        mem[key] = keep;
    }
}
function cleanupUnplannedConstructionSites(room) {
    if (!room.memory.plannedStructures)
        return;
    const sites = room.find(FIND_CONSTRUCTION_SITES);
    if (sites.length === 0)
        return;
    const mem = room.memory.plannedStructures;
    const plannedByType = new Map();
    for (const key of Object.keys(mem)) {
        const type = structureTypeForKey(key);
        if (!type)
            continue;
        const t = type;
        if (!plannedByType.has(t))
            plannedByType.set(t, new Set());
        const set = plannedByType.get(t);
        for (const p of mem[key])
            set.add(p);
    }
    for (const site of sites) {
        if (site.structureType === STRUCTURE_WALL)
            continue;
        const set = plannedByType.get(site.structureType);
        if (!set)
            continue;
        if (set.has(`${site.pos.x},${site.pos.y}`))
            continue;
        if (site.progress > 0)
            continue;
        site.remove();
    }
}
function ensureRampartsForExistingStructures(room) {
    var _a, _b;
    const rampTypes = (STRUCTURE_PLANNER.rampartOnTopFor ||
        []);
    const structures = room.find(FIND_STRUCTURES);
    const existingRampSet = new Set();
    for (const s of structures) {
        if (s.structureType === STRUCTURE_RAMPART)
            existingRampSet.add(`${s.pos.x},${s.pos.y}`);
    }
    const plannedRampSet = new Set((_b = (_a = room.memory.plannedStructures) === null || _a === void 0 ? void 0 : _a[PLANNER_KEYS.RAMPARTS_KEY]) !== null && _b !== void 0 ? _b : []);
    for (const s of structures) {
        if (!rampTypes.includes(s.structureType))
            continue;
        if (s.structureType === STRUCTURE_RAMPART)
            continue;
        const posKey = `${s.pos.x},${s.pos.y}`;
        if (existingRampSet.has(posKey) || plannedRampSet.has(posKey))
            continue;
        plannedRampSet.add(posKey);
        addPlannedStructureToMemory(room, PLANNER_KEYS.RAMPARTS_KEY, new RoomPosition(s.pos.x, s.pos.y, room.name));
        room.createConstructionSite(s.pos.x, s.pos.y, STRUCTURE_RAMPART);
    }
}
function cleanupSitesOutsideOwnedRooms() {
    var _a, _b;
    const { containerRooms, roadRooms } = workedRemoteRooms();
    for (const id in Game.constructionSites) {
        const site = Game.constructionSites[id];
        if ((_b = (_a = Game.rooms[site.pos.roomName]) === null || _a === void 0 ? void 0 : _a.controller) === null || _b === void 0 ? void 0 : _b.my)
            continue;
        if (site.structureType === STRUCTURE_CONTAINER && containerRooms.has(site.pos.roomName))
            continue;
        if (site.structureType === STRUCTURE_ROAD && roadRooms.has(site.pos.roomName))
            continue;
        site.remove();
    }
}
function workedRemoteRooms() {
    var _a;
    const containerRooms = new Set();
    const roadRooms = new Set();
    for (const rn in Game.rooms) {
        const room = Game.rooms[rn];
        if (!((_a = room.controller) === null || _a === void 0 ? void 0 : _a.my))
            continue;
        const roads = remoteRoadsEnabled(room);
        for (const name of getPickedRemoteRoomNames(room)) {
            containerRooms.add(name);
            if (roads)
                roadRooms.add(name);
        }
    }
    return { containerRooms, roadRooms };
}
function loop$6() {
    cleanupPlannedStructuresGlobal();
    if (Game.time % 100 === 0)
        cleanupSitesOutsideOwnedRooms();
    const applyConstruction = Game.time % 5 === 0;
    for (const roomName in Game.rooms) {
        const room = Game.rooms[roomName];
        if (!room.controller || !room.controller.my)
            continue;
        processRoomStructures(room);
        if (applyConstruction) {
            applyPlannedConstruction(room);
            cleanupUnplannedConstructionSites(room);
            ensureRampartsForExistingStructures(room);
        }
    }
    if (Game.time % 100 === 0) {
        let budget = MAX_REMOTE_CONTAINER_SITES - countRemoteContainerSites();
        let roadBudget = MAX_REMOTE_ROAD_SITES - countRemoteSites(STRUCTURE_ROAD);
        for (const roomName in Game.rooms) {
            const room = Game.rooms[roomName];
            if (!room.controller || !room.controller.my)
                continue;
            const remotes = getActiveRemoteRooms(room);
            if (budget > 0)
                budget = planRemoteRoomContainers(room, remotes, budget);
            if (roadBudget > 0 && remoteRoadsEnabled(room)) {
                roadBudget = planRemoteRoads(room, remotes, roadBudget);
            }
        }
    }
}
function countRemoteContainerSites() {
    return countRemoteSites(STRUCTURE_CONTAINER);
}
function countRemoteSites(type) {
    var _a, _b;
    let count = 0;
    for (const id in Game.constructionSites) {
        const site = Game.constructionSites[id];
        if (site.structureType !== type)
            continue;
        if ((_b = (_a = Game.rooms[site.pos.roomName]) === null || _a === void 0 ? void 0 : _a.controller) === null || _b === void 0 ? void 0 : _b.my)
            continue;
        count++;
    }
    return count;
}
function canBuildInRemote(remoteRoom, myName) {
    const ctrl = remoteRoom.controller;
    if (!ctrl)
        return false;
    if (ctrl.owner && !ctrl.my)
        return false;
    if (ctrl.reservation && ctrl.reservation.username !== myName)
        return false;
    return true;
}
function planRemoteRoomContainers(homeRoom, remotes, budget) {
    var _a, _b;
    const myName = (_b = (_a = homeRoom.controller) === null || _a === void 0 ? void 0 : _a.owner) === null || _b === void 0 ? void 0 : _b.username;
    for (const remote of remotes) {
        if (budget <= 0)
            return budget;
        const remoteRoom = Game.rooms[remote.roomName];
        if (!remoteRoom)
            continue;
        if (!canBuildInRemote(remoteRoom, myName))
            continue;
        const terrain = remoteRoom.getTerrain();
        for (const sourceData of remote.sources) {
            if (budget <= 0)
                return budget;
            const source = Game.getObjectById(sourceData.sourceId);
            if (!source)
                continue;
            if (sourceData.containerId) {
                const existing = Game.getObjectById(sourceData.containerId);
                if (existing)
                    continue;
                sourceData.containerId = undefined;
            }
            const built = source.pos.findInRange(FIND_STRUCTURES, 1, {
                filter: (s) => s.structureType === STRUCTURE_CONTAINER,
            });
            if (built.length > 0) {
                sourceData.containerId = built[0].id;
                continue;
            }
            const site = source.pos.findInRange(FIND_CONSTRUCTION_SITES, 1, {
                filter: (s) => s.structureType === STRUCTURE_CONTAINER,
            });
            if (site.length > 0)
                continue;
            let placed = false;
            for (let dx = -1; dx <= 1 && !placed; dx++) {
                for (let dy = -1; dy <= 1 && !placed; dy++) {
                    if (dx === 0 && dy === 0)
                        continue;
                    const x = source.pos.x + dx;
                    const y = source.pos.y + dy;
                    if (x < 1 || x >= 49 || y < 1 || y >= 49)
                        continue;
                    if (terrain.get(x, y) === TERRAIN_MASK_WALL)
                        continue;
                    if (remoteRoom.createConstructionSite(x, y, STRUCTURE_CONTAINER) === OK)
                        placed = true;
                }
            }
            if (placed)
                budget--;
        }
    }
    return budget;
}
function planRemoteRoads(homeRoom, remotes, budget) {
    var _a, _b;
    const myName = (_b = (_a = homeRoom.controller) === null || _a === void 0 ? void 0 : _a.owner) === null || _b === void 0 ? void 0 : _b.username;
    for (const remote of remotes) {
        const remoteRoom = Game.rooms[remote.roomName];
        if (!remoteRoom || !canBuildInRemote(remoteRoom, myName))
            continue;
        for (const src of remote.sources) {
            if (!src.containerId || !src.roadTiles)
                continue;
            for (const tile of src.roadTiles.split(";")) {
                if (budget <= 0)
                    return budget;
                const [x, y] = tile.split(",").map(Number);
                const hasRoad = remoteRoom
                    .lookForAt(LOOK_STRUCTURES, x, y)
                    .some((s) => s.structureType === STRUCTURE_ROAD);
                if (hasRoad || remoteRoom.lookForAt(LOOK_CONSTRUCTION_SITES, x, y).length > 0)
                    continue;
                if (remoteRoom.createConstructionSite(x, y, STRUCTURE_ROAD) === OK)
                    budget--;
            }
        }
    }
    return budget;
}
function processRoomStructures(room) {
    var _a;
    const last = room.memory.lastStructurePlanTick || 0;
    if (Game.time - last < STRUCTURE_PLANNER.planInterval)
        return;
    ensureMemoryRoomStructures(room);
    if (!blueprintIsCurrent(room)) {
        if (planRoomBlueprint(room)) {
            (_a = room.memory.plannedStructuresMeta) === null || _a === void 0 ? true : delete _a[PLANNER_KEYS.STAMP_RAMPART_KEY];
        }
        else {
            console.log(`[blueprint] ${room.name}: no layout fits this room`);
        }
    }
    const bp = readBlueprint(room);
    let cleared = false;
    if (bp) {
        room.memory.blueprint.lanes = activeLanes(room);
        materializeBlueprint(room, bp);
        cleared = clearWayForBlueprint(room, bp);
    }
    planDefensivePerimeter(room);
    if (!cleared)
        clearWayForRing(room);
    planTown(room);
    room.memory.lastStructurePlanTick = Game.time;
}
function sideOfExit(exit) {
    if (exit === FIND_EXIT_TOP)
        return "top";
    if (exit === FIND_EXIT_RIGHT)
        return "right";
    if (exit === FIND_EXIT_BOTTOM)
        return "bottom";
    return "left";
}
const LANE_KEYS = {
    top: `${PLANNER_KEYS.CARDINAL_ROAD_PREFIX}north`,
    right: `${PLANNER_KEYS.CARDINAL_ROAD_PREFIX}east`,
    bottom: `${PLANNER_KEYS.CARDINAL_ROAD_PREFIX}south`,
    left: `${PLANNER_KEYS.CARDINAL_ROAD_PREFIX}west`,
};
function activeLanes(room) {
    const out = new Set();
    for (const r of getActiveRemoteRooms(room)) {
        const exit = room.findExitTo(r.roomName);
        if (exit === ERR_NO_PATH || exit === ERR_INVALID_ARGS)
            continue;
        out.add(sideOfExit(exit));
    }
    return [...out];
}
function keyForEntry(e, n) {
    var _a, _b, _c;
    const next = (type) => {
        var _a;
        const i = ((_a = n.get(type)) !== null && _a !== void 0 ? _a : 0) + 1;
        n.set(type, i);
        return i;
    };
    const id = e.tag ? e.tag.slice(e.tag.indexOf(":") + 1) : "";
    switch (e.type) {
        case STRUCTURE_SPAWN: return `${PLANNER_KEYS.STAMP_SPAWN_PREFIX}${next(e.type)}`;
        case STRUCTURE_TOWER: return `${PLANNER_KEYS.STAMP_TOWER_PREFIX}${next(e.type)}`;
        case STRUCTURE_EXTENSION: return PLANNER_KEYS.STAMP_EXTENSION_KEY;
        case STRUCTURE_LAB: return PLANNER_KEYS.STAMP_LAB_KEY;
        case STRUCTURE_STORAGE: return PLANNER_KEYS.STAMP_STORAGE_KEY;
        case STRUCTURE_TERMINAL: return PLANNER_KEYS.STAMP_TERMINAL_KEY;
        case STRUCTURE_FACTORY: return PLANNER_KEYS.STAMP_FACTORY_KEY;
        case STRUCTURE_NUKER: return PLANNER_KEYS.STAMP_NUKER_KEY;
        case STRUCTURE_POWER_SPAWN: return PLANNER_KEYS.STAMP_POWER_SPAWN_KEY;
        case STRUCTURE_OBSERVER: return PLANNER_KEYS.STAMP_OBSERVER_KEY;
        case STRUCTURE_EXTRACTOR: return `${PLANNER_KEYS.EXTRACTOR_PREFIX}${id}`;
        case STRUCTURE_ROAD: return `${PLANNER_KEYS.ROAD_PREFIX}blueprint`;
        case STRUCTURE_LINK:
            if ((_a = e.tag) === null || _a === void 0 ? void 0 : _a.startsWith("source:"))
                return `${PLANNER_KEYS.LINK_SOURCE_PREFIX}${id}`;
            if (e.tag === "controller")
                return PLANNER_KEYS.LINK_CONTROLLER;
            return PLANNER_KEYS.STAMP_LINK_KEY;
        case STRUCTURE_CONTAINER:
            if ((_b = e.tag) === null || _b === void 0 ? void 0 : _b.startsWith("source:"))
                return `${PLANNER_KEYS.CONTAINER_SOURCE_PREFIX}${id}`;
            if ((_c = e.tag) === null || _c === void 0 ? void 0 : _c.startsWith("mineral:"))
                return `${PLANNER_KEYS.CONTAINER_MINERAL_PREFIX}${id}`;
            return PLANNER_KEYS.CONTAINER_CONTROLLER;
        default: return PLANNER_KEYS.CASTLE_STAMP_KEY;
    }
}
const KEPT_KEYS = new Set([
    PLANNER_KEYS.STAMP_RAMPART_KEY,
    PLANNER_KEYS.STAMP_WALL_KEY,
    PLANNER_KEYS.RAMPARTS_KEY,
    PLANNER_KEYS.TOWN_WALL_KEY,
    PLANNER_KEYS.TOWN_RAMPART_KEY,
]);
function unsafeTags(room) {
    const out = new Set();
    for (const s of room.find(FIND_SOURCES))
        if (!isSourceSafe(s))
            out.add(`source:${s.id}`);
    return out;
}
function materializeBlueprint(room, bp) {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    const rcl = (_b = (_a = room.controller) === null || _a === void 0 ? void 0 : _a.level) !== null && _b !== void 0 ? _b : 0;
    const old = (_c = room.memory.plannedStructures) !== null && _c !== void 0 ? _c : {};
    const meta = (_d = room.memory.plannedStructuresMeta) !== null && _d !== void 0 ? _d : (room.memory.plannedStructuresMeta = {});
    const mem = {};
    for (const key of Object.keys(old))
        if (KEPT_KEYS.has(key))
            mem[key] = old[key];
    const unsafe = unsafeTags(room);
    const counters = new Map();
    for (const e of bp.entries) {
        if (e.rcl > rcl)
            continue;
        if (e.tag && unsafe.has(e.tag))
            continue;
        const key = keyForEntry(e, counters);
        ((_e = mem[key]) !== null && _e !== void 0 ? _e : (mem[key] = [])).push(`${e.x},${e.y}`);
    }
    for (const side of (_g = (_f = room.memory.blueprint) === null || _f === void 0 ? void 0 : _f.lanes) !== null && _g !== void 0 ? _g : []) {
        const path = bp.exits[side];
        if (path && path.length > 0)
            mem[LANE_KEYS[side]] = path.map((p) => `${p.x},${p.y}`);
    }
    for (const key of Object.keys(meta))
        if (!mem[key])
            delete meta[key];
    for (const key of Object.keys(mem))
        (_h = meta[key]) !== null && _h !== void 0 ? _h : (meta[key] = { createdAt: Game.time });
    room.memory.plannedStructures = mem;
}
const COEXISTS = new Set([STRUCTURE_ROAD, STRUCTURE_RAMPART]);
const MOVABLE = new Set([STRUCTURE_EXTENSION, STRUCTURE_LAB, STRUCTURE_LINK, STRUCTURE_CONTAINER]);
function clearWayForBlueprint(room, bp) {
    var _a, _b, _c, _d;
    const rcl = (_b = (_a = room.controller) === null || _a === void 0 ? void 0 : _a.level) !== null && _b !== void 0 ? _b : 0;
    if (room.find(FIND_HOSTILE_CREEPS).length > 0)
        return false;
    const unlocked = new Map();
    for (const e of bp.entries)
        if (e.rcl <= rcl && e.type !== STRUCTURE_ROAD)
            unlocked.set(`${e.x},${e.y}`, e);
    const planned = new Set();
    for (const e of bp.entries)
        if (e.type !== STRUCTURE_ROAD)
            planned.add(`${e.x},${e.y}:${e.type}`);
    const structures = room.find(FIND_STRUCTURES);
    const builtAt = new Set();
    for (const s of structures)
        builtAt.add(`${s.pos.x},${s.pos.y}:${s.structureType}`);
    for (const s of room.find(FIND_MY_CONSTRUCTION_SITES))
        builtAt.add(`${s.pos.x},${s.pos.y}:${s.structureType}`);
    for (const s of structures) {
        if (s.structureType === STRUCTURE_CONTROLLER || COEXISTS.has(s.structureType))
            continue;
        const k = `${s.pos.x},${s.pos.y}`;
        const e = unlocked.get(k);
        if (!e || e.type === s.structureType || builtAt.has(`${k}:${e.type}`))
            continue;
        if (s.structureType === STRUCTURE_SPAWN)
            continue;
        if (s.destroy() === OK) {
            console.log(`[blueprint] ${room.name}: removed ${s.structureType} at ${k} for a planned ${e.type}`);
            return true;
        }
    }
    const waiting = new Set();
    for (const e of unlocked.values()) {
        if (MOVABLE.has(e.type) && !builtAt.has(`${e.x},${e.y}:${e.type}`))
            waiting.add(e.type);
    }
    for (const type of waiting) {
        const own = structures.filter((s) => s.structureType === type && s.my !== false);
        const cap = (_d = (_c = CONTROLLER_STRUCTURES[type]) === null || _c === void 0 ? void 0 : _c[rcl]) !== null && _d !== void 0 ? _d : 0;
        if (own.length < cap)
            continue;
        const strays = own.filter((s) => !planned.has(`${s.pos.x},${s.pos.y}:${type}`));
        if (strays.length === 0)
            continue;
        const farthest = strays.reduce((a, b) => Math.max(Math.abs(a.pos.x - bp.hub.x), Math.abs(a.pos.y - bp.hub.y)) >=
            Math.max(Math.abs(b.pos.x - bp.hub.x), Math.abs(b.pos.y - bp.hub.y))
            ? a
            : b);
        if (farthest.destroy() === OK) {
            console.log(`[blueprint] ${room.name}: removed a stray ${type} at ${farthest.pos.x},${farthest.pos.y}`);
            return true;
        }
    }
    return false;
}
const RAMPART_TO_WALL_MAX_HITS = 100000;
function clearWayForRing(room) {
    const ring = room.memory.perimeterTiles;
    const doors = perimeterDoorTiles(room);
    if (!ring || !doors)
        return false;
    if (room.find(FIND_HOSTILE_CREEPS).length > 0)
        return false;
    const tiles = new Set(ring);
    for (const s of room.find(FIND_STRUCTURES)) {
        const k = `${s.pos.x},${s.pos.y}`;
        if (!tiles.has(k))
            continue;
        const door = doors.has(k);
        const swap = (door && s.structureType === STRUCTURE_WALL) ||
            (!door &&
                s.structureType === STRUCTURE_RAMPART &&
                s.my &&
                s.hits <= RAMPART_TO_WALL_MAX_HITS);
        if (!swap)
            continue;
        if (s.destroy() === OK) {
            console.log(`[perimeter] ${room.name}: removed the ${s.structureType} at ${k} for a ${door ? "door" : "wall"}`);
            return true;
        }
    }
    return false;
}

const THREAT_NOTIFY_COOLDOWN = 200;
const SAFEMODE_SPAWN_HP_RATIO = 0.50;
const SAFEMODE_TOWER_HP_RATIO = 0.25;
const SAFEMODE_STORAGE_HP_RATIO = 0.25;
const SAFEMODE_TERMINAL_HP_RATIO = 0.25;
const SAFEMODE_MIN_TOWER_ENERGY = 50;
const SAFEMODE_OVERWHELMED_COUNT = 3;
const SAFEMODE_LOW_CHARGE = 1;
const SAFEMODE_SPAWN_PREDICT_TICKS = 12;
const SAFEMODE_SPAWN_PREDICT_HP_RATIO = 0.80;
const SAFEMODE_LETHAL_DPS = 400;
function loop$5() {
    var _a, _b;
    for (const roomName in Game.rooms) {
        const room = Game.rooms[roomName];
        if (!((_a = room.controller) === null || _a === void 0 ? void 0 : _a.my))
            continue;
        const hostiles = room.find(FIND_HOSTILE_CREEPS, {
            filter: (c) => { var _a; return !isAlly((_a = c.owner) === null || _a === void 0 ? void 0 : _a.username); },
        });
        notifyOnHostiles(room, hostiles);
        checkSafeMode(room, hostiles);
        const towerIds = (_b = room.memory.towerIds) !== null && _b !== void 0 ? _b : [];
        if (towerIds.length === 0)
            continue;
        const attackTarget = selectRoomAttackTarget(hostiles, room);
        const hasHostiles = hostiles.length > 0;
        for (const id of towerIds) {
            const tower = Game.getObjectById(id);
            if (tower)
                runTower(tower, attackTarget, hasHostiles);
        }
    }
}
function checkSafeMode(room, hostiles) {
    var _a;
    const controller = room.controller;
    if (!(controller === null || controller === void 0 ? void 0 : controller.my))
        return;
    if (controller.safeMode)
        return;
    if (!controller.safeModeAvailable)
        return;
    const attackers = hostiles.filter((c) => c.body.some((p) => p.type === ATTACK || p.type === RANGED_ATTACK || p.type === WORK));
    if (attackers.length === 0)
        return;
    const lastCharge = controller.safeModeAvailable <= SAFEMODE_LOW_CHARGE;
    const severity = getThreatSeverity(room);
    const incomingDps = structureDamagePerTick(attackers);
    const lethalDps = incomingDps >= SAFEMODE_LETHAL_DPS;
    const trivialThreat = (severity === "low" || severity === "medium") && !lethalDps;
    const conserve = lastCharge && trivialThreat;
    const breaching = isBreachingForce(room, attackers, severity);
    const forceThatCanFinish = breaching || lethalDps;
    for (const spawn of room.find(FIND_MY_SPAWNS)) {
        if (spawn.hits < spawn.hitsMax * SAFEMODE_SPAWN_HP_RATIO) {
            if (conserve)
                break;
            activateSafeMode(room, controller, `spawn at ${pct(spawn)}% HP`);
            return;
        }
    }
    if (!conserve && forceThatCanFinish) {
        for (const spawn of room.find(FIND_MY_SPAWNS)) {
            if (spawn.hits >= spawn.hitsMax * SAFEMODE_SPAWN_PREDICT_HP_RATIO)
                continue;
            const ticksToDie = ticksUntilDestroyed(room, spawn);
            if (ticksToDie !== undefined && ticksToDie <= SAFEMODE_SPAWN_PREDICT_TICKS) {
                activateSafeMode(room, controller, `spawn at ${pct(spawn)}% HP, projected loss in ~${ticksToDie} ticks`);
                return;
            }
        }
    }
    const towerIds = (_a = room.memory.towerIds) !== null && _a !== void 0 ? _a : [];
    if (forceThatCanFinish && !conserve) {
        for (const id of towerIds) {
            const tower = Game.getObjectById(id);
            if (tower && tower.hits < tower.hitsMax * SAFEMODE_TOWER_HP_RATIO) {
                activateSafeMode(room, controller, `tower at ${pct(tower)}% HP under breaching force`);
                return;
            }
        }
    }
    const hasDismantlers = attackers.some((c) => c.body.some((p) => p.type === WORK));
    if (hasDismantlers && !conserve) {
        if (room.storage && room.storage.hits < room.storage.hitsMax * SAFEMODE_STORAGE_HP_RATIO) {
            activateSafeMode(room, controller, `storage at ${pct(room.storage)}% HP`);
            return;
        }
        if (room.terminal && room.terminal.hits < room.terminal.hitsMax * SAFEMODE_TERMINAL_HP_RATIO) {
            activateSafeMode(room, controller, `terminal at ${pct(room.terminal)}% HP`);
            return;
        }
    }
    const myFighters = room.find(FIND_MY_CREEPS, {
        filter: (c) => c.body.some((p) => p.type === ATTACK || p.type === RANGED_ATTACK),
    });
    const overwhelmed = attackers.length >= SAFEMODE_OVERWHELMED_COUNT && myFighters.length * 2 < attackers.length;
    if (towerIds.length > 0 && !conserve) {
        const allTowersDrained = towerIds.every((id) => {
            const t = Game.getObjectById(id);
            return !t || t.store[RESOURCE_ENERGY] < SAFEMODE_MIN_TOWER_ENERGY;
        });
        if (allTowersDrained && overwhelmed) {
            activateSafeMode(room, controller, "towers drained, defenders overwhelmed");
            return;
        }
    }
    if (overwhelmed && towerIds.length === 0 && !conserve) {
        activateSafeMode(room, controller, `overwhelmed by ${attackers.length} attackers, no towers`);
    }
}
function isBreachingForce(room, attackers, severity) {
    if (severity === "high")
        return true;
    let breachParts = 0;
    for (const c of attackers) {
        for (const p of c.body) {
            if (p.hits <= 0)
                continue;
            if (p.type === ATTACK || p.type === WORK)
                breachParts++;
        }
    }
    return breachParts >= 10 && attackers.length >= SAFEMODE_OVERWHELMED_COUNT;
}
function ticksUntilDestroyed(room, target) {
    const { hostiles } = getThreatInfo(room);
    if (hostiles.length === 0)
        return undefined;
    const dps = structureDamagePerTick(hostiles);
    if (dps <= 0)
        return undefined;
    return Math.ceil(target.hits / dps);
}
function activateSafeMode(room, controller, reason) {
    const result = controller.activateSafeMode();
    if (result === OK) {
        const msg = `[SafeMode] Activated in ${room.name} - ${reason}`;
        console.log(msg);
        Game.notify(msg, 30);
    }
}
function pct(s) {
    return Math.floor((s.hits / s.hitsMax) * 100);
}
function notifyOnHostiles(room, hostiles) {
    var _a;
    if (hostiles.length === 0)
        return;
    if (!Memory.threatNotifyLastTick)
        Memory.threatNotifyLastTick = {};
    const last = (_a = Memory.threatNotifyLastTick[room.name]) !== null && _a !== void 0 ? _a : 0;
    if (Game.time - last < THREAT_NOTIFY_COOLDOWN)
        return;
    const message = `[Threat] ${room.name}: ${hostiles.length} hostile creeps at tick ${Game.time}`;
    console.log(message);
    Game.notify(message, 30);
    Memory.threatNotifyLastTick[room.name] = Game.time;
}

const NUKE_IMPACT_DAMAGE = 10000000;
const NUKE_SPLASH_DAMAGE = 5000000;
const REINFORCE_BUFFER_BASE = 600000;
const REINFORCE_BUFFER_PER_OVERLAP = 400000;
const TOWER_REPAIR_EFFICIENCY = 0.5;
const EVAC_DECISION_WINDOW = 5000;
const EVAC_SAFETY_TICKS = 50;
const EVAC_MIN_SEND = 100;
const CRITICAL_TYPES = new Set([
    STRUCTURE_SPAWN,
    STRUCTURE_STORAGE,
    STRUCTURE_TERMINAL,
    STRUCTURE_TOWER,
    STRUCTURE_NUKER,
    STRUCTURE_POWER_SPAWN,
    STRUCTURE_FACTORY,
    STRUCTURE_LAB,
]);
function loop$4() {
    var _a;
    for (const roomName in Game.rooms) {
        const room = Game.rooms[roomName];
        if (!((_a = room.controller) === null || _a === void 0 ? void 0 : _a.my))
            continue;
        const nukes = room.find(FIND_NUKES);
        if (nukes.length === 0) {
            if (room.memory.nukeDefense)
                delete room.memory.nukeDefense;
            if (room.memory.nukeAlert)
                delete room.memory.nukeAlert;
            continue;
        }
        notify(room, nukes);
        reinforce(room, nukes);
    }
}
function notify(room, nukes) {
    const earliest = nukes.reduce((min, n) => Math.min(min, n.timeToLand), Infinity);
    const land = Game.time + earliest;
    const prev = room.memory.nukeAlert;
    if (prev && prev.count === nukes.length && prev.land === land)
        return;
    room.memory.nukeAlert = { count: nukes.length, land };
    const msg = `[Nuke] ${room.name}: ${nukes.length} inbound - first impact in ${earliest} ticks (tick ${land})`;
    console.log(msg);
    Game.notify(msg, 60);
    const count = nukes.length === 1 ? "A nuke falls" : `${nukes.length} nukes fall`;
    chronicle(`Doom from the sky! ${count} toward ${castleName(room.name)}, landing in ${earliest} ticks.`);
}
function reinforce(room, nukes) {
    const critical = room.find(FIND_MY_STRUCTURES, {
        filter: (s) => CRITICAL_TYPES.has(s.structureType),
    });
    const tiles = {};
    for (const s of critical) {
        let damage = 0;
        let overlap = 0;
        for (const n of nukes) {
            const range = s.pos.getRangeTo(n.pos);
            if (range === 0) {
                damage += NUKE_IMPACT_DAMAGE;
                overlap++;
            }
            else if (range <= 2) {
                damage += NUKE_SPLASH_DAMAGE;
                overlap++;
            }
        }
        if (damage === 0)
            continue;
        const buffer = REINFORCE_BUFFER_BASE + Math.max(0, overlap - 1) * REINFORCE_BUFFER_PER_OVERLAP;
        tiles[`${s.pos.x},${s.pos.y}`] = damage + buffer;
        const hasRampart = s.pos
            .lookFor(LOOK_STRUCTURES)
            .some((st) => st.structureType === STRUCTURE_RAMPART);
        const rampartQueued = s.pos
            .lookFor(LOOK_CONSTRUCTION_SITES)
            .some((cs) => cs.structureType === STRUCTURE_RAMPART);
        if (!hasRampart && !rampartQueued) {
            room.createConstructionSite(s.pos.x, s.pos.y, STRUCTURE_RAMPART);
        }
    }
    room.memory.nukeDefense = { tiles, updatedAt: Game.time };
    considerEvacuation(room, nukes, tiles);
}
function considerEvacuation(room, nukes, tiles) {
    const terminal = room.terminal;
    if (!terminal)
        return;
    const earliest = nukes.reduce((min, n) => Math.min(min, n.timeToLand), Infinity);
    if (!isFinite(earliest))
        return;
    if (earliest > EVAC_DECISION_WINDOW)
        return;
    const storeStructures = [];
    if (terminal)
        storeStructures.push(terminal);
    if (room.storage)
        storeStructures.push(room.storage);
    const threatensStore = storeStructures.some((s) => tiles[`${s.pos.x},${s.pos.y}`] !== undefined);
    if (!threatensStore)
        return;
    if (!canReinforceInTime(room, storeStructures, tiles, earliest))
        evacuate(room, terminal);
}
function canReinforceInTime(room, storeStructures, tiles, ticksToLand) {
    var _a, _b, _c, _d, _e;
    const rcl = (_b = (_a = room.controller) === null || _a === void 0 ? void 0 : _a.level) !== null && _b !== void 0 ? _b : 0;
    const rampartCap = (_c = RAMPART_HITS_MAX[rcl]) !== null && _c !== void 0 ? _c : 0;
    for (const s of storeStructures) {
        const required = tiles[`${s.pos.x},${s.pos.y}`];
        if (required !== undefined && required > rampartCap)
            return false;
    }
    let deficit = 0;
    for (const key in tiles) {
        const [x, y] = key.split(",").map(Number);
        const rampart = room
            .lookForAt(LOOK_STRUCTURES, x, y)
            .find((s) => s.structureType === STRUCTURE_RAMPART);
        deficit += Math.max(0, Math.min(tiles[key], rampartCap) - ((_d = rampart === null || rampart === void 0 ? void 0 : rampart.hits) !== null && _d !== void 0 ? _d : 0));
    }
    if (deficit <= 0)
        return true;
    const usableTicks = Math.max(0, ticksToLand - EVAC_SAFETY_TICKS);
    if (usableTicks === 0)
        return false;
    const towers = ((_e = room.memory.towerIds) !== null && _e !== void 0 ? _e : []).filter((id) => {
        const tower = Game.getObjectById(id);
        return tower && tower.store[RESOURCE_ENERGY] > 0;
    }).length;
    let repairerWork = 0;
    for (const c of room.find(FIND_MY_CREEPS)) {
        if (c.memory.role !== ROLE_REPAIRER)
            continue;
        repairerWork += c.getActiveBodyparts(WORK);
    }
    const repairPerTick = towers * TOWER_POWER_REPAIR * TOWER_REPAIR_EFFICIENCY + repairerWork * REPAIR_POWER;
    return repairPerTick * usableTicks >= deficit;
}
function evacuate(room, terminal) {
    var _a, _b, _c;
    if (terminal.cooldown > 0)
        return;
    const dest = nearestSafeOwnedRoom(room.name);
    if (!dest)
        return;
    const contents = Object.keys(terminal.store);
    contents.sort((a, b) => {
        var _a, _b;
        if (a === RESOURCE_ENERGY)
            return 1;
        if (b === RESOURCE_ENERGY)
            return -1;
        return ((_a = terminal.store[b]) !== null && _a !== void 0 ? _a : 0) - ((_b = terminal.store[a]) !== null && _b !== void 0 ? _b : 0);
    });
    for (const rc of contents) {
        const have = (_a = terminal.store.getUsedCapacity(rc)) !== null && _a !== void 0 ? _a : 0;
        if (have < EVAC_MIN_SEND)
            continue;
        if (rc === RESOURCE_ENERGY) {
            const dist = Game.map.getRoomLinearDistance(room.name, dest);
            const amount = Math.floor(have / (1 + (1 - Math.exp(-dist / 30))));
            if (amount < EVAC_MIN_SEND)
                continue;
            if (terminal.send(RESOURCE_ENERGY, amount, dest) === OK) {
                console.log(`[Nuke] ${room.name}: evacuated ${amount} gold -> ${dest}`);
            }
            return;
        }
        const dist = Game.map.getRoomLinearDistance(room.name, dest);
        const fee = Math.ceil(have * (1 - Math.exp(-dist / 30)));
        if (((_b = terminal.store[RESOURCE_ENERGY]) !== null && _b !== void 0 ? _b : 0) < fee) {
            const spareEnergy = (_c = terminal.store[RESOURCE_ENERGY]) !== null && _c !== void 0 ? _c : 0;
            const perUnitCost = fee / have;
            const affordable = perUnitCost > 0 ? Math.floor(spareEnergy / perUnitCost) : 0;
            if (affordable < EVAC_MIN_SEND)
                continue;
            if (terminal.send(rc, affordable, dest) === OK) {
                console.log(`[Nuke] ${room.name}: evacuated ${affordable} ${rc} -> ${dest} (partial)`);
            }
            return;
        }
        if (terminal.send(rc, have, dest) === OK) {
            console.log(`[Nuke] ${room.name}: evacuated ${have} ${rc} -> ${dest}`);
        }
        return;
    }
}
function nearestSafeOwnedRoom(from) {
    var _a;
    let best;
    let bestDist = Infinity;
    for (const name in Game.rooms) {
        if (name === from)
            continue;
        const r = Game.rooms[name];
        if (!((_a = r.controller) === null || _a === void 0 ? void 0 : _a.my) || !r.terminal)
            continue;
        if (r.find(FIND_NUKES).length > 0)
            continue;
        const dist = Game.map.getRoomLinearDistance(from, name);
        if (dist < bestDist) {
            bestDist = dist;
            best = name;
        }
    }
    return best;
}

const POWER_PRIORITY = [
    PWR_GENERATE_OPS,
    PWR_REGEN_SOURCE,
    PWR_OPERATE_SPAWN,
    PWR_OPERATE_EXTENSION,
    PWR_OPERATE_FACTORY,
    PWR_OPERATE_LAB,
    PWR_OPERATE_STORAGE,
    PWR_OPERATE_TOWER,
    PWR_OPERATE_TERMINAL,
    PWR_OPERATE_POWER,
];
const RENEW_TTL = 300;
function loop$3() {
    ensureOperatorsExist();
    for (const name in Game.powerCreeps) {
        const pc = Game.powerCreeps[name];
        autoUpgrade(pc);
        if (pc.ticksToLive === undefined) {
            trySpawn(pc);
            continue;
        }
        runOperator(pc);
    }
}
function ensureOperatorsExist() {
    var _a, _b;
    const existing = Object.values(Game.powerCreeps);
    const usedLevels = existing.reduce((sum, pc) => sum + pc.level + 1, 0);
    if (Game.gpl.level <= usedLevels)
        return;
    if (existing.some((pc) => pc.level < POWER_CREEP_MAX_LEVEL))
        return;
    const claimed = new Set();
    for (const pc of existing) {
        if (pc.memory.homeRoom)
            claimed.add(pc.memory.homeRoom);
    }
    for (const roomName in Game.rooms) {
        const room = Game.rooms[roomName];
        if (!((_a = room.controller) === null || _a === void 0 ? void 0 : _a.my) || !room.memory.powerSpawnId)
            continue;
        if (claimed.has(room.name))
            continue;
        const ps = Game.getObjectById(room.memory.powerSpawnId);
        if (!ps)
            continue;
        const name = `Operator_${room.name}_${Game.time}`;
        const res = PowerCreep.create(name, POWER_CLASS.OPERATOR);
        if (res === OK) {
            if (!Memory.powerCreeps)
                Memory.powerCreeps = {};
            Memory.powerCreeps[name] = { ...((_b = Memory.powerCreeps[name]) !== null && _b !== void 0 ? _b : {}), homeRoom: room.name };
            console.log(`[Power] Created Operator "${name}" for ${room.name}`);
        }
        return;
    }
}
function autoUpgrade(pc) {
    for (const power of POWER_PRIORITY) {
        const res = pc.upgrade(power);
        if (res === OK) {
            console.log(`[Power] Upgraded power ${power} on ${pc.name}`);
            return;
        }
        if (res === ERR_NOT_ENOUGH_RESOURCES)
            return;
    }
}
function trySpawn(pc) {
    var _a, _b;
    if (pc.spawnCooldownTime && Date.now() < pc.spawnCooldownTime)
        return;
    const home = pc.memory.homeRoom ? Game.rooms[pc.memory.homeRoom] : undefined;
    if (((_a = home === null || home === void 0 ? void 0 : home.controller) === null || _a === void 0 ? void 0 : _a.my) && home.memory.powerSpawnId) {
        const ps = Game.getObjectById(home.memory.powerSpawnId);
        if (ps && pc.spawn(ps) === OK) {
            console.log(`[Power] Spawned ${pc.name} at ${home.name}`);
            return;
        }
    }
    const claimed = new Set();
    for (const other of Object.values(Game.powerCreeps)) {
        if (other.name !== pc.name && other.memory.homeRoom)
            claimed.add(other.memory.homeRoom);
    }
    for (const roomName in Game.rooms) {
        const room = Game.rooms[roomName];
        if (!((_b = room.controller) === null || _b === void 0 ? void 0 : _b.my) || !room.memory.powerSpawnId || claimed.has(room.name))
            continue;
        const ps = Game.getObjectById(room.memory.powerSpawnId);
        if (!ps)
            continue;
        if (pc.spawn(ps) === OK) {
            pc.memory.homeRoom = room.name;
            console.log(`[Power] Spawned ${pc.name} at ${room.name}`);
            return;
        }
    }
}
function runOperator(pc) {
    var _a, _b, _c;
    const room = pc.room;
    if (!room)
        return;
    if (room.controller && !room.controller.isPowerEnabled) {
        if (pc.enableRoom(room.controller) === ERR_NOT_IN_RANGE) {
            pc.moveTo(room.controller, { reusePath: 10 });
        }
        return;
    }
    if (((_a = pc.ticksToLive) !== null && _a !== void 0 ? _a : 0) < RENEW_TTL) {
        const ps = getHomePowerSpawn(pc);
        if (ps) {
            if (pc.renew(ps) === ERR_NOT_IN_RANGE)
                pc.moveTo(ps, { reusePath: 10 });
            return;
        }
    }
    const usedPower = applyBestPower(pc, room);
    if (!usedPower &&
        hasPower(pc, PWR_GENERATE_OPS) &&
        offCooldown(pc, PWR_GENERATE_OPS) &&
        ((_b = pc.store.getUsedCapacity(RESOURCE_OPS)) !== null && _b !== void 0 ? _b : 0) < ((_c = pc.store.getCapacity(RESOURCE_OPS)) !== null && _c !== void 0 ? _c : 0)) {
        pc.usePower(PWR_GENERATE_OPS);
    }
}
function applyBestPower(pc, room) {
    var _a, _b;
    for (const power of POWER_PRIORITY) {
        if (power === PWR_GENERATE_OPS)
            continue;
        if (!hasPower(pc, power) || !offCooldown(pc, power))
            continue;
        if (!canAffordOps(pc, power))
            continue;
        const target = pickTarget(power, room);
        if (!target)
            continue;
        const range = (_a = POWER_INFO[power].range) !== null && _a !== void 0 ? _a : 3;
        if (pc.pos.getRangeTo(target) > range) {
            pc.moveTo(target, { range, reusePath: 10 });
            return false;
        }
        if (pc.usePower(power, target) === OK)
            return true;
    }
    const anchor = (_b = room.storage) !== null && _b !== void 0 ? _b : getHomePowerSpawn(pc);
    if (anchor && !pc.pos.inRangeTo(anchor, 3))
        pc.moveTo(anchor, { range: 3, reusePath: 20 });
    return false;
}
function pickTarget(power, room) {
    var _a, _b, _c, _d, _e, _f, _g;
    switch (power) {
        case PWR_REGEN_SOURCE: {
            const sources = room.find(FIND_SOURCES, {
                filter: (s) => { var _a; return !((_a = s.effects) === null || _a === void 0 ? void 0 : _a.some((e) => e.effect === PWR_REGEN_SOURCE)); },
            });
            if (sources.length === 0)
                return null;
            return sources.reduce((best, s) => (s.energy < best.energy ? s : best));
        }
        case PWR_OPERATE_EXTENSION: {
            const storage = room.storage;
            if (!storage || ((_a = storage.store[RESOURCE_ENERGY]) !== null && _a !== void 0 ? _a : 0) < 1000)
                return null;
            if (room.energyAvailable >= room.energyCapacityAvailable * 0.5)
                return null;
            return storage;
        }
        case PWR_OPERATE_SPAWN: {
            const spawn = room.find(FIND_MY_SPAWNS, {
                filter: (s) => { var _a; return !!s.spawning && !((_a = s.effects) === null || _a === void 0 ? void 0 : _a.some((e) => e.effect === PWR_OPERATE_SPAWN)); },
            })[0];
            return spawn !== null && spawn !== void 0 ? spawn : null;
        }
        case PWR_OPERATE_FACTORY: {
            const factory = room
                .find(FIND_MY_STRUCTURES, { filter: (s) => s.structureType === STRUCTURE_FACTORY })[0];
            if (!factory)
                return null;
            const active = (_b = factory.effects) === null || _b === void 0 ? void 0 : _b.some((e) => e.effect === PWR_OPERATE_FACTORY);
            return active ? null : factory;
        }
        case PWR_OPERATE_LAB: {
            const ls = room.memory.labSystem;
            if (!(ls === null || ls === void 0 ? void 0 : ls.activeCompound) || !((_c = ls.outputLabIds) === null || _c === void 0 ? void 0 : _c.length))
                return null;
            const lab = ls.outputLabIds
                .map((id) => Game.getObjectById(id))
                .find((l) => {
                var _a;
                if (!l)
                    return false;
                return !((_a = l.effects) === null || _a === void 0 ? void 0 : _a.some((e) => e.effect === PWR_OPERATE_LAB));
            });
            return lab !== null && lab !== void 0 ? lab : null;
        }
        case PWR_OPERATE_STORAGE: {
            const storage = room.storage;
            if (!storage)
                return null;
            if (storage.store.getFreeCapacity() > 50000)
                return null;
            const active = (_d = storage.effects) === null || _d === void 0 ? void 0 : _d.some((e) => e.effect === PWR_OPERATE_STORAGE);
            return active ? null : storage;
        }
        case PWR_OPERATE_TOWER: {
            const hostiles = room.find(FIND_HOSTILE_CREEPS);
            if (hostiles.length === 0)
                return null;
            const tower = room
                .find(FIND_MY_STRUCTURES, { filter: (s) => s.structureType === STRUCTURE_TOWER })
                .find((t) => { var _a; return !((_a = t.effects) === null || _a === void 0 ? void 0 : _a.some((e) => e.effect === PWR_OPERATE_TOWER)); });
            return tower !== null && tower !== void 0 ? tower : null;
        }
        case PWR_OPERATE_TERMINAL: {
            const terminal = room.terminal;
            if (!terminal)
                return null;
            if (terminal.store.getFreeCapacity() > 50000)
                return null;
            const active = (_e = terminal.effects) === null || _e === void 0 ? void 0 : _e.some((e) => e.effect === PWR_OPERATE_TERMINAL);
            return active ? null : terminal;
        }
        case PWR_OPERATE_POWER: {
            const id = room.memory.powerSpawnId;
            const ps = id ? Game.getObjectById(id) : null;
            if (!ps)
                return null;
            if (((_f = ps.store[RESOURCE_POWER]) !== null && _f !== void 0 ? _f : 0) === 0)
                return null;
            const active = (_g = ps.effects) === null || _g === void 0 ? void 0 : _g.some((e) => e.effect === PWR_OPERATE_POWER);
            return active ? null : ps;
        }
        default:
            return null;
    }
}
function hasPower(pc, power) {
    var _a, _b;
    return ((_b = (_a = pc.powers[power]) === null || _a === void 0 ? void 0 : _a.level) !== null && _b !== void 0 ? _b : 0) > 0;
}
function offCooldown(pc, power) {
    var _a, _b;
    return ((_b = (_a = pc.powers[power]) === null || _a === void 0 ? void 0 : _a.cooldown) !== null && _b !== void 0 ? _b : 0) === 0;
}
function canAffordOps(pc, power) {
    var _a, _b;
    const cost = (_a = POWER_INFO[power].ops) !== null && _a !== void 0 ? _a : 0;
    if (cost === 0)
        return true;
    return ((_b = pc.store.getUsedCapacity(RESOURCE_OPS)) !== null && _b !== void 0 ? _b : 0) >= cost;
}
function getHomePowerSpawn(pc) {
    const home = pc.memory.homeRoom ? Game.rooms[pc.memory.homeRoom] : pc.room;
    const id = home === null || home === void 0 ? void 0 : home.memory.powerSpawnId;
    return id ? Game.getObjectById(id) : null;
}

const POWER_BANK_MIN_POWER = 2000;
const POWER_BANK_MIN_TICKS = 3000;
const DEPOSIT_MAX_COOLDOWN = 100;
const DEPOSIT_MIN_TICKS = 3000;
const DEPOSIT_HARD_TIMEOUT = 20000;
const POWER_FORMING_TIMEOUT = 2000;
const CRACKING_TIMEOUT = 3000;
const COLLECTING_TIMEOUT = 300;
const SQUAD_ATTACKERS = 2;
const SQUAD_HEALERS = 3;
const OBSERVER_SCAN_RANGE = 10;
const SCORE_SCAN_RANGE = 5;
const HIGHWAY_SCAN_EVERY = 5;
const SCORE_SCAN_REBUILD_INTERVAL = 1500;
const POWER_PROCESS_ENERGY_FLOOR = 100000;
const POWER_OP_MIN_RCL = 8;
const POWER_ATTACKER_ATTACK_PARTS = 25;
const TICKS_PER_ROOM = 50;
const SQUAD_SPAWN_TICKS = (SQUAD_ATTACKERS + SQUAD_HEALERS) * 50 * 3;
const POWER_OP_TICK_MARGIN = 300;
function loop$2() {
    var _a;
    const owned = [];
    for (const roomName in Game.rooms) {
        const room = Game.rooms[roomName];
        if (!((_a = room.controller) === null || _a === void 0 ? void 0 : _a.my))
            continue;
        owned.push(roomName);
        runObserver(room);
        runPowerSpawn(room);
    }
    scanVisibleHighwayRooms(owned);
    updatePowerOps();
    updateDepositOps();
}
function runObserver(room) {
    if (!room.memory.observerId)
        return;
    const observer = Game.getObjectById(room.memory.observerId);
    if (!observer) {
        room.memory.observerId = undefined;
        return;
    }
    if (scoreHunterSupported() && Game.time % HIGHWAY_SCAN_EVERY !== 0) {
        if (scanScoreRegion(room, observer))
            return;
    }
    scanHighways(room, observer);
}
function scanScoreRegion(room, observer) {
    let queue = room.memory.scoreScanQueue;
    if (!queue || queue.length === 0 || Game.time % SCORE_SCAN_REBUILD_INTERVAL === 0) {
        queue = room.memory.scoreScanQueue = getScoreScanRooms(room.name, SCORE_SCAN_RANGE);
        if (queue.length === 0)
            return false;
    }
    const target = queue.shift();
    queue.push(target);
    observer.observeRoom(target);
    return true;
}
function scanHighways(room, observer) {
    if (!room.memory.observerScanQueue || room.memory.observerScanQueue.length === 0) {
        room.memory.observerScanQueue = buildHighwayScanQueue(room.name);
        if (room.memory.observerScanQueue.length === 0)
            return;
    }
    const queue = room.memory.observerScanQueue;
    const target = queue.shift();
    queue.push(target);
    observer.observeRoom(target);
}
function scanVisibleHighwayRooms(ownedRoomNames) {
    if (ownedRoomNames.length === 0)
        return;
    for (const roomName in Game.rooms) {
        if (!isHighwayRoom(roomName))
            continue;
        if (!ownedRoomNames.some((home) => Game.map.getRoomLinearDistance(home, roomName) <= OBSERVER_SCAN_RANGE)) {
            continue;
        }
        checkForPowerBanks(roomName);
        checkForDeposits(roomName);
    }
}
function checkForPowerBanks(roomName) {
    var _a;
    const room = Game.rooms[roomName];
    if (!room)
        return;
    const existing = ((_a = Memory.powerOps) !== null && _a !== void 0 ? _a : []).find((op) => op.roomName === roomName && op.phase !== "done");
    if (existing)
        return;
    const banks = room.find(FIND_STRUCTURES, {
        filter: (s) => s.structureType === STRUCTURE_POWER_BANK,
    });
    if (banks.length === 0)
        return;
    const bank = banks[0];
    if (bank.power < POWER_BANK_MIN_POWER)
        return;
    if (bank.ticksToDecay < POWER_BANK_MIN_TICKS)
        return;
    const homeRooms = Object.values(Game.rooms).filter((r) => { var _a; return ((_a = r.controller) === null || _a === void 0 ? void 0 : _a.my) && r.controller.level >= POWER_OP_MIN_RCL; });
    if (homeRooms.length === 0)
        return;
    const homeRoom = homeRooms.reduce((best, r) => {
        const d = Game.map.getRoomLinearDistance(r.name, roomName);
        const bd = Game.map.getRoomLinearDistance(best.name, roomName);
        return d < bd ? r : best;
    });
    const distance = Game.map.getRoomLinearDistance(homeRoom.name, roomName);
    if (bank.ticksToDecay < powerOpTicksNeeded(bank.hits, distance))
        return;
    if (!Memory.powerOps)
        Memory.powerOps = [];
    if (!Memory.nextPowerOpId)
        Memory.nextPowerOpId = 1;
    const carriers = Math.min(6, Math.ceil(bank.power / 1250));
    const op = {
        id: Memory.nextPowerOpId++,
        bankId: bank.id,
        roomName,
        homeRoom: homeRoom.name,
        power: bank.power,
        phase: "forming",
        startedAt: Game.time,
        requiredAttackers: SQUAD_ATTACKERS,
        requiredHealers: SQUAD_HEALERS,
        requiredCarriers: carriers,
    };
    Memory.powerOps.push(op);
    console.log(`[Observer] Power bank in ${roomName}: ${bank.power} power, ${bank.ticksToDecay} ticks. ` +
        `Op #${op.id} - ${SQUAD_ATTACKERS}A/${SQUAD_HEALERS}H/${carriers}C from ${homeRoom.name}`);
}
function powerOpTicksNeeded(bankHits, distance) {
    const damagePerTick = SQUAD_ATTACKERS * POWER_ATTACKER_ATTACK_PARTS * ATTACK_POWER;
    const crackTicks = Math.ceil(bankHits / damagePerTick);
    return SQUAD_SPAWN_TICKS + distance * TICKS_PER_ROOM + crackTicks + POWER_OP_TICK_MARGIN;
}
function updatePowerOps() {
    var _a;
    if (!((_a = Memory.powerOps) === null || _a === void 0 ? void 0 : _a.length))
        return;
    for (const op of Memory.powerOps) {
        if (op.phase !== "done")
            updatePowerOp(op);
    }
    Memory.powerOps = Memory.powerOps.filter((op) => op.phase !== "done");
}
function updatePowerOp(op) {
    var _a, _b;
    const members = getPowerSquadMembers(op.id);
    switch (op.phase) {
        case "forming": {
            if (Game.time - op.startedAt > POWER_FORMING_TIMEOUT) {
                console.log(`[Power] Op #${op.id} timed out forming (${op.roomName}) - aborting`);
                disbandSquad(op.id);
                op.phase = "done";
                return;
            }
            if (op.bankId && Game.rooms[op.roomName]) {
                const bank = Game.getObjectById(op.bankId);
                if (!bank) {
                    op.phase = "done";
                    return;
                }
            }
            const attackers = members.filter((c) => c.memory.role === ROLE_POWER_ATTACKER).length;
            const healers = members.filter((c) => c.memory.role === ROLE_POWER_HEALER).length;
            const carriers = members.filter((c) => c.memory.role === ROLE_POWER_CARRIER).length;
            if (attackers >= op.requiredAttackers &&
                healers >= op.requiredHealers &&
                carriers >= op.requiredCarriers) {
                op.phase = "cracking";
                op.crackingStartedAt = Game.time;
                console.log(`[Power] Op #${op.id} squad formed - cracking ${op.roomName}`);
            }
            break;
        }
        case "cracking": {
            if (members.length === 0) {
                console.log(`[Power] Op #${op.id} all members lost - aborting`);
                op.phase = "done";
                return;
            }
            if (Game.time - ((_a = op.crackingStartedAt) !== null && _a !== void 0 ? _a : op.startedAt) > CRACKING_TIMEOUT) {
                console.log(`[Power] Op #${op.id} cracking timed out (${op.roomName}) - aborting`);
                disbandSquad(op.id);
                op.phase = "done";
                return;
            }
            if (Game.rooms[op.roomName]) {
                const bank = op.bankId ? Game.getObjectById(op.bankId) : null;
                if (!bank) {
                    op.phase = "collecting";
                    op.collectingStartedAt = Game.time;
                    console.log(`[Power] Op #${op.id} bank cracked - collecting`);
                }
            }
            break;
        }
        case "collecting": {
            const bankRoom = Game.rooms[op.roomName];
            let powerStillVisible = false;
            if (bankRoom) {
                const groundPower = bankRoom
                    .find(FIND_DROPPED_RESOURCES, { filter: (r) => r.resourceType === RESOURCE_POWER })
                    .reduce((sum, r) => sum + r.amount, 0) +
                    bankRoom
                        .find(FIND_RUINS)
                        .reduce((sum, r) => { var _a; return sum + ((_a = r.store.getUsedCapacity(RESOURCE_POWER)) !== null && _a !== void 0 ? _a : 0); }, 0);
                powerStillVisible = groundPower > 0;
                if (groundPower === 0)
                    op.collected = true;
            }
            const stillCarrying = members.some((c) => { var _a; return ((_a = c.store.getUsedCapacity(RESOURCE_POWER)) !== null && _a !== void 0 ? _a : 0) > 0; });
            if (stillCarrying || powerStillVisible)
                op.collectingStartedAt = Game.time;
            if (Game.time - ((_b = op.collectingStartedAt) !== null && _b !== void 0 ? _b : Game.time) > COLLECTING_TIMEOUT) {
                console.log(`[Power] Op #${op.id} collection timed out`);
                op.phase = "done";
                return;
            }
            if (op.collected && !stillCarrying) {
                console.log(`[Power] Op #${op.id} collection complete`);
                op.phase = "done";
            }
            break;
        }
    }
}
function disbandSquad(opId) {
    for (const name in Game.creeps) {
        const c = Game.creeps[name];
        if (c.memory.powerOpId === opId)
            delete c.memory.powerOpId;
    }
}
function getPowerSquadMembers(opId) {
    const result = [];
    for (const name in Game.creeps) {
        const c = Game.creeps[name];
        if (c.memory.powerOpId === opId)
            result.push(c);
    }
    return result;
}
function checkForDeposits(roomName) {
    var _a;
    const room = Game.rooms[roomName];
    if (!room)
        return;
    const existing = ((_a = Memory.depositOps) !== null && _a !== void 0 ? _a : []).find((op) => op.roomName === roomName && op.phase !== "done");
    if (existing)
        return;
    const deposits = room.find(FIND_DEPOSITS);
    if (deposits.length === 0)
        return;
    const deposit = deposits.reduce((best, d) => (d.lastCooldown < best.lastCooldown ? d : best));
    if (deposit.lastCooldown > DEPOSIT_MAX_COOLDOWN)
        return;
    if (deposit.ticksToDecay < DEPOSIT_MIN_TICKS)
        return;
    const ownedRooms = Object.values(Game.rooms).filter((r) => { var _a; return (_a = r.controller) === null || _a === void 0 ? void 0 : _a.my; });
    if (ownedRooms.length === 0)
        return;
    const homeRoom = ownedRooms.reduce((best, r) => {
        const d = Game.map.getRoomLinearDistance(r.name, roomName);
        const bd = Game.map.getRoomLinearDistance(best.name, roomName);
        return d < bd ? r : best;
    });
    if (!Memory.depositOps)
        Memory.depositOps = [];
    if (!Memory.nextDepositOpId)
        Memory.nextDepositOpId = 1;
    const distance = Game.map.getRoomLinearDistance(homeRoom.name, roomName);
    const haulers = distance >= 4 ? 2 : 1;
    const op = {
        id: Memory.nextDepositOpId++,
        depositId: deposit.id,
        roomName,
        homeRoom: homeRoom.name,
        depositType: deposit.depositType,
        phase: "mining",
        startedAt: Game.time,
        lastCooldown: deposit.lastCooldown,
        requiredMiners: 1,
        requiredHaulers: haulers,
    };
    Memory.depositOps.push(op);
    console.log(`[Observer] Deposit (${deposit.depositType}) in ${roomName}: cooldown ${deposit.lastCooldown}, ` +
        `${deposit.ticksToDecay} ticks. Op #${op.id} - 1 miner/${haulers} haulers from ${homeRoom.name}`);
}
function updateDepositOps() {
    var _a;
    if (!((_a = Memory.depositOps) === null || _a === void 0 ? void 0 : _a.length))
        return;
    for (const op of Memory.depositOps) {
        if (op.phase !== "done")
            updateDepositOp(op);
    }
    Memory.depositOps = Memory.depositOps.filter((op) => op.phase !== "done");
}
function updateDepositOp(op) {
    if (Game.time - op.startedAt > DEPOSIT_HARD_TIMEOUT) {
        console.log(`[Deposit] Op #${op.id} hard-timed-out (${op.roomName}) - ending`);
        endDepositOp(op);
        return;
    }
    if (Game.rooms[op.roomName]) {
        const deposit = op.depositId ? Game.getObjectById(op.depositId) : null;
        if (!deposit) {
            console.log(`[Deposit] Op #${op.id} deposit gone (${op.roomName}) - ending`);
            endDepositOp(op);
            return;
        }
        op.lastCooldown = deposit.lastCooldown;
        if (deposit.lastCooldown > DEPOSIT_MAX_COOLDOWN || deposit.ticksToDecay < DEPOSIT_MIN_TICKS) {
            console.log(`[Deposit] Op #${op.id} exhausted (${op.roomName}, cooldown ${deposit.lastCooldown}) - ending`);
            endDepositOp(op);
        }
    }
}
function endDepositOp(op) {
    op.phase = "done";
}
function runPowerSpawn(room) {
    var _a, _b;
    if (!room.memory.powerSpawnId)
        return;
    const ps = Game.getObjectById(room.memory.powerSpawnId);
    if (!ps) {
        room.memory.powerSpawnId = undefined;
        return;
    }
    if (ps.power === 0)
        return;
    if (ps.store[RESOURCE_ENERGY] < 50)
        return;
    const storedEnergy = (_b = (_a = room.storage) === null || _a === void 0 ? void 0 : _a.store[RESOURCE_ENERGY]) !== null && _b !== void 0 ? _b : 0;
    if (storedEnergy < POWER_PROCESS_ENERGY_FLOOR)
        return;
    ps.processPower();
}
function buildHighwayScanQueue(homeRoomName) {
    const result = [];
    for (let dx = -12; dx <= 12; dx++) {
        for (let dy = -12; dy <= 12; dy++) {
            const roomName = offsetRoom(homeRoomName, dx, dy);
            if (!roomName || roomName === homeRoomName)
                continue;
            if (!isHighwayRoom(roomName))
                continue;
            if (Game.map.getRoomLinearDistance(homeRoomName, roomName) > OBSERVER_SCAN_RANGE)
                continue;
            result.push(roomName);
        }
    }
    for (let i = result.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
}
function offsetRoom(roomName, dx, dy) {
    const m = roomName.match(/^([WE])(\d+)([NS])(\d+)$/);
    if (!m)
        return null;
    let wx = m[1] === "E" ? parseInt(m[2], 10) : -(parseInt(m[2], 10) + 1);
    let wy = m[3] === "S" ? parseInt(m[4], 10) : -(parseInt(m[4], 10) + 1);
    wx += dx;
    wy += dy;
    const newEw = wx >= 0 ? "E" : "W";
    const newNs = wy >= 0 ? "S" : "N";
    return `${newEw}${wx >= 0 ? wx : -(wx + 1)}${newNs}${wy >= 0 ? wy : -(wy + 1)}`;
}
function isHighwayRoom(roomName) {
    const m = roomName.match(/^[WE](\d+)[NS](\d+)$/);
    if (!m)
        return false;
    return parseInt(m[1], 10) % 10 === 0 || parseInt(m[2], 10) % 10 === 0;
}

const PHASE_LABEL = {
    bootstrap: "Bootstrap",
    developing: "Developing",
    established: "Established",
    powerhouse: "Powerhouse",
};
function loop$1() {
    var _a;
    for (const roomName in Game.rooms) {
        const room = Game.rooms[roomName];
        drawGraves(room);
        if (!((_a = room.controller) === null || _a === void 0 ? void 0 : _a.my))
            continue;
        drawRoomHUD(room);
        drawChronicle(room);
        drawSeason(room);
        drawLandmarks(room);
        drawSky(room);
        drawCamp(room);
        drawTown(room);
        drawDragon(room);
        drawBlueprint(room);
    }
    drawRealmMap();
}
const GRAVE_STONE = { color: "#c8c0b0", width: 0.08, opacity: 0.8 };
const GRAVE_LABEL = { font: 0.35, color: "#b8a88a", stroke: "#000000", strokeWidth: 0.05, opacity: 0.8 };
function drawGraves(room) {
    const tombs = room.find(FIND_TOMBSTONES, { filter: (t) => t.creep.my });
    for (const t of tombs) {
        const { x, y } = t.pos;
        room.visual.line(x, y - 0.4, x, y + 0.3, GRAVE_STONE);
        room.visual.line(x - 0.2, y - 0.2, x + 0.2, y - 0.2, GRAVE_STONE);
        room.visual.text(t.creep.name, x, y - 0.55, GRAVE_LABEL);
    }
}
const MAP_GOLD = "#f2c14e";
const MAP_DANGER = "#e05a5a";
const MAP_KEEP = "#b06bff";
function drawRealmMap() {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
    var _l;
    const mv = Game.map.visual;
    const worked = {};
    for (const name in Game.creeps) {
        const c = Game.creeps[name];
        if (c.memory.role !== ROLE_REMOTE_MINER || !c.memory.homeRoom || !c.memory.targetRoom)
            continue;
        ((_a = worked[_l = c.memory.homeRoom]) !== null && _a !== void 0 ? _a : (worked[_l] = new Set())).add(c.memory.targetRoom);
    }
    for (const roomName in Game.rooms) {
        const room = Game.rooms[roomName];
        if (!((_b = room.controller) === null || _b === void 0 ? void 0 : _b.my))
            continue;
        const centre = new RoomPosition(25, 25, roomName);
        mv.text(castleName(roomName), new RoomPosition(25, 6, roomName), {
            color: MAP_GOLD,
            fontSize: 6,
            stroke: "#000000",
            strokeWidth: 0.6,
        });
        drawArms((points, style) => mv.poly(points.map(([x, y]) => new RoomPosition(Math.round(x), Math.round(y), roomName)), style), roomName, 25, 16, 4);
        const gold = room.storage ? ` · ${formatK(room.storage.store[RESOURCE_ENERGY])} gold` : "";
        mv.text(`RCL ${room.controller.level}${gold}`, new RoomPosition(25, 45, roomName), { color: "#e8e8e8", fontSize: 4 });
        for (const remote of (_c = room.memory.remoteRooms) !== null && _c !== void 0 ? _c : []) {
            if ((_e = (_d = Game.rooms[remote.roomName]) === null || _d === void 0 ? void 0 : _d.controller) === null || _e === void 0 ? void 0 : _e.my)
                continue;
            const ours = (_g = (_f = worked[roomName]) === null || _f === void 0 ? void 0 : _f.has(remote.roomName)) !== null && _g !== void 0 ? _g : false;
            const held = remote.hostile && ((_h = remote.hostileUntil) !== null && _h !== void 0 ? _h : 0) > Game.time;
            if (!ours && !held)
                continue;
            const raided = held || ((_j = remote.invaderUntil) !== null && _j !== void 0 ? _j : 0) > Game.time;
            const colour = raided ? MAP_DANGER : MAP_GOLD;
            if (ours) {
                mv.line(centre, new RoomPosition(25, 25, remote.roomName), { color: colour, width: 1, opacity: 0.6, lineStyle: "dashed" });
            }
            const label = held ? `held by ${(_k = remote.rival) !== null && _k !== void 0 ? _k : "strangers"}` : raided ? "raided" : "vendors";
            mv.text(wildsName(remote.roomName), new RoomPosition(25, 34, remote.roomName), { color: "#e8e8e8", fontSize: 4 });
            mv.text(label, new RoomPosition(25, 40, remote.roomName), { color: colour, fontSize: 4 });
        }
    }
    const exp = Memory.expansion;
    const savings = Memory.expansionSavings;
    const keep = exp && exp.phase !== "established"
        ? { from: exp.homeRoom, at: exp.roomName, label: `keep: ${keepProgress(exp)}` }
        : savings
            ? { from: savings.room, at: savings.target, label: "keep planned" }
            : undefined;
    if (keep) {
        const at = new RoomPosition(25, 25, keep.at);
        if (keep.from)
            mv.line(new RoomPosition(25, 25, keep.from), at, { color: MAP_KEEP, width: 1.5, opacity: 0.7, lineStyle: "dotted" });
        mv.circle(at, { radius: 8, fill: "transparent", stroke: MAP_KEEP, strokeWidth: 1, opacity: 0.8 });
        mv.text(keep.label, new RoomPosition(25, 12, keep.at), { color: MAP_KEEP, fontSize: 5 });
    }
}
function keepProgress(exp) {
    var _a;
    const room = Game.rooms[exp.roomName];
    if (exp.phase === "claiming" || !((_a = room === null || room === void 0 ? void 0 : room.controller) === null || _a === void 0 ? void 0 : _a.my))
        return "claiming";
    if (room.find(FIND_MY_SPAWNS).length > 0)
        return `growing, RCL ${room.controller.level}`;
    const site = room.find(FIND_MY_CONSTRUCTION_SITES).find((s) => s.structureType === STRUCTURE_SPAWN);
    if (!site)
        return "pilgrims at work";
    return `barracks ${Math.floor((site.progress * 100) / site.progressTotal)}%`;
}
const blueprintShownUntil = {};
const BLUEPRINT_PREVIEW_TICKS = 50;
function showBlueprint(roomName) {
    blueprintShownUntil[roomName] = Game.time + BLUEPRINT_PREVIEW_TICKS;
}
const AGE_COLOURS = ["", "#f5e6a8", "#f2c14e", "#f08a4b", "#e05a5a", "#5ab4e0", "#4fc49a", "#6b8cff", "#b06bff"];
const BLUEPRINT_LETTERS = {
    spawn: "S", extension: "e", tower: "T", lab: "L", storage: "O", terminal: "M",
    factory: "F", observer: "B", powerSpawn: "P", nuker: "N", link: "K", container: "C", extractor: "X",
};
function drawBlueprint(room) {
    var _a, _b, _c, _d;
    const until = blueprintShownUntil[room.name];
    if (until === undefined)
        return;
    if (Game.time > until) {
        delete blueprintShownUntil[room.name];
        return;
    }
    const bp = readBlueprint(room);
    if (!bp)
        return;
    const v = room.visual;
    for (const side of (_b = (_a = room.memory.blueprint) === null || _a === void 0 ? void 0 : _a.lanes) !== null && _b !== void 0 ? _b : []) {
        for (const p of (_c = bp.exits[side]) !== null && _c !== void 0 ? _c : [])
            v.circle(p.x, p.y, { radius: 0.12, fill: "#cccccc", opacity: 0.5 });
    }
    for (const e of bp.entries) {
        const colour = AGE_COLOURS[e.rcl];
        if (e.type === STRUCTURE_ROAD) {
            v.circle(e.x, e.y, { radius: 0.15, fill: colour, opacity: 0.6 });
            continue;
        }
        v.rect(e.x - 0.4, e.y - 0.4, 0.8, 0.8, { fill: "transparent", stroke: colour, strokeWidth: 0.06, opacity: 0.8 });
        v.text(`${(_d = BLUEPRINT_LETTERS[e.type]) !== null && _d !== void 0 ? _d : "?"}${e.rcl}`, e.x, e.y + 0.15, { font: 0.35, color: colour });
    }
}
function drawRoomHUD(room) {
    var _a, _b;
    const v = room.visual;
    const rcl = room.controller.level;
    const progress = room.controller.progress;
    const total = room.controller.progressTotal;
    const phase = getRoomPhase(rcl);
    const x = 0.5;
    let y = 0.8;
    const lineH = 0.85;
    const style = { font: 0.55, align: "left", color: "#e8e8e8", stroke: "#000000", strokeWidth: 0.08 };
    const dimStyle = { ...style, color: "#aaaaaa" };
    const warnStyle = { ...style, color: "#ff6644" };
    v.text(`${castleName(room.name)}  ·  RCL ${rcl}  ${PHASE_LABEL[phase]}`, x, y, { ...style, font: 0.6, color: "#ffffff" });
    y += lineH;
    if (rcl < 8 && total > 0) {
        const pct = progress / total;
        const barW = 6;
        v.rect(x, y - 0.6, barW, 0.55, { fill: "#333333", opacity: 0.7, stroke: "#555555", strokeWidth: 0.05 });
        v.rect(x, y - 0.6, barW * pct, 0.55, { fill: "#44aaff", opacity: 0.85, stroke: "transparent" });
        v.text(`${(pct * 100).toFixed(1)}%`, x + barW / 2, y, { ...style, align: "center", color: "#ffffff" });
        y += lineH;
    }
    const energy = room.energyAvailable;
    const energyCap = room.energyCapacityAvailable;
    const energyPct = energyCap > 0 ? energy / energyCap : 0;
    const energyColor = energyPct < 0.3 ? "#ff6644" : energyPct < 0.6 ? "#ffcc44" : "#88ff88";
    if (energyCap > 0)
        v.text(`Gold: ${energy}/${energyCap}`, x, y, { ...style, color: energyColor });
    else
        v.text("Gold: no barracks yet", x, y, dimStyle);
    y += lineH;
    const books = (_a = Memory.exchequer) === null || _a === void 0 ? void 0 : _a[room.name];
    if (room.storage) {
        const stored = room.storage.store[RESOURCE_ENERGY];
        const trend = books === null || books === void 0 ? void 0 : books.trend;
        const trendText = trend === undefined ? "" : `  (${trend >= 0 ? "+" : ""}${trend.toFixed(1)}/t)`;
        v.text(`Treasury: ${formatK(stored)}${trendText}`, x, y, dimStyle);
        y += lineH;
        const keep = describeKeepPlan(room, stored);
        if (keep) {
            v.text(keep, x, y, { ...style, color: "#f2c14e" });
            y += lineH;
        }
    }
    if (books) {
        const [headline, income, spend] = describeBooks(books);
        v.text(headline, x, y, { ...style, color: "#f2c14e" });
        y += lineH;
        v.text(income.trim(), x + 0.4, y, { ...dimStyle, font: 0.45 });
        y += lineH * 0.8;
        v.text(spend.trim(), x + 0.4, y, { ...dimStyle, font: 0.45 });
        y += lineH;
    }
    const counts = countCreepsByRole(room);
    const [atHome, abroad] = describeCensus(room);
    if (atHome) {
        v.text(atHome, x, y, dimStyle);
        y += lineH;
    }
    if (abroad) {
        v.text(`Abroad: ${abroad}`, x, y, dimStyle);
        y += lineH;
    }
    const hostiles = room.find(FIND_HOSTILE_CREEPS);
    if (hostiles.length > 0) {
        v.text(`RAIDERS: ${hostiles.length} about the castle`, x, y, warnStyle);
        y += lineH;
    }
    const clock = townClock(Game.time);
    const icon = PHASE_ICON[clock.phase];
    const folk = (_b = counts[ROLE_TOWNSFOLK]) !== null && _b !== void 0 ? _b : 0;
    const hh = String(clock.hour).padStart(2, "0");
    const timeOfDay = clock.phase[0].toUpperCase() + clock.phase.slice(1);
    const season = townSeason(Game.time);
    const feast = townFeast(Game.time);
    const storm = townStorm(Game.time) ? ", storm" : "";
    const moon = isNightfall(clock.phase) ? `, ${TOWN_MOON_NAMES[townMoon(Game.time)]}` : "";
    const aurora = townAurora(Game.time) ? ", northern lights" : "";
    const when = `${timeOfDay}, ${hh}:00 in ${season}${feast ? `, ${feast}` : ""}${storm}${moon}${aurora}`;
    const people = folk > 0 ? `  ·  ${folk} townsfolk` : "";
    v.text(`${icon} ${when}${people}`, x, y, { ...style, color: "#ffe9a8" });
    y += lineH;
    const spawn = room.memory.spawnId ? Game.getObjectById(room.memory.spawnId) : null;
    if (spawn === null || spawn === void 0 ? void 0 : spawn.spawning) {
        const remaining = spawn.spawning.remainingTime;
        v.text(`Mustering: ${spawn.spawning.name} (${remaining}t)`, x, y, dimStyle);
    }
}
function describeKeepPlan(room, stored) {
    const exp = Memory.expansion;
    if ((exp === null || exp === void 0 ? void 0 : exp.homeRoom) === room.name && exp.phase !== "established") {
        return `Founding ${castleName(exp.roomName)} in the ${wildsName(exp.roomName)}: ${keepProgress(exp)}`;
    }
    const plan = Memory.expansionSavings;
    if ((plan === null || plan === void 0 ? void 0 : plan.room) === room.name) {
        return `Saving for a keep in the ${wildsName(plan.target)}: ${formatK(stored)}/${formatK(MIN_HOME_STORAGE_ENERGY)}`;
    }
    return undefined;
}
const CHRONICLE_LINES = 4;
function drawChronicle(room) {
    const entries = recentChronicle(CHRONICLE_LINES);
    if (entries.length === 0)
        return;
    const v = room.visual;
    const style = { font: 0.45, align: "left", stroke: "#000000", strokeWidth: 0.06 };
    let y = 48.6 - entries.length * 0.65;
    v.text("Royal Chronicle", 0.5, y - 0.15, { ...style, font: 0.5, color: "#f2c14e" });
    entries.forEach((e, i) => {
        y += 0.65;
        const fresh = i === entries.length - 1;
        v.text(`${chronicleDate(e.t)}: ${e.text}`, 0.5, y, { ...style, color: fresh ? "#ffe9a8" : "#b8a88a" });
    });
}
const PHASE_ICON = { dawn: "🌅", day: "☀", dusk: "🌇", night: "🌙" };
const NIGHT_SHADE = { dawn: 0.08, day: 0, dusk: 0.12, night: 0.22 };
const LANDMARK_LABEL = { font: 0.4, color: "#d8c8a0", stroke: "#000000", strokeWidth: 0.05, opacity: 0.75 };
function titleCase(s) {
    return s.replace(/(^|\s)\S/g, (c) => c.toUpperCase());
}
function drawLandmarks(room) {
    const v = room.visual;
    const labs = [];
    for (const s of room.find(FIND_MY_STRUCTURES)) {
        if (s.structureType === STRUCTURE_LAB) {
            labs.push(s.pos);
            continue;
        }
        const names = LANDMARKS[s.structureType];
        if (!names)
            continue;
        let text = titleCase(names[0]);
        if (s.structureType === STRUCTURE_STORAGE) {
            text += ` · ${formatK(s.store[RESOURCE_ENERGY])} gold`;
        }
        v.text(text, s.pos.x, s.pos.y + 0.95, LANDMARK_LABEL);
    }
    if (labs.length > 0) {
        const [one, many] = LANDMARKS[STRUCTURE_LAB];
        const x = labs.reduce((sum, p) => sum + p.x, 0) / labs.length;
        const y = Math.max(...labs.map((p) => p.y));
        v.text(titleCase(labs.length === 1 ? one : many), x, y + 0.95, LANDMARK_LABEL);
    }
    for (const site of room.find(FIND_MY_CONSTRUCTION_SITES)) {
        const names = LANDMARKS[site.structureType];
        if (names)
            drawScaffold(v, site, names[0]);
    }
    if (room.controller) {
        const { x, y } = room.controller.pos;
        v.text("Throne", x, y + 0.95, LANDMARK_LABEL);
        drawArms((points, style) => v.poly(points, style), room.name, x, y - 1.75, 0.42);
    }
}
function drawArms(poly, roomName, x, y, scale) {
    const place = (pts) => pts.map(([px, py]) => [x + px * scale, y + py * scale]);
    for (const piece of armsPieces(roomName))
        poly(place(piece.points), { fill: piece.fill, stroke: "transparent", opacity: 0.9 });
    poly(place(shieldOutline()), { fill: "transparent", stroke: "#8a6d1f", strokeWidth: 0.08 * scale, opacity: 0.9 });
}
const SCAFFOLD = { color: "#8b6b43", width: 0.06, opacity: 0.8 };
const SCAFFOLD_STONE = "#9a9080";
function drawScaffold(v, site, name) {
    const { x, y } = site.pos;
    const share = site.progress / site.progressTotal;
    v.rect(x - 0.45, y + 0.45 - 0.9 * share, 0.9, 0.9 * share, { fill: SCAFFOLD_STONE, opacity: 0.5 });
    v.rect(x - 0.45, y - 0.45, 0.9, 0.9, { fill: "transparent", stroke: SCAFFOLD.color, strokeWidth: SCAFFOLD.width, opacity: SCAFFOLD.opacity });
    v.line(x - 0.45, y - 0.45, x + 0.45, y + 0.45, SCAFFOLD);
    v.line(x + 0.45, y - 0.45, x - 0.45, y + 0.45, SCAFFOLD);
    v.text(`${titleCase(name)} rising · ${Math.floor(share * 100)}%`, x, y + 0.95, LANDMARK_LABEL);
}
const SEASON_TINT = {
    spring: "#88cc77",
    autumn: "#cc7a33",
    winter: "#aaccff",
};
const SEASON_DRIFT = {
    spring: { count: 10, colours: ["#ffb7c5", "#ffd9e0"], radius: 0.1, fall: 0.12 },
    autumn: { count: 14, colours: ["#d9822b", "#a0522d", "#c9a227"], radius: 0.13, fall: 0.18 },
    winter: { count: 30, colours: ["#ffffff"], radius: 0.08, fall: 0.25 },
};
const RAINDROPS = 40;
const RAIN_FALL = 1.4;
const LIGHTNING_EVERY = 37;
const FIREFLIES = 8;
const LANTERNS = 12;
const LANTERN_COLOURS = ["#ff6b4a", "#ffd27f", "#7fd4ff"];
function drawSeason(room, time = Game.time) {
    var _a;
    const v = room.visual;
    const season = townSeason(time);
    const fountain = (_a = room.memory.town) === null || _a === void 0 ? void 0 : _a.fountain;
    const feast = townFeast(time);
    if (feast && fountain) {
        const { x, y } = parseTile(fountain);
        const turn = Math.floor(time / 5);
        for (let i = 0; i < LANTERNS; i++) {
            const angle = (i * Math.PI * 2) / LANTERNS;
            v.circle(x + Math.cos(angle) * 2.4, y + Math.sin(angle) * 2.4, {
                radius: 0.14,
                fill: LANTERN_COLOURS[(i + turn) % LANTERN_COLOURS.length],
                opacity: 0.85,
            });
        }
        v.text(feast, x, y + 3.2, { font: 0.5, color: "#ffd27f", stroke: "#000000", strokeWidth: 0.06 });
    }
    if (townStorm(time)) {
        drawStorm(v, time);
        return;
    }
    const tint = SEASON_TINT[season];
    if (tint)
        v.rect(-0.5, -0.5, 50, 50, { fill: tint, opacity: 0.05 });
    const drift = SEASON_DRIFT[season];
    if (drift) {
        for (let i = 0; i < drift.count; i++) {
            const sway = Math.sin((time + i * 13) / 8) * 0.8;
            const x = ((((i * 0.7548776662) % 1) * 50 + sway) % 50 + 50) % 50;
            const y = ((time * drift.fall + ((i * 0.5698402910) % 1) * 52) % 52) - 1;
            v.circle(x, y, { radius: drift.radius, fill: drift.colours[i % drift.colours.length], opacity: 0.7 });
        }
        return;
    }
    if (!fountain || !isNightfall(townClock(time).phase))
        return;
    const { x, y } = parseTile(fountain);
    for (let i = 0; i < FIREFLIES; i++) {
        const angle = (i * Math.PI * 2) / FIREFLIES + time / 40;
        const reach = 2 + (i % 3) + Math.sin((time + i * 7) / 11) * 0.6;
        const glow = Math.max(0, Math.sin((time + i * 5) / 4));
        v.circle(x + Math.cos(angle) * reach, y + Math.sin(angle) * reach, {
            radius: 0.1,
            fill: "#d4ff66",
            opacity: 0.2 + 0.7 * glow,
        });
    }
}
function drawStorm(v, time) {
    v.rect(-0.5, -0.5, 50, 50, { fill: "#334455", opacity: 0.12 });
    for (let i = 0; i < RAINDROPS; i++) {
        const x = ((i * 0.7548776662) % 1) * 49 + 0.5;
        const y = ((time * RAIN_FALL + ((i * 0.5698402910) % 1) * 52) % 52) - 1;
        v.line(x, y, x - 0.25, y + 0.7, { color: "#9fb8d0", width: 0.04, opacity: 0.5 });
    }
    if (time % LIGHTNING_EVERY !== 0)
        return;
    v.rect(-0.5, -0.5, 50, 50, { fill: "#ffffff", opacity: 0.15 });
    let x = 5 + ((time * 7) % 40);
    const bolt = [[x, -0.5]];
    for (let y = 4; y <= 20; y += 4) {
        x += ((time + y) % 3) - 1;
        bolt.push([x, y]);
    }
    v.poly(bolt, { stroke: "#fffbe0", strokeWidth: 0.15, opacity: 0.9 });
}
function drawSky(room) {
    const v = room.visual;
    const clock = townClock(Game.time);
    const shade = NIGHT_SHADE[clock.phase];
    if (shade > 0)
        v.rect(-0.5, -0.5, 50, 50, { fill: "#0a1030", opacity: shade });
    const lit = clock.phase === "dusk" || clock.phase === "night";
    if (townAurora(Game.time))
        drawAurora(v, Game.time);
    if (lit && !townStorm(Game.time))
        drawMoon(v, townMoon(Game.time));
    drawFallingStar(v, Game.time);
    drawHowl(v, Game.time);
    if (!lit)
        return;
    for (const s of room.find(FIND_MY_STRUCTURES)) {
        const { x, y } = s.pos;
        if (s.structureType === STRUCTURE_TOWER) {
            const flicker = 0.5 + 0.5 * Math.sin(Game.time * 2.1 + x * 1.3 + y);
            v.circle(x, y - 0.1, { radius: 0.9, fill: "#ff7a22", opacity: 0.1 + 0.06 * flicker });
            v.circle(x, y - 0.1, { radius: 0.16 + 0.06 * flicker, fill: "#ffd27a", opacity: 0.7 + 0.25 * flicker });
        }
        else if (s.structureType === STRUCTURE_SPAWN) {
            v.circle(x, y, { radius: 1.4, fill: "#ffb347", opacity: 0.12 });
        }
    }
}
const CAMP_RING = [
    [0, 2], [-2, 2], [2, 2], [-2, 0], [2, 0], [0, -2], [-2, -2], [2, -2],
];
function drawCamp(room) {
    var _a, _b, _c;
    if (room.memory.town)
        return;
    const anchor = (_b = (_a = room.find(FIND_MY_SPAWNS)[0]) === null || _a === void 0 ? void 0 : _a.pos) !== null && _b !== void 0 ? _b : (_c = room.find(FIND_MY_CONSTRUCTION_SITES).find((s) => s.structureType === STRUCTURE_SPAWN)) === null || _c === void 0 ? void 0 : _c.pos;
    if (!anchor)
        return;
    const terrain = room.getTerrain();
    const open = CAMP_RING.map(([dx, dy]) => [anchor.x + dx, anchor.y + dy]).filter(([x, y]) => x > 0 && x < 49 && y > 0 && y < 49 && terrain.get(x, y) !== TERRAIN_MASK_WALL);
    if (open.length === 0)
        return;
    const v = room.visual;
    const [[fx, fy], ...tents] = open;
    for (const [x, y] of tents.slice(0, 3)) {
        v.poly([[x - 0.45, y + 0.35], [x, y - 0.45], [x + 0.45, y + 0.35], [x - 0.45, y + 0.35]], {
            fill: "#7a5a32",
            stroke: "#c8a060",
            strokeWidth: 0.04,
            opacity: 0.75,
        });
    }
    if (isNightfall(townClock(Game.time).phase)) {
        const flicker = 0.5 + 0.5 * Math.sin(Game.time * 1.9 + fx);
        v.circle(fx, fy, { radius: 1.6, fill: "#ff8a33", opacity: 0.1 + 0.05 * flicker });
        v.circle(fx, fy, { radius: 0.22 + 0.08 * flicker, fill: "#ffcf66", opacity: 0.75 + 0.2 * flicker });
    }
    else {
        v.circle(fx, fy, { radius: 0.18, fill: "#6a6058", opacity: 0.7 });
    }
    v.text("Pilgrims' Camp", fx, fy + 1.1, LANDMARK_LABEL);
}
function drawTown(room) {
    const town = room.memory.town;
    if (!town)
        return;
    const v = room.visual;
    const clock = townClock(Game.time);
    const label = { font: 0.45, color: "#ffe9a8", stroke: "#000000", strokeWidth: 0.06 };
    const lit = clock.phase === "dusk" || clock.phase === "night";
    for (const c of town.cottages) {
        const l = cottageLayout(c);
        v.rect(c.x + 0.5, c.y + 0.5, 3, 3, { fill: "#8a5a2b", opacity: 0.18, stroke: "#c08a4a", strokeWidth: 0.05 });
        for (const b of l.beds) {
            if (!spotHolder(room.name, b))
                continue;
            const { x, y } = parseTile(b);
            v.circle(x, y, { radius: 0.18, fill: lit ? "#ffcc55" : "#c9a36b", opacity: lit ? 0.9 : 0.5 });
        }
        v.text(`House of ${c.name}`, c.x + 2, c.y - 0.3, label);
    }
    const colours = armsColours(room.name);
    town.posts.forEach((p, i) => {
        const { x, y } = parseTile(p);
        const manned = spotHolder(room.name, p) !== undefined;
        v.line(x, y + 0.35, x, y - 0.4, { color: "#8a7a66", width: 0.05, opacity: 0.8 });
        v.poly([[x, y - 0.4], [x + 0.4, y - 0.27], [x, y - 0.12]], { stroke: colours.other, strokeWidth: 0.04, fill: manned ? colours.field : "transparent", opacity: manned ? 0.9 : 0.5 });
        if (lit) {
            const flicker = 0.5 + 0.5 * Math.sin(Game.time * 1.7 + i * 2.3);
            v.circle(x - 0.25, y - 0.45, { radius: 0.55, fill: "#ff9933", opacity: 0.08 + 0.06 * flicker });
            v.circle(x - 0.25, y - 0.45, { radius: 0.1 + 0.05 * flicker, fill: "#ffcc55", opacity: 0.6 + 0.3 * flicker });
        }
    });
    const watchman = lit ? nightWatchman(room.name) : undefined;
    const keeper = watchman ? Game.creeps[watchman] : undefined;
    if (keeper && keeper.room.name === room.name) {
        const { x, y } = keeper.pos;
        const sway = 0.06 * Math.sin(Game.time * 0.9);
        v.circle(x + 0.3 + sway, y - 0.25, { radius: 1.3, fill: "#ffb347", opacity: 0.1 });
        v.circle(x + 0.3 + sway, y - 0.25, { radius: 0.13, fill: "#ffe39a", opacity: 0.9 });
    }
    if (town.fountain) {
        const { x, y } = parseTile(town.fountain);
        const ripple = 0.3 + 0.1 * Math.sin(Game.time / 3);
        v.circle(x, y, { radius: ripple + 0.15, fill: "transparent", stroke: "#66ccff", strokeWidth: 0.05, opacity: 0.6 });
        v.circle(x, y, { radius: 0.25, fill: "#3399ff", opacity: 0.6 });
        v.text(`${castleName(room.name)} Square`, x, y - 1.8, label);
        if (townFeast(Game.time))
            drawSong(room, x, y);
    }
    else {
        for (const k of town.square) {
            const { x, y } = parseTile(k);
            v.circle(x, y, { radius: 0.12, fill: "#ffe9a8", opacity: 0.3 });
        }
    }
}
const MOON_X = 46;
const MOON_Y = 3;
const MOON_RADIUS = 1.1;
const MOON_LIGHT = "#f4f1d0";
function drawMoon(v, age) {
    v.circle(MOON_X, MOON_Y, { radius: MOON_RADIUS, fill: "#1a1f3a", stroke: "#3a4060", strokeWidth: 0.04, opacity: 0.5 });
    if (age === 0)
        return;
    const angle = (2 * Math.PI * age) / TOWN_MOON_DAYS;
    const waxing = angle <= Math.PI;
    const side = waxing ? 1 : -1;
    const reach = Math.cos(waxing ? angle : 2 * Math.PI - angle);
    const STEPS = 12;
    const lit = [];
    for (let i = 0; i <= STEPS; i++) {
        const a = (Math.PI * i) / STEPS;
        lit.push([MOON_X + side * MOON_RADIUS * Math.sin(a), MOON_Y - MOON_RADIUS * Math.cos(a)]);
    }
    for (let i = STEPS; i >= 0; i--) {
        const a = (Math.PI * i) / STEPS;
        lit.push([MOON_X + side * MOON_RADIUS * reach * Math.sin(a), MOON_Y - MOON_RADIUS * Math.cos(a)]);
    }
    v.poly(lit, { fill: MOON_LIGHT, stroke: "transparent", opacity: 0.85 });
    if (age === TOWN_MOON_DAYS / 2)
        v.circle(MOON_X, MOON_Y, { radius: MOON_RADIUS * 2.2, fill: MOON_LIGHT, opacity: 0.07 });
}
const AURORA_COLOURS = ["#3ee08f", "#5fd3c6", "#9b6bff"];
const AURORA_FADE = 60;
function drawAurora(v, time) {
    const t = time % TOWN_DAY_LENGTH;
    const fade = Math.max(0, Math.min(1, (t - NIGHT_START) / AURORA_FADE, (TOWN_DAY_LENGTH - t) / AURORA_FADE));
    AURORA_COLOURS.forEach((colour, i) => {
        const top = [];
        const bottom = [];
        for (let x = -0.5; x <= 49.5; x += 2.5) {
            const wave = Math.sin(x * 0.18 + time * 0.05 + i * 2.1) + 0.5 * Math.sin(x * 0.07 - time * 0.03 + i);
            const y = 3 + i * 2.2 + 1.4 * wave;
            top.push([x, y]);
            bottom.push([x, y + 1.6 + 0.9 * Math.sin(x * 0.11 + time * 0.04 + i * 1.3)]);
        }
        v.poly([...top, ...bottom.reverse()], { fill: colour, stroke: "transparent", opacity: 0.16 * fade });
    });
}
function drawFallingStar(v, time) {
    const star = townFallingStar(time);
    if (!star)
        return;
    const x = star.x - 1.6 * star.t;
    const y = star.y + 0.9 * star.t;
    const fade = 1 - star.t / TOWN_STAR_TICKS;
    v.line(x + 2.4, y - 1.35, x, y, { color: "#fffbe8", width: 0.06, opacity: 0.7 * fade });
    v.circle(x, y, { radius: 0.1, fill: "#ffffff", opacity: 0.9 * fade });
}
const HOWL_STYLE = { font: "italic 0.5 serif", color: "#a8b8d8", stroke: "#000000", strokeWidth: 0.05 };
function drawHowl(v, time) {
    const howl = townHowl(time);
    if (!howl)
        return;
    const fade = 1 - howl.t / TOWN_HOWL_TICKS;
    v.circle(howl.x - 0.15, howl.y, { radius: 0.07, fill: "#ffdd55", opacity: 0.9 });
    v.circle(howl.x + 0.15, howl.y, { radius: 0.07, fill: "#ffdd55", opacity: 0.9 });
    v.text("Awoo-oo!", howl.x, howl.y - 0.7 - howl.t * 0.15, { ...HOWL_STYLE, opacity: 0.4 + 0.6 * fade });
}
const DRAGON = { fill: "#160a0a", stroke: "#7a1414", strokeWidth: 0.08, opacity: 0.92 };
const DRAGON_SHADOW = { fill: "#000000", opacity: 0.2 };
function dragonShapes(span, wag) {
    const body = [
        [3.3, 0], [2.7, -0.18], [2.45, -0.5], [2.35, -0.2], [1.9, -0.18], [1, -0.35], [0.2, -0.5], [-0.8, -0.42],
        [-1.6, -0.2], [-2.6, -0.12 + wag * 0.3], [-3.6, -0.08 + wag * 0.8], [-4.2, -0.35 + wag], [-4.7, wag],
        [-4.2, 0.35 + wag], [-3.6, 0.08 + wag * 0.8], [-2.6, 0.12 + wag * 0.3], [-1.6, 0.2], [-0.8, 0.42],
        [0.2, 0.5], [1, 0.35], [1.9, 0.18], [2.35, 0.2], [2.45, 0.5], [2.7, 0.18],
    ];
    const wing = (side) => [
        [0.7, 0.35 * side], [1, span * 0.55 * side], [0.1, span * side], [-0.35, span * 0.62 * side],
        [-0.8, span * 0.8 * side], [-1.1, span * 0.5 * side], [-1.5, span * 0.58 * side], [-1.2, 0.4 * side],
    ];
    return [wing(-1), wing(1), body];
}
function drawDragon(room, time = Game.time) {
    const d = townDragon(time);
    if (!d)
        return;
    const v = room.visual;
    const shapes = dragonShapes(1.6 + 2.2 * Math.abs(Math.sin(time * 0.9)), 0.35 * Math.sin(time * 0.5));
    const place = (shape, dx, dy) => shape.map(([f, s]) => [d.x + dx + f * d.dir, d.y + dy + s]);
    for (const shape of shapes)
        v.poly(place(shape, -1.5 * d.dir, 3), DRAGON_SHADOW);
    for (const shape of shapes)
        v.poly(place(shape, 0, 0), DRAGON);
    for (const side of [-0.1, 0.1])
        v.circle(d.x + 2.75 * d.dir, d.y + side, { radius: 0.09, fill: "#ff5522", opacity: 1 });
}
const SONG = { font: "italic 0.45 serif", color: "#f5e6a8", stroke: "#000000", strokeWidth: 0.05 };
function drawSong(room, x, y) {
    const minstrel = room.find(FIND_MY_CREEPS).find((c) => c.memory.role === ROLE_MINSTREL);
    if (!minstrel)
        return;
    const v = room.visual;
    const [first, second] = currentVerse(room, Game.time);
    v.text(first, x, y - 3.8, SONG);
    v.text(second, x, y - 3.2, SONG);
    const bob = 0.15 * Math.sin(Game.time / 2);
    v.text("♪", minstrel.pos.x + 0.5, minstrel.pos.y - 0.5 + bob, { font: 0.6, color: "#ffe9a8" });
}
function getRoomPhase(rcl) {
    if (rcl <= 2)
        return "bootstrap";
    if (rcl <= 4)
        return "developing";
    if (rcl <= 6)
        return "established";
    return "powerhouse";
}
function describeCensus(room) {
    var _a, _b;
    const home = {};
    const away = {};
    for (const name in Game.creeps) {
        const c = Game.creeps[name];
        if (((_a = c.memory.homeRoom) !== null && _a !== void 0 ? _a : c.room.name) !== room.name)
            continue;
        const role = c.memory.role;
        if (role === ROLE_TOWNSFOLK)
            continue;
        const sent = c.memory.targetRoom !== undefined && c.memory.targetRoom !== room.name;
        const tally = sent ? away : home;
        tally[role] = ((_b = tally[role]) !== null && _b !== void 0 ? _b : 0) + 1;
    }
    const line = (tally) => Object.keys(tally)
        .sort((a, b) => tally[b] - tally[a] || a.localeCompare(b))
        .map((role) => {
        var _a;
        const title = (_a = ROLE_TITLES[role]) !== null && _a !== void 0 ? _a : role;
        return `${tally[role]} ${tally[role] === 1 ? title : `${title}s`}`;
    })
        .join(" · ");
    return [line(home), line(away)];
}
function countCreepsByRole(room) {
    var _a;
    const counts = {};
    for (const name in Game.creeps) {
        const creep = Game.creeps[name];
        if (creep.room.name !== room.name)
            continue;
        const role = creep.memory.role;
        counts[role] = ((_a = counts[role]) !== null && _a !== void 0 ? _a : 0) + 1;
    }
    return counts;
}

const ROLE_THEME = "darkfantasy";
const ROLE_RENAMES = {
    wanderer: "peddler",
    fairyelf: "cleric",
    ragefighter: "ravager",
    blademaster: "reaver",
    museelf: "acolyte",
};
function migrateRoleNames() {
    if (Memory.roleTheme === ROLE_THEME)
        return;
    let migrated = 0;
    for (const name in Memory.creeps) {
        const mem = Memory.creeps[name];
        const renamed = mem && ROLE_RENAMES[mem.role];
        if (renamed) {
            mem.role = renamed;
            migrated++;
        }
    }
    migrateSquadFields();
    Memory.roleTheme = ROLE_THEME;
    if (migrated > 0) {
        console.log(`[rebrand] by royal decree, ${migrated} creeps have sworn new oaths to the castle.`);
    }
}
const SQUAD_FIELD_RENAMES = {
    requiredKnights: "requiredMelee", requiredEnforcers: "requiredMelee", requiredBiters: "requiredMelee",
    requiredWizards: "requiredRanged", requiredTriggermen: "requiredRanged", requiredSpitters: "requiredRanged",
    requiredClerics: "requiredHealers", requiredMedics: "requiredHealers", requiredLickers: "requiredHealers",
    requiredSiegers: "requiredSiege", requiredWreckers: "requiredSiege", requiredChewers: "requiredSiege",
    requiredDecoys: "requiredDrainers", requiredWigglers: "requiredDrainers",
};
function migrateSquadFields() {
    var _a, _b, _c;
    const ops = [
        Memory.militaryOp,
        ...Object.values((_a = Memory.militaryOps) !== null && _a !== void 0 ? _a : {}),
        ...((_b = Memory.militaryQueue) !== null && _b !== void 0 ? _b : []),
        ...Object.values((_c = Memory.defenseOps) !== null && _c !== void 0 ? _c : {}),
    ];
    for (const op of ops) {
        if (!op)
            continue;
        for (const from in SQUAD_FIELD_RENAMES) {
            if (op[from] === undefined)
                continue;
            op[SQUAD_FIELD_RENAMES[from]] = op[from];
            delete op[from];
        }
    }
}

const VALID_FORMATIONS = ["line", "box", "wedge", "scatter"];
const VALID_TACTICS = ["assault", "siege", "raid", "defend", "retreat"];
function setupConsole() {
    Game.arca = {
        expand: () => {
            const candidates = rankExpansionCandidates();
            if (candidates.length === 0) {
                console.log("[ARCA] No expansion candidates in scout data - send lookouts first");
                return;
            }
            console.log("[ARCA] Top expansion candidates:");
            for (const c of candidates.slice(0, 5)) {
                console.log(`  ${c.room}  score=${c.score}  sources=${c.sources}  dist=${c.dist}  fundedBy=${c.homeRoom}`);
            }
            console.log("[ARCA] Claim now with Game.arca.claim('ROOM_NAME') or line up with Game.arca.queueExpand('ROOM_NAME')");
        },
        queueExpand: (roomName, homeRoom) => {
            if (!roomName) {
                console.log("[ARCA] Usage: Game.arca.queueExpand('W5N5')  or  Game.arca.queueExpand('W5N5', 'W1N1')");
                return;
            }
            const err = enqueueExpansion(roomName, homeRoom);
            if (err) {
                console.log(`[ARCA] Cannot queue ${roomName} - ${err}`);
                return;
            }
            console.log(`[ARCA] Queued expansion to ${roomName}${homeRoom ? ` (prefer ${homeRoom})` : ""} - ${getExpansionQueue().length} queued`);
        },
        dequeueExpand: (roomName) => {
            if (!roomName) {
                console.log("[ARCA] Usage: Game.arca.dequeueExpand('W5N5')");
                return;
            }
            if (dequeueExpansion(roomName))
                console.log(`[ARCA] Removed ${roomName} from the expansion queue`);
            else
                console.log(`[ARCA] ${roomName} was not in the expansion queue`);
        },
        autoexpand: (enabled) => {
            if (enabled === undefined) {
                console.log(`[AutoExpand] ${Memory.autoExpand !== false ? "ON" : "OFF"}`);
                return;
            }
            Memory.autoExpand = enabled;
            console.log(`[AutoExpand] ${enabled ? "ENABLED" : "DISABLED"}`);
        },
        claim: (roomName) => {
            var _a, _b;
            if (!roomName) {
                console.log("[ARCA] Usage: Game.arca.claim('W2N1')");
                return;
            }
            if (Memory.expansion) {
                console.log(`[ARCA] Already expanding to ${Memory.expansion.roomName} - cancel first with Game.arca.cancel()`);
                return;
            }
            const myRoomCount = Object.values(Game.rooms).filter((r) => { var _a; return (_a = r.controller) === null || _a === void 0 ? void 0 : _a.my; }).length;
            if (Game.gcl.level <= myRoomCount) {
                console.log(`[ARCA] GCL ${Game.gcl.level} does not allow another room (have ${myRoomCount}) - need GCL ${myRoomCount + 1}`);
                return;
            }
            const targetRoom = Game.rooms[roomName];
            if (targetRoom) {
                if ((_a = targetRoom.controller) === null || _a === void 0 ? void 0 : _a.my) {
                    console.log(`[ARCA] ${roomName} is already yours`);
                    return;
                }
                if ((_b = targetRoom.controller) === null || _b === void 0 ? void 0 : _b.owner) {
                    console.log(`[ARCA] ${roomName} is owned by ${targetRoom.controller.owner.username}`);
                    return;
                }
            }
            const homeRoom = resolveFundingHome(roomName);
            if (!homeRoom) {
                console.log(`[ARCA] No owned room is healthy enough to fund expansion (needs RCL 4+, ${MIN_HOME_STORAGE_ENERGY / 1000}k gold in the treasury, no threats)`);
                return;
            }
            Memory.expansion = {
                roomName,
                homeRoom,
                phase: "claiming",
                startedAt: Game.time,
            };
            console.log(`[ARCA] Expansion to ${roomName} queued - funded by ${homeRoom} (GCL ${Game.gcl.level}/${myRoomCount + 1})`);
        },
        status: () => {
            const e = Memory.expansion;
            if (e) {
                const age = Game.time - e.startedAt;
                console.log(`[ARCA] ACTIVE: ${e.roomName} | Phase: ${e.phase} | Home: ${e.homeRoom} | Age: ${age} ticks`);
            }
            else {
                console.log("[ARCA] No active expansion");
            }
            const queue = getExpansionQueue();
            if (queue.length === 0) {
                console.log("[ARCA] Expansion queue is empty");
                return;
            }
            console.log(`[ARCA] Expansion queue (${queue.length}):`);
            queue.forEach((q, i) => {
                console.log(`  ${i + 1}. ${q.roomName}${q.homeRoom ? ` (prefer ${q.homeRoom})` : ""}  queuedAt=${q.queuedAt}`);
            });
        },
        cancel: () => {
            if (!Memory.expansion) {
                console.log("[ARCA] No active expansion to cancel");
                return;
            }
            const room = Memory.expansion.roomName;
            delete Memory.expansion;
            console.log(`[ARCA] Expansion to ${room} cancelled`);
        },
        labs: () => {
            var _a, _b, _c, _d, _e, _f;
            let found = false;
            for (const rn in Game.rooms) {
                const room = Game.rooms[rn];
                if (!((_a = room.controller) === null || _a === void 0 ? void 0 : _a.my))
                    continue;
                found = true;
                const ls = room.memory.labSystem;
                if (!ls) {
                    console.log(`[Labs] ${rn}: no lab system (need RCL 6+ and 3+ labs)`);
                    continue;
                }
                const active = (_b = ls.activeCompound) !== null && _b !== void 0 ? _b : "idle";
                const inputCount = (_d = (_c = ls.inputLabIds) === null || _c === void 0 ? void 0 : _c.length) !== null && _d !== void 0 ? _d : 0;
                const outputCount = (_f = (_e = ls.outputLabIds) === null || _e === void 0 ? void 0 : _e.length) !== null && _f !== void 0 ? _f : 0;
                console.log(`[Labs] ${rn}: active=${active}  queue=${ls.queue.length}  inputs=${inputCount}  outputs=${outputCount}  auto=${ls.autoEnabled !== false}`);
                if (ls.inputCompounds) {
                    console.log(`  Reagents: ${ls.inputCompounds[0]} + ${ls.inputCompounds[1]}`);
                }
                if (ls.queue.length > 0) {
                    console.log(`  Queue: ${ls.queue.map((e) => `${e.compound}x${e.amount}`).join(", ")}`);
                }
                const stockLines = Object.entries(AUTO_PRODUCTION_TARGETS)
                    .map(([c, t]) => `${c}=${getStockForCompound(c, room)}/${t}`)
                    .join("  ");
                console.log(`  Stock: ${stockLines}`);
            }
            if (!found)
                console.log("[Labs] No owned rooms found");
        },
        produce: (compound, amount, roomName) => {
            if (!compound || !amount) {
                console.log("[Labs] Usage: Game.arca.produce('XGH2O', 3000)  or  Game.arca.produce('XGH2O', 3000, 'W1N1')");
                return;
            }
            const candidates = Object.values(Game.rooms).filter((r) => { var _a, _b, _c; return ((_a = r.controller) === null || _a === void 0 ? void 0 : _a.my) && (roomName ? r.name === roomName : (_c = (_b = r.memory.labSystem) === null || _b === void 0 ? void 0 : _b.inputLabIds) === null || _c === void 0 ? void 0 : _c.length); });
            if (candidates.length === 0) {
                console.log(`[Labs] No room with labs found${roomName ? ` matching ${roomName}` : ""}`);
                return;
            }
            const room = candidates[0];
            if (!room.memory.labSystem)
                room.memory.labSystem = { queue: [] };
            const chain = resolveChain(compound, amount, room);
            if (chain.length === 0) {
                console.log(`[Labs] ${room.name}: Nothing to queue - stock may already be sufficient`);
                return;
            }
            room.memory.labSystem.queue.push(...chain);
            console.log(`[Labs] ${room.name}: Queued ${chain.length} reaction(s) -> ${compound}x${amount}: ` +
                chain.map((e) => `${e.compound}x${e.amount}`).join(", "));
        },
        network: () => {
            var _a, _b, _c, _d, _e, _f, _g, _h;
            const ownedRooms = Object.values(Game.rooms).filter((r) => { var _a; return (_a = r.controller) === null || _a === void 0 ? void 0 : _a.my; });
            if (ownedRooms.length === 0) {
                console.log("[Network] No owned rooms");
                return;
            }
            console.log("[Network] === Resource Network Status ===");
            for (const room of ownedRooms) {
                const storageEnergy = (_b = (_a = room.storage) === null || _a === void 0 ? void 0 : _a.store[RESOURCE_ENERGY]) !== null && _b !== void 0 ? _b : 0;
                const terminalEnergy = (_d = (_c = room.terminal) === null || _c === void 0 ? void 0 : _c.store[RESOURCE_ENERGY]) !== null && _d !== void 0 ? _d : 0;
                const cooldown = (_f = (_e = room.terminal) === null || _e === void 0 ? void 0 : _e.cooldown) !== null && _f !== void 0 ? _f : -1;
                const pending = room.memory.pendingSend;
                const pendingStr = pending
                    ? `  PENDING: ${pending.amount} ${pending.resource} -> ${pending.to} (loaded ${(_h = (_g = room.terminal) === null || _g === void 0 ? void 0 : _g.store.getUsedCapacity(pending.resource)) !== null && _h !== void 0 ? _h : 0}/${pending.loadTarget})`
                    : "";
                console.log(`  ${room.name}: treasury=${storageEnergy} gold  terminal=${terminalEnergy} gold (cd=${cooldown})${pendingStr}`);
                const minerals = ['H', 'O', 'Z', 'K', 'U', 'L', 'X'];
                const stockParts = minerals.map((m) => {
                    var _a, _b, _c, _d;
                    const s = ((_b = (_a = room.storage) === null || _a === void 0 ? void 0 : _a.store.getUsedCapacity(m)) !== null && _b !== void 0 ? _b : 0) + ((_d = (_c = room.terminal) === null || _c === void 0 ? void 0 : _c.store.getUsedCapacity(m)) !== null && _d !== void 0 ? _d : 0);
                    return `${m}=${s}`;
                });
                console.log(`    Minerals: ${stockParts.join("  ")}`);
            }
        },
        attack: (roomName, formation = "box", tactic = "assault", composition, homeRoomName) => {
            var _a, _b, _c, _d, _e, _f, _g;
            if (!roomName) {
                console.log("[Military] Usage: Game.arca.attack('W2N1', 'box', 'assault')");
                return;
            }
            if (!VALID_FORMATIONS.includes(formation)) {
                console.log(`[Military] Unknown formation '${formation}'. Use: ${VALID_FORMATIONS.join(", ")}`);
                return;
            }
            if (!VALID_TACTICS.includes(tactic) || tactic === "retreat") {
                console.log(`[Military] Unknown tactic '${tactic}'. Use: assault, siege, raid, defend`);
                return;
            }
            const targetRoom = Game.rooms[roomName];
            if ((_a = targetRoom === null || targetRoom === void 0 ? void 0 : targetRoom.controller) === null || _a === void 0 ? void 0 : _a.my) {
                console.log(`[Military] ${roomName} is already yours`);
                return;
            }
            const ownedRooms = Object.values(Game.rooms).filter((r) => { var _a; return (_a = r.controller) === null || _a === void 0 ? void 0 : _a.my; });
            if (ownedRooms.length === 0) {
                console.log("[Military] No owned rooms to launch from");
                return;
            }
            let homeRoom;
            if (homeRoomName) {
                const r = Game.rooms[homeRoomName];
                if (!((_b = r === null || r === void 0 ? void 0 : r.controller) === null || _b === void 0 ? void 0 : _b.my)) {
                    console.log(`[Military] ${homeRoomName} is not a room you own`);
                    return;
                }
                homeRoom = r;
            }
            else {
                homeRoom = ownedRooms.reduce((best, r) => {
                    const d = Game.map.getRoomLinearDistance(r.name, roomName);
                    const bd = Game.map.getRoomLinearDistance(best.name, roomName);
                    return d < bd ? r : best;
                });
            }
            const rec = recommendComposition(roomName, tactic);
            const comp = {
                melee: (_c = composition === null || composition === void 0 ? void 0 : composition.melee) !== null && _c !== void 0 ? _c : rec.melee,
                ranged: (_d = composition === null || composition === void 0 ? void 0 : composition.ranged) !== null && _d !== void 0 ? _d : rec.ranged,
                healers: (_e = composition === null || composition === void 0 ? void 0 : composition.healers) !== null && _e !== void 0 ? _e : rec.healers,
                siege: (_f = composition === null || composition === void 0 ? void 0 : composition.siege) !== null && _f !== void 0 ? _f : rec.siege,
                drainers: (_g = composition === null || composition === void 0 ? void 0 : composition.drainers) !== null && _g !== void 0 ? _g : rec.drainers,
            };
            const err = launchOp(roomName, formation, tactic, comp, homeRoom.name);
            if (err) {
                const qErr = enqueueOp(roomName, formation, tactic, comp, homeRoomName);
                if (qErr) {
                    console.log(`[Military] Cannot launch or queue - ${err}; ${qErr}`);
                    return;
                }
                console.log(`[Military] ${err} - queued ${roomName} to auto-start when a home frees up`);
                return;
            }
            console.log(`[Military] Op launched: ${homeRoom.name} -> ${roomName}  ${formation}/${tactic}  ` +
                `crew=${comp.melee}M/${comp.ranged}R/${comp.healers}H/${comp.siege}S/${comp.drainers}D`);
            console.log(`[Military] Spawning squad... track with Game.arca.squads()`);
        },
        dequeueAttack: (roomName) => {
            if (!roomName) {
                console.log("[Military] Usage: Game.arca.dequeueAttack('W2N1')");
                return;
            }
            if (dequeueOp(roomName))
                console.log(`[Military] Removed ${roomName} from the offensive queue`);
            else
                console.log(`[Military] ${roomName} was not in the offensive queue`);
        },
        drain: (roomName, count = 1, homeRoomName) => {
            var _a;
            if (!roomName) {
                console.log("[Drain] Usage: Game.arca.drain('W2N1', 1)");
                return;
            }
            const err = launchDrain(roomName, homeRoomName, count);
            if (err) {
                console.log(`[Drain] Cannot start - ${err}`);
                return;
            }
            const op = getDrainOps().find((o) => o.targetRoom === roomName);
            console.log(`[Drain] Draining ${roomName} with ${(_a = op === null || op === void 0 ? void 0 : op.drainers) !== null && _a !== void 0 ? _a : count} drainer(s) from ${op === null || op === void 0 ? void 0 : op.homeRoom}. ` +
                `Stop with Game.arca.stopDrain('${roomName}')`);
        },
        stopDrain: (roomName) => {
            if (!roomName) {
                console.log("[Drain] Usage: Game.arca.stopDrain('W2N1')");
                return;
            }
            if (stopDrain(roomName))
                console.log(`[Drain] Stopped draining ${roomName}`);
            else
                console.log(`[Drain] No active drain on ${roomName}`);
        },
        drains: () => {
            const ops = getDrainOps();
            if (ops.length === 0) {
                console.log("[Drain] No active drains");
                return;
            }
            console.log(`[Drain] Active drains (${ops.length}):`);
            for (const op of ops) {
                const live = Object.values(Game.creeps).filter((c) => c.memory.role === ROLE_DRAINER && c.memory.offensiveTarget === op.targetRoom).length;
                const age = Game.time - op.startedAt;
                console.log(`  ${op.targetRoom} <- ${op.homeRoom}  drainers=${live}/${op.drainers}  age=${age}t`);
            }
        },
        formation: (name, homeRoom) => {
            if (!VALID_FORMATIONS.includes(name)) {
                console.log(`[Military] Unknown formation '${name}'. Use: ${VALID_FORMATIONS.join(", ")}`);
                return;
            }
            const n = setFormation(name, homeRoom);
            if (n === 0) {
                console.log("[Military] No matching active operation");
                return;
            }
            console.log(`[Military] Formation -> ${name} (${n} op${n !== 1 ? "s" : ""})`);
        },
        tactic: (name, homeRoom) => {
            if (!VALID_TACTICS.includes(name)) {
                console.log(`[Military] Unknown tactic '${name}'. Use: ${VALID_TACTICS.join(", ")}`);
                return;
            }
            const n = setTactic(name, homeRoom);
            if (n === 0) {
                console.log("[Military] No matching active operation");
                return;
            }
            console.log(`[Military] Tactic -> ${name} (${n} op${n !== 1 ? "s" : ""})`);
        },
        recall: (homeRoom) => {
            const n = cancelOp(homeRoom);
            if (n === 0) {
                console.log(homeRoom ? `[Military] No active operation for ${homeRoom}` : "[Military] No active operations");
                return;
            }
            console.log(`[Military] Stood down ${n} operation${n !== 1 ? "s" : ""}${homeRoom ? ` (${homeRoom})` : ""}`);
        },
        squads: () => {
            var _a, _b, _c, _d;
            const ops = getOffensiveOps();
            const queue = getMilitaryQueue();
            if (ops.length === 0 && queue.length === 0) {
                console.log("[Military] No active operations or queued targets");
                return;
            }
            for (const op of ops) {
                const age = Game.time - op.startedAt;
                console.log(`[Military] Op: ${op.homeRoom} -> ${op.targetRoom}`);
                console.log(`  Phase: ${op.phase}  |  Formation: ${op.formation}  |  Tactic: ${op.tactic}  |  Age: ${age}t`);
                console.log(`  Required: ${op.requiredMelee}M / ${op.requiredRanged}R / ` +
                    `${op.requiredHealers}H / ${(_a = op.requiredSiege) !== null && _a !== void 0 ? _a : 0}S / ${(_b = op.requiredDrainers) !== null && _b !== void 0 ? _b : 0}D`);
                const members = Object.values(Game.creeps).filter((c) => c.memory.offensiveTarget === op.targetRoom && c.memory.homeRoom === op.homeRoom);
                if (members.length === 0) {
                    console.log("  Squad: none yet (still spawning)");
                    continue;
                }
                const counts = {
                    [ROLE_KNIGHT]: 0,
                    [ROLE_WIZARD]: 0,
                    [ROLE_CLERIC]: 0,
                    [ROLE_SIEGER]: 0,
                    [ROLE_DRAINER]: 0,
                };
                let hpSum = 0;
                for (const c of members) {
                    counts[c.memory.role] = ((_c = counts[c.memory.role]) !== null && _c !== void 0 ? _c : 0) + 1;
                    hpSum += c.hits / c.hitsMax;
                }
                const avgHp = Math.round((hpSum / members.length) * 100);
                const inTarget = members.filter((c) => c.room.name === op.targetRoom).length;
                console.log(`  Crew: ${counts[ROLE_KNIGHT]}M/${counts[ROLE_WIZARD]}R/` +
                    `${counts[ROLE_CLERIC]}H/${counts[ROLE_SIEGER]}S/${counts[ROLE_DRAINER]}D  avgHP=${avgHp}%  inTarget=${inTarget}/${members.length}`);
                for (const c of members) {
                    const hpPct = Math.round((c.hits / c.hitsMax) * 100);
                    console.log(`  ${c.name}  role=${c.memory.role}  room=${c.room.name}  hp=${hpPct}%  ttl=${(_d = c.ticksToLive) !== null && _d !== void 0 ? _d : "?"}`);
                }
            }
            if (queue.length > 0) {
                console.log(`[Military] Offensive queue (${queue.length}):`);
                queue.forEach((q, i) => {
                    var _a;
                    console.log(`  ${i + 1}. ${q.targetRoom}${q.homeRoom ? ` (prefer ${q.homeRoom})` : ""}  ${q.formation}/${q.tactic}  ` +
                        `${q.requiredMelee}M/${q.requiredRanged}R/${q.requiredHealers}H/${q.requiredSiege}S/${(_a = q.requiredDrainers) !== null && _a !== void 0 ? _a : 0}D`);
                });
            }
        },
        retreat: () => Game.arca.recall(),
        military: () => Game.arca.squads(),
        ops: () => {
            var _a;
            const exp = Memory.expansion;
            const expQueue = getExpansionQueue();
            console.log("[ARCA] === Operations Overview ===");
            if (exp) {
                console.log(`  Expansion ACTIVE: ${exp.roomName} (${exp.phase}) <- ${exp.homeRoom}`);
            }
            else {
                console.log("  Expansion: idle");
            }
            if (expQueue.length > 0) {
                console.log(`    queue (${expQueue.length}): ${expQueue.map((q) => q.roomName).join(", ")}`);
            }
            const mOps = getOffensiveOps();
            const mQueue = getMilitaryQueue();
            if (mOps.length === 0)
                console.log("  Offensive: none active");
            for (const op of mOps) {
                console.log(`  Offensive: ${op.homeRoom} -> ${op.targetRoom} (${op.phase}, ${op.tactic})`);
            }
            if (mQueue.length > 0) {
                console.log(`    queue (${mQueue.length}): ${mQueue.map((q) => q.targetRoom).join(", ")}`);
            }
            const skOps = (_a = Memory.skOps) !== null && _a !== void 0 ? _a : [];
            if (skOps.length === 0)
                console.log("  Source Keeper: none active");
            for (const op of skOps) {
                console.log(`  Source Keeper: #${op.id} ${op.homeRoom} -> ${op.roomName} (${op.phase})`);
            }
        },
        warcouncil: (autoAttack) => {
            var _a, _b;
            if (!Memory.warCouncil)
                Memory.warCouncil = { autoAttack: false };
            if (autoAttack !== undefined) {
                Memory.warCouncil.autoAttack = autoAttack;
                console.log(`[WarCouncil] Auto-attack ${autoAttack ? "ENABLED" : "DISABLED"}`);
            }
            console.log(`[WarCouncil] auto-attack=${Memory.warCouncil.autoAttack}  ` +
                `lastScan=${(_a = Memory.warCouncil.lastScan) !== null && _a !== void 0 ? _a : "never"}`);
            const intel = (_b = Memory.intel) !== null && _b !== void 0 ? _b : {};
            const targets = Object.values(intel)
                .filter((i) => i.owner)
                .sort((a, b) => a.threatLevel - b.threatLevel)
                .slice(0, 10);
            if (targets.length === 0) {
                console.log("[WarCouncil] No enemy rooms in intel yet - scout or use an observer.");
                return;
            }
            console.log("[WarCouncil] Known enemy rooms (lowest threat first):");
            for (const t of targets) {
                const age = Game.time - t.lastSeen;
                console.log(`  ${t.roomName}  threat=${t.threatLevel}  owner=${t.owner}  rcl=${t.rcl}  ` +
                    `towers=${t.towers}  spawns=${t.spawns}${t.safeMode ? "  SAFEMODE" : ""}  seen=${age}t ago`);
            }
        },
        lockdown: (roomName, on = true) => {
            var _a, _b, _c, _d;
            if (!roomName) {
                let any = false;
                for (const rn in Game.rooms) {
                    const room = Game.rooms[rn];
                    if (!((_a = room.controller) === null || _a === void 0 ? void 0 : _a.my))
                        continue;
                    any = true;
                    const b = room.memory.blockade;
                    if (!b) {
                        console.log(`[Lockdown] ${rn}: clear`);
                        continue;
                    }
                    const kind = b.manual ? "MANUAL" : `auto (expires in ${Math.max(0, b.until - Game.time)}t)`;
                    console.log(`[Lockdown] ${rn}: BLOCKADED ${kind}  guards=${(_b = b.guards) !== null && _b !== void 0 ? _b : "?"}`);
                }
                if (!any)
                    console.log("[Lockdown] No owned rooms");
                console.log("[Lockdown] Set with Game.arca.lockdown('W1N1')  |  lift with Game.arca.lockdown('W1N1', false)");
                return;
            }
            const room = Game.rooms[roomName];
            if (!((_c = room === null || room === void 0 ? void 0 : room.controller) === null || _c === void 0 ? void 0 : _c.my)) {
                console.log(`[Lockdown] ${roomName} is not a room you own or is not in vision`);
                return;
            }
            if (on) {
                const existing = room.memory.blockade;
                room.memory.blockade = {
                    detectedAt: (_d = existing === null || existing === void 0 ? void 0 : existing.detectedAt) !== null && _d !== void 0 ? _d : Game.time,
                    until: Game.time,
                    manual: true,
                    guards: existing === null || existing === void 0 ? void 0 : existing.guards,
                };
                console.log(`[Lockdown] ${roomName}: LOCKED DOWN - all outbound roles suppressed until you lift it`);
            }
            else {
                delete room.memory.blockade;
                console.log(`[Lockdown] ${roomName}: lifted - outbound roles resume`);
            }
        },
        threat: () => {
            var _a, _b, _c;
            let found = false;
            for (const rn in Game.rooms) {
                const room = Game.rooms[rn];
                if (!((_a = room.controller) === null || _a === void 0 ? void 0 : _a.my))
                    continue;
                found = true;
                const { hostiles, score } = getThreatInfo(room);
                const severity = getThreatSeverity(room);
                const towerIds = (_b = room.memory.towerIds) !== null && _b !== void 0 ? _b : [];
                const towerEnergy = towerIds.reduce((sum, id) => {
                    var _a;
                    const t = Game.getObjectById(id);
                    return sum + ((_a = t === null || t === void 0 ? void 0 : t.store[RESOURCE_ENERGY]) !== null && _a !== void 0 ? _a : 0);
                }, 0);
                const safemodeStatus = room.controller.safeMode
                    ? `ACTIVE (${room.controller.safeMode} ticks)`
                    : room.controller.safeModeAvailable
                        ? `ready (${room.controller.safeModeAvailable} charge${room.controller.safeModeAvailable !== 1 ? "s" : ""})`
                        : "unavailable";
                const blockadeStatus = isBlockaded(room)
                    ? `  BLOCKADED${((_c = room.memory.blockade) === null || _c === void 0 ? void 0 : _c.manual) ? "(manual)" : ""}`
                    : "";
                console.log(`[Threat] ${rn}: severity=${severity} score=${score} hostiles=${hostiles.length}` +
                    `  towers=${towerIds.length} gold=${towerEnergy}  safemode=${safemodeStatus}${blockadeStatus}`);
                if (hostiles.length > 0) {
                    for (const h of hostiles) {
                        const parts = h.body.map((p) => p.type).join(",");
                        console.log(`  ${h.name} (${h.owner.username}) hp=${h.hits}/${h.hitsMax} parts=${parts}`);
                    }
                }
            }
            if (!found)
                console.log("[Threat] No owned rooms");
        },
        nukes: () => {
            var _a, _b, _c;
            let found = false;
            for (const rn in Game.rooms) {
                const room = Game.rooms[rn];
                if (!((_a = room.controller) === null || _a === void 0 ? void 0 : _a.my))
                    continue;
                const nukes = room.find(FIND_NUKES);
                if (nukes.length === 0)
                    continue;
                found = true;
                const earliest = nukes.reduce((m, n) => Math.min(m, n.timeToLand), Infinity);
                console.log(`[Nuke] ${rn}: ${nukes.length} inbound - first impact in ${earliest} ticks`);
                const def = room.memory.nukeDefense;
                if (!def)
                    continue;
                for (const key in def.tiles) {
                    const required = def.tiles[key];
                    const [x, y] = key.split(",").map(Number);
                    const structures = room.lookForAt(LOOK_STRUCTURES, x, y);
                    const rampart = structures.find((s) => s.structureType === STRUCTURE_RAMPART);
                    const structAt = structures.find((s) => s.structureType !== STRUCTURE_RAMPART);
                    const have = (_b = rampart === null || rampart === void 0 ? void 0 : rampart.hits) !== null && _b !== void 0 ? _b : 0;
                    const ok = have >= required ? "OK" : `${Math.round((have / required) * 100)}%`;
                    console.log(`  (${x},${y}) ${(_c = structAt === null || structAt === void 0 ? void 0 : structAt.structureType) !== null && _c !== void 0 ? _c : "?"}: ${have}/${required} [${ok}]`);
                }
            }
            if (!found)
                console.log("[Nuke] No inbound nukes detected");
        },
        nuker: () => {
            const statuses = describeNukers();
            if (statuses.length === 0) {
                console.log("[Nuker] No nukers found (built at RCL 8)");
                return;
            }
            for (const s of statuses) {
                const ePct = Math.round((s.energy / s.energyCapacity) * 100);
                const gPct = Math.round((s.ghodium / s.ghodiumCapacity) * 100);
                const cd = s.cooldown > 0 ? `cooldown=${s.cooldown}t` : "cooldown=0";
                const state = s.ready ? "READY" : "loading";
                console.log(`[Nuker] ${s.room}: gold=${s.energy}/${s.energyCapacity} (${ePct}%)  ` +
                    `ghodium=${s.ghodium}/${s.ghodiumCapacity} (${gPct}%)  ${cd}  [${state}]`);
            }
            console.log("[Nuker] Launch with: Game.arca.launchNuke('W1N1', 'W5N5', 25, 25)  or  Game.arca.launchNuke('W1N1', 'FLAG_NAME')");
        },
        launchNuke: (fromRoom, target, x, y) => {
            if (!fromRoom || !target) {
                console.log("[Nuker] Usage: Game.arca.launchNuke('W1N1', 'W5N5', 25, 25)  or  Game.arca.launchNuke('W1N1', 'FLAG_NAME')");
                return;
            }
            let pos;
            const flag = Game.flags[target];
            if (flag) {
                pos = flag.pos;
            }
            else {
                if (x === undefined || y === undefined) {
                    console.log(`[Nuker] '${target}' is not a flag - provide x and y: Game.arca.launchNuke('${fromRoom}', '${target}', 25, 25)`);
                    return;
                }
                if (x < 0 || x > 49 || y < 0 || y > 49) {
                    console.log(`[Nuker] Invalid coordinates (${x},${y}) - must be 0..49`);
                    return;
                }
                pos = new RoomPosition(x, y, target);
            }
            const err = launchNukeFrom(fromRoom, pos);
            if (err) {
                console.log(`[Nuker] Launch ABORTED - ${err}`);
                return;
            }
            const msg = `[Nuker] LAUNCHED from ${fromRoom} -> ${pos.roomName} (${pos.x},${pos.y}) - ` +
                `impact in ${NUKE_LAND_TIME} ticks`;
            console.log(msg);
            Game.notify(msg, 0);
        },
        safemode: (roomName) => {
            var _a;
            if (!roomName) {
                console.log("[SafeMode] Usage: Game.arca.safemode('W1N1')");
                return;
            }
            const room = Game.rooms[roomName];
            if (!((_a = room === null || room === void 0 ? void 0 : room.controller) === null || _a === void 0 ? void 0 : _a.my)) {
                console.log(`[SafeMode] ${roomName} is not a room you own or is not in vision`);
                return;
            }
            const ctrl = room.controller;
            if (ctrl.safeMode) {
                console.log(`[SafeMode] ${roomName} already has safemode active (${ctrl.safeMode} ticks remaining)`);
                return;
            }
            if (!ctrl.safeModeAvailable) {
                console.log(`[SafeMode] ${roomName} has no safemode charges available`);
                return;
            }
            const result = ctrl.activateSafeMode();
            if (result === OK) {
                console.log(`[SafeMode] Activated in ${roomName} manually`);
            }
            else {
                console.log(`[SafeMode] Failed to activate in ${roomName}: error ${result}`);
            }
        },
        power: () => {
            var _a;
            const ops = Memory.powerOps;
            if (!ops || ops.length === 0) {
                console.log("[Power] No active power bank operations");
                return;
            }
            for (const op of ops) {
                const age = Game.time - op.startedAt;
                const members = Object.values(Game.creeps).filter((c) => c.memory.powerOpId === op.id);
                const attackers = members.filter((c) => c.memory.role === ROLE_POWER_ATTACKER).length;
                const healers = members.filter((c) => c.memory.role === ROLE_POWER_HEALER).length;
                const carriers = members.filter((c) => c.memory.role === ROLE_POWER_CARRIER).length;
                console.log(`[Power] Op #${op.id}: ${op.homeRoom} -> ${op.roomName}` +
                    `  phase=${op.phase}  power=${op.power}  age=${age}`);
                console.log(`  Squad: ${attackers}/${op.requiredAttackers}A  ${healers}/${op.requiredHealers}H  ${carriers}/${op.requiredCarriers}C`);
                for (const c of members) {
                    const hpPct = Math.round((c.hits / c.hitsMax) * 100);
                    console.log(`  ${c.name}  role=${c.memory.role}  room=${c.room.name}  hp=${hpPct}%`);
                }
            }
            let foundPs = false;
            for (const rn in Game.rooms) {
                const room = Game.rooms[rn];
                if (!((_a = room.controller) === null || _a === void 0 ? void 0 : _a.my) || !room.memory.powerSpawnId)
                    continue;
                const ps = Game.getObjectById(room.memory.powerSpawnId);
                if (!ps)
                    continue;
                foundPs = true;
                console.log(`[Power] ${rn} PowerSpawn: power=${ps.power}  gold=${ps.store[RESOURCE_ENERGY]}`);
            }
            if (!foundPs)
                console.log("[Power] No PowerSpawn structures found (RCL 8 required)");
        },
        deposits: () => {
            const ops = Memory.depositOps;
            if (!ops || ops.length === 0) {
                console.log("[Deposit] No active deposit mining operations");
                return;
            }
            for (const op of ops) {
                const age = Game.time - op.startedAt;
                const members = Object.values(Game.creeps).filter((c) => c.memory.depositOpId === op.id);
                const miners = members.filter((c) => c.memory.role === ROLE_DEPOSIT_MINER).length;
                const haulers = members.filter((c) => c.memory.role === ROLE_DEPOSIT_HAULER).length;
                console.log(`[Deposit] Op #${op.id}: ${op.homeRoom} -> ${op.roomName}` +
                    `  type=${op.depositType}  phase=${op.phase}  cooldown=${op.lastCooldown}  age=${age}`);
                console.log(`  Crew: ${miners}/${op.requiredMiners} miners  ${haulers}/${op.requiredHaulers} haulers`);
                for (const c of members) {
                    console.log(`  ${c.name}  role=${c.memory.role}  room=${c.room.name}  load=${c.store.getUsedCapacity()}`);
                }
            }
        },
        sk: (roomName) => {
            var _a, _b, _c, _d;
            if (roomName) {
                const err = launchSkOp(roomName);
                if (err)
                    console.log(`[SK] Cannot mine ${roomName} - ${err}`);
                else
                    console.log(`[SK] Operation started against ${roomName}`);
                return;
            }
            const ops = (_a = Memory.skOps) !== null && _a !== void 0 ? _a : [];
            if (ops.length === 0) {
                console.log("[SK] No active operations. Start one with Game.arca.sk('W5N4')");
                return;
            }
            for (const op of ops) {
                const members = getSkMembers(op.id);
                const counts = {};
                let energyHauled = 0;
                for (const c of members) {
                    counts[c.memory.role] = ((_b = counts[c.memory.role]) !== null && _b !== void 0 ? _b : 0) + 1;
                    energyHauled += (_d = (_c = c.store) === null || _c === void 0 ? void 0 : _c.getUsedCapacity(RESOURCE_ENERGY)) !== null && _d !== void 0 ? _d : 0;
                }
                const paused = isOpPaused(op) ? "  PAUSED(contested)" : "";
                console.log(`[SK] #${op.id} ${op.homeRoom} -> ${op.roomName}  phase=${op.phase}  ` +
                    `sources=${op.sourceIds.length}  squad=${JSON.stringify(counts)}${paused}`);
            }
        },
        skstop: (roomName) => {
            if (!roomName) {
                console.log("[SK] Usage: Game.arca.skstop('W5N4')");
                return;
            }
            if (cancelSkOp(roomName))
                console.log(`[SK] Operation against ${roomName} cancelled`);
            else
                console.log(`[SK] No operation found for ${roomName}`);
        },
        traffic: (enabled) => {
            if (enabled === undefined) {
                console.log(`[Traffic] manager is ${Memory.trafficDisabled ? "OFF" : "ON"}`);
                return;
            }
            Memory.trafficDisabled = !enabled;
            console.log(`[Traffic] manager ${enabled ? "ENABLED" : "DISABLED"}`);
        },
        cpu: () => {
            const stats = getCpuStats();
            const rows = Object.entries(stats).sort((a, b) => b[1].ema - a[1].ema);
            const total = rows.reduce((sum, [, s]) => sum + s.ema, 0);
            console.log(`[CPU] limit=${Game.cpu.limit} bucket=${Game.cpu.bucket} avgTotal=${total.toFixed(2)}`);
            for (const [name, s] of rows) {
                console.log(`  ${name.padEnd(14)} avg=${s.ema.toFixed(2)} last=${s.last.toFixed(2)} peak=${s.peak.toFixed(2)}`);
            }
            const roles = Object.entries(getRoleStats()).sort((a, b) => b[1].ema - a[1].ema);
            if (roles.length === 0)
                return;
            console.log(`[CPU] per creep, by role${Memory.profileRoles ? "" : " (stale: Memory.profileRoles is off)"}`);
            for (const [name, s] of roles) {
                console.log(`  ${name.padEnd(14)} avg=${s.ema.toFixed(2)} last=${s.last.toFixed(2)} peak=${s.peak.toFixed(2)}`);
            }
        },
        ledger: () => {
            var _a;
            const all = (_a = Memory.exchequer) !== null && _a !== void 0 ? _a : {};
            const names = Object.keys(all);
            if (names.length === 0) {
                console.log("[Exchequer] The books are not closed yet - check back in 100 ticks");
                return;
            }
            for (const name of names) {
                const books = all[name];
                console.log(`[Exchequer] ${name}, gold a tick as of tick ${books.at}:`);
                for (const line of describeBooks(books))
                    console.log(`  ${line}`);
                if (books.trend !== undefined)
                    console.log(`  treasury ${books.trend >= 0 ? "+" : ""}${books.trend}/t`);
            }
        },
        chronicle: (count = 20) => {
            const entries = recentChronicle(count);
            if (entries.length === 0) {
                console.log("[Chronicle] Nothing worth writing down has happened yet");
                return;
            }
            console.log("[Chronicle] The Royal Chronicle, newest last:");
            for (const e of entries)
                console.log(`  ${chronicleDate(e.t)}: ${e.text}`);
        },
        name: (roomName, name) => {
            const mem = Memory.rooms[roomName];
            if (!mem) {
                console.log(`[ARCA] No memory for ${roomName}`);
                return;
            }
            if (name)
                mem.townName = name;
            else
                delete mem.townName;
            console.log(`[ARCA] ${roomName} is now known as ${castleName(roomName)}`);
        },
        powercreeps: () => {
            var _a, _b, _c, _d;
            const names = Object.keys(Game.powerCreeps);
            if (names.length === 0) {
                console.log(`[Power] No power creeps. GPL ${Game.gpl.level} - one will be created automatically when GPL >= 1.`);
                return;
            }
            for (const name of names) {
                const pc = Game.powerCreeps[name];
                const loc = pc.ticksToLive === undefined
                    ? pc.spawnCooldownTime && Date.now() < pc.spawnCooldownTime
                        ? `unspawned (cooldown ${Math.ceil((pc.spawnCooldownTime - Date.now()) / 60000)}min)`
                        : "unspawned (ready)"
                    : `${(_b = (_a = pc.room) === null || _a === void 0 ? void 0 : _a.name) !== null && _b !== void 0 ? _b : "?"}  ttl=${pc.ticksToLive}`;
                const ops = (_d = (_c = pc.store) === null || _c === void 0 ? void 0 : _c.getUsedCapacity(RESOURCE_OPS)) !== null && _d !== void 0 ? _d : 0;
                const powers = Object.keys(pc.powers)
                    .map((p) => `${p}:L${pc.powers[Number(p)].level}`)
                    .join(" ");
                console.log(`[Power] ${name}  L${pc.level}  ${loc}  ops=${ops}  powers=[${powers}]`);
            }
            console.log(`[Power] GPL ${Game.gpl.level} (${Game.gpl.progress}/${Game.gpl.progressTotal})`);
        },
        autoLabs: (roomName, enabled) => {
            var _a;
            const room = Game.rooms[roomName];
            if (!((_a = room === null || room === void 0 ? void 0 : room.controller) === null || _a === void 0 ? void 0 : _a.my)) {
                console.log(`[Labs] ${roomName} is not a room you own`);
                return;
            }
            if (!room.memory.labSystem)
                room.memory.labSystem = { queue: [] };
            room.memory.labSystem.autoEnabled = enabled;
            console.log(`[Labs] ${roomName}: Auto-production ${enabled ? "ENABLED" : "DISABLED"}`);
        },
        factory: () => {
            const lines = describeFactories();
            if (lines.length === 0) {
                console.log("[Factory] No factories found (need RCL 7+ and a built factory)");
                return;
            }
            for (const line of lines)
                console.log(line);
        },
        produceCommodity: (roomName, commodity) => {
            if (!roomName || !commodity) {
                console.log("[Factory] Usage: Game.arca.produceCommodity('W1N1', 'battery')");
                return;
            }
            const err = forceCommodity(roomName, commodity);
            if (err) {
                console.log(`[Factory] ${err}`);
                return;
            }
            console.log(`[Factory] ${roomName}: now producing ${commodity}`);
        },
        town: (roomName) => {
            const rooms = roomName
                ? [Game.rooms[roomName]].filter((r) => { var _a; return (_a = r === null || r === void 0 ? void 0 : r.controller) === null || _a === void 0 ? void 0 : _a.my; })
                : Object.values(Game.rooms).filter((r) => { var _a; return (_a = r.controller) === null || _a === void 0 ? void 0 : _a.my; });
            if (rooms.length === 0) {
                console.log(`[Town] ${roomName !== null && roomName !== void 0 ? roomName : "No room"} is not a room you own`);
                return;
            }
            const clock = townClock(Game.time);
            console.log(`[Town] ${String(clock.hour).padStart(2, "0")}:00, ${clock.phase}`);
            for (const room of rooms) {
                for (const line of describeTown(room))
                    console.log(line);
                const folk = Object.values(Game.creeps).filter((c) => c.memory.role === ROLE_TOWNSFOLK && c.memory.homeRoom === room.name);
                if (folk.length === 0)
                    continue;
                const militia = folk.filter((c) => c.memory.job !== "lookout");
                const lookouts = folk.filter((c) => c.memory.job === "lookout");
                console.log(`  Militia: ${militia.length}${militia.some((c) => c.memory.working) ? " (on the walls!)" : ""}`);
                for (const c of lookouts) {
                    const away = c.memory.retreatUntil !== undefined && Game.time < c.memory.retreatUntil;
                    console.log(`  Lookout ${c.name} -> ${c.memory.targetRoom}${away ? " (fled home)" : ""}`);
                }
            }
        },
        blueprint: (roomName, action) => {
            const rooms = roomName
                ? [Game.rooms[roomName]].filter((r) => { var _a; return (_a = r === null || r === void 0 ? void 0 : r.controller) === null || _a === void 0 ? void 0 : _a.my; })
                : Object.values(Game.rooms).filter((r) => { var _a; return (_a = r.controller) === null || _a === void 0 ? void 0 : _a.my; });
            if (rooms.length === 0) {
                console.log("[Blueprint] Usage: Game.arca.blueprint('W1N1')  or  Game.arca.blueprint('W1N1', 'replan')");
                return;
            }
            for (const room of rooms) {
                if (action === "replan") {
                    delete room.memory.blueprint;
                    room.memory.lastStructurePlanTick = 0;
                    console.log(`[Blueprint] ${room.name}: planned afresh on the next tick`);
                    continue;
                }
                for (const line of describeBlueprint(room))
                    console.log(line);
                showBlueprint(room.name);
            }
        },
        razeTown: (roomName) => {
            var _a;
            const room = Game.rooms[roomName];
            if (!((_a = room === null || room === void 0 ? void 0 : room.controller) === null || _a === void 0 ? void 0 : _a.my)) {
                console.log("[Town] Usage: Game.arca.razeTown('W1N1') - tears the quarter down to be planned afresh");
                return;
            }
            const razed = razeTown(room);
            console.log(`[Town] ${roomName}: ${razed} town walls and ramparts torn down; the quarter will be planned anew`);
        },
        autoFactory: (roomName, enabled) => {
            if (!roomName || enabled === undefined) {
                console.log("[Factory] Usage: Game.arca.autoFactory('W1N1', true)");
                return;
            }
            const err = setAuto(roomName, enabled);
            if (err) {
                console.log(`[Factory] ${err}`);
                return;
            }
            console.log(`[Factory] ${roomName}: Auto-production ${enabled ? "ENABLED" : "DISABLED"}`);
        },
    };
}

const CPU_WARN_THRESHOLD = 0.85;
const CPU_SKIP_STRUCTURES_THRESHOLD = 0.70;
const CPU_SKIP_VISUALS_THRESHOLD = 0.75;
const CPU_SKIP_HEAVY_THRESHOLD = 0.80;
const CPU_BUCKET_CRITICAL = 2000;
const CPU_BUCKET_FLOOR = 500;
let lastTickUsed = 0;
function loop() {
    setupConsole();
    const tickStart = Game.cpu.getUsed();
    const limit = Game.cpu.limit;
    const bucketCritical = typeof Game.cpu.bucket === "number" &&
        (Game.cpu.bucket < CPU_BUCKET_FLOOR ||
            (Game.cpu.bucket < CPU_BUCKET_CRITICAL &&
                !(inPixelRefill() && lastTickUsed <= limit)));
    const cpuFraction = (used) => (limit ? used / limit : 0);
    const heavyShed = () => bucketCritical || cpuFraction(Game.cpu.getUsed() - tickStart) >= CPU_SKIP_HEAVY_THRESHOLD;
    runSafe("memory", () => loop$h());
    runSafe("rebrand", () => migrateRoleNames());
    runSafe("strategy", () => loop$a());
    runSafe("allies", () => runAllies());
    runSafe("expansion", () => loop$9());
    runSafe("score", () => loop$f());
    runSafe("creeps", () => loop$e());
    runSafe("spawning", () => loop$7());
    const cpuAfterCore = Game.cpu.getUsed() - tickStart;
    if (!bucketCritical && cpuFraction(cpuAfterCore) < CPU_SKIP_STRUCTURES_THRESHOLD) {
        runSafe("structures", () => loop$6());
    }
    if (!heavyShed())
        runSafe("labs", () => loop$d());
    if (!heavyShed())
        runSafe("factory", () => loop$c());
    runSafe("links", () => loop$l());
    runSafe("towers", () => loop$5());
    runSafe("terminal", () => loop$j());
    runSafe("military", () => loop$i());
    runSafe("nukes", () => loop$4());
    if (!heavyShed())
        runSafe("nuker", () => loop$k());
    runSafe("sourcekeeper", () => loop$g());
    runSafe("powercreep", () => loop$3());
    if (!heavyShed())
        runSafe("observer", () => loop$2());
    if (!heavyShed())
        runSafe("exchequer", () => loop$8());
    if (!heavyShed())
        runSafe("pixels", () => loop$b());
    const cpuBeforeVisuals = Game.cpu.getUsed() - tickStart;
    if (!bucketCritical && cpuFraction(cpuBeforeVisuals) < CPU_SKIP_VISUALS_THRESHOLD) {
        runSafe("visuals", () => loop$1());
    }
    const used = Game.cpu.getUsed() - tickStart;
    lastTickUsed = Game.cpu.getUsed();
    if (limit && used / limit > CPU_WARN_THRESHOLD) {
        console.log(`[CPU] High usage: ${used.toFixed(1)}/${limit} (${((used / limit) * 100).toFixed(0)}%) bucket=${Game.cpu.bucket}`);
    }
}
function runSafe(name, fn) {
    const start = Game.cpu.getUsed();
    try {
        fn();
    }
    catch (e) {
        const msg = e instanceof Error ? `${e.message}\n${e.stack}` : String(e);
        console.log(`[ERROR] System "${name}" threw: ${msg}`);
    }
    finally {
        recordCpu(name, Game.cpu.getUsed() - start);
    }
}

exports.loop = loop;
