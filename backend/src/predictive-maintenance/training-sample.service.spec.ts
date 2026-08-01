import { Types } from 'mongoose';
import { TrainingSampleService } from './training-sample.service';
import { FEATURE_NAMES } from './prediction-model.interface';

describe('TrainingSampleService', () => {
  function buildService(
    machines: Array<{ _id: Types.ObjectId }>,
    resultsByCall: Array<{ features: number[]; isEmpty: boolean }>,
  ) {
    const machineModel = {
      find: jest.fn().mockReturnValue({
        select: jest
          .fn()
          .mockReturnValue({ exec: jest.fn().mockResolvedValue(machines) }),
      }),
    };

    let call = 0;
    const featureExtractionService = {
      buildFeatureVector: jest.fn().mockImplementation(() => {
        const result = resultsByCall[call % resultsByCall.length];
        call += 1;
        return Promise.resolve({ ...result, measuredFacts: [] });
      }),
    };

    return new TrainingSampleService(
      machineModel as never,
      featureExtractionService as never,
    );
  }

  it('generates 12 weekly checkpoints per machine', async () => {
    const machine = { _id: new Types.ObjectId() };
    const nonEmpty = { features: FEATURE_NAMES.map(() => 1), isEmpty: false };
    const service = buildService([machine], [nonEmpty]);

    const samples = await service.buildTrainingSamples(new Date('2026-07-01'));
    expect(samples).toHaveLength(12);
    expect(samples.every((s) => s.machineId === machine._id.toString())).toBe(
      true,
    );
  });

  it('drops checkpoints the feature extractor marks as empty (no data available at that point in time)', async () => {
    const machine = { _id: new Types.ObjectId() };
    const empty = { features: FEATURE_NAMES.map(() => 0), isEmpty: true };
    const service = buildService([machine], [empty]);

    const samples = await service.buildTrainingSamples(new Date('2026-07-01'));
    expect(samples).toHaveLength(0);
  });

  it('keeps a checkpoint that has real signal even if most features are still 0', async () => {
    const machine = { _id: new Types.ObjectId() };
    const mostlyZero = {
      features: FEATURE_NAMES.map((name) =>
        name === 'active_alarm_count' ? 1 : 0,
      ),
      isEmpty: false,
    };
    const service = buildService([machine], [mostlyZero]);

    const samples = await service.buildTrainingSamples(new Date('2026-07-01'));
    expect(samples).toHaveLength(12);
  });

  it('pools checkpoints across every machine', async () => {
    const machineA = { _id: new Types.ObjectId() };
    const machineB = { _id: new Types.ObjectId() };
    const nonEmpty = { features: FEATURE_NAMES.map(() => 2), isEmpty: false };
    const service = buildService([machineA, machineB], [nonEmpty]);

    const samples = await service.buildTrainingSamples(new Date('2026-07-01'));
    expect(samples).toHaveLength(24);
    const machineIds = new Set(samples.map((s) => s.machineId));
    expect(machineIds).toEqual(
      new Set([machineA._id.toString(), machineB._id.toString()]),
    );
  });

  it('spaces checkpoints 7 days apart, walking backward from `now`', async () => {
    const machine = { _id: new Types.ObjectId() };
    const nonEmpty = { features: FEATURE_NAMES.map(() => 1), isEmpty: false };
    const service = buildService([machine], [nonEmpty]);
    const now = new Date('2026-07-01T00:00:00.000Z');

    const samples = await service.buildTrainingSamples(now);
    const sortedDates = samples
      .map((s) => s.asOfDate.getTime())
      .sort((a, b) => b - a);

    expect(sortedDates[0]).toBe(now.getTime());
    expect(now.getTime() - sortedDates[1]).toBe(7 * 24 * 60 * 60 * 1000);
  });
});
