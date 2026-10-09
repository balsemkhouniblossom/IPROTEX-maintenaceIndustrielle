import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  AiInteraction,
  AiInteractionDocument,
  AiInteractionStatus,
} from '../schemas/ai-interaction.schema';
import { DocumentAccessService } from '../documents/document-access.service';
import { AiContextBuilderService } from './ai-context-builder.service';
import { PromptInjectionGuardService } from './prompt-injection-guard.service';
import { SensitiveDataFilterService } from './sensitive-data-filter.service';
import { AiAssistantThrottleService } from './ai-assistant-throttle.service';
import { AiWorkOrderContextService } from './ai-work-order-context.service';
import {
  AI_PROVIDER,
  AiAssistantAnswer,
  AiProvider,
  AiProviderDiagnostics,
  AiProviderError,
} from './ai-provider.interface';
import { RequestAiRecommendationDto } from './dto/request-ai-recommendation.dto';
import { Role } from '../schemas/user.schema';
import {
  KnowledgeRetrievalService,
  KnowledgeSource,
} from '../rag/services/knowledge-retrieval.service';

const DEFAULT_TIMEOUT_MS = 12_000;
const CLARIFICATION_MESSAGE_BY_LOCALE: Record<string, string> = {
  en: 'Please ask a clearer question or describe what you want help with.',
  fr: "Veuillez poser une question plus claire ou décrire l'aide dont vous avez besoin.",
  es: 'Haz una pregunta más clara o describe con qué necesitas ayuda.',
  de: 'Bitte stellen Sie eine klarere Frage oder beschreiben Sie, wobei Sie Hilfe benötigen.',
  it: 'Fai una domanda più chiara o descrivi ciò per cui hai bisogno di aiuto.',
  ar: 'يرجى طرح سؤال أوضح أو وصف ما تحتاج إلى مساعدة بشأنه.',
};

const MAINTENANCE_INTENT_TERMS = [
  'alarm',
  'alarme',
  'alarma',
  'allarme',
  'fault',
  'failure',
  'fail',
  'error',
  'code',
  'panne',
  'defect',
  'defaut',
  'averia',
  'guasto',
  'stoerung',
  'machine',
  'maquina',
  'macchina',
  'maschine',
  'motor',
  'moteur',
  'motore',
  'engine',
  'bearing',
  'roulement',
  'belt',
  'courroie',
  'correa',
  'cinghia',
  'cable',
  'cabling',
  'wire',
  'wiring',
  'resistor',
  'brake',
  'braking',
  'oil',
  'huile',
  'aceite',
  'olio',
  'lubric',
  'grease',
  'overcurrent',
  'current',
  'voltage',
  'short',
  'circuit',
  'trip',
  'tripping',
  'stop',
  'stopped',
  'blocked',
  'jam',
  'jammed',
  'noise',
  'noisy',
  'grinding',
  'vibration',
  'heat',
  'hot',
  'temperature',
  'sensor',
  'pump',
  'gear',
  'check',
  'inspect',
  'repair',
  'replace',
  'maintenance',
  'preventive',
  'corrective',
  'work order',
  'diagnos',
  'symptom',
  'problem',
  'issue',
  'wrong',
] as const;
const ARABIC_MAINTENANCE_INTENT_TERMS = [
  'عطل',
  'صيانة',
  'انذار',
  'محرك',
  'ضوضاء',
  'حرارة',
  'فحص',
] as const;
const GENERAL_QUESTION_WORDS = new Set([
  'what',
  'why',
  'how',
  'when',
  'where',
  'who',
  'which',
  'can',
  'could',
  'should',
  'tell',
  'explain',
  'describe',
  'translate',
  'calculate',
  'quoi',
  'pourquoi',
  'comment',
  'quel',
  'quelle',
  'explique',
  'que',
  'como',
  'cuando',
  'donde',
  'was',
  'warum',
  'wie',
  'cosa',
  'perche',
  'come',
  'ما',
  'ماذا',
  'لماذا',
  'كيف',
  'متى',
  'أين',
  'من',
  'اشرح',
]);
function extractWords(value: string): string[] {
  return Array.from(value.matchAll(/[\p{L}\p{N}]+/gu), (match) => match[0]);
}

export type AiRecommendationResponse = {
  status: AiInteractionStatus;
  interactionId: string;
  provider: string;
  retryAfterSeconds?: number;
  diagnostic?: AiProviderDiagnostics;
  answer?: AiAssistantAnswer;
  grounded: boolean;
  operationalContextUsed: boolean;
  sources: KnowledgeSource[];
  retrieval: { matched: number };
};

