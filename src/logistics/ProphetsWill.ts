/**
 * PROPHETS WILL - Logistics Network
 * 
 * "The Prophets' Will guides all resources to their rightful purpose"
 * 
 * The Prophets Will is the logistics network that manages resource distribution
 * across a High Charity. It coordinates requests and offers, manages link networks,
 * and ensures resources flow efficiently to where they're needed most.
 */

/// <reference types="@types/screeps" />

import { LogisticsRequest, RequestPriority, RequestType } from './LogisticsRequest';

export interface ProphetsWillMemory {
  requests: { [id: string]: any };
  linkCooldowns: { [linkId: string]: number };
}

/**
 * Prophets Will - Smart logistics network for a High Charity
 */
export class ProphetsWill {
  highCharity: any; // Import type later to avoid circular dependency
  memory: ProphetsWillMemory;
  
  // Request tracking
  withdrawRequests: LogisticsRequest[];
  depositRequests: LogisticsRequest[];
  
  // Structure references
  storageStructures: (StructureStorage | StructureContainer)[];
  links: StructureLink[];
  terminal: StructureTerminal | undefined;
  
  constructor(highCharity: any) {
    this.highCharity = highCharity;
    
    // Initialize memory
    if (!highCharity.memory.prophetsWill) {
      highCharity.memory.prophetsWill = {
        requests: {},
        linkCooldowns: {}
      };
    }
    this.memory = highCharity.memory.prophetsWill;
    
    this.withdrawRequests = [];
    this.depositRequests = [];
    this.storageStructures = [];
    this.links = [];
  }
  
  /**
   * Initialize the logistics network
   */
  init(): void {
    // Gather structure references
    this.refreshStructures();
    
    // Process existing requests from Arbiters
    this.gatherRequests();
    
    // Manage link network
    this.manageLinks();
  }
  
  /**
   * Run the logistics network
   */
  run(): void {
    // Clean up invalid requests
    this.cleanupRequests();
    
    // Sort requests by priority
    this.sortRequests();
  }
  
  /**
   * Refresh structure references
   */
  private refreshStructures(): void {
    const room = this.highCharity.room;
    
    // Get storage structures
    this.storageStructures = [];
    if (room.storage) {
      this.storageStructures.push(room.storage);
    }
    
    const containers = room.find(FIND_STRUCTURES, {
      filter: (s: Structure) => s.structureType === STRUCTURE_CONTAINER
    }) as StructureContainer[];
    this.storageStructures.push(...containers);
    
    // Get links
    this.links = this.highCharity.links || [];
    
    // Get terminal
    this.terminal = room.terminal;
  }
  
  /**
   * Gather requests from all Arbiters
   */
  private gatherRequests(): void {
    this.withdrawRequests = [];
    this.depositRequests = [];
    
    // Each Arbiter can register requests
    for (const arbiterName in this.highCharity.arbiters) {
      const arbiter = this.highCharity.arbiters[arbiterName];
      
      // Check if Arbiter has logistics requests
      if (arbiter.getLogisticsRequests) {
        const requests = arbiter.getLogisticsRequests();
        for (const request of requests) {
          this.registerRequest(request);
        }
      }
    }
  }
  
  /**
   * Register a logistics request
   */
  registerRequest(request: LogisticsRequest): void {
    if (!request.isValid) {
      return;
    }
    
    if (request.type === RequestType.WITHDRAW) {
      this.withdrawRequests.push(request);
    } else {
      this.depositRequests.push(request);
    }
  }
  
  /**
   * Remove invalid requests
   */
  private cleanupRequests(): void {
    this.withdrawRequests = this.withdrawRequests.filter(r => r.isValid);
    this.depositRequests = this.depositRequests.filter(r => r.isValid);
  }
  
  /**
   * Sort requests by priority
   */
  private sortRequests(): void {
    const sortFn = (a: LogisticsRequest, b: LogisticsRequest) => {
      return a.priority - b.priority;
    };
    
    this.withdrawRequests.sort(sortFn);
    this.depositRequests.sort(sortFn);
  }
  
