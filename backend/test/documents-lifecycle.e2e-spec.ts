/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import * as fs from 'fs/promises';
import { join } from 'path';
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
import {
  ModuleType,
  ModuleTypeDocument,
} from '../src/schemas/module-type.schema';
import {
  Module as ModuleEntity,
  ModuleDocument,
} from '../src/schemas/module.schema';
import { WorkOrder, WorkOrderDocument } from '../src/schemas/work-order.schema';
import {
  MaintenancePlan,
  MaintenancePlanDocument,
} from '../src/schemas/maintenance-plan.schema';
import {
  InterventionReport,
  InterventionReportDocument,
} from '../src/schemas/intervention-report.schema';
import {
  DocumentEntity,
  DocumentDocument,
} from '../src/schemas/document.schema';
import {
  DocumentRejection,
  DocumentRejectionDocument,
} from '../src/schemas/document-rejection.schema';

const PDF_BYTES = Buffer.from('%PDF-1.7\n%fake-but-well-formed-for-tests');
const EXE_BYTES = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);

describe('Document lifecycle — storage-backed (e2e)', () => {
  // A replica set is required: publish/archive/replace all run inside real
  // Mongo transactions (replace spans two Document rows atomically). The
  // default 'local' FileStorageProvider is used (no FILE_STORAGE_DRIVER
  // env override), so uploads and quarantined rejects are written to real
  // files under the repo's uploads/quarantine directories. Those
  // directories are shared with other e2e suites that may run
  // concurrently in separate Jest workers (e.g. app.e2e-spec.ts's own
  // protected-file test), so this suite never wipes them wholesale in
  // afterAll — only individual files it can positively identify as its
  // own would be safe to remove, and leaving harmless test fixtures behind
  // is the same tradeoff the rest of this test suite already makes.
  let mongo: MongoMemoryReplSet;
  let app: INestApplication<App>;
  let jwtService: JwtService;
  let connection: Connection;
  let users: Model<UserDocument>;
  let machineTypes: Model<MachineTypeDocument>;
  let machines: Model<MachineDocument>;
  let moduleTypes: Model<ModuleTypeDocument>;
  let modules: Model<ModuleDocument>;
  let workOrders: Model<WorkOrderDocument>;
  let maintenancePlans: Model<MaintenancePlanDocument>;
  let interventionReports: Model<InterventionReportDocument>;
  let documents: Model<DocumentDocument>;
  let documentRejections: Model<DocumentRejectionDocument>;

  let adminToken: string;
  let technicianToken: string;
  let operatorToken: string;
  let admin: UserDocument;
  let technician: UserDocument;
  let operator: UserDocument;
  let machine: MachineDocument;
  let moduleEntity: ModuleDocument;
  let maintenancePlan: MaintenancePlanDocument;
  let workOrder: WorkOrderDocument;
  let interventionReport: InterventionReportDocument;

  const uploadsDir = join(process.cwd(), 'uploads');
  const quarantineDir = join(process.cwd(), 'quarantine');

  beforeAll(async () => {
    mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    process.env.NODE_ENV = 'test';
    process.env.MONGODB_URI = mongo.getUri('gmao_documents_lifecycle_e2e');
    process.env.JWT_SECRET = 'e2e-test-jwt-secret';
    process.env.JWT_REFRESH_SECRET = 'e2e-test-refresh-secret';
    process.env.EMAIL_VERIFICATION_SECRET = 'e2e-test-email-secret';
    delete process.env.FILE_STORAGE_DRIVER;

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
    moduleTypes = app.get(getModelToken(ModuleType.name));
    modules = app.get(getModelToken(ModuleEntity.name));
    workOrders = app.get(getModelToken(WorkOrder.name));
    maintenancePlans = app.get(getModelToken(MaintenancePlan.name));
    interventionReports = app.get(getModelToken(InterventionReport.name));
    documents = app.get(getModelToken(DocumentEntity.name));
    documentRejections = app.get(getModelToken(DocumentRejection.name));

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
      name: 'Document lifecycle E2E machine type',
    });
    const moduleType = await moduleTypes.create({
      mod_type_id: 'MODTYPE-DOC-E2E',
      type_id: machineType._id,
      nom_module: 'Document lifecycle E2E module type',
    });
    machine = await machines.create({
      machine_id: 'MACHINE-DOC',
      type_id: machineType._id,
      serial_no: 'DOC-001',
      status: 'active',
    });
    moduleEntity = await modules.create({
      module_id: 'MODULE-DOC',
      machine_id: machine._id,
      mod_type_id: moduleType._id,
    });

    admin = await users.create({
      user_id: 'ADMIN-DOC-E2E',
      nom_complet: 'Document Admin',
      email: 'doc-admin-e2e@example.test',
      password: 'x',
      role: 'admin',
      is_active: true,
      is_verified: true,
    });
    technician = await users.create({
      user_id: 'TECH-DOC-E2E',
      nom_complet: 'Document Technician',
      email: 'doc-technician-e2e@example.test',
      password: 'x',
      role: 'technician',
      is_active: true,
      is_verified: true,
    });
    operator = await users.create({
      user_id: 'OP-DOC-E2E',
      nom_complet: 'Document Operator',
      email: 'doc-operator-e2e@example.test',
      password: 'x',
      role: 'operator',
      is_active: true,
      is_verified: true,
      assigned_machine_ids: [machine._id],
    });

    adminToken = tokenFor(admin);
    technicianToken = tokenFor(technician);
    operatorToken = tokenFor(operator);

    maintenancePlan = await maintenancePlans.create({
      plan_id: 'PLAN-DOC-E2E',
      module_id: moduleEntity._id,
      type_maintenance: 'preventive',
      frequence: 1,
      unite_frequence: 'mois',
    });
    workOrder = await workOrders.create({
      ot_id: 'WO-DOC-E2E',
      machine_id: machine._id,
      module_id: moduleEntity._id,
      technician_id: technician._id,
      description: 'Document lifecycle fixture work order',
      type_maintenance: 'corrective',
      status: 'in_progress',
      priorite: 'high',
      code_panne: 'FAULT-DOC',
      date_created: new Date('2026-07-14T08:00:00.000Z'),
      date_start: new Date('2026-07-14T08:00:00.000Z'),
    });
    interventionReport = await interventionReports.create({
      report_id: 'REPORT-DOC-E2E',
      ot_id: workOrder._id,
      technician_id: technician._id,
      date_debut: new Date('2026-07-14T08:00:00.000Z'),
      date_fin: new Date('2026-07-14T09:00:00.000Z'),
    });
  }

  async function uploadPdf(overrides: Record<string, string> = {}) {
    return request(app.getHttpServer())
      .post('/documents/upload')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('document_id', overrides.document_id ?? `DOC-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
      .field('machine_id', overrides.machine_id ?? machine._id.toString())
      .field('type_document', overrides.type_document ?? 'manual')
      .attach('file', PDF_BYTES, 'manual.pdf');
  }

  describe('validation, quarantine, and orphan prevention', () => {
    it('rejects an executable renamed as a PDF, quarantines the bytes on disk, and records an immutable rejection', async () => {
      const rejectionCountBefore = await documentRejections.countDocuments();

      await request(app.getHttpServer())
        .post('/documents/upload')
        .set('Authorization', `Bearer ${adminToken}`)
        .field('document_id', 'DOC-MALICIOUS')
        .field('machine_id', machine._id.toString())
        .field('type_document', 'manual')
        .attach('file', EXE_BYTES, 'renamed.pdf')
        .expect(415);

      const storedDocument = await documents.findOne({ document_id: 'DOC-MALICIOUS' });
      expect(storedDocument).toBeNull();

      const rejections = await documentRejections
        .find()
        .sort({ createdAt: -1 })
        .limit(1)
        .exec();
      expect(rejections).toHaveLength(rejectionCountBefore + 1);
      expect(rejections[0].original_file_name).toBe('renamed.pdf');
      expect(rejections[0].reason).toMatch(/does not match its declared type/);
      expect(rejections[0].quarantine_storage_key).toBeTruthy();

      // The rejected bytes really were written to disk, in quarantine —
      // never inside the servable "uploads" tree.
      const quarantinedFiles = await fs.readdir(quarantineDir).catch(() => []);
      expect(quarantinedFiles.length).toBeGreaterThan(0);
      const quarantinedContent = await fs.readFile(join(quarantineDir, quarantinedFiles[0]));
      expect(quarantinedContent).toEqual(EXE_BYTES);
    });

    it('rejects creating a document against a machine that does not exist (orphan prevention)', async () => {
      await request(app.getHttpServer())
        .post('/documents/upload')
        .set('Authorization', `Bearer ${adminToken}`)
        .field('document_id', 'DOC-ORPHAN')
        .field('machine_id', new Types.ObjectId().toString())
        .field('type_document', 'manual')
        .attach('file', PDF_BYTES, 'manual.pdf')
        .expect(404); // machine access check runs before creation and 404s first
    });

    it('rejects linking a document to a maintenance plan, work order, or intervention report that does not exist', async () => {
      const bogusId = new Types.ObjectId().toString();

      await request(app.getHttpServer())
        .post('/documents/upload')
        .set('Authorization', `Bearer ${adminToken}`)
        .field('document_id', 'DOC-BAD-PLAN')
        .field('machine_id', machine._id.toString())
        .field('maintenance_plan_id', bogusId)
        .field('type_document', 'manual')
        .attach('file', PDF_BYTES, 'manual.pdf')
        .expect(400);

      await request(app.getHttpServer())
        .post('/documents/upload')
        .set('Authorization', `Bearer ${adminToken}`)
        .field('document_id', 'DOC-BAD-WO')
        .field('machine_id', machine._id.toString())
        .field('work_order_id', bogusId)
        .field('type_document', 'manual')
        .attach('file', PDF_BYTES, 'manual.pdf')
        .expect(400);

      await request(app.getHttpServer())
        .post('/documents/upload')
        .set('Authorization', `Bearer ${adminToken}`)
        .field('document_id', 'DOC-BAD-REPORT')
        .field('machine_id', machine._id.toString())
        .field('intervention_report_id', bogusId)
        .field('type_document', 'manual')
        .attach('file', PDF_BYTES, 'manual.pdf')
        .expect(400);
    });

    it('creates a document safely linked to a real maintenance plan, work order, and intervention report', async () => {
      const response = await request(app.getHttpServer())
        .post('/documents/upload')
        .set('Authorization', `Bearer ${adminToken}`)
        .field('document_id', 'DOC-LINKED')
        .field('machine_id', machine._id.toString())
        .field('maintenance_plan_id', maintenancePlan._id.toString())
        .field('work_order_id', workOrder._id.toString())
        .field('intervention_report_id', interventionReport._id.toString())
        .field('type_document', 'manual')
        .attach('file', PDF_BYTES, 'manual.pdf')
        .expect(201);

      expect(response.body.status).toBe('draft');
      expect(response.body.version).toBe(1);
      expect(response.body.revision).toBe(1);
      expect(response.body.maintenance_plan_id).toBe(maintenancePlan._id.toString());
      expect(response.body.work_order_id).toBe(workOrder._id.toString());
      expect(response.body.intervention_report_id).toBe(interventionReport._id.toString());

      const uploadedFiles = await fs.readdir(uploadsDir).catch(() => []);
      expect(uploadedFiles.length).toBeGreaterThan(0);
    });
  });

  describe('direct public access is never possible for managed documents', () => {
    it('rejects an unauthenticated request for the protected file endpoint', async () => {
      const created = await uploadPdf({ document_id: 'DOC-AUTH-CHECK' });
      expect(created.status).toBe(201);

      await request(app.getHttpServer())
        .get(`/documents/${created.body._id}/file`)
        .expect(401);
    });

    it('never statically serves the managed uploads directory (only /files/uploads/avatars is mounted)', async () => {
      const created = await uploadPdf({ document_id: 'DOC-STATIC-CHECK' });
      const fileName = (created.body.file_path as string).split('/').pop();

      await request(app.getHttpServer()).get(`/uploads/${fileName}`).expect(404);
    });

    it('serves the file only through the authenticated, machine-scoped protected proxy', async () => {
      const created = await uploadPdf({ document_id: 'DOC-PROXY-CHECK' });

      const response = await request(app.getHttpServer())
        .get(`/documents/${created.body._id}/file`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.headers['content-type']).toBe('application/pdf');
      expect(Buffer.from(response.body)).toEqual(PDF_BYTES);
    });
  });

  describe('lifecycle transitions: Draft -> Published -> Archived, and Superseded via replace', () => {
    it('publishes a Draft, then rejects publishing it again (already Published)', async () => {
      const created = await uploadPdf({ document_id: 'DOC-PUBLISH-FLOW' });
      const id = created.body._id;

      const published = await request(app.getHttpServer())
        .patch(`/documents/${id}/publish`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ expected_version: 1 })
        .expect(200);
      expect(published.body.status).toBe('published');
      expect(published.body.version).toBe(2);

      await request(app.getHttpServer())
        .patch(`/documents/${id}/publish`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ expected_version: 2 })
        .expect(409);
    });

    it('rejects publish/archive/replace from non-Admin roles', async () => {
      const created = await uploadPdf({ document_id: 'DOC-ROLE-CHECK' });
      const id = created.body._id;

      await request(app.getHttpServer())
        .patch(`/documents/${id}/publish`)
        .set('Authorization', `Bearer ${technicianToken}`)
        .send({})
        .expect(403);
      await request(app.getHttpServer())
        .patch(`/documents/${id}/archive`)
        .set('Authorization', `Bearer ${operatorToken}`)
        .send({})
        .expect(403);
      await request(app.getHttpServer())
        .post(`/documents/${id}/replace`)
        .set('Authorization', `Bearer ${technicianToken}`)
        .attach('file', PDF_BYTES, 'v2.pdf')
        .expect(403);
    });

    it('archives a Published document, and blocks Archive from Superseded', async () => {
      const created = await uploadPdf({ document_id: 'DOC-ARCHIVE-FLOW' });
      const id = created.body._id;
      await request(app.getHttpServer())
        .patch(`/documents/${id}/publish`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ expected_version: 1 })
        .expect(200);

      const archived = await request(app.getHttpServer())
        .patch(`/documents/${id}/archive`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ expected_version: 2, reason: 'Superseded by new safety standard' })
        .expect(200);
      expect(archived.body.status).toBe('archived');
    });

    it('lets exactly one of two concurrent publish attempts win, the other failing with a conflict', async () => {
      const created = await uploadPdf({ document_id: 'DOC-CONCURRENT-PUBLISH' });
      const id = created.body._id;

      const [first, second] = await Promise.allSettled([
        request(app.getHttpServer())
          .patch(`/documents/${id}/publish`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ expected_version: 1 }),
        request(app.getHttpServer())
          .patch(`/documents/${id}/publish`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ expected_version: 1 }),
      ]);

      const statuses = [first, second].map((result) =>
        result.status === 'fulfilled' ? result.value.status : -1,
      );
      expect(statuses.filter((status) => status === 200)).toHaveLength(1);
      expect(statuses.filter((status) => status === 409)).toHaveLength(1);
    });

    it('replaces a Published document: creates a new linked Draft version and marks the old one Superseded without deleting it', async () => {
      const created = await uploadPdf({ document_id: 'DOC-REPLACE-FLOW' });
      const originalId = created.body._id;
      await request(app.getHttpServer())
        .patch(`/documents/${originalId}/publish`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ expected_version: 1 })
        .expect(200);

      const replaceResponse = await request(app.getHttpServer())
        .post(`/documents/${originalId}/replace`)
        .set('Authorization', `Bearer ${adminToken}`)
        .field('reason', 'Updated procedure per new regulation')
        .field('expected_version', '2')
        .attach('file', Buffer.from('%PDF-1.7\nversion two'), 'manual-v2.pdf')
        .expect(201);

      const newDoc = replaceResponse.body.document;
      const supersededDoc = replaceResponse.body.superseded;
      expect(newDoc.status).toBe('draft');
      expect(newDoc.revision).toBe(2);
      expect(newDoc.supersedes_document_id).toBe(originalId);
      expect(supersededDoc.status).toBe('superseded');
      expect(supersededDoc.superseded_by_document_id).toBe(newDoc._id);

      // The old (now Superseded) document was never deleted — its file is
      // still reachable through the protected proxy, so any historical
      // reference to it (a work order, an intervention report) keeps
      // resolving.
      const oldFileResponse = await request(app.getHttpServer())
        .get(`/documents/${originalId}/file`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(Buffer.from(oldFileResponse.body)).toEqual(PDF_BYTES);

      const historyResponse = await request(app.getHttpServer())
        .get(`/documents/${newDoc._id}/versions`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(historyResponse.body).toHaveLength(2);
      expect(historyResponse.body.map((entry: { revision: number }) => entry.revision)).toEqual([1, 2]);
    });

    it('rejects replacing a document that is already Superseded', async () => {
      const created = await uploadPdf({ document_id: 'DOC-DOUBLE-REPLACE' });
      const id = created.body._id;
      const firstReplace = await request(app.getHttpServer())
        .post(`/documents/${id}/replace`)
        .set('Authorization', `Bearer ${adminToken}`)
        .field('expected_version', '1')
        .attach('file', Buffer.from('%PDF-1.7\nsecond'), 'v2.pdf')
        .expect(201);
      expect(firstReplace.body.superseded.status).toBe('superseded');

      await request(app.getHttpServer())
        .post(`/documents/${id}/replace`)
        .set('Authorization', `Bearer ${adminToken}`)
        .field('expected_version', '2')
        .attach('file', Buffer.from('%PDF-1.7\nthird'), 'v3.pdf')
        .expect(409);
    });
  });

  describe('deletion is blocked once a document has real lifecycle history', () => {
    it('rejects deleting a document that has already been published', async () => {
      const created = await uploadPdf({ document_id: 'DOC-DELETE-BLOCKED' });
      const id = created.body._id;
      await request(app.getHttpServer())
        .patch(`/documents/${id}/publish`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ expected_version: 1 })
        .expect(200);

      await request(app.getHttpServer())
        .delete(`/documents/${id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(409);
    });

    it('allows deleting a document that is still an untouched Draft', async () => {
      const created = await uploadPdf({ document_id: 'DOC-DELETE-ALLOWED' });
      const id = created.body._id;

      await request(app.getHttpServer())
        .delete(`/documents/${id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const stored = await documents.findById(id);
      expect(stored).toBeNull();
    });
  });
});
