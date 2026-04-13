/**
 * The Miners
 * Extractors delve into mineral deposits to claim precious ore
 */

import { mineSource } from '../utils/CreepActions';

export class RoleMiner {
  public static run(creep: Creep): void {
    // Mine at an assigned source, ensuring only one miner per source
    mineSource(creep);
  }
}
