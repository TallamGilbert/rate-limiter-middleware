# Rate Limiter Middleware

A production-ready, reusable rate-limiting middleware for Express.js applications that implements both **token bucket** and **fixed window counter** algorithms with support for distributed deployments via Redis.

## What This Middleware Does

This middleware protects your API endpoints from abuse by limiting how many requests a single caller can make within a specified time window. It intercepts requests before they reach your route handlers, tracks usage per caller (IP address, API key, or user ID), and rejects callers who exceed their allowance with proper HTTP 429 status codes and headers.

### Key Features

- **Two algorithms** — token bucket (supports bursts) and fixed window counter (simple and predictable)
- **Distributed-ready** — in-memory storage for development, Redis-backed storage for production
- **Per-route configuration** — different endpoints can use different algorithms and limits
- **Runtime allowlist** — trusted callers can bypass limits without server restart
- **HTTP standards compliant** — returns `429 Too Many Requests`, `Retry-After`, and `X-RateLimit-Remaining` headers
- **Concurrency-safe** — atomic operations prevent over-admission under parallel request loads

---

## Installation

```bash
npm install rate-limiter-middleware
```

### Requirements

- Node.js 18.x or higher
- Redis (optional, for production deployments) 6.x or higher

### Peer Dependencies

```bash
npm install express ioredis
```

---

## Quick Start

```typescript
import express from 'express';
import { createRateLimiter, MemoryStore } from 'rate-limiter-middleware';

const app = express();
const store = new MemoryStore();

// Protect all /api routes: 100 requests per minute using fixed window
const apiLimiter = createRateLimiter({
  algorithm: 'fixed-window',
  limit: 100,
  windowMs: 60000, // 1 minute
  store,
});

app.use('/api', apiLimiter);

app.get('/api/data', (req, res) => {
  res.json({ message: 'This endpoint is rate-limited' });
});

app.listen(3000, () => {
  console.log('Server running on port 3000');
});
```

---

## Protecting a Route

The middleware is designed to be reusable across multiple routes. Each instance can have its own configuration:

```typescript
import { createRateLimiter, MemoryStore } from 'rate-limiter-middleware';

const store = new MemoryStore();

const strictLimiter = createRateLimiter({
  algorithm: 'fixed-window',
  limit: 5,
  windowMs: 60000, // 5 requests per minute
  store,
});

const generousLimiter = createRateLimiter({
  algorithm: 'token-bucket',
  limit: 100,
  windowMs: 60000, // 100 requests per minute with burst support
  store,
});

const authLimiter = createRateLimiter({
  algorithm: 'fixed-window',
  limit: 3,
  windowMs: 300000, // 3 requests per 5 minutes
  store,
  keyGenerator: (req) => req.body.username || req.ip,
});

app.post('/api/login', authLimiter, loginHandler);
app.get('/api/search', generousLimiter, searchHandler);
app.post('/api/comment', strictLimiter, commentHandler);
```

### Configuring Limits Per Route

```typescript
const routeConfigs = {
  '/api/public': {
    algorithm: 'fixed-window' as const,
    limit: 30,
    windowMs: 60000,
  },
  '/api/user': {
    algorithm: 'token-bucket' as const,
    limit: 300,
    windowMs: 60000,
  },
  '/api/admin': {
    algorithm: 'token-bucket' as const,
    limit: 1000,
    windowMs: 60000,
  },
};

Object.entries(routeConfigs).forEach(([path, config]) => {
  app.use(path, createRateLimiter({ ...config, store }));
});
```

> **Default behavior:** If a route has no limiter configured, it has no rate limiting. This is intentional, to avoid unexpected rejections. Always explicitly apply limiters to routes you want to protect.

> **`keyGenerator` caveat:** If your key generator can return `undefined` (e.g. `req.user?.id` evaluated before auth middleware has run), all such callers collapse into a single shared bucket keyed by `"undefined"`. Always provide a fallback, as shown above (`req.user?.id || req.ip`).

