#!/usr/bin/env node
/**
 * Authenticated Lighthouse audit for Admin/Technician/Operator routes.
 *
 * The app keeps its session in localStorage (not a readable cookie), so a
 * plain `lighthouse <url>` run never sees past the login page. This script
 * instead:
 *   1. Launches one real Chrome instance (via puppeteer-core) with a fixed
 *      CDP debugging port.
 *   2. For each role, drives the actual login form (same as a real user —
 *      no token-seeding shortcuts) and waits for the post-login redirect.
 *   3. Runs Lighthouse's Node API against that same Chrome instance (same
 *      `port`), so every audited tab shares the browser profile's
 *      cookies/localStorage the login just set.
 *   4. Clears storage + cookies before moving to the next role, so runs
 *      never leak a previous role's session.
 *
 * Requires the backend + frontend dev servers already running (see
 * BASE_URL/API_BASE_URL below), and the seeded Lighthouse test accounts —
 * run `npm run seed:lighthouse-users` in backend/ first.
 *
 * Usage: node scripts/lighthouse-authenticated.mjs [--threshold=0.9]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import lighthouse from 'lighthouse';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPORTS_DIR = path.join(__dirname, '..', 'lighthouse-reports');

const BASE_URL = process.env.LIGHTHOUSE_BASE_URL || 'http://localhost:3000';
const LOCALE = process.env.LIGHTHOUSE_LOCALE || 'en';
const CHROME_PATH =
  process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const DEBUG_PORT = Number(process.env.LIGHTHOUSE_CDP_PORT || 9222);
const PASSWORD = 'LighthouseTest123!';

const thresholdArg = process.argv.find((arg) => arg.startsWith('--threshold='));
const ACCESSIBILITY_THRESHOLD = thresholdArg ? Number(thresholdArg.split('=')[1]) : 0.9;

/** One entry per role: login credentials, expected post-login path, and
 * the authenticated routes worth auditing for that role. */
const ROLE_CONFIGS = [
  {
    role: 'admin',
    email: 'lighthouse-admin@gmao.local',
    dashboardPath: `/${LOCALE}`,
    routes: [
      { name: 'dashboard', path: `/${LOCALE}` },
      { name: 'work-orders', path: `/${LOCALE}/work-orders` },
      { name: 'maintenance-plans', path: `/${LOCALE}/maintenance-plans` },
      { name: 'reports', path: `/${LOCALE}/reports` },
      { name: 'users', path: `/${LOCALE}/users` },
    ],
  },
  {
    role: 'technician',
    email: 'lighthouse-technician@gmao.local',
    dashboardPath: `/${LOCALE}/technician`,
    routes: [
      { name: 'dashboard', path: `/${LOCALE}/technician` },
      { name: 'work-orders', path: `/${LOCALE}/technician/work-orders` },
      { name: 'interventions', path: `/${LOCALE}/technician/interventions` },
    ],
  },
  {
    role: 'operator',
    email: 'lighthouse-operator@gmao.local',
    dashboardPath: `/${LOCALE}/operator`,
    routes: [
      { name: 'dashboard', path: `/${LOCALE}/operator` },
      { name: 'report-problem', path: `/${LOCALE}/operator/report-problem` },
      { name: 'preventive', path: `/${LOCALE}/operator/preventive` },
    ],
  },
];

async function login(page, email) {
  // Next.js dev mode compiles each route on its first hit, which can take
  // well over 15s cold — generous timeouts here avoid flaking on that,
  // not on anything the app itself is slow at.
  await page.goto(`${BASE_URL}/${LOCALE}/auth/login`, { waitUntil: 'networkidle2', timeout: 45000 });
  await page.waitForSelector('#email', { timeout: 45000 });
  await page.type('#email', email);
  await page.type('#password', PASSWORD);
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 45000 }),
    page.click('button[type="submit"]'),
  ]);
}

async function clearSession(page) {
  const client = await page.target().createCDPSession();
  await client.send('Network.clearBrowserCookies');
  try {
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
  } catch {
    // No document context yet (e.g. first run before any navigation) — nothing to clear.
  }
}

