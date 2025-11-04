import * as Joi from 'joi';

export const validationSchema = Joi.object({
  // Application
  APP_NAME: Joi.string().default('UNICX Integration'),
  PORT: Joi.number().default(3000),
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  API_PREFIX: Joi.string().default('api/v1'),
  BASE_URL: Joi.string().default('http://localhost:3000'),

  // Azure Service Bus
  AZURE_SERVICE_BUS_CONNECTION_STRING: Joi.string().required(),
  AZURE_SERVICE_BUS_DLQ_TOPIC: Joi.string().default('dlq'),
  AZURE_SERVICE_BUS_DLQ_SUBSCRIPTION: Joi.string().default('dlq-processor'),

  // Redis Cache
  REDIS_HOST: Joi.string().default('localhost'),
  REDIS_PORT: Joi.number().default(6379),
  REDIS_PASSWORD: Joi.string().allow('').default(''),
  REDIS_CONNECTION_STRING: Joi.string().allow('').default(''),
  REDIS_DEFAULT_TTL: Joi.number().default(3600),
  REDIS_DATABASE: Joi.number().default(0),

  // Database
  MONGODB_URI: Joi.string().required(),
  COSMOS_DB_NAME: Joi.string().default('unicx-integration'),
  DATABASE_MAX_POOL_SIZE: Joi.number().default(50),
  DATABASE_MIN_POOL_SIZE: Joi.number().default(10),

  // JWT
  JWT_SECRET: Joi.string().required(),
  JWT_EXPIRES_IN: Joi.string().default('24h'),
  JWT_REFRESH_SECRET: Joi.string().required(),
  JWT_REFRESH_EXPIRES_IN: Joi.string().default('7d'),

  // Email
  EMAIL_PROVIDER: Joi.string().default('smtp'),
  EMAIL_HOST: Joi.string().default('smtp.gmail.com'),
  EMAIL_PORT: Joi.number().default(587),
  EMAIL_SECURE: Joi.boolean().default(false),
  EMAIL_USER: Joi.string().allow('').default(''),
  EMAIL_PASS: Joi.string().allow('').default(''),
  EMAIL_FROM_NAME: Joi.string().default('UNICX'),
  EMAIL_FROM_ADDRESS: Joi.string().default('noreply@unicx.com'),

  // Rate Limiting
  RATE_LIMIT_TTL: Joi.number().default(60),
  RATE_LIMIT_MAX: Joi.number().default(100),
  AUTH_RATE_LIMIT_TTL: Joi.number().default(900),
  AUTH_RATE_LIMIT_MAX: Joi.number().default(5),

  // QR Code
  QR_CODE_EXPIRY_HOURS: Joi.number().default(24),
  QR_CODE_ENCRYPTION_KEY: Joi.string().allow('').default('dev-default-key'),
  QR_CODE_MAX_RETRY_ATTEMPTS: Joi.number().default(3),
  QR_CODE_IMAGE_FORMAT: Joi.string().default('png'),
  QR_CODE_SIZE: Joi.number().default(300),

  // WhatsApp
  WHATSAPP_API_URL: Joi.string().default('https://graph.facebook.com/v18.0'),
  WHATSAPP_ACCESS_TOKEN: Joi.string().allow('').default(''),
  WHATSAPP_PHONE_NUMBER_ID: Joi.string().allow('').default(''),
  WHATSAPP_BUSINESS_ID: Joi.string().allow('').default(''),
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: Joi.string().allow('').default(''),

  // Security
  BCRYPT_ROUNDS: Joi.number().default(12),
  ENCRYPTION_KEY: Joi.string().required(),
  CORS_ORIGIN: Joi.string().default('http://localhost:3000'),
  MAX_FILE_SIZE: Joi.number().default(5242880),
  ALLOWED_FILE_TYPES: Joi.string().default('image/jpeg,image/png,image/gif'),

  // Storage
  STORAGE_PROVIDER: Joi.string().default('azure'),
  AZURE_STORAGE_CONNECTION_STRING: Joi.string().allow('').default(''),
  AZURE_STORAGE_CONTAINER: Joi.string().default('unicx-files'),
  AWS_S3_BUCKET: Joi.string().default('unicx-files'),
  AWS_S3_REGION: Joi.string().default('us-east-1'),
  AWS_ACCESS_KEY_ID: Joi.string().allow('').default(''),
  AWS_SECRET_ACCESS_KEY: Joi.string().allow('').default(''),

  // Monitoring
  LOG_LEVEL: Joi.string().default('info'),
  SENTRY_DSN: Joi.string().allow('').default(''),
  ENABLE_SWAGGER: Joi.boolean().default(true),

  // Cleanup
  QR_CODE_CLEANUP_DAYS: Joi.number().default(7),
  FAILED_INVITATION_CLEANUP_DAYS: Joi.number().default(14),

  // Pagination
  DEFAULT_PAGE_SIZE: Joi.number().default(20),
  MAX_PAGE_SIZE: Joi.number().default(100),

  // Session
  SESSION_TIMEOUT_MINUTES: Joi.number().default(30),
  MAX_CONCURRENT_SESSIONS: Joi.number().default(3),

  // Feature Flags
  ENABLE_EMAIL_VERIFICATION: Joi.boolean().default(false),
  ENABLE_TWO_FACTOR_AUTH: Joi.boolean().default(false),
  ENABLE_WHATSAPP_INTEGRATION: Joi.boolean().default(true),
  ENABLE_EXTERNAL_AUTH_PROVIDERS: Joi.boolean().default(false),
});
