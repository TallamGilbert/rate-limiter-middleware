# Rate Limiter Middleware

A TypeScript-based rate limiting middleware implementing token bucket and fixed window counter algorithms.

## Features

- Token Bucket Algorithm
- Fixed Window Counter Algorithm
- Configurable Per-Route Limits
- Pluggable Storage Backends (In-Memory & Redis)
- Runtime-Configurable Allowlist
- Standard HTTP Rate Limit Headers

## Installation

```bash
npm install rate-limiter-middleware
Quick Start
typescript
import { createRateLimiter, MemoryStore } from 'rate-limiter-middleware';
import express from 'express';

const app = express();
const limiter = createRateLimiter({
  algorithm: 'token-bucket',
  limit: 100,
  windowMs: 60000,
  store: new MemoryStore(),
});

app.use('/api', limiter);
Distributed State Problem
 IMPORTANT: The In-Memory Limitation

[Detailed explanation of why in-memory storage fails in distributed systems and how Redis solves it]

API Reference
[Documentation of all exports and types]

Testing
bash
npm test
License
MIT
```
