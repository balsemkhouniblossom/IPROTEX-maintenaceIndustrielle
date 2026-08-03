import { ConflictException } from '@nestjs/common';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Connection, Types, createConnection } from 'mongoose';
import { InterventionReportSchema } from '../../schemas/intervention-report.schema';
import { WorkOrder, WorkOrderSchema } from '../../schemas/work-order.schema';
import { InterventionReport } from '../../schemas/intervention-report.schema';
import { WorkOrderAssignmentService } from './work-order-assignment.service';
import { WorkOrderLifecycleService } from './work-order-lifecycle.service';

describe('work-order assignment and lifecycle Mongo integration', () => {
  let mongod: MongoMemoryReplSet;
  let connection: Connection;
  let workOrderModel: any;
  let reportModel: any;
  let assignmentService: WorkOrderAssignmentService;
  let lifecycleService: WorkOrderLifecycleService;

  beforeAll(async () => {
    mongod = await MongoMemoryReplSet.create({
      replSet: { count: 1 },
    });
    connection = await createConnection(mongod.getUri()).asPromise();
    workOrderModel = connection.model(WorkOrder.name, WorkOrderSchema);
    reportModel = connection.model(
      InterventionReport.name,
      InterventionReportSchema,
    );
    await workOrderModel.syncIndexes();
    await reportModel.syncIndexes();
    assignmentService = new WorkOrderAssignmentService(workOrderModel as never);
    lifecycleService = new WorkOrderLifecycleService(
      workOrderModel as never,
      reportModel as never,
    );
  }, 60_000);

  afterAll(async () => {
    await connection.close();
    await mongod.stop();
  });

  beforeEach(async () => {
    await workOrderModel.deleteMany({});
    await reportModel.deleteMany({});
  });

  function workOrder(overrides: Record<string, unknown> = {}) {
    return {
      ot_id: `WO-${new Types.ObjectId().toHexString()}`,
      machine_id: new Types.ObjectId(),
      type_maintenance: 'corrective',
      status: 'pending',
      date_created: new Date(),
      lifecycle_history: [],
      ...overrides,
    };
  }

  async function createReport(
    workOrderId: Types.ObjectId,
    technicianId: Types.ObjectId,
  ) {
    return reportModel.create({
      report_id: `REP-${new Types.ObjectId().toHexString()}`,
      ot_id: workOrderId,
      technician_id: technicianId,
      date_debut: new Date('2026-08-02T08:00:00.000Z'),
      date_fin: new Date('2026-08-02T09:00:00.000Z'),
      description_action: 'Repaired drive',
      etat_final: 'resolved',
      validation_responsable: 'waiting_validation',
    });
  }

  function fulfilled<T>(results: PromiseSettledResult<T>[]) {
    return results.filter(
      (result): result is PromiseFulfilledResult<T> =>
        result.status === 'fulfilled',
    );
  }

  function rejected<T>(results: PromiseSettledResult<T>[]) {
    return results.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
  }

  it('allows exactly one simultaneous technician claim against a real work order', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await workOrderModel.deleteMany({});
      const machineId = new Types.ObjectId();
      const order = await workOrderModel.create(
        workOrder({ machine_id: machineId }),
      );
      const technicianA = new Types.ObjectId().toHexString();
      const technicianB = new Types.ObjectId().toHexString();

      const results = await Promise.allSettled([
        assignmentService.claimForTechnician({
          technicianId: technicianA,
          workOrderId: order._id.toString(),
          accessibleMachineIds: [machineId],
        }),
        assignmentService.claimForTechnician({
          technicianId: technicianB,
          workOrderId: order._id.toString(),
          accessibleMachineIds: [machineId],
        }),
      ]);

      expect(fulfilled(results)).toHaveLength(1);
      expect(rejected(results)).toHaveLength(1);
      expect(rejected(results)[0].reason).toBeInstanceOf(ConflictException);

      const finalOrder = await workOrderModel.findById(order._id).lean().exec();
      expect(finalOrder?.status).toBe('assigned');
      expect(finalOrder?.technician_id?.toString()).toBe(
        fulfilled(results)[0].value.technician_id?.toString(),
      );
      expect(finalOrder?.lifecycle_history ?? []).toHaveLength(0);
    }
  });

  it('prevents a cross-scope technician from winning a claim race', async () => {
    const machineA = new Types.ObjectId();
    const machineB = new Types.ObjectId();
    const order = await workOrderModel.create(
      workOrder({ machine_id: machineA }),
    );
    const technicianA = new Types.ObjectId().toHexString();
    const technicianB = new Types.ObjectId().toHexString();

    const results = await Promise.allSettled([
      assignmentService.claimForTechnician({
        technicianId: technicianB,
        workOrderId: order._id.toString(),
        accessibleMachineIds: [machineB],
      }),
      assignmentService.claimForTechnician({
        technicianId: technicianA,
        workOrderId: order._id.toString(),
        accessibleMachineIds: [machineA],
      }),
    ]);

    expect(fulfilled(results)).toHaveLength(1);
    expect(rejected(results)).toHaveLength(1);
    const finalOrder = await workOrderModel.findById(order._id).lean().exec();
    expect(finalOrder?.technician_id?.toString()).toBe(technicianA);
    expect(finalOrder?.status).toBe('assigned');
    expect(finalOrder?.lifecycle_history ?? []).toHaveLength(0);
  });

  it('allows exactly one same-transition lifecycle race winner', async () => {
    const technician = new Types.ObjectId();
    const order = await workOrderModel.create(
      workOrder({ technician_id: technician, status: 'in_progress' }),
    );

    const results = await Promise.allSettled([
      lifecycleService.transitionForTechnician({
        technicianId: technician.toHexString(),
        workOrderId: order._id.toString(),
        from: ['in_progress'],
        to: 'waiting_parts',
      }),
      lifecycleService.transitionForTechnician({
        technicianId: technician.toHexString(),
        workOrderId: order._id.toString(),
        from: ['in_progress'],
        to: 'waiting_parts',
      }),
    ]);

    expect(fulfilled(results)).toHaveLength(1);
    expect(rejected(results)).toHaveLength(1);
    const finalOrder = await workOrderModel.findById(order._id).lean().exec();
    expect(finalOrder?.status).toBe('waiting_parts');
    expect(finalOrder?.lifecycle_history ?? []).toHaveLength(0);
  });

  it('prevents incompatible lifecycle transitions from overwriting the winner', async () => {
    const technician = new Types.ObjectId();
    const order = await workOrderModel.create(
      workOrder({ technician_id: technician, status: 'in_progress' }),
    );
    const report = await createReport(order._id, technician);

    const results = await Promise.allSettled([
      lifecycleService.transitionForTechnician({
        technicianId: technician.toHexString(),
        workOrderId: order._id.toString(),
        from: ['in_progress'],
        to: 'waiting_parts',
      }),
      lifecycleService.closeForTechnician({
        technicianId: technician.toHexString(),
        workOrderId: order._id.toString(),
        report,
      }),
    ]);

    expect(fulfilled(results)).toHaveLength(1);
    expect(rejected(results)).toHaveLength(1);
    const finalOrder = await workOrderModel.findById(order._id).lean().exec();
    expect(['waiting_parts', 'waiting_validation']).toContain(
      finalOrder?.status,
    );
    expect(finalOrder?.lifecycle_history ?? []).toHaveLength(
      finalOrder?.status === 'waiting_validation' ? 1 : 0,
    );
  });

  it('allows exactly one incompatible validation decision and one report side effect', async () => {
    const technician = new Types.ObjectId();
    const order = await workOrderModel.create(
      workOrder({ technician_id: technician, status: 'waiting_validation' }),
    );
    const report = await createReport(order._id, technician);
    const validatorA = new Types.ObjectId().toHexString();
    const validatorB = new Types.ObjectId().toHexString();

    const results = await Promise.allSettled([
      lifecycleService.applyValidationAction({
        workOrderId: order._id.toString(),
        action: 'approve',
        validatorId: validatorA,
      }),
      lifecycleService.applyValidationAction({
        workOrderId: order._id.toString(),
        action: 'reject',
        validatorId: validatorB,
      }),
    ]);

    expect(fulfilled(results)).toHaveLength(1);
    expect(rejected(results)).toHaveLength(1);
    const finalOrder = await workOrderModel.findById(order._id).lean().exec();
    expect(['validated', 'rejected']).toContain(finalOrder?.status);
    expect(finalOrder?.lifecycle_history ?? []).toHaveLength(1);

    const finalReport: any = await reportModel
      .findById(report._id)
      .lean()
      .exec();
    expect(['validated', 'rejected']).toContain(
      finalReport?.validation_responsable,
    );
    expect(finalReport?.validated_by).toBeDefined();
  });

  it('rolls back work-order history and report side effects when caller-owned transaction aborts', async () => {
    const technician = new Types.ObjectId();
    const order = await workOrderModel.create(
      workOrder({ technician_id: technician, status: 'in_progress' }),
    );
    const report = await createReport(order._id, technician);
    const session = await connection.startSession();

    await expect(
      session.withTransaction(async () => {
        await lifecycleService.closeForTechnician({
          technicianId: technician.toHexString(),
          workOrderId: order._id.toString(),
          report,
          session,
        });
        throw new Error('rollback-after-work-order');
      }),
    ).rejects.toThrow('rollback-after-work-order');
    await session.endSession();

    const finalOrder = await workOrderModel.findById(order._id).lean().exec();
    const finalReport: any = await reportModel
      .findById(report._id)
      .lean()
      .exec();
    expect(finalOrder?.status).toBe('in_progress');
    expect(finalOrder?.lifecycle_history ?? []).toHaveLength(0);
    expect(finalReport?.validation_responsable).toBe('waiting_validation');
  });

  it('keeps extracted lifecycle query count bounded for waiting-parts transition', async () => {
    const technician = new Types.ObjectId();
    const order = await workOrderModel.create(
      workOrder({ technician_id: technician, status: 'in_progress' }),
    );
    const calls: string[] = [];
    const previousDebug = connection.get('debug');
    connection.set('debug', (_collection, method) => {
      calls.push(String(method));
    });

    try {
      await lifecycleService.transitionForTechnician({
        technicianId: technician.toHexString(),
        workOrderId: order._id.toString(),
        from: ['in_progress'],
        to: 'waiting_parts',
      });
    } finally {
      connection.set('debug', previousDebug);
    }

    expect(calls).toEqual(['findOneAndUpdate']);
  });
});
