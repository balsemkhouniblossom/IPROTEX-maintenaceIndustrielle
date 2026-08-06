import { Injectable } from '@nestjs/common';

export type ThrottleRecord = {
  hits: number[];
  failures: number[];
  lockedUntil?: number;
};

/**
 * Storage seam for AuthThrottleService's per-IP/per-account counters. The
 * in-memory implementation below is correct for a single backend instance
 * only: if this app is ever horizontally scaled, a distributed attacker
 * spreading requests across instances would see each instance's
 * independent counters instead of one shared limit. Swapping in a
 * Redis-backed implementation of this same interface (bound to
 * AUTH_THROTTLE_STORE in AuthModule) closes that gap without touching
 * AuthThrottleService's actual throttling rules — no redesign needed when
 * that scaling actually happens.
 */
export interface AuthThrottleStore {
  get(key: string): ThrottleRecord | undefined;
  set(key: string, record: ThrottleRecord): void;
  delete(key: string): void;
  entries(): IterableIterator<[string, ThrottleRecord]>;
  clear(): void;
  readonly size: number;
}

export const AUTH_THROTTLE_STORE = Symbol('AUTH_THROTTLE_STORE');

@Injectable()
export class InMemoryAuthThrottleStore implements AuthThrottleStore {
  private readonly records = new Map<string, ThrottleRecord>();

  get(key: string): ThrottleRecord | undefined {
    return this.records.get(key);
  }

  set(key: string, record: ThrottleRecord): void {
    this.records.set(key, record);
  }

  delete(key: string): void {
    this.records.delete(key);
  }

  entries(): IterableIterator<[string, ThrottleRecord]> {
    return this.records.entries();
  }

  clear(): void {
    this.records.clear();
  }

  get size(): number {
    return this.records.size;
  }
}
