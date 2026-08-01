import { MaintenanceSchedulingService } from './maintenance-scheduling.service';

describe('MaintenanceSchedulingService', () => {
  let service: MaintenanceSchedulingService;

  beforeEach(() => {
    service = new MaintenanceSchedulingService();
  });

  it('keeps an imported plan without a due date not scheduled', () => {
    expect(
      service.calculateOperationalStatus({
        status: 'pending',
        today: new Date('2026-07-14T08:00:00.000Z'),
      }),
    ).toBe('not_scheduled');
  });

  it('calculates monthly recurrence from the actual performed date', () => {
    expect(
      service
        .calculateNextDueDate({
          performedAt: '2026-07-14T08:00:00.000Z',
          frequency: 1,
          intervalUnit: 'mensuel',
        })
        .toISOString(),
    ).toBe('2026-08-14T08:00:00.000Z');
  });

  it('calculates daily recurrence across business midnight instead of server-local midnight', () => {
    expect(
      service
        .calculateNextDueDate({
          performedAt: '2026-07-14T23:30:00.000Z',
          frequency: 1,
          intervalUnit: 'daily',
          timezone: 'Africa/Tunis',
        })
        .toISOString(),
    ).toBe('2026-07-15T23:00:00.000Z');
  });

  it('treats date-only preventive due dates as business-timezone dates', () => {
    expect(
      service
        .calculateNextDueDate({
          performedAt: '2026-03-08',
          frequency: 1,
          intervalUnit: 'daily',
          timezone: 'America/New_York',
        })
        .toISOString(),
    ).toBe('2026-03-09T04:00:00.000Z');
  });

  it('calculates yearly recurrence from the actual performed date', () => {
    expect(
      service
        .calculateNextDueDate({
          performedAt: '2026-07-14T08:00:00.000Z',
          frequency: 1,
          intervalUnit: 'jährlich',
        })
        .toISOString(),
    ).toBe('2027-07-14T08:00:00.000Z');
  });

  it('keeps independent due-date status from real occurrences only', () => {
    expect(
      service.calculateOperationalStatus({
        status: 'pending',
        dueDate: '2026-07-10T08:00:00.000Z',
        today: new Date('2026-07-14T08:00:00.000Z'),
      }),
    ).toBe('overdue');

    expect(
      service.calculateOperationalStatus({
        status: 'waiting_validation',
        dueDate: '2026-07-10T08:00:00.000Z',
        today: new Date('2026-07-14T08:00:00.000Z'),
      }),
    ).toBe('waiting_validation');
  });

  it('uses the last valid day for end-of-month monthly recurrence', () => {
    expect(
      service
        .calculateNextDueDate({
          performedAt: '2026-01-31T08:00:00.000Z',
          frequency: 1,
          intervalUnit: 'monthly',
        })
        .toISOString(),
    ).toBe('2026-02-28T08:00:00.000Z');
  });

  it('keeps monthly recurrence stable across a DST boundary', () => {
    const result = service.calculateNextDueDate({
      performedAt: '2026-03-08T05:00:00.000Z',
      frequency: 1,
      intervalUnit: 'monthly',
      timezone: 'America/New_York',
    });
    const localParts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(result);
    const map = Object.fromEntries(
      localParts.map((part) => [part.type, part.value]),
    );
    expect(
      `${map.year}-${map.month}-${map.day} ${map.hour}:${map.minute}`,
    ).toBe('2026-04-08 00:00');
  });

  it('uses February 28 for non-leap annual recurrence from February 29', () => {
    expect(
      service
        .calculateNextDueDate({
          performedAt: '2028-02-29T08:00:00.000Z',
          frequency: 1,
          intervalUnit: 'yearly',
        })
        .toISOString(),
    ).toBe('2029-02-28T08:00:00.000Z');
  });

  describe('business-timezone-aware date boundaries', () => {
    const tz = 'Africa/Tunis'; // UTC+1, no DST

    it('computes start of day in the business timezone, not server-local/UTC', () => {
      // 2026-07-14T23:30:00Z is already 2026-07-15 00:30 in Africa/Tunis (UTC+1)
      const result = service.startOfBusinessDay(
        new Date('2026-07-14T23:30:00.000Z'),
        tz,
      );
      expect(result.toISOString()).toBe('2026-07-14T23:00:00.000Z');
    });

    it('computes end of day as the last millisecond before the next business day starts', () => {
      const result = service.endOfBusinessDay(
        new Date('2026-07-14T10:00:00.000Z'),
        tz,
      );
      expect(result.toISOString()).toBe('2026-07-14T22:59:59.999Z');
    });

    it('adds business days while re-projecting through the timezone', () => {
      const result = service.addBusinessDays(
        new Date('2026-07-14T23:30:00.000Z'),
        1,
        tz,
      );
      expect(result.toISOString()).toBe('2026-07-15T23:00:00.000Z');
    });

    it('adds business months and clamps overflowing days to the target month length', () => {
      // 2026-01-31T10:00:00Z is 2026-01-31 11:00 in Africa/Tunis (UTC+1)
      const result = service.addBusinessMonths(
        new Date('2026-01-31T10:00:00.000Z'),
        1,
        tz,
      );
      // February 2026 has only 28 days, so day-of-month clamps to the 28th
      expect(result.toISOString()).toBe('2026-02-28T10:00:00.000Z');
    });

    it('finds the Monday start of the business week', () => {
      // 2026-07-16 is a Thursday in Africa/Tunis
      const result = service.startOfBusinessWeek(
        new Date('2026-07-16T12:00:00.000Z'),
        tz,
      );
      expect(result.toISOString()).toBe('2026-07-12T23:00:00.000Z');
    });

    it('finds the first day of the business month', () => {
      const result = service.startOfBusinessMonth(
        new Date('2026-07-16T12:00:00.000Z'),
        tz,
      );
      expect(result.toISOString()).toBe('2026-06-30T23:00:00.000Z');
    });

    it('finds the first day of the business year', () => {
      const result = service.startOfBusinessYear(
        new Date('2026-07-16T12:00:00.000Z'),
        tz,
      );
      expect(result.toISOString()).toBe('2025-12-31T23:00:00.000Z');
    });

    it('defaults to BUSINESS_TIMEZONE env var, falling back to Africa/Tunis', () => {
      const previous = process.env.BUSINESS_TIMEZONE;
      delete process.env.BUSINESS_TIMEZONE;
      expect(service.getBusinessTimezone()).toBe('Africa/Tunis');
      process.env.BUSINESS_TIMEZONE = 'UTC';
      expect(service.getBusinessTimezone()).toBe('UTC');
      if (previous === undefined) {
        delete process.env.BUSINESS_TIMEZONE;
      } else {
        process.env.BUSINESS_TIMEZONE = previous;
      }
    });
  });
});
