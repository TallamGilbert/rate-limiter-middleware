import { describe, it, expect, beforeEach } from 'vitest';
import express, { Express, Request, Response } from 'express';
import request from 'supertest';
import { createRateLimiter } from '../src/middleware/rate-limiter';
import { MemoryStore } from '../src/stores/memory-store';
import { AllowlistManager } from '../src/allowlist/allowlist';

describe('Allowlist', () => {
  let app: Express;
  let store: MemoryStore;
  let allowlist: AllowlistManager;

  beforeEach(() => {
    app = express();
    store = new MemoryStore();
    allowlist = new AllowlistManager();
    app.set('trust proxy', true);
  });

  it('should bypass rate limiting for allowlisted IPs', async () => {
    allowlist.add('1.1.1.1');

    const limiter = createRateLimiter({
      algorithm: 'fixed-window',
      limit: 2,
      windowMs: 60000,
      store,
      allowlist: (identifier: string): boolean => allowlist.isAllowed(identifier),
    });

    app.get('/test', limiter, (req: Request, res: Response) => {
      res.json({ success: true });
    });

    // Allowlisted IP should never be limited
    for (let i = 0; i < 10; i++) {
      const response = await request(app)
        .get('/test')
        .set('X-Forwarded-For', '1.1.1.1');
      expect(response.status).toBe(200);
    }
  });

  it('should still limit non-allowlisted IPs', async () => {
    allowlist.add('1.1.1.1');

    const limiter = createRateLimiter({
      algorithm: 'fixed-window',
      limit: 2,
      windowMs: 60000,
      store,
      allowlist: (identifier: string): boolean => allowlist.isAllowed(identifier),
    });

    app.get('/test', limiter, (req: Request, res: Response) => {
      res.json({ success: true });
    });

    // Non-allowlisted IP should be limited
    await request(app).get('/test').set('X-Forwarded-For', '2.2.2.2');
    await request(app).get('/test').set('X-Forwarded-For', '2.2.2.2');
    
    const response = await request(app)
      .get('/test')
      .set('X-Forwarded-For', '2.2.2.2');
    expect(response.status).toBe(429);
  });

  it('should support runtime allowlist updates', async () => {
    const limiter = createRateLimiter({
      algorithm: 'fixed-window',
      limit: 2,
      windowMs: 60000,
      store,
      allowlist: (identifier: string): boolean => allowlist.isAllowed(identifier),
    });

    app.get('/test', limiter, (req: Request, res: Response) => {
      res.json({ success: true });
    });

    // Before allowlisting
    await request(app).get('/test').set('X-Forwarded-For', '3.3.3.3');
    await request(app).get('/test').set('X-Forwarded-For', '3.3.3.3');
    const beforeAllowlist = await request(app)
      .get('/test')
      .set('X-Forwarded-For', '3.3.3.3');
    expect(beforeAllowlist.status).toBe(429);

    // Add to allowlist at runtime
    allowlist.add('3.3.3.3');

    // Should now bypass limits
    const afterAllowlist = await request(app)
      .get('/test')
      .set('X-Forwarded-For', '3.3.3.3');
    expect(afterAllowlist.status).toBe(200);
  });

  it('should re-apply limits when removed from allowlist', async () => {
    allowlist.add('4.4.4.4');

    const limiter = createRateLimiter({
      algorithm: 'fixed-window',
      limit: 2,
      windowMs: 60000,
      store,
      allowlist: (identifier: string): boolean => allowlist.isAllowed(identifier),
    });

    app.get('/test', limiter, (req: Request, res: Response) => {
      res.json({ success: true });
    });

    // Allowlisted - no limits
    for (let i = 0; i < 5; i++) {
      const response = await request(app)
        .get('/test')
        .set('X-Forwarded-For', '4.4.4.4');
      expect(response.status).toBe(200);
    }

    // Remove from allowlist at runtime
    allowlist.remove('4.4.4.4');

    // Should now be limited
    await request(app).get('/test').set('X-Forwarded-For', '4.4.4.4');
    await request(app).get('/test').set('X-Forwarded-For', '4.4.4.4');
    
    const response = await request(app)
      .get('/test')
      .set('X-Forwarded-For', '4.4.4.4');
    expect(response.status).toBe(429);
  });
});
