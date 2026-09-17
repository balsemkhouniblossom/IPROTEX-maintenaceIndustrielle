import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { ConfigModule } from '@nestjs/config';
import { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';
import { JwtAuthGuard } from '../src/auth/jwt-auth.guard';
import { JwtStrategy } from '../src/auth/jwt.strategy';
import { RolesGuard } from '../src/auth/roles.guard';
import { QualityModule } from '../src/quality/quality.module';
import {
  ProductDefectCatalogue,
  ProductDefectCatalogueSchema,
} from '../src/schemas/product-defect-catalogue.schema';
import {
  QualityDefectOccurrence,
  QualityDefectOccurrenceSchema,
} from '../src/schemas/quality-defect-occurrence.schema';
import {
  ApprovalStatus,
  Role,
  User,
  UserSchema,
} from '../src/schemas/user.schema';

const DATABASE = 'iproflex_quality_point3_test';
const JWT_SECRET = 'point35-isolated-test-secret';
const backendRoot = resolve(__dirname, '..');

function checkTarget(uri: string): void {
  const target = new URL(uri);
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(target.protocol, 'mongodb:');
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname));
  assert.equal(target.pathname, `/${DATABASE}`);
  console.log(
    `PRE-FLIGHT NODE_ENV=${process.env.NODE_ENV} host=${target.hostname} database=${target.pathname.slice(1)}`,
  );
}

async function runExistingApply(
  uri: string,
): Promise<{ status: number; output: string }> {
  return new Promise((done, reject) => {
    const child = spawn(
      process.execPath,
      [
        require.resolve('ts-node/dist/bin.js'),
        'scripts/import-iproflex-quality.ts',
        '--apply',
      ],
      {
        cwd: backendRoot,
        shell: false,
        env: {
          ...process.env,
          NODE_ENV: 'test',
          IPROFLEX_QUALITY_TEST_MONGO_URI: uri,
        },
      },
    );
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.once('error', reject);
    child.once('close', (status) => done({ status: status ?? -1, output }));
  });
}

async function verifyContent(
  db: mongoose.Connection['db'],
  catalogueName: string,
  occurrenceName: string,
): Promise<void> {
  assert.ok(db);
  const catalogues = await db.collection(catalogueName).find().toArray();
  const occurrences = await db.collection(occurrenceName).find().toArray();
  const quantity = occurrences.reduce(
    (sum, record) => sum + Number(record.quantity_affected),
    0,
  );
  assert.equal(catalogues.length, 20);
  assert.equal(occurrences.length, 30);
  assert.equal(quantity, 30);
  assert.equal(
    new Set(catalogues.map((record) => record.defect_code)).size,
    20,
  );
  assert.equal(
    new Set(catalogues.map((record) => record.import_identity)).size,
    20,
  );
  assert.equal(
    new Set(occurrences.map((record) => record.import_identity)).size,
    30,
  );
  const catalogueIds = new Set(
    catalogues.map((record) => record._id.toString()),
  );
  for (const record of occurrences) {
    assert.ok(
      catalogueIds.has(record.catalogue_id?.toString()),
      'Missing catalogue link',
    );
    assert.equal(record.source, 'HISTORICAL_IMPORT');
    assert.equal(record.status, 'HISTORICAL');
    assert.equal(record.date_precision, 'DATE');
    assert.ok(
      Number.isInteger(record.quantity_affected) &&
        record.quantity_affected >= 1,
    );
    for (const absent of [
      'resolved_at',
      'detected_at',
      'resolution_duration',
      'product_mttr',
      'reported_by',
      'resolved_by',
      'technician',
      'machine_id',
      'linked_work_order_id',
    ])
      assert.equal(record[absent], undefined, `Fabricated ${absent}`);
  }
  for (const code of ['F201', 'F107', 'F108']) {
    const sample = occurrences.find((record) => record.defect_code === code);
    assert.ok(sample, `Missing ${code} representative record`);
    console.log(
      `REPRESENTATIVE code=${code} date=${sample.occurrence_date.toISOString().slice(0, 10)} source=${sample.source_sheet}!${sample.source_cell} quantity=${sample.quantity_affected}`,
    );
  }
  const crossMonth = occurrences.find(
    (record) => record.source_sheet === 'Oct' && record.source_cell === 'E16',
  );
  assert.ok(crossMonth);
  assert.equal(crossMonth.source_defect_code, '201');
  assert.equal(crossMonth.defect_code, 'F201');
  assert.equal(
    crossMonth.occurrence_date.toISOString().slice(0, 10),
    '2025-09-30',
  );
  assert.equal(crossMonth.date_precision, 'DATE');
  assert.equal(crossMonth.quantity_affected, 1);
  console.log(
    `CONTENT catalogue=${catalogues.length} historical=${occurrences.length} affected_quantity=${quantity} cross_month=Oct!E16/2025-09-30`,
  );
}

