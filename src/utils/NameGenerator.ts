/**
 * The Royal Herald
 * Announces new subjects with proper Medieval names
 */

export class NameGenerator {
  private static readonly HARVESTER_NAMES = [
    'Cedric', 'Oswald', 'Aldric', 'Godwin', 'Beorn'
  ];

  private static readonly BUILDER_NAMES = [
    'Edmund', 'Baldwin', 'Godfrey', 'Reinhard', 'Wulfric'
  ];

  private static readonly UPGRADER_NAMES = [
    'Merlin', 'Aldous', 'Cornelius', 'Magnus', 'Ambrose'
  ];

  private static readonly HAULER_NAMES = [
    'Gilbert', 'Roland', 'Percival', 'Tristan', 'Gawain'
  ];

  /**
   * Generate a themed name for a creep role
   */
  public static generate(role: string): string {
    let namePool: string[];

    switch (role) {
      case 'peasant':
        namePool = this.HARVESTER_NAMES;
        break;
      case 'mason':
        namePool = this.BUILDER_NAMES;
        break;
      case 'alchemist':
        namePool = this.UPGRADER_NAMES;
        break;
      case 'merchant':
        namePool = this.HAULER_NAMES;
        break;
      default:
        namePool = ['Commoner'];
    }

    // Pick a random name and add a number
    const baseName = namePool[Math.floor(Math.random() * namePool.length)];
    const number = Game.time % 1000;
    return `${baseName}${number}`;
  }
}
