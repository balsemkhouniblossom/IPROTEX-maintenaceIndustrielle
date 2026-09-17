import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  ExecutionContext,
  ForbiddenException,
  RequestMethod,
} from '@nestjs/common';
import { METHOD_METADATA } from '@nestjs/common/constants';
import { RolesGuard } from '../auth/roles.guard';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { Role } from '../schemas/user.schema';
import { QualityController } from './quality.controller';
import { QualityQueryService } from './quality-query.service';

const chain = (value: unknown) => ({
  sort: () => chain(value),
  skip: () => chain(value),
  limit: () => chain(value),
  lean: () => ({ exec: async () => value }),
  exec: async () => value,
});

describe('Admin quality read API', () => {
  const catalogueModel = {
    find: jest.fn(() => chain([])),
    countDocuments: jest.fn(() => chain(0)),
    findOne: jest.fn(() => chain(null)),
  };
  const occurrenceModel = {
    find: jest.fn(() => chain([])),
    countDocuments: jest.fn(() => chain(0)),
    findById: jest.fn(() => chain(null)),
  };
  const service = new QualityQueryService(
    catalogueModel as never,
    occurrenceModel as never,
  );
  beforeEach(() => jest.clearAllMocks());

  it('declares Admin-only access at the controller boundary', () => {
    expect(new Reflector().get(ROLES_KEY, QualityController)).toEqual([
      Role.ADMIN,
    ]);
    const guard = new RolesGuard(new Reflector());
    const context = (role?: Role) =>
      ({
        getHandler: () => QualityController,
        getClass: () => QualityController,
        switchToHttp: () => ({
          getRequest: () => ({ user: role ? { role } : undefined }),
        }),
      }) as unknown as ExecutionContext;
    expect(guard.canActivate(context(Role.ADMIN))).toBe(true);
    expect(() => guard.canActivate(context(Role.OPERATOR))).toThrow(
      ForbiddenException,
    );
    expect(() => guard.canActivate(context(Role.TECHNICIAN))).toThrow(
      ForbiddenException,
    );
    expect(() => guard.canActivate(context())).toThrow(ForbiddenException);
  });

  it('keeps quality write and Product MTTR routes at the Admin-only boundary', () => {
    const methods = Object.getOwnPropertyNames(QualityController.prototype)
      .filter((name) => name !== 'constructor')
      .map((name) =>
        Reflect.getMetadata(METHOD_METADATA, QualityController.prototype[name]),
      );
    expect(methods).toHaveLength(8);
    expect(methods).toEqual([
      RequestMethod.GET,
      RequestMethod.PUT,
      RequestMethod.GET,
      RequestMethod.PUT,
      RequestMethod.GET,
      RequestMethod.GET,
      RequestMethod.GET,
      RequestMethod.GET,
    ]);
  });

  it('filters by actual calendar date rather than source sheet', async () => {
    await service.defects({
      year: '2025',
      month: '9',
      process: 'Tressage',
      defectCode: 'F201',
      source: 'HISTORICAL_IMPORT',
    });
    expect(occurrenceModel.find).toHaveBeenCalledWith({
      process: 'Tressage',
      defect_code: 'F201',
      source: 'HISTORICAL_IMPORT',
      occurrence_date: {
        $gte: new Date('2025-09-01T00:00:00.000Z'),
        $lt: new Date('2025-10-01T00:00:00.000Z'),
      },
    });
  });

  it('rejects malformed filters and identifiers', async () => {
    await expect(
      service.defects({ year: '2025', month: '13' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.defects({ defectCode: '201' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.defects({ source: 'ADMIN' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.defect('wrong-id')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.catalogueCode('201')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('returns controlled not-found responses for valid absent records', async () => {
    await expect(service.catalogueCode('F201')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(
      service.defect('507f1f77bcf86cd799439011'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
