#!/usr/bin/env node
/**
 * apply-corrections.mjs — apply Eurostat-sourced refresh to country JSONs.
 *
 * Each correction is a delta from the static fallbacks. Source of truth:
 *  - inflation (HICP year-on-year, Dec 2025)         → Eurostat prc_hicp_manr
 *  - unemployment (most recent month, Apr 2026)      → Eurostat une_rt_m
 *  - minWage (2026-S1 in euros)                       → Eurostat earn_mw_cur
 *  - ecbRate (main refinancing rate)                  → ECB (cut to 2.00% on 2025-06-11)
 *
 * The script preserves the original JSON formatting by doing surgical
 * regex replacements rather than re-stringifying. It also updates the
 * matching last entry in history.{inflation,unemployment}, so the
 * trend charts stay aligned with the headline number.
 *
 * Verified against the live /api/stats endpoint on 2026-05-31.
 *
 * Usage: node scripts/apply-corrections.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'site', 'src', 'data');

// One ECB rate for the whole euro area
const ECB_RATE = 2.0;

// Per-country corrections — only fields that drift from the live API
const CORRECTIONS = {
  pt: { inflation: 2.4, minWage: 1073 },
  es: { inflation: 3.0, minWage: 1381 },
  fr: { inflation: 0.7, minWage: 1823 },
  de: { inflation: 2.0, minWage: 2343 },
  it: { inflation: 1.2 },                              // No statutory min wage
  nl: { inflation: 2.7, minWage: 2295 },
  ie: { unemployment: 4.8, inflation: 2.7, minWage: 2391 },
  be: { inflation: 2.2, minWage: 2112 },
  at: { inflation: 3.8 },                              // No statutory min wage
  se: { unemployment: 8.5, inflation: 2.1 },           // No statutory min wage
  pl: { inflation: 2.5, minWage: 1139 },
  cz: { inflation: 1.8, minWage: 924 },
  gr: { inflation: 2.9, minWage: 1027 },
  dk: { inflation: 1.9 },                              // No statutory min wage
  fi: { unemployment: 10.7, inflation: 1.7 },          // No statutory min wage
  ee: { inflation: 4.0, minWage: 886 },                // Already matched
  lv: { inflation: 3.4, minWage: 780 },
  lt: { inflation: 3.2, minWage: 1153 },
  hu: { inflation: 3.3, minWage: 838 },
  sk: { inflation: 4.1, minWage: 915 },
  si: { inflation: 2.6, minWage: 1278 },
  hr: { inflation: 3.8, minWage: 1050 },
  ro: { inflation: 8.6, minWage: 795 },
  bg: { inflation: 3.5, minWage: 620 },
  lu: { inflation: 3.3, minWage: 2704 },               // Min wage matched
  mt: { inflation: 2.4, minWage: 994 },
  cy: { inflation: 0.1, minWage: 1088 },
};

// ── Helpers ─────────────────────────────────────────────────────────────────
const updateStatValue = (text, key, newVal) => {
  // Matches:  "inflation":     { "value": 1.5 }
  // Preserves the leading whitespace + the rest of the object.
  const re = new RegExp(`("${key}"\\s*:\\s*\\{\\s*"value"\\s*:\\s*)[-\\d.]+`);
  if (!re.test(text)) return { text, changed: false };
  return { text: text.replace(re, `$1${newVal}`), changed: true };
};

const updateHistoryLast = (text, key, newVal) => {
  // Matches:  "inflation":    [0.3, 1.5, 1.9, 1.4, 0.7, 2.9, 9.2, 6.4, 2.6, 2.3]
  // and replaces the last element. We use a non-greedy match on everything
  // up to the final `]` and capture the last comma.
  const re = new RegExp(`("${key}"\\s*:\\s*\\[[^\\]]*,\\s*)[-\\d.]+(\\s*\\])`);
  if (!re.test(text)) return { text, changed: false };
  return { text: text.replace(re, `$1${newVal}$2`), changed: true };
};

// ── Apply ──────────────────────────────────────────────────────────────────
const summary = [];

for (const [code, fix] of Object.entries(CORRECTIONS)) {
  const path = join(DATA_DIR, `${code}.json`);
  let text = readFileSync(path, 'utf8');
  const changes = [];

  if (fix.inflation !== undefined) {
    const a = updateStatValue(text, 'inflation', fix.inflation);
    if (a.changed) { text = a.text; changes.push(`stats.inflation→${fix.inflation}`); }
    const b = updateHistoryLast(text, 'inflation', fix.inflation);
    if (b.changed) { text = b.text; changes.push(`history.inflation[last]→${fix.inflation}`); }
  }
  if (fix.unemployment !== undefined) {
    const a = updateStatValue(text, 'unemployment', fix.unemployment);
    if (a.changed) { text = a.text; changes.push(`stats.unemployment→${fix.unemployment}`); }
    const b = updateHistoryLast(text, 'unemployment', fix.unemployment);
    if (b.changed) { text = b.text; changes.push(`history.unemployment[last]→${fix.unemployment}`); }
  }
  if (fix.minWage !== undefined) {
    const a = updateStatValue(text, 'minWage', fix.minWage);
    if (a.changed) { text = a.text; changes.push(`stats.minWage→${fix.minWage}`); }
  }

  // Always refresh ECB rate (one value EU-wide)
  const ecb = updateStatValue(text, 'ecbRate', ECB_RATE);
  if (ecb.changed) { text = ecb.text; changes.push(`stats.ecbRate→${ECB_RATE}`); }

  writeFileSync(path, text, 'utf8');
  summary.push({ code, changes });
}

// ── Report ───────────────────────────────────────────────────────────────────
console.log('── Corrections applied ─────────────────────────────────');
for (const s of summary) {
  if (s.changes.length === 0) {
    console.log(`  [${s.code}] (no fields needed updating)`);
  } else {
    console.log(`  [${s.code}] ${s.changes.join(', ')}`);
  }
}
console.log(`\nTotal: ${summary.length} files inspected.`);
