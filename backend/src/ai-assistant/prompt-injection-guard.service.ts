import { Injectable } from '@nestjs/common';

export type PromptInjectionScanResult = {
  sanitized: string;
  flags: string[];
};

/**
 * Neutralizes directive-like phrasing before it reaches the provider — the
 * operator's free-text description and every piece of grounded context
 * (fault descriptions, knowledge-base excerpts) are both untrusted input as
 * far as the model's instruction-following is concerned. This is a defense
 * layer, not a rejection: suspicious spans are replaced with a visible
 * marker (never silently dropped) so the request still proceeds, and every
 * match is reported so the audit log records that neutralization happened.
 * The system prompt (`ai-prompt.util.ts`) additionally instructs the model
 * to treat all context/question content as data, never as instructions —
 * this and that instruction are complementary, not alternatives.
 */
// Deliberately without the `g` flag here: a global RegExp carries
// `lastIndex` state across `.test()` calls, which would make detection
// silently flip between hits and misses on successive `scan()` invocations
// against different strings. `.test()` below is always used stateless; a
// fresh global copy is constructed only at the point of `.replace()`.
const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all|any|the)\s+(previous|prior|above)\s+instructions?/i,
  /disregard\s+(all|any|the)\s+(previous|prior|above)/i,
  /you\s+are\s+now\s+/i,
  /system\s+prompt/i,
  /act\s+as\s+(a|an)\s+[\w\s]{0,30}(system|admin|developer)/i,
  /reveal\s+(your|the)\s+(system|hidden)\s+prompt/i,
  /new\s+instructions?\s*:/i,
  /override\s+(your|the)\s+instructions?/i,
  /\bdo\s+anything\s+now\b/i,
];

const REDACTION_MARKER = '[redacted: instruction-like text removed]';

@Injectable()
export class PromptInjectionGuardService {
  scan(text: string | undefined | null): PromptInjectionScanResult {
    if (!text) return { sanitized: '', flags: [] };

    const flags: string[] = [];
    let sanitized = text;

    for (const pattern of INJECTION_PATTERNS) {
      if (pattern.test(sanitized)) {
        flags.push(pattern.source);
        sanitized = sanitized.replace(
          new RegExp(pattern.source, `${pattern.flags}g`),
          REDACTION_MARKER,
        );
      }
    }

    return { sanitized, flags };
  }
}
