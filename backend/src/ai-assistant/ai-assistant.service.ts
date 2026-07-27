import { Inject, Injectable } from '@nestjs/common';
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
import { AI_PROVIDER, AiAssistantAnswer, AiProvider } from './ai-provider.interface';
import { RequestAiRecommendationDto } from './dto/request-ai-recommendation.dto';

const DEFAULT_TIMEOUT_MS = 12_000;

export type AiRecommendationResponse = {
  status: AiInteractionStatus;
  interactionId: string;
  provider: string;
  retryAfterSeconds?: number;
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
    const redactionResult = this.sensitiveDataFilter.redact(injectionResult.sanitized);

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

    const context = await this.contextBuilder.buildContext({
      machineId: dto.machineId,
      faultCode: dto.faultCode,
    });

    const timeoutMs = this.getTimeoutMs();
    const controller = new AbortController();
    let timedOut = false;
    // A well-behaved provider (like `AnthropicAiProvider`, which forwards
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
      return this.record({
        actor,
        dto,
        status: timedOut ? AiInteractionStatus.TIMEOUT : AiInteractionStatus.ERROR,
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

  private async record(params: RecordParams): Promise<AiRecommendationResponse> {
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
      interactionId: (doc._id as Types.ObjectId).toString(),
      provider: params.provider,
      retryAfterSeconds: params.retryAfterSeconds,
      answer: params.answer,
    };
  }
}