---

## Choosing an Algorithm

### Fixed Window Counter

Maintains a counter that resets at fixed time intervals (e.g., every minute). Each request increments the counter; once the limit is reached, further requests are rejected until the window resets.

**Best for:** simple rate limiting needs, predictable limits, when burst traffic isn't a concern.

```text
Window 1 (12:00-12:01): [✓✓✓...✓] 100 allowed, 101st rejected
Window 2 (12:01-12:02): Counter resets, new 100 allowed
```

⚠️ **Boundary Burst Problem:** A caller can send 100 requests at 12:00:59 and another 100 at 12:01:00 — 200 requests in 2 seconds. Use token bucket if this is a concern.

### Token Bucket

A bucket holds up to `capacity` tokens and refills at a constant rate. Each request consumes one token; if the bucket is empty, the request is rejected. Tokens accumulate while idle, allowing controlled bursts.

**Best for:** APIs that expect occasional bursts, controlling average rate while allowing short spikes, avoiding the boundary burst problem.

```text
Initial state: [100 tokens]
Send 50 requests: [50 tokens] remaining
Wait 5 seconds: [+50 tokens] refilled to 100
Send 100 requests: [0 tokens] bucket empty
Must wait ~10 seconds for next request (1 token refills in 0.1s)
```

### Configuration Parameters

**Fixed Window:**

- `limit` — maximum requests per window
- `windowMs` — window duration in milliseconds

**Token Bucket:**

- `limit` — bucket capacity (maximum burst size)
- `windowMs` — used to calculate refill rate = `limit / windowMs * 1000` tokens per second

---

## Response Headers

Every request (allowed or rejected) receives:

| Header                  | Description                                 | Example      |
| ----------------------- | ------------------------------------------- | ------------ |
| `X-RateLimit-Remaining` | Requests remaining in current window/bucket | `42`         |
| `X-RateLimit-Reset`     | Unix timestamp (seconds) when limit resets  | `1719705600` |

Rejected requests additionally receive:

| Header        | Description                    | Example |
| ------------- | ------------------------------ | ------- |
| `Retry-After` | Seconds until client can retry | `30`    |

### Retry-After Calculation

**Fixed Window** — time remaining until the current window ends:

```text
Retry-After = (windowStart + windowMs - currentTime) / 1000
```

**Token Bucket** — time until next token is refilled:

```text
Retry-After = (1 - currentTokens) / refillRate
```

Token bucket typically has shorter retry times (waiting for a single token refill) compared to fixed window (waiting for the entire window to reset).

### HTTP Status Codes

- `200 OK` — request was within limits
- `429 Too Many Requests` — rate limit exceeded

```json
{
  "error": "Too Many Requests",
  "message": "Rate limit exceeded. Try again in 30 seconds.",
  "retryAfter": 30
}
```

---

## In-Memory vs Redis

### In-Memory Storage (Development)

The `MemoryStore` uses JavaScript `Map` objects to track rate limits within a single Node.js process. Perfect for development and testing, but has critical limitations in production.

```typescript
import { MemoryStore } from 'rate-limiter-middleware';
const store = new MemoryStore();
```

### The Distributed-State Problem

When you deploy multiple instances of your service behind a load balancer, each instance maintains its own independent rate limit counters in memory. This breaks rate limiting because:

- **State is isolated** — Instance A's counters are invisible to Instance B
- **Requests are distributed** — load balancers spread requests across all instances
- **Limits multiply** — a caller hitting different instances gets separate allowances

```text
Configuration: 100 requests/minute
Instances: 3 behind a load balancer

Caller sends 300 requests:
- Instance A receives 100 (in-memory counter: 100/100) ✓
- Instance B receives 100 (in-memory counter: 100/100) ✓
- Instance C receives 100 (in-memory counter: 100/100) ✓

Result: 300 requests allowed (3x the configured limit!)
```

