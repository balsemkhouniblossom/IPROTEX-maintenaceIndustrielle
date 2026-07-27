import * as businessTime from './business-time';

describe('business-time', () => {
  const tz = 'Africa/Tunis'; // UTC+1, no DST

  describe('getBusinessTimezone', () => {
    it('defaults to Africa/Tunis, honoring BUSINESS_TIMEZONE when set', () => {
      const previous = process.env.BUSINESS_TIMEZONE;
      delete process.env.BUSINESS_TIMEZONE;
      expect(businessTime.getBusinessTimezone()).toBe('Africa/Tunis');

      process.env.BUSINESS_TIMEZONE = 'UTC';
      expect(businessTime.getBusinessTimezone()).toBe('UTC');

      if (previous === undefined) {
        delete process.env.BUSINESS_TIMEZONE;
      } else {
        process.env.BUSINESS_TIMEZONE = previous;
      }
    });
  });

  describe('assertValidTimezone', () => {
    it('accepts a real IANA timezone name', () => {
      expect(() => businessTime.assertValidTimezone('America/New_York')).not.toThrow();
    });

    it('throws for an unrecognized zone name', () => {
      expect(() => businessTime.assertValidTimezone('Not/A_Real_Zone')).toThrow();
    });
  });

  describe('startOfBusinessDay / endOfBusinessDay', () => {
    it('computes start of day in the business timezone, not server-local/UTC', () => {
      // 2026-07-14T23:30:00Z is already 2026-07-15 00:30 in Africa/Tunis (UTC+1)
      const result = businessTime.startOfBusinessDay(new Date('2026-07-14T23:30:00.000Z'), tz);
      expect(result.toISOString()).toBe('2026-07-14T23:00:00.000Z');
    });

    it('computes end of day as the last millisecond before the next business day starts', () => {
      const result = businessTime.endOfBusinessDay(new Date('2026-07-14T10:00:00.000Z'), tz);
      expect(result.toISOString()).toBe('2026-07-14T22:59:59.999Z');
    });

    it('defaults to the configured business timezone when none is passed', () => {
      const previous = process.env.BUSINESS_TIMEZONE;
      process.env.BUSINESS_TIMEZONE = 'Africa/Tunis';
      const result = businessTime.startOfBusinessDay(new Date('2026-07-14T23:30:00.000Z'));
      expect(result.toISOString()).toBe('2026-07-14T23:00:00.000Z');
      if (previous === undefined) {
        delete process.env.BUSINESS_TIMEZONE;
      } else {
        process.env.BUSINESS_TIMEZONE = previous;
      }
    });
  });

  describe('addBusinessDays', () => {
    it('adds business days while re-projecting through the timezone', () => {
      const result = businessTime.addBusinessDays(new Date('2026-07-14T23:30:00.000Z'), 1, tz);
      expect(result.toISOString()).toBe('2026-07-15T23:00:00.000Z');
    });

    it('subtracts days when given a negative count', () => {
      const result = businessTime.addBusinessDays(new Date('2026-07-15T23:00:00.000Z'), -1, tz);
      expect(result.toISOString()).toBe('2026-07-14T23:00:00.000Z');
    });

    it('stays correct across a DST transition (America/New_York, spring-forward)', () => {
      // 2026-03-08 is the US spring-forward date; adding one calendar day
      // from the 7th must land on the 8th at business-day-start regardless
      // of the missing clock hour.
      const result = businessTime.addBusinessDays(
        new Date('2026-03-07T05:00:00.000Z'),
        1,
        'America/New_York',
      );
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        hour12: false,
      }).formatToParts(result);
      const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
      expect(`${map.year}-${map.month}-${map.day}`).toBe('2026-03-08');
      expect(Number(map.hour) % 24).toBe(0);
    });
  });

  describe('addBusinessMonths', () => {
    it('adds business months and clamps overflowing days to the target month length', () => {
      // 2026-01-31T10:00:00Z is 2026-01-31 11:00 in Africa/Tunis (UTC+1)
      const result = businessTime.addBusinessMonths(new Date('2026-01-31T10:00:00.000Z'), 1, tz);
      // February 2026 has only 28 days, so day-of-month clamps to the 28th
      expect(result.toISOString()).toBe('2026-02-28T10:00:00.000Z');
    });

    it('subtracts months when given a negative count', () => {
      const result = businessTime.addBusinessMonths(new Date('2026-03-15T10:00:00.000Z'), -1, tz);
      expect(result.toISOString()).toBe('2026-02-15T10:00:00.000Z');
    });

    it('rolls over the year boundary', () => {
      const result = businessTime.addBusinessMonths(new Date('2026-12-15T10:00:00.000Z'), 2, tz);
      expect(result.toISOString()).toBe('2027-02-15T10:00:00.000Z');
    });
  });

  describe('startOfBusinessWeek', () => {
    it('finds the Monday start of the business week', () => {
      // 2026-07-16 is a Thursday in Africa/Tunis
      const result = businessTime.startOfBusinessWeek(new Date('2026-07-16T12:00:00.000Z'), tz);
      expect(result.toISOString()).toBe('2026-07-12T23:00:00.000Z');
    });

    it('treats a Sunday as the end of its own week (not the start of the next)', () => {
      // 2026-07-19 is a Sunday in Africa/Tunis
      const result = businessTime.startOfBusinessWeek(new Date('2026-07-19T12:00:00.000Z'), tz);
      expect(result.toISOString()).toBe('2026-07-12T23:00:00.000Z');
    });
  });

  describe('startOfBusinessMonth / startOfBusinessYear', () => {
    it('finds the first day of the business month', () => {
      const result = businessTime.startOfBusinessMonth(new Date('2026-07-16T12:00:00.000Z'), tz);
      expect(result.toISOString()).toBe('2026-06-30T23:00:00.000Z');
    });

    it('finds the first day of the business year', () => {
      const result = businessTime.startOfBusinessYear(new Date('2026-07-16T12:00:00.000Z'), tz);
      expect(result.toISOString()).toBe('2025-12-31T23:00:00.000Z');
    });
  });
});
