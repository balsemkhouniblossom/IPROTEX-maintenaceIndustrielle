import { Injectable } from '@nestjs/common';

export type CanonicalFrequency =
  | 'DAILY'
  | 'WEEKLY'
  | 'MONTHLY'
  | 'QUARTERLY'
  | 'SEMIANNUAL'
  | 'YEARLY'
  | 'CUSTOM';

export type OperationalStatus =
  | 'not_scheduled'
  | 'scheduled'
  | 'due_soon'
  | 'due_today'
  | 'in_progress'
  | 'waiting_validation'
  | 'returned'
  | 'completed'
  | 'validated'
  | 'cancelled'
  | 'overdue';

interface NextDueInput {
  performedAt: Date | string;
  frequency?: number;
  intervalValue?: number;
  intervalUnit?: string;
  timezone?: string;
}

interface StatusInput {
  status?: string;
  dueDate?: Date | string | null;
  today?: Date;
  frequency?: number;
  intervalUnit?: string;
}

@Injectable()
export class MaintenanceSchedulingService {
  normalizeFrequency(value?: string): CanonicalFrequency {
    const raw = (value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[ä]/g, 'a')
      .replace(/[ö]/g, 'o')
      .replace(/[ü]/g, 'u')
      .replace(/[àáâã]/g, 'a')
      .replace(/[éèêë]/g, 'e')
      .replace(/[íìîï]/g, 'i')
      .replace(/[óòôõ]/g, 'o')
      .replace(/[úùû]/g, 'u')
      .replace(/\s+/g, ' ')
      .trim();

    if (!raw) return 'MONTHLY';
    if (
      /\b(daily|every day|quotidien|chaque jour|taglich|jour|day)\b/.test(raw)
    ) {
      return 'DAILY';
    }
    if (
      /\b(weekly|every week|hebdomadaire|chaque semaine|wochentlich|week|semaine)\b/.test(
        raw,
      )
    ) {
      return 'WEEKLY';
    }
    if (
      /\b(quarterly|every three months|tous les trois mois|trimestriel|vierteljahrlich)\b/.test(
        raw,
      ) ||
      (/3/.test(raw) && /(month|mois|monat)/.test(raw))
    ) {
      return 'QUARTERLY';
    }
    if (
      /\b(every six months|twice per year|semestriel|tous les six mois|halbjahrlich)\b/.test(
        raw,
      ) ||
      (/6/.test(raw) && /(month|mois|monat)/.test(raw))
    ) {
      return 'SEMIANNUAL';
    }
    if (
      /\b(yearly|annually|once per year|1 x per year|1 x par an|annuel|1 x pro jahr|jahrlich|year|an|jahr)\b/.test(
        raw,
      )
    ) {
      return 'YEARLY';
    }
    if (
      /\b(monthly|once per month|1 x per month|1 x par mois|mensuel|1 x pro monat|monatlich|month|mois|monat)\b/.test(
        raw,
      )
    ) {
      return 'MONTHLY';
    }
    return 'CUSTOM';
  }

  calculateNextDueDate(input: NextDueInput): Date {
    const base = new Date(input.performedAt);
    if (Number.isNaN(base.getTime())) {
      throw new Error('Invalid performedAt date');
    }

    const value =
      input.intervalValue && input.intervalValue > 0
        ? input.intervalValue
        : input.frequency && input.frequency > 0
          ? input.frequency
          : 1;

    const frequency = this.normalizeFrequency(input.intervalUnit);

    if (frequency === 'DAILY') return this.addDays(base, value);
    if (frequency === 'WEEKLY') return this.addDays(base, value * 7);
    if (frequency === 'MONTHLY') return this.addMonths(base, value);
    if (frequency === 'QUARTERLY') return this.addMonths(base, value * 3);
    if (frequency === 'SEMIANNUAL') return this.addMonths(base, value * 6);
    if (frequency === 'YEARLY') return this.addYears(base, value);

    return this.addMonths(base, value);
  }

  calculateOperationalStatus(input: StatusInput): OperationalStatus {
    const status = (input.status || '').toLowerCase();
    if (status === 'completed') return 'completed';
    if (status === 'validated') return 'validated';
    if (status === 'cancelled' || status === 'canceled') return 'cancelled';
    if (status === 'waiting_validation') return 'waiting_validation';
    if (status === 'returned' || status === 'waiting_correction') {
      return 'returned';
    }
    if (status === 'in_progress') return 'in_progress';

    if (!input.dueDate) return 'not_scheduled';
    const due = this.startOfLocalDay(new Date(input.dueDate));
    if (Number.isNaN(due.getTime())) return 'not_scheduled';

    const today = this.startOfLocalDay(input.today || new Date());
    const diffDays = Math.floor((due.getTime() - today.getTime()) / 86400000);
    if (diffDays < 0) return 'overdue';
    if (diffDays === 0) return 'due_today';
    if (diffDays <= this.reminderWindowDays(input.intervalUnit)) {
      return 'due_soon';
    }
    return 'scheduled';
  }

  startOfLocalDay(value: Date): Date {
    const date = new Date(value);
    date.setHours(0, 0, 0, 0);
    return date;
  }

  /**
   * The IANA timezone the business operates in, used to compute calendar
   * day/week/month/year boundaries that match what an Operator on-site
   * actually experiences as "today", rather than the server host's own
   * (often UTC) local time.
   */
  getBusinessTimezone(): string {
    return process.env.BUSINESS_TIMEZONE || 'Africa/Tunis';
  }

