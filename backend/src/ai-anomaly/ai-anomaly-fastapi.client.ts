import {
  BadGatewayException,
  BadRequestException,
  GatewayTimeoutException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AiAnomalyFastApiPayload,
  AiAnomalyFastApiResult,
  AiAnomalyFastApiResults,
  AiAnomalyModelMetadata,
} from './ai-anomaly.types';

const DEFAULT_AI_SERVICE_URL = 'http://127.0.0.1:8011';
const DEFAULT_AI_SERVICE_TIMEOUT_MS = 12000;

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertFiniteNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new BadGatewayException(`AI service returned invalid ${field}`);
  }
  return value;
}

function assertString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new BadGatewayException(`AI service returned invalid ${field}`);
  }
  return value;
}

function assertBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    throw new BadGatewayException(`AI service returned invalid ${field}`);
  }
  return value;
}

function validateResult(value: unknown): AiAnomalyFastApiResult {
  if (!isObject(value)) {
    throw new BadGatewayException('AI service returned an invalid result');
  }

  const componentScores = value.componentScores;
  if (!isObject(componentScores)) {
    throw new BadGatewayException(
      'AI service returned invalid componentScores',
    );
  }

  if (
    !Array.isArray(value.reasonCodes) ||
    !value.reasonCodes.every((code) => typeof code === 'string')
  ) {
    throw new BadGatewayException('AI service returned invalid reasonCodes');
  }

  return {
    modelVersion: assertString(value.modelVersion, 'modelVersion'),
    experiment: assertString(value.experiment, 'experiment'),
    timestamp: assertString(value.timestamp, 'timestamp'),
    bearing: assertFiniteNumber(value.bearing, 'bearing'),
    anomalyScore: assertFiniteNumber(value.anomalyScore, 'anomalyScore'),
    riskScore: assertFiniteNumber(value.riskScore, 'riskScore'),
    riskLevel: assertString(value.riskLevel, 'riskLevel'),
    rawAnomaly: assertBoolean(value.rawAnomaly, 'rawAnomaly'),
    persistentAlert: assertBoolean(value.persistentAlert, 'persistentAlert'),
    componentScores: {
      zScore: assertFiniteNumber(
        componentScores.zScore,
        'componentScores.zScore',
      ),
      isolationForest: assertFiniteNumber(
        componentScores.isolationForest,
        'componentScores.isolationForest',
      ),
    },
    reasonCodes: value.reasonCodes,
    prototypeResult: assertBoolean(value.prototypeResult, 'prototypeResult'),
  };
}

function validateResults(value: unknown): AiAnomalyFastApiResults {
  if (!isObject(value) || !Array.isArray(value.results)) {
    throw new BadGatewayException('AI service returned an invalid response');
  }

  return { results: value.results.map(validateResult) };
}

function validateModelMetadata(value: unknown): AiAnomalyModelMetadata {
  if (!isObject(value) || !Array.isArray(value.models)) {
    throw new BadGatewayException('AI service returned invalid model metadata');
  }

  const models: unknown[] = value.models;
  if (!models.length || !models.every(isObject)) {
    throw new BadGatewayException('AI service returned no model metadata');
  }

  return {
    models: models.map((model) => ({
      id: assertString(model.id, 'id'),
      name: assertString(model.name, 'name'),
      task: assertString(model.task, 'task'),
      purpose: assertString(model.purpose, 'purpose'),
      modelVersion: assertString(model.modelVersion, 'modelVersion'),
      artifactVersion:
        typeof model.artifactVersion === 'string'
          ? model.artifactVersion
          : undefined,
      selectedMethod:
        typeof model.selectedMethod === 'string'
          ? model.selectedMethod
          : undefined,
      sourceDataset: assertString(model.sourceDataset, 'sourceDataset'),
      validatedExperiments: Array.isArray(model.validatedExperiments)
        ? model.validatedExperiments.filter(
            (item): item is string => typeof item === 'string',
          )
        : [],
      validationScope: assertString(model.validationScope, 'validationScope'),
      generalizationStatus: assertString(
        model.generalizationStatus,
        'generalizationStatus',
      ),
      featureOrder: Array.isArray(model.featureOrder)
        ? model.featureOrder.filter(
            (item): item is string => typeof item === 'string',
          )
        : [],
      framework: assertString(model.framework, 'framework'),
      loaded: assertBoolean(model.loaded, 'loaded'),
      enabled: assertBoolean(model.enabled, 'enabled'),
      running: assertBoolean(model.running, 'running'),
      status: assertString(model.status, 'status') as never,
      activeExecutions: assertFiniteNumber(
        model.activeExecutions,
        'activeExecutions',
      ),
      lastExecutionAt:
        typeof model.lastExecutionAt === 'string'
          ? model.lastExecutionAt
          : undefined,
      lastExecutionDurationMs:
        typeof model.lastExecutionDurationMs === 'number'
          ? model.lastExecutionDurationMs
          : undefined,
      lastError:
        typeof model.lastError === 'string' ? model.lastError : undefined,
    })),
  };
}

