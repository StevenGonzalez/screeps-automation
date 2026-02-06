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
      case 'peasant':
        return this.buildPeasantBody(energy);
      case 'mason':
        return this.buildMasonBody(energy);
      case 'alchemist':
        return this.buildAlchemistBody(energy);
      case 'merchant':
        return this.buildMerchantBody(energy);
      case 'blacksmith':
        return this.buildBlacksmithBody(energy);
      default:
        return [WORK, CARRY, MOVE];
    }
  }

  private static buildPeasantBody(energy: number): BodyPartConstant[] {
    // Peasant focuses on WORK and CARRY
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

  private static buildMasonBody(energy: number): BodyPartConstant[] {
    // Mason balances WORK, CARRY, and MOVE
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

  private static buildAlchemistBody(energy: number): BodyPartConstant[] {
    // Alchemist focuses on WORK for faster upgrading
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

  private static buildMerchantBody(energy: number): BodyPartConstant[] {
    // Merchant focuses on CARRY and MOVE
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

  private static buildBlacksmithBody(energy: number): BodyPartConstant[] {
    // Blacksmith focuses on WORK for repairs, with CARRY and MOVE
    if (energy >= 550) {
      return [WORK, WORK, WORK, CARRY, CARRY, MOVE, MOVE, MOVE];
    } else if (energy >= 400) {
      return [WORK, WORK, CARRY, CARRY, MOVE, MOVE];
    } else if (energy >= 300) {
      return [WORK, CARRY, MOVE, MOVE];
    } else {
      return [WORK, CARRY, MOVE];
    }
  }
}
