import './load-env';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory, Reflector } from '@nestjs/core';
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
import { buildCorsOriginDelegate } from './config/cors-origin-policy';
import { buildHelmetOptions } from './config/security-headers.config';
import { SecureSocketIoAdapter } from './config/secure-socket-io.adapter';
import { TimeoutInterceptor } from './common/interceptors/timeout.interceptor';

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

  // Nest's default body parser applies body-parser's own default limit
  // (100kb) implicitly. Disabling it and registering json/urlencoded
  // parsing ourselves makes that limit an explicit, intentional choice
  // instead of an inherited default — matching the multer fix's spirit
  // for the JSON side of the same "how much can an unauthenticated
  // request make us buffer" question. Multipart uploads are unaffected:
  // Multer parses those itself, independent of this.
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));
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

  app.use(helmet(buildHelmetOptions()));
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
  app.useGlobalInterceptors(
    new TimeoutInterceptor(app.get(Reflector), env.requestTimeoutMs),
  );

  // CORS
  app.enableCors({
    origin: buildCorsOriginDelegate(env.corsOrigins, {
      allowOriginless: true,
    }),
    credentials: true,
  });

  // ✅ IMPORTANT: correct static serving for PDFs
  app.use(
    MANAGED_AVATAR_ROUTE,
    express.static(join(process.cwd(), 'uploads', 'avatars')),
  );

  app.enableShutdownHooks();
  app.useWebSocketAdapter(
    new SecureSocketIoAdapter(app, {
      allowedOrigins: env.corsOrigins,
      nodeEnv: env.nodeEnv,
    }),
  );

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
