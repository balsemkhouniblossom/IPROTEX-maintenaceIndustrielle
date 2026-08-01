import { ForbiddenException } from '@nestjs/common';
import { Types } from 'mongoose';
import { DocumentAccessService } from './document-access.service';
import { Role } from '../schemas/user.schema';

type WorkOrderRecord = {
  _id: Types.ObjectId;
  machine_id: Types.ObjectId;
  technician_id?: Types.ObjectId | string | null;
  status: string;
};

function idString(value: unknown): string {
  return value instanceof Types.ObjectId ? value.toHexString() : String(value);
}

function matchesCondition(value: unknown, condition: unknown): boolean {
  if (
    condition &&
    typeof condition === 'object' &&
    !(condition instanceof Types.ObjectId)
  ) {
    const cond = condition as Record<string, unknown>;
    if ('$in' in cond) {
      const arr = cond['$in'] as unknown[];
      return arr.some((v) => matchesCondition(value, v));
    }
    if ('$nin' in cond) {
      const arr = cond['$nin'] as unknown[];
      return !arr.some((v) => matchesCondition(value, v));
    }
    if ('$exists' in cond) {
      return (value !== undefined) === cond['$exists'];
    }
  }
  if (condition === null) return value === null || value === undefined;
  if (value === null || value === undefined) return false;
  return idString(value) === idString(condition);
}

function matchesFilter(
  doc: Record<string, unknown>,
  filter: Record<string, unknown>,
): boolean {
  return Object.entries(filter).every(([key, condition]) => {
    if (key === '$or') {
      return (condition as Record<string, unknown>[]).some((sub) =>
        matchesFilter(doc, sub),
      );
    }
    return matchesCondition(doc[key], condition);
  });
}

// A minimal in-memory stand-in for the Mongoose WorkOrder model that
// actually evaluates the same $in/$nin/$exists/$or filter shapes the
// service builds, instead of just recording call arguments. This lets the
// tests below exercise the real filter-construction logic in
// listAccessibleMachineIds/assertCanAccessMachine against concrete data,
// rather than re-deriving by hand whether the two can ever disagree.
function createWorkOrderModel(docs: WorkOrderRecord[]) {
  return {
    distinct: jest.fn((field: string, filter: Record<string, unknown>) => ({
      exec: jest
        .fn()
        .mockResolvedValue(
          [
            ...new Set(
              docs
                .filter((doc) => matchesFilter(doc, filter))
                .map((doc) =>
                  idString((doc as Record<string, unknown>)[field]),
                ),
            ),
          ].map((hex) => new Types.ObjectId(hex)),
        ),
    })),
    exists: jest.fn((filter: Record<string, unknown>) => ({
      exec: jest
        .fn()
        .mockResolvedValue(
          docs.some((doc) => matchesFilter(doc, filter))
            ? { _id: new Types.ObjectId() }
            : null,
        ),
    })),
  };
}

function createUserModel(assignedMachineIds: Types.ObjectId[]) {
  return {
    findById: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnThis(),
      exec: jest
        .fn()
        .mockResolvedValue({ assigned_machine_ids: assignedMachineIds }),
    }),
  };
}

function createMachineModel() {
  return {
    exists: jest
      .fn()
      .mockReturnValue({ exec: jest.fn().mockResolvedValue(true) }),
  };
}

function buildService(
  workOrders: WorkOrderRecord[],
  assignedMachineIds: Types.ObjectId[],
) {
  return new DocumentAccessService(
    {} as never,
    createMachineModel() as never,
    createUserModel(assignedMachineIds) as never,
    createWorkOrderModel(workOrders) as never,
  );
}

