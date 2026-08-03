import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Panne, PanneDocument } from '../../schemas/panne.schema';
import {
  PanneSolution,
  PanneSolutionDocument,
} from '../../schemas/panne-solution.schema';
import {
  DocumentEntity,
  DocumentDocument,
} from '../../schemas/document.schema';

/**
 * Owns the "corrective assistant" context projection: known faults and
 * their recommended solutions, plus the machine's maintenance manuals,
 * sanitized into a plain read model. This never calls an external AI
 * provider and never mutates a Work Order — it exists purely to hand a
 * frontend troubleshooting widget a small, explicit set of database facts.
 */
@Injectable()
export class WorkOrderAssistantContextService {
  constructor(
    @InjectModel(Panne.name)
    private readonly panneModel: Model<PanneDocument>,
    @InjectModel(PanneSolution.name)
    private readonly panneSolutionModel: Model<PanneSolutionDocument>,
    @InjectModel(DocumentEntity.name)
    private readonly documentModel: Model<DocumentDocument>,
  ) {}

  async getCorrectiveAssistant(machineId?: string) {
    const pannes = await this.panneModel.find().exec();
    const panneIds = pannes.map((item) => item._id);
    const solutions = await this.panneSolutionModel
      .find({ panne_id: { $in: panneIds } })
      .populate('panne_id')
      .exec();

    const machineDocuments = machineId
      ? await this.documentModel.find({ machine_id: machineId }).exec()
      : [];

    return {
      machineId,
      pannes: pannes.map((panne) => {
        const relatedSolutions = solutions.filter(
          (solution) =>
            this.objectIdString(solution.panne_id) === panne._id.toString(),
        );
        return {
          id: panne._id.toString(),
          code: panne.code_panne,
          description: panne.description,
          gravity: panne.gravite,
          recommendedSolutions: relatedSolutions.map((solution) => ({
            id: solution._id.toString(),
            probableCause: solution.cause_probable,
            recommendedAction: solution.solution_recommandee,
          })),
        };
      }),
      documents: machineDocuments
        .filter((doc) => this.isMaintenanceDocumentType(doc.type_document))
        .map((doc) => ({
          id: doc._id.toString(),
          type: doc.type_document,
          fileName: doc.file_name,
          filePath: doc.file_path,
        })),
    };
  }

  private isMaintenanceDocumentType(type?: string) {
    const value = (type || '').toLowerCase();
    if (!value) return false;
    return (
      value.includes('manual') ||
      value.includes('maintenance') ||
      value.includes('electrical') ||
      value.includes('pneumatic') ||
      value.includes('safety') ||
      value.includes('spare') ||
      value.includes('catalogue')
    );
  }

  private objectIdString(value: unknown): string {
    if (!value) return '';

    if (typeof value === 'string') {
      return value;
    }

    if (value instanceof Types.ObjectId) {
      return value.toString();
    }

    if (typeof value === 'object' && value !== null && '_id' in value) {
      const maybeId = (value as { _id?: unknown })._id;
      return this.objectIdString(maybeId);
    }

    return '';
  }
}
