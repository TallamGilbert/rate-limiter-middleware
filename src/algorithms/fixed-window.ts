export interface FixedWindowConfig {
  limit: number;      // Max requests per window
  windowMs: number;   // Window size in milliseconds
}

export class FixedWindow {
  private counter: number = 0;
  private windowStart: number;
  
  constructor(private config: FixedWindowConfig) {
    this.windowStart = Date.now();
  }

  resetIfNeeded(): void {
    const now = Date.now();
    if (now - this.windowStart >= this.config.windowMs) {
      this.counter = 0;
      this.windowStart = now;
    }
  }

  increment(): { allowed: boolean; remaining: number; resetTime: number } {
    this.resetIfNeeded();
    
    if (this.counter < this.config.limit) {
      this.counter++;
      return {
        allowed: true,
        remaining: this.config.limit - this.counter,
        resetTime: this.windowStart + this.config.windowMs,
      };
    }
    
    return {
      allowed: false,
      remaining: 0,
      resetTime: this.windowStart + this.config.windowMs,
    };
  }
}
