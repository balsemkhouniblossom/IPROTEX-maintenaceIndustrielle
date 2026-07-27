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
import { ApprovalStatus, Role, User, UserDocument } from '../src/schemas/user.schema';

describe('User bulk approve/reject — transactional (e2e)', () => {
  // A replica set is required: bulkApproveUsers/bulkRejectUsers each open
  // a real multi-document Mongo transaction across every selected user.
  let mongo: MongoMemoryReplSet;
  let app: INestApplication<App>;
  let jwtService: JwtService;
  let connection: Connection;
  let users: Model<UserDocument>;

  let adminToken: string;

  beforeAll(async () => {
    mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    process.env.NODE_ENV = 'test';
    process.env.MONGODB_URI = mongo.getUri('gmao_user_bulk_approvals_e2e');
    process.env.JWT_SECRET = 'e2e-test-jwt-secret';
    process.env.JWT_REFRESH_SECRET = 'e2e-test-refresh-secret';
    process.env.EMAIL_VERIFICATION_SECRET = 'e2e-test-email-secret';

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
  }, 120_000);

  afterAll(async () => {
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

  async function pendingOperator(overrides: Record<string, unknown> = {}) {
    return users.create({
      user_id: `OP-${Math.random().toString(36).slice(2)}`,
      nom_complet: 'Pending Operator',
      email: `pending-${Math.random().toString(36).slice(2)}@example.test`,
      password: 'x',
      role: Role.OPERATOR,
      is_active: false,
      is_verified: true,
      profile_completed: true,
      approval_status: ApprovalStatus.PENDING,
      ...overrides,
    });
  }

  beforeAll(async () => {
    const admin = await users.create({
      user_id: 'ADMIN-BULK-E2E',
      nom_complet: 'Bulk Admin',
      email: 'bulk-admin-e2e@example.test',
      password: 'x',
      role: Role.ADMIN,
      is_active: true,
      is_verified: true,
    });
    adminToken = tokenFor(admin);
  });

  it('rejects an unauthenticated bulk-approve request', async () => {
    await request(app.getHttpServer())
      .post('/users/bulk-approve')
      .send({ userIds: [] })
      .expect(401);
  });

  it('approves every selected user atomically', async () => {
    const [a, b] = await Promise.all([pendingOperator(), pendingOperator()]);

    const response = await request(app.getHttpServer())
      .post('/users/bulk-approve')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ userIds: [a._id.toString(), b._id.toString()] })
      .expect(201);

    expect(response.body.code).toBe('BULK_APPROVAL_COMPLETE');
    expect(response.body.succeeded).toHaveLength(2);

    const refreshedA = await users.findById(a._id).exec();
    const refreshedB = await users.findById(b._id).exec();
    expect(refreshedA?.approval_status).toBe(ApprovalStatus.APPROVED);
    expect(refreshedA?.is_active).toBe(true);
    expect(refreshedB?.approval_status).toBe(ApprovalStatus.APPROVED);
  });

  it('rolls back the entire batch when one selected user fails validation (email not verified)', async () => {
    const valid = await pendingOperator();
    const invalid = await pendingOperator({ is_verified: false });

    const response = await request(app.getHttpServer())
      .post('/users/bulk-approve')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ userIds: [valid._id.toString(), invalid._id.toString()] })
      .expect(409);

    expect(response.body.message).toContain(invalid._id.toString());

    // The whole transaction rolled back — even the row that individually
    // would have succeeded must remain untouched.
    const refreshedValid = await users.findById(valid._id).exec();
    expect(refreshedValid?.approval_status).toBe(ApprovalStatus.PENDING);
  });

  it('rejects every selected user atomically with a shared reason', async () => {
    const [a, b] = await Promise.all([pendingOperator(), pendingOperator()]);

    const response = await request(app.getHttpServer())
      .post('/users/bulk-reject')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ userIds: [a._id.toString(), b._id.toString()], reason: 'Duplicate accounts' })
      .expect(201);

    expect(response.body.code).toBe('BULK_REJECTION_COMPLETE');

    const refreshedA = await users.findById(a._id).exec();
    expect(refreshedA?.approval_status).toBe(ApprovalStatus.REJECTED);
    expect(refreshedA?.rejection_reason).toBe('Duplicate accounts');
  });

  it('rejects an empty selection with 400 before opening a transaction', async () => {
    await request(app.getHttpServer())
      .post('/users/bulk-approve')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ userIds: [] })
      .expect(400);
  });

  it('rejects a non-Admin caller', async () => {
    const operator = await pendingOperator();
    const operatorToken = tokenFor(operator);

    await request(app.getHttpServer())
      .post('/users/bulk-approve')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ userIds: [operator._id.toString()] })
      .expect(403);
  });
});
