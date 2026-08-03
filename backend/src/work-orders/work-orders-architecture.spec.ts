import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory()
      ? tsFiles(path)
      : path.endsWith('.ts')
        ? [path]
        : [];
  });
}

describe('work-orders service architecture', () => {
  const servicesDir = join(__dirname, 'services');
  const srcDir = join(__dirname, '..');

  it('keeps extracted services from importing the WorkOrdersService facade', () => {
    for (const file of tsFiles(servicesDir)) {
      const source = readFileSync(file, 'utf8');
      expect(source).not.toContain("from '../work-orders.service'");
      expect(source).not.toContain('WorkOrdersService');
    }
  });

  it('keeps read-only query service free of notification side effects', () => {
    const source = readFileSync(
      join(servicesDir, 'work-order-query.service.ts'),
      'utf8',
    );
    expect(source).not.toContain('Notification');
    expect(source).not.toContain('createIfNotExists');
  });

  it('keeps assignment and lifecycle services free of notification side effects', () => {
    for (const fileName of [
      'work-order-assignment.service.ts',
      'work-order-lifecycle.service.ts',
    ]) {
      const source = readFileSync(join(servicesDir, fileName), 'utf8');
      expect(source).not.toContain('Notification');
      expect(source).not.toContain('notification-center');
      expect(source).not.toContain('createIfNotExists');
    }
  });

  it('keeps lifecycle policy pure from persistence and service dependencies', () => {
    const source = readFileSync(
      join(__dirname, 'work-order-lifecycle.policy.ts'),
      'utf8',
    );
    expect(source).not.toContain('@nestjs/mongoose');
    expect(source).not.toContain('mongoose');
    expect(source).not.toContain('.service');
    expect(source).not.toContain('Injectable');
  });

  it('keeps extracted services out of unrelated report and stock ownership', () => {
    const assignmentSource = readFileSync(
      join(servicesDir, 'work-order-assignment.service.ts'),
      'utf8',
    );
    const lifecycleSource = readFileSync(
      join(servicesDir, 'work-order-lifecycle.service.ts'),
      'utf8',
    );

    expect(assignmentSource).not.toContain('InterventionReport');
    expect(assignmentSource).not.toContain('Stock');
    expect(assignmentSource).not.toContain('PartRequest');
    expect(lifecycleSource).not.toContain('StockMovements');
    expect(lifecycleSource).not.toContain('PartRequest');
    expect(lifecycleSource).not.toContain('reserve');
  });

  it('keeps stock movement/ledger mutation solely owned by StockMovementsService', () => {
    const partsSource = readFileSync(
      join(servicesDir, 'work-order-parts.service.ts'),
      'utf8',
    );

    // The parts service orchestrates the part-request lifecycle but never
    // mutates Stock counters or the StockMovement ledger directly — every
    // Stock-affecting write goes through StockMovementsService.reserve /
    // cancelReservation, which owns the atomic guard and the movement
    // record.
    expect(partsSource).not.toContain('StockMovement,');
    expect(partsSource).not.toContain(
      "from '../../schemas/stock-movement.schema'",
    );
    expect(partsSource).not.toContain('$inc');
    expect(partsSource).not.toMatch(
      /stockModel\s*\.\s*(updateOne|findOneAndUpdate)/,
    );
    expect(partsSource).toContain('StockMovementsService');
  });

  it('keeps direct Work Order parts/stock orchestration out of the facade after extraction', () => {
    const facadeSource = readFileSync(
      join(__dirname, 'work-orders.service.ts'),
      'utf8',
    );

    // requestPartsForOperator/decidePartRequest must be thin delegations —
    // the facade itself must never call StockMovementsService or write to
    // PartRequest directly again.
    expect(facadeSource).not.toContain('this.stockMovementsService.reserve');
    expect(facadeSource).not.toContain(
      'this.stockMovementsService.cancelReservation',
    );
    expect(facadeSource).not.toContain('this.partRequestModel.create');
    expect(facadeSource).not.toContain(
      'this.partRequestModel.findOneAndUpdate',
    );
  });

  it('keeps report/submission orchestration solely owned by WorkOrderReportService', () => {
    const facadeSource = readFileSync(
      join(__dirname, 'work-orders.service.ts'),
      'utf8',
    );
    const reportSource = readFileSync(
      join(servicesDir, 'work-order-report.service.ts'),
      'utf8',
    );

    // createCorrectiveReportForOperator/submitPreventiveMaintenanceForOperator/
    // applyValidationAction's report-adjacent orchestration must be thin
    // delegations — the facade itself must never create an intervention
    // report directly again.
    expect(facadeSource).not.toContain('this.interventionReportModel.create');
    expect(facadeSource).not.toContain(
      'this.interventionReportModel.findByIdAndUpdate',
    );

    // The report service must reuse the canonical lifecycle owner for the
    // validation transition rather than re-implementing it: creating a
    // report with the initial 'waiting_validation' marker is fine, but it
    // may never itself decide a report/status onto a validated/rejected/
    // correction outcome — only WorkOrderLifecycleService does that.
    expect(reportSource).toContain(
      'this.lifecycleService.applyValidationAction',
    );
    expect(reportSource).not.toMatch(
      /status:\s*['"`](validated|rejected)['"`]/,
    );
    expect(reportSource).not.toMatch(
      /validation_responsable:\s*['"`](validated|rejected|request_correction)['"`]/,
    );

    // Notifications and recurrence must go through the existing canonical
    // owners, never NotificationCenterService or duplicated recurrence
    // logic directly.
    expect(reportSource).not.toContain('NotificationCenterService');
    expect(reportSource).not.toContain('buildPreventiveOccurrenceKey');
  });

  it('keeps read-only projection services free of notification and mutation side effects', () => {
    for (const fileName of [
      'work-order-calendar-query.service.ts',
      'work-order-dashboard-query.service.ts',
      'work-order-assistant-context.service.ts',
    ]) {
      const source = readFileSync(join(servicesDir, fileName), 'utf8');
      // These own a "notification cards" *read* projection (a dashboard
      // widget), so the generic 'Notification' substring would false-
      // positive on that legitimate feature name — check the actual
      // notification-sending mechanism instead.
      expect(source).not.toContain('NotificationCenterService');
      expect(source).not.toContain('WorkOrderNotificationService');
      expect(source).not.toContain('notification-center');
      expect(source).not.toContain('createIfNotExists');
      expect(source).not.toMatch(
        /workOrderModel\s*\.\s*(create|updateOne|updateMany|findOneAndUpdate|findByIdAndUpdate|deleteOne|deleteMany|findByIdAndDelete|bulkWrite)\s*\(/,
      );
    }
  });

  it('keeps the assistant-context service free of AI provider adapters', () => {
    const source = readFileSync(
      join(servicesDir, 'work-order-assistant-context.service.ts'),
      'utf8',
    );
    expect(source).not.toContain('gemini');
    expect(source).not.toContain('Gemini');
    expect(source).not.toContain('ai-assistant');
    expect(source).not.toContain('GenerativeModel');
  });

  it('keeps the dashboard query service from writing KPI documents', () => {
    const source = readFileSync(
      join(servicesDir, 'work-order-dashboard-query.service.ts'),
      'utf8',
    );
    expect(source).not.toContain('kpiModel');
    expect(source).not.toMatch(/kpiService\s*\.\s*(create|update|save)/i);
  });

  it('keeps the calendar query service from triggering preventive scheduling mutations', () => {
    const source = readFileSync(
      join(servicesDir, 'work-order-calendar-query.service.ts'),
      'utf8',
    );
    expect(source).not.toContain('WorkOrderPreventiveSchedulingService');
    expect(source).not.toContain('ensureNextPreventiveWorkOrder');
    expect(source).not.toContain('reschedulePreventiveOccurrence');
    expect(source).not.toContain('triggerScheduler');
  });

  it('keeps calendar/dashboard/assistant aggregation logic out of the facade after extraction', () => {
    const facadeSource = readFileSync(
      join(__dirname, 'work-orders.service.ts'),
      'utf8',
    );

    // The calendar-event/dashboard-widget/notification-card/corrective-
    // assistant projection builders must be fully relocated — the facade
    // itself must never re-implement any of this shaping/aggregation logic
    // again, only delegate to the owning projection service.
    expect(facadeSource).not.toContain('toCalendarEvents');
    expect(facadeSource).not.toContain('computeEventColor');
    expect(facadeSource).not.toContain('computeReminderStage');
    expect(facadeSource).not.toContain('getViewDateRange');
    expect(facadeSource).not.toContain('matchCalendarFilter');
    expect(facadeSource).not.toContain('moduleMachineFilter');
    expect(facadeSource).not.toContain('mesureCriticalAlarmCount');
    expect(facadeSource).not.toContain('stockAlertCount');
    expect(facadeSource).not.toContain('isMaintenanceDocumentType');
  });

  it('keeps the facade free of direct model persistence and Mongoose model imports', () => {
    const facadeSource = readFileSync(
      join(__dirname, 'work-orders.service.ts'),
      'utf8',
    );

    // After the final decomposition, WorkOrdersService owns zero business
    // logic — it must depend only on extracted services, never inject or
    // hold a Mongoose model itself. (It may still import a schema's plain
    // TypeScript type for a method's return-type annotation, e.g.
    // `Promise<WorkOrderDocument | null>` — that is not persistence.)
    expect(facadeSource).not.toContain('@InjectModel');
    expect(facadeSource).not.toContain("from '@nestjs/mongoose'");
    expect(facadeSource).not.toContain('Model<');
  });

  it('keeps generic command mutation confined to WorkOrderCommandService, with no independent lifecycle rules', () => {
    const source = readFileSync(
      join(servicesDir, 'work-order-command.service.ts'),
      'utf8',
    );

    // create()/update() only ever pass an externally-supplied DTO through —
    // this service must never hardcode a validation-lifecycle status
    // outcome itself (that stays WorkOrderLifecycleService's job).
    expect(source).not.toMatch(
      /\$set:\s*\{[\s\S]{0,120}status:\s*['"`](waiting_validation|validated|rejected)['"`]/,
    );
    expect(source).toContain('WorkOrderReportService');
    expect(source).toContain('WorkOrderPreventiveSchedulingService');
  });

  it('keeps the KPI write service from owning dashboard reads', () => {
    const source = readFileSync(
      join(servicesDir, 'work-order-kpi.service.ts'),
      'utf8',
    );

    expect(source).not.toMatch(/[^r]KpiService/);
    expect(source).not.toContain('getAdminDashboard');
    expect(source).not.toContain('getOperatorDashboard');
    expect(source).not.toContain('getTechnicianDashboardCounts');
    expect(source).not.toContain('computeStockAlerts');
  });

  it('keeps operator command mutation delegating to canonical lifecycle/scheduling services rather than writing status itself', () => {
    const source = readFileSync(
      join(servicesDir, 'work-order-operator-command.service.ts'),
      'utf8',
    );

    expect(source).toContain('WorkOrderLifecycleService');
    expect(source).toContain('WorkOrderPreventiveSchedulingService');
    expect(source).not.toMatch(
      /workOrderModel\s*\.\s*(findOneAndUpdate|findByIdAndUpdate|updateOne)\s*\([\s\S]{0,200}status:/,
    );
  });

  it('keeps direct Work Order status writes confined to reviewed lifecycle and creation surfaces', () => {
    const allowedStatusWriters = new Set([
      'automation/automation.scheduler.service.ts',
      'work-orders/services/work-order-assignment.service.ts',
      'work-orders/services/work-order-lifecycle.service.ts',
      'work-orders/services/work-order-preventive-scheduling.service.ts',
      'work-orders/services/work-order-report.service.ts',
      'work-orders/work-orders.controller.ts',
    ]);

    const statusWriters = tsFiles(srcDir)
      .filter((file) => !file.endsWith('.spec.ts'))
      .filter((file) => {
        const source = readFileSync(file, 'utf8');
        return containsDirectWorkOrderStatusWrite(source);
      })
      .map((file) => relative(srcDir, file).replace(/\\/g, '/'))
      .sort();

    expect(statusWriters).toEqual([...allowedStatusWriters].sort());
  });

  it('keeps preventive occurrence upserts out of the WorkOrdersService facade', () => {
    const source = readFileSync(
      join(__dirname, 'work-orders.service.ts'),
      'utf8',
    );
    expect(source).not.toContain('$setOnInsert');
    expect(source).not.toContain('preventive_occurrence_key: occurrenceKey');
    expect(source).not.toContain('buildPreventiveOccurrenceKey');
  });

  it('keeps occurrence-key construction centralized in the preventive scheduler service', () => {
    const allowed = new Set([
      'work-orders/preventive-occurrence-key.ts',
      'work-orders/services/work-order-preventive-scheduling.service.ts',
    ]);

    const builders = tsFiles(srcDir)
      .filter((file) => !file.endsWith('.spec.ts'))
      .filter((file) =>
        readFileSync(file, 'utf8').includes('buildPreventiveOccurrenceKey'),
      )
      .map((file) => relative(srcDir, file).replace(/\\/g, '/'))
      .sort();

    expect(builders).toEqual([...allowed].sort());
  });
});

function containsDirectWorkOrderStatusWrite(source: string): boolean {
  const workOrderModelStatusWrite =
    /workOrders?Model[\s\S]{0,120}\.(create|findOneAndUpdate|findByIdAndUpdate|updateOne|updateMany)[\s\S]{0,900}(status:\s*['"`]|\$set:\s*\{[\s\S]{0,240}status)/.test(
      source,
    );
  const controllerFacadeStatusWrite =
    /workOrdersService\.update\([\s\S]{0,180}status:\s*['"`]/.test(source);

  return workOrderModelStatusWrite || controllerFacadeStatusWrite;
}
