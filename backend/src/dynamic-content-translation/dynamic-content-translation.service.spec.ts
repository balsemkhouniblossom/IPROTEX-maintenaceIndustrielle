import {
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { Role } from '../schemas/user.schema';
import { DynamicContentTranslationService } from './dynamic-content-translation.service';

const execResult = <T>(value: T) => ({
  exec: jest.fn().mockResolvedValue(value),
});

const never = () => new Promise<never>(() => undefined);

function workOrder(overrides: Record<string, unknown> = {}) {
  return {
    _id: new Types.ObjectId(),
    description: 'Inspect pump PMP-22 at 25 bar',
    reschedule_reason: 'Waiting for shutdown window',
    technician_id: new Types.ObjectId(),
    lifecycle_history: [{ reason: 'Bearing vibration increased' }],
    ...overrides,
  };
}

function createService(options: {
  order?: Record<string, unknown> | null;
  cached?: Record<string, unknown> | null;
  provider?: { translate: jest.Mock };
  timeoutMs?: string;
}) {
  const order = options.order ?? workOrder();
  const workOrderModel = {
    findById: jest.fn().mockReturnValue(execResult(order)),
  };
  const cacheModel = {
    findOne: jest.fn().mockReturnValue(execResult(options.cached ?? null)),
    findOneAndUpdate: jest.fn().mockReturnValue(execResult({})),
  };
  const provider = options.provider ?? {
    translate: jest.fn().mockResolvedValue({
      translatedText: 'Inspecter la pompe PMP-22 a 25 bar',
      provider: 'gemini',
      model: 'gemini-test',
    }),
  };
  const configService = {
    get: jest.fn((key: string) =>
      key === 'DYNAMIC_TRANSLATION_TIMEOUT_MS'
        ? (options.timeoutMs ?? '3500')
        : undefined,
    ),
  };

  const service = new DynamicContentTranslationService(
    workOrderModel as never,
    cacheModel as never,
    provider as never,
    configService as never,
  );
  return { service, workOrderModel, cacheModel, provider, order };
}

describe('DynamicContentTranslationService', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('returns original content without cache or Gemini when locales match', async () => {
    const { service, cacheModel, provider, order } = createService({});

    const response = await service.batch(
      { userId: 'admin-id', role: Role.ADMIN },
      {
        sourceLocale: 'en',
        targetLocale: 'en',
        items: [
          {
            entityType: 'workOrder',
            entityId: String(order._id),
            fields: ['description'],
          },
        ],
      },
    );

    expect(response.items[0]).toMatchObject({
      field: 'description',
      translatedText: order.description,
      status: 'original',
      automaticallyTranslated: false,
    });
    expect(cacheModel.findOne).not.toHaveBeenCalled();
    expect(provider.translate).not.toHaveBeenCalled();
  });

  it('allows the assigned work-order owner and rejects unrelated users', async () => {
    const ownerId = new Types.ObjectId();
    const order = workOrder({ technician_id: ownerId });
    const allowed = createService({ order });
    await expect(
      allowed.service.batch(
        { userId: ownerId.toHexString(), role: Role.TECHNICIAN },
        {
          targetLocale: 'fr',
          items: [
            {
              entityType: 'workOrder',
              entityId: String(order._id),
              fields: ['description'],
            },
          ],
        },
      ),
    ).resolves.toHaveProperty('items');

    const denied = createService({ order });
    await expect(
      denied.service.batch(
        { userId: new Types.ObjectId().toHexString(), role: Role.TECHNICIAN },
        {
          targetLocale: 'fr',
          items: [
            {
              entityType: 'workOrder',
              entityId: String(order._id),
              fields: ['description'],
            },
          ],
        },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects fields outside the work-order translation allowlist', async () => {
    const { service, provider, order } = createService({});

    await expect(
      service.batch(
        { userId: 'admin-id', role: Role.ADMIN },
        {
          targetLocale: 'fr',
          items: [
            {
              entityType: 'workOrder',
              entityId: String(order._id),
              fields: ['code_panne' as never],
            },
          ],
        },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(provider.translate).not.toHaveBeenCalled();
  });

  it('reuses cached translations by entity, field, target locale and source hash', async () => {
    const order = workOrder();
    const { service, provider } = createService({
      order,
      cached: {
        translatedText: 'Inspection mise en cache',
        provider: 'gemini',
        model: 'gemini-test',
      },
    });

    const response = await service.batch(
      { userId: 'admin-id', role: Role.ADMIN },
      {
        targetLocale: 'fr',
        items: [
          {
            entityType: 'workOrder',
            entityId: String(order._id),
            fields: ['description'],
          },
        ],
      },
    );

    expect(response.items[0]).toMatchObject({
      translatedText: 'Inspection mise en cache',
      status: 'cache_hit',
      automaticallyTranslated: true,
      safetyNotice: true,
    });
    expect(provider.translate).not.toHaveBeenCalled();
  });

  it('generates and caches missing translations without overwriting source fields', async () => {
    const order = workOrder();
    const { service, cacheModel } = createService({ order });

    const response = await service.batch(
      { userId: 'admin-id', role: Role.ADMIN },
      {
        targetLocale: 'fr',
        items: [
          {
            entityType: 'workOrder',
            entityId: String(order._id),
            fields: ['description'],
          },
        ],
      },
    );

    expect(response.items[0]).toMatchObject({
      originalText: order.description,
      status: 'translated',
      provider: 'gemini',
      model: 'gemini-test',
    });
    expect(cacheModel.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'workOrder',
        entityId: String(order._id),
        field: 'description',
        targetLocale: 'fr',
      }),
      expect.objectContaining({
        $setOnInsert: expect.objectContaining({
          translatedText: 'Inspecter la pompe PMP-22 a 25 bar',
        }),
      }),
      expect.objectContaining({ upsert: true }),
    );
    expect(order.description).toBe('Inspect pump PMP-22 at 25 bar');
  });

  it('uses a different source hash after source content changes', async () => {
    const first = workOrder({ description: 'First text' });
    const second = { ...first, description: 'Changed text' };
    const { service, workOrderModel, cacheModel } = createService({
      order: first,
    });
    workOrderModel.findById
      .mockReturnValueOnce(execResult(first))
      .mockReturnValueOnce(execResult(second));

    for (const order of [first, second]) {
      await service.batch(
        { userId: 'admin-id', role: Role.ADMIN },
        {
          targetLocale: 'fr',
          items: [
            {
              entityType: 'workOrder',
              entityId: String(order._id),
              fields: ['description'],
            },
          ],
        },
      );
    }

    const hashes = cacheModel.findOne.mock.calls.map(
      ([query]) => query.sourceHash,
    );
    expect(hashes[0]).toBeDefined();
    expect(hashes[1]).toBeDefined();
    expect(hashes[0]).not.toBe(hashes[1]);
  });

  it('enforces batch and expanded field-result limits', async () => {
    const { service } = createService({});
    await expect(
      service.batch(
        { userId: 'admin-id', role: Role.ADMIN },
        {
          targetLocale: 'fr',
          items: Array.from({ length: 26 }, () => ({
            entityType: 'workOrder' as const,
            entityId: new Types.ObjectId().toHexString(),
            fields: ['description' as const],
          })),
        },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    const noisy = workOrder({
      lifecycle_history: Array.from({ length: 76 }, (_, index) => ({
        reason: `Reason ${index}`,
      })),
    });
    await expect(
      createService({ order: noisy }).service.batch(
        { userId: 'admin-id', role: Role.ADMIN },
        {
          targetLocale: 'fr',
          items: [
            {
              entityType: 'workOrder',
              entityId: String(noisy._id),
              fields: ['lifecycle_history.reason'],
            },
          ],
        },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('falls back when Gemini omits protected technical tokens', async () => {
    const order = workOrder({
      description: 'Check FAULT-77 on PMP-22 at 25 bar using guide.pdf',
    });
    const provider = {
      translate: jest.fn().mockResolvedValue({
        translatedText: 'Verifier la pompe',
        provider: 'gemini',
        model: 'gemini-test',
      }),
    };
    const { service, cacheModel } = createService({ order, provider });

    const response = await service.batch(
      { userId: 'admin-id', role: Role.ADMIN },
      {
        targetLocale: 'fr',
        items: [
          {
            entityType: 'workOrder',
            entityId: String(order._id),
            fields: ['description'],
          },
        ],
      },
    );

    expect(provider.translate.mock.calls[0][0].protectedTokens).toEqual(
      expect.arrayContaining(['FAULT-77', 'PMP-22', '25 bar', 'guide.pdf']),
    );
    expect(response.items[0]).toMatchObject({
      translatedText: order.description,
      status: 'fallback',
      automaticallyTranslated: false,
    });
    expect(cacheModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('falls back for disabled, timeout and malformed provider results', async () => {
    const scenarios = [
      {
        provider: {
          translate: jest.fn().mockRejectedValue(new Error('disabled')),
        },
      },
      {
        provider: { translate: jest.fn().mockRejectedValue('disabled') },
      },
      {
        provider: { translate: jest.fn().mockRejectedValue(503) },
      },
      {
        provider: { translate: jest.fn().mockRejectedValue(false) },
      },
      {
        provider: { translate: jest.fn().mockRejectedValue(1n) },
      },
      {
        provider: { translate: jest.fn().mockRejectedValue({ code: 'boom' }) },
      },
      {
        provider: { translate: jest.fn().mockImplementation(never) },
        timeoutMs: '1',
      },
      {
        provider: {
          translate: jest.fn().mockResolvedValue({
            translatedText: '',
            provider: 'gemini',
            model: 'gemini-test',
          }),
        },
      },
      {
        provider: {
          translate: jest.fn().mockResolvedValue({
            translatedText: 'x'.repeat(5000),
            provider: 'gemini',
            model: 'gemini-test',
          }),
        },
      },
    ];

    for (const scenario of scenarios) {
      const order = workOrder();
      const { service } = createService({ ...scenario, order });
      const response = await service.batch(
        { userId: 'admin-id', role: Role.ADMIN },
        {
          targetLocale: 'fr',
          items: [
            {
              entityType: 'workOrder',
              entityId: String(order._id),
              fields: ['description'],
            },
          ],
        },
      );
      expect(response.items[0]).toMatchObject({
        translatedText: order.description,
        status: 'fallback',
      });
    }
  });

  it('extracts protected technical tokens with punctuation, URLs, email, files, and decimal units', async () => {
    const order = workOrder({
      description:
        '  Check (FAULT-77), "PMP-22"; contact ops@example.com via https://example.com/a using manual.DOCX at 12,5 °C and ignore 12.3.4 m.',
    });
    const provider = {
      translate: jest.fn().mockResolvedValue({
        translatedText:
          'Check FAULT-77 PMP-22 ops@example.com https://example.com/a manual.DOCX 12,5 °C',
        provider: 'gemini',
        model: 'gemini-test',
      }),
    };
    const { service } = createService({ order, provider });

    await service.batch(
      { userId: 'admin-id', role: Role.ADMIN },
      {
        targetLocale: 'fr',
        items: [
          {
            entityType: 'workOrder',
            entityId: String(order._id),
            fields: ['description'],
          },
        ],
      },
    );

    expect(provider.translate.mock.calls[0][0].protectedTokens).toEqual(
      expect.arrayContaining([
        'FAULT-77',
        'PMP-22',
        'ops@example.com',
        'https://example.com/a',
        'manual.DOCX',
        '12,5 °C',
      ]),
    );
    expect(provider.translate.mock.calls[0][0].protectedTokens).not.toContain(
      '12.3.4 m',
    );
  });

  it('extracts only actual work-order free-text fields implemented in phase 2', async () => {
    const order = workOrder();
    const { service } = createService({ order });

    const response = await service.batch(
      { userId: 'admin-id', role: Role.ADMIN },
      {
        targetLocale: 'fr',
        items: [
          {
            entityType: 'workOrder',
            entityId: String(order._id),
            fields: [
              'description',
              'reschedule_reason',
              'lifecycle_history.reason',
            ],
          },
        ],
      },
    );

    expect(response.items.map((item) => item.field)).toEqual([
      'description',
      'reschedule_reason',
      'lifecycle_history.0.reason',
    ]);
  });

  it('rejects an unsupported target or source locale', async () => {
    const { service, order } = createService({});

    await expect(
      service.batch(
        { userId: 'admin-id', role: Role.ADMIN },
        {
          targetLocale: 'xx' as never,
          items: [
            {
              entityType: 'workOrder',
              entityId: String(order._id),
              fields: ['description'],
            },
          ],
        },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      service.batch(
        { userId: 'admin-id', role: Role.ADMIN },
        {
          targetLocale: 'fr',
          sourceLocale: 'zz' as never,
          items: [
            {
              entityType: 'workOrder',
              entityId: String(order._id),
              fields: ['description'],
            },
          ],
        },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('returns an empty result for an empty batch without touching the database', async () => {
    const { service, workOrderModel } = createService({});

    const response = await service.batch(
      { userId: 'admin-id', role: Role.ADMIN },
      { targetLocale: 'fr', items: [] },
    );

    expect(response).toEqual({ items: [] });
    expect(workOrderModel.findById).not.toHaveBeenCalled();
  });

  it('rejects an entityType other than workOrder', async () => {
    const { service, order } = createService({});

    await expect(
      service.batch(
        { userId: 'admin-id', role: Role.ADMIN },
        {
          targetLocale: 'fr',
          items: [
            {
              entityType: 'machine' as never,
              entityId: String(order._id),
              fields: ['description'],
            },
          ],
        },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an entityId that is not a valid ObjectId', async () => {
    const { service } = createService({});

    await expect(
      service.batch(
        { userId: 'admin-id', role: Role.ADMIN },
        {
          targetLocale: 'fr',
          items: [
            {
              entityType: 'workOrder',
              entityId: 'not-an-object-id',
              fields: ['description'],
            },
          ],
        },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('treats a missing work order as inaccessible rather than not found', async () => {
    const { service, workOrderModel } = createService({});
    workOrderModel.findById.mockReturnValue(execResult(null));

    await expect(
      service.batch(
        { userId: 'admin-id', role: Role.ADMIN },
        {
          targetLocale: 'fr',
          items: [
            {
              entityType: 'workOrder',
              entityId: new Types.ObjectId().toHexString(),
              fields: ['description'],
            },
          ],
        },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('resolves a populated technician_id reference for owner access checks', async () => {
    const ownerId = new Types.ObjectId();
    const order = workOrder({ technician_id: { _id: ownerId } });
    const { service } = createService({ order });

    await expect(
      service.batch(
        { userId: ownerId.toHexString(), role: Role.TECHNICIAN },
        {
          targetLocale: 'fr',
          items: [
            {
              entityType: 'workOrder',
              entityId: String(order._id),
              fields: ['description'],
            },
          ],
        },
      ),
    ).resolves.toHaveProperty('items');
  });

  it('deduplicates repeated field requests for the same entity within a batch', async () => {
    const order = workOrder();
    const { service, provider } = createService({ order });

    const response = await service.batch(
      { userId: 'admin-id', role: Role.ADMIN },
      {
        targetLocale: 'fr',
        items: [
          {
            entityType: 'workOrder',
            entityId: String(order._id),
            fields: ['description'],
          },
          {
            entityType: 'workOrder',
            entityId: String(order._id),
            fields: ['description'],
          },
        ],
      },
    );

    expect(response.items).toHaveLength(1);
    expect(provider.translate).toHaveBeenCalledTimes(1);
  });

  it('skips blank description and reschedule_reason fields', async () => {
    const order = workOrder({ description: '   ', reschedule_reason: '' });
    const { service } = createService({ order });

    const response = await service.batch(
      { userId: 'admin-id', role: Role.ADMIN },
      {
        targetLocale: 'fr',
        items: [
          {
            entityType: 'workOrder',
            entityId: String(order._id),
            fields: ['description', 'reschedule_reason'],
          },
        ],
      },
    );

    expect(response.items).toEqual([]);
  });
});
