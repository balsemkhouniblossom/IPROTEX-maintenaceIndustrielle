import { NotFoundException } from '@nestjs/common';
import { CataloguesService } from '../catalogues/catalogues.service';
import { KpisService } from '../kpis/kpis.service';
import { LubrifiantsService } from '../lubrifiants/lubrifiants.service';
import { MachineTypesService } from '../machine-types/machine-types.service';
import { MesuresService } from '../mesures/mesures.service';
import { ModulePiecesService } from '../module-pieces/module-pieces.service';
import { ModuleTypesService } from '../module-types/module-types.service';
import { ModulesService } from '../modules/modules.service';
import { PanneSolutionsService } from '../panne-solutions/panne-solutions.service';
import { PannesService } from '../pannes/pannes.service';

function createQuery<T>(result: T) {
  return {
    sort: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    populate: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(result),
  };
}

function createExistsQuery(result: unknown) {
  return {
    exec: jest.fn().mockResolvedValue(result),
  };
}

function createModelMock(savedValue: unknown = { _id: 'saved-id' }) {
  const model = jest.fn().mockImplementation((payload) => ({
    ...(payload as Record<string, unknown>),
    save: jest.fn().mockResolvedValue({
      ...(payload as Record<string, unknown>),
      ...(savedValue as Record<string, unknown>),
    }),
  }));

  return Object.assign(model, {
    find: jest.fn(),
    findById: jest.fn(),
    findByIdAndUpdate: jest.fn(),
    findByIdAndDelete: jest.fn(),
    countDocuments: jest.fn(),
    exists: jest.fn(),
  });
}

