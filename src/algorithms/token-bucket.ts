export interface TokenBucketConfig {
  rate: number;        // Tokens per second
  capacity: number;    // Maximum tokens in bucket
}

export class TokenBucket {
  private tokens: number;
  private lastRefill: number;
  
  constructor(private config: TokenBucketConfig) {
    this.tokens = config.capacity;
    this.lastRefill = Date.now();
  }

  refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000; // Convert to seconds
    const tokensToAdd = elapsed * this.config.rate;
    
    this.tokens = Math.min(this.config.capacity, this.tokens + tokensToAdd);
    this.lastRefill = now;
  }

  consume(count: number = 1): { allowed: boolean; remaining: number; resetTime: number } {
    this.refill();
    
    if (this.tokens >= count) {
      this.tokens -= count;
      return {
        allowed: true,
        remaining: Math.floor(this.tokens),
        resetTime: this.calculateResetTime(),
      };
    }
    
    return {
      allowed: false,
      remaining: 0,
      resetTime: this.calculateResetTime(),
    };
  }

  private calculateResetTime(): number {
    const tokensNeeded = this.config.capacity - this.tokens;
    const secondsToFull = tokensNeeded / this.config.rate;
    return Date.now() + (secondsToFull * 1000);
  }
}