type RecordParams = {
  actor: { userId: string; role: string };
  dto: RequestAiRecommendationDto;
  status: AiInteractionStatus;
  provider: string;
  question: string;
  redactionsApplied: number;
  injectionFlags: string[];
  model?: string;
  answer?: AiAssistantAnswer;
  latencyMs?: number;
  retryAfterSeconds?: number;
  errorMessage?: string;
  grounded?: boolean;
  validatedWorkOrderId?: string;
  validatedMachineId?: string;
  sources?: KnowledgeSource[];
};

/**
 * Orchestrates a single AI-assistant request end to end: rate limit, role
 * scoping, prompt-injection neutralization, sensitive-data redaction,
 * grounded-context assembly, a timeout-bounded provider call, and an
 * auditable record of the outcome — win or lose. Advisory only: this
 * service never writes to a WorkOrder, Stock, Machine, or validation
 * record; it only reads (via `AiContextBuilderService`) and returns text.
 */
@Injectable()
export class AiAssistantService {
  private readonly logger = new Logger(AiAssistantService.name);

  constructor(
    @InjectModel(AiInteraction.name)
    private readonly interactionModel: Model<AiInteractionDocument>,
    private readonly documentAccessService: DocumentAccessService,
    private readonly contextBuilder: AiContextBuilderService,
    private readonly injectionGuard: PromptInjectionGuardService,
    private readonly sensitiveDataFilter: SensitiveDataFilterService,
    private readonly throttleService: AiAssistantThrottleService,
    private readonly configService: ConfigService,
    @Inject(AI_PROVIDER) private readonly provider: AiProvider,
    private readonly workOrderContextService: AiWorkOrderContextService,
    @Optional()
    private readonly knowledgeRetrieval?: KnowledgeRetrievalService,
  ) {}

