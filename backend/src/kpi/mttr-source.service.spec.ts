import { Types } from 'mongoose';
import { MttrSourceService } from './mttr-source.service';
import { MttrCalculationService } from './mttr-calculation.service';

function queryChain<T>(value: T) {
  const chain: Record<string, jest.Mock> = {};
  const query = {
    select: jest.fn().mockReturnValue(chain),
    session: jest.fn().mockReturnValue(chain),
    lean: jest.fn().mockReturnValue(chain),
    exec: jest.fn().mockResolvedValue(value),
  };
  Object.assign(chain, query);
  return chain;
}

describe('MttrSourceService', () => {
  const machineId = new Types.ObjectId();
  const technicianId = new Types.ObjectId();
  const firstWorkOrderId = new Types.ObjectId();
  const secondWorkOrderId = new Types.ObjectId();
  const thirdWorkOrderId = new Types.ObjectId();
  const preventiveOrderId = new Types.ObjectId();
  const cancelledOrderId = new Types.ObjectId();
  const incompleteOrderId = new Types.ObjectId();
  const missingEndOrderId = new Types.ObjectId();
  const negativeOrderId = new Types.ObjectId();

  let workOrderModel: { find: jest.Mock };
  let interventionReportModel: { find: jest.Mock };
  let machineModel: { find: jest.Mock };
  let userModel: { find: jest.Mock };
  let panneModel: { find: jest.Mock };
  let service: MttrSourceService;

  function workOrder(
    id: Types.ObjectId,
    businessId: string,
    status: string,
    typeMaintenance: string,
  ) {
    return {
      _id: id,
      ot_id: businessId,
      machine_id: machineId,
      technician_id: technicianId,
      status,
      type_maintenance: typeMaintenance,
    };
  }

  beforeEach(() => {
    workOrderModel = { find: jest.fn().mockReturnValue(queryChain([])) };
    interventionReportModel = {
      find: jest.fn().mockReturnValue(queryChain([])),
    };
    machineModel = { find: jest.fn().mockReturnValue(queryChain([])) };
    userModel = { find: jest.fn().mockReturnValue(queryChain([])) };
    panneModel = { find: jest.fn().mockReturnValue(queryChain([])) };
    service = new MttrSourceService(
      interventionReportModel as never,
      workOrderModel as never,
      machineModel as never,
      userModel as never,
      panneModel as never,
      new MttrCalculationService(),
    );
  });

  it('returns one auditable source dataset shared by summary, months, and details', async () => {
    workOrderModel.find.mockReturnValue(
      queryChain([
        workOrder(firstWorkOrderId, 'WO-090-1', 'completed', 'corrective'),
        workOrder(secondWorkOrderId, 'WO-090-2', 'completed', 'corrective'),
        workOrder(thirdWorkOrderId, 'WO-090-3', 'completed', 'corrective'),
        workOrder(preventiveOrderId, 'WO-PREV', 'completed', 'preventive'),
        workOrder(cancelledOrderId, 'WO-CANCEL', 'cancelled', 'corrective'),
        workOrder(incompleteOrderId, 'WO-OPEN', 'in_progress', 'corrective'),
        workOrder(missingEndOrderId, 'WO-MISSING', 'completed', 'corrective'),
        workOrder(negativeOrderId, 'WO-NEGATIVE', 'completed', 'corrective'),
      ]),
    );
    interventionReportModel.find.mockReturnValue(
      queryChain([
        {
          _id: new Types.ObjectId(),
          report_id: 'IR-090-1',
          ot_id: firstWorkOrderId,
          technician_id: technicianId,
          date_debut: new Date('2026-09-01T08:00:00Z'),
          date_fin: new Date('2026-09-01T09:30:00Z'),
        },
        {
          _id: new Types.ObjectId(),
          report_id: 'IR-090-2',
          ot_id: secondWorkOrderId,
          technician_id: technicianId,
          date_debut: new Date('2026-09-02T08:00:00Z'),
          date_fin: new Date('2026-09-02T10:00:00Z'),
        },
        {
          _id: new Types.ObjectId(),
          report_id: 'IR-090-3',
          ot_id: thirdWorkOrderId,
          technician_id: technicianId,
          date_debut: new Date('2026-09-03T08:00:00Z'),
          date_fin: new Date('2026-09-03T09:00:00Z'),
        },
        {
          _id: new Types.ObjectId(),
          report_id: 'IR-PREV',
          ot_id: preventiveOrderId,
          technician_id: technicianId,
          date_debut: new Date('2026-09-04T08:00:00Z'),
          date_fin: new Date('2026-09-04T09:00:00Z'),
        },
        {
          _id: new Types.ObjectId(),
          report_id: 'IR-CANCEL',
          ot_id: cancelledOrderId,
          technician_id: technicianId,
          date_debut: new Date('2026-09-05T08:00:00Z'),
          date_fin: new Date('2026-09-05T09:00:00Z'),
        },
        {
          _id: new Types.ObjectId(),
          report_id: 'IR-OPEN',
          ot_id: incompleteOrderId,
          technician_id: technicianId,
          date_debut: new Date('2026-09-06T08:00:00Z'),
          date_fin: new Date('2026-09-06T09:00:00Z'),
        },
        {
          _id: new Types.ObjectId(),
          report_id: 'IR-MISSING',
          ot_id: missingEndOrderId,
          technician_id: technicianId,
          date_debut: new Date('2026-09-07T08:00:00Z'),
          date_fin: null,
        },
        {
          _id: new Types.ObjectId(),
          report_id: 'IR-NEGATIVE',
          ot_id: negativeOrderId,
          technician_id: technicianId,
          date_debut: new Date('2026-09-08T09:00:00Z'),
          date_fin: new Date('2026-09-08T08:00:00Z'),
        },
      ]),
    );
    machineModel.find.mockReturnValue(
      queryChain([
        {
          _id: machineId,
          machine_id: 'F024.08',
          reference: 'Braiding line',
        },
      ]),
    );
    userModel.find.mockReturnValue(
      queryChain([
        {
          _id: technicianId,
          nom_complet: 'Technician 1',
          user_id: 'T001',
        },
      ]),
    );

    const result = await service.calculate({
      year: 2026,
      machineIds: [machineId.toHexString()],
      technicianId: technicianId.toHexString(),
    });

    expect(result.summary).toEqual({
      completedRepairs: 3,
      totalRepairMinutes: 270,
      mttrMinutes: 90,
    });
    expect(result.months).toHaveLength(12);
    expect(result.months[8]).toMatchObject({
      monthIndex: 8,
      monthKey: '2026-09',
      completedRepairs: 3,
      totalRepairMinutes: 270,
      mttrMinutes: 90,
    });
    expect(result.months[1].completedRepairs).toBe(0);
    expect(result.months[1].mttrMinutes).toBeNull();
    expect(result.excluded).toEqual({
      total: 5,
      byReason: {
        missingStartEnd: 1,
        endBeforeStart: 1,
        nonCorrective: 1,
        cancelledIncomplete: 2,
        missingUnresolvableWorkOrder: 0,
      },
    });

    const details = result.months[8].repairs;
    const detailTotal = details.reduce(
      (sum, detail) => sum + detail.durationMinutes,
      0,
    );
    expect(details).toHaveLength(result.months[8].completedRepairs);
    expect(detailTotal).toBe(result.months[8].totalRepairMinutes);
    expect(detailTotal / details.length).toBe(result.months[8].mttrMinutes);
    expect(details.map((detail) => detail.workOrderId)).toEqual([
      'WO-090-1',
      'WO-090-2',
      'WO-090-3',
    ]);
    expect(details[0]).toMatchObject({
      reportId: 'IR-090-1',
      machine: { code: 'F024.08', reference: 'Braiding line' },
      technician: { name: 'Technician 1' },
    });
  });

  it('does not include a report assigned to another technician when the WorkOrder is assigned to the requested technician', async () => {
    const otherTechnicianId = new Types.ObjectId();
    workOrderModel.find.mockReturnValue(
      queryChain([
        workOrder(
          firstWorkOrderId,
          'WO-TECH-FILTER',
          'completed',
          'corrective',
        ),
      ]),
    );
    interventionReportModel.find.mockReturnValue(
      queryChain([
        {
          _id: new Types.ObjectId(),
          report_id: 'IR-OTHER-TECH',
          ot_id: firstWorkOrderId,
          technician_id: otherTechnicianId,
          date_debut: new Date('2026-09-01T08:00:00Z'),
          date_fin: new Date('2026-09-01T09:00:00Z'),
        },
      ]),
    );

    const result = await service.calculate({
      year: 2026,
      technicianId: technicianId.toHexString(),
    });

    expect(result.summary.completedRepairs).toBe(0);
    expect(result.months[8].repairs).toEqual([]);
  });

  it('counts an unresolvable WorkOrder without adding it to MTTR', async () => {
    workOrderModel.find.mockReturnValue(queryChain([]));
    const orphanReportId = new Types.ObjectId();
    interventionReportModel.find.mockReturnValue(
      queryChain([
        {
          _id: orphanReportId,
          report_id: 'IR-ORPHAN',
          ot_id: new Types.ObjectId(),
          technician_id: technicianId,
          date_debut: new Date('2026-09-01T08:00:00Z'),
          date_fin: new Date('2026-09-01T09:00:00Z'),
        },
      ]),
    );

    const result = await service.calculate({ year: 2026 });

    expect(result.summary.completedRepairs).toBe(0);
    expect(result.summary.mttrMinutes).toBeNull();
    expect(result.excluded.byReason.missingUnresolvableWorkOrder).toBe(1);
    expect(result.months[8].repairs).toEqual([]);
  });

  it('filters the MTTR source by component using the fault reference codes', async () => {
    panneModel.find.mockReturnValue(
      queryChain([{ code_panne: 'B03' }, { code_panne: 'T04' }]),
    );

    const result = await service.calculate({
      year: 2026,
      component: 'Courroie',
    });

    expect(panneModel.find).toHaveBeenCalledWith({ component: 'Courroie' });
    expect(workOrderModel.find).toHaveBeenCalledWith({
      code_panne: { $in: ['B03', 'T04'] },
    });
    expect(result.filters.component).toBe('Courroie');
  });
});
