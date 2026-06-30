import express, { Request, Response } from 'express';
import { createRateLimiter, MemoryStore, AllowlistManager } from './src';

const app = express();
const store = new MemoryStore();
app.set('trust proxy', true);

const fixedWindowLimiter = createRateLimiter({
  algorithm: 'fixed-window', limit: 3, windowMs: 10000, store,
});

const tokenBucketLimiter = createRateLimiter({
  algorithm: 'token-bucket', limit: 5, windowMs: 10000, store,
});

const allowlist = new AllowlistManager({ initialAllowlist: ['127.0.0.1', '::1'] });
const allowlistLimiter = createRateLimiter({
  algorithm: 'fixed-window', limit: 1, windowMs: 60000, store,
  allowlist: (identifier: string) => allowlist.isAllowed(identifier),
});

app.get('/test/fixed-window', fixedWindowLimiter, (req: Request, res: Response) => {
  res.json({ test: 'fixed-window', message: 'allowed' });
});

app.get('/test/token-bucket', tokenBucketLimiter, (req: Request, res: Response) => {
  res.json({ test: 'token-bucket', message: 'allowed' });
});

app.get('/test/allowlist', allowlistLimiter, (req: Request, res: Response) => {
  res.json({ test: 'allowlist', message: 'allowed' });
});

app.get('/', (req: Request, res: Response) => {
  res.json({ message: 'Server is running on port 3456!' });
});

const PORT = 3456;
app.listen(PORT, () => {
  console.log('Server running on http://localhost:' + PORT);
});
