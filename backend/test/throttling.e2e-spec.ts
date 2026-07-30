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
import * as bcrypt from 'bcrypt';
import { AppModule } from './../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { User, UserDocument } from '../src/schemas/user.schema';
import { MachineType, MachineTypeDocument } from '../src/schemas/machine-type.schema';
import { Machine, MachineDocument } from '../src/schemas/machine.schema';
import { AI_PROVIDER, AiProvider } from '../src/ai-assistant/ai-provider.interface';

/**
 * Deterministic stand-in for the real Gemini provider, matching the
 * convention already used in `ai-assistant.e2e-spec.ts` — only needed here
 * to exercise scenario 5 (AI assistant's own hourly cap keeps returning a
 * normal 200/`rate_limited` response, never a 429 from the new global guard).
 */
class FakeAiProvider implements AiProvider {
  readonly name = 'fake';

  async generate() {
    return {
      answer: {
        knownFacts: [],
        probableCauses: [],
        recommendedChecks: [],
        safetyWarnings: [],
        uncertainty: 'n/a',
      },
      model: 'fake-model',
    };
  }
}

/**
 * This suite is deliberately its own compiled `AppModule` instance (not
 * appended to another e2e file) because it needs small, test-only throttle
 * limits injected via env vars *before* `AppModule` compiles — `skipIf` in
 * `app.module.ts` disables all throttling in `NODE_ENV=test` unless
 * `THROTTLE_ENABLED=true` is explicitly set, precisely so every other e2e
 * suite in this repo (which never sets that var) is completely unaffected
 * by this new global guard.
 *
 * `@nestjs/throttler`'s in-memory storage has no reset hook (confirmed by
 * reading its source — only a raw `Map` getter). Isolation is achieved
 * instead the same way `predictive-maintenance.e2e-spec.ts` and
 * `ai-assistant.e2e-spec.ts` already do it: every scenario gets its own
 * dedicated identity (JWT user or device credential) so no two cases can
 * ever collide on the same underlying storage key, without needing to
 * touch the storage directly.
 */
