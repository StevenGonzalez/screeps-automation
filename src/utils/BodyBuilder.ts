/**
 * The Quartermaster's Workshop
 * Designs optimal creep bodies based on available resources
 */

export class BodyBuilder {
  /**
   * Build a body based on role and available energy
   */
  public static buildBody(role: string, energy: number): BodyPartConstant[] {
    switch (role) {
      case 'harvester':
        return this.buildHarvesterBody(energy);
      case 'builder':
        return this.buildBuilderBody(energy);
      case 'upgrader':
        return this.buildUpgraderBody(energy);
      case 'hauler':
        return this.buildHaulerBody(energy);
      default:
        return [WORK, CARRY, MOVE];
    }
  }

  private static buildHarvesterBody(energy: number): BodyPartConstant[] {
    // Harvester focuses on WORK and CARRY
    if (energy >= 550) {
      return [WORK, WORK, WORK, CARRY, CARRY, MOVE, MOVE];
    } else if (energy >= 400) {
      return [WORK, WORK, CARRY, CARRY, MOVE, MOVE];
    } else if (energy >= 300) {
      return [WORK, CARRY, MOVE, MOVE];
    } else {
      return [WORK, CARRY, MOVE];
    }
  }

  private static buildBuilderBody(energy: number): BodyPartConstant[] {
    // Builder balances WORK, CARRY, and MOVE
    if (energy >= 550) {
      return [WORK, WORK, CARRY, CARRY, CARRY, MOVE, MOVE, MOVE];
    } else if (energy >= 400) {
      return [WORK, WORK, CARRY, CARRY, MOVE, MOVE];
    } else if (energy >= 300) {
      return [WORK, CARRY, MOVE, MOVE];
    } else {
      return [WORK, CARRY, MOVE];
    }
  }

  private static buildUpgraderBody(energy: number): BodyPartConstant[] {
    // Upgrader focuses on WORK for faster upgrading
    if (energy >= 550) {
      return [WORK, WORK, WORK, CARRY, MOVE, MOVE];
    } else if (energy >= 400) {
      return [WORK, WORK, CARRY, MOVE, MOVE];
    } else if (energy >= 300) {
      return [WORK, CARRY, MOVE, MOVE];
    } else {
      return [WORK, CARRY, MOVE];
    }
  }

  private static buildHaulerBody(energy: number): BodyPartConstant[] {
    // Hauler focuses on CARRY and MOVE
    if (energy >= 550) {
      return [CARRY, CARRY, CARRY, CARRY, MOVE, MOVE, MOVE, MOVE];
    } else if (energy >= 400) {
      return [CARRY, CARRY, CARRY, MOVE, MOVE, MOVE];
    } else if (energy >= 300) {
      return [CARRY, CARRY, MOVE, MOVE];
    } else {
      return [CARRY, MOVE];
    }
  }
}