@Injectable()
export class AiAnomalyFastApiClient {
  private readonly logger = new Logger(AiAnomalyFastApiClient.name);

  constructor(private readonly configService: ConfigService) {}

  isEnabled(): boolean {
    return parseBoolean(
      this.configService.get<string>('AI_SERVICE_ENABLED'),
      false,
    );
  }

  async getModels(): Promise<AiAnomalyModelMetadata> {
    const response = await this.request('/v1/models', {
      method: 'GET',
      idempotent: true,
    });
    return validateModelMetadata(response);
  }

  async startModel(modelId: string) {
    return this.request(`/v1/models/${encodeURIComponent(modelId)}/start`, {
      method: 'POST',
      idempotent: true,
    });
  }

  async stopModel(modelId: string) {
    return this.request(`/v1/models/${encodeURIComponent(modelId)}/stop`, {
      method: 'POST',
      idempotent: true,
    });
  }

  async analyze(
    payload: AiAnomalyFastApiPayload,
  ): Promise<AiAnomalyFastApiResults> {
    const response = await this.request('/v1/anomaly/analyze', {
      method: 'POST',
      payload,
      idempotent: false,
    });
    return validateResults(response);
  }

  async analyzeBatch(
    payload: AiAnomalyFastApiPayload,
  ): Promise<AiAnomalyFastApiResults> {
    const response = await this.request('/v1/anomaly/analyze-batch', {
      method: 'POST',
      payload,
      idempotent: true,
    });
    return validateResults(response);
  }

  private async request(
    path: string,
    options: {
      method: 'GET' | 'POST';
      payload?: AiAnomalyFastApiPayload;
      idempotent: boolean;
    },
  ): Promise<unknown> {
    if (!this.isEnabled()) {
      throw new ServiceUnavailableException('AI anomaly service is disabled');
    }

    const baseUrl =
      this.configService.get<string>('AI_SERVICE_URL')?.replace(/\/$/, '') ??
      DEFAULT_AI_SERVICE_URL;
    const timeoutMs = this.resolveTimeoutMs();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const rowCount = options.payload?.rows.length ?? 0;
    const serviceToken = this.configService
      .get<string>('AI_SERVICE_TOKEN')
      ?.trim();
    if (!serviceToken) {
      clearTimeout(timeout);
      throw new ServiceUnavailableException(
        'AI anomaly service authentication is not configured',
      );
    }

    try {
      this.logger.log(
        `Calling AI service path=${path} method=${options.method} rows=${rowCount} idempotent=${options.idempotent}`,
      );
      const response = await fetch(`${baseUrl}${path}`, {
        method: options.method,
        headers: {
          'content-type': 'application/json',
          'x-ai-service-token': serviceToken,
        },
        body: options.payload ? JSON.stringify(options.payload) : undefined,
        signal: controller.signal,
      });

      const body = await this.readJsonSafely(response);
      if (!response.ok) {
        const message = this.extractErrorMessage(body);
        if (response.status >= 400 && response.status < 500) {
          throw new BadRequestException(message);
        }
        throw new BadGatewayException(
          'AI anomaly service rejected the request',
        );
      }

      return body;
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof BadGatewayException ||
        error instanceof ServiceUnavailableException
      ) {
        throw error;
      }

      if (error instanceof Error && error.name === 'AbortError') {
        throw new GatewayTimeoutException('AI anomaly service timed out');
      }

      throw new ServiceUnavailableException(
        'AI anomaly service is unavailable',
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private resolveTimeoutMs(): number {
    const configured = this.configService.get<string>('AI_SERVICE_TIMEOUT_MS');
    const parsed = Number(configured);
    return Number.isInteger(parsed) && parsed > 0
      ? parsed
      : DEFAULT_AI_SERVICE_TIMEOUT_MS;
  }

  private async readJsonSafely(response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch {
      if (response.ok) {
        throw new BadGatewayException('AI service returned non-JSON response');
      }
      return undefined;
    }
  }

  private extractErrorMessage(body: unknown): string {
    if (isObject(body)) {
      const detail = body.detail;
      if (typeof detail === 'string') return detail;
      if (Array.isArray(detail)) return 'AI anomaly request validation failed';
      const message = body.message;
      if (typeof message === 'string') return message;
    }
    return 'AI anomaly request validation failed';
  }
}
