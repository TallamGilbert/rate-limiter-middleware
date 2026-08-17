import express, { Request, Response } from 'express';
import { createRateLimiter, MemoryStore } from './src';
import { AllowlistManager } from './src/allowlist/allowlist';

const app = express();
const store = new MemoryStore();

// Trust proxy for accurate IP detection
app.set('trust proxy', true);

// ============================================
// Test 1: Fixed Window Counter
// ============================================
const fixedWindowLimiter = createRateLimiter({
  algorithm: 'fixed-window',
  limit: 3, // 3 requests per 10 seconds
  windowMs: 10000, // 10 second window
  store,
});

let fixedWindowCounter = 0;
app.get('/test/fixed-window', fixedWindowLimiter, (req: Request, res: Response) => {
  fixedWindowCounter++;
  res.json({
    test: 'Fixed Window Counter',
    requestNumber: fixedWindowCounter,
    message: 'Request allowed',
    tip: 'Send more than 3 requests in 10 seconds to see 429 errors',
  });
});

// ============================================
// Test 2: Token Bucket
// ============================================
const tokenBucketLimiter = createRateLimiter({
  algorithm: 'token-bucket',
  limit: 5, // 5 token capacity
  windowMs: 10000, // Refill rate: 0.5 tokens/second (5/10)
  store,
});

let tokenBucketCounter = 0;
app.get('/test/token-bucket', tokenBucketLimiter, (req: Request, res: Response) => {
  tokenBucketCounter++;
  res.json({
    test: 'Token Bucket',
    requestNumber: tokenBucketCounter,
    message: 'Request allowed',
    tip: 'Send 5 requests quickly (burst), then wait for refill',
  });
});

// ============================================
// Test 3: Allowlist Bypass
// ============================================
const allowlist = new AllowlistManager({
  initialAllowlist: ['127.0.0.1', '::1'], // Localhost is allowlisted
});

const allowlistLimiter = createRateLimiter({
  algorithm: 'fixed-window',
  limit: 1, // Very strict: 1 request per minute
  windowMs: 60000,
  store,
  allowlist: (identifier: string) => allowlist.isAllowed(identifier),
});

app.get('/test/allowlist', allowlistLimiter, (req: Request, res: Response) => {
  res.json({
    test: 'Allowlist',
    message: 'You are either allowlisted or within your limit',
    allowlistStatus: allowlist.isAllowed(req.ip || 'unknown') ? 'BYPASSED' : 'RATE_LIMITED',
    tip: 'Localhost is allowlisted. Try from another IP to see rate limiting.',
  });
});

// ============================================
// Test 4: Per-Route Configuration
// ============================================
const strictLimiter = createRateLimiter({
  algorithm: 'fixed-window',
  limit: 2,
  windowMs: 15000,
  store,
});

const generousLimiter = createRateLimiter({
  algorithm: 'token-bucket',
  limit: 10,
  windowMs: 10000,
  store,
});

app.get('/test/strict', strictLimiter, (req: Request, res: Response) => {
  res.json({ route: 'strict', limit: '2 requests per 15 seconds' });
});

app.get('/test/generous', generousLimiter, (req: Request, res: Response) => {
  res.json({ route: 'generous', limit: '10 requests per 10 seconds with burst' });
});

// ============================================
// Test 5: Headers Inspection
// ============================================
app.get('/test/headers', fixedWindowLimiter, (req: Request, res: Response) => {
  res.json({
    message: 'Check response headers for rate limit info',
    headers: {
      'X-RateLimit-Remaining': res.getHeader('X-RateLimit-Remaining'),
      'X-RateLimit-Reset': res.getHeader('X-RateLimit-Reset'),
    },
  });
});

// ============================================
// Test 6: Different Caller Identification
// ============================================
const userLimiter = createRateLimiter({
  algorithm: 'fixed-window',
  limit: 3,
  windowMs: 10000,
  store,
  keyGenerator: (req: Request) => {
    // Use custom header or fallback to IP
    return (req.headers['x-user-id'] as string) || req.ip || 'anonymous';
  },
});

