/* eslint-disable no-console */
import '../src/load-env';
import * as bcrypt from 'bcrypt';
import { NestFactory } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { AppModule } from '../src/app.module';
import { User, Role, ApprovalStatus } from '../src/schemas/user.schema';
import { MachineType } from '../src/schemas/machine-type.schema';
import { Machine } from '../src/schemas/machine.schema';
import { ModuleType } from '../src/schemas/module-type.schema';
import { Module as ModuleEntity } from '../src/schemas/module.schema';
import { Catalogue } from '../src/schemas/catalogue.schema';
import { Stock } from '../src/schemas/stock.schema';
import { Panne } from '../src/schemas/panne.schema';
import {
  MaintenancePlan,
  MaintenancePlanStatus,
} from '../src/schemas/maintenance-plan.schema';
import { PreventiveTask } from '../src/schemas/preventive-task.schema';
import { WorkOrder } from '../src/schemas/work-order.schema';
import { MaintenancePlansService } from '../src/maintenance-plans/maintenance-plans.service';
import { WorkOrderPreventiveSchedulingService } from '../src/work-orders/services/work-order-preventive-scheduling.service';
import { assertSafeUatTarget } from '../src/config/uat-staging-safety';

const IDS = {
  machineType: 990001,
  operatorMachine: 'UAT-MACHINE-OPERATOR',
  technicianMachine: 'UAT-MACHINE-TECHNICIAN',
  restrictedMachine: 'UAT-MACHINE-RESTRICTED',
  moduleType: 'UAT-MODULE-TYPE-001',
  module: 'UAT-MODULE-001',
  plan: 'UAT-PLAN-6M-001',
  corrective: 'UAT-OT-CORRECTIVE-001',
} as const;

