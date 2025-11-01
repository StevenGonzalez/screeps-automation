'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

const ROLE_BUILDER = "builder";
const ROLE_HARVESTER = "harvester";
const ROLE_UPGRADER = "upgrader";
const ROLE_REPAIRER = "repairer";
const ROLE_MINER = "miner";
const ROLE_HAULER = "hauler";
const ENERGY_DEPOSIT_PRIORITY = {
    harvester: [
        STRUCTURE_SPAWN,
        STRUCTURE_EXTENSION,
        STRUCTURE_CONTAINER,
        STRUCTURE_STORAGE,
    ],
    upgrader: [STRUCTURE_CONTROLLER],
    builder: [],
    repairer: [STRUCTURE_STORAGE, STRUCTURE_CONTAINER],
    miner: [STRUCTURE_CONTAINER, STRUCTURE_STORAGE],
    hauler: [
        STRUCTURE_SPAWN,
        STRUCTURE_EXTENSION,
        STRUCTURE_TOWER,
        STRUCTURE_STORAGE,
        STRUCTURE_CONTAINER,
    ],
};

function findEnergyDepositTarget(creep, role) {
    const priorityList = ENERGY_DEPOSIT_PRIORITY[role] || [];
    const targets = creep.room.find(FIND_STRUCTURES, {
        filter: (structure) => {
            return (priorityList.includes(structure.structureType) &&
                "store" in structure &&
                structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0);
        },
    });
    if (targets.length > 0) {
        return creep.pos.findClosestByPath(targets);
    }
    return null;
}
function getSources(room, ttl = 100) {
    if (!Memory.sources)
        Memory.sources = {};
    if (!Memory.sourcesLastScan)
        Memory.sourcesLastScan = {};
    const lastScan = Memory.sourcesLastScan[room.name] || 0;
    if (!Memory.sources[room.name] || Game.time - lastScan > ttl) {
        Memory.sources[room.name] = room.find(FIND_SOURCES).map((s) => s.id);
        Memory.sourcesLastScan[room.name] = Game.time;
    }
    const sourceIds = Memory.sources[room.name];
    return sourceIds
        .map((id) => Game.getObjectById(id))
        .filter(Boolean);
}
function harvestFromSource(creep, source) {
    if (creep.harvest(source) === ERR_NOT_IN_RANGE) {
        creep.moveTo(source);
    }
}
function acquireEnergy(creep) {
    const storeTargets = creep.room.find(FIND_STRUCTURES, {
        filter: (s) => (s.structureType === STRUCTURE_CONTAINER ||
            s.structureType === STRUCTURE_STORAGE) &&
            "store" in s &&
            s.store[RESOURCE_ENERGY] > 0,
    });
    const upgradeId = creep.room.memory.upgradeContainerId;
    let nonUpgradeTargets = storeTargets;
    if (upgradeId) {
        nonUpgradeTargets = storeTargets.filter((s) => s.id !== upgradeId);
    }
    let chosenTarget = null;
    if (nonUpgradeTargets.length > 0) {
        chosenTarget = creep.pos.findClosestByPath(nonUpgradeTargets);
    }
    else if (storeTargets.length > 0) {
        chosenTarget = creep.pos.findClosestByPath(storeTargets);
    }
    if (chosenTarget) {
        const res = creep.withdraw(chosenTarget, RESOURCE_ENERGY);
        if (res === ERR_NOT_IN_RANGE) {
            creep.moveTo(chosenTarget);
            return true;
        }
        return res === OK;
    }
    const links = creep.room.find(FIND_STRUCTURES, {
        filter: (s) => s.structureType === STRUCTURE_LINK && s.energy > 0,
    });
    if (links.length > 0) {
        const link = creep.pos.findClosestByPath(links);
        if (link) {
            const res = creep.withdraw(link, RESOURCE_ENERGY);
            if (res === ERR_NOT_IN_RANGE) {
                creep.moveTo(link);
                return true;
            }
            return res === OK;
        }
    }
    const tomb = creep.pos.findClosestByPath(FIND_TOMBSTONES, {
        filter: (t) => t.store && t.store[RESOURCE_ENERGY] > 0,
    });
    if (tomb) {
        const res = creep.withdraw(tomb, RESOURCE_ENERGY);
        if (res === ERR_NOT_IN_RANGE) {
            creep.moveTo(tomb);
            return true;
        }
        return res === OK;
    }
    const dropped = creep.pos.findClosestByPath(FIND_DROPPED_RESOURCES, {
        filter: (d) => d.resourceType === RESOURCE_ENERGY,
    });
    if (dropped) {
        const res = creep.pickup(dropped);
        if (res === ERR_NOT_IN_RANGE) {
            creep.moveTo(dropped);
            return true;
        }
        return res === OK;
    }
    const source = creep.pos.findClosestByPath(FIND_SOURCES_ACTIVE);
    if (source) {
        const res = creep.harvest(source);
        if (res === ERR_NOT_IN_RANGE) {
            creep.moveTo(source);
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
function withdrawFromControllerContainer(creep) {
    const controller = creep.room.controller;
    if (!controller)
        return false;
    const containers = creep.room.find(FIND_STRUCTURES, {
        filter: (s) => s.structureType === STRUCTURE_CONTAINER &&
            s.pos.getRangeTo(controller.pos) <= 2,
    });
    const containerWithEnergy = containers.find((c) => c.store && c.store[RESOURCE_ENERGY] > 0);
    if (containerWithEnergy) {
        const res = creep.withdraw(containerWithEnergy, RESOURCE_ENERGY);
        if (res === ERR_NOT_IN_RANGE) {
            creep.moveTo(containerWithEnergy);
            return true;
        }
        return res === OK;
    }
    return false;
}
function isCreepEmpty(creep) {
    return creep.store[RESOURCE_ENERGY] === 0;
}
function isCreepFull(creep) {
    return creep.store.getFreeCapacity() === 0;
}
function transferEnergyTo(creep, target) {
    if (creep.transfer(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
        creep.moveTo(target);
    }
}
function findClosestConstructionSite(creep) {
    const sites = creep.room.find(FIND_CONSTRUCTION_SITES);
    if (!sites || sites.length === 0)
        return null;
    const nonRoadSites = sites.filter((s) => s.structureType !== STRUCTURE_ROAD);
    if (nonRoadSites.length > 0) {
        return creep.pos.findClosestByPath(nonRoadSites) || null;
    }
    return creep.pos.findClosestByPath(sites) || null;
}
function findClosestRepairTarget(creep) {
    const repairTargets = creep.room.find(FIND_STRUCTURES, {
        filter: (s) => {
            const hasHits = s.hits !== undefined && s.hitsMax !== undefined;
            if (!hasHits)
                return false;
            if (s.structureType === STRUCTURE_WALL ||
                s.structureType === STRUCTURE_RAMPART)
                return false;
            return s.hits < s.hitsMax;
        },
    });
    if (repairTargets.length === 0)
        return null;
    return creep.pos.findClosestByPath(repairTargets) || null;
}
function findMostCriticalRepairTarget(creep) {
    const damaged = creep.room.find(FIND_STRUCTURES, {
        filter: (s) => {
            const hasHits = s.hits !== undefined && s.hitsMax !== undefined;
            return hasHits && s.hits < s.hitsMax;
        },
    });
    if (damaged.length === 0)
        return null;
    const nonDefensive = damaged.filter((s) => s.structureType !== STRUCTURE_RAMPART &&
        s.structureType !== STRUCTURE_WALL);
    if (nonDefensive.length > 0) {
        return nonDefensive.reduce((a, b) => (a.hits < b.hits ? a : b));
    }
    const RAMPART_CRITICAL = 1000;
    const criticalDefensive = damaged.filter((s) => (s.structureType === STRUCTURE_RAMPART ||
        s.structureType === STRUCTURE_WALL) &&
        s.hits < RAMPART_CRITICAL);
    if (criticalDefensive.length > 0) {
        return criticalDefensive.reduce((a, b) => (a.hits < b.hits ? a : b));
    }
    return damaged.reduce((a, b) => (a.hits < b.hits ? a : b));
}
function findTowerRepairTarget(room) {
    const decayThreshold = 1000;
    const candidates = room.find(FIND_STRUCTURES, {
        filter: (s) => {
            const hasHits = s.hits !== undefined && s.hitsMax !== undefined;
            if (!hasHits)
                return false;
            if (s.structureType === STRUCTURE_RAMPART ||
                s.structureType === STRUCTURE_WALL) {
                return s.hits < decayThreshold;
            }
            return s.hits < s.hitsMax * 0.1;
        },
    });
    if (candidates.length === 0)
        return null;
    return candidates.reduce((a, b) => (a.hits < b.hits ? a : b));
}
function getClosestContainerOrStorage(creep) {
    const allTargets = creep.room.find(FIND_STRUCTURES, {
        filter: (s) => (s.structureType === STRUCTURE_CONTAINER ||
            s.structureType === STRUCTURE_STORAGE) &&
            "store" in s &&
            s.store[RESOURCE_ENERGY] > 0,
    });
    if (allTargets.length === 0)
        return null;
    const upgradeId = creep.room.memory.upgradeContainerId;
    let nonUpgrade = allTargets;
    if (upgradeId)
        nonUpgrade = allTargets.filter((s) => s.id !== upgradeId);
    if (nonUpgrade.length > 0)
        return creep.pos.findClosestByPath(nonUpgrade);
    return creep.pos.findClosestByPath(allTargets);
}
function getMinerContainerIds(room) {
    if (room.memory && room.memory.minerContainerIds) {
        return room.memory.minerContainerIds;
    }
    const sources = room.find(FIND_SOURCES);
    const containers = room.find(FIND_STRUCTURES, {
        filter: (s) => s.structureType === STRUCTURE_CONTAINER,
    });
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
    return creep.pos.findClosestByPath(withEnergy) || null;
}
function findDepositTargetExcludingMiner(creep, role) {
    const minerIds = getMinerContainerIds(creep.room).map((id) => id.toString());
    const priorityTarget = findEnergyDepositTarget(creep, role);
    if (priorityTarget && minerIds.indexOf(priorityTarget.id) === -1)
        return priorityTarget;
    if (role === "hauler") {
        const upgradeId = creep.room.memory.upgradeContainerId;
        if (upgradeId) {
            const upgradeCont = Game.getObjectById(upgradeId);
            if (upgradeCont &&
                upgradeCont.store.getFreeCapacity(RESOURCE_ENERGY) > 0 &&
                minerIds.indexOf(upgradeCont.id) === -1) {
                return upgradeCont;
            }
        }
    }
    const targets = creep.room.find(FIND_STRUCTURES, {
        filter: (s) => (s.structureType === STRUCTURE_CONTAINER ||
            s.structureType === STRUCTURE_STORAGE) &&
            "store" in s &&
            s.store.getFreeCapacity(RESOURCE_ENERGY) > 0 &&
            minerIds.indexOf(s.id) === -1,
    });
    if (targets.length === 0)
        return null;
    return creep.pos.findClosestByPath(targets);
}
function upgradeController(creep) {
    const controller = creep.room.controller;
    if (!controller)
        return;
    if (signControllerIfNeeded(creep, controller))
        return;
    if (creep.upgradeController(controller) === ERR_NOT_IN_RANGE) {
        creep.moveTo(controller);
    }
}
function signControllerIfNeeded(creep, controller) {
    const desiredSignature = "Under New Management";
    const currentSign = controller.sign;
    const myUsername = (controller.owner && controller.owner.username) || undefined;
    if (!currentSign ||
        currentSign.username !== myUsername ||
        currentSign.text !== desiredSignature) {
        if (creep.pos.getRangeTo(controller.pos) > 1) {
            creep.moveTo(controller);
            return true;
        }
        else {
            creep.signController(controller, desiredSignature);
            creep.room.memory.lastSigned = Game.time;
            return true;
        }
    }
    return false;
}
function buildAtConstructionSite(creep, site) {
    const res = creep.build(site);
    if (res === ERR_NOT_IN_RANGE)
        return creep.moveTo(site);
    return res;
}
function repairStructure(creep, target) {
    const res = creep.repair(target);
    if (res === ERR_NOT_IN_RANGE)
        return creep.moveTo(target.pos.x, target.pos.y);
    return res;
}
function findContainersForSource(room, source) {
    return room.find(FIND_STRUCTURES, {
        filter: (s) => s.structureType === STRUCTURE_CONTAINER &&
            s.pos.getRangeTo(source.pos) <= 1,
    });
}
function findUnclaimedMinerAssignment(room) {
    const sources = getSources(room);
    for (const source of sources) {
        const containers = findContainersForSource(room, source);
        for (const container of containers) {
            const taken = Object.values(Game.creeps).some((c) => c.memory.role === "miner" &&
                c.memory.assignedContainerId === container.id);
            if (!taken) {
                return { source, container };
            }
        }
    }
    return null;
}
function findUnclaimedHaulerAssignment(room) {
    const containers = room.find(FIND_STRUCTURES, {
        filter: (s) => s.structureType === STRUCTURE_CONTAINER,
    });
    for (const container of containers) {
        const taken = Object.values(Game.creeps).some((c) => c.memory.role === "hauler" &&
            c.memory.assignedContainerId === container.id);
        if (!taken) {
            return container;
        }
    }
    return null;
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
        if (depositTarget) {
            transferEnergyTo(creep, depositTarget);
        }
        else {
            upgradeController(creep);
        }
    }
    else {
        const sources = getSources(creep.room);
        if (sources.length > 0) {
            harvestFromSource(creep, sources[0]);
        }
    }
}

function runUpgrader(creep) {
    if (creep.memory.working === undefined)
        creep.memory.working = false;
    if (creep.memory.working && isCreepEmpty(creep)) {
        creep.memory.working = false;
    }
    if (!creep.memory.working && isCreepFull(creep)) {
        creep.memory.working = true;
    }
    if (creep.memory.working) {
        upgradeController(creep);
    }
    else {
        const upgradeId = creep.room.memory.upgradeContainerId;
        if (upgradeId) {
            const upgradeCont = Game.getObjectById(upgradeId);
            if (upgradeCont &&
                upgradeCont.store &&
                upgradeCont.store[RESOURCE_ENERGY] > 0) {
                if (withdrawFromContainer(creep, upgradeCont))
                    return;
            }
        }
        if (withdrawFromControllerContainer(creep))
            return;
        const closestMinerContainer = findClosestMinerContainerWithEnergy(creep);
        if (closestMinerContainer) {
            if (withdrawFromContainer(creep, closestMinerContainer))
                return;
        }
        const storage = creep.room.storage;
        if (storage && storage.store && storage.store[RESOURCE_ENERGY] > 0) {
            const res = creep.withdraw(storage, RESOURCE_ENERGY);
            if (res === ERR_NOT_IN_RANGE) {
                creep.moveTo(storage);
                return;
            }
            if (res === OK)
                return;
        }
        const sources = getSources(creep.room);
        if (sources.length > 0) {
            harvestFromSource(creep, sources[0]);
        }
    }
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
        acquireEnergy(creep);
        return;
    }
    const site = findClosestConstructionSite(creep);
    if (site) {
        const res = buildAtConstructionSite(creep, site);
        if (res === ERR_NOT_ENOUGH_RESOURCES)
            creep.memory.working = false;
        return;
    }
    const repairTarget = findClosestRepairTarget(creep);
    if (repairTarget) {
        const r = repairStructure(creep, repairTarget);
        if (r === ERR_NOT_ENOUGH_RESOURCES)
            creep.memory.working = false;
        return;
    }
    upgradeController(creep);
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
        const container = getClosestContainerOrStorage(creep);
        if (container) {
            if (creep.withdraw(container, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                creep.moveTo(container);
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
        if (res === ERR_NOT_ENOUGH_RESOURCES)
            creep.memory.working = false;
        return;
    }
    upgradeController(creep);
}

function runMiner(creep) {
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
        if (source && container) {
            if (!creep.pos.isEqualTo(container.pos)) {
                creep.moveTo(container.pos);
                return;
            }
            harvestFromSource(creep, source);
            return;
        }
    }
    const sources = getSources(creep.room);
    if (sources.length === 0)
        return;
    for (const source of sources) {
        const containers = creep.room.find(FIND_STRUCTURES, {
            filter: (s) => s.structureType === STRUCTURE_CONTAINER &&
                s.pos.getRangeTo(source.pos) <= 1,
        });
        if (containers.length > 0) {
            const container = containers[0];
            if (!creep.pos.isEqualTo(container.pos)) {
                creep.moveTo(container.pos);
                return;
            }
            harvestFromSource(creep, source);
            return;
        }
    }
}

function runHauler(creep) {
    if (!creep.memory.assignedContainerId) {
        const assignment = findUnclaimedHaulerAssignment(creep.room);
        if (assignment) {
            creep.memory.assignedContainerId = assignment.id;
        }
    }
    if (isCreepEmpty(creep)) {
        const dropped = creep.pos.findClosestByPath(FIND_DROPPED_RESOURCES, {
            filter: (d) => d.resourceType === RESOURCE_ENERGY && d.amount > 50,
        });
        if (dropped) {
            if (pickupDroppedResource(creep, dropped))
                return;
            return;
        }
        const minerContainer = findClosestMinerContainerWithEnergy(creep);
        if (minerContainer) {
            if (withdrawFromContainer(creep, minerContainer))
                return;
            return;
        }
        acquireEnergy(creep);
        return;
    }
    const targets = creep.room.find(FIND_STRUCTURES, {
        filter: (s) => (s.structureType === STRUCTURE_SPAWN ||
            s.structureType === STRUCTURE_EXTENSION ||
            s.structureType === STRUCTURE_TOWER) &&
            "store" in s &&
            s.store.getFreeCapacity(RESOURCE_ENERGY) > 0,
    });
    if (targets.length > 0) {
        const target = creep.pos.findClosestByPath(targets);
        if (target) {
            transferEnergyTo(creep, target);
            return;
        }
    }
    const depositTarget = findDepositTargetExcludingMiner(creep, "hauler");
    if (depositTarget) {
        transferEnergyTo(creep, depositTarget);
        return;
    }
    const idle = getClosestContainerOrStorage(creep) || creep.room.find(FIND_MY_SPAWNS)[0];
    if (idle && !creep.pos.isNearTo(idle)) {
        creep.moveTo(idle);
    }
}

function loop$6() {
    for (const name in Game.creeps) {
        const creep = Game.creeps[name];
        processCreep(creep);
    }
}
function processCreep(creep) {
    if (creep.memory.role === ROLE_HARVESTER) {
        runHarvester(creep);
    }
    else if (creep.memory.role === ROLE_UPGRADER) {
        runUpgrader(creep);
    }
    else if (creep.memory.role === ROLE_BUILDER) {
        runBuilder(creep);
    }
    else if (creep.memory.role === ROLE_REPAIRER) {
        runRepairer(creep);
    }
    else if (creep.memory.role === ROLE_MINER) {
        runMiner(creep);
    }
    else if (creep.memory.role === ROLE_HAULER) {
        runHauler(creep);
    }
}

function loop$5() {
    cleanupDeadCreeps();
    initializeMemory();
    for (const roomName in Game.rooms) {
        const room = Game.rooms[roomName];
        processRoomMemory(room);
    }
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
    if (!room.memory.lastScan || Game.time - room.memory.lastScan > 100) {
        const spawns = room.find(FIND_MY_SPAWNS);
        room.memory.spawnId = spawns.length > 0 ? spawns[0].id : undefined;
        const sources = room.find(FIND_SOURCES);
        room.memory.sourceIds = sources.map((s) => s.id);
        const minerals = room.find(FIND_MINERALS);
        room.memory.mineralId = minerals.length > 0 ? minerals[0].id : undefined;
        const containers = room.find(FIND_STRUCTURES, {
            filter: (s) => s.structureType === STRUCTURE_CONTAINER,
        });
        room.memory.containerIds = containers.map((c) => c.id);
        const sourceList = room.find(FIND_SOURCES);
        const minerContainerIds = [];
        for (const c of containers) {
            for (const s of sourceList) {
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
        const towers = room.find(FIND_STRUCTURES, {
            filter: (s) => s.structureType === STRUCTURE_TOWER,
        });
        room.memory.towerIds = towers.map((t) => t.id);
        room.memory.lastScan = Game.time;
    }
}

function loop$4() {
    processPixelGeneration();
}
function processPixelGeneration() {
    if (Game.cpu.bucket === 10000) {
        Game.cpu.generatePixel();
    }
}

const BUILDER_BODY = [WORK, CARRY, MOVE];
const HARVESTER_BODY = [WORK, CARRY, MOVE];
const UPGRADER_BODY = [WORK, CARRY, MOVE];
const HAULER_BODY = [CARRY, CARRY, MOVE];
const REPAIRER_BODY = [WORK, CARRY, MOVE];
const BODY_PATTERNS = {
    harvester: HARVESTER_BODY,
    upgrader: UPGRADER_BODY,
    builder: BUILDER_BODY,
    hauler: HAULER_BODY,
    repairer: REPAIRER_BODY,
};
const MAX_BODY_PART_COUNT = 50;
const SPAWN_ENERGY_RESERVE = 0.25;

function getRoomMemory(room) {
    return room.memory;
}

function loop$3() {
    for (const roomName in Game.rooms) {
        const room = Game.rooms[roomName];
        processRoomSpawning(room);
    }
}
function buildScaledBody(role, availableEnergy) {
    if (role === "harvester") {
        const body = [];
        let energyLeft = availableEnergy;
        while (energyLeft >= 200) {
            body.push(WORK, CARRY, MOVE);
            energyLeft -= 200;
        }
        return body;
    }
    const pattern = BODY_PATTERNS[role];
    if (!pattern) {
        return [WORK, CARRY, MOVE];
    }
    const patternCost = calculateBodyPartCost(pattern);
    const body = [];
    let timesToRepeat = Math.floor(availableEnergy / patternCost);
    timesToRepeat = Math.min(timesToRepeat, Math.floor(MAX_BODY_PART_COUNT / pattern.length));
    for (let i = 0; i < timesToRepeat; i++) {
        body.push(...pattern);
    }
    if (body.length === 0) {
        return pattern;
    }
    return body;
}
function calculateBodyPartCost(parts) {
    return parts.reduce((cost, part) => cost + BODYPART_COST[part], 0);
}
function getCreepsByRole(role) {
    return Object.values(Game.creeps).filter((creep) => creep.memory.role === role);
}
function getMinerPopulationTarget(room) {
    const sources = getSources(room);
    let count = 0;
    for (const source of sources) {
        const containers = room.find(FIND_STRUCTURES, {
            filter: (s) => s.structureType === STRUCTURE_CONTAINER &&
                s.pos.getRangeTo(source.pos) <= 1,
        });
        if (containers.length > 0)
            count++;
    }
    return count;
}
function getHarvesterPopulationTarget(room) {
    const minerCount = getCreepsByRole(ROLE_MINER).filter((c) => c.room.name === room.name).length;
    return Math.max(0, 2 - minerCount);
}
function getPopulationTarget(role, room) {
    if (role === ROLE_HARVESTER)
        return 2;
    if (role === ROLE_UPGRADER) {
        let base = 1;
        if (room.controller && room.controller.level >= 6)
            base++;
        const storage = room.storage;
        if (storage && storage.store[RESOURCE_ENERGY] > 50000)
            base += Math.floor(storage.store[RESOURCE_ENERGY] / 50000);
        if (room.energyAvailable > 1500)
            base++;
        return Math.min(base, 4);
    }
    if (role === ROLE_BUILDER)
        return 1;
    return 0;
}
function getSpawnForRoom(room) {
    const roomMemory = getRoomMemory(room);
    if (!roomMemory.spawnId)
        return null;
    return Game.getObjectById(roomMemory.spawnId);
}
function processRoomSpawning(room) {
    const spawn = getSpawnForRoom(room);
    if (!spawn)
        return;
    if (spawn.spawning)
        return;
    if (shouldSpawnMiner(room) && spawnMiner(room, spawn))
        return;
    if (shouldSpawnHauler(room) && spawnHauler(room, spawn))
        return;
    if (shouldSpawnHarvester(room) && spawnHarvester(room, spawn))
        return;
    if (shouldSpawnUpgrader(room) && spawnUpgrader(room, spawn))
        return;
    if (shouldSpawnBuilder(room) && spawnBuilder(room, spawn))
        return;
    if (shouldSpawnRepairer(room) && spawnRepairer(room, spawn))
        return;
}
function shouldSpawnHauler(room) {
    const WORKS_PER_HAULER = 5;
    const DISTANCE_LONG = 20;
    const MAX_HAULERS = 6;
    const containers = room.find(FIND_STRUCTURES, {
        filter: (s) => s.structureType === STRUCTURE_CONTAINER,
    });
    const haulers = getCreepsByRole(ROLE_HAULER).filter((c) => c.room.name === room.name);
    if (containers.length === 0)
        return false;
    const targetFromContainers = containers.length;
    const totalMinerWork = Object.values(Game.creeps)
        .filter((c) => { var _a; return c.memory.role === ROLE_MINER && ((_a = c.room) === null || _a === void 0 ? void 0 : _a.name) === room.name; })
        .reduce((sum, c) => sum + (c.body.filter((p) => p.type === WORK).length || 0), 0);
    const targetFromWork = Math.ceil(totalMinerWork / WORKS_PER_HAULER);
    const spawn = getSpawnForRoom(room);
    let extraLong = 0;
    if (spawn) {
        for (const container of containers) {
            const path = spawn.pos.findPathTo(container.pos, { ignoreCreeps: true });
            if (path.length > DISTANCE_LONG)
                extraLong++;
        }
    }
    const desired = Math.min(MAX_HAULERS, Math.max(targetFromContainers, targetFromWork + extraLong));
    return haulers.length < desired;
}
function spawnHauler(room, spawn) {
    const newName = `${ROLE_HAULER}${Game.time}`;
    const allowedEnergy = Math.floor(room.energyAvailable * (1 - SPAWN_ENERGY_RESERVE));
    const body = buildScaledBody(ROLE_HAULER, allowedEnergy);
    const res = spawn.spawnCreep(body, newName, {
        memory: { role: ROLE_HAULER },
    });
    return res === OK;
}
function shouldSpawnMiner(room) {
    const miners = getCreepsByRole(ROLE_MINER).filter((c) => c.room.name === room.name);
    const target = getMinerPopulationTarget(room);
    return miners.length < target;
}
function shouldSpawnHarvester(room) {
    const harvesters = getCreepsByRole(ROLE_HARVESTER).filter((c) => c.room.name === room.name);
    const targetPopulation = getHarvesterPopulationTarget(room);
    return harvesters.length < targetPopulation;
}
function shouldSpawnUpgrader(room) {
    const upgraders = getCreepsByRole(ROLE_UPGRADER);
    const targetPopulation = getPopulationTarget(ROLE_UPGRADER, room);
    return upgraders.length < targetPopulation;
}
function shouldSpawnBuilder(room) {
    const builders = getCreepsByRole(ROLE_BUILDER);
    const targetPopulation = getPopulationTarget(ROLE_BUILDER, room);
    if (builders.length >= targetPopulation)
        return false;
    const sites = room.find(FIND_CONSTRUCTION_SITES);
    return sites.length > 0;
}
function getRepairerPopulationTarget(room) {
    const critical = room.find(FIND_STRUCTURES, {
        filter: (s) => {
            const st = s;
            if (typeof st.hits !== "number" || typeof st.hitsMax !== "number")
                return false;
            return st.hits < st.hitsMax * 0.5;
        },
    });
    const criticalCount = critical.length;
    const perRepairer = 3;
    const cap = 3;
    const target = Math.min(cap, Math.ceil(criticalCount / perRepairer));
    return target;
}
function shouldSpawnRepairer(room) {
    const repairers = getCreepsByRole(ROLE_REPAIRER).filter((c) => { var _a; return ((_a = c.room) === null || _a === void 0 ? void 0 : _a.name) === room.name; });
    const target = getRepairerPopulationTarget(room);
    return repairers.length < target && target > 0;
}
function spawnRepairer(room, spawn) {
    const newName = `${ROLE_REPAIRER}${Game.time}`;
    const allowedEnergy = Math.floor(room.energyAvailable * (1 - SPAWN_ENERGY_RESERVE));
    const body = buildScaledBody(ROLE_REPAIRER, allowedEnergy);
    const res = spawn.spawnCreep(body, newName, {
        memory: { role: ROLE_REPAIRER },
    });
    return res === OK;
}
function spawnHarvester(room, spawn) {
    const newName = `${ROLE_HARVESTER}${Game.time}`;
    const allowedEnergy = Math.floor(room.energyAvailable * (1 - SPAWN_ENERGY_RESERVE));
    const body = buildScaledBody(ROLE_HARVESTER, allowedEnergy);
    const res = spawn.spawnCreep(body, newName, {
        memory: { role: ROLE_HARVESTER },
    });
    return res === OK;
}
function spawnUpgrader(room, spawn) {
    const newName = `${ROLE_UPGRADER}${Game.time}`;
    const allowedEnergy = Math.floor(room.energyAvailable * (1 - SPAWN_ENERGY_RESERVE));
    const body = buildScaledBody(ROLE_UPGRADER, allowedEnergy);
    const res = spawn.spawnCreep(body, newName, {
        memory: { role: ROLE_UPGRADER },
    });
    return res === OK;
}
function spawnBuilder(room, spawn) {
    const newName = `${ROLE_BUILDER}${Game.time}`;
    const allowedEnergy = Math.floor(room.energyAvailable * (1 - SPAWN_ENERGY_RESERVE));
    const body = buildScaledBody(ROLE_BUILDER, allowedEnergy);
    const res = spawn.spawnCreep(body, newName, {
        memory: { role: ROLE_BUILDER },
    });
    return res === OK;
}
function spawnMiner(room, spawn) {
    const newName = `${ROLE_MINER}${Game.time}`;
    const maxWorkParts = 5;
    const allowedEnergy = Math.floor(room.energyAvailable * (1 - SPAWN_ENERGY_RESERVE));
    let availableEnergy = allowedEnergy;
    const workCost = BODYPART_COST[WORK];
    const moveCost = BODYPART_COST[MOVE];
    let workParts = Math.min(Math.floor(availableEnergy / (workCost + moveCost)), maxWorkParts);
    const body = [];
    for (let i = 0; i < workParts; i++) {
        body.push(WORK, MOVE);
    }
    if (body.length === 0)
        body.push(WORK, MOVE);
    const res = spawn.spawnCreep(body, newName, {
        memory: { role: ROLE_MINER },
    });
    return res === OK;
}

const STRUCTURE_PLANNER = {
    containerOffset: 1,
    upgradeContainerOffset: 2,
    roadPadding: 0,
    rampartPadding: 1,
    towerOffsetsFromSpawn: [
        { x: 2, y: 0 },
        { x: -2, y: 0 },
        { x: 0, y: 2 },
        { x: 0, y: -2 },
    ],
    planInterval: 50,
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
    extensionOffsetsFromSpawn: [],
    maxExtensionsPerSpawn: 10,
    extensionSearchRadius: 6,
    extensionMinDistanceFromSpawn: 4,
    plannedRoadPruneTicks: 5000,
    extensionUseRing: false,
    extensionRingRadius: 2,
    extensionRingEntrances: 2,
};
const PLANNER_KEYS = {
    CONTAINER_PREFIX: "container",
    CONTAINER_SOURCE_PREFIX: "container_source_",
    CONTAINER_CONTROLLER: "container_controller",
    CONTAINER_MINERAL_PREFIX: "container_mineral_",
    ROAD_PREFIX: "road_",
    NODE_SOURCE_PREFIX: "node_source_",
    NODE_CONTROLLER: "node_controller",
    NODE_MINERAL_PREFIX: "node_mineral_",
    CONNECTOR_PREFIX: "connector_",
    TOWERS_PREFIX: "towers_for_",
    RAMPARTS_KEY: "ramparts",
    EXTENSIONS_PREFIX: "extensions_for_",
    STORAGE_PREFIX: "storage_for_",
};
const TOWER_COUNT_PER_RCL = {
    0: 0,
    1: 0,
    2: 0,
    3: 1,
    4: 1,
    5: 2,
    6: 2,
    7: 3,
    8: 6,
};

function isWalkable(room, x, y) {
    const look = room.getTerrain().get(x, y);
    return look !== TERRAIN_MASK_WALL;
}
function isBuildableTile(room, x, y) {
    if (x < 0 || x >= 50 || y < 0 || y >= 50)
        return false;
    if (!isWalkable(room, x, y))
        return false;
    const structures = room.lookForAt(LOOK_STRUCTURES, x, y);
    if (structures.length > 0)
        return false;
    const sites = room.lookForAt(LOOK_CONSTRUCTION_SITES, x, y);
    if (sites.length > 0)
        return false;
    return true;
}
function planSourceContainer(room, source) {
    const offset = STRUCTURE_PLANNER.containerOffset;
    const existing = source.pos.findInRange(FIND_STRUCTURES, offset, {
        filter: (s) => s.structureType === STRUCTURE_CONTAINER,
    });
    if (existing.length > 0)
        return null;
    const spawns = room.find(FIND_MY_SPAWNS);
    if (spawns.length > 0) {
        let bestResult = null;
        for (const s of spawns) {
            const res = PathFinder.search(s.pos, { pos: source.pos, range: 0 }, {
                plainCost: 2,
                swampCost: 10,
                maxOps: 2000,
            });
            if (!bestResult ||
                (res.path && res.path.length < bestResult.path.length)) {
                bestResult = res;
            }
        }
        if (bestResult && bestResult.path && bestResult.path.length > 0) {
            for (let i = bestResult.path.length - 1; i >= 0; i--) {
                const step = bestResult.path[i];
                for (let dx = -offset; dx <= offset; dx++) {
                    for (let dy = -offset; dy <= offset; dy++) {
                        if (dx === 0 && dy === 0)
                            continue;
                        const x = step.x + dx;
                        const y = step.y + dy;
                        const distX = Math.abs(x - source.pos.x);
                        const distY = Math.abs(y - source.pos.y);
                        if (distX > offset || distY > offset)
                            continue;
                        if (isBuildableTile(room, x, y))
                            return new RoomPosition(x, y, room.name);
                    }
                }
            }
        }
    }
    for (let dx = -offset; dx <= offset; dx++) {
        for (let dy = -offset; dy <= offset; dy++) {
            if (dx === 0 && dy === 0)
                continue;
            const x = source.pos.x + dx;
            const y = source.pos.y + dy;
            if (isBuildableTile(room, x, y))
                return new RoomPosition(x, y, room.name);
        }
    }
    return null;
}
function planControllerContainer(room, controller) {
    const offset = STRUCTURE_PLANNER.upgradeContainerOffset;
    for (let r = 1; r <= offset + 1; r++) {
        for (let dx = -r; dx <= r; dx++) {
            for (let dy = -r; dy <= r; dy++) {
                if (Math.abs(dx) !== r && Math.abs(dy) !== r)
                    continue;
                const x = controller.pos.x + dx;
                const y = controller.pos.y + dy;
                if (x < 0 || x >= 50 || y < 0 || y >= 50)
                    continue;
                if (!isWalkable(room, x, y))
                    continue;
                const structures = room.lookForAt(LOOK_STRUCTURES, x, y);
                const sites = room.lookForAt(LOOK_CONSTRUCTION_SITES, x, y);
                const hasContainer = structures.some((s) => s.structureType === STRUCTURE_CONTAINER);
                const hasContainerSite = sites.some((s) => s.structureType === STRUCTURE_CONTAINER);
                if (!hasContainer && !hasContainerSite)
                    return new RoomPosition(x, y, room.name);
            }
        }
    }
    return null;
}
function planMineralContainer(room, mineral) {
    const offset = STRUCTURE_PLANNER.containerOffset;
    const existing = mineral.pos.findInRange(FIND_STRUCTURES, offset, {
        filter: (s) => s.structureType === STRUCTURE_CONTAINER,
    });
    if (existing.length > 0)
        return null;
    for (let dx = -offset; dx <= offset; dx++) {
        for (let dy = -offset; dy <= offset; dy++) {
            if (dx === 0 && dy === 0)
                continue;
            const x = mineral.pos.x + dx;
            const y = mineral.pos.y + dy;
            if (isBuildableTile(room, x, y))
                return new RoomPosition(x, y, room.name);
        }
    }
    return null;
}
function planRoadsBetween(room, fromPos, toPos) {
    const ret = [];
    const callback = (roomName) => {
        if (roomName !== room.name)
            return false;
        const costMatrix = new PathFinder.CostMatrix();
        for (let x = 0; x < 50; x++) {
            for (let y = 0; y < 50; y++) {
                const terrain = room.getTerrain().get(x, y);
                if (terrain === TERRAIN_MASK_WALL)
                    costMatrix.set(x, y, 255);
            }
        }
        const structures = room.find(FIND_STRUCTURES);
        for (const s of structures) {
            if (s.structureType === STRUCTURE_ROAD) {
                costMatrix.set(s.pos.x, s.pos.y, 1);
                continue;
            }
            costMatrix.set(s.pos.x, s.pos.y, 255);
        }
        if (room.memory.plannedStructures) {
            const mem = room.memory.plannedStructures;
            for (const key of Object.keys(mem)) {
                if (!(key.startsWith(PLANNER_KEYS.ROAD_PREFIX) ||
                    key.startsWith(PLANNER_KEYS.CONNECTOR_PREFIX)))
                    continue;
                for (const p of mem[key]) {
                    const [px, py] = p.split(",").map(Number);
                    if (px >= 0 && px < 50 && py >= 0 && py < 50)
                        costMatrix.set(px, py, 1);
                }
            }
        }
        return costMatrix;
    };
    const result = PathFinder.search(fromPos, { pos: toPos, range: 0 }, {
        roomCallback: callback,
        plainCost: 2,
        swampCost: 10,
        maxOps: 2000,
    });
    for (const step of result.path) {
        ret.push(new RoomPosition(step.x, step.y, room.name));
    }
    return ret;
}
function planRampartsForStructures(room, positions) {
    const result = [];
    positions.forEach((pos) => {
        const structs = pos.lookFor(LOOK_STRUCTURES);
        const onTopAllowed = (STRUCTURE_PLANNER.rampartOnTopFor || []).some((t) => structs.some((s) => s.structureType === t));
        if (!onTopAllowed)
            return;
        const existing = room.lookForAt(LOOK_STRUCTURES, pos.x, pos.y);
        const hasRampart = existing.some((s) => s.structureType === STRUCTURE_RAMPART);
        if (!hasRampart && isWalkable(room, pos.x, pos.y)) {
            result.push(new RoomPosition(pos.x, pos.y, room.name));
        }
    });
    return result;
}
function planExtensionPositions(room, spawn) {
    const out = [];
    const pref = STRUCTURE_PLANNER.extensionOffsetsFromSpawn || [];
    let maxPerSpawn = STRUCTURE_PLANNER.maxExtensionsPerSpawn ;
    const extensionsPerRCL = {
        0: 0,
        1: 0,
        2: 5,
        3: 10,
        4: 20,
        5: 30,
        6: 40,
        7: 50,
        8: 60,
    };
    const rcl = room.controller ? room.controller.level : 0;
    const allowed = extensionsPerRCL[rcl] || maxPerSpawn;
    const existingExtensions = room.find(FIND_STRUCTURES, {
        filter: (s) => s.structureType === STRUCTURE_EXTENSION,
    }).length;
    maxPerSpawn = Math.max(0, Math.min(maxPerSpawn, allowed - existingExtensions));
    const minDist = STRUCTURE_PLANNER.extensionMinDistanceFromSpawn ;
    for (const off of pref) {
        if (out.length >= maxPerSpawn)
            break;
        const x = spawn.pos.x + off.x;
        const y = spawn.pos.y + off.y;
        const cheb = Math.max(Math.abs(x - spawn.pos.x), Math.abs(y - spawn.pos.y));
        if (cheb < minDist)
            continue;
        if (x < 0 || x >= 50 || y < 0 || y >= 50)
            continue;
        if (!isBuildableTile(room, x, y))
            continue;
        if (plannedRoadOrConnectorAt(room, x, y))
            continue;
        if (plannedNonRoadStructureAt(room, x, y))
            continue;
        out.push(new RoomPosition(x, y, room.name));
    }
    const radius = STRUCTURE_PLANNER.extensionSearchRadius ;
    if (out.length < maxPerSpawn && STRUCTURE_PLANNER.extensionUseRing) {
        const ringR = STRUCTURE_PLANNER.extensionRingRadius ;
        const ringPositions = [];
        for (let dx = -ringR; dx <= ringR; dx++) {
            for (let dy = -ringR; dy <= ringR; dy++) {
                if (Math.abs(dx) !== ringR && Math.abs(dy) !== ringR)
                    continue;
                const x = spawn.pos.x + dx;
                const y = spawn.pos.y + dy;
                const cheb = Math.max(Math.abs(x - spawn.pos.x), Math.abs(y - spawn.pos.y));
                if (cheb < minDist)
                    continue;
                if (x < 0 || x >= 50 || y < 0 || y >= 50)
                    continue;
                if (!isBuildableTile(room, x, y))
                    continue;
                if (plannedRoadOrConnectorAt(room, x, y))
                    continue;
                if (plannedNonRoadStructureAt(room, x, y))
                    continue;
                if (out.some((p) => p.x === x && p.y === y))
                    continue;
                ringPositions.push(new RoomPosition(x, y, room.name));
            }
        }
        let ringIndex = 0;
        while (out.length < maxPerSpawn && ringIndex < ringPositions.length) {
            out.push(ringPositions[ringIndex++]);
        }
        if (out.length < maxPerSpawn) {
            for (let r = ringR + 1; r <= radius; r++) {
                for (let dx = -r; dx <= r; dx++) {
                    for (let dy = -r; dy <= r; dy++) {
                        if (out.length >= maxPerSpawn)
                            break;
                        if (Math.abs(dx) !== r && Math.abs(dy) !== r)
                            continue;
                        const x = spawn.pos.x + dx;
                        const y = spawn.pos.y + dy;
                        const cheb = Math.max(Math.abs(x - spawn.pos.x), Math.abs(y - spawn.pos.y));
                        if (cheb < minDist)
                            continue;
                        if (x < 0 || x >= 50 || y < 0 || y >= 50)
                            continue;
                        if (!isBuildableTile(room, x, y))
                            continue;
                        if (plannedRoadOrConnectorAt(room, x, y))
                            continue;
                        if (plannedNonRoadStructureAt(room, x, y))
                            continue;
                        if (out.some((p) => p.x === x && p.y === y))
                            continue;
                        out.push(new RoomPosition(x, y, room.name));
                    }
                    if (out.length >= maxPerSpawn)
                        break;
                }
                if (out.length >= maxPerSpawn)
                    break;
            }
        }
    }
    if (out.length < maxPerSpawn) {
        const candidates = [];
        for (let r = 1; r <= radius; r++) {
            for (let dx = -r; dx <= r; dx++) {
                for (let dy = -r; dy <= r; dy++) {
                    if (Math.abs(dx) !== r && Math.abs(dy) !== r)
                        continue;
                    const x = spawn.pos.x + dx;
                    const y = spawn.pos.y + dy;
                    const cheb = Math.max(Math.abs(x - spawn.pos.x), Math.abs(y - spawn.pos.y));
                    if (cheb < minDist)
                        continue;
                    if (x < 0 || x >= 50 || y < 0 || y >= 50)
                        continue;
                    if (!isBuildableTile(room, x, y))
                        continue;
                    if (plannedRoadOrConnectorAt(room, x, y))
                        continue;
                    if (out.some((p) => p.x === x && p.y === y))
                        continue;
                    candidates.push(new RoomPosition(x, y, room.name));
                }
            }
        }
        candidates.sort((a, b) => Math.abs(a.x - spawn.pos.x) +
            Math.abs(a.y - spawn.pos.y) -
            (Math.abs(b.x - spawn.pos.x) + Math.abs(b.y - spawn.pos.y)));
        for (const c of candidates) {
            if (out.length >= maxPerSpawn)
                break;
            out.push(c);
        }
    }
    const entrances = STRUCTURE_PLANNER.extensionRingEntrances ;
    if (out.length > entrances) {
        const removeCount = Math.min(entrances, out.length - 1);
        const roadTiles = getAllPlannedRoadTiles(room);
        const roadSet = new Set(roadTiles.map((p) => `${p.x},${p.y}`));
        const candidates = [];
        for (let i = 0; i < out.length; i++) {
            const p = out[i];
            const neigh = [
                `${p.x + 1},${p.y}`,
                `${p.x - 1},${p.y}`,
                `${p.x},${p.y + 1}`,
                `${p.x},${p.y - 1}`,
            ];
            if (neigh.some((n) => roadSet.has(n)))
                candidates.push(i);
        }
        const removeIndices = new Set();
        for (let i = 0; i < candidates.length && removeIndices.size < removeCount; i++)
            removeIndices.add(candidates[i]);
        if (removeIndices.size < removeCount) {
            const need = removeCount - removeIndices.size;
            for (let k = 0; k < need; k++) {
                const idx = Math.floor(((k + 0.5) * out.length) / need);
                let chosen = idx;
                let attempts = 0;
                while (removeIndices.has(chosen) && attempts < out.length) {
                    chosen = (chosen + 1) % out.length;
                    attempts++;
                }
                if (!removeIndices.has(chosen))
                    removeIndices.add(chosen);
            }
        }
        if (removeIndices.size > 0) {
            const pruned = [];
            for (let i = 0; i < out.length; i++)
                if (!removeIndices.has(i))
                    pruned.push(out[i]);
            if (pruned.length > 0)
                out.splice(0, out.length, ...pruned);
        }
    }
    return out;
}
function planTowerPositions(room, spawn) {
    const out = [];
    const pref = STRUCTURE_PLANNER.towerOffsetsFromSpawn;
    const level = room.controller ? room.controller.level : 0;
    const totalAllowed = TOWER_COUNT_PER_RCL[level] || 0;
    if (totalAllowed <= 0)
        return out;
    const spawns = room.find(FIND_MY_SPAWNS);
    let allowedForThisSpawn = totalAllowed;
    if (spawns.length > 0) {
        {
            const sorted = spawns.slice().sort((a, b) => (a.id < b.id ? -1 : 1));
            const idx = sorted.findIndex((s) => s.id === spawn.id);
            const base = Math.floor(totalAllowed / spawns.length);
            const rem = totalAllowed % spawns.length;
            allowedForThisSpawn = base + (idx >= 0 && idx < rem ? 1 : 0);
        }
    }
    for (const off of pref) {
        if (out.length >= allowedForThisSpawn)
            break;
        const x = spawn.pos.x + off.x;
        const y = spawn.pos.y + off.y;
        if (x < 0 || x >= 50 || y < 0 || y >= 50)
            continue;
        if (!isWalkable(room, x, y))
            continue;
        out.push(new RoomPosition(x, y, room.name));
    }
    return out;
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
function plannedPositionsFromMemory(room, type) {
    if (!room.memory.plannedStructures)
        return [];
    const mem = room.memory.plannedStructures;
    const arr = mem[type] || [];
    return arr.map((s) => {
        const [x, y] = s.split(",").map(Number);
        return new RoomPosition(x, y, room.name);
    });
}
function serializePositions(positions) {
    return positions.map((p) => `${p.x},${p.y}`);
}
function deserializePositions(room, data) {
    return data.map((s) => {
        const [x, y] = s.split(",").map(Number);
        return new RoomPosition(x, y, room.name);
    });
}
function getOrPlanRoad(room, key, fromPos, toPos) {
    ensureMemoryRoomStructures(room);
    const mem = room.memory.plannedStructures;
    if (mem[key] && mem[key].length > 0) {
        return deserializePositions(room, mem[key]);
    }
    const path = planRoadsBetween(room, fromPos, toPos);
    mem[key] = serializePositions(path);
    return path;
}
function planRoadsAroundStructures(room) {
    const roadKey = `${PLANNER_KEYS.ROAD_PREFIX}around`;
    if (!room.memory.plannedStructures)
        return;
    const mem = room.memory.plannedStructures;
    for (const key of Object.keys(mem)) {
        if (key.startsWith(PLANNER_KEYS.ROAD_PREFIX))
            continue;
        if (key.startsWith(PLANNER_KEYS.CONNECTOR_PREFIX))
            continue;
        if (key.startsWith(PLANNER_KEYS.EXTENSIONS_PREFIX))
            continue;
        const positions = plannedPositionsFromMemory(room, key);
        for (const s of positions) {
            const directions = [
                { dx: 0, dy: -1 },
                { dx: 0, dy: 1 },
                { dx: -1, dy: 0 },
                { dx: 1, dy: 0 },
            ];
            for (const { dx, dy } of directions) {
                const x = s.x + dx;
                const y = s.y + dy;
                if (x < 0 || x >= 50 || y < 0 || y >= 50)
                    continue;
                if (!isBuildableTile(room, x, y))
                    continue;
                if (plannedRoadOrConnectorAt(room, x, y))
                    continue;
                if (plannedNonRoadStructureAt(room, x, y))
                    continue;
                const existing = room.lookForAt(LOOK_STRUCTURES, x, y);
                if (existing.some((es) => es.structureType === STRUCTURE_ROAD))
                    continue;
                addPlannedStructureToMemory(room, roadKey, new RoomPosition(x, y, room.name));
            }
        }
    }
}
function pruneRoadsUnderStructures(room) {
    if (!room.memory.plannedStructures)
        return;
    const mem = room.memory.plannedStructures;
    const roadKeys = Object.keys(mem).filter((k) => k.startsWith(PLANNER_KEYS.ROAD_PREFIX) ||
        k.startsWith(PLANNER_KEYS.CONNECTOR_PREFIX));
    for (const key of roadKeys) {
        const arr = mem[key] || [];
        const keep = [];
        for (const posStr of arr) {
            const [px, py] = posStr.split(",").map(Number);
            const structs = room.lookForAt(LOOK_STRUCTURES, px, py);
            const nonRoadExists = structs.some((s) => s.structureType !== STRUCTURE_ROAD);
            if (nonRoadExists) {
                for (const s of structs) {
                    if (s.structureType === STRUCTURE_ROAD) {
                        try {
                            s.destroy();
                        }
                        catch (e) { }
                    }
                }
                continue;
            }
            keep.push(posStr);
        }
        mem[key] = keep;
    }
}
function getAllPlannedRoadTiles(room) {
    if (!room.memory.plannedStructures)
        return [];
    const mem = room.memory.plannedStructures;
    const out = [];
    for (const key of Object.keys(mem)) {
        if (!(key.startsWith(PLANNER_KEYS.ROAD_PREFIX) ||
            key.startsWith(PLANNER_KEYS.CONNECTOR_PREFIX)))
            continue;
        out.push(...deserializePositions(room, mem[key]));
    }
    return out;
}
function plannedRoadOrConnectorAt(room, x, y) {
    if (!room.memory.plannedStructures)
        return false;
    const mem = room.memory.plannedStructures;
    for (const key of Object.keys(mem)) {
        if (!key.startsWith(PLANNER_KEYS.ROAD_PREFIX) &&
            !key.startsWith(PLANNER_KEYS.CONNECTOR_PREFIX))
            continue;
        for (const p of mem[key]) {
            const [px, py] = p.split(",").map(Number);
            if (px === x && py === y)
                return true;
        }
    }
    return false;
}
function plannedNonRoadStructureAt(room, x, y) {
    if (!room.memory.plannedStructures)
        return false;
    const mem = room.memory.plannedStructures;
    for (const key of Object.keys(mem)) {
        if (key.startsWith(PLANNER_KEYS.ROAD_PREFIX) ||
            key.startsWith(PLANNER_KEYS.CONNECTOR_PREFIX))
            continue;
        for (const p of mem[key]) {
            const [px, py] = p.split(",").map(Number);
            if (px === x && py === y)
                return true;
        }
    }
    return false;
}
function clusterTiles(tiles) {
    const idxMap = new Map();
    tiles.forEach((t, i) => idxMap.set(`${t.x},${t.y}`, i));
    const visited = new Array(tiles.length).fill(false);
    const clusters = [];
    for (let i = 0; i < tiles.length; i++) {
        if (visited[i])
            continue;
        const stack = [i];
        const cluster = [];
        visited[i] = true;
        while (stack.length > 0) {
            const cur = stack.pop();
            const p = tiles[cur];
            cluster.push(p);
            const neigh = [
                `${p.x + 1},${p.y}`,
                `${p.x - 1},${p.y}`,
                `${p.x},${p.y + 1}`,
                `${p.x},${p.y - 1}`,
            ];
            for (const n of neigh) {
                const j = idxMap.get(n);
                if (j !== undefined && !visited[j]) {
                    visited[j] = true;
                    stack.push(j);
                }
            }
        }
        clusters.push(cluster);
    }
    return clusters;
}
function connectRoadClusters(room, maxConnectorLength = 32, maxConnectorsPerTick = 3, maxPassesPerTick = 1) {
    if (!room.memory.plannedStructures)
        return;
    const mem = room.memory.plannedStructures;
    let createdThisTick = 0;
    let passes = 0;
    while (true) {
        if (createdThisTick >= maxConnectorsPerTick)
            return;
        if (passes >= maxPassesPerTick)
            return;
        passes++;
        const tiles = getAllPlannedRoadTiles(room);
        if (tiles.length === 0)
            return;
        const clusters = clusterTiles(tiles);
        if (clusters.length <= 1)
            return;
        let addedThisPass = false;
        for (let a = 0; a < clusters.length; a++) {
            for (let b = a + 1; b < clusters.length; b++) {
                if (createdThisTick >= maxConnectorsPerTick)
                    return;
                const ca = clusters[a];
                const cb = clusters[b];
                let best = null;
                for (const pa of ca) {
                    for (const pb of cb) {
                        const d = Math.abs(pa.x - pb.x) + Math.abs(pa.y - pb.y);
                        if (best === null || d < best.dist)
                            best = { da: pa, db: pb, dist: d };
                    }
                }
                if (!best)
                    continue;
                if (best.dist > maxConnectorLength)
                    continue;
                const key = `${PLANNER_KEYS.CONNECTOR_PREFIX}${a}_${b}`;
                if (mem[key] && mem[key].length > 0)
                    continue;
                getOrPlanRoad(room, key, best.da, best.db);
                createdThisTick++;
                addedThisPass = true;
            }
        }
        if (!addedThisPass)
            return;
    }
}

function structureTypeForKey(key) {
    switch (true) {
        case key.startsWith(PLANNER_KEYS.CONTAINER_PREFIX):
            return STRUCTURE_CONTAINER;
        case key.startsWith(PLANNER_KEYS.EXTENSIONS_PREFIX):
            return STRUCTURE_EXTENSION;
        case key.startsWith(PLANNER_KEYS.ROAD_PREFIX):
        case key.startsWith(PLANNER_KEYS.CONNECTOR_PREFIX):
            return STRUCTURE_ROAD;
        case key.startsWith(PLANNER_KEYS.TOWERS_PREFIX):
            return STRUCTURE_TOWER;
        case key.startsWith(PLANNER_KEYS.STORAGE_PREFIX):
            return STRUCTURE_STORAGE;
        case key === PLANNER_KEYS.RAMPARTS_KEY:
            return STRUCTURE_RAMPART;
        case key === PLANNER_KEYS.CONTAINER_CONTROLLER:
            return STRUCTURE_CONTAINER;
        default:
            return null;
    }
}
function cleanupPlannedStructuresGlobal() {
    const interval = STRUCTURE_PLANNER.plannedCleanupInterval ;
    if (Game.time % interval !== 0)
        return;
    for (const rn in Game.rooms) {
        try {
            const room = Game.rooms[rn];
            const mem = room.memory.plannedStructures;
            const meta = room.memory.plannedStructuresMeta || {};
            if (mem) {
                for (const key of Object.keys(mem)) {
                    const arr = mem[key] || [];
                    if (arr.length <= 1)
                        continue;
                    if (key === PLANNER_KEYS.CONTAINER_CONTROLLER ||
                        key.startsWith(PLANNER_KEYS.CONTAINER_SOURCE_PREFIX) ||
                        key.startsWith(PLANNER_KEYS.CONTAINER_MINERAL_PREFIX) ||
                        key.startsWith(PLANNER_KEYS.EXTENSIONS_PREFIX)) {
                        mem[key] = [arr[0]];
                        if (meta && meta[key])
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
                        if (meta && meta[key] && mem[key].length === 0)
                            delete meta[key];
                    }
                }
            }
        }
        catch (e) { }
    }
    const unseenAge = STRUCTURE_PLANNER.plannedCleanupUnseenAge ;
    if (!Memory.rooms)
        return;
    for (const rname of Object.keys(Memory.rooms)) {
        if (Game.rooms[rname])
            continue;
        const rm = Memory.rooms[rname];
        if (!rm || !rm.plannedStructuresMeta)
            continue;
        let anyRecent = false;
        for (const k of Object.keys(rm.plannedStructuresMeta)) {
            const info = rm.plannedStructuresMeta[k];
            if (!info || !info.createdAt)
                continue;
            if (Game.time - info.createdAt < unseenAge) {
                anyRecent = true;
                break;
            }
        }
        if (!anyRecent) {
            delete Memory.rooms[rname].plannedStructures;
            delete Memory.rooms[rname].plannedStructuresMeta;
        }
    }
}
function applyPlannedConstruction(room) {
    if (!room.memory.plannedStructures)
        return;
    const mem = room.memory.plannedStructures;
    for (const key of Object.keys(mem)) {
        const type = structureTypeForKey(key);
        if (!type)
            continue;
        const positions = plannedPositionsFromMemory(room, key);
        for (const pos of positions) {
            const structs = room.lookForAt(LOOK_STRUCTURES, pos.x, pos.y);
            if (structs.some((s) => s.structureType === type)) {
                const arr = mem[key] || [];
                const keyStr = `${pos.x},${pos.y}`;
                mem[key] = arr.filter((s) => s !== keyStr);
                const rampOnTop = (STRUCTURE_PLANNER.rampartOnTopFor || []).some((t) => t === type);
                if (rampOnTop) {
                    addPlannedStructureToMemory(room, PLANNER_KEYS.RAMPARTS_KEY, pos);
                    room.createConstructionSite(pos.x, pos.y, STRUCTURE_RAMPART);
                }
                continue;
            }
            const sites = room.lookForAt(LOOK_CONSTRUCTION_SITES, pos.x, pos.y);
            if (sites.some((s) => s.structureType === type))
                continue;
            room.createConstructionSite(pos.x, pos.y, type);
        }
    }
}
function ensureRampartsForExistingStructures(room) {
    const rampTypes = (STRUCTURE_PLANNER.rampartOnTopFor ||
        []);
    const structures = room.find(FIND_STRUCTURES);
    for (const s of structures) {
        if (!rampTypes.includes(s.structureType))
            continue;
        if (s.structureType === STRUCTURE_RAMPART)
            continue;
        const x = s.pos.x;
        const y = s.pos.y;
        const existing = room.lookForAt(LOOK_STRUCTURES, x, y);
        if (existing.some((st) => st.structureType === STRUCTURE_RAMPART))
            continue;
        const planned = plannedPositionsFromMemory(room, PLANNER_KEYS.RAMPARTS_KEY);
        if (planned.some((p) => p.x === x && p.y === y)) {
            continue;
        }
        addPlannedStructureToMemory(room, PLANNER_KEYS.RAMPARTS_KEY, new RoomPosition(x, y, room.name));
        room.createConstructionSite(x, y, STRUCTURE_RAMPART);
    }
}
function loop$2() {
    cleanupPlannedStructuresGlobal();
    for (const roomName in Game.rooms) {
        const room = Game.rooms[roomName];
        if (!room.controller || !room.controller.my)
            continue;
        processRoomStructures(room);
        applyPlannedConstruction(room);
        ensureRampartsForExistingStructures(room);
    }
}
function processRoomStructures(room) {
    const last = room.memory.lastStructurePlanTick || 0;
    if (Game.time - last < STRUCTURE_PLANNER.planInterval)
        return;
    ensureMemoryRoomStructures(room);
    try {
        const meta = room.memory.plannedStructuresMeta || {};
        const mem = (room.memory.plannedStructures || {});
        const now = Game.time;
        const pruneAge = STRUCTURE_PLANNER.plannedRoadPruneTicks || 0;
        if (pruneAge > 0) {
            for (const key of Object.keys(mem)) {
                if (!key.startsWith(PLANNER_KEYS.ROAD_PREFIX) &&
                    !key.startsWith(PLANNER_KEYS.CONNECTOR_PREFIX))
                    continue;
                const info = meta[key];
                if (!info || !info.createdAt)
                    continue;
                if (now - info.createdAt < pruneAge)
                    continue;
                const positions = mem[key] || [];
                let anyLive = false;
                for (const p of positions) {
                    const [px, py] = p.split(",").map(Number);
                    const structs = room.lookForAt(LOOK_STRUCTURES, px, py);
                    if (structs.length > 0) {
                        anyLive = true;
                        break;
                    }
                    const sites = room.lookForAt(LOOK_CONSTRUCTION_SITES, px, py);
                    if (sites.length > 0) {
                        anyLive = true;
                        break;
                    }
                }
                if (!anyLive) {
                    delete room.memory.plannedStructures[key];
                    delete room.memory.plannedStructuresMeta[key];
                }
            }
        }
    }
    catch (e) { }
    let spawn = null;
    if (room.memory.spawnId) {
        spawn = Game.getObjectById(room.memory.spawnId);
    }
    if (spawn && room.controller && room.controller.level >= 4) {
        const storageKey = `${PLANNER_KEYS.STORAGE_PREFIX}${spawn.id}`;
        const plannedStorage = plannedPositionsFromMemory(room, storageKey);
        const hasStorage = room.find(FIND_STRUCTURES, {
            filter: (s) => s.structureType === STRUCTURE_STORAGE,
        }).length > 0;
        if (!hasStorage && plannedStorage.length === 0) {
            for (let dx = -1; dx <= 1; dx++) {
                for (let dy = -1; dy <= 1; dy++) {
                    if (dx === 0 && dy === 0)
                        continue;
                    const x = spawn.pos.x + dx;
                    const y = spawn.pos.y + dy;
                    if (x < 0 || x >= 50 || y < 0 || y >= 50)
                        continue;
                    const terrain = room.getTerrain().get(x, y);
                    if (terrain === TERRAIN_MASK_WALL)
                        continue;
                    const structs = room.lookForAt(LOOK_STRUCTURES, x, y);
                    const sites = room.lookForAt(LOOK_CONSTRUCTION_SITES, x, y);
                    if (structs.length === 0 && sites.length === 0) {
                        addPlannedStructureToMemory(room, storageKey, new RoomPosition(x, y, room.name));
                        break;
                    }
                }
            }
        }
    }
    const sources = room.find(FIND_SOURCES);
    for (const source of sources) {
        const planned = plannedPositionsFromMemory(room, `${PLANNER_KEYS.CONTAINER_SOURCE_PREFIX}${source.id}`);
        if (planned.length > 0)
            continue;
        const pos = planSourceContainer(room, source);
        if (pos)
            addPlannedStructureToMemory(room, `${PLANNER_KEYS.CONTAINER_SOURCE_PREFIX}${source.id}`, pos);
    }
    if (room.controller) {
        const planned = plannedPositionsFromMemory(room, PLANNER_KEYS.CONTAINER_CONTROLLER);
        let hasControllerContainer = false;
        if (room.memory.upgraderContainerId) {
            const container = Game.getObjectById(room.memory.upgraderContainerId);
            if (container &&
                container.structureType === STRUCTURE_CONTAINER &&
                container.pos.getRangeTo(room.controller.pos) <= 2) {
                hasControllerContainer = true;
            }
        }
        if (!hasControllerContainer) {
            const containers = room.find(FIND_STRUCTURES, {
                filter: (s) => s.structureType === STRUCTURE_CONTAINER &&
                    s.pos.getRangeTo(room.controller.pos) <= 2,
            });
            if (containers.length > 0) {
                hasControllerContainer = true;
                containers[0];
            }
        }
        if (hasControllerContainer && planned.length > 0) {
            const mem = room.memory.plannedStructures;
            if (mem && mem[PLANNER_KEYS.CONTAINER_CONTROLLER]) {
                delete mem[PLANNER_KEYS.CONTAINER_CONTROLLER];
            }
            const meta = room.memory.plannedStructuresMeta;
            if (meta && meta[PLANNER_KEYS.CONTAINER_CONTROLLER]) {
                delete meta[PLANNER_KEYS.CONTAINER_CONTROLLER];
            }
        }
        if (planned.length > 1) {
            const mem = room.memory.plannedStructures;
            if (mem && mem[PLANNER_KEYS.CONTAINER_CONTROLLER]) {
                mem[PLANNER_KEYS.CONTAINER_CONTROLLER] = [
                    mem[PLANNER_KEYS.CONTAINER_CONTROLLER][0],
                ];
            }
        }
        if (planned.length === 0 && !hasControllerContainer) {
            const pos = planControllerContainer(room, room.controller);
            if (pos)
                addPlannedStructureToMemory(room, PLANNER_KEYS.CONTAINER_CONTROLLER, pos);
        }
    }
    if (spawn) {
        for (const source of sources) {
            const containerPlanned = plannedPositionsFromMemory(room, `${PLANNER_KEYS.CONTAINER_SOURCE_PREFIX}${source.id}`);
            if (containerPlanned.length === 0)
                continue;
            const target = containerPlanned[0];
            const roadKey = `${PLANNER_KEYS.ROAD_PREFIX}${spawn.id}_${PLANNER_KEYS.NODE_SOURCE_PREFIX}${source.id}`;
            const existingRoad = plannedPositionsFromMemory(room, roadKey);
            if (existingRoad.length > 0)
                continue;
            const roadPoints = getOrPlanRoad(room, roadKey, spawn.pos, target);
            for (const p of roadPoints)
                addPlannedStructureToMemory(room, roadKey, p);
        }
        const controllerContainers = plannedPositionsFromMemory(room, PLANNER_KEYS.CONTAINER_CONTROLLER);
        let controllerTarget = null;
        if (controllerContainers.length > 0)
            controllerTarget = controllerContainers[0];
        else if (room.controller)
            controllerTarget = room.controller.pos;
        if (controllerTarget) {
            const roadKey = `${PLANNER_KEYS.ROAD_PREFIX}${spawn.id}_${PLANNER_KEYS.NODE_CONTROLLER}`;
            const existingRoad = plannedPositionsFromMemory(room, roadKey);
            if (existingRoad.length === 0) {
                const roadPoints = getOrPlanRoad(room, roadKey, spawn.pos, controllerTarget);
                for (const p of roadPoints)
                    addPlannedStructureToMemory(room, roadKey, p);
            }
        }
        const mineral = room.find(FIND_MINERALS)[0];
        if (mineral) {
            const plannedMineral = plannedPositionsFromMemory(room, `${PLANNER_KEYS.CONTAINER_MINERAL_PREFIX}${mineral.id}`);
            if (plannedMineral.length === 0) {
                const mpos = planMineralContainer(room, mineral);
                if (mpos)
                    addPlannedStructureToMemory(room, `${PLANNER_KEYS.CONTAINER_MINERAL_PREFIX}${mineral.id}`, mpos);
            }
            const mineralKey = `${PLANNER_KEYS.ROAD_PREFIX}${spawn.id}_${PLANNER_KEYS.NODE_MINERAL_PREFIX}${mineral.id}`;
            const existingMineralRoad = plannedPositionsFromMemory(room, mineralKey);
            if (existingMineralRoad.length === 0) {
                const plannedMineral2 = plannedPositionsFromMemory(room, `${PLANNER_KEYS.CONTAINER_MINERAL_PREFIX}${mineral.id}`);
                const targetPos = plannedMineral2.length > 0 ? plannedMineral2[0] : mineral.pos;
                const roadPoints = getOrPlanRoad(room, mineralKey, spawn.pos, targetPos);
                for (const p of roadPoints)
                    addPlannedStructureToMemory(room, mineralKey, p);
            }
        }
        const energyNodes = [];
        for (const source of sources) {
            const containerPlanned = plannedPositionsFromMemory(room, `${PLANNER_KEYS.CONTAINER_SOURCE_PREFIX}${source.id}`);
            if (containerPlanned.length > 0)
                energyNodes.push({
                    id: `${PLANNER_KEYS.NODE_SOURCE_PREFIX}${source.id}`,
                    pos: containerPlanned[0],
                });
            else
                energyNodes.push({
                    id: `${PLANNER_KEYS.NODE_SOURCE_PREFIX}${source.id}`,
                    pos: source.pos,
                });
        }
        if (controllerTarget) {
            energyNodes.push({
                id: PLANNER_KEYS.NODE_CONTROLLER,
                pos: controllerTarget,
            });
        }
        if (mineral) {
            const plannedMineral3 = plannedPositionsFromMemory(room, `${PLANNER_KEYS.CONTAINER_MINERAL_PREFIX}${mineral.id}`);
            energyNodes.push({
                id: `${PLANNER_KEYS.NODE_MINERAL_PREFIX}${mineral.id}`,
                pos: plannedMineral3.length > 0 ? plannedMineral3[0] : mineral.pos,
            });
        }
        for (let i = 0; i < energyNodes.length; i++) {
            for (let j = i + 1; j < energyNodes.length; j++) {
                const a = energyNodes[i];
                const b = energyNodes[j];
                const key = `${PLANNER_KEYS.ROAD_PREFIX}${a.id}_${b.id}`;
                const existing = plannedPositionsFromMemory(room, key);
                if (existing.length > 0)
                    continue;
                const roadPoints = getOrPlanRoad(room, key, a.pos, b.pos);
                for (const p of roadPoints)
                    addPlannedStructureToMemory(room, key, p);
            }
        }
        const towerKey = `${PLANNER_KEYS.TOWERS_PREFIX}${spawn.id}`;
        const existingTowers = plannedPositionsFromMemory(room, towerKey);
        if (existingTowers.length === 0) {
            const towerPositions = planTowerPositions(room, spawn);
            for (const p of towerPositions)
                addPlannedStructureToMemory(room, towerKey, p);
        }
        const extKey = `${PLANNER_KEYS.EXTENSIONS_PREFIX}${spawn.id}`;
        const existingExt = plannedPositionsFromMemory(room, extKey);
        if (existingExt.length === 0) {
            const extPositions = planExtensionPositions(room, spawn);
            for (const p of extPositions)
                addPlannedStructureToMemory(room, extKey, p);
        }
    }
    const importantTypes = Object.keys((room.memory.plannedStructures || {}));
    const importantPositions = [];
    for (const t of importantTypes)
        importantPositions.push(...plannedPositionsFromMemory(room, t));
    planRoadsAroundStructures(room);
    pruneRoadsUnderStructures(room);
    connectRoadClusters(room);
    room.memory.lastStructurePlanTick = Game.time;
    const ramparts = planRampartsForStructures(room, importantPositions);
    const rampKey = PLANNER_KEYS.RAMPARTS_KEY;
    const existingRamparts = plannedPositionsFromMemory(room, rampKey).map((p) => `${p.x},${p.y}`);
    const existingSet = new Set(existingRamparts);
    for (const p of ramparts) {
        const key = `${p.x},${p.y}`;
        if (!existingSet.has(key))
            addPlannedStructureToMemory(room, rampKey, p);
    }
}

function runTower(tower) {
    if (tower.store[RESOURCE_ENERGY] === 0)
        return;
    const hostiles = tower.room.find(FIND_HOSTILE_CREEPS, {
        filter: (c) => c.pos.x > 1 && c.pos.x < 48 && c.pos.y > 1 && c.pos.y < 48,
    });
    if (hostiles.length > 0) {
        const target = tower.pos.findClosestByPath(hostiles);
        if (target) {
            tower.attack(target);
            return;
        }
    }
    const repairTarget = findTowerRepairTarget(tower.room);
    if (repairTarget) {
        tower.repair(repairTarget);
    }
}

function loop$1() {
    for (const roomName in Game.rooms) {
        const room = Game.rooms[roomName];
        const towers = room.find(FIND_STRUCTURES, {
            filter: (s) => s.structureType === STRUCTURE_TOWER,
        });
        for (const tower of towers) {
            runTower(tower);
        }
    }
}

function loop() {
    loop$6();
    loop$5();
    loop$4();
    loop$3();
    loop$2();
    loop$1();
}

exports.loop = loop;
