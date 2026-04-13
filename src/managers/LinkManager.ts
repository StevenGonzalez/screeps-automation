/**
 * The Royal Relay
 * Manages link transfers between source and base links
 */

import { getBaseLink, getSourceLinks } from '../utils/LinkUtils';

export class LinkManager {
  /**
   * Manage link transfers for a room
   */
  public static run(room: Room): void {
    const baseLink = getBaseLink(room);
    if (!baseLink) {
      return;
    }

    const sourceLinks = getSourceLinks(room).filter(link => link.id !== baseLink.id);
    if (sourceLinks.length === 0) {
      return;
    }

    for (const sourceLink of sourceLinks) {
      if (sourceLink.cooldown > 0) {
        continue;
      }

      const available = sourceLink.store.getUsedCapacity(RESOURCE_ENERGY);
      if (available <= 0) {
        continue;
      }

      const freeCapacity = baseLink.store.getFreeCapacity(RESOURCE_ENERGY);
      if (freeCapacity <= 0) {
        continue;
      }

      const amount = Math.min(available, freeCapacity);
      sourceLink.transferEnergy(baseLink, amount);
    }
  }
}
