import { BadRequestException } from '@nestjs/common';

const METRIC_NAME = /^[a-z][a-z0-9_]{0,63}$/;

export function validateTelemetryMetrics(
  value: unknown,
  maxMetrics = 32,
): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException('metrics must be an object');
  }

  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) {
    throw new BadRequestException('metrics must contain at least one value');
  }
  if (entries.length > maxMetrics) {
    throw new BadRequestException(`metrics cannot exceed ${maxMetrics} values`);
  }

  const metrics: Record<string, number> = {};
  for (const [name, metric] of entries) {
    if (!METRIC_NAME.test(name)) {
      throw new BadRequestException(`Invalid metric name: ${name}`);
    }
    if (typeof metric !== 'number' || !Number.isFinite(metric)) {
      throw new BadRequestException(`Metric ${name} must be a finite number`);
    }
    metrics[name] = metric;
  }
  return metrics;
}

export function parseDeviceDate(value: unknown): Date | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') {
    throw new BadRequestException(
      'Device timestamp must be an ISO date string',
    );
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException('Device timestamp is invalid');
  }
  return date;
}