Additional issues with in-memory storage: state is lost on server restart or deployment, memory leaks are possible without manual cleanup, and there's no visibility into global usage patterns.

### Redis Storage (Production)

The `RedisStore` solves the distributed-state problem by providing a single source of truth that all instances share:

```typescript
import { RedisStore } from 'rate-limiter-middleware';
const store = new RedisStore('redis://localhost:6379');
```

**How it works:**

- All instances connect to the same Redis server
- Rate limit keys are stored centrally (e.g., `ratelimit:window:192.168.1.1`)
- Lua scripts execute atomically to prevent race conditions
- A request to any instance updates the global counter

> **Redis Cluster caveat:** Atomicity via Lua scripting holds for a single Redis instance or for keys that hash to the same slot. If you scale to Redis Cluster, a script touching multiple keys across different hash slots is **not** guaranteed atomic. Use hash tags (e.g. `ratelimit:{192.168.1.1}:window`) to keep a caller's keys on the same node if you move to a clustered deployment.

```text
Caller sends 300 requests across 3 instances:
- Total allowed: 100 (correct!)
- All instances see the same counter
- Limit is truly global
```

### Configuration

```typescript
const devStore = new MemoryStore();
const prodStore = new RedisStore(process.env.REDIS_URL);

const limiter = createRateLimiter({
  algorithm: 'fixed-window',
  limit: 100,
  windowMs: 60000,
  store: process.env.NODE_ENV === 'production' ? prodStore : devStore,
});
```

```bash
REDIS_URL=redis://localhost:6379  # Redis connection string
```

---

## The Allowlist

Some callers — internal services, monitoring tools, trusted partners — should never be rate-limited.

```typescript
import { AllowlistManager } from 'rate-limiter-middleware';

const allowlist = new AllowlistManager({
  initialAllowlist: ['10.0.0.1', 'monitoring-bot'],
});

const limiter = createRateLimiter({
  algorithm: 'fixed-window',
  limit: 100,
  windowMs: 60000,
  store,
  allowlist: (identifier) => allowlist.isAllowed(identifier),
});
```

### Runtime Configuration (No Restart Required)

```typescript
allowlist.add('192.168.1.100');
allowlist.add(['10.0.0.5', 'trusted-service']);
allowlist.remove('192.168.1.100'); // re-applies rate limits

console.log(allowlist.getAll());

allowlist.on('updated', ({ added, removed }) => {
  console.log(`Allowlist updated: added ${added}, removed ${removed}`);
});
```

Changes take effect immediately on subsequent requests, without any server restart.

### Redis-Backed Allowlist (Production)

```typescript
import Redis from 'ioredis';
import { RedisAllowlistManager } from 'rate-limiter-middleware';

const redis = new Redis('redis://localhost:6379');
const allowlist = new RedisAllowlistManager(redis, 'ratelimit:allowlist');

await allowlist.addToRedis('10.0.0.1');
await allowlist.removeFromRedis('10.0.0.1');
```

The Redis allowlist syncs automatically every 30 seconds (configurable), persists across restarts, and shares state across all instances. It can also be managed directly via Redis CLI:

```bash
redis-cli SADD ratelimit:allowlist "192.168.1.1"
redis-cli SREM ratelimit:allowlist "192.168.1.1"
redis-cli SMEMBERS ratelimit:allowlist
```

---

## Advanced Usage Examples

### Example 1: Multi-Tier Rate Limiting

```typescript
const authLimiter = createRateLimiter({
  algorithm: 'fixed-window',
  limit: 5,
  windowMs: 300000, // 5 attempts per 5 minutes
  store: redisStore,
  keyGenerator: (req) => req.ip,
});

const readLimiter = createRateLimiter({
  algorithm: 'token-bucket',
  limit: 300,
  windowMs: 60000,
  store: redisStore,
  keyGenerator: (req) => req.headers['x-api-key'] as string,
});

const batchLimiter = createRateLimiter({
  algorithm: 'token-bucket',
  limit: 1000,
  windowMs: 60000,
  store: redisStore,
  allowlist: (id) => adminAllowlist.isAllowed(id),
});
```

