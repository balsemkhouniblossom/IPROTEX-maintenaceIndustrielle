import {
  BadGatewayException,
  BadRequestException,
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
});
