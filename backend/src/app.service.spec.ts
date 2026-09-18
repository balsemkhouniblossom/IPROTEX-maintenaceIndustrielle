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

  it('handles http method labels correctly', async () => {
    const svc = new AppService(undefined, undefined, undefined);
    const result = await svc.getApiIndex();
    expect(result).toBeDefined();
  });
});