app.get('/test/user', userLimiter, (req: Request, res: Response) => {
  res.json({
    test: 'Per-User Rate Limiting',
    userId: req.headers['x-user-id'] || req.ip,
    message: 'Each user gets their own limit',
    tip: 'Send requests with different X-User-Id headers',
  });
});

// ============================================
// Test 7: Allowlist Runtime Update
// ============================================
app.post('/admin/allowlist/add', express.json(), (req: Request, res: Response) => {
  const { ip } = req.body;
  if (!ip) {
    return res.status(400).json({ error: 'IP is required' });
  }
  allowlist.add(ip);
  res.json({
    message: `Added ${ip} to allowlist`,
    allowlist: allowlist.getAll(),
  });
});

app.post('/admin/allowlist/remove', express.json(), (req: Request, res: Response) => {
  const { ip } = req.body;
  if (!ip) {
    return res.status(400).json({ error: 'IP is required' });
  }
  allowlist.remove(ip);
  res.json({
    message: `Removed ${ip} from allowlist`,
    allowlist: allowlist.getAll(),
  });
});

app.get('/admin/allowlist', (req: Request, res: Response) => {
  res.json({ allowlist: allowlist.getAll() });
});

// ============================================
// Unprotected route for comparison
// ============================================
app.get('/test/unlimited', (req: Request, res: Response) => {
  res.json({
    message: 'This endpoint has NO rate limiting',
    tip: 'You can hit this as many times as you want',
  });
});

// ============================================
// Home page with test instructions
// ============================================
app.get('/', (req: Request, res: Response) => {
  res.json({
    message: 'Rate Limiter Test Server',
    endpoints: {
      'GET /test/fixed-window': 'Fixed window: 3 requests per 10 seconds',
      'GET /test/token-bucket': 'Token bucket: 5 token capacity, refill 0.5/sec',
      'GET /test/allowlist': 'Allowlist test: localhost bypassed',
      'GET /test/strict': 'Strict: 2 requests per 15 seconds',
      'GET /test/generous': 'Generous: 10 requests per 10 seconds',
      'GET /test/headers': 'Check rate limit headers',
      'GET /test/user': 'Per-user limiting (use X-User-Id header)',
      'GET /test/unlimited': 'No rate limiting (control group)',
      'POST /admin/allowlist/add': 'Add IP to allowlist { "ip": "1.2.3.4" }',
      'POST /admin/allowlist/remove': 'Remove IP from allowlist',
      'GET /admin/allowlist': 'View allowlist',
    },
    howToTest: {
      fixedWindow: 'Run: for i in {1..5}; do curl -i http://localhost:3000/test/fixed-window; done',
      tokenBucket: 'Run: for i in {1..7}; do curl -i http://localhost:3000/test/token-bucket; done',
      headers: 'Run: curl -i http://localhost:3000/test/headers',
      allowlist:
        'Run: curl http://localhost:3000/test/allowlist (should always work from localhost)',
      users: 'Run: curl -H "X-User-Id: alice" http://localhost:3000/test/user',
    },
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\nRate Limiter Test Server running on http://localhost:${PORT}`);
  console.log('\n Quick Test Commands:');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('\n  Test Fixed Window (should block after 3):');
  console.log(
    '   for i in {1..5}; do curl -s http://localhost:3000/test/fixed-window | jq .; echo "---"; done',
  );
  console.log('\n  Test Token Bucket (burst of 5, then wait):');
  console.log(
    '   for i in {1..7}; do curl -s http://localhost:3000/test/token-bucket | jq .; echo "---"; done',
  );
  console.log('\n  Test Headers:');
  console.log('   curl -i http://localhost:3000/test/headers');
  console.log('\n  Test Allowlist (localhost bypassed):');
  console.log('   for i in {1..5}; do curl -s http://localhost:3000/test/allowlist | jq .; done');
  console.log('\n  Test Per-User Limits:');
  console.log(
    '   for i in {1..4}; do curl -s -H "X-User-Id: alice" http://localhost:3000/test/user | jq .; done',
  );
  console.log('\n  View Allowlist:');
  console.log('   curl http://localhost:3000/admin/allowlist | jq .');
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
});
