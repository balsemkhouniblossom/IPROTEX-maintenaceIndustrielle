import { Types } from 'mongoose';
import { WorkOrderAssistantContextService } from './work-order-assistant-context.service';

function execResult<T>(value: T) {
  const chain = {
    lean: jest.fn(),
    exec: jest.fn().mockResolvedValue(value),
  };
  chain.lean.mockReturnValue(chain);
  return chain;
}

function findChain<T>(value: T) {
  return { populate: jest.fn().mockReturnValue(execResult(value)) };
}

describe('WorkOrderAssistantContextService.getCorrectiveAssistant', () => {
  const panneId = new Types.ObjectId();
  const machineId = new Types.ObjectId().toHexString();

  let panneModel: { find: jest.Mock };
  let panneSolutionModel: { find: jest.Mock };
  let documentModel: { find: jest.Mock };
  let service: WorkOrderAssistantContextService;

  beforeEach(() => {
    panneModel = {
      find: jest.fn().mockReturnValue(
        execResult([
          {
            _id: panneId,
            code_panne: 'F1',
            description: 'Motor overheating',
            gravite: 'high',
          },
        ]),
      ),
    };
    panneSolutionModel = {
      find: jest.fn().mockReturnValue(
        findChain([
          {
            _id: new Types.ObjectId(),
            panne_id: panneId,
            cause_probable: 'Blocked airflow',
            solution_recommandee: 'Clean vents',
          },
        ]),
      ),
    };
    documentModel = {
      find: jest.fn().mockReturnValue(
        execResult([
          {
            _id: new Types.ObjectId(),
            type_document: 'maintenance-manual',
            file_name: 'manual.pdf',
            file_path: '/docs/manual.pdf',
          },
          {
            _id: new Types.ObjectId(),
            type_document: 'invoice',
            file_name: 'invoice.pdf',
            file_path: '/docs/invoice.pdf',
          },
        ]),
      ),
    };

    service = new WorkOrderAssistantContextService(
      panneModel as never,
      panneSolutionModel as never,
      documentModel as never,
    );
  });

  it('attaches only the solutions belonging to each fault', async () => {
    const result = await service.getCorrectiveAssistant(machineId);

    expect(result.pannes).toHaveLength(1);
    expect(result.pannes[0]).toEqual(
      expect.objectContaining({
        code: 'F1',
        description: 'Motor overheating',
        gravity: 'high',
        recommendedSolutions: [
          expect.objectContaining({
            probableCause: 'Blocked airflow',
            recommendedAction: 'Clean vents',
          }),
        ],
      }),
    );
  });

  it('filters returned documents to maintenance-relevant types only', async () => {
    const result = await service.getCorrectiveAssistant(machineId);

    expect(result.documents).toHaveLength(1);
    expect(result.documents[0].fileName).toBe('manual.pdf');
  });

  it('does not query documents at all when no machine id is supplied', async () => {
    const result = await service.getCorrectiveAssistant(undefined);

    expect(documentModel.find).not.toHaveBeenCalled();
    expect(result.documents).toEqual([]);
    expect(result.machineId).toBeUndefined();
  });

  it('returns an empty solutions list for a fault with no recommended solution on record', async () => {
    panneSolutionModel.find.mockReturnValue(findChain([]));

    const result = await service.getCorrectiveAssistant(machineId);

    expect(result.pannes[0].recommendedSolutions).toEqual([]);
  });
});