  async getRecommendation(
    actor: { userId: string; role: string },
    dto: RequestAiRecommendationDto,
  ): Promise<AiRecommendationResponse> {
    // Sanitize/redact first — cheap, and guarantees every persisted
    // interaction (including a rate-limited or disabled one) records the
    // same non-empty, already-safe question rather than a placeholder.
    const injectionResult = this.injectionGuard.scan(dto.question);
    const redactionResult = this.sensitiveDataFilter.redact(
      injectionResult.sanitized,
    );

    const throttle = this.throttleService.consume(actor.userId);
    if (!throttle.allowed) {
      return this.record({
        actor,
        dto,
        status: AiInteractionStatus.RATE_LIMITED,
        provider: this.provider.name,
        question: redactionResult.redacted,
        redactionsApplied: redactionResult.count,
        injectionFlags: injectionResult.flags,
        retryAfterSeconds: throttle.retryAfterSeconds,
      });
    }

    const { authorizedWorkOrder, effectiveMachineId } =
      await this.resolveAuthorizedScope(actor, dto);
    const validatedWorkOrderId = authorizedWorkOrder?.workOrderId;

    if (this.provider.name === 'disabled') {
      this.logger.warn(
        `AI assistant request skipped: ${this.getHealth().message}`,
      );
      return this.record({
        actor,
        dto,
        status: AiInteractionStatus.DISABLED,
        provider: this.provider.name,
        question: redactionResult.redacted,
        redactionsApplied: redactionResult.count,
        injectionFlags: injectionResult.flags,
        validatedWorkOrderId,
        validatedMachineId: effectiveMachineId,
      });
    }

    if (
      injectionResult.flags.length === 0 &&
      !this.isClearQuestion(redactionResult.redacted)
    ) {
      return this.record({
        actor,
        dto,
        status: AiInteractionStatus.OK,
        provider: this.provider.name,
        answer: this.buildClarificationAnswer(dto.locale),
        question: redactionResult.redacted,
        redactionsApplied: redactionResult.count,
        injectionFlags: injectionResult.flags,
        validatedWorkOrderId,
        validatedMachineId: effectiveMachineId,
      });
    }

    const context = await this.contextBuilder.buildContext({
      machineId: effectiveMachineId,
      faultCode: dto.faultCode,
      workOrder: authorizedWorkOrder?.context,
    });
    const retrieval = this.knowledgeRetrieval
      ? await this.knowledgeRetrieval.retrieve({
          question: redactionResult.redacted,
          userId: actor.userId,
          role: actor.role,
          machineId: effectiveMachineId,
        })
      : undefined;
    const timeoutMs = this.getTimeoutMs();
    const controller = new AbortController();
    let timedOut = false;
    // A well-behaved provider (like `GeminiAiProvider`, which forwards
    // `signal` into the SDK call) aborts on its own once `controller.abort()`
    // fires. Racing against this second timer is a backstop for any provider
    // that doesn't honor the signal — it guarantees this method always
    // returns within ~timeoutMs regardless of provider behavior, which is
    // the actual "timeout" guarantee the feature requires.
    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    timeoutTimer.unref?.();
    const timeoutPromise = new Promise<never>((_, reject) => {
      controller.signal.addEventListener('abort', () =>
        reject(new Error('AI provider request timed out')),
      );
    });
    const startedAt = Date.now();

    try {
      const result = await Promise.race([
        this.provider.generate(
          {
            question: redactionResult.redacted,
            locale: dto.locale,
            context,
            ragContext: retrieval?.context,
          },
          controller.signal,
        ),
        timeoutPromise,
      ]);
      return this.record({
        actor,
        dto,
        status: AiInteractionStatus.OK,
        provider: this.provider.name,
        model: result.model,
        answer: this.filterAnswer(result.answer),
        latencyMs: Date.now() - startedAt,
        question: redactionResult.redacted,
        redactionsApplied: redactionResult.count,
        injectionFlags: injectionResult.flags,
        // `grounded` has one precise meaning in the public contract: at
        // least one authorized company-document chunk supported the answer.
        // Work-order context is useful operational evidence, but must not
        // make the UI claim that documentation was used.
        grounded: Boolean(retrieval?.matched),
        sources: retrieval?.sources ?? [],
        validatedWorkOrderId,
        validatedMachineId: effectiveMachineId,
      });
    } catch (error) {
      const status = timedOut
        ? AiInteractionStatus.TIMEOUT
        : this.statusFromProviderError(error);
      this.logger.warn(
        `AI assistant request finished with ${status}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return this.record({
        actor,
        dto,
        status,
        provider: this.provider.name,
        latencyMs: Date.now() - startedAt,
        question: redactionResult.redacted,
        redactionsApplied: redactionResult.count,
        injectionFlags: injectionResult.flags,
        errorMessage: error instanceof Error ? error.message : String(error),
        validatedWorkOrderId,
        validatedMachineId: effectiveMachineId,
      });
    } finally {
      clearTimeout(timeoutTimer);
    }
  }

  private async resolveAuthorizedScope(
    actor: { userId: string; role: string },
    dto: RequestAiRecommendationDto,
  ) {
    if (dto.machineId) {
      await this.documentAccessService.assertCanAccessMachine(
        actor,
        dto.machineId,
      );
    }
    const authorizedWorkOrder = dto.workOrderId
      ? await this.workOrderContextService.resolve(
          actor,
          dto.workOrderId,
          dto.machineId,
        )
      : undefined;
    return {
      authorizedWorkOrder,
      effectiveMachineId: authorizedWorkOrder?.machineId ?? dto.machineId,
    };
  }

  getHealth(): AiProviderDiagnostics {
    return (
      this.provider.getDiagnostics?.() ?? {
        enabled: this.provider.name !== 'disabled',
        configured: this.provider.name !== 'disabled',
        provider: this.provider.name,
        status: this.provider.name === 'disabled' ? 'disabled' : 'ready',
        message:
          this.provider.name === 'disabled'
            ? 'AI assistant is intentionally disabled'
            : 'AI assistant provider is configured',
      }
    );
  }

  listOwnHistory(
    actor: { userId: string },
    limit = 20,
  ): Promise<AiInteractionDocument[]> {
    return this.interactionModel
      .find({ actor_user_id: new Types.ObjectId(actor.userId) })
      .sort({ createdAt: -1 })
      .limit(limit)
      .exec();
  }

  listAllHistory(limit = 50): Promise<AiInteractionDocument[]> {
    return this.interactionModel
      .find({})
      .sort({ createdAt: -1 })
      .limit(limit)
      .exec();
  }

  private filterAnswer(answer: AiAssistantAnswer): AiAssistantAnswer {
    const redactList = (items: string[]) =>
      items.map((item) => this.sensitiveDataFilter.redact(item).redacted);

    return {
      knownFacts: redactList(answer.knownFacts),
      probableCauses: redactList(answer.probableCauses),
      recommendedChecks: redactList(answer.recommendedChecks),
      safetyWarnings: redactList(answer.safetyWarnings),
      uncertainty: this.sensitiveDataFilter.redact(answer.uncertainty).redacted,
    };
  }

  private getTimeoutMs(): number {
    const configured = Number(
      this.configService.get<string>('AI_ASSISTANT_TIMEOUT_MS'),
    );
    return Number.isInteger(configured) && configured > 0
      ? configured
      : DEFAULT_TIMEOUT_MS;
  }

  private isClearQuestion(question: string): boolean {
    const normalized = question.trim().replace(/\s+/g, ' ');
    if (normalized.length < 4 || !/\p{L}/u.test(normalized)) {
      return false;
    }
    const words = extractWords(normalized).filter((word) => word.length >= 2);
    return (
      words.length >= 2 &&
      (normalized.includes('?') ||
        normalized.includes('؟') ||
        GENERAL_QUESTION_WORDS.has(words[0].toLowerCase()) ||
        this.hasMaintenanceIntent(normalized))
    );
  }

  private hasMaintenanceIntent(question: string): boolean {
    const lowerQuestion = question.toLowerCase();
    const words = extractWords(lowerQuestion);
    const wordSet = new Set(words);

    return (
      MAINTENANCE_INTENT_TERMS.some((term) =>
        term.includes(' ')
          ? lowerQuestion.includes(term)
          : wordSet.has(term) ||
            words.some((word) => word.startsWith(term) && term.length >= 5),
      ) ||
      ARABIC_MAINTENANCE_INTENT_TERMS.some((term) => question.includes(term))
    );
  }

  private buildClarificationAnswer(locale: string): AiAssistantAnswer {
    return {
      knownFacts: [],
      probableCauses: [],
      recommendedChecks: [],
      safetyWarnings: [],
      uncertainty:
        CLARIFICATION_MESSAGE_BY_LOCALE[locale] ??
        CLARIFICATION_MESSAGE_BY_LOCALE.en,
    };
  }

  private statusFromProviderError(error: unknown): AiInteractionStatus {
    if (!(error instanceof AiProviderError)) {
      return AiInteractionStatus.ERROR;
    }

    switch (error.code) {
      case 'missing_configuration':
        return AiInteractionStatus.MISSING_CONFIGURATION;
      case 'invalid_credentials':
        return AiInteractionStatus.INVALID_CREDENTIALS;
      case 'quota_limited':
        return AiInteractionStatus.QUOTA_LIMITED;
      case 'temporary_failure':
        return AiInteractionStatus.TEMPORARY_FAILURE;
      default:
        return AiInteractionStatus.ERROR;
    }
  }

  private async record(
    params: RecordParams,
  ): Promise<AiRecommendationResponse> {
    const machineId = params.validatedMachineId ?? params.dto.machineId;
    const doc = await this.interactionModel.create({
      actor_user_id: new Types.ObjectId(params.actor.userId),
      actor_role: params.actor.role,
      machine_id:
        machineId && Types.ObjectId.isValid(machineId)
          ? new Types.ObjectId(machineId)
          : undefined,
      work_order_id:
        params.validatedWorkOrderId &&
        Types.ObjectId.isValid(params.validatedWorkOrderId)
          ? new Types.ObjectId(params.validatedWorkOrderId)
          : undefined,
      fault_code: params.dto.faultCode,
      locale: params.dto.locale,
      question: params.question,
      status: params.status,
      answer: params.answer,
      provider: params.provider,
      model: params.model,
      latency_ms: params.latencyMs,
      redactions_applied: params.redactionsApplied,
      injection_flags: params.injectionFlags,
      error_message: params.errorMessage,
      grounded: params.grounded ?? false,
      source_document_ids: (params.sources ?? []).map(
        (source) => new Types.ObjectId(source.documentId),
      ),
    });

    return {
      status: params.status,
      interactionId: doc._id.toString(),
      provider: params.provider,
      retryAfterSeconds: params.retryAfterSeconds,
      // Detailed provider/configuration diagnostics are an Admin concern.
      // Operator and Technician users receive the localized status only.
      diagnostic:
        (params.actor.role as Role) === Role.ADMIN
          ? this.diagnosticForStatus(params.status)
          : undefined,
      answer: params.answer,
      grounded: params.grounded ?? false,
      operationalContextUsed: Boolean(params.validatedWorkOrderId),
      sources: params.sources ?? [],
      retrieval: { matched: params.sources?.length ?? 0 },
    };
  }

  private diagnosticForStatus(
    status: AiInteractionStatus,
  ): AiProviderDiagnostics | undefined {
    if (status === AiInteractionStatus.OK) {
      return undefined;
    }

    const health = this.getHealth();
    const fallbackMessages: Partial<Record<AiInteractionStatus, string>> = {
      [AiInteractionStatus.RATE_LIMITED]:
        'AI assistant rate limit reached for this user',
      [AiInteractionStatus.TIMEOUT]:
        'Gemini did not respond before the timeout',
      [AiInteractionStatus.INVALID_CREDENTIALS]:
        'Gemini rejected the configured API key or permissions',
      [AiInteractionStatus.QUOTA_LIMITED]:
        'Gemini quota or rate limit was reached',
      [AiInteractionStatus.TEMPORARY_FAILURE]:
        'Gemini is temporarily unavailable or returned invalid output',
      [AiInteractionStatus.ERROR]:
        'AI assistant failed with an unexpected provider error',
    };

    return {
      ...health,
      message: fallbackMessages[status] ?? health.message,
    };
  }
}
