/**
 * LOGISTICS REQUEST
 * 
 * Represents a request or offer for resources in the Prophets Will network
 */

export enum RequestPriority {
  CRITICAL = 0,    // Emergency (spawns, towers under attack)
  HIGH = 1,        // Important (extensions, labs running reactions)
  NORMAL = 2,      // Standard (general upgrading, building)
  LOW = 3,         // Low priority (remote mining, surplus)
  OVERFLOW = 4     // Dump excess (storage overflow)
}

export enum RequestType {
  WITHDRAW = 'withdraw',  // Requesting to take resources
  DEPOSIT = 'deposit'     // Offering to give resources
}

export interface LogisticsRequestOptions {
  id: string;
  target: Structure | RoomPosition;
  resourceType: ResourceConstant;
  amount: number;
  priority: RequestPriority;
  type: RequestType;
  arbiterName?: string;
}

/**
 * Represents a request or offer for resources in the logistics network
 */
export class LogisticsRequest {
  id: string;
  target: Structure | RoomPosition;
  resourceType: ResourceConstant;
  amount: number;
  priority: RequestPriority;
  type: RequestType;
  arbiterName?: string;
  
  constructor(options: LogisticsRequestOptions) {
    this.id = options.id;
    this.target = options.target;
    this.resourceType = options.resourceType;
    this.amount = options.amount;
    this.priority = options.priority;
    this.type = options.type;
    this.arbiterName = options.arbiterName;
  }
  
  /**
   * Check if this request is still valid
   */
  get isValid(): boolean {
    if (this.target instanceof RoomPosition) {
      return true; // Position-based requests are always valid
    }
    
    // Check if structure still exists
    const structure = this.target as Structure;
    if (!structure || !structure.id) {
      return false;
    }
    
    return Game.getObjectById(structure.id as Id<Structure>) !== null;
  }
  
  /**
   * Get the position of this request
   */
  get pos(): RoomPosition {
    if (this.target instanceof RoomPosition) {
      return this.target;
    }
    return (this.target as Structure).pos;
  }
  
  /**
   * Get the room name of this request
   */
  get roomName(): string {
    return this.pos.roomName;
  }
}
