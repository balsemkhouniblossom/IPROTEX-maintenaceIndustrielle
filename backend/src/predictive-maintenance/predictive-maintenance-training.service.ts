import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  PredictionModelVersion,
  PredictionModelVersionDocument,
  PredictionModelVersionStatus,
} from '../schemas/prediction-model-version.schema';
import {
  PREDICTION_MODELS,
  PredictionModel,
  PredictionModelType,
} from './prediction-model.interface';
import { TrainingSampleService } from './training-sample.service';

/**
 * Owns the write side of model versioning: training a model, archiving
 * whatever version was previously active for that type, and inserting the
 * new one — versions are append-only, never mutated in place, which is
 * what makes a stored version's `artifact` a trustworthy record of
 * exactly what ran at that point in time. Completely separate from
 * `PredictiveMaintenanceService` (the read/inference side) so the
 * read-only prediction endpoints have no code path that could
 * accidentally trigger a training run.
 */
@Injectable()
export class PredictiveMaintenanceTrainingService {
  private readonly logger = new Logger(
    PredictiveMaintenanceTrainingService.name,
  );

  constructor(
    @InjectModel(PredictionModelVersion.name)
    private readonly modelVersionModel: Model<PredictionModelVersionDocument>,
    @Inject(PREDICTION_MODELS) private readonly models: PredictionModel[],
    private readonly trainingSampleService: TrainingSampleService,
  ) {}

  async trainModel(
    modelType: PredictionModelType,
    options: { trainedBy?: string; randomSeed?: number } = {},
  ): Promise<PredictionModelVersionDocument> {
    const model = this.models.find((m) => m.type === modelType);
    if (!model) {
      throw new NotFoundException(
        `Unknown prediction model type: ${modelType}`,
      );
    }

    const samples = await this.trainingSampleService.buildTrainingSamples();
    const randomSeed = options.randomSeed ?? Date.now() % 2147483647;
    const artifact = model.train(samples, randomSeed);

    const latest = await this.modelVersionModel
      .findOne({ model_type: modelType })
      .sort({ version: -1 })
      .exec();
    const nextVersion = (latest?.version ?? 0) + 1;

    await this.modelVersionModel
      .updateMany(
        { model_type: modelType, status: PredictionModelVersionStatus.ACTIVE },
        { $set: { status: PredictionModelVersionStatus.ARCHIVED } },
      )
      .exec();

    const created = await this.modelVersionModel.create({
      model_type: modelType,
      version: nextVersion,
      status: PredictionModelVersionStatus.ACTIVE,
      feature_names: artifact.featureNames,
      training_sample_count: artifact.trainingSampleCount,
      random_seed: artifact.randomSeed,
      artifact,
      trained_at: new Date(artifact.trainedAt),
      trained_by:
        options.trainedBy && Types.ObjectId.isValid(options.trainedBy)
          ? new Types.ObjectId(options.trainedBy)
          : undefined,
    });

    this.logger.log(
      `Trained ${modelType} v${nextVersion} on ${artifact.trainingSampleCount} sample(s) (seed ${randomSeed}).`,
    );

    return created;
  }

  /** Bootstraps any model type that has never been trained — used by the scheduler so the feature is usable with zero manual setup. */
  async trainAllMissing(): Promise<PredictionModelType[]> {
    const trained: PredictionModelType[] = [];

    for (const model of this.models) {
      const hasActive = await this.modelVersionModel
        .exists({
          model_type: model.type,
          status: PredictionModelVersionStatus.ACTIVE,
        })
        .exec();
      if (hasActive) continue;

      await this.trainModel(model.type);
      trained.push(model.type);
    }

    return trained;
  }

  async listVersions(
    modelType?: PredictionModelType,
  ): Promise<PredictionModelVersionDocument[]> {
    const filter = modelType ? { model_type: modelType } : {};
    return this.modelVersionModel
      .find(filter)
      .sort({ model_type: 1, version: -1 })
      .exec();
  }
}
