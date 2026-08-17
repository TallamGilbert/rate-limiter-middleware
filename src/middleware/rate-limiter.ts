import { Request, Response, NextFunction } from 'express';
import { RateLimitStore } from '../stores/store.interface';

export type Algorithm = 'token-bucket' | 'fixed-window';

export interface RateLimiterConfig {
  algorithm: Algorithm;
  limit: number;
  windowMs: number;
  store: RateLimitStore;
  keyGenerator?: (req: Request) => string;
  allowlist?: Set<string> | ((identifier: string) => boolean);
}

export function createRateLimiter(config: RateLimiterConfig) {
  // Default key generator uses IP address
  const keyGenerator = config.keyGenerator || ((req: Request) => {
    return req.ip || req.socket.remoteAddress || 'unknown';
  });

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const identifier = keyGenerator(req);

    // Check allowlist first (EXT-001)
    if (config.allowlist) {
      const isAllowed = typeof config.allowlist === 'function'
        ? config.allowlist(identifier)
        : config.allowlist.has(identifier);
      
      if (isAllowed) {
        // Bypass rate limiting completely
        return next();
      }
    }

    let result;

    if (config.algorithm === 'token-bucket') {
      if (!config.store.consumeToken) {
        throw new Error('Store does not support token bucket algorithm');
      }
      // For token bucket: rate = limit/windowMs * 1000 (tokens per second)
      const rate = config.limit / (config.windowMs / 1000);
      result = await config.store.consumeToken(
        identifier,
        rate,
        config.limit,
        config.windowMs
      );
    } else {
      result = await config.store.incrementCounter(
        identifier,
        config.limit,
        config.windowMs
      );
    }

    // Set rate limit headers (REQ-004)
    res.setHeader('X-RateLimit-Remaining', result.remaining.toString());
    res.setHeader('X-RateLimit-Reset', Math.ceil(result.resetTime / 1000).toString());

    if (!result.allowed) {
      // Calculate Retry-After in seconds
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((result.resetTime - Date.now()) / 1000)
      );
      
      res.setHeader('Retry-After', retryAfterSeconds.toString());
      res.status(429).json({
        error: 'Too Many Requests',
        message: `Rate limit exceeded. Try again in ${retryAfterSeconds} seconds.`,
        retryAfter: retryAfterSeconds,
      });
      return;
    }

    next();
  };
}
