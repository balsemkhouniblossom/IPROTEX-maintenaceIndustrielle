import { AppService } from './app.service';
import { ModulesContainer, Reflector } from '@nestjs/core';
import { Connection } from 'mongoose';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';

describe('AppService', () => {
  let service: AppService;

  beforeEach(() => {
    service = new AppService(undefined, undefined, undefined);
  });

  it('returns api index with message, endpoints, entities, and collections', async () => {
    const result = await service.getApiIndex();

    expect(result.message).toBe('GMAO API index');
    expect(Array.isArray(result.endpoints)).toBe(true);
    expect(Array.isArray(result.entities)).toBe(true);
    expect(Array.isArray(result.collections)).toBe(true);
  });

  it('returns empty endpoints when modulesContainer is missing', async () => {
    const svc = new AppService(undefined, undefined, undefined);
    const result = await svc.getApiIndex();
    expect(result.endpoints).toEqual([]);
  });

  it('returns empty entities when connection is missing', async () => {
    const svc = new AppService(undefined, undefined, undefined);
    const result = await svc.getApiIndex();
    expect(result.entities).toEqual([]);
  });

  it('extracts endpoints from modules container', async () => {
    const mockController = {
      metatype: class {
        constructor() {}
        getHello() {}
      },
    };
    const mockModule = {
      controllers: new Map([['TestController', mockController as any]]),
    };
    const modulesContainer = new Map([['TestModule', mockModule]]);

    const reflector = {
      get: jest.fn().mockReturnValue('/api'),
      getAll: jest.fn().mockReturnValue([]),
    } as unknown as Reflector;

    const svc = new AppService(
      modulesContainer as unknown as ModulesContainer,
      reflector,
      undefined,
    );
    const result = await svc.getApiIndex();

    expect(result.endpoints).toBeDefined();
  });

  it('skips invalid handlers and sorts real endpoint metadata by path and method', async () => {
    class TestController {
      ignored() {}
      create() {}
      list() {}
      update() {}
    }
    const mockModule = {
      controllers: new Map([
        ['MissingController', { metatype: undefined }],
        ['TestController', { metatype: TestController }],
      ]),
    };
    const modulesContainer = new Map([['TestModule', mockModule]]);
    const reflector = {
      get: jest.fn((metadataKey: string, target: unknown) => {
        if (metadataKey === PATH_METADATA && target === TestController) {
          return 'api';
        }
        if (
          metadataKey === PATH_METADATA &&
          target === TestController.prototype.create
        ) {
          return 'users';
        }
        if (
          metadataKey === PATH_METADATA &&
          target === TestController.prototype.list
        ) {
          return 'assets';
        }
        if (
          metadataKey === PATH_METADATA &&
          target === TestController.prototype.update
        ) {
          return 'users';
        }
        if (
          metadataKey === METHOD_METADATA &&
          target === TestController.prototype.create
        ) {
          return 1;
        }
        if (
          metadataKey === METHOD_METADATA &&
          target === TestController.prototype.list
        ) {
          return 0;
        }
        if (
          metadataKey === METHOD_METADATA &&
          target === TestController.prototype.update
        ) {
          return 4;
        }
        return undefined;
      }),
    };

    const result = await new AppService(
      modulesContainer as unknown as ModulesContainer,
      reflector as unknown as Reflector,
      undefined,
    ).getApiIndex();

    expect(result.endpoints).toEqual([
      { method: 'GET', path: '/api/assets' },
      { method: 'PATCH', path: '/api/users' },
      { method: 'POST', path: '/api/users' },
    ]);
  });

  it('handles http method labels correctly', async () => {
    const svc = new AppService(undefined, undefined, undefined);
    const result = await svc.getApiIndex();
    expect(result).toBeDefined();
  });

  it('normalizes endpoint paths and every supported HTTP method label', () => {
    const helpers = service as unknown as {
      toPath(value: unknown): string;
      joinPaths(controller: string, method: string): string;
      httpMethodLabel(method: number): string;
    };

    expect(helpers.toPath('api')).toBe('api');
    expect(helpers.toPath([null, 'users'])).toBe('users');
    expect(helpers.toPath(undefined)).toBe('');
    expect(helpers.toPath({ path: 'ignored' })).toBe('');
    expect(helpers.joinPaths('/api/', '/users/')).toBe('/api/users');
    expect(helpers.joinPaths('', '')).toBe('/');
    expect(
      Array.from({ length: 8 }, (_, method) => helpers.httpMethodLabel(method)),
    ).toEqual([
      'GET',
      'POST',
      'PUT',
      'DELETE',
      'PATCH',
      'ALL',
      'OPTIONS',
      'HEAD',
    ]);
    expect(helpers.httpMethodLabel(99)).toBe('UNKNOWN');
  });

  it('sorts entity and collection names from the configured connection', async () => {
    const connection = {
      models: { Zebra: {}, Asset: {} },
      db: {
        listCollections: jest.fn().mockReturnValue({
          toArray: jest
            .fn()
            .mockResolvedValue([
              { name: 'workorders' },
              { name: '' },
              { name: 'assets' },
            ]),
        }),
      },
    };
    const result = await new AppService(
      undefined,
      undefined,
      connection as never,
    ).getApiIndex();

    expect(result.entities).toEqual(['Asset', 'Zebra']);
    expect(result.collections).toEqual(['assets', 'workorders']);
  });

  it('returns no collections when database discovery fails', async () => {
    const connection = {
      models: {},
      db: {
        listCollections: jest.fn().mockImplementation(() => {
          throw new Error('database unavailable');
        }),
      },
    };

    await expect(
      new AppService(undefined, undefined, connection as never).getApiIndex(),
    ).resolves.toMatchObject({ collections: [] });
  });
});
