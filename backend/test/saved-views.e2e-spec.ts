/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Connection, Model } from 'mongoose';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { JwtService } from '@nestjs/jwt';
import { AppModule } from './../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { User, UserDocument } from '../src/schemas/user.schema';
import { SavedView, SavedViewDocument } from '../src/schemas/saved-view.schema';

describe('Saved views (e2e)', () => {
  // No transactions are involved anywhere in this feature, so a plain
  // standalone MongoMemoryServer is sufficient (no replica set needed).
  let mongo: MongoMemoryServer;
  let app: INestApplication<App>;
  let jwtService: JwtService;
  let connection: Connection;
  let users: Model<UserDocument>;

  let adminToken: string;
  let otherAdminToken: string;

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    process.env.NODE_ENV = 'test';
    process.env.MONGODB_URI = mongo.getUri('gmao_saved_views_e2e');
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

    await seedBaseData();

    // The (user_id, page_key, name) uniqueness test below depends on the
    // compound unique index actually existing before it inserts — Mongoose
    // builds indexes asynchronously in the background by default, and
    // `seedBaseData`'s `dropDatabase()` would wipe out an index built
    // beforehand, so this wait must come after seeding, not before it.
    const savedViews: Model<SavedViewDocument> = app.get(getModelToken(SavedView.name));
    await savedViews.init();
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

  async function seedBaseData() {
    await connection.dropDatabase();

    const admin = await users.create({
      user_id: 'ADMIN-SV-E2E',
      nom_complet: 'Saved Views Admin',
      email: 'saved-views-admin-e2e@example.test',
      password: 'x',
      role: 'admin',
      is_active: true,
      is_verified: true,
    });
    const otherAdmin = await users.create({
      user_id: 'ADMIN2-SV-E2E',
      nom_complet: 'Other Saved Views Admin',
      email: 'saved-views-admin2-e2e@example.test',
      password: 'x',
      role: 'admin',
      is_active: true,
      is_verified: true,
    });

    adminToken = tokenFor(admin);
    otherAdminToken = tokenFor(otherAdmin);
  }

  it('rejects an unauthenticated request', async () => {
    await request(app.getHttpServer()).get('/saved-views?pageKey=work-orders').expect(401);
  });

  let viewId: string;

  it('creates a saved view scoped to the caller and the given page', async () => {
    const response = await request(app.getHttpServer())
      .post('/saved-views')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        pageKey: 'work-orders',
        name: 'My open, high priority',
        query: { status: 'open', priority: 'high' },
      })
      .expect(201);

    expect(response.body.view_id).toMatch(/^VIEW-/);
    expect(response.body.page_key).toBe('work-orders');
    viewId = response.body._id;
  });

  it('rejects a second view with a duplicate name on the same page for the same user', async () => {
    await request(app.getHttpServer())
      .post('/saved-views')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ pageKey: 'work-orders', name: 'My open, high priority', query: {} })
      .expect(500); // Mongo unique-index violation surfaces as a 500 under this app's generic error handling
  });

  it('lists only the calling user\'s views for the requested page', async () => {
    await request(app.getHttpServer())
      .post('/saved-views')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ pageKey: 'users', name: 'Pending approvals', query: { approvalStatus: 'pending' } })
      .expect(201);

    const workOrdersViews = await request(app.getHttpServer())
      .get('/saved-views?pageKey=work-orders')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(workOrdersViews.body).toHaveLength(1);
    expect(workOrdersViews.body[0].page_key).toBe('work-orders');

    const otherAdminViews = await request(app.getHttpServer())
      .get('/saved-views?pageKey=work-orders')
      .set('Authorization', `Bearer ${otherAdminToken}`)
      .expect(200);
    expect(otherAdminViews.body).toEqual([]);
  });

  it('forbids a different user from updating or deleting someone else\'s saved view', async () => {
    await request(app.getHttpServer())
      .patch(`/saved-views/${viewId}`)
      .set('Authorization', `Bearer ${otherAdminToken}`)
      .send({ name: 'Hijacked' })
      .expect(403);

    await request(app.getHttpServer())
      .delete(`/saved-views/${viewId}`)
      .set('Authorization', `Bearer ${otherAdminToken}`)
      .expect(403);
  });

  it('lets the owner update their saved view\'s query and default flag', async () => {
    const response = await request(app.getHttpServer())
      .patch(`/saved-views/${viewId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ query: { status: 'closed' }, isDefault: true })
      .expect(200);

    expect(response.body.query).toEqual({ status: 'closed' });
    expect(response.body.is_default).toBe(true);
  });

  it('lets the owner delete their saved view', async () => {
    await request(app.getHttpServer())
      .delete(`/saved-views/${viewId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const remaining = await request(app.getHttpServer())
      .get('/saved-views?pageKey=work-orders')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(remaining.body).toEqual([]);
  });
});