async function verifyIndexes(
  db: mongoose.Connection['db'],
  catalogueName: string,
  occurrenceName: string,
): Promise<void> {
  assert.ok(db);
  const catalogueIndexes = await db.collection(catalogueName).indexes();
  const occurrenceIndexes = await db.collection(occurrenceName).indexes();
  for (const field of ['defect_code', 'import_identity']) {
    assert.ok(
      catalogueIndexes.some(
        (index) => index.key[field] === 1 && index.unique === true,
      ),
      `Missing unique catalogue ${field} index`,
    );
  }
  assert.ok(
    occurrenceIndexes.some(
      (index) =>
        index.key.import_identity === 1 &&
        index.unique === true &&
        index.partialFilterExpression?.source === 'HISTORICAL_IMPORT',
    ),
    'Missing partial unique historical identity index',
  );
  console.log(
    'INDEXES physical catalogue defect_code unique=YES import_identity unique=YES historical import_identity partial unique=YES',
  );
}

async function verifyReadApi(
  uri: string,
  db: mongoose.Connection['db'],
  occurrenceName: string,
): Promise<void> {
  assert.ok(db);
  const users = db.collection('users');
  const created = await users.insertMany([
    {
      user_id: 'point35-admin',
      nom_complet: 'Point 3.5 Admin',
      email: 'point35-admin@example.invalid',
      role: Role.ADMIN,
      is_active: true,
      is_verified: true,
      approval_status: ApprovalStatus.APPROVED,
      profile_completed: true,
    },
    {
      user_id: 'point35-technician',
      nom_complet: 'Point 3.5 Technician',
      email: 'point35-technician@example.invalid',
      role: Role.TECHNICIAN,
      is_active: true,
      is_verified: true,
      approval_status: ApprovalStatus.APPROVED,
      profile_completed: true,
    },
    {
      user_id: 'point35-operator',
      nom_complet: 'Point 3.5 Operator',
      email: 'point35-operator@example.invalid',
      role: Role.OPERATOR,
      is_active: true,
      is_verified: true,
      approval_status: ApprovalStatus.APPROVED,
      profile_completed: true,
    },
  ]);
  const moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ ignoreEnvFile: true }),
      MongooseModule.forRoot(uri),
      MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
      PassportModule,
      QualityModule,
    ],
    providers: [
      JwtStrategy,
      { provide: APP_GUARD, useClass: JwtAuthGuard },
      { provide: APP_GUARD, useClass: RolesGuard },
    ],
  }).compile();
  const app: INestApplication = moduleRef.createNestApplication();
  try {
    await app.init();
    const jwt = new JwtService({ secret: JWT_SECRET });
    const token = (
      role: Role,
      id: mongoose.Types.ObjectId,
      email: string,
      userId: string,
    ) => jwt.sign({ sub: id.toString(), email, role, user_id: userId });
    const admin = token(
      Role.ADMIN,
      created.insertedIds[0],
      'point35-admin@example.invalid',
      'point35-admin',
    );
    const technician = token(
      Role.TECHNICIAN,
      created.insertedIds[1],
      'point35-technician@example.invalid',
      'point35-technician',
    );
    const operator = token(
      Role.OPERATOR,
      created.insertedIds[2],
      'point35-operator@example.invalid',
      'point35-operator',
    );
    const server = app.getHttpServer();
    await request(server).get('/quality/defect-catalogue').expect(401);
    await request(server)
      .get('/quality/defect-catalogue')
      .set('Authorization', `Bearer ${operator}`)
      .expect(403);
    await request(server)
      .get('/quality/defect-catalogue')
      .set('Authorization', `Bearer ${technician}`)
      .expect(403);
    const catalogue = await request(server)
      .get('/quality/defect-catalogue?limit=100')
      .set('Authorization', `Bearer ${admin}`)
      .expect(200);
    assert.equal(catalogue.body.totalItems, 20);
    assert.equal(catalogue.body.items.length, 20);
    const definition = await request(server)
      .get('/quality/defect-catalogue/F201')
      .set('Authorization', `Bearer ${admin}`)
      .expect(200);
    assert.equal(definition.body.defect_name, 'Loop in the sleeve');
    const filter =
      'year=2025&process=Tressage&defectCode=F201&source=HISTORICAL_IMPORT';
    const matching = await db.collection(occurrenceName).countDocuments({
      process: 'Tressage',
      defect_code: 'F201',
      source: 'HISTORICAL_IMPORT',
      occurrence_date: {
        $gte: new Date('2025-01-01T00:00:00.000Z'),
        $lt: new Date('2026-01-01T00:00:00.000Z'),
      },
    });
    const defects = await request(server)
      .get(`/quality/defects?${filter}&limit=100`)
      .set('Authorization', `Bearer ${admin}`)
      .expect(200);
    assert.equal(defects.body.totalItems, matching);
    assert.ok(
      defects.body.items.every(
        (record: { defect_code: string; process: string; source: string }) =>
          record.defect_code === 'F201' &&
          record.process === 'Tressage' &&
          record.source === 'HISTORICAL_IMPORT',
      ),
    );
    await request(server)
      .post('/quality/defects')
      .set('Authorization', `Bearer ${admin}`)
      .send({})
      .expect(404);
    console.log(
      `API catalogue=20 F201_name="Loop in the sleeve" filtered_F201_Tressage=${matching} unauthenticated=401 non_admin=403 admin=200 mutation_route=404`,
    );
  } finally {
    await app.close();
  }
}

