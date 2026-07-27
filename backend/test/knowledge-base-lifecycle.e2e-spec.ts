/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Connection, Model, Types } from 'mongoose';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { JwtService } from '@nestjs/jwt';
import { AppModule } from './../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { User, UserDocument } from '../src/schemas/user.schema';
import {
  MachineType,
  MachineTypeDocument,
} from '../src/schemas/machine-type.schema';
import { Machine, MachineDocument } from '../src/schemas/machine.schema';
import { Module, ModuleDocument } from '../src/schemas/module.schema';
import {
  MaintenancePlan,
  MaintenancePlanDocument,
} from '../src/schemas/maintenance-plan.schema';

describe('Knowledge Base — lifecycle, version history, scoping, suggestions (e2e)', () => {
  let mongo: MongoMemoryReplSet;
  let app: INestApplication<App>;
  let jwtService: JwtService;
  let connection: Connection;
  let users: Model<UserDocument>;
  let machineTypes: Model<MachineTypeDocument>;
  let machines: Model<MachineDocument>;
  let modules: Model<ModuleDocument>;
  let maintenancePlans: Model<MaintenancePlanDocument>;

  let adminToken: string;
  let technicianToken: string;
  let operatorToken: string;
  let machineTypeId: string;
  let machineId: string;
  let planId: string;

  beforeAll(async () => {
    mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    process.env.NODE_ENV = 'test';
    process.env.MONGODB_URI = mongo.getUri('gmao_knowledge_base_e2e');
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
    machineTypes = app.get(getModelToken(MachineType.name));
    machines = app.get(getModelToken(Machine.name));
    modules = app.get(getModelToken(Module.name));
    maintenancePlans = app.get(getModelToken(MaintenancePlan.name));

    await seedBaseData();
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

    const machineType = await machineTypes.create({
      type_id: 1,
      name: 'KB E2E machine type',
    });
    machineTypeId = machineType._id.toString();

    const machine = await machines.create({
      machine_id: 'MACHINE-KB',
      type_id: machineType._id,
      serial_no: 'KB-001',
      status: 'active',
    });
    machineId = machine._id.toString();

    const mod = await modules.create({
      module_id: 'MODULE-KB',
      machine_id: machine._id,
      mod_type_id: new Types.ObjectId(),
    });

    const plan = await maintenancePlans.create({
      plan_id: 'PLAN-KB',
      module_id: mod._id,
      type_maintenance: 'preventive',
      frequence: 30,
      unite_frequence: 'days',
      status: 'active',
      version: 1,
    });
    planId = plan._id.toString();

    const admin = await users.create({
      user_id: 'ADMIN-KB-E2E',
      nom_complet: 'KB Admin',
      email: 'kb-admin-e2e@example.test',
      password: 'x',
      role: 'admin',
      is_active: true,
      is_verified: true,
    });
    const technician = await users.create({
      user_id: 'TECH-KB-E2E',
      nom_complet: 'KB Technician',
      email: 'kb-technician-e2e@example.test',
      password: 'x',
      role: 'technician',
      is_active: true,
      is_verified: true,
    });
    const operator = await users.create({
      user_id: 'OP-KB-E2E',
      nom_complet: 'KB Operator',
      email: 'kb-operator-e2e@example.test',
      password: 'x',
      role: 'operator',
      is_active: true,
      is_verified: true,
      assigned_machine_ids: [machine._id],
    });

    adminToken = tokenFor(admin);
    technicianToken = tokenFor(technician);
    operatorToken = tokenFor(operator);
  }

  describe('role permissions', () => {
    it('rejects an unauthenticated request', async () => {
      await request(app.getHttpServer())
        .get('/knowledge-base/articles')
        .expect(401);
    });

    it('rejects Technician and Operator from authoring endpoints', async () => {
      await request(app.getHttpServer())
        .post('/knowledge-base/articles')
        .set('Authorization', `Bearer ${technicianToken}`)
        .send({
          article_id: 'KB-FORBIDDEN',
          title: 'x',
          category: 'troubleshooting',
          content: 'y',
        })
        .expect(403);
      await request(app.getHttpServer())
        .post('/knowledge-base/articles')
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({
          article_id: 'KB-FORBIDDEN',
          title: 'x',
          category: 'troubleshooting',
          content: 'y',
        })
        .expect(403);
    });

    it('allows Admin, Technician, and Operator to read the published catalog', async () => {
      await request(app.getHttpServer())
        .get('/knowledge-base/articles')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      await request(app.getHttpServer())
        .get('/knowledge-base/articles')
        .set('Authorization', `Bearer ${technicianToken}`)
        .expect(200);
      await request(app.getHttpServer())
        .get('/knowledge-base/articles')
        .set('Authorization', `Bearer ${operatorToken}`)
        .expect(200);
    });
  });

  describe('full lifecycle: create -> publish -> revise -> publish supersedes predecessor', () => {
    let articleId: string;
    let articleVersion: number;

    it('creates a Draft article linked to machine, machine type, fault code, and plan', async () => {
      const response = await request(app.getHttpServer())
        .post('/knowledge-base/articles')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          article_id: 'KB-LIFECYCLE-1',
          title: 'Bearing overheating troubleshooting',
          category: 'troubleshooting',
          summary: 'Steps to diagnose overheating bearings',
          content: 'Check lubrication levels, then inspect alignment.',
          tags: ['bearing', 'overheating'],
          machine_id: machineId,
          machine_type_id: machineTypeId,
          maintenance_plan_id: planId,
          fault_codes: ['FAULT-KB-1'],
          error_codes: ['ERR-42'],
        })
        .expect(201);

      expect(response.body.status).toBe('draft');
      expect(response.body.version).toBe(1);
      expect(response.body.revision).toBe(1);
      articleId = response.body._id;
      articleVersion = response.body.version;
    });

    it('hides the Draft article from Technician/Operator reads', async () => {
      await request(app.getHttpServer())
        .get(`/knowledge-base/articles/${articleId}`)
        .set('Authorization', `Bearer ${technicianToken}`)
        .expect(404);
      await request(app.getHttpServer())
        .get(`/knowledge-base/articles/${articleId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
    });

    it('rejects publishing without expected_version, then rejects a mismatched version', async () => {
      await request(app.getHttpServer())
        .patch(`/knowledge-base/articles/${articleId}/publish`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({})
        .expect(409);
      await request(app.getHttpServer())
        .patch(`/knowledge-base/articles/${articleId}/publish`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ expected_version: articleVersion + 5 })
        .expect(409);
    });

    it('publishes the article with the correct expected_version', async () => {
      const response = await request(app.getHttpServer())
        .patch(`/knowledge-base/articles/${articleId}/publish`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ expected_version: articleVersion })
        .expect(200);

      expect(response.body.status).toBe('published');
      articleVersion = response.body.version;
    });

    it('now becomes visible to Technician/Operator reads', async () => {
      const techResponse = await request(app.getHttpServer())
        .get(`/knowledge-base/articles/${articleId}`)
        .set('Authorization', `Bearer ${technicianToken}`)
        .expect(200);
      expect(techResponse.body.status).toBe('published');

      const opResponse = await request(app.getHttpServer())
        .get(`/knowledge-base/articles/${articleId}`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .expect(200);
      expect(opResponse.body.status).toBe('published');
    });

    it('rejects editing the Published article directly (must revise instead)', async () => {
      await request(app.getHttpServer())
        .put(`/knowledge-base/articles/${articleId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ title: 'Direct edit attempt', expected_version: articleVersion })
        .expect(409);
    });

    let revisionId: string;
    let revisionVersion: number;

    it('creates a new Draft revision of the Published article', async () => {
      const response = await request(app.getHttpServer())
        .post(`/knowledge-base/articles/${articleId}/revise`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          content: 'Updated: check lubrication, alignment, and vibration sensor.',
          expected_version: articleVersion,
          reason: 'Added vibration sensor step',
        })
        .expect(201);

      expect(response.body.status).toBe('draft');
      expect(response.body.revision).toBe(2);
      expect(response.body.supersedes_article_id).toBe(articleId);
      revisionId = response.body._id;
      revisionVersion = response.body.version;
    });

    it('publishing the revision archives its predecessor and links them both ways', async () => {
      await request(app.getHttpServer())
        .patch(`/knowledge-base/articles/${revisionId}/publish`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ expected_version: revisionVersion })
        .expect(200);

      const predecessor = await request(app.getHttpServer())
        .get(`/knowledge-base/articles/${articleId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(predecessor.body.status).toBe('archived');
      expect(predecessor.body.superseded_by_article_id).toBe(revisionId);

      const current = await request(app.getHttpServer())
        .get(`/knowledge-base/articles/${revisionId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(current.body.status).toBe('published');
    });

    it('the archived predecessor is no longer visible to Technician/Operator reads', async () => {
      await request(app.getHttpServer())
        .get(`/knowledge-base/articles/${articleId}`)
        .set('Authorization', `Bearer ${technicianToken}`)
        .expect(404);
    });

    it('lists the full version history chain in revision order', async () => {
      const response = await request(app.getHttpServer())
        .get(`/knowledge-base/articles/${articleId}/versions`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.length).toBe(2);
      expect(response.body[0].revision).toBe(1);
      expect(response.body[0].status).toBe('archived');
      expect(response.body[1].revision).toBe(2);
      expect(response.body[1].status).toBe('published');
    });

    it('cannot delete the archived predecessor (has real lifecycle history)', async () => {
      await request(app.getHttpServer())
        .delete(`/knowledge-base/articles/${articleId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(409);
    });
  });

  describe('an untouched Draft can be deleted; a Published one must be archived', () => {
    it('deletes a fresh Draft with no lifecycle activity', async () => {
      const created = await request(app.getHttpServer())
        .post('/knowledge-base/articles')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          article_id: 'KB-DELETE-ME',
          title: 'Throwaway draft',
          category: 'safety',
          content: 'Draft content',
        })
        .expect(201);

      await request(app.getHttpServer())
        .delete(`/knowledge-base/articles/${created.body._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
    });

    it('archives (rather than deletes) a Published article', async () => {
      const created = await request(app.getHttpServer())
        .post('/knowledge-base/articles')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          article_id: 'KB-ARCHIVE-ME',
          title: 'To be archived',
          category: 'safety',
          content: 'Draft content',
        })
        .expect(201);

      await request(app.getHttpServer())
        .patch(`/knowledge-base/articles/${created.body._id}/publish`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ expected_version: created.body.version })
        .expect(200);

      await request(app.getHttpServer())
        .delete(`/knowledge-base/articles/${created.body._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(409);

      await request(app.getHttpServer())
        .patch(`/knowledge-base/articles/${created.body._id}/archive`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ expected_version: 2 })
        .expect(200);
    });
  });

  describe('search, filters, and suggestions', () => {
    let searchableId: string;

    it('publishes a fault-code-linked, tagged article for search/suggestion tests', async () => {
      const created = await request(app.getHttpServer())
        .post('/knowledge-base/articles')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          article_id: 'KB-SEARCHABLE',
          title: 'Hydraulic pump fault E-99',
          category: 'fault_code',
          summary: 'Explains fault code E-99 on hydraulic pumps',
          content: 'Fault E-99 indicates a pressure sensor malfunction.',
          tags: ['hydraulic', 'pump'],
          machine_id: machineId,
          fault_codes: ['E-99'],
        })
        .expect(201);
      searchableId = created.body._id;

      await request(app.getHttpServer())
        .patch(`/knowledge-base/articles/${searchableId}/publish`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ expected_version: created.body.version })
        .expect(200);
    });

    it('finds the article via full-text search', async () => {
      const response = await request(app.getHttpServer())
        .get('/knowledge-base/articles')
        .set('Authorization', `Bearer ${technicianToken}`)
        .query({ search: 'hydraulic pump' })
        .expect(200);

      const ids = response.body.items.map((item: { _id: string }) => item._id);
      expect(ids).toContain(searchableId);
    });

    it('filters by category and fault code', async () => {
      const response = await request(app.getHttpServer())
        .get('/knowledge-base/articles')
        .set('Authorization', `Bearer ${operatorToken}`)
        .query({ category: 'fault_code', faultCode: 'E-99' })
        .expect(200);

      const ids = response.body.items.map((item: { _id: string }) => item._id);
      expect(ids).toContain(searchableId);
    });

    it('surfaces the article as a suggestion for its machine and fault code', async () => {
      const response = await request(app.getHttpServer())
        .get('/knowledge-base/articles/suggestions')
        .set('Authorization', `Bearer ${operatorToken}`)
        .query({ machineId, faultCode: 'E-99' })
        .expect(200);

      const ids = response.body.map((item: { _id: string }) => item._id);
      expect(ids[0]).toBe(searchableId);
    });

    it('returns no suggestions when nothing matches the given criteria', async () => {
      const response = await request(app.getHttpServer())
        .get('/knowledge-base/articles/suggestions')
        .set('Authorization', `Bearer ${technicianToken}`)
        .query({ faultCode: 'NO-SUCH-CODE' })
        .expect(200);

      expect(response.body).toEqual([]);
    });

    it('rejects suggestion access for an unauthenticated caller', async () => {
      await request(app.getHttpServer())
        .get('/knowledge-base/articles/suggestions')
        .query({ machineId })
        .expect(401);
    });
  });
});
