import * as Joi from 'joi';

export const validationSchema = Joi.object({
  // Azure Service Bus
  AZURE_SERVICE_BUS_CONNECTION_STRING: Joi.string().required(),
  AZURE_SERVICE_BUS_DLQ_TOPIC: Joi.string().default('dlq'),
  AZURE_SERVICE_BUS_DLQ_SUBSCRIPTION: Joi.string().default('dlq-processor'),
  PORT: Joi.number().default(3000),
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  API_PREFIX: Joi.string().default('api/v1'),

  // Database
  MONGODB_URI: Joi.string().required(),
  COSMOS_DB_NAME: Joi.string().default('unicx-integration'),

  // JWT
  JWT_SECRET: Joi.string().required(),
  JWT_EXPIRES_IN: Joi.string().default('24h'),
  JWT_REFRESH_SECRET: Joi.string().required(),
  JWT_REFRESH_EXPIRES_IN: Joi.string().default('7d'),

  // Email
  EMAIL_HOST: Joi.string().default('smtp.gmail.com'),
  EMAIL_PORT: Joi.number().default(587),
  EMAIL_USER: Joi.string().required(),
  EMAIL_PASS: Joi.string().required(),
  EMAIL_FROM: Joi.string().email().default('noreply@unicx.com'),

  // Storage
  STORAGE_PROVIDER: Joi.string().valid('aws', 'azure').default('azure'),
  AWS_S3_BUCKET: Joi.string().when('STORAGE_PROVIDER', { is: 'aws', then: Joi.required() }),
  AWS_S3_REGION: Joi.string().default('us-east-1'),
  AWS_ACCESS_KEY_ID: Joi.string().when('STORAGE_PROVIDER', { is: 'aws', then: Joi.required() }),
  AWS_SECRET_ACCESS_KEY: Joi.string().when('STORAGE_PROVIDER', { is: 'aws', then: Joi.required() }),
  AZURE_STORAGE_CONNECTION_STRING: Joi.string().when('STORAGE_PROVIDER', { is: 'azure', then: Joi.required() }),
  AZURE_STORAGE_CONTAINER: Joi.string().default('unicx-files'),

  // Rate Limiting
  RATE_LIMIT_TTL: Joi.number().default(60),
  RATE_LIMIT_LIMIT: Joi.number().default(100),

  // Security
  BCRYPT_ROUNDS: Joi.number().default(12),
  CORS_ORIGIN: Joi.string().uri().default('http://localhost:3000'),
});
