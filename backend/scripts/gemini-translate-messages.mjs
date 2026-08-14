/**
 * Fills in missing `frontend/messages/<locale>.json` keys by translating
 * from `en.json` via Gemini. Every translated value is structurally
 * validated against the real ICU MessageFormat parser before being
 * written (see `./icu-validation.mjs`) — a translation that drops a
 * placeholder, renames an argument, or corrupts a plural/select
 * construct is rejected with a specific error rather than written.
 *
 * Requires network access to generativelanguage.googleapis.com — will not
 * run (except --dry-run) from a network-restricted sandbox.
 *
 * Usage (run from `backend/`):
 *
 *   GEMINI_API_KEY=<key> npm run translate:gemini
 *
 * `GEMINI_API_KEY` is the only required environment variable; it is also
 * picked up automatically from `backend/.env` if present there (see
 * `loadEnvFile` below), matching how the rest of this backend loads
 * config, so an explicit `GEMINI_API_KEY=...` prefix is only needed if
 * it isn't already in `backend/.env`.
 *
 * Useful flags:
 *   --dry-run              report missing-key counts per locale, write nothing
 *                           (this doubles as the translation-key parity
 *                           check — see FINAL_RELEASE_READINESS_REPORT.md)
 *   --locales=fr,es        limit to specific locales (default: fr,ar,es,de,it)
 *   --keys=a.b,c.d         limit to specific dotted message keys
 *   --force                re-translate keys that already have a value
 *
 * Also runnable as `npm run translate:gemini:dry-run` (no key required).
 * Regression tests for the ICU structural validation:
 * `npm run translate:icu-test`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI } from '@google/genai';
import { assertIcuStructureMatches } from './icu-validation.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendDir = path.resolve(__dirname, '..');
const repoDir = path.resolve(backendDir, '..');
const messagesDir = path.join(repoDir, 'frontend', 'messages');

const LOCALE_NAMES = {
  ar: 'Arabic',
  de: 'German',
  es: 'Spanish',
  fr: 'French',
  it: 'Italian',
};

const args = parseArgs(process.argv.slice(2));
loadEnvFile(path.join(backendDir, '.env'));

const sourceLocale = args.source || 'en';
const targetLocales = (args.locales || 'fr,ar,es,de,it')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const force = Boolean(args.force);
const dryRun = Boolean(args['dry-run']);
const keyFilter = new Set(
  (args.keys || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
);

const sourceMessages = readJson(path.join(messagesDir, `${sourceLocale}.json`));
const sourceFlat = flatten(sourceMessages);
const sourceEntries = Object.entries(sourceFlat).filter(([key, value]) => {
  if (typeof value !== 'string' || value.trim() === '') return false;
  if (keyFilter.size > 0 && !keyFilter.has(key)) return false;
  return true;
});

if (sourceEntries.length === 0) {
  console.log('No source translation keys matched.');
  process.exit(0);
}

const apiKey = process.env.GEMINI_API_KEY?.trim();
const model = process.env.GEMINI_MODEL?.trim() || 'gemini-3.5-flash-lite';
if (!dryRun && !apiKey) {
  throw new Error('GEMINI_API_KEY is required. Put it in backend/.env or the shell environment.');
}

const ai = dryRun ? undefined : new GoogleGenAI({ apiKey });

for (const locale of targetLocales) {
  if (locale === sourceLocale) continue;

  const localePath = path.join(messagesDir, `${locale}.json`);
  const targetMessages = readJson(localePath);
  const targetFlat = flatten(targetMessages);
  const pending = sourceEntries.filter(([key]) => force || typeof targetFlat[key] !== 'string');

  if (pending.length === 0) {
    console.log(`${locale}: no missing keys${force ? ' for selected keys' : ''}.`);
    continue;
  }

  console.log(`${locale}: ${dryRun ? 'would translate' : 'translating'} ${pending.length} keys.`);
  if (dryRun) continue;

  const translated = await translateEntries({
    ai,
    model,
    locale,
    entries: pending,
  });

  for (const [key, value] of Object.entries(translated)) {
    if (typeof value !== 'string' || value.trim() === '') {
      throw new Error(`${locale}: Gemini returned an empty translation for ${key}`);
    }
    setNested(targetMessages, key, value);
  }

  fs.writeFileSync(localePath, `${JSON.stringify(targetMessages, null, 2)}\n`, 'utf8');
}

async function translateEntries({ ai, model, locale, entries }) {
  const targetLanguage = LOCALE_NAMES[locale] || locale;
  const input = Object.fromEntries(entries);
  const response = await ai.models.generateContent({
    model,
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: [
              `Translate this JSON object from English to ${targetLanguage}.`,
              'Return only valid JSON with the same keys and translated string values.',
              'Preserve ICU placeholders exactly, including braces such as {count}, {name}, and {default}.',
              'Preserve product names, route names, status codes, and API names such as Gemini, Render, Vercel, JWT, and API.',
              'Do not add explanations.',
              JSON.stringify(input, null, 2),
            ].join('\n'),
          },
        ],
      },
    ],
    config: {
      responseMimeType: 'application/json',
      maxOutputTokens: 8192,
    },
  });

  const text = extractJsonText(response.text);
  const parsed = JSON.parse(text);
  const expectedKeys = new Set(Object.keys(input));
  for (const key of expectedKeys) {
    if (!(key in parsed)) {
      throw new Error(`${locale}: Gemini omitted key ${key}`);
    }
    // Structural ICU validation (argument names, plural/select type + case
    // keys, `#` counts, tag names) via the real MessageFormat parser — not
    // a raw-text brace comparison. A naive comparison of literal `{...}`
    // substrings can't tell a plural/select construct's syntax apart from
    // the translatable words inside it, and rejects every correctly
    // translated plural message in every target language. See
    // `backend/scripts/icu-validation.mjs` for the full explanation and
    // `backend/scripts/icu-validation.test.mjs` for the regression tests
    // covering the exact corruption this once let through.
    assertIcuStructureMatches(`${locale}:${key}`, input[key], parsed[key]);
  }
  return parsed;
}

function flatten(value, prefix = '', output = {}) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) {
      flatten(child, prefix ? `${prefix}.${key}` : key, output);
    }
    return output;
  }
  output[prefix] = value;
  return output;
}

function setNested(target, dottedKey, value) {
  const parts = dottedKey.split('.');
  let current = target;
  for (const part of parts.slice(0, -1)) {
    if (!current[part] || typeof current[part] !== 'object' || Array.isArray(current[part])) {
      current[part] = {};
    }
    current = current[part];
  }
  current[parts.at(-1)] = value;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function extractJsonText(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) throw new Error('Gemini returned no translation content');
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) return trimmed;
  const fenced = extractFencedJsonText(trimmed);
  if (fenced) return fenced;
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first >= 0 && last > first) return trimmed.slice(first, last + 1);
  throw new Error('Gemini returned non-JSON translation content');
}

function extractFencedJsonText(text) {
  if (!text.startsWith('```')) {
    return null;
  }

  const firstLineEnd = text.indexOf('\n');
  if (firstLineEnd < 0) {
    return null;
  }

  const fenceInfo = text.slice(3, firstLineEnd).trim();
  if (fenceInfo && fenceInfo.toLowerCase() !== 'json') {
    return null;
  }

  const closingFenceStart = text.lastIndexOf('```');
  if (closingFenceStart <= firstLineEnd) {
    return null;
  }

  const fenced = text.slice(firstLineEnd + 1, closingFenceStart).trim();
  return fenced || null;
}

function parseArgs(values) {
  const parsed = {};
  for (const value of values) {
    if (!value.startsWith('--')) continue;
    const argument = value.slice(2);
    const separator = argument.indexOf('=');
    const rawKey = separator < 0 ? argument : argument.slice(0, separator);
    const rawValue = separator < 0 ? undefined : argument.slice(separator + 1);
    parsed[rawKey] = rawValue === undefined || rawValue === '' ? true : rawValue;
  }
  return parsed;
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index < 0) continue;
    const key = trimmed.slice(0, index).trim();
    const value = stripBoundingQuotes(trimmed.slice(index + 1).trim());
    if (!process.env[key]) process.env[key] = value;
  }
}

function stripBoundingQuotes(value) {
  if (value.length < 2) {
    return value;
  }

  const first = value[0];
  const last = value.at(-1);
  if ((first === "'" || first === '"') && first === last) {
    return value.slice(1, -1);
  }

  return value;
}