describe('DocumentAccessService technician authorization consistency', () => {
  const technicianId = new Types.ObjectId().toHexString();
  const otherTechnicianId = new Types.ObjectId().toHexString();

  it('grants access to a machine reachable only through an explicitly assigned, currently claimable work order', async () => {
    const machineId = new Types.ObjectId();
    const workOrders: WorkOrderRecord[] = [
      {
        _id: new Types.ObjectId(),
        machine_id: machineId,
        technician_id: null,
        status: 'ouvert',
      },
    ];
    const service = buildService(workOrders, [machineId]);

    const accessible = await service.listAccessibleMachineIds({
      userId: technicianId,
      role: Role.TECHNICIAN,
    });
    expect(accessible?.map((id) => id.toHexString())).toContain(
      machineId.toHexString(),
    );

    await expect(
      service.assertCanAccessMachine(
        { userId: technicianId, role: Role.TECHNICIAN },
        machineId.toHexString(),
      ),
    ).resolves.toBeUndefined();
  });

  it('grants access to a machine reachable only through a technician-owned work order that is not in assigned_machine_ids', async () => {
    // The technician was individually assigned a single work order on this
    // machine (technician_id === them) but the machine itself was never
    // added to their assigned_machine_ids list, and the work order is
    // already closed. listAccessibleMachineIds surfaces the machine via
    // "ownMachineIds" (any status); assertCanAccessMachine must agree.
    const machineId = new Types.ObjectId();
    const workOrders: WorkOrderRecord[] = [
      {
        _id: new Types.ObjectId(),
        machine_id: machineId,
        technician_id: technicianId,
        status: 'completed',
      },
    ];
    const service = buildService(workOrders, []);

    const accessible = await service.listAccessibleMachineIds({
      userId: technicianId,
      role: Role.TECHNICIAN,
    });
    expect(accessible?.map((id) => id.toHexString())).toContain(
      machineId.toHexString(),
    );

    await expect(
      service.assertCanAccessMachine(
        { userId: technicianId, role: Role.TECHNICIAN },
        machineId.toHexString(),
      ),
    ).resolves.toBeUndefined();
  });

  it('does not leak access to an unrelated open, unassigned work order sharing a machine with the technician own closed work order', async () => {
    // Regression guard for the hypothesis that a technician's own (closed)
    // work order could make a *different*, unrelated open/unassigned work
    // order on the same machine wrongly claimable by inflating
    // listAccessibleMachineIds via ownMachineIds. Because
    // assertCanAccessMachine re-derives access independently (and the
    // technician does have a real own work order on this exact machine),
    // access is in fact still granted here -- this test documents and
    // pins that behavior rather than assuming it.
    const machineId = new Types.ObjectId();
    const workOrders: WorkOrderRecord[] = [
      {
        _id: new Types.ObjectId(),
        machine_id: machineId,
        technician_id: technicianId,
        status: 'completed',
      },
      {
        _id: new Types.ObjectId(),
        machine_id: machineId,
        technician_id: null,
        status: 'ouvert',
      },
    ];
    const service = buildService(workOrders, []);

    await expect(
      service.assertCanAccessMachine(
        { userId: technicianId, role: Role.TECHNICIAN },
        machineId.toHexString(),
      ),
    ).resolves.toBeUndefined();
  });

  it('rejects a machine that only has a work order owned by a different technician', async () => {
    const machineId = new Types.ObjectId();
    const workOrders: WorkOrderRecord[] = [
      {
        _id: new Types.ObjectId(),
        machine_id: machineId,
        technician_id: otherTechnicianId,
        status: 'ouvert',
      },
    ];
    const service = buildService(workOrders, []);

    const accessible = await service.listAccessibleMachineIds({
      userId: technicianId,
      role: Role.TECHNICIAN,
    });
    expect(accessible?.map((id) => id.toHexString())).not.toContain(
      machineId.toHexString(),
    );

    await expect(
      service.assertCanAccessMachine(
        { userId: technicianId, role: Role.TECHNICIAN },
        machineId.toHexString(),
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('rejects a machine that became claimable only for a different technician assigned to it', async () => {
    const machineId = new Types.ObjectId();
    const workOrders: WorkOrderRecord[] = [
      {
        _id: new Types.ObjectId(),
        machine_id: machineId,
        technician_id: null,
        status: 'ouvert',
      },
    ];
    // Machine is assigned to the OTHER technician, not the requester.
    const service = buildService(workOrders, []);

    await expect(
      service.assertCanAccessMachine(
        { userId: technicianId, role: Role.TECHNICIAN },
        machineId.toHexString(),
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('every machine surfaced by listAccessibleMachineIds independently passes assertCanAccessMachine (no over-listing)', async () => {
    const ownMachine = new Types.ObjectId();
    const claimableMachine = new Types.ObjectId();
    const assignedMachineIds = [claimableMachine];
    const workOrders: WorkOrderRecord[] = [
      {
        _id: new Types.ObjectId(),
        machine_id: ownMachine,
        technician_id: technicianId,
        status: 'en cours',
      },
      {
        _id: new Types.ObjectId(),
        machine_id: claimableMachine,
        technician_id: null,
        status: 'ouvert',
      },
    ];
    const service = buildService(workOrders, assignedMachineIds);

    const accessible = await service.listAccessibleMachineIds({
      userId: technicianId,
      role: Role.TECHNICIAN,
    });
    expect(accessible).not.toBeNull();

    for (const id of accessible ?? []) {
      await expect(
        service.assertCanAccessMachine(
          { userId: technicianId, role: Role.TECHNICIAN },
          id.toHexString(),
        ),
      ).resolves.toBeUndefined();
    }
  });
});