function slugify(value) {
  return value.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
}

async function runLighthouse(port, url) {
  return lighthouse(url, {
    port,
    output: 'json',
    logLevel: 'error',
    onlyCategories: ['accessibility', 'best-practices'],
    formFactor: 'desktop',
    screenEmulation: { disabled: true },
    maxWaitForLoad: 60000,
  });
}

async function auditRoute(port, role, route) {
  const url = `${BASE_URL}${route.path}`;

  // A first-load NO_FCP (occluded tab, or a slow Next.js dev-mode cold
  // compile racing Lighthouse's own load timeout) is transient — one
  // retry clears it without masking a real accessibility regression,
  // since a genuine failure reproduces on the retry too.
  let result = await runLighthouse(port, url);
  if (result.lhr.runtimeError) {
    console.log(`\n    (retrying after ${result.lhr.runtimeError.code}) `);
    result = await runLighthouse(port, url);
  }

  const { categories, audits } = result.lhr;
  const accessibilityScore = categories.accessibility.score;
  const bestPracticesScore = categories['best-practices'].score;

  const failingAudits = Object.values(audits).filter(
    (audit) => audit.score !== null && audit.score < 1 && audit.scoreDisplayMode === 'binary',
  );

  const reportPath = path.join(REPORTS_DIR, `${role}-${slugify(route.name)}.json`);
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  fs.writeFileSync(reportPath, result.report);

  return {
    role,
    route: route.name,
    url,
    accessibilityScore,
    bestPracticesScore,
    runtimeError: result.lhr.runtimeError?.code ?? null,
    failingAudits: failingAudits.map((audit) => ({ id: audit.id, title: audit.title })),
    reportPath,
  };
}

async function main() {
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: [
      `--remote-debugging-port=${DEBUG_PORT}`,
      '--window-size=1440,900',
      // Lighthouse opens each audited route in its own new tab on this
      // same profile; without these, Chrome treats that tab as
      // "occluded" behind our login tab and throttles/never paints it,
      // which Lighthouse reports as a NO_FCP runtime error.
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-background-timer-throttling',
      '--disable-features=CalculateNativeWinOcclusion',
    ],
  });

  const results = [];

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });

    for (const config of ROLE_CONFIGS) {
      console.log(`\n=== ${config.role} ===`);
      await clearSession(page);
      await login(page, config.email);

      const landedOn = new URL(page.url()).pathname;
      if (!landedOn.startsWith(config.dashboardPath)) {
        throw new Error(
          `Login for ${config.role} did not land on ${config.dashboardPath} (got ${landedOn}) — aborting this role's audit.`,
        );
      }
      console.log(`Logged in as ${config.email}, landed on ${landedOn}`);

      for (const route of config.routes) {
        process.stdout.write(`  auditing ${route.name} (${route.path}) ... `);
        const result = await auditRoute(DEBUG_PORT, config.role, route);
        results.push(result);
        console.log(
          `accessibility=${result.accessibilityScore} best-practices=${result.bestPracticesScore}`,
        );
      }
    }
  } finally {
    await browser.close();
  }

  console.log('\n=== Summary ===');
  let anyBelowThreshold = false;
  for (const result of results) {
    if (result.runtimeError) {
      console.log(`[ERROR] ${result.role}/${result.route}: ${result.runtimeError} (page never painted — see report for detail)`);
      anyBelowThreshold = true;
      continue;
    }
    const status = result.accessibilityScore >= ACCESSIBILITY_THRESHOLD ? 'PASS' : 'FAIL';
    if (status === 'FAIL') anyBelowThreshold = true;
    console.log(
      `[${status}] ${result.role}/${result.route}: accessibility=${result.accessibilityScore} (threshold ${ACCESSIBILITY_THRESHOLD})`,
    );
    if (status === 'FAIL') {
      for (const audit of result.failingAudits) {
        console.log(`    - ${audit.id}: ${audit.title}`);
      }
    }
  }
  console.log(`\nReports written to ${REPORTS_DIR}`);

  if (anyBelowThreshold) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
