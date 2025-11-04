import { Module, Global, Logger } from '@nestjs/common';
import { CacheModule as NestCacheModule, CacheModuleOptions } from '@nestjs/cache-manager';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { redisStore } from 'cache-manager-redis-yet';
import { CacheService } from './cache.service';

@Global()
@Module({
  imports: [
    NestCacheModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService): Promise<CacheModuleOptions> => {
        const logger = new Logger('CacheModule');
        const redisConfig = configService.get('redis');
        
        const storeConfig: any = {
          ttl: redisConfig.ttl,
        };

        // Parse Azure connection string if provided
        if (redisConfig.connectionString) {
          try {
            // Azure format: host:port,password=xxx,ssl=True,abortConnect=False
            // Convert to Redis URL: rediss://:password@host:port (rediss for SSL)
            const parts = redisConfig.connectionString.split(',');
            const hostPort = parts[0].trim(); // unicx-dev.redis.cache.windows.net:6380
            const passwordPart = parts.find(p => p.includes('password='));
            const sslPart = parts.find(p => p.includes('ssl='));
            
            const password = passwordPart?.replace('password=', '').trim() || '';
            const useSSL = sslPart?.toLowerCase().includes('true') ?? true;
            const protocol = useSSL ? 'rediss' : 'redis';
            
            // Format: rediss://:password@host:port
            const redisUrl = `${protocol}://:${encodeURIComponent(password)}@${hostPort}`;
            
            storeConfig.url = redisUrl;
            
            // Add socket timeout and connection timeout to prevent indefinite hanging
            storeConfig.socket = {
              connectTimeout: 5000, // 5 seconds
              reconnectStrategy: (retries: number) => {
                if (retries > 5) {
                  logger.warn('Redis connection failed after 5 retries. Continuing without cache.');
                  return new Error('Max retries reached');
                }
                return Math.min(retries * 100, 3000); // Exponential backoff up to 3 seconds
              },
            };
            
            logger.log(`Redis configured with Azure connection string on ${hostPort} (${protocol})`);
          } catch (error) {
            logger.error(`Failed to parse Azure connection string: ${error.message}. Using in-memory cache.`);
            // Fall back to in-memory cache
            return {
              isGlobal: true,
              max: 100,
              ttl: redisConfig.ttl,
            } as CacheModuleOptions;
          }
        } else {
          // Use individual host/port/password for local Redis
          storeConfig.socket = {
            host: redisConfig.host,
            port: redisConfig.port,
            connectTimeout: 5000,
            reconnectStrategy: (retries: number) => {
              if (retries > 3) {
                logger.warn('Local Redis connection failed. Using in-memory cache.');
                return new Error('Max retries reached');
              }
              return Math.min(retries * 100, 3000);
            },
          };
          if (redisConfig.password) {
            storeConfig.password = redisConfig.password;
          }
          logger.log(`Redis configured with local connection: ${redisConfig.host}:${redisConfig.port}`);
        }

        try {
          const store = await redisStore(storeConfig);
          logger.log('✅ Redis cache store initialized successfully');
          return {
            store,
            isGlobal: true,
            ttl: redisConfig.ttl,
          } as CacheModuleOptions;
        } catch (error) {
          logger.error(`❌ Redis connection failed: ${error.message}`);
          logger.warn('Falling back to in-memory cache. Note: Cache will not persist across restarts.');
          
          // Return in-memory cache as fallback
          return {
            isGlobal: true,
            max: 100,
            ttl: redisConfig.ttl,
          } as CacheModuleOptions;
        }
      },
      inject: [ConfigService],
    }),
  ],
  providers: [CacheService],
  exports: [CacheService, NestCacheModule],
})
export class CacheModule {}

