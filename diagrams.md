# Rate Limiter Control Flow Diagrams

## 1. Token Bucket Algorithm

```mermaid
flowchart TD
    A[Token Bucket Request] --> B[Read Bucket State<br/>tokens, lastRefillTime]
    B --> C[Calculate Elapsed Time<br/>now - lastRefillTime]
    C --> D[Calculate Tokens to Add<br/>elapsed × refillRate]
    D --> E[Update Token Count<br/>min capacity, tokens + added]
    E --> F{Is tokens >= 1?}

    F -->| Yes| G[Consume 1 Token<br/>tokens = tokens - 1]
    G --> H[Update lastRefillTime = now]
    H --> I[Return Allowed<br/>remaining tokens<br/>time to next token]
    I --> J[200 OK Response]

    F -->| No| K[Calculate Wait Time<br/>1 - tokens / refillRate]
    K --> L[Return Rejected<br/>remaining: 0<br/>Retry-After: waitTime]
    L --> M[429 Response]
```

## 2. Fixed Window Algorithm

```mermaid
flowchart TD
    A[Fixed Window Request] --> B[Read Window State<br/>counter, windowStartTime]
    B --> C{Has Window Expired?<br/>now - windowStart >= windowMs}

    C -->| Yes| D[Reset Counter = 0<br/>windowStart = now]
    D --> E[Increment Counter<br/>counter = 1]

    C -->| No| F[Increment Counter<br/>counter = counter + 1]

    E --> G{Is counter <= limit?}
    F --> G

    G -->| Yes| H[Return Allowed<br/>remaining = limit - counter<br/>resetTime = windowStart + windowMs]
    H --> I[200 OK Response]

    G -->| No| J[Return Rejected<br/>remaining: 0<br/>Retry-After: time until window reset]
    J --> K[429 Response]
```

## 3. Distributed Architecture

```mermaid
flowchart LR
    subgraph Clients
        C1[Client 1]
        C2[Client 2]
        C3[Client 3]
    end

    subgraph LoadBalancer
        LB[ Load Balancer]
    end

    subgraph Instance1
        I1[Express App 1<br/>Middleware<br/>Memory Store]
    end

    subgraph Instance2
        I2[Express App 2<br/>Middleware<br/>Memory Store]
    end

    subgraph Instance3
        I3[Express App 3<br/>Middleware<br/>Memory Store]
    end

    subgraph RedisCluster
        R[Redis Server<br/>Shared State<br/>Lua Scripts<br/>Atomic Operations]
    end

    C1 --> LB
    C2 --> LB
    C3 --> LB

    LB --> I1
    LB --> I2
    LB --> I3

    I1 -->|Read/Write| R
    I2 -->|Read/Write| R
    I3 -->|Read/Write| R
```

## 4. Race Condition Problem & Solution

```mermaid
sequenceDiagram
    participant A as Request A
    participant B as Request B
    participant R as Redis

    Note over A,B: WITHOUT Lua (Race Condition)
    A->>R: READ counter = 9
    B->>R: READ counter = 9
    A->>A: CHECK 9 < 10 ✓
    B->>B: CHECK 9 < 10 ✓
    A->>R: WRITE counter = 10
    B->>R: WRITE counter = 10
    Note over A,B: BOTH ADMITTED! (11 total)

    Note over A,B: WITH Lua (Atomic)
    A->>R: EXECUTE Lua Script<br/>(read+check+write)
    R-->>A: Allowed (counter=10)
    B->>R: EXECUTE Lua Script<br/>(reads counter=10)
    R-->>B: Rejected (counter=10 > limit)
    Note over A,B: ONLY ONE ADMITTED! ✓
```

## 5. Allowlist Runtime Update Flow

```mermaid
flowchart TD
    A[Admin Action:<br/>Add/Remove Allowlist Entry] --> B{Backend Type}

    B -->|In-Memory| C[AllowlistManager.add/remove]
    C --> D[Update Local Set]
    D --> E[Emit 'updated' Event]
    E --> F[Subsequent Requests<br/>Use New Allowlist]

    B -->|Redis| G[RedisAllowlistManager.addToRedis/removeFromRedis]
    G --> H[Update Redis Set<br/>SADD/SREM]
    H --> I[Update Local Cache]
    I --> J[Other Instances:<br/>Auto-refresh every 30s]
    J --> K[All Instances Sync<br/>Within 30 Seconds]
```

## 6. Project Structure

```mermaid
flowchart LR
    A[rate-limiter-middleware] --> B[src/]
    A --> C[tests/]
    A --> D[examples/]
    A --> E[README.md]

    B --> F[algorithms/]
    B --> G[stores/]
    B --> H[middleware/]
    B --> I[allowlist/]

    F --> J[token-bucket.ts]
    F --> K[fixed-window.ts]

    G --> L[store.interface.ts]
    G --> M[memory-store.ts]
    G --> N[redis-store.ts]

    H --> O[rate-limiter.ts]
    I --> P[allowlist.ts]

    C --> Q[token-bucket.test.ts]
    C --> R[fixed-window.test.ts]
    C --> S[middleware.test.ts]
    C --> T[concurrency.test.ts]
    C --> U[allowlist.test.ts]
```

## 7. Concurrency Test Flow

```mermaid
flowchart LR
    A[50 Concurrent Requests<br/>Fire Simultaneously] --> B[Promise.all]
    B --> C[All Hit Express App<br/>Same Middleware]
    C --> D[Atomic Check in Store]
    D --> E{Result Distribution}

    E --> F[10 Requests: 200 OK<br/>Handler Executes]
    E --> G[40 Requests: 429<br/>Rejected with Headers]

    F --> H[Assert: successful <= LIMIT]
    G --> I[Assert: rejected = TOTAL - LIMIT]

    H --> J[ Test Passes:<br/>No Over-Admission]
    I --> J
```