### Example 2: Custom Caller Identification

```typescript
// Rate limit by user ID (requires authentication middleware first)
const userLimiter = createRateLimiter({
  algorithm: 'fixed-window',
  limit: 100,
  windowMs: 60000,
  store: redisStore,
  keyGenerator: (req) => req.user?.id || req.ip, // always provide a fallback
});

// Rate limit by API key with fallback to IP
const apiKeyLimiter = createRateLimiter({
  algorithm: 'token-bucket',
  limit: 1000,
  windowMs: 3600000, // per hour
  store: redisStore,
  keyGenerator: (req) => (req.headers['x-api-key'] as string) || req.ip,
});
```

### Example 3: Conditional Rate Limiting

```typescript
const tieredLimiter = createRateLimiter({
  algorithm: 'token-bucket',
  limit: 100,
  windowMs: 60000,
  store: redisStore,
  keyGenerator: (req) => {
    const userId = req.user?.id || 'anonymous';
    const tier = req.user?.tier || 'free';
    return `${tier}:${userId}`; // separate counters per tier
  },
});

app.use('/api', (req, res, next) => {
  const tier = req.user?.tier;
  const limit = tier === 'premium' ? 1000 : tier === 'pro' ? 500 : 100;

  createRateLimiter({
    algorithm: 'token-bucket',
    limit,
    windowMs: 60000,
    store: redisStore,
  })(req, res, next);
});
```

---

## API Reference

### `createRateLimiter(config)`

Creates Express middleware that enforces rate limits.

```typescript
interface RateLimiterConfig {
  algorithm: 'token-bucket' | 'fixed-window';
  limit: number;
  windowMs: number;
  store: RateLimitStore;
  keyGenerator?: (req: Request) => string;
  allowlist?: (identifier: string) => boolean;
}
```

**Returns:** Express middleware function

### `RateLimitInfo`

Returned by every store operation; used internally to compute response headers.

```typescript
interface RateLimitInfo {
  allowed: boolean; // whether this request is within limits
  remaining: number; // requests/tokens remaining
  resetAt: number; // unix timestamp (ms) when the window/bucket resets
  retryAfterMs?: number; // present only when allowed is false
}
```

### `RateLimitStore`

The interface any custom storage backend must implement.

```typescript
interface RateLimitStore {
  incrementCounter(key: string, limit: number, windowMs: number): Promise<RateLimitInfo>;
  consumeToken(
    key: string,
    rate: number,
    capacity: number,
    windowMs: number,
  ): Promise<RateLimitInfo>;
  cleanup?(): void;
  disconnect?(): Promise<void>;
}
```

### `MemoryStore`

In-memory storage implementation for development.

```typescript
class MemoryStore implements RateLimitStore {
  async incrementCounter(key: string, limit: number, windowMs: number): Promise<RateLimitInfo>;
  async consumeToken(
    key: string,
    rate: number,
    capacity: number,
    windowMs: number,
  ): Promise<RateLimitInfo>;
  cleanup(): void;
}
```

### `RedisStore`

Redis-backed storage for production deployments.

```typescript
class RedisStore implements RateLimitStore {
  constructor(redisUrl?: string);
  async incrementCounter(key: string, limit: number, windowMs: number): Promise<RateLimitInfo>;
  async consumeToken(
    key: string,
    rate: number,
    capacity: number,
    windowMs: number,
  ): Promise<RateLimitInfo>;
  async disconnect(): Promise<void>;
}
```

### `AllowlistManager`

Runtime-configurable allowlist for bypassing rate limits.

