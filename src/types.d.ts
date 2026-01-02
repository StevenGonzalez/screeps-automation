/**
 * Global type definitions for COVENANT system
 */

import { Covenant } from './core/Covenant';

declare global {
  var Cov: Covenant;
  
  namespace NodeJS {
    interface Global {
      Cov: Covenant;
    }
  }
  
  interface Memory {
    covenant?: {
      version?: string;
      visualize?: { [roomName: string]: boolean };
      [key: string]: any;
    };
  }
  
  interface CreepMemory {
    role?: string;
    arbiter?: string;
    working?: boolean;
    building?: boolean;
    collecting?: boolean;
    task?: any;
    sourceId?: Id<Source>;
    targetRoom?: string;
    [key: string]: any;
  }
}

export {};
