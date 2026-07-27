import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type AiAssistantThrottleResult = {
  allowed: boolean;
  retryAfterSeconds?: number;
};

const WINDOW_MS = 60 * 60 * 1000; // 1 hour
const DEFAULT_LIMIT_PER_HOUR = 20;

/**
 * Per-user request cap for the AI assistant, mirroring the in-memory
 * Map-backed shape of `AuthThrottleService` (`auth/auth-throttle.service.ts`)
 * rather than extending it — that service's rule table is keyed by
 * auth-specific endpoints, not a fit for a single LLM-backed endpoint.
 * In-memory and per-process, same tradeoff as `AuthThrottleService`: fine
 * for this app's single-instance deployment, would need a shared store
 * (Redis, etc.) behind a horizontally-scaled deployment.
 */
@Injectable()
export class AiAssistantThrottleService {
  private readonly hits = new Map<string, number[]>();

  constructor(private readonly configService: ConfigService) {}

  consume(userId: string): AiAssistantThrottleResult {
    const now = Date.now();
    const limit = this.getLimit();
    const history = (this.hits.get(userId) ?? []).filter(
      (hit) => now - hit < WINDOW_MS,
    );

    if (history.length >= limit) {
      const retryAfterMs = Math.max(WINDOW_MS - (now - history[0]), 1000);
      this.hits.set(userId, history);
      return {
        allowed: false,
        retryAfterSeconds: Math.ceil(retryAfterMs / 1000),
      };
    }

    history.push(now);
    this.hits.set(userId, history);
    return { allowed: true };
  }

  resetForTests(): void {
    this.hits.clear();
  }

  private getLimit(): number {
    const configured = Number(
      this.configService.get<string>('AI_ASSISTANT_RATE_LIMIT_PER_HOUR'),
    );
    return Number.isInteger(configured) && configured > 0
      ? configured
      : DEFAULT_LIMIT_PER_HOUR;
  }
}