  private zonedParts(date: Date, timeZone: string) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).formatToParts(date);
    const map: Record<string, string> = {};
    for (const part of parts) {
      map[part.type] = part.value;
    }
    return {
      year: Number(map.year),
      month: Number(map.month),
      day: Number(map.day),
      hour: map.hour === '24' ? 0 : Number(map.hour),
      minute: Number(map.minute),
      second: Number(map.second),
    };
  }

  private zonedWallTimeToUtc(
    year: number,
    month: number,
    day: number,
    hour: number,
    minute: number,
    second: number,
    timeZone: string,
  ): Date {
    const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second);
    const seenBackInZone = this.zonedParts(new Date(utcGuess), timeZone);
    const seenAsUtc = Date.UTC(
      seenBackInZone.year,
      seenBackInZone.month - 1,
      seenBackInZone.day,
      seenBackInZone.hour,
      seenBackInZone.minute,
      seenBackInZone.second,
    );
    return new Date(utcGuess - (seenAsUtc - utcGuess));
  }

  startOfBusinessDay(value: Date, timeZone: string = this.getBusinessTimezone()): Date {
    const { year, month, day } = this.zonedParts(value, timeZone);
    return this.zonedWallTimeToUtc(year, month, day, 0, 0, 0, timeZone);
  }

  endOfBusinessDay(value: Date, timeZone: string = this.getBusinessTimezone()): Date {
    return new Date(
      this.addBusinessDays(this.startOfBusinessDay(value, timeZone), 1, timeZone).getTime() - 1,
    );
  }

  addBusinessDays(
    value: Date,
    days: number,
    timeZone: string = this.getBusinessTimezone(),
  ): Date {
    const { year, month, day } = this.zonedParts(value, timeZone);
    // Do the day-count arithmetic at noon UTC (well clear of any DST
    // transition) before re-projecting through the target timezone, so the
    // calendar-day shift stays correct across month/year boundaries.
    const shifted = new Date(Date.UTC(year, month - 1, day + days, 12));
    const parts = this.zonedParts(shifted, timeZone);
    return this.zonedWallTimeToUtc(
      parts.year,
      parts.month,
      parts.day,
      0,
      0,
      0,
      timeZone,
    );
  }

  addBusinessMonths(
    value: Date,
    months: number,
    timeZone: string = this.getBusinessTimezone(),
  ): Date {
    const { year, month, day, hour, minute, second } = this.zonedParts(
      value,
      timeZone,
    );
    const totalMonths = month - 1 + months;
    const targetYear = year + Math.floor(totalMonths / 12);
    const targetMonth = ((totalMonths % 12) + 12) % 12;
    const daysInTargetMonth = new Date(
      Date.UTC(targetYear, targetMonth + 1, 0),
    ).getUTCDate();
    const clampedDay = Math.min(day, daysInTargetMonth);
    return this.zonedWallTimeToUtc(
      targetYear,
      targetMonth + 1,
      clampedDay,
      hour,
      minute,
      second,
      timeZone,
    );
  }

  startOfBusinessWeek(value: Date, timeZone: string = this.getBusinessTimezone()): Date {
    const dayStart = this.startOfBusinessDay(value, timeZone);
    const weekdayName = new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'short',
    }).format(dayStart);
    const weekdayIndex: Record<string, number> = {
      Sun: 0,
      Mon: 1,
      Tue: 2,
      Wed: 3,
      Thu: 4,
      Fri: 5,
      Sat: 6,
    };
    const day = weekdayIndex[weekdayName] ?? 0;
    const diff = day === 0 ? -6 : 1 - day;
    return this.addBusinessDays(dayStart, diff, timeZone);
  }

  startOfBusinessMonth(value: Date, timeZone: string = this.getBusinessTimezone()): Date {
    const { year, month } = this.zonedParts(value, timeZone);
    return this.zonedWallTimeToUtc(year, month, 1, 0, 0, 0, timeZone);
  }

  startOfBusinessYear(value: Date, timeZone: string = this.getBusinessTimezone()): Date {
    const { year } = this.zonedParts(value, timeZone);
    return this.zonedWallTimeToUtc(year, 1, 1, 0, 0, 0, timeZone);
  }

  private reminderWindowDays(unit?: string): number {
    const frequency = this.normalizeFrequency(unit);
    if (frequency === 'DAILY') return 0;
    if (frequency === 'WEEKLY') return 2;
    if (frequency === 'YEARLY') return 30;
    if (frequency === 'QUARTERLY' || frequency === 'SEMIANNUAL') return 14;
    return 7;
  }

  private addDays(value: Date, days: number): Date {
    const result = new Date(value);
    result.setDate(result.getDate() + days);
    return result;
  }

  private addMonths(value: Date, months: number): Date {
    const result = new Date(value);
    const originalDay = result.getDate();
    result.setDate(1);
    result.setMonth(result.getMonth() + months);
    const lastDay = new Date(
      result.getFullYear(),
      result.getMonth() + 1,
      0,
    ).getDate();
    result.setDate(Math.min(originalDay, lastDay));
    return result;
  }

  private addYears(value: Date, years: number): Date {
    const result = new Date(value);
    const originalMonth = result.getMonth();
    const originalDay = result.getDate();
    result.setFullYear(result.getFullYear() + years, originalMonth, 1);
    const lastDay = new Date(
      result.getFullYear(),
      originalMonth + 1,
      0,
    ).getDate();
    result.setDate(Math.min(originalDay, lastDay));
    return result;
  }
}
