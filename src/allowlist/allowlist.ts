import { EventEmitter } from 'events';

export class AllowlistManager extends EventEmitter {
  protected allowedIdentifiers: Set<string>;
  private refreshInterval?: NodeJS.Timeout;

  constructor(
    private options: {
      initialAllowlist?: string[];
      refreshIntervalMs?: number;
    } = {}
  ) {
    super();
    this.allowedIdentifiers = new Set(options.initialAllowlist || []);
    
    if (options.refreshIntervalMs) {
      this.startAutoRefresh(options.refreshIntervalMs);
    }
  }

  /**
   * Check if an identifier is in the allowlist
   */
  isAllowed(identifier: string): boolean {
    return this.allowedIdentifiers.has(identifier);
  }

  /**
   * Add identifier(s) to the allowlist (runtime update)
   */
  add(identifiers: string | string[]): void {
    const ids = Array.isArray(identifiers) ? identifiers : [identifiers];
    ids.forEach(id => this.allowedIdentifiers.add(id));
    this.emit('updated', { added: ids, removed: [] });
  }

  /**
   * Remove identifier(s) from the allowlist (runtime update)
   */
  remove(identifiers: string | string[]): void {
    const ids = Array.isArray(identifiers) ? identifiers : [identifiers];
    ids.forEach(id => this.allowedIdentifiers.delete(id));
    this.emit('updated', { added: [], removed: ids });
  }

  /**
   * Get all allowlisted identifiers
   */
  getAll(): string[] {
    return Array.from(this.allowedIdentifiers);
  }

  /**
   * Clear all allowlist entries
   */
  clear(): void {
    const removed = this.getAll();
    this.allowedIdentifiers.clear();
    this.emit('updated', { added: [], removed });
  }

  /**
   * Start periodic refresh (useful for Redis-backed allowlists)
   */
  private startAutoRefresh(intervalMs: number): void {
    this.refreshInterval = setInterval(() => {
      // Can be extended to fetch from Redis/database
      this.emit('refresh-needed');
    }, intervalMs);
  }

  /**
   * Stop auto refresh
   */
  stopAutoRefresh(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = undefined;
    }
  }
}

// Redis-backed allowlist for production
export class RedisAllowlistManager extends AllowlistManager {
  constructor(
    private redisClient: any, // ioredis instance
    private redisKey: string = 'ratelimit:allowlist',
    refreshIntervalMs: number = 30000
  ) {
    super({ refreshIntervalMs });
    this.loadFromRedis();
    this.on('refresh-needed', () => this.loadFromRedis());
  }

  private async loadFromRedis(): Promise<void> {
    try {
      const members = await this.redisClient.smembers(this.redisKey);
      this.allowedIdentifiers = new Set(members);
    } catch (error) {
      console.error('Failed to load allowlist from Redis:', error);
    }
  }

  async addToRedis(identifiers: string | string[]): Promise<void> {
    const ids = Array.isArray(identifiers) ? identifiers : [identifiers];
    await this.redisClient.sadd(this.redisKey, ...ids);
    this.add(ids);
  }

  async removeFromRedis(identifiers: string | string[]): Promise<void> {
    const ids = Array.isArray(identifiers) ? identifiers : [identifiers];
    await this.redisClient.srem(this.redisKey, ...ids);
    this.remove(ids);
  }
}
