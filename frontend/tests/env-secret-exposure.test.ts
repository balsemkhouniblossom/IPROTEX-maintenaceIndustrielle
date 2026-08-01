import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// Server-only credential names that must never be referenced from
// `frontend/src` (which ships to the browser) or from `next.config.mjs`'s
// build-time `env` key (which would bake a value into the client bundle at
// build time even without a runtime `process.env` read). Next.js only ever
// exposes a variable to client code if its name is explicitly prefixed
// `NEXT_PUBLIC_`, so the real guarantee this test provides is the inverse
// assertion below (every `process.env.X` in `src` is either `NODE_ENV` or
// `NEXT_PUBLIC_`-prefixed) — this list is a belt-and-suspenders check for
// the specific credentials a leak would be most damaging for.
const FORBIDDEN_SECRET_NAMES = [
  "JWT_SECRET",
  "JWT_REFRESH_SECRET",
  "EMAIL_VERIFICATION_SECRET",
  "GOOGLE_LOGIN_EXCHANGE_ENCRYPTION_KEY",
  "MONGODB_URI",
  "SMTP_USER",
  "SMTP_PASS",
  "BREVO_API_KEY",
  "GOOGLE_CLIENT_SECRET",
  "SUPABASE_SECRET_KEY",
  "GEMINI_API_KEY",
];

const ALLOWED_PROCESS_ENV_NAMES = new Set(["NODE_ENV"]);

const SRC_DIR = path.join(process.cwd(), "src");
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs"]);

function listSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir)) {
    const fullPath = path.join(dir, entry);
    const stats = fs.statSync(fullPath);
    if (stats.isDirectory()) {
      files.push(...listSourceFiles(fullPath));
    } else if (SOURCE_EXTENSIONS.has(path.extname(entry))) {
      files.push(fullPath);
    }
  }
  return files;
}

test("no server-only secret name is ever referenced anywhere in frontend/src", () => {
  const offenders: string[] = [];
  for (const file of listSourceFiles(SRC_DIR)) {
    const contents = fs.readFileSync(file, "utf8");
    for (const secretName of FORBIDDEN_SECRET_NAMES) {
      if (contents.includes(secretName)) {
        offenders.push(`${file} references ${secretName}`);
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `Found server-only secret names referenced in frontend source (would risk shipping to the browser bundle):\n${offenders.join("\n")}`,
  );
});

test("every process.env reference in frontend/src is NODE_ENV or NEXT_PUBLIC_-prefixed", () => {
  const violations: string[] = [];
  const pattern = /process\.env(?:\.([A-Za-z0-9_]+)|\[["'`]([A-Za-z0-9_]+)["'`]\])/g;

  for (const file of listSourceFiles(SRC_DIR)) {
    const contents = fs.readFileSync(file, "utf8");
    for (const match of contents.matchAll(pattern)) {
      const varName = match[1] ?? match[2];
      if (!varName) continue;
      if (
        ALLOWED_PROCESS_ENV_NAMES.has(varName) ||
        varName.startsWith("NEXT_PUBLIC_")
      ) {
        continue;
      }
      violations.push(`${file} reads process.env.${varName}`);
    }
  }

  assert.deepEqual(
    violations,
    [],
    `Found a frontend process.env reference that is neither NODE_ENV nor NEXT_PUBLIC_-prefixed — Next.js would still refuse to inline it client-side, but a server-only build step or a future refactor could expose it. Fix by removing the reference or renaming the variable with a NEXT_PUBLIC_ prefix if it is genuinely safe to be public:\n${violations.join("\n")}`,
  );
});

test("next.config.mjs never re-injects a secret via a build-time env key", () => {
  const configPath = path.join(process.cwd(), "next.config.mjs");
  const contents = fs.readFileSync(configPath, "utf8");

  for (const secretName of FORBIDDEN_SECRET_NAMES) {
    assert.equal(
      contents.includes(secretName),
      false,
      `next.config.mjs references ${secretName} — Next.js bakes anything under an "env" config key into the client bundle at build time regardless of naming convention`,
    );
  }
});

test("bundled frontend source does not emit console.log debug output", () => {
  const offenders: string[] = [];
  for (const file of listSourceFiles(SRC_DIR)) {
    const contents = fs.readFileSync(file, "utf8");
    if (/\bconsole\.log\s*\(/.test(contents)) {
      offenders.push(file);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `Found console.log debug output in bundled frontend source:\n${offenders.join("\n")}`,
  );
});
