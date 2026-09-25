import { BadRequestException } from '@nestjs/common';
import {
  parseDeviceDate,
  validateTelemetryMetrics,
} from './telemetry-validation';

describe('telemetry validation', () => {
  it('accepts a finite, flat metric map without changing its values', () => {
    expect(
      validateTelemetryMetrics({ temperature_c: 31.5, current_a: 2.1 }),
    ).toEqual({ temperature_c: 31.5, current_a: 2.1 });
  });

  it.each([
    undefined,
    null,
    {},
    [],
    { temperature: Number.NaN },
    { temperature: Number.POSITIVE_INFINITY },
    { temperature: null },
    { temperature: { value: 20 } },
    { 'invalid metric': 20 },
  ])('rejects unsafe metric input %#', (metrics) => {
    expect(() => validateTelemetryMetrics(metrics)).toThrow(
      BadRequestException,
    );
  });

  it('rejects excessive metric cardinality', () => {
    const metrics = Object.fromEntries(
      Array.from({ length: 33 }, (_, index) => [`metric_${index}`, index]),
    );
    expect(() => validateTelemetryMetrics(metrics)).toThrow(
      'metrics cannot exceed 32 values',
    );
  });

  it('accepts ISO timestamps, omits absent timestamps, and rejects invalid ones', () => {
    expect(parseDeviceDate(undefined)).toBeUndefined();
    expect(parseDeviceDate('2026-09-25T10:30:00.000Z')?.toISOString()).toBe(
      '2026-09-25T10:30:00.000Z',
    );
    expect(() => parseDeviceDate('not-a-date')).toThrow(BadRequestException);
    expect(() => parseDeviceDate(Number.NaN)).toThrow(BadRequestException);
  });
});
