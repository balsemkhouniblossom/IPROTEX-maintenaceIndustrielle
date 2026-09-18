import { Types } from 'mongoose';
import { WorkOrderAssistantContextService } from './work-order-assistant-context.service';

function createQuery<T>(result: T) {
  return {
    find: jest.fn().mockResolvedValue(result),
  };
}

describe('WorkOrderAssistantContextService', () => {
  let service: WorkOrderAssistantContextService;
  let panneModel: { find: jest.Mock<any, any, any> };
  let panneSolutionModel: {
    find: jest.Mock<any, any, any>;
  };
  let documentModel: {
    find: jest.Mock<any, any, any>;
  };

  beforeEach(() => {
    panneModel = { find: jest.fn() };
    panneSolutionModel = {
      find: jest.fn(),
    };
    documentModel = { find: jest.fn() };
    service = new WorkOrderAssistantContextService(
      panneModel as any,
      panneSolutionModel as any,
      documentModel as any,
    );
  });

  describe('getCorrectiveAssistant', () => {
    it('returns empty pannes and documents when no data exists', async () => {
      panneModel.find.mockResolvedValue([]);
      const result = await service.getCorrectiveAssistant('some-machine-id');
      expect(result.machineId).toBe('some-machine-id');
      expect(result.pannes).toEqual([]);
      expect(result.documents).toBeDefined();
    });

    it('returns machineId null when called without machineId', async () => {
      panneModel.find.mockResolvedValue([]);
      const result = await service.getCorrectiveAssistant(undefined);
      expect(result.machineId).toBeUndefined();
      expect(documentModel.find).not.toHaveBeenCalled();
    });

    it('returns pannes with recommended solutions', async () => {
      const panneId = new Types.ObjectId();
      const panne = { _id: panneId, code_panne: 'P001', description: 'Test panne', gravite: 'high' };
      const solution = {
        _id: new Types.ObjectId(),
        panne_id: panneId,
        cause_probable: 'Some cause',
        solution_recommandee: 'Some solution',
      };

      panneModel.find.mockResolvedValue([panne]);
      panneSolutionModel.find.mockResolvedValue([solution]);

      const result = await service.getCorrectiveAssistant('machine-1');

      expect(result.pannes).toHaveLength(1);
      expect(result.pannes[0].id).toBe(panneId.toString());
      expect(result.pannes[0].recommendedSolutions).toHaveLength(1);
      expect(result.pannes[0].recommendedSolutions[0].id).toBe(solution._id.toString());
    });

    it('returns only maintenance document types', async () => {
      const machineId = new Types.ObjectId().toString();
      const maintenanceDoc = {
        _id: new Types.ObjectId(),
        type_document: 'manual',
        file_name: 'manual.pdf',
        file_path: '/docs/manual.pdf',
      };
      const otherDoc = {
        _id: new Types.ObjectId(),
        type_document: 'other',
        file_name: 'other.pdf',
        file_path: '/docs/other.pdf',
      };

      panneModel.find.mockResolvedValue([]);
      documentModel.find.mockResolvedValue([maintenanceDoc, otherDoc]);

      const result = await service.getCorrectiveAssistant(machineId);

      expect(result.documents).toHaveLength(1);
      expect(result.documents[0].type).toBe('manual');
    });

    it('does not query documents when machineId is invalid ObjectId', async () => {
      panneModel.find.mockResolvedValue([]);
      await service.getCorrectiveAssistant('invalid-object-id');
      expect(documentModel.find).not.toHaveBeenCalled();
    });

    it('filters panne solutions by panne_id', async () => {
      const panne1Id = new Types.ObjectId();
      const panne2Id = new Types.ObjectId();
      const panne1 = { _id: panne1Id, code_panne: 'P1', description: 'p1', gravite: 'low' };
      const panne2 = { _id: panne2Id, code_panne: 'P2', description: 'p2', gravite: 'med' };
      const solution = {
        _id: new Types.ObjectId(),
        panne_id: panne1Id,
        cause_probable: 'cause',
        solution_recommandee: 'solution',
      };

      panneModel.find.mockResolvedValue([panne1, panne2]);
      panneSolutionModel.find.mockResolvedValue([solution]);

      const result = await service.getCorrectiveAssistant('machine-1');

      expect(result.pannes).toHaveLength(2);
      const p1 = result.pannes.find(p => p.id === panne1Id.toString());
      expect(p1!.recommendedSolutions).toHaveLength(1);
      const p2 = result.pannes.find(p => p.id === panne2Id.toString());
      expect(p2!.recommendedSolutions).toHaveLength(0);
    });

    it('returns empty documents for machine with no maintenance docs', async () => {
      const machineId = new Types.ObjectId().toString();
      const panne = { _id: new Types.ObjectId(), code_panne: 'P1' };
      panneModel.find.mockResolvedValue([panne]);
      panneSolutionModel.find.mockResolvedValue([]);
      documentModel.find.mockResolvedValue([]);

      const result = await service.getCorrectiveAssistant(machineId);
      expect(result.documents).toHaveLength(0);
    });
  });
});
