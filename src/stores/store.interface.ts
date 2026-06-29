export interface RateLimitInfo {
  allowed: boolean;
  remaining: number;
  resetTime: number;
}

export interface RateLimitStore {
  consumeToken(
    key: string,
    rate: number,
    capacity: number,
    windowMs: number
  ): Promise<RateLimitInfo>;
  
  incrementCounter(
    key: string,
    limit: number,
    windowMs: number
  ): Promise<RateLimitInfo>;
}
