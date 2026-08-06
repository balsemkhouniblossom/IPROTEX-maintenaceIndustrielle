import test from 'node:test';
import assert from 'node:assert/strict';
import { assertIcuStructureMatches, extractIcuSignature } from './icu-validation.mjs';

// The exact string that triggered the original bug report: Gemini's
// French translation attempt rewrote the ICU plural placeholder itself
// ({# event} -> {# événement}) instead of leaving the bare {#} token
// untouched — which is actually the CORRECT translation (the # token is
// still there, just with translated surrounding text), but the script's
// old raw-text `{...}` comparison rejected it because it compared the
// entire "{# event}" / "{# événement}" chunks as opaque placeholders
// instead of understanding ICU plural syntax.
const PLURAL_SOURCE = '{count, plural, one {# event} other {# events}}';

test('accepts the exact correct French translation that used to be incorrectly rejected', () => {
  assert.doesNotThrow(() =>
    assertIcuStructureMatches(
      'machineTimeline.timelineEventCount',
      PLURAL_SOURCE,
      '{count, plural, one {# événement} other {# événements}}',
    ),
  );
});

test('accepts correct translations in the other four target languages', () => {
  const translations = {
    es: '{count, plural, one {# evento} other {# eventos}}',
    de: '{count, plural, one {# Ereignis} other {# Ereignisse}}',
    it: '{count, plural, one {# evento} other {# eventi}}',
    ar: '{count, plural, one {# حدث} other {# أحداث}}',
  };
  for (const [locale, translated] of Object.entries(translations)) {
    assert.doesNotThrow(
      () => assertIcuStructureMatches(`test.${locale}`, PLURAL_SOURCE, translated),
      `${locale} translation should be accepted`,
    );
  }
});

test('accepts a simple placeholder with translated surrounding text', () => {
  assert.doesNotThrow(() =>
    assertIcuStructureMatches('greeting', 'Hello {name}, welcome', 'Bonjour {name}, bienvenue'),
  );
});

test('rejects a translation that drops a simple placeholder entirely', () => {
  assert.throws(
    () => assertIcuStructureMatches('greeting', 'Hello {name}', 'Bonjour'),
    /ICU structure mismatch/,
  );
});

test('rejects a translation that renames the argument inside a placeholder', () => {
  assert.throws(
    () => assertIcuStructureMatches('greeting', 'Hello {name}', 'Bonjour {nom}'),
    /ICU structure mismatch/,
  );
});

test('rejects a translation that drops a plural case branch', () => {
  assert.throws(
    () =>
      assertIcuStructureMatches(
        'machineTimeline.timelineEventCount',
        PLURAL_SOURCE,
        '{count, plural, other {# événements}}',
      ),
    /ICU structure mismatch/,
  );
});

test('rejects a translation that drops the # token from inside a plural branch', () => {
  assert.throws(
    () =>
      assertIcuStructureMatches(
        'machineTimeline.timelineEventCount',
        PLURAL_SOURCE,
        '{count, plural, one {événement} other {# événements}}',
      ),
    /ICU structure mismatch/,
  );
});

test('rejects a translation that adds an extra plural case not in the source', () => {
  assert.throws(
    () =>
      assertIcuStructureMatches(
        'machineTimeline.timelineEventCount',
        PLURAL_SOURCE,
        '{count, plural, zero {no events} one {# event} other {# events}}',
      ),
    /ICU structure mismatch/,
  );
});

test('rejects malformed (non-ICU) translated output instead of silently accepting it', () => {
  assert.throws(
    () => assertIcuStructureMatches('greeting', 'Hello {name}', 'Bonjour {name'),
    /not valid ICU MessageFormat/,
  );
});

test('accepts select constructs with matching case keys and rejects mismatched ones', () => {
  const source = '{gender, select, male {He} female {She} other {They}}';
  assert.doesNotThrow(() =>
    assertIcuStructureMatches('pronoun', source, '{gender, select, male {Il} female {Elle} other {Ils}}'),
  );
  assert.throws(
    () => assertIcuStructureMatches('pronoun', source, '{gender, select, male {Il} other {Ils}}'),
    /ICU structure mismatch/,
  );
});

test('accepts nested plural/select structures when fully preserved', () => {
  const source =
    '{gender, select, male {{count, plural, one {He has # item} other {He has # items}}} other {{count, plural, one {They have # item} other {They have # items}}}}';
  const translated =
    '{gender, select, male {{count, plural, one {Il a # article} other {Il a # articles}}} other {{count, plural, one {Ils ont # article} other {Ils ont # articles}}}}';
  assert.doesNotThrow(() => assertIcuStructureMatches('nested', source, translated));
});

test('preserves rich-text tag names and rejects a renamed tag', () => {
  const source = 'Click <link>here</link> to continue';
  assert.doesNotThrow(() =>
    assertIcuStructureMatches('cta', source, 'Cliquez <link>ici</link> pour continuer'),
  );
  assert.throws(
    () => assertIcuStructureMatches('cta', source, 'Cliquez <a>ici</a> pour continuer'),
    /ICU structure mismatch/,
  );
});

test('extractIcuSignature ignores literal text differences by design', () => {
  const englishSig = extractIcuSignature('Hello {name}, you have {count} items');
  const frenchSig = extractIcuSignature('Bonjour {name}, vous avez {count} articles');
  assert.deepEqual(englishSig, frenchSig);
});

test('every real English source message string parses as valid ICU MessageFormat', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const messagesPath = path.join(__dirname, '..', '..', 'frontend', 'messages', 'en.json');
  const messages = JSON.parse(fs.readFileSync(messagesPath, 'utf8'));

  function flatten(value, prefix, out) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const [key, child] of Object.entries(value)) {
        flatten(child, prefix ? `${prefix}.${key}` : key, out);
      }
      return out;
    }
    out[prefix] = value;
    return out;
  }

  const flat = flatten(messages, '', {});
  const failures = [];
  for (const [key, value] of Object.entries(flat)) {
    if (typeof value !== 'string' || !value.trim()) continue;
    try {
      extractIcuSignature(value);
    } catch (error) {
      failures.push(`${key}: ${error.message}`);
    }
  }

  assert.deepEqual(failures, [], `Source strings that failed ICU parsing:\n${failures.join('\n')}`);
});