async function main(): Promise<void> {
  const database = assertSafeUatTarget(process.env);
  process.env.AUTOMATION_SCHEDULER_ENABLED = 'false';
  process.env.PREDICTIVE_MAINTENANCE_ENABLED = 'false';

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  try {
    const users = app.get<Model<User>>(getModelToken(User.name));
    const machineTypes = app.get<Model<MachineType>>(
      getModelToken(MachineType.name),
    );
    const machines = app.get<Model<Machine>>(getModelToken(Machine.name));
    const moduleTypes = app.get<Model<ModuleType>>(
      getModelToken(ModuleType.name),
    );
    const modules = app.get<Model<ModuleEntity>>(
      getModelToken(ModuleEntity.name),
    );
    const catalogue = app.get<Model<Catalogue>>(getModelToken(Catalogue.name));
    const stocks = app.get<Model<Stock>>(getModelToken(Stock.name));
    const failures = app.get<Model<Panne>>(getModelToken(Panne.name));
    const plans = app.get<Model<MaintenancePlan>>(
      getModelToken(MaintenancePlan.name),
    );
    const tasks = app.get<Model<PreventiveTask>>(
      getModelToken(PreventiveTask.name),
    );
    const workOrders = app.get<Model<WorkOrder>>(getModelToken(WorkOrder.name));
    const planLifecycle = app.get(MaintenancePlansService);
    const scheduler = app.get(WorkOrderPreventiveSchedulingService);

    const passwordByRole = {
      [Role.ADMIN]: process.env.UAT_ADMIN_PASSWORD!,
      [Role.TECHNICIAN]: process.env.UAT_TECHNICIAN_PASSWORD!,
      [Role.OPERATOR]: process.env.UAT_OPERATOR_PASSWORD!,
    };
    const userSpecs = [
      [Role.ADMIN, 'ADMIN_TEST', 'admin-test@uat.invalid'],
      [Role.TECHNICIAN, 'TECHNICIAN_TEST', 'technician-test@uat.invalid'],
      [Role.OPERATOR, 'OPERATOR_TEST', 'operator-test@uat.invalid'],
    ] as const;
    const seededUsers = new Map<Role, User & { _id: unknown }>();
    for (const [role, userId, email] of userSpecs) {
      const password = await bcrypt.hash(passwordByRole[role], 12);
      const user = await users
        .findOneAndUpdate(
          { user_id: userId },
          {
            $set: {
              nom_complet: userId,
              email,
              password,
              role,
              is_active: true,
              is_verified: true,
              approval_status: ApprovalStatus.APPROVED,
              profile_completed: true,
              must_reset_password: false,
            },
            $setOnInsert: {
              created_at: new Date(),
              login_history: [],
              assigned_machine_ids: [],
            },
          },
          { upsert: true, new: true },
        )
        .exec();
      seededUsers.set(role, user as User & { _id: unknown });
    }

    const machineType = await machineTypes
      .findOneAndUpdate(
        { type_id: IDS.machineType },
        {
          $set: {
            name: 'UAT Synthetic Machine Type',
            description: 'Synthetic staging acceptance data only',
          },
        },
        { upsert: true, new: true },
      )
      .exec();

    const machineDocs = new Map<string, Machine & { _id: unknown }>();
    for (const [machineId, serial] of [
      [IDS.operatorMachine, 'UAT-SERIAL-OP-001'],
      [IDS.technicianMachine, 'UAT-SERIAL-TECH-001'],
      [IDS.restrictedMachine, 'UAT-SERIAL-RESTRICTED-001'],
    ] as const) {
      const machine = await machines
        .findOneAndUpdate(
          { machine_id: machineId },
          {
            $set: {
              type_id: machineType!._id,
              serial_no: serial,
              model: 'UAT-SYNTHETIC',
              location: 'UAT staging area',
              status: 'operational',
            },
          },
          { upsert: true, new: true },
        )
        .exec();
      machineDocs.set(machineId, machine as Machine & { _id: unknown });
    }

    const operatorMachine = machineDocs.get(IDS.operatorMachine)!;
    await users
      .updateOne(
        { user_id: 'OPERATOR_TEST' },
        { $set: { assigned_machine_ids: [operatorMachine._id] } },
      )
      .exec();

    const moduleType = await moduleTypes
      .findOneAndUpdate(
        { mod_type_id: IDS.moduleType },
        {
          $set: {
            type_id: machineType!._id,
            nom_module: 'UAT Drive Module',
            categorie_module: 'synthetic',
          },
        },
        { upsert: true, new: true },
      )
      .exec();
    const moduleDoc = await modules
      .findOneAndUpdate(
        { module_id: IDS.module },
        {
          $set: {
            machine_id: operatorMachine._id,
            mod_type_id: moduleType!._id,
            localisation: 'UAT bay',
          },
        },
        { upsert: true, new: true },
      )
      .exec();

    const part = await catalogue
      .findOneAndUpdate(
        { part_id: 'UAT-PART-001' },
        {
          $set: {
            nom_piece: 'UAT Synthetic Bearing',
            ref_constructeur: 'UAT-REF-001',
            fabricant: 'Synthetic',
            categorie_piece: 'UAT',
            unit_cost: 10,
          },
        },
        { upsert: true, new: true },
      )
      .exec();
    await stocks
      .findOneAndUpdate(
        { stock_id: 'UAT-STOCK-001' },
        {
          $set: {
            part_id: part!._id,
            quantite_en_stock: 10,
            quantite_reservee: 0,
            seuil_alerte_stock: 2,
            emplacement: 'UAT-BIN-01',
            version: 1,
          },
        },
        { upsert: true, new: true },
      )
      .exec();
    await failures
      .findOneAndUpdate(
        { panne_id: 'UAT-FAILURE-001' },
        {
          $set: {
            code_panne: 'UAT-BEARING-NOISE',
            description: 'Synthetic bearing-noise scenario',
            gravite: 'medium',
          },
        },
        { upsert: true },
      )
      .exec();

    await workOrders
      .findOneAndUpdate(
        { ot_id: IDS.corrective },
        {
          $set: {
            machine_id: machineDocs.get(IDS.technicianMachine)!._id,
            technician_id: seededUsers.get(Role.TECHNICIAN)!._id,
            description: 'UAT corrective intervention scenario',
            type_maintenance: 'corrective',
            code_panne: 'UAT-BEARING-NOISE',
            status: 'assigned',
            priorite: 'medium',
            date_created: new Date(),
          },
        },
        { upsert: true, new: true },
      )
      .exec();

    let plan = await plans.findOne({ plan_id: IDS.plan }).exec();
    if (!plan) {
      plan = await planLifecycle.create(
        {
          plan_id: IDS.plan,
          module_id: String(moduleDoc!._id),
          type_maintenance: 'preventive',
          frequence: 6,
          unite_frequence: 'months',
          frequence_label: 'Every 6 months',
          maintenance_code: 'UAT-PM-6M',
          instruction: 'Complete the synthetic UAT preventive checklist',
          responsable: 'Operator',
        },
        String(seededUsers.get(Role.ADMIN)!._id),
      );
    }
    await tasks
      .findOneAndUpdate(
        { task_id: 'UAT-TASK-001' },
        {
          $set: {
            plan_id: plan._id,
            plan_code: 'UAT-PM-6M',
            module_id: moduleDoc!._id,
            instruction: 'Inspect synthetic bearing',
            responsable: 'Operator',
            status: 'pending',
            source: 'plan',
            source_key: 'UAT-PLAN-6M-001:1',
          },
        },
        { upsert: true },
      )
      .exec();
    await tasks
      .findOneAndUpdate(
        { task_id: 'UAT-TASK-002' },
        {
          $set: {
            plan_id: plan._id,
            plan_code: 'UAT-PM-6M',
            module_id: moduleDoc!._id,
            instruction: 'Record synthetic checklist result',
            responsable: 'Operator',
            status: 'pending',
            source: 'plan',
            source_key: 'UAT-PLAN-6M-001:2',
          },
        },
        { upsert: true },
      )
      .exec();

    if (plan.status === MaintenancePlanStatus.DRAFT) {
      await planLifecycle.transition(
        String(plan._id),
        { action: 'activate', reason: 'Synthetic Phase 2 UAT seed' },
        String(seededUsers.get(Role.ADMIN)!._id),
      );
      plan = await plans.findById(plan._id).exec();
    }
    if (plan?.status !== MaintenancePlanStatus.ACTIVE) {
      throw new Error(
        `UAT plan must be active; found ${plan?.status ?? 'missing'}`,
      );
    }
    const occurrenceCount = await workOrders
      .countDocuments({ plan_id: plan._id })
      .exec();
    if (occurrenceCount === 0) {
      await scheduler.scheduleFirstPreventiveOccurrence({
        machineId: String(operatorMachine._id),
        planId: String(plan._id),
        scheduledDate: new Date().toISOString(),
        operatorId: String(seededUsers.get(Role.OPERATOR)!._id),
      });
    } else if (occurrenceCount !== 1) {
      throw new Error(
        `Expected exactly one seeded preventive occurrence; found ${occurrenceCount}`,
      );
    }
    await workOrders
      .updateOne(
        { plan_id: plan._id },
        { $set: { technician_id: seededUsers.get(Role.OPERATOR)!._id } },
      )
      .exec();

    console.log(
      `Synthetic UAT seed completed for isolated database ${database}.`,
    );
    console.log(
      'Created/updated synthetic users, machines, corrective work, stock, checklist, plan, and one occurrence.',
    );
  } finally {
    await app.close();
  }
}

void main().catch((error: unknown) => {
  console.error(
    'UAT staging seed failed:',
    error instanceof Error ? error.message : 'unknown error',
  );
  process.exitCode = 1;
});
