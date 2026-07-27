import './load-env';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { AppModule } from './app.module';
import * as express from 'express';
import { join } from 'path';
import mongoose from 'mongoose';
import helmet from 'helmet';
import hpp from 'hpp';
import compression from 'compression';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { validateEnvironment } from './config/env.validation';
import { MANAGED_AVATAR_ROUTE } from './common/managed-file-url';

function isAtlasUri(uri: string): boolean {
  const normalized = uri.trim().toLowerCase();
  return (
    normalized.startsWith('mongodb+srv://') ||
    normalized.includes('.mongodb.net')
  );
}

function sanitizeMongoUri(uri: string): string {
  return uri.replace(/:\/\/([^:@/]+):([^@/]+)@/, '://$1:***@');
}

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  const app = await NestFactory.create(AppModule);
  const env = validateEnvironment();

  app.getHttpAdapter().getInstance().set('trust proxy', env.trustProxy);

  mongoose.set('debug', env.mongoDebug);

  const atlasUri = isAtlasUri(env.mongoUri);
  logger.log(`MongoDB URI: ${sanitizeMongoUri(env.mongoUri)}`);
  logger.log(`MongoDB Atlas detected: ${atlasUri ? 'yes' : 'no'}`);
  if (!atlasUri) {
    logger.warn(
      'MongoDB URI does not look like an Atlas URI (mongodb+srv / .mongodb.net)',
    );
  }
  logger.log(
    `Mongoose debug queries: ${env.mongoDebug ? 'enabled' : 'disabled'}`,
  );

  app.use(helmet());
  app.use(hpp());
  app.use(compression());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());

  // CORS
  app.enableCors({
    origin: env.corsOrigins,
    credentials: true,
  });

  // ✅ IMPORTANT: correct static serving for PDFs
  app.use(
    MANAGED_AVATAR_ROUTE,
    express.static(join(process.cwd(), 'uploads', 'avatars')),
  );


  app.enableShutdownHooks();
  app.useWebSocketAdapter(new IoAdapter(app));

  await app.listen(env.port);
  logger.log(`Backend running in ${env.nodeEnv} mode on port ${env.port}`);
  logger.log(`API URL: http://localhost:${env.port}`);
  logger.log(`CORS origins: ${env.corsOrigins.join(', ')}`);
  logger.log(`Health check available at: /health`);

  const shutdownSignals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
  shutdownSignals.forEach((signal) => {
    process.on(signal, () => {
      logger.warn(`Received ${signal}, shutting down gracefully`);
    });
  });
}
void bootstrap();
