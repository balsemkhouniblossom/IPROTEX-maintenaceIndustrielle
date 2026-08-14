import { Injectable } from '@nestjs/common';

export type SensitiveDataRedactionResult = {
  redacted: string;
  count: number;
};

type RedactionRule = {
  pattern: RegExp; // no `g` flag — see note in prompt-injection-guard.service.ts
  replacement: string;
};

/**
 * Strips likely secrets/PII from text before it is sent to an external AI
 * provider or persisted in the audit log — applied to the operator's
 * free-text question and, defensively, to the provider's answer before it
 * is returned to the caller. Errs toward over-matching: a false-positive
 * redaction just removes a harmless-looking string, while a false negative
 * would leak real data to a third-party API.
 */
const REDACTION_RULES: RedactionRule[] = [
  {
    // key: value / key=value pairs naming a credential-shaped field.
    pattern: /\b(api[_-]?key|secret|password|passwd|token)\b\s*[:=]\s*\S+/i,
    replacement: '[REDACTED_CREDENTIAL]',
  },
  {
    // JWT-shaped strings (header.payload.signature, base64url segments).
    pattern:
      /\beyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\b/,
    replacement: '[REDACTED_TOKEN]',
  },
  {
    pattern: /\b[a-z0-9._%+-]{1,64}@[a-z0-9-]{1,63}(?:\.[a-z0-9-]{1,63})+\b/i,
    replacement: '[REDACTED_EMAIL]',
  },
  {
    // 13-19 digit sequences (with optional separators) — card-number shaped.
    pattern: /\b(?:\d[ -]?){12,18}\d\b/,
    replacement: '[REDACTED_NUMBER]',
  },
  {
    pattern: /\+?\d[\d .-]{7,}\d/,
    replacement: '[REDACTED_PHONE]',
  },
];

@Injectable()
export class SensitiveDataFilterService {
  redact(text: string | undefined | null): SensitiveDataRedactionResult {
    if (!text) return { redacted: '', count: 0 };

    let count = 0;
    let out = text;

    for (const rule of REDACTION_RULES) {
      const globalPattern = new RegExp(
        rule.pattern.source,
        `${rule.pattern.flags}g`,
      );
      out = out.replace(globalPattern, () => {
        count += 1;
        return rule.replacement;
      });
    }

    return { redacted: out, count };
  }
}
