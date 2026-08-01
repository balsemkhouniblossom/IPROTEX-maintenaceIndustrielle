import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI } from '@google/genai';

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
    assertPlaceholdersMatch(key, input[key], parsed[key]);
  }
  return parsed;
}

function assertPlaceholdersMatch(key, source, translated) {
  const sourcePlaceholders = placeholders(source);
  const translatedPlaceholders = placeholders(String(translated));
  if (sourcePlaceholders.join('|') !== translatedPlaceholders.join('|')) {
    throw new Error(
      `Placeholder mismatch for ${key}: expected [${sourcePlaceholders.join(', ')}], got [${translatedPlaceholders.join(', ')}]`,
    );
  }
}

function placeholders(value) {
  return [...String(value).matchAll(/\{[^{}]+\}/g)].map((match) => match[0]).sort();
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
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]?.trim()) return fenced[1].trim();
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first >= 0 && last > first) return trimmed.slice(first, last + 1);
  throw new Error('Gemini returned non-JSON translation content');
}

function parseArgs(values) {
  const parsed = {};
  for (const value of values) {
    if (!value.startsWith('--')) continue;
    const [rawKey, rawValue] = value.slice(2).split(/=(.*)/s);
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
    const value = trimmed.slice(index + 1).trim().replace(/^['"]|['"]$/g, '');
    if (!process.env[key]) process.env[key] = value;
  }
}
