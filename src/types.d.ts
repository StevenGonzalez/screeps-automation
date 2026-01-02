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
}

export {};
