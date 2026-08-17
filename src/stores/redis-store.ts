import Redis from 'ioredis';
import { RateLimitStore, RateLimitInfo } from './store.interface';

export class RedisStore implements RateLimitStore {
  private redis: Redis;
  private fixedWindowScript: string;
  private tokenBucketScript: string;

  constructor(redisUrl: string = 'redis://localhost:6379') {
    this.redis = new Redis(redisUrl);
    
    // Lua script for atomic fixed window increment
    this.fixedWindowScript = `
      local key = KEYS[1]
      local limit = tonumber(ARGV[1])
      local windowMs = tonumber(ARGV[2])
      local now = tonumber(ARGV[3])
      
      local current = redis.call('GET', key)
      
      if current == false then
        -- First request, set counter with TTL
        redis.call('SET', key, 1, 'PX', windowMs)
        return {1, limit - 1, now + windowMs}
      end
      
      local count = tonumber(current)
      local ttl = redis.call('PTTL', key)
      
      if ttl < 0 then
        -- Key exists but no TTL (shouldn't happen, but handle it)
        redis.call('SET', key, 1, 'PX', windowMs)
        return {1, limit - 1, now + windowMs}
      end
      
      local newCount = count + 1
      redis.call('SET', key, newCount, 'PX', ttl)
      
      if newCount <= limit then
        return {1, limit - newCount, now + ttl}
      else
        return {0, 0, now + ttl}
      end
    `;

    // Lua script for atomic token bucket consumption
    this.tokenBucketScript = `
      local key = KEYS[1]
      local rate = tonumber(ARGV[1])
      local capacity = tonumber(ARGV[2])
      local now = tonumber(ARGV[3])
      
      local bucket = redis.call('HMGET', key, 'tokens', 'lastRefill')
      local tokens = tonumber(bucket[1])
      local lastRefill = tonumber(bucket[2])
      
      if tokens == nil then
        -- Initialize bucket
        tokens = capacity
        lastRefill = now
      end
      
      -- Calculate refill
      local elapsedMs = now - lastRefill
      local tokensToAdd = (elapsedMs / 1000) * rate
      tokens = math.min(capacity, tokens + tokensToAdd)
      lastRefill = now
      
      if tokens >= 1 then
        tokens = tokens - 1
        redis.call('HMSET', key, 'tokens', tokens, 'lastRefill', lastRefill)
        -- Set TTL to prevent orphaned keys (capacity/rate * 1000 * 2)
        local ttl = math.ceil((capacity / rate) * 1000 * 2)
        redis.call('PEXPIRE', key, ttl)
        
        local timeToNextToken = math.ceil((1 / rate) * 1000)
        return {1, math.floor(tokens), now + timeToNextToken}
      else
        redis.call('HMSET', key, 'tokens', tokens, 'lastRefill', lastRefill)
        local timeToNextToken = math.ceil(((1 - tokens) / rate) * 1000)
        return {0, 0, now + timeToNextToken}
      end
    `;
  }

  async incrementCounter(
    key: string,
    limit: number,
    windowMs: number
  ): Promise<RateLimitInfo> {
    const now = Date.now();
    const redisKey = `ratelimit:window:${key}`;
    
    const result = await this.redis.eval(
      this.fixedWindowScript,
      1,
      redisKey,
      limit,
      windowMs,
      now
    ) as [number, number, number];

    return {
      allowed: result[0] === 1,
      remaining: result[1],
      resetTime: result[2],
    };
  }

  async consumeToken(
    key: string,
    rate: number,
    capacity: number,
    windowMs: number
  ): Promise<RateLimitInfo> {
    const now = Date.now();
    const redisKey = `ratelimit:bucket:${key}`;
    
    const result = await this.redis.eval(
      this.tokenBucketScript,
      1,
      redisKey,
      rate,
      capacity,
      now
    ) as [number, number, number];

    return {
      allowed: result[0] === 1,
      remaining: result[1],
      resetTime: result[2],
    };
  }

  async disconnect(): Promise<void> {
    await this.redis.quit();
  }
}
