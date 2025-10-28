import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
const compression = require('compression');
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);

  // Security middleware
  app.use(helmet());
  app.use(compression());

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // CORS configuration
  const corsOrigins = configService.get<string[]>('security.corsOrigin', ['http://localhost:3000', 'https://unicx-frontend-pi.vercel.app']);
  app.enableCors({
    origin: '*',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Tenant-ID'],
  });

  // Global prefix
  app.setGlobalPrefix(configService.get<string>('app.apiPrefix', 'api/v1'));

  // Swagger documentation
  const config = new DocumentBuilder()
    .setTitle('UNICX Integration API')
    .setDescription('Backend API for UNICX Integration Platform')
    .setVersion('1.0')
    .addBearerAuth()
    .addTag('Authentication', 'User authentication and authorization')
    .addTag('Entities', 'Entity management with hierarchical structure')
    .addTag('Users', 'User management and registration workflow')
    .addTag('QR Codes', 'QR code generation and invitation system')
    .addTag('Onboarding', 'Onboarding progress tracking')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = configService.get<number>('app.port', 3000);
  const appName = configService.get<string>('app.name', 'UNICX Integration');
  
  await app.listen(port);
  
  console.log(`🚀 ${appName} is running on: http://localhost:${port}`);
  console.log(`📚 API Documentation: http://localhost:${port}/api/docs`);
  console.log(`🏥 Health Check: http://localhost:${port}/health`);
  console.log(`🔐 Environment: ${configService.get<string>('app.nodeEnv')}`);
}

bootstrap();
