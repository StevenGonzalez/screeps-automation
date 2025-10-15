export const ROLE_BUILDER = "builder";
export const ROLE_HARVESTER = "harvester";
export const ROLE_UPGRADER = "upgrader";
export const ROLE_REPAIRER = "repairer";

export const ENERGY_DEPOSIT_PRIORITY: Record<string, StructureConstant[]> = {
  harvester: [
    STRUCTURE_SPAWN,
    STRUCTURE_EXTENSION,
    STRUCTURE_CONTAINER,
    STRUCTURE_STORAGE,
  ],
  upgrader: [STRUCTURE_CONTROLLER],
  builder: [],
  repairer: [STRUCTURE_STORAGE, STRUCTURE_CONTAINER],
};