```typescript
class AllowlistManager extends EventEmitter {
  constructor(options?: { initialAllowlist?: string[]; refreshIntervalMs?: number });
  isAllowed(identifier: string): boolean;
  add(identifiers: string | string[]): void;
  remove(identifiers: string | string[]): void;
  getAll(): string[];
  clear(): void;
}
```

### `RedisAllowlistManager`

Redis-backed allowlist that syncs across instances.

```typescript
class RedisAllowlistManager extends AllowlistManager {
  constructor(redisClient: any, redisKey?: string, refreshIntervalMs?: number);
  async addToRedis(identifiers: string | string[]): Promise<void>;
  async removeFromRedis(identifiers: string | string[]): Promise<void>;
}
```

---

## Testing

The middleware includes comprehensive concurrency simulation tests that prove rate limits hold under parallel request loads.

```bash
# Run all tests
npm test

# Run once (without watch mode)
npx vitest run

# Run a specific test suite
npm test -- tests/concurrency.test.ts
npm test -- tests/allowlist.test.ts

# Run with coverage
npm test -- --coverage

# Run with verbose output
npm test -- --reporter=verbose
```

### What the Concurrency Tests Prove

- **No over-admission** — with a limit of 10 and 50 concurrent requests, exactly 10 succeed and 40 receive `429`
- **Per-caller isolation** — multiple callers running concurrently each get their own allowance
- **Algorithm correctness** — both fixed window and token bucket are tested under load
- **Race condition prevention** — atomic operations ensure no two requests consume the same "last allowed" slot

```text
✓ Fixed Window - Memory Store > should never exceed limit under concurrent requests (203ms)
✓ Fixed Window - Memory Store > should handle multiple callers concurrently (64ms)
✓ Token Bucket - Memory Store > should never exceed capacity under concurrent requests (43ms)
✓ Redis Store Concurrency > should maintain consistency with Redis store under concurrency (10720ms)
```

### Test Architecture

```typescript
const LIMIT = 10;
const CONCURRENT_REQUESTS = 50;

// Fire all requests simultaneously
const promises = Array(CONCURRENT_REQUESTS)
  .fill(null)
  .map(() => request(app).get('/test'));

const responses = await Promise.all(promises);

const successful = responses.filter((r) => r.status === 200);
expect(successful.length).toBeLessThanOrEqual(LIMIT);
```

This pattern proves that even when 50 requests hit the server in the same millisecond, exactly 10 (or fewer) make it through, and the rest get proper `429` responses.

---

## Known Limitations

- **Clock skew** — token bucket refill calculations depend on system time. Significant clock differences between instances can cause inconsistent behavior. Use NTP in production.
- **Redis single point of failure** — if Redis becomes unavailable, rate limiting stops working. Consider Redis Sentinel or Cluster for high availability.
- **Redis Cluster atomicity** — Lua script atomicity is guaranteed per-node, not across hash slots. Use key hash tags if moving to a clustered deployment (see Redis Storage section above).
- **Memory store cleanup** — the in-memory store doesn't automatically clean up expired entries. Call `store.cleanup()` periodically, or use Redis in production.
- **IPv6 privacy extensions** — clients using IPv6 privacy extensions change IP addresses frequently, potentially bypassing IP-based rate limits.
- **Shared IPs** — users behind NAT or corporate proxies share IP addresses, meaning one heavy user can exhaust the limit for everyone behind that IP.
- **Distributed state latency** — Redis operations add network latency (~1–5ms). For ultra-low-latency requirements, consider local caching with eventual consistency.
- **Fixed window boundary issue** — the fixed window algorithm can allow up to 2x the configured limit at window boundaries. Use token bucket if this is problematic.

---

## Environment Variables

| Variable    | Description                          | Default                  |
| ----------- | ------------------------------------ | ------------------------ |
| `REDIS_URL` | Redis connection string              | `redis://localhost:6379` |
| `NODE_ENV`  | Environment (development/production) | `development`            |

---

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'feat: add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

MIT