describe('Global throttling (e2e)', () => {
  let mongo: MongoMemoryReplSet;
  let app: INestApplication<App>;
  let jwtService: JwtService;
  let connection: Connection;
  let users: Model<UserDocument>;
  let machineTypes: Model<MachineTypeDocument>;
  let machines: Model<MachineDocument>;

  let adminToken: string;
  let machineAId: string;

  beforeAll(async () => {
    mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    process.env.NODE_ENV = 'test';
    process.env.MONGODB_URI = mongo.getUri('gmao_throttling_e2e');
    process.env.JWT_SECRET = 'e2e-test-jwt-secret';
    process.env.JWT_REFRESH_SECRET = 'e2e-test-refresh-secret';
    process.env.EMAIL_VERIFICATION_SECRET = 'e2e-test-email-secret';

    // Small, test-only limits — see the file-level doc comment for why this
    // suite (and only this suite) needs THROTTLE_ENABLED=true.
    process.env.THROTTLE_ENABLED = 'true';
    process.env.THROTTLE_DEFAULT_LIMIT = '10';
    process.env.THROTTLE_DEFAULT_TTL_MS = '60000';
    process.env.THROTTLE_DEVICE_LIMIT = '8';
    process.env.THROTTLE_DEVICE_TTL_MS = '60000';
    process.env.AI_ASSISTANT_RATE_LIMIT_PER_HOUR = '2';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(AI_PROVIDER)
      .useValue(new FakeAiProvider())
      .compile();

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
    machineTypes = app.get(getModelToken(MachineType.name));
    machines = app.get(getModelToken(Machine.name));

    await seedBaseData();
  }, 120_000);

  afterAll(async () => {
    delete process.env.THROTTLE_ENABLED;
    delete process.env.THROTTLE_DEFAULT_LIMIT;
    delete process.env.THROTTLE_DEFAULT_TTL_MS;
    delete process.env.THROTTLE_DEVICE_LIMIT;
    delete process.env.THROTTLE_DEVICE_TTL_MS;
    delete process.env.AI_ASSISTANT_RATE_LIMIT_PER_HOUR;

    await connection?.dropDatabase();
    await app?.close();
    await mongo?.stop();
  });

  function tokenFor(user: UserDocument): string {
    return jwtService.sign({
      sub: user._id.toString(),
      email: user.email,
      role: user.role,
      user_id: user.user_id,
    });
  }

  async function createAdmin(userId: string): Promise<string> {
    const admin = await users.create({
      user_id: userId,
      nom_complet: `Throttle Test ${userId}`,
      email: `${userId.toLowerCase()}@example.test`,
      password: 'x',
      role: 'admin',
      is_active: true,
      is_verified: true,
    });
    return tokenFor(admin);
  }

  async function seedBaseData() {
    await connection.dropDatabase();

    const machineType = await machineTypes.create({
      type_id: 1,
      name: 'Throttling E2E machine type',
    });
    const machineA = await machines.create({
      machine_id: 'MACHINE-THROTTLE-A',
      type_id: machineType._id,
      serial_no: 'THROTTLE-A',
      status: 'active',
    });
    machineAId = machineA._id.toString();

    adminToken = await createAdmin('ADMIN-THROTTLE-BASE');
  }

  it('never throttles /health, even far beyond the global default limit', async () => {
    for (let i = 0; i < 20; i += 1) {
      await request(app.getHttpServer()).get('/health').expect(200);
    }
  }, 30_000);

  it('429s a plain CRUD route once the global default limit is exceeded, with a retryable/coded response', async () => {
    const token = await createAdmin('ADMIN-THROTTLE-DEFAULT');

    let lastResponse: request.Response | undefined;
    for (let i = 0; i < 11; i += 1) {
      lastResponse = await request(app.getHttpServer())
        .get('/machines')
        .set('Authorization', `Bearer ${token}`);
    }

    expect(lastResponse!.status).toBe(429);
    expect(lastResponse!.body).toEqual(
      expect.objectContaining({ code: 'RATE_LIMIT_EXCEEDED' }),
    );
    expect(lastResponse!.headers['retry-after']).toBeDefined();
  }, 30_000);

  it('a per-route @Throttle override tolerates more traffic than the global default before enforcing its own, higher limit', async () => {
    const token = await createAdmin('ADMIN-THROTTLE-OVERRIDE');
    // documents/:id/file carries its own override (limit 20/60s) — well
    // above the global default of 10 used elsewhere in this suite. The
    // document id does not need to exist: the throttling guard runs before
    // the route handler, so a 404 from a nonexistent id still proves the
    // request was NOT rate-limited.
    const nonexistentDocumentId = '000000000000000000000000';

    const statuses: number[] = [];
    for (let i = 0; i < 21; i += 1) {
      const response = await request(app.getHttpServer())
        .get(`/documents/${nonexistentDocumentId}/file`)
        .set('Authorization', `Bearer ${token}`);
      statuses.push(response.status);
    }

    expect(statuses.slice(0, 20).every((status) => status !== 429)).toBe(true);
    expect(statuses[20]).toBe(429);
  }, 30_000);

  it('lets AuthThrottleService keep blocking repeated bad login attempts, independent of the new global guard', async () => {
    const email = 'throttle-login-e2e@example.test';
    await users.create({
      user_id: 'THROTTLE-LOGIN-E2E',
      nom_complet: 'Throttle Login E2E',
      email,
      password: await bcrypt.hash('correct-password-never-sent', 10),
      role: 'admin',
      is_active: true,
      is_verified: true,
    });

    let lastResponse: request.Response | undefined;
    // The account-scoped login lockout trips after 5 failed attempts (see
    // AUTH_THROTTLE_RULES in auth-throttle.service.ts); THROTTLE_DEFAULT_LIMIT
    // is set to 10 for this suite specifically so the new global tier never
    // fires first on this same route and masks the assertion below.
    for (let i = 0; i < 6; i += 1) {
      lastResponse = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password: 'definitely-wrong' });
    }

    expect(lastResponse!.status).toBe(429);
    expect(lastResponse!.body).toEqual(
      expect.objectContaining({ code: 'AUTH_TOO_MANY_ATTEMPTS' }),
    );
  }, 30_000);

  it('keeps the AI assistant hourly cap returning 200/rate_limited, never a 429 from the global guard', async () => {
    const token = await createAdmin('ADMIN-THROTTLE-AI');

    const statuses: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const response = await request(app.getHttpServer())
        .post('/ai-assistant/recommendations')
        .set('Authorization', `Bearer ${token}`)
        .send({ question: `Throttle probe ${i}`, locale: 'en' })
        .expect(201);
      statuses.push(response.body.status);
    }

    expect(statuses).toContain('rate_limited');
  }, 30_000);

  it('device-gateway traffic tolerates a burst beyond the global default limit, then enforces its own device-tier limit', async () => {
    const registerResponse = await request(app.getHttpServer())
      .post('/devices')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ device_id: 'THROTTLE-DEVICE-1', machine_id: machineAId, device_type: 'simulator' })
      .expect(201);
    const apiKey = registerResponse.body.apiKey as string;

    const statuses: number[] = [];
    for (let i = 0; i < 9; i += 1) {
      const response = await request(app.getHttpServer())
        .post('/device-gateway/heartbeat')
        .set('x-device-id', 'THROTTLE-DEVICE-1')
        .set('x-device-key', apiKey);
      statuses.push(response.status);
    }

    // Device-gateway routes never consult the global 'default' tier at all
    // (@SkipThrottle + DeviceThrottlerGuard's tier filtering) — only the
    // 'device' tier, capped at 8 for this suite, governs them.
    expect(statuses.slice(0, 8).every((status) => status === 201)).toBe(true);
    expect(statuses[8]).toBe(429);
  }, 30_000);
});