async function main(): Promise<void> {
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = JWT_SECRET;
  const mongo = await MongoMemoryServer.create({
    instance: { dbName: DATABASE },
  });
  const uri = mongo.getUri(DATABASE);
  let connection: mongoose.Connection | undefined;
  try {
    checkTarget(uri);
    connection = await mongoose.createConnection(uri).asPromise();
    const db = connection.db;
    assert.ok(db);
    const names = (await db.admin().listDatabases()).databases.map(
      (item) => item.name,
    );
    assert.ok(
      names.every((name) => ['admin', 'config', 'local'].includes(name)),
      `Unexpected pre-existing database: ${names.join(', ')}`,
    );
    assert.equal(
      (await db.listCollections().toArray()).length,
      0,
      'Target database contains pre-existing collections',
    );
    console.log(
      `PRE-FLIGHT fresh_in_memory_instance=YES company_data=NO target_collections=0 other_databases=${names.join(', ') || 'none'}`,
    );
    const catalogueName = connection.model(
      ProductDefectCatalogue.name,
      ProductDefectCatalogueSchema,
    ).collection.name;
    const occurrenceName = connection.model(
      QualityDefectOccurrence.name,
      QualityDefectOccurrenceSchema,
    ).collection.name;
    const first = await runExistingApply(uri);
    console.log(`FIRST APPLY exit=${first.status}\n${first.output}`);
    assert.equal(first.status, 0, 'First official import failed');
    assert.match(first.output, /catalogueInserted:\s*20/);
    assert.match(first.output, /occurrenceInserted:\s*30/);
    await verifyContent(db, catalogueName, occurrenceName);
    await verifyIndexes(db, catalogueName, occurrenceName);
    const second = await runExistingApply(uri);
    console.log(`SECOND APPLY exit=${second.status}\n${second.output}`);
    assert.equal(second.status, 0, 'Second identical import failed');
    for (const [field, expected] of [
      ['catalogueInserted', 0],
      ['catalogueSkipped', 20],
      ['occurrenceInserted', 0],
      ['occurrenceSkipped', 30],
    ] as const)
      assert.match(second.output, new RegExp(`${field}:\\s*${expected}`));
    await verifyContent(db, catalogueName, occurrenceName);
    const occurrenceCollection = db.collection(occurrenceName);
    const fixture = await occurrenceCollection.findOne({
      source_sheet: 'Oct',
      source_cell: 'E16',
    });
    assert.ok(fixture);
    try {
      await occurrenceCollection.updateOne(
        { _id: fixture._id },
        { $set: { quantity_affected: 2 } },
      );
      const conflict = await runExistingApply(uri);
      console.log(
        `CONFLICT APPLY exit=${conflict.status} result=${conflict.output.includes('conflict') ? 'conflict detected' : 'unexpected response'}`,
      );
      assert.notEqual(conflict.status, 0);
      assert.match(conflict.output, /conflict/i);
      assert.equal(
        (await occurrenceCollection.findOne({ _id: fixture._id }))
          ?.quantity_affected,
        2,
        'Importer overwrote modified fixture',
      );
    } finally {
      await occurrenceCollection.updateOne(
        { _id: fixture._id },
        { $set: { quantity_affected: 1 } },
      );
    }
    await verifyContent(db, catalogueName, occurrenceName);
    await verifyReadApi(uri, db, occurrenceName);
    console.log(
      'POINT 3.5 isolated persistence, idempotency, indexes, conflict, and RBAC: PASS',
    );
  } finally {
    await connection?.close();
    await mongo.stop();
    console.log('ISOLATED FIXTURE stopped; no company database connection');
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