describe('simple CRUD services coverage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('covers catalogue CRUD and pagination wrappers', async () => {
    const model = createModelMock({ _id: 'catalogue-id' });
    model.find.mockReturnValue(createQuery([{ _id: 'catalogue-id' }]));
    model.countDocuments.mockReturnValue(createQuery(11));
    model.findById.mockReturnValue(createQuery({ _id: 'catalogue-id' }));
    model.findByIdAndUpdate.mockReturnValue(createQuery({ _id: 'catalogue-id', designation: 'Bearing' }));
    model.findByIdAndDelete.mockReturnValue(createQuery({ _id: 'catalogue-id' }));
    const service = new CataloguesService(model as never);

    await expect(service.create({ designation: 'Bearing' } as never)).resolves.toMatchObject({
      _id: 'catalogue-id',
      designation: 'Bearing',
    });
    await expect(service.findAll(2, 5, 5)).resolves.toMatchObject({
      items: [{ _id: 'catalogue-id' }],
      page: 2,
      limit: 5,
      totalItems: 11,
      totalPages: 3,
    });
    await expect(service.findOne('catalogue-id')).resolves.toMatchObject({ _id: 'catalogue-id' });
    await expect(service.update('catalogue-id', { designation: 'Bearing' } as never)).resolves.toMatchObject({
      designation: 'Bearing',
    });
    await expect(service.remove('catalogue-id')).resolves.toMatchObject({ _id: 'catalogue-id' });
  });

  it('covers lubricants CRUD and pagination wrappers', async () => {
    const model = createModelMock({ _id: 'lubricant-id' });
    model.find.mockReturnValue(createQuery([{ _id: 'lubricant-id' }]));
    model.countDocuments.mockReturnValue(createQuery(1));
    model.findById.mockReturnValue(createQuery({ _id: 'lubricant-id' }));
    model.findByIdAndUpdate.mockReturnValue(createQuery({ _id: 'lubricant-id', name: 'Grease' }));
    model.findByIdAndDelete.mockReturnValue(createQuery({ _id: 'lubricant-id' }));
    const service = new LubrifiantsService(model as never);

    await expect(service.create({ name: 'Grease' } as never)).resolves.toMatchObject({ name: 'Grease' });
    await expect(service.findAll(1, 10, 0)).resolves.toMatchObject({
      items: [{ _id: 'lubricant-id' }],
      totalItems: 1,
      totalPages: 1,
    });
    await expect(service.findOne('lubricant-id')).resolves.toMatchObject({ _id: 'lubricant-id' });
    await expect(service.update('lubricant-id', { name: 'Grease' } as never)).resolves.toMatchObject({
      name: 'Grease',
    });
    await expect(service.remove('lubricant-id')).resolves.toMatchObject({ _id: 'lubricant-id' });
  });

  it('covers measurements filtering, population, and not-found branches', async () => {
    const model = createModelMock({ _id: 'measurement-id' });
    const findQuery = createQuery([{ _id: 'measurement-id' }]);
    model.find.mockReturnValue(findQuery);
    model.countDocuments.mockReturnValue(createQuery(2));
    model.findById.mockReturnValue(createQuery({ _id: 'measurement-id' }));
    model.findByIdAndUpdate.mockReturnValue(createQuery({ _id: 'measurement-id', status: 'ok' }));
    model.findByIdAndDelete.mockReturnValue(createQuery({ _id: 'measurement-id' }));
    const service = new MesuresService(model as never);

    await expect(service.create({ value: 42 } as never)).resolves.toMatchObject({ value: 42 });
    await expect(service.findAll(1, 20, 0, 'sensor-id', 'warning')).resolves.toMatchObject({
      items: [{ _id: 'measurement-id' }],
      totalItems: 2,
    });
    expect(model.find).toHaveBeenCalledWith({ capteur_id: 'sensor-id', status: 'warning' });
    expect(findQuery.populate).toHaveBeenCalledWith('capteur_id');
    await expect(service.findOne('measurement-id')).resolves.toMatchObject({ _id: 'measurement-id' });
    await expect(service.update('measurement-id', { status: 'ok' } as never)).resolves.toMatchObject({
      status: 'ok',
    });
    await expect(service.remove('measurement-id')).resolves.toMatchObject({ _id: 'measurement-id' });

    model.findById.mockReturnValueOnce(createQuery(null));
    await expect(service.findOne('missing')).rejects.toBeInstanceOf(NotFoundException);
    model.findByIdAndUpdate.mockReturnValueOnce(createQuery(null));
    await expect(service.update('missing', {} as never)).rejects.toBeInstanceOf(NotFoundException);
    model.findByIdAndDelete.mockReturnValueOnce(createQuery(null));
    await expect(service.remove('missing')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('covers KPI CRUD, machine population, and pagination wrappers', async () => {
    const model = createModelMock({ _id: 'kpi-id' });
    const findQuery = createQuery([{ _id: 'kpi-id' }]);
    const findByIdQuery = createQuery({ _id: 'kpi-id' });
    model.find.mockReturnValue(findQuery);
    model.countDocuments.mockReturnValue(createQuery(6));
    model.findById.mockReturnValue(findByIdQuery);
    model.findByIdAndUpdate.mockReturnValue(createQuery({ _id: 'kpi-id', valeur: 95 }));
    model.findByIdAndDelete.mockReturnValue(createQuery({ _id: 'kpi-id' }));
    const service = new KpisService(model as never);

    await expect(service.create({ valeur: 90 } as never)).resolves.toMatchObject({ valeur: 90 });
    await expect(service.findAll(2, 3, 3)).resolves.toMatchObject({
      items: [{ _id: 'kpi-id' }],
      totalItems: 6,
      totalPages: 2,
    });
    expect(findQuery.populate).toHaveBeenCalledWith('machine_id');
    await expect(service.findOne('kpi-id')).resolves.toMatchObject({ _id: 'kpi-id' });
    expect(findByIdQuery.populate).toHaveBeenCalledWith('machine_id');
    await expect(service.update('kpi-id', { valeur: 95 } as never)).resolves.toMatchObject({ valeur: 95 });
    await expect(service.remove('kpi-id')).resolves.toMatchObject({ _id: 'kpi-id' });
  });

  it('covers module-pieces filtering, population, and not-found branches', async () => {
    const model = createModelMock({ _id: 'module-piece-id' });
    const findQuery = createQuery([{ _id: 'module-piece-id' }]);
    const findByIdQuery = createQuery({ _id: 'module-piece-id' });
    model.find.mockReturnValue(findQuery);
    model.countDocuments.mockReturnValue(createQuery(5));
    model.findById.mockReturnValue(findByIdQuery);
    model.findByIdAndUpdate.mockReturnValue(createQuery({ _id: 'module-piece-id', quantite: 2 }));
    model.findByIdAndDelete.mockReturnValue(createQuery({ _id: 'module-piece-id' }));
    const service = new ModulePiecesService(model as never);

    await expect(service.create({ quantite: 1 } as never)).resolves.toMatchObject({ quantite: 1 });
    await expect(service.findAll(1, 5, 0, 'module-type-id')).resolves.toMatchObject({
      items: [{ _id: 'module-piece-id' }],
      totalItems: 5,
    });
    expect(model.find).toHaveBeenCalledWith({ mod_type_id: 'module-type-id' });
    expect(findQuery.populate).toHaveBeenCalledWith('mod_type_id');
    expect(findQuery.populate).toHaveBeenCalledWith('part_id');
    await expect(service.findOne('module-piece-id')).resolves.toMatchObject({ _id: 'module-piece-id' });
    expect(findByIdQuery.populate).toHaveBeenCalledWith('mod_type_id');
    expect(findByIdQuery.populate).toHaveBeenCalledWith('part_id');
    await expect(service.update('module-piece-id', { quantite: 2 } as never)).resolves.toMatchObject({ quantite: 2 });
    await expect(service.remove('module-piece-id')).resolves.toMatchObject({ _id: 'module-piece-id' });

    model.findById.mockReturnValueOnce(createQuery(null));
    await expect(service.findOne('missing')).rejects.toBeInstanceOf(NotFoundException);
    model.findByIdAndUpdate.mockReturnValueOnce(createQuery(null));
    await expect(service.update('missing', {} as never)).rejects.toBeInstanceOf(NotFoundException);
    model.findByIdAndDelete.mockReturnValueOnce(createQuery(null));
    await expect(service.remove('missing')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('covers pannes and panne-solutions CRUD wrappers', async () => {
    const panneModel = createModelMock({ _id: 'panne-id' });
    panneModel.find.mockReturnValue(createQuery([{ _id: 'panne-id' }]));
    panneModel.countDocuments.mockReturnValue(createQuery(2));
    panneModel.findById.mockReturnValue(createQuery({ _id: 'panne-id' }));
    panneModel.findByIdAndUpdate.mockReturnValue(createQuery({ _id: 'panne-id', description: 'Updated' }));
    panneModel.findByIdAndDelete.mockReturnValue(createQuery({ _id: 'panne-id' }));
    const pannesService = new PannesService(panneModel as never);

    await expect(pannesService.create({ description: 'Fault' } as never)).resolves.toMatchObject({
      description: 'Fault',
    });
    await expect(pannesService.findAll(1, 10, 0)).resolves.toMatchObject({ totalItems: 2, totalPages: 1 });
    await expect(pannesService.findOne('panne-id')).resolves.toMatchObject({ _id: 'panne-id' });
    await expect(pannesService.update('panne-id', { description: 'Updated' } as never)).resolves.toMatchObject({
      description: 'Updated',
    });
    await expect(pannesService.remove('panne-id')).resolves.toMatchObject({ _id: 'panne-id' });

    const solutionModel = createModelMock({ _id: 'solution-id' });
    const solutionFindQuery = createQuery([{ _id: 'solution-id' }]);
    const solutionFindByIdQuery = createQuery({ _id: 'solution-id' });
    const solutionUpdateQuery = createQuery({ _id: 'solution-id', solution: 'Reset' });
    solutionModel.find.mockReturnValue(solutionFindQuery);
    solutionModel.countDocuments.mockReturnValue(createQuery(1));
    solutionModel.findById.mockReturnValue(solutionFindByIdQuery);
    solutionModel.findByIdAndUpdate.mockReturnValue(solutionUpdateQuery);
    solutionModel.findByIdAndDelete.mockReturnValue(createQuery({ _id: 'solution-id' }));
    const solutionsService = new PanneSolutionsService(solutionModel as never);

    await expect(solutionsService.create({ solution: 'Replace' } as never)).resolves.toMatchObject({
      solution: 'Replace',
    });
    await expect(solutionsService.findAll(1, 10, 0)).resolves.toMatchObject({ totalItems: 1 });
    expect(solutionFindQuery.populate).toHaveBeenCalledWith('panne_id');
    await expect(solutionsService.findOne('solution-id')).resolves.toMatchObject({ _id: 'solution-id' });
    expect(solutionFindByIdQuery.populate).toHaveBeenCalledWith('panne_id');
    await expect(solutionsService.update('solution-id', { solution: 'Reset' } as never)).resolves.toMatchObject({
      solution: 'Reset',
    });
    expect(solutionUpdateQuery.populate).toHaveBeenCalledWith('panne_id');
    await expect(solutionsService.remove('solution-id')).resolves.toMatchObject({ _id: 'solution-id' });
  });

  it('covers machine type sequence assignment, response mapping, and dependency-protected delete', async () => {
    const machineTypeModel = createModelMock({
      _id: 'machine-type-id',
      type_id: 12,
      name: 'Press',
      description: 'Hydraulic',
    });
    const machineModel = createModelMock();
    const moduleTypeModel = createModelMock();
    const knowledgeArticleModel = createModelMock();
    const counterService = { getNextSequence: jest.fn().mockResolvedValue(12) };
    machineTypeModel.find.mockReturnValue(createQuery([{ _id: 'machine-type-id', type_id: 12, name: 'Press' }]));
    machineTypeModel.countDocuments.mockReturnValue(createQuery(1));
    machineTypeModel.findById.mockReturnValue(createQuery({ _id: 'machine-type-id', type_id: 12, name: 'Press' }));
    machineTypeModel.findByIdAndUpdate.mockReturnValue(
      createQuery({ _id: 'machine-type-id', type_id: 12, name: 'Updated press' }),
    );
    machineTypeModel.findByIdAndDelete.mockReturnValue(
      createQuery({ _id: 'machine-type-id', type_id: 12, name: 'Press' }),
    );
    machineModel.exists.mockReturnValue(createExistsQuery(null));
    moduleTypeModel.exists.mockReturnValue(createExistsQuery(null));
    knowledgeArticleModel.exists.mockReturnValue(createExistsQuery(null));

    const service = new MachineTypesService(
      machineTypeModel as never,
      machineModel as never,
      moduleTypeModel as never,
      knowledgeArticleModel as never,
      counterService as never,
    );

    await expect(service.create({ name: 'Press' } as never)).resolves.toMatchObject({
      _id: 'machine-type-id',
      type_id: 12,
      name: 'Press',
    });
    expect(counterService.getNextSequence).toHaveBeenCalledWith('machine_type');
    await expect(service.findAll(1, 10, 0)).resolves.toMatchObject({
      items: [{ _id: 'machine-type-id', type_id: 12, name: 'Press' }],
      totalItems: 1,
    });
    await expect(service.findOne('machine-type-id')).resolves.toMatchObject({ name: 'Press' });
    await expect(service.update('machine-type-id', { name: 'Updated press' } as never)).resolves.toMatchObject({
      name: 'Updated press',
    });
    await expect(service.remove('machine-type-id')).resolves.toMatchObject({ name: 'Press' });

    machineModel.exists.mockReturnValueOnce(createExistsQuery({ _id: 'machine-id' }));
    moduleTypeModel.exists.mockReturnValueOnce(createExistsQuery(null));
    knowledgeArticleModel.exists.mockReturnValueOnce(createExistsQuery(null));
    await expect(service.remove('machine-type-id')).rejects.toMatchObject({ status: 409 });
  });

  it('covers module type CRUD and dependency-protected delete', async () => {
    const moduleTypeModel = createModelMock({ _id: 'module-type-id' });
    const moduleModel = createModelMock();
    const modulePiecesModel = createModelMock();
    moduleTypeModel.find.mockReturnValue(createQuery([{ _id: 'module-type-id' }]));
    moduleTypeModel.countDocuments.mockReturnValue(createQuery(4));
    moduleTypeModel.findById.mockReturnValue(createQuery({ _id: 'module-type-id' }));
    moduleTypeModel.findByIdAndUpdate.mockReturnValue(createQuery({ _id: 'module-type-id', nom_module: 'Motor' }));
    moduleTypeModel.findByIdAndDelete.mockReturnValue(createQuery({ _id: 'module-type-id' }));
    moduleModel.exists.mockReturnValue(createExistsQuery(null));
    modulePiecesModel.exists.mockReturnValue(createExistsQuery(null));
    const service = new ModuleTypesService(moduleTypeModel as never, moduleModel as never, modulePiecesModel as never);

    await expect(service.create({ nom_module: 'Motor' } as never)).resolves.toMatchObject({ nom_module: 'Motor' });
    await expect(service.findAll(2, 2, 2)).resolves.toMatchObject({ totalItems: 4, totalPages: 2 });
    await expect(service.findOne('module-type-id')).resolves.toMatchObject({ _id: 'module-type-id' });
    await expect(service.update('module-type-id', { nom_module: 'Motor' } as never)).resolves.toMatchObject({
      nom_module: 'Motor',
    });
    await expect(service.remove('module-type-id')).resolves.toMatchObject({ _id: 'module-type-id' });

    moduleModel.exists.mockReturnValueOnce(createExistsQuery({ _id: 'module-id' }));
    modulePiecesModel.exists.mockReturnValueOnce(createExistsQuery(null));
    await expect(service.remove('module-type-id')).rejects.toMatchObject({ status: 409 });
  });

  it('covers module CRUD, populated reads, and all dependency checks before delete', async () => {
    const moduleModel = createModelMock({ _id: 'module-id' });
    const workOrderModel = createModelMock();
    const maintenancePlanModel = createModelMock();
    const capteurModel = createModelMock();
    const lubrificationLogModel = createModelMock();
    const findQuery = createQuery([{ _id: 'module-id' }]);
    const findByIdQuery = createQuery({ _id: 'module-id' });
    moduleModel.find.mockReturnValue(findQuery);
    moduleModel.countDocuments.mockReturnValue(createQuery(3));
    moduleModel.findById.mockReturnValue(findByIdQuery);
    moduleModel.findByIdAndUpdate.mockReturnValue(createQuery({ _id: 'module-id', localisation: 'Line 1' }));
    moduleModel.findByIdAndDelete.mockReturnValue(createQuery({ _id: 'module-id' }));
    for (const dependencyModel of [
      moduleModel,
      workOrderModel,
      maintenancePlanModel,
      capteurModel,
      lubrificationLogModel,
    ]) {
      dependencyModel.exists.mockReturnValue(createExistsQuery(null));
    }

    const service = new ModulesService(
      moduleModel as never,
      workOrderModel as never,
      maintenancePlanModel as never,
      capteurModel as never,
      lubrificationLogModel as never,
    );

    await expect(service.create({ localisation: 'Line 1' } as never)).resolves.toMatchObject({
      localisation: 'Line 1',
    });
    await expect(service.findAll(1, 3, 0)).resolves.toMatchObject({ totalItems: 3, totalPages: 1 });
    expect(findQuery.populate).toHaveBeenCalledWith('machine_id');
    expect(findQuery.populate).toHaveBeenCalledWith('mod_type_id');
    expect(findQuery.populate).toHaveBeenCalledWith('parent_module_id');
    await expect(service.findOne('module-id')).resolves.toMatchObject({ _id: 'module-id' });
    expect(findByIdQuery.populate).toHaveBeenCalledWith('machine_id');
    await expect(service.update('module-id', { localisation: 'Line 1' } as never)).resolves.toMatchObject({
      localisation: 'Line 1',
    });
    await expect(service.remove('module-id')).resolves.toMatchObject({ _id: 'module-id' });

    workOrderModel.exists.mockReturnValueOnce(createExistsQuery({ _id: 'work-order-id' }));
    await expect(service.remove('module-id')).rejects.toMatchObject({ status: 409 });
  });
});
