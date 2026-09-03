import {
  BadGatewayException,
  BadRequestException,
  GatewayTimeoutException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiAnomalyFastApiClient } from './ai-anomaly-fastapi.client';

describe('AiAnomalyFastApiClient', () => {
  const originalFetch = global.fetch;

  const config = (values: Record<string, string | undefined>) =>
    ({
      get: jest.fn((key: string) => values[key]),
    }) as unknown as ConfigService;

  const jsonResponse = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });

  const validResult = {
    modelVersion: '0.1.0',
    experiment: '1st_test',
    timestamp: '2003-11-15T18:18:46',
    bearing: 1,
    anomalyScore: 0.43,
    riskScore: 43,
    riskLevel: 'MONITOR',
    rawAnomaly: false,
    persistentAlert: false,
    componentScores: { zScore: 0.72, isolationForest: 0.14 },
    reasonCodes: ['ELEVATED_ROLLING_DEVIATION'],
    prototypeResult: true,
  };

  afterEach(() => {
    jest.useRealTimers();
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('rejects calls when the integration is disabled', async () => {
    const client = new AiAnomalyFastApiClient(config({}));

    await expect(client.analyze({ rows: [] })).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('validates successful anomaly responses strictly', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(jsonResponse({ results: [validResult] }));
    const client = new AiAnomalyFastApiClient(
      config({ AI_SERVICE_ENABLED: 'true', AI_SERVICE_URL: 'http://ai:8011' }),
    );

    const response = await client.analyze({ rows: [] });

    expect(response.results).toEqual([validResult]);
    expect(global.fetch).toHaveBeenCalledWith(
      'http://ai:8011/v1/anomaly/analyze',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('maps FastAPI 4xx responses to client-safe bad requests', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(jsonResponse({ detail: 'Unknown experiment' }, 422));
    const client = new AiAnomalyFastApiClient(
      config({ AI_SERVICE_ENABLED: 'true' }),
    );

    await expect(client.analyze({ rows: [] })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('maps FastAPI 5xx responses to a sanitized gateway error', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(jsonResponse({ detail: 'traceback path' }, 500));
    const client = new AiAnomalyFastApiClient(
      config({ AI_SERVICE_ENABLED: 'true' }),
    );

    await expect(client.analyze({ rows: [] })).rejects.toThrow(
      BadGatewayException,
    );
  });

  it('maps FastAPI timeouts to a client-safe timeout response', async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn((_url, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      });
    });
    const client = new AiAnomalyFastApiClient(
      config({
        AI_SERVICE_ENABLED: 'true',
        AI_SERVICE_TIMEOUT_MS: '5',
      }),
    );

    const promise = client.analyze({ rows: [] });
    jest.advanceTimersByTime(5);

    await expect(promise).rejects.toBeInstanceOf(GatewayTimeoutException);
    jest.useRealTimers();
  });

  it('rejects malformed AI service JSON without accepting partial scores', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      jsonResponse({
        results: [{ ...validResult, anomalyScore: Number.NaN }],
      }),
    );
    const client = new AiAnomalyFastApiClient(
      config({ AI_SERVICE_ENABLED: 'true' }),
    );

    await expect(client.analyze({ rows: [] })).rejects.toThrow(
      BadGatewayException,
    );
  });

  it('exposes IMS metadata limitations from the model endpoint', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      jsonResponse({
        models: [
          {
            modelVersion: '0.1.0',
            artifactVersion: 'v0_1_0',
            selectedMethod: 'weighted',
            validatedExperiments: ['1st_test'],
            runtime: { python: '3.12.5' },
          },
        ],
      }),
    );
    const client = new AiAnomalyFastApiClient(
      config({ AI_SERVICE_ENABLED: 'true' }),
    );

    await expect(client.getModels()).resolves.toMatchObject({
      datasetOrigin: 'IMS public test-rig data',
      validatedExperiments: ['1st_test'],
      generalization: {
        secondTest: 'not established',
        thirdTest: 'not established',
        iprotex: 'not established',
      },
    });
  });

  it('treats unrecognized enabled flag values as disabled by default', async () => {
    const client = new AiAnomalyFastApiClient(
      config({ AI_SERVICE_ENABLED: 'maybe' }),
    );
    expect(client.isEnabled()).toBe(false);
  });

  it('recognizes common truthy and falsy enabled flag values', () => {
    const truthy = new AiAnomalyFastApiClient(
      config({ AI_SERVICE_ENABLED: 'YES' }),
    );
    expect(truthy.isEnabled()).toBe(true);

    const falsy = new AiAnomalyFastApiClient(
      config({ AI_SERVICE_ENABLED: 'off' }),
    );
    expect(falsy.isEnabled()).toBe(false);
  });

  it('calls the analyze-batch endpoint as idempotent', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(jsonResponse({ results: [validResult] }));
    const client = new AiAnomalyFastApiClient(
      config({ AI_SERVICE_ENABLED: 'true' }),
    );

    await client.analyzeBatch({ rows: [] });

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/v1/anomaly/analyze-batch'),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('falls back to the default timeout when configured value is invalid', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(jsonResponse({ results: [validResult] }));
    const client = new AiAnomalyFastApiClient(
      config({
        AI_SERVICE_ENABLED: 'true',
        AI_SERVICE_TIMEOUT_MS: 'not-a-number',
      }),
    );

    await expect(client.analyze({ rows: [] })).resolves.toBeDefined();
  });

  it('rejects a response payload that is not a results object', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(jsonResponse({ results: 'nope' }));
    const client = new AiAnomalyFastApiClient(
      config({ AI_SERVICE_ENABLED: 'true' }),
    );

    await expect(client.analyze({ rows: [] })).rejects.toThrow(
      BadGatewayException,
    );
  });

  it('rejects a result whose componentScores is not an object', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      jsonResponse({
        results: [{ ...validResult, componentScores: 'nope' }],
      }),
    );
    const client = new AiAnomalyFastApiClient(
      config({ AI_SERVICE_ENABLED: 'true' }),
    );

    await expect(client.analyze({ rows: [] })).rejects.toThrow(
      BadGatewayException,
    );
  });

  it('rejects a result whose reasonCodes contains non-string entries', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      jsonResponse({
        results: [{ ...validResult, reasonCodes: [1, 2] }],
      }),
    );
    const client = new AiAnomalyFastApiClient(
      config({ AI_SERVICE_ENABLED: 'true' }),
    );

    await expect(client.analyze({ rows: [] })).rejects.toThrow(
      BadGatewayException,
    );
  });

  it('rejects model metadata that is missing the models array', async () => {
    global.fetch = jest.fn().mockResolvedValue(jsonResponse({}));
    const client = new AiAnomalyFastApiClient(
      config({ AI_SERVICE_ENABLED: 'true' }),
    );

    await expect(client.getModels()).rejects.toThrow(BadGatewayException);
  });

  it('rejects model metadata whose first entry is not an object', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(jsonResponse({ models: ['not-an-object'] }));
    const client = new AiAnomalyFastApiClient(
      config({ AI_SERVICE_ENABLED: 'true' }),
    );

    await expect(client.getModels()).rejects.toThrow(BadGatewayException);
  });

  it('extracts array-shaped validation error details as a generic message', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(jsonResponse({ detail: [{ msg: 'bad field' }] }, 422));
    const client = new AiAnomalyFastApiClient(
      config({ AI_SERVICE_ENABLED: 'true' }),
    );

    await expect(client.analyze({ rows: [] })).rejects.toThrow(
      'AI anomaly request validation failed',
    );
  });

  it('falls back to a message field when detail is absent', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(jsonResponse({ message: 'nope' }, 400));
    const client = new AiAnomalyFastApiClient(
      config({ AI_SERVICE_ENABLED: 'true' }),
    );

    await expect(client.analyze({ rows: [] })).rejects.toThrow('nope');
  });

  it('returns a generic error message when the body has no detail or message', async () => {
    global.fetch = jest.fn().mockResolvedValue(jsonResponse({}, 400));
    const client = new AiAnomalyFastApiClient(
      config({ AI_SERVICE_ENABLED: 'true' }),
    );

    await expect(client.analyze({ rows: [] })).rejects.toThrow(
      'AI anomaly request validation failed',
    );
  });

  it('rejects with a gateway error when a successful response body is not valid JSON', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      new Response('not json', {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      }),
    );
    const client = new AiAnomalyFastApiClient(
      config({ AI_SERVICE_ENABLED: 'true' }),
    );

    await expect(client.analyze({ rows: [] })).rejects.toThrow(
      BadGatewayException,
    );
  });

  it('treats an unparsable error response body as undefined instead of throwing', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      new Response('not json', {
        status: 500,
        headers: { 'content-type': 'text/plain' },
      }),
    );
    const client = new AiAnomalyFastApiClient(
      config({ AI_SERVICE_ENABLED: 'true' }),
    );

    await expect(client.analyze({ rows: [] })).rejects.toThrow(
      BadGatewayException,
    );
  });

  it('wraps unexpected network errors as service unavailable', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network down'));
    const client = new AiAnomalyFastApiClient(
      config({ AI_SERVICE_ENABLED: 'true' }),
    );

    await expect(client.analyze({ rows: [] })).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
