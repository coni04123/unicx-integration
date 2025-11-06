import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';

// Configuration
import { configuration } from './config/configuration';
import { validationSchema } from './config/validation';

// Modules
import { AuthModule } from './modules/auth/auth.module';
import { EntitiesModule } from './modules/entities/entities.module';
import { EntityTypesModule } from './modules/entity-types/entity-types.module';
import { UsersModule } from './modules/users/users.module';
import { EmailModule } from './modules/email/email.module';
import { WhatsAppModule } from './modules/whatsapp/whatsapp.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { StorageModule } from './modules/storage/storage.module';
import { AuditModule } from './modules/audit/audit.module';

// Common
import { DatabaseModule } from './common/database/database.module';
import { SecurityModule } from './common/security/security.module';
import { HealthModule } from './common/health/health.module';
import { CacheModule } from './common/cache/cache.module';
import { MessagingModule } from './common/messaging/messaging.module';

@Module({
  imports: [
    // Configuration
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validationSchema,
    }),

    // Database
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => {
        const mongoUri = configService.get<string>('database.mongodbUri');
        console.log('Connecting to MongoDB at:', mongoUri); // ✅ log here
        return {
          uri: configService.get<string>('database.mongodbUri'),
          useNewUrlParser: true,
          useUnifiedTopology: true,
        }
      },
      inject: [ConfigService],
    }),

    // Rate limiting
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ([{
        ttl: configService.get<number>('rateLimit.default.ttl') || 60000,
        limit: configService.get<number>('rateLimit.default.limit') || 100,
      }]),
      inject: [ConfigService],
    }),


    // Scheduling
    ScheduleModule.forRoot(),

    // JWT
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('jwt.secret'),
        signOptions: {
          expiresIn: configService.get<string>('jwt.expiresIn'),
        },
      }),
      inject: [ConfigService],
    }),

    // Passport
    PassportModule.register({ defaultStrategy: 'jwt' }),

    // Common modules
    DatabaseModule,
    SecurityModule,
    HealthModule,
    CacheModule,
    MessagingModule,

    // Feature modules
    AuthModule,
    EntitiesModule,
    EntityTypesModule,
    UsersModule,
    EmailModule,
    WhatsAppModule,
    DashboardModule,
    StorageModule,
    AuditModule,
  ],
})
export class AppModule {}
