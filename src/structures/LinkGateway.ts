/**
 * LINK Gateway - Energy Conduit Network
 * 
 * "Through sacred conduits, energy flows without labor"
 * 
 * Manages link network for instant energy distribution:
 * - Source links collect from miners
 * - Controller link feeds upgraders
 * - Storage link balances the network
 */

/// <reference types="@types/screeps" />

import { Gateway } from './Gateway';
import { Nexus } from '../core/Nexus';

export interface LinkRole {
  link: StructureLink;
  role: 'source' | 'controller' | 'storage' | 'upgrader';
  assignedSource?: Id<Source>;
}

/**
 * Link Gateway - Manages instant energy distribution network
 */
export class LinkGateway extends Gateway {
  private sourceLinks: StructureLink[];
  private controllerLink: StructureLink | null;
  private storageLink: StructureLink | null;
  private upgraderLink: StructureLink | null;
  
  constructor(Nexus: Nexus) {
    // Use storage position as the link Gateway anchor, or controller if no storage
    const pos = Nexus.storage?.pos || Nexus.controller?.pos || new RoomPosition(25, 25, Nexus.room.name);
    super(Nexus, pos);
    this.sourceLinks = [];
    this.controllerLink = null;
    this.storageLink = null;
    this.upgraderLink = null;
  }
  
  init(): void {
    // Categorize links by purpose
    this.categorizeLinks();
  }
  
  run(): void {
    // Transfer energy from source links to destinations
    this.manageSourceLinks();
    
    // Balance storage link
    this.manageStorageLink();
  }
  
  /**
   * Categorize links by their role in the network
   */
  private categorizeLinks(): void {
    const links = this.Nexus.links;
    if (links.length === 0) return;
    
    this.sourceLinks = [];
    this.controllerLink = null;
    this.storageLink = null;
    this.upgraderLink = null;
    
    // Find storage link (closest to storage)
    if (this.Nexus.storage) {
      const storageLinks = links.filter(link => 
        link.pos.inRangeTo(this.Nexus.storage!, 2)
      );
      if (storageLinks.length > 0) {
        this.storageLink = storageLinks[0];
      }
    }
    
    // Find controller link (closest to controller)
    if (this.room.controller) {
      const controllerLinks = links.filter(link => 
        link.pos.inRangeTo(this.room.controller!, 3) &&
        link.id !== this.storageLink?.id
      );
      
      if (controllerLinks.length > 0) {
        // Check if it's for upgraders (3 range) or controller (2 range)
        const upgraderLink = controllerLinks.find(link => 
          link.pos.inRangeTo(this.room.controller!, 3) &&
          !link.pos.inRangeTo(this.room.controller!, 2)
        );
        
        if (upgraderLink) {
          this.upgraderLink = upgraderLink;
        } else {
          this.controllerLink = controllerLinks[0];
        }
      }
    }
    
    // Find source links (close to sources)
    const sources = this.room.find(FIND_SOURCES);
    for (const link of links) {
      // Skip if already categorized
      if (link.id === this.storageLink?.id || 
          link.id === this.controllerLink?.id ||
          link.id === this.upgraderLink?.id) {
        continue;
      }
      
      // Check if near a source
      const nearSource = sources.find(source => 
        link.pos.inRangeTo(source, 2)
      );
      
      if (nearSource) {
        this.sourceLinks.push(link);
      }
    }
  }
  
  /**
   * Transfer energy from source links to destinations
   */
  private manageSourceLinks(): void {
    for (const sourceLink of this.sourceLinks) {
      // Skip if on cooldown or empty
      if (sourceLink.cooldown > 0 || sourceLink.store.getUsedCapacity(RESOURCE_ENERGY) < 100) {
        continue;
      }
      
      // Priority 1: Feed controller/upgrader link if low
      const upgradeLink = this.upgraderLink || this.controllerLink;
      if (upgradeLink && upgradeLink.store.getFreeCapacity(RESOURCE_ENERGY) >= 400) {
        const result = sourceLink.transferEnergy(upgradeLink);
        if (result === OK) {
          continue;
        }
      }
      
      // Priority 2: Feed storage link
      if (this.storageLink && this.storageLink.store.getFreeCapacity(RESOURCE_ENERGY) >= 400) {
        sourceLink.transferEnergy(this.storageLink);
      }
    }
  }
  
  /**
   * Balance storage link - feed upgrader when full
   */
  private manageStorageLink(): void {
    if (!this.storageLink || this.storageLink.cooldown > 0) return;
    
    const energy = this.storageLink.store.getUsedCapacity(RESOURCE_ENERGY);
    
    // If storage link is full, send to upgrader/controller
    if (energy >= 400) {
      const upgradeLink = this.upgraderLink || this.controllerLink;
      if (upgradeLink && upgradeLink.store.getFreeCapacity(RESOURCE_ENERGY) >= 400) {
        this.storageLink.transferEnergy(upgradeLink);
      }
    }
  }
  
  /**
   * Get the storage link for external use (haulers can fill it)
   */
  getStorageLink(): StructureLink | null {
    return this.storageLink;
  }
  
  /**
   * Get the upgrader link for external use (upgraders can pull from it)
   */
  getUpgraderLink(): StructureLink | null {
    return this.upgraderLink || this.controllerLink;
  }
  
  /**
   * Get source links for external use (miners can fill them)
   */
  getSourceLinks(): StructureLink[] {
    return this.sourceLinks;
  }
  
  /**
   * Check if link network is active (has at least 2 links)
   */
  isActive(): boolean {
    return this.Nexus.links.length >= 2;
  }
}
