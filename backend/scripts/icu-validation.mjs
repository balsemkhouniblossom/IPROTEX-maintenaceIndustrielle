import { parse, TYPE } from '@formatjs/icu-messageformat-parser';

const compareSignatureTokens = (left, right) => left.localeCompare(right);

/**
 * A naive brace-text placeholder check (comparing raw `{...}` substrings)
 * cannot tell an ICU plural/select's structural syntax apart from the
 * translatable words sitting inside it. For a source string like
 * `{count, plural, one {# event} other {# events}}`, the ONLY things that
 * must survive translation verbatim are: the argument name (`count`), the
 * `plural` keyword, the case keys (`one`/`other`), and every `#` token
 * (the count substitution point) — "event"/"events" are exactly the words
 * a translation is supposed to change. A raw-text comparison rejects every
 * correct plural translation in every target language, which is exactly
 * the bug that corrupted `machineTimeline.timelineEventCount` (Gemini
 * translated the `#`-bearing text but the check couldn't distinguish that
 * from translating the `{#}` token itself) — see
 * `backend/scripts/gemini-translate-messages.mjs`'s history.
 *
 * This walks the real ICU MessageFormat AST (the same parser next-intl
 * itself uses at runtime) and extracts a canonical signature of every
 * structural token — argument names, plural/select type and case keys,
 * `#` occurrences, rich-text tag names — while deliberately ignoring
 * plain literal text, which is exactly what should be free to change
 * between locales.
 */
export function extractIcuSignature(value) {
  const ast = parse(value, { ignoreTag: false });
  const tokens = [];
  walk(ast, tokens);
  return tokens.sort(compareSignatureTokens);
}

function walk(nodes, tokens) {
  for (const node of nodes) {
    switch (node.type) {
      case TYPE.literal:
        break;
      case TYPE.argument:
        tokens.push(`arg:${node.value}`);
        break;
      case TYPE.number:
      case TYPE.date:
      case TYPE.time:
        tokens.push(`fmt:${node.value}:${node.style ?? ''}`);
        break;
      case TYPE.pound:
        tokens.push('#');
        break;
      case TYPE.plural:
      case TYPE.select: {
        const kind = node.type === TYPE.plural ? 'plural' : 'select';
        const optionKeys = Object.keys(node.options).sort(compareSignatureTokens);
        tokens.push(`${kind}:${node.value}:${optionKeys.join(',')}`);
        for (const key of optionKeys) {
          walk(node.options[key].value, tokens);
        }
        break;
      }
      case TYPE.tag:
        tokens.push(`tag:${node.value}`);
        walk(node.children ?? [], tokens);
        break;
      default:
        // Unknown node types are treated as opaque structural tokens
        // rather than silently ignored, so an unrecognized construct
        // still forces a mismatch instead of passing validation blind.
        tokens.push(`unknown:${node.type}`);
    }
  }
}

/**
 * Throws with a descriptive message if `translated`'s ICU structure
 * (argument names, plural/select type + case keys, `#` counts, tag names)
 * doesn't match `source`'s. Plain text content is intentionally not
 * compared — that's the part a translation is supposed to change.
 */
export function assertIcuStructureMatches(key, source, translated) {
  let sourceSig;
  let translatedSig;
  try {
    sourceSig = extractIcuSignature(source);
  } catch (error) {
    throw new Error(`${key}: source string failed to parse as ICU MessageFormat — ${error.message}`);
  }
  try {
    translatedSig = extractIcuSignature(String(translated));
  } catch (error) {
    throw new Error(`${key}: translated string is not valid ICU MessageFormat — ${error.message}`);
  }

  const sourceKey = sourceSig.join('|');
  const translatedKey = translatedSig.join('|');
  if (sourceKey !== translatedKey) {
    throw new Error(
      `ICU structure mismatch for ${key}: expected [${sourceSig.join(', ')}], got [${translatedSig.join(', ')}]`,
    );
  }
}
