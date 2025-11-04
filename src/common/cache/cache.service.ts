import { Injectable, Logger, Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';

export enum CacheKey {
  // Session & Auth
  JWT_WHITELIST = 'jwt:whitelist:',
  JWT_BLACKLIST = 'jwt:blacklist:',
  USER_SESSION = 'user:session:',
  REFRESH_TOKEN = 'refresh:token:',
  
  // WhatsApp
  WHATSAPP_QR = 'whatsapp:qr:',
  WHATSAPP_SESSION_STATUS = 'whatsapp:status:',
  
  // Messages
  RECENT_MESSAGES = 'messages:recent:',
  MESSAGE_STATS = 'messages:stats:',
  CONVERSATION_LIST = 'conversations:list:',
  
  // Dashboard
  DASHBOARD_STATS = 'dashboard:stats:',
  ENTITY_STATS = 'entity:stats:',
  USER_STATS = 'user:stats:',
}

@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);

  constructor(
    @Inject(CACHE_MANAGER)
    private cacheManager: Cache,
  ) {}

  /**
   * Get cached value
   */
  async get<T>(key: string): Promise<T | undefined> {
    try {
      const value = await this.cacheManager.get<T>(key);
      if (value) {
        this.logger.debug(`Cache hit: ${key}`);
      } else {
        this.logger.debug(`Cache miss: ${key}`);
      }
      return value;
    } catch (error) {
      this.logger.error(`Failed to get cache key ${key}: ${error.message}`);
      return undefined;
    }
  }

  /**
   * Set cached value with TTL
   */
  async set<T>(key: string, value: T, ttl?: number): Promise<void> {
    try {
      await this.cacheManager.set(key, value, ttl);
      this.logger.debug(`Cache set: ${key} (TTL: ${ttl || 'default'})`);
    } catch (error) {
      this.logger.error(`Failed to set cache key ${key}: ${error.message}`);
    }
  }

  /**
   * Delete cached value
   */
  async del(key: string): Promise<void> {
    try {
      await this.cacheManager.del(key);
      this.logger.debug(`Cache deleted: ${key}`);
    } catch (error) {
      this.logger.error(`Failed to delete cache key ${key}: ${error.message}`);
    }
  }

  /**
   * Delete multiple keys by pattern
   */
  async delByPattern(pattern: string): Promise<void> {
    try {
      // Note: This requires Redis store with pattern support
      const stores = this.cacheManager.stores as any[];
      if (stores && stores.length > 0) {
        const store = stores[0];
        if (store.keys) {
          const keys = await store.keys(pattern);
          await Promise.all(keys.map(key => this.cacheManager.del(key)));
          this.logger.debug(`Cache deleted by pattern: ${pattern} (${keys.length} keys)`);
        }
      }
    } catch (error) {
      this.logger.error(`Failed to delete cache pattern ${pattern}: ${error.message}`);
    }
  }

  /**
   * Reset all cache
   */
  async reset(): Promise<void> {
    try {
      const stores = this.cacheManager.stores as any[];
      if (stores && stores.length > 0) {
        const store = stores[0];
        if (store.clear) {
          await store.clear();
        }
      }
      this.logger.log('Cache reset');
    } catch (error) {
      this.logger.error(`Failed to reset cache: ${error.message}`);
    }
  }

  /**
   * Cache user session
   */
  async cacheUserSession(userId: string, sessionData: any, ttl: number = 3600): Promise<void> {
    await this.set(`${CacheKey.USER_SESSION}${userId}`, sessionData, ttl);
  }

  /**
   * Get user session from cache
   */
  async getUserSession(userId: string): Promise<any> {
    return this.get(`${CacheKey.USER_SESSION}${userId}`);
  }

  /**
   * Invalidate user session
   */
  async invalidateUserSession(userId: string): Promise<void> {
    await this.del(`${CacheKey.USER_SESSION}${userId}`);
  }

  /**
   * Cache JWT token in whitelist
   */
  async whitelistToken(tokenId: string, ttl: number): Promise<void> {
    await this.set(`${CacheKey.JWT_WHITELIST}${tokenId}`, true, ttl);
  }

  /**
   * Check if token is whitelisted
   */
  async isTokenWhitelisted(tokenId: string): Promise<boolean> {
    const result = await this.get(`${CacheKey.JWT_WHITELIST}${tokenId}`);
    return !!result;
  }

  /**
   * Blacklist JWT token (for logout)
   */
  async blacklistToken(tokenId: string, ttl: number): Promise<void> {
    await this.set(`${CacheKey.JWT_BLACKLIST}${tokenId}`, true, ttl);
  }

  /**
   * Check if token is blacklisted
   */
  async isTokenBlacklisted(tokenId: string): Promise<boolean> {
    const result = await this.get(`${CacheKey.JWT_BLACKLIST}${tokenId}`);
    return !!result;
  }

  /**
   * Cache WhatsApp QR code
   */
  async cacheQRCode(sessionId: string, qrData: any, ttl: number = 120): Promise<void> {
    await this.set(`${CacheKey.WHATSAPP_QR}${sessionId}`, qrData, ttl);
  }

  /**
   * Get cached QR code
   */
  async getQRCode(sessionId: string): Promise<any> {
    return this.get(`${CacheKey.WHATSAPP_QR}${sessionId}`);
  }

  /**
   * Cache dashboard stats
   */
  async cacheDashboardStats(entityId: string, stats: any, ttl: number = 300): Promise<void> {
    await this.set(`${CacheKey.DASHBOARD_STATS}${entityId}`, stats, ttl);
  }

  /**
   * Get cached dashboard stats
   */
  async getDashboardStats(entityId: string): Promise<any> {
    return this.get(`${CacheKey.DASHBOARD_STATS}${entityId}`);
  }

  /**
   * Cache conversation list
   */
  async cacheConversations(tenantId: string, conversations: any[], ttl: number = 60): Promise<void> {
    await this.set(`${CacheKey.CONVERSATION_LIST}${tenantId}`, conversations, ttl);
  }

  /**
   * Get cached conversations
   */
  async getConversations(tenantId: string): Promise<any[]> {
    return this.get(`${CacheKey.CONVERSATION_LIST}${tenantId}`);
  }

  /**
   * Invalidate conversation cache
   */
  async invalidateConversations(tenantId: string): Promise<void> {
    await this.del(`${CacheKey.CONVERSATION_LIST}${tenantId}`);
  }
}

