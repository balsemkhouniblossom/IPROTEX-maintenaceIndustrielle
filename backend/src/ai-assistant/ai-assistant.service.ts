import { Inject, Injectable, Logger } from '@nestjs/common';
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
import {
  AI_PROVIDER,
  AiAssistantAnswer,
  AiProvider,
  AiProviderDiagnostics,
  AiProviderError,
} from './ai-provider.interface';
import { RequestAiRecommendationDto } from './dto/request-ai-recommendation.dto';

const DEFAULT_TIMEOUT_MS = 12_000;
const CLARIFICATION_MESSAGE_BY_LOCALE: Record<string, string> = {
  en: 'I need a clearer maintenance question before giving recommendations. Please describe the fault, symptom, alarm, noise, temperature, movement, or check you want help with.',
  fr: "J'ai besoin d'une question de maintenance plus claire avant de donner des recommandations. Veuillez decrire la panne, le symptome, l'alarme, le bruit, la temperature, le mouvement ou le controle souhaite.",
  es: 'Necesito una pregunta de mantenimiento mas clara antes de dar recomendaciones. Describe la averia, el sintoma, la alarma, el ruido, la temperatura, el movimiento o la comprobacion que necesitas.',
  de: 'Ich brauche eine klarere Wartungsfrage, bevor ich Empfehlungen gebe. Bitte beschreiben Sie die Stoerung, das Symptom, den Alarm, das Geraeusch, die Temperatur, die Bewegung oder die gewuenschte Pruefung.',
  it: "Ho bisogno di una domanda di manutenzione piu chiara prima di dare raccomandazioni. Descrivi il guasto, il sintomo, l'allarme, il rumore, la temperatura, il movimento o il controllo richiesto.",
  ar: 'احتاج الى سؤال صيانة اوضح قبل تقديم توصيات. يرجى وصف العطل او العرض او الانذار او الضوضاء او الحرارة او الحركة او الفحص المطلوب.',
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
const QUESTION_WORD_PATTERN =
  /\b(why|what|how|when|where|can|should|do|does|is|are|pourquoi|quoi|comment|cuando|que|como|warum|was|wie|perche|cosa|come)\b/i;

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

    if (dto.machineId) {
      await this.documentAccessService.assertCanAccessMachine(
        { userId: actor.userId, role: actor.role },
        dto.machineId,
      );
    }

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
      });
    }

    if (
      injectionResult.flags.length === 0 &&
      !this.isClearMaintenanceQuestion(redactionResult.redacted)
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
      });
    }

    const context = await this.contextBuilder.buildContext({
      machineId: dto.machineId,
      faultCode: dto.faultCode,
    });

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
          { question: redactionResult.redacted, locale: dto.locale, context },
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
      });
    } finally {
      clearTimeout(timeoutTimer);
    }
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

  async listOwnHistory(
    actor: { userId: string },
    limit = 20,
  ): Promise<AiInteractionDocument[]> {
    return this.interactionModel
      .find({ actor_user_id: new Types.ObjectId(actor.userId) })
      .sort({ createdAt: -1 })
      .limit(limit)
      .exec();
  }

  async listAllHistory(limit = 50): Promise<AiInteractionDocument[]> {
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

  private isClearMaintenanceQuestion(question: string): boolean {
    const normalized = question.trim().replace(/\s+/g, ' ');
    if (normalized.length < 4 || !/\p{L}/u.test(normalized)) {
      return false;
    }

    if (this.hasMaintenanceIntent(normalized)) {
      return true;
    }

    const words = extractWords(normalized).filter((word) => word.length >= 2);
    const uniqueWords = new Set(words.map((word) => word.toLowerCase()));
    if (words.length < 4 || uniqueWords.size < 3) {
      return false;
    }

    return /[?]/.test(normalized) && QUESTION_WORD_PATTERN.test(normalized);
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
    const doc = await this.interactionModel.create({
      actor_user_id: new Types.ObjectId(params.actor.userId),
      actor_role: params.actor.role,
      machine_id:
        params.dto.machineId && Types.ObjectId.isValid(params.dto.machineId)
          ? new Types.ObjectId(params.dto.machineId)
          : undefined,
      work_order_id:
        params.dto.workOrderId && Types.ObjectId.isValid(params.dto.workOrderId)
          ? new Types.ObjectId(params.dto.workOrderId)
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
    });

    return {
      status: params.status,
      interactionId: doc._id.toString(),
      provider: params.provider,
      retryAfterSeconds: params.retryAfterSeconds,
      diagnostic: this.diagnosticForStatus(params.status),
      answer: params.answer,
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