  /**
   * Manage link network - transfer energy between links
   */
  private manageLinks(): void {
    if (this.links.length < 2) {
      return;
    }
    
    const room = this.highCharity.room;
    const storage = room.storage;
    
    // Find source links (near sources) and sink links (near storage/controller)
    const sourceLinks: StructureLink[] = [];
    const sinkLinks: StructureLink[] = [];
    let storageLink: StructureLink | undefined;
    
    for (const link of this.links) {
      if (link.store.getUsedCapacity(RESOURCE_ENERGY) === 0) {
        continue; // Empty link
      }
      
      // Check if link is near storage
      if (storage && link.pos.inRangeTo(storage, 2)) {
        storageLink = link;
        continue;
      }
      
      // Check if link is near a source (source link)
      const nearSource = link.pos.findInRange(FIND_SOURCES, 2).length > 0;
      if (nearSource) {
        sourceLinks.push(link);
      } else {
        sinkLinks.push(link);
      }
    }
    
    // Transfer from source links to storage link or sink links
    for (const sourceLink of sourceLinks) {
      if (sourceLink.cooldown > 0) {
        continue;
      }
      
      const energy = sourceLink.store.getUsedCapacity(RESOURCE_ENERGY);
      if (energy < 100) {
        continue; // Not enough energy to transfer
      }
      
      // Prefer transferring to storage link
      if (storageLink && storageLink.store.getFreeCapacity(RESOURCE_ENERGY) >= energy) {
        sourceLink.transferEnergy(storageLink);
        continue;
      }
      
      // Otherwise transfer to sink links with capacity
      for (const sinkLink of sinkLinks) {
        if (sinkLink.store.getFreeCapacity(RESOURCE_ENERGY) >= energy) {
          sourceLink.transferEnergy(sinkLink);
          break;
        }
      }
    }
  }
  
  /**
   * Get the best source for a withdraw request
   */
  getBestSource(request: LogisticsRequest): Structure | null {
    const room = this.highCharity.room;
    const resourceType = request.resourceType;
    
    // For energy, prefer storage > container > terminal
    if (resourceType === RESOURCE_ENERGY) {
      if (room.storage && room.storage.store.getUsedCapacity(RESOURCE_ENERGY) > 1000) {
        return room.storage;
      }
      
      // Find closest container with energy
      const containers = this.storageStructures.filter(s => 
        s.structureType === STRUCTURE_CONTAINER && 
        s.store.getUsedCapacity(RESOURCE_ENERGY) > 100
      );
      
      if (containers.length > 0) {
        return request.pos.findClosestByRange(containers);
      }
      
      if (room.terminal && room.terminal.store.getUsedCapacity(RESOURCE_ENERGY) > 1000) {
        return room.terminal;
      }
    } else {
      // For other resources, check storage and terminal
      if (room.storage && room.storage.store.getUsedCapacity(resourceType) > 0) {
        return room.storage;
      }
      
      if (room.terminal && room.terminal.store.getUsedCapacity(resourceType) > 0) {
        return room.terminal;
      }
    }
    
    return null;
  }
  
  /**
   * Get the best target for a deposit request
   */
  getBestTarget(request: LogisticsRequest): Structure | null {
    const room = this.highCharity.room;
    const resourceType = request.resourceType;
    
    // For energy deposits
    if (resourceType === RESOURCE_ENERGY) {
      // Priority: Storage > Container near storage > Terminal
      if (room.storage && room.storage.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
        return room.storage;
      }
      
      if (room.terminal && room.terminal.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
        return room.terminal;
      }
      
      // Find closest container with space
      const containers = this.storageStructures.filter(s => 
        s.structureType === STRUCTURE_CONTAINER && 
        s.store.getFreeCapacity(RESOURCE_ENERGY) > 0
      );
      
      if (containers.length > 0) {
        return request.pos.findClosestByRange(containers);
      }
    } else {
      // For other resources, prefer terminal > storage
      if (room.terminal && room.terminal.store.getFreeCapacity(resourceType) > 0) {
        return room.terminal;
      }
      
      if (room.storage && room.storage.store.getFreeCapacity(resourceType) > 0) {
        return room.storage;
      }
    }
    
    return null;
  }
  
  /**
   * Get all withdraw requests for a specific resource type
   */
  getWithdrawRequestsFor(resourceType: ResourceConstant, maxPriority: RequestPriority = RequestPriority.OVERFLOW): LogisticsRequest[] {
    return this.withdrawRequests.filter(r => 
      r.resourceType === resourceType && 
      r.priority <= maxPriority
    );
  }
  
  /**
   * Get all deposit requests for a specific resource type
   */
  getDepositRequestsFor(resourceType: ResourceConstant, maxPriority: RequestPriority = RequestPriority.OVERFLOW): LogisticsRequest[] {
    return this.depositRequests.filter(r => 
      r.resourceType === resourceType && 
      r.priority <= maxPriority
    );
  }
  
  /**
   * Check if there's a need for a specific resource
   */
  hasNeedFor(resourceType: ResourceConstant): boolean {
    return this.withdrawRequests.some(r => 
      r.resourceType === resourceType && 
      r.priority <= RequestPriority.NORMAL
    );
  }
  
  /**
   * Check if there's surplus of a specific resource
   */
  hasSurplusOf(resourceType: ResourceConstant): boolean {
    return this.depositRequests.some(r => 
      r.resourceType === resourceType && 
      r.priority === RequestPriority.OVERFLOW
    );
  }
}
