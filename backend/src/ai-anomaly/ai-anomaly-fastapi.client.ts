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
  const firstModel = models[0];
  if (!isObject(firstModel)) {
    throw new BadGatewayException('AI service returned no model metadata');
  }

  const validatedExperiments = Array.isArray(firstModel.validatedExperiments)
    ? firstModel.validatedExperiments.filter(
        (experiment): experiment is string => typeof experiment === 'string',
      )
    : [];

  return {
    modelVersion: assertString(firstModel.modelVersion, 'modelVersion'),
    artifactVersion:
      typeof firstModel.artifactVersion === 'string'
        ? firstModel.artifactVersion
        : undefined,
    selectedMethod:
      typeof firstModel.selectedMethod === 'string'
        ? firstModel.selectedMethod
        : undefined,
    datasetOrigin: 'IMS public test-rig data',
    validatedExperiments,
    generalization: {
      secondTest: 'not established',
      thirdTest: 'not established',
      iprotex: 'not established',
    },
    limitations: [
      'Validation currently covers only 1st_test.',
      'Generalization to 2nd_test, 3rd_test, and IPROTEX is not established.',
      'prototypeResult=true denotes a deterministic prototype, not a certified industrial safety threshold.',
    ],
    runtime: isObject(firstModel.runtime) ? firstModel.runtime : undefined,
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

    try {
      this.logger.log(
        `Calling AI service path=${path} method=${options.method} rows=${rowCount} idempotent=${options.idempotent}`,
      );
      const response = await fetch(`${baseUrl}${path}`, {
        method: options.method,
        headers: { 'content-type': 'application/json' },
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
