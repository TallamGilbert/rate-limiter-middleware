import { RateLimitStore, RateLimitInfo } from './store.interface';
import { TokenBucket } from '../algorithms/token-bucket';
import { FixedWindow } from '../algorithms/fixed-window';

export class MemoryStore implements RateLimitStore {
  private buckets: Map<string, TokenBucket> = new Map();
  private windows: Map<string, FixedWindow> = new Map();

  async consumeToken(
    key: string,
    rate: number,
    capacity: number,
    windowMs: number
  ): Promise<RateLimitInfo> {
    if (!this.buckets.has(key)) {
      this.buckets.set(key, new TokenBucket({ rate, capacity }));
    }
    
    const bucket = this.buckets.get(key)!;
    return bucket.consume();
  }

  async incrementCounter(
    key: string,
    limit: number,
    windowMs: number
  ): Promise<RateLimitInfo> {
    if (!this.windows.has(key)) {
      this.windows.set(key, new FixedWindow({ limit, windowMs }));
    }
    
    const window = this.windows.get(key)!;
    return window.increment();
  }
}
