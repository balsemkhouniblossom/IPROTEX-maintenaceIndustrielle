import { Injectable } from '@nestjs/common';
import * as businessTime from '../common/business-time';

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
    const due = businessTime.startOfBusinessDay(new Date(input.dueDate));
    if (Number.isNaN(due.getTime())) return 'not_scheduled';

    const today = businessTime.startOfBusinessDay(input.today || new Date());
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
   * (often UTC) local time. Delegates to `common/business-time.ts` — the
   * single canonical implementation shared with `KpiService` and every
   * other consumer, so "today" never means two different things in two
   * different parts of the app.
   */
  getBusinessTimezone(): string {
    return businessTime.getBusinessTimezone();
  }

  startOfBusinessDay(value: Date, timeZone: string = this.getBusinessTimezone()): Date {
    return businessTime.startOfBusinessDay(value, timeZone);
  }

  endOfBusinessDay(value: Date, timeZone: string = this.getBusinessTimezone()): Date {
    return businessTime.endOfBusinessDay(value, timeZone);
  }

  addBusinessDays(
    value: Date,
    days: number,
    timeZone: string = this.getBusinessTimezone(),
  ): Date {
    return businessTime.addBusinessDays(value, days, timeZone);
  }

  addBusinessMonths(
    value: Date,
    months: number,
    timeZone: string = this.getBusinessTimezone(),
  ): Date {
    return businessTime.addBusinessMonths(value, months, timeZone);
  }

  startOfBusinessWeek(value: Date, timeZone: string = this.getBusinessTimezone()): Date {
    return businessTime.startOfBusinessWeek(value, timeZone);
  }

  startOfBusinessMonth(value: Date, timeZone: string = this.getBusinessTimezone()): Date {
    return businessTime.startOfBusinessMonth(value, timeZone);
  }

  startOfBusinessYear(value: Date, timeZone: string = this.getBusinessTimezone()): Date {
    return businessTime.startOfBusinessYear(value, timeZone);
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
