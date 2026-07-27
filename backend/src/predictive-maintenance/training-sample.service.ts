import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Machine, MachineDocument } from '../schemas/machine.schema';
import { FeatureExtractionService } from './feature-extraction.service';
import { TrainingSample } from './prediction-model.interface';

const CHECKPOINT_COUNT = 12;
const CHECKPOINT_INTERVAL_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Builds the unsupervised training set every model trains against: for
 * every machine, walk backward through `CHECKPOINT_COUNT` weekly
 * checkpoints (about a quarter of a machine's history) and recompute the
 * feature vector "as of" each one via `FeatureExtractionService`. Pooling
 * checkpoints across every machine — rather than training one model per
 * machine — is a deliberate choice: most machines don't accumulate enough
 * history on their own for Isolation Forest/DBSCAN/Autoencoder to learn
 * anything, but the fleet as a whole does, and a shared model still scores
 * a specific machine's live feature vector against that pooled baseline.
 * An all-zero snapshot (a machine with literally no data as of that
 * checkpoint) is dropped rather than pooled in — that's an artifact of
 * data absence, not a genuine "everything nominal" observation, and
 * training on strings of zeros would bias every model toward treating
 * "no data" as the definition of normal.
 */
@Injectable()
export class TrainingSampleService {
  constructor(
    @InjectModel(Machine.name) private readonly machineModel: Model<MachineDocument>,
    private readonly featureExtractionService: FeatureExtractionService,
  ) {}

  async buildTrainingSamples(now: Date = new Date()): Promise<TrainingSample[]> {
    const machines = await this.machineModel.find({}).select({ _id: 1 }).exec();
    const samples: TrainingSample[] = [];

    for (const machine of machines) {
      const machineId = machine._id.toString();
      for (let i = 0; i < CHECKPOINT_COUNT; i += 1) {
        const asOfDate = new Date(now.getTime() - i * CHECKPOINT_INTERVAL_DAYS * DAY_MS);
        // eslint-disable-next-line no-await-in-loop
        const { features, isEmpty } = await this.featureExtractionService.buildFeatureVector(
          machineId,
          asOfDate,
        );
        if (isEmpty) continue;
        samples.push({ machineId, asOfDate, features });
      }
    }

    return samples;
  }
}
