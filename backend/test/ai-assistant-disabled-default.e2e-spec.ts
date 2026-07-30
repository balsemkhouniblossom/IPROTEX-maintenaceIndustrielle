/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Connection, Model } from 'mongoose';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { JwtService } from '@nestjs/jwt';
import { AppModule } from './../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { User, UserDocument } from '../src/schemas/user.schema';

/**
 * No provider override and no AI/Gemini configuration. This exercises the
 * real module factory as it runs with nothing configured: no network call is
 * attempted, and the caller still gets a clean disabled result.
 */
describe('AI Assistant - disabled by default with no configuration (e2e)', () => {
  let mongo: MongoMemoryReplSet;
  let app: INestApplication<App>;
  let jwtService: JwtService;
  let connection: Connection;
  let users: Model<UserDocument>;
  let adminToken: string;

  beforeAll(async () => {
    mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    process.env.NODE_ENV = 'test';
    process.env.MONGODB_URI = mongo.getUri('gmao_ai_assistant_disabled_e2e');
    process.env.JWT_SECRET = 'e2e-test-jwt-secret';
    process.env.JWT_REFRESH_SECRET = 'e2e-test-refresh-secret';
    process.env.EMAIL_VERIFICATION_SECRET = 'e2e-test-email-secret';
    delete process.env.AI_ASSISTANT_ENABLED;
    delete process.env.AI_ASSISTANT_PROVIDER;
    delete process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_MODEL;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    jwtService = app.get(JwtService);
    connection = app.get(getConnectionToken());
    users = app.get(getModelToken(User.name));

    await connection.dropDatabase();
    const admin = await users.create({
      user_id: 'ADMIN-AI-DISABLED-E2E',
      nom_complet: 'AI Disabled Admin',
      email: 'ai-disabled-admin-e2e@example.test',
      password: 'x',
      role: 'admin',
      is_active: true,
      is_verified: true,
    });
    adminToken = jwtService.sign({
      sub: admin._id.toString(),
      email: admin.email,
      role: admin.role,
      user_id: admin.user_id,
    });
  }, 120_000);

  afterAll(async () => {
    await connection?.dropDatabase();
    await app?.close();
    await mongo?.stop();
  });

  it('returns a disabled status with no answer, never attempting a real provider call', async () => {
    const response = await request(app.getHttpServer())
      .post('/ai-assistant/recommendations')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ question: 'Why does the motor keep tripping?', locale: 'en' })
      .expect(201);

    expect(response.body.status).toBe('disabled');
    expect(response.body.provider).toBe('disabled');
    expect(response.body.answer).toBeUndefined();
  });

  it('reports disabled provider health without exposing any secret', async () => {
    const response = await request(app.getHttpServer())
      .get('/ai-assistant/health')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(response.body).toEqual({
      enabled: false,
      configured: false,
      provider: 'disabled',
      status: 'disabled',
      message: 'AI assistant is intentionally disabled',
    });
    expect(JSON.stringify(response.body)).not.toMatch(/API_KEY|secret|key/i);
  });
});
