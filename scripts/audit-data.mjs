#!/usr/bin/env node
/**
 * audit-data.mjs — Internal consistency audit for the country JSON files.
 *
 * Runs entirely offline. Checks:
 *  - All 27 country files are present
 *  - history arrays have matching lengths
 *  - history[last year] is close to stats[same key] (drift detection)
 *  - euAvg arrays are byte-identical across all countries
 *  - Ticker text values match stats values where possible
 *  - Fuel prices in fuelFallback match the ticker text values
 *  - Stats values fall within plausible ranges
 *
 * Usage: node scripts/audit-data.mjs
 *
 * Exits 0 if clean, 1 if issues found.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'site', 'src', 'data');

const EU27 = ['pt','es','fr','de','it','nl','ie','be','at','se','pl','cz','gr','dk','fi','ee','lv','lt','hu','sk','si','hr','ro','bg','lu','mt','cy'];

// ── Load all country JSONs ──────────────────────────────────────────────────
const data = {};
for (const code of EU27) {
  const f = join(DATA_DIR, `${code}.json`);
  if (!existsSync(f)) {
    console.error(`✗ Missing data file: ${code}.json`);
    process.exit(2);
  }
  data[code] = JSON.parse(readFileSync(f, 'utf8'));
}

const issues = [];
const add = (severity, code, msg, detail = '') => issues.push({ severity, code, msg, detail });

// Reference EU averages (taken from pt.json as canonical)
const REF_EU_AVG = data.pt.history.euAvg;
const REF_YEARS = data.pt.history.years;

// ── Per-country checks ──────────────────────────────────────────────────────
for (const code of EU27) {
  const d = data[code];

  // 1. Years array
  if (JSON.stringify(d.history.years) !== JSON.stringify(REF_YEARS)) {
    add('error', code, 'history.years differs from canonical (pt)', JSON.stringify(d.history.years));
  }

  // 2. History array lengths match years length
  const yL = d.history.years.length;
  for (const k of ['gdp', 'unemployment', 'inflation', 'publicDebt']) {
    if (!Array.isArray(d.history[k])) {
      add('error', code, `history.${k} is not an array`);
      continue;
    }
    if (d.history[k].length !== yL) {
      add('error', code, `history.${k} length ${d.history[k].length} ≠ years length ${yL}`);
    }
  }

  // 3. euAvg byte-identical across files
  for (const k of Object.keys(REF_EU_AVG)) {
    const ref = JSON.stringify(REF_EU_AVG[k]);
    const got = JSON.stringify(d.history.euAvg?.[k]);
    if (ref !== got) {
      add('error', code, `euAvg.${k} drift`, `expected ${ref}, got ${got}`);
    }
  }

  // 4. history[last year] should match stats[key] (drift tolerance 0.5pp)
  const lastYearChecks = [
    ['gdp', 'gdp'],
    ['unemployment', 'unemployment'],
    ['inflation', 'inflation'],
    ['publicDebt', 'publicDebt'],
  ];
  for (const [histK, statK] of lastYearChecks) {
    const last = d.history[histK]?.[d.history[histK].length - 1];
    const stat = d.stats[statK]?.value;
    if (typeof last === 'number' && typeof stat === 'number') {
      if (Math.abs(last - stat) > 0.5) {
        add('warn', code, `history.${histK}[last=${last}] differs from stats.${statK}.value=${stat} by >0.5`);
      }
    }
  }

  // 5. Plausible-range checks
  const fb = d.fuelFallback;
  if (fb?.gasolina95?.atual && (fb.gasolina95.atual < 0.9 || fb.gasolina95.atual > 3.0)) {
    add('warn', code, `gasolina95 ${fb.gasolina95.atual} outside plausible range €0.90–€3.00/L`);
  }
  if (fb?.gasoleo?.atual && (fb.gasoleo.atual < 0.9 || fb.gasoleo.atual > 3.0)) {
    add('warn', code, `gasoleo ${fb.gasoleo.atual} outside plausible range €0.90–€3.00/L`);
  }
  const mw = d.stats.minWage?.value;
  if (mw !== null && mw !== undefined && typeof mw === 'number' && (mw < 400 || mw > 3500)) {
    add('warn', code, `minWage €${mw} outside plausible range €400–€3,500`);
  }
  const unemp = d.stats.unemployment?.value;
  if (typeof unemp === 'number' && (unemp < 1 || unemp > 25)) {
    add('warn', code, `unemployment ${unemp}% outside plausible range 1–25%`);
  }
  const le = d.stats.lifeExpectancy?.value;
  if (typeof le === 'number' && (le < 70 || le > 86)) {
    add('warn', code, `lifeExpectancy ${le}y outside plausible range 70–86y`);
  }

  // 6. Ticker text should reference the same fuel + unemp + gdp values as stats
  const ticker = d.tickerItems || [];
  const tFuel95 = ticker.find((t) => t.id === 'tick-g95');
  if (tFuel95 && fb?.gasolina95?.atual) {
    const expected = `${fb.gasolina95.atual.toFixed(3)} €/L`;
    if (tFuel95.value !== expected) {
      add('warn', code, `ticker tick-g95 "${tFuel95.value}" ≠ fallback "${expected}"`);
    }
  }
  const tFuelGsl = ticker.find((t) => t.id === 'tick-gsl');
  if (tFuelGsl && fb?.gasoleo?.atual) {
    const expected = `${fb.gasoleo.atual.toFixed(3)} €/L`;
    if (tFuelGsl.value !== expected) {
      add('warn', code, `ticker tick-gsl "${tFuelGsl.value}" ≠ fallback "${expected}"`);
    }
  }
  // Format helpers must match LiveDataLoader.astro exactly
  const fmtPct = (n) => `${n.toFixed(1)}%`;
  const fmtSgn = (n) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;

  const tUnemp = ticker.find((t) => t.id === 'tick-unemp');
  if (tUnemp && typeof d.stats.unemployment?.value === 'number') {
    const expected = fmtPct(d.stats.unemployment.value);
    if (tUnemp.value !== expected) {
      add('warn', code, `ticker tick-unemp "${tUnemp.value}" ≠ stats "${expected}"`);
    }
  }
  const tGdp = ticker.find((t) => t.id === 'tick-gdp');
  if (tGdp && typeof d.stats.gdp?.value === 'number') {
    const expected = fmtSgn(d.stats.gdp.value);
    if (tGdp.value !== expected) {
      add('warn', code, `ticker tick-gdp "${tGdp.value}" ≠ stats "${expected}"`);
    }
  }

  // 7. footerSources sanity
  if (!Array.isArray(d.footerSources) || d.footerSources.length < 3) {
    add('warn', code, `footerSources weak (${d.footerSources?.length || 0} entries)`);
  } else {
    for (const s of d.footerSources) {
      if (!s.url?.startsWith('http')) add('warn', code, `footerSource ${s.name} url not absolute`, s.url);
    }
  }

  // 8. Map regions sanity
  const regions = d.map?.regions || {};
  const nRegions = Object.keys(regions).length;
  if (nRegions === 0) {
    add('error', code, 'map.regions empty');
  }
  for (const [rid, r] of Object.entries(regions)) {
    if (!r.name) add('warn', code, `region ${rid} missing name`);
    if (typeof r.salary !== 'number') add('warn', code, `region ${rid} missing salary`);
    if (typeof r.population !== 'number') add('warn', code, `region ${rid} missing population`);
  }
}

// ── Cross-country sanity ─────────────────────────────────────────────────────
// Identify min-wage outliers vs the median to spot typos like €70 vs €700
const wages = EU27.map((c) => data[c].stats.minWage?.value).filter((v) => typeof v === 'number');
const sortedWages = [...wages].sort((a, b) => a - b);
const median = sortedWages[Math.floor(sortedWages.length / 2)];
for (const c of EU27) {
  const w = data[c].stats.minWage?.value;
  if (typeof w === 'number' && (w < median / 5 || w > median * 5)) {
    add('warn', c, `minWage €${w} is far from EU median €${median} (>5× away — possible typo)`);
  }
}

// ── Report ───────────────────────────────────────────────────────────────────
const errors = issues.filter((i) => i.severity === 'error');
const warns = issues.filter((i) => i.severity === 'warn');

console.log(`\n── EU-27 data audit ──────────────────────────────────`);
console.log(`Files checked: ${EU27.length}`);
console.log(`Errors:        ${errors.length}`);
console.log(`Warnings:      ${warns.length}\n`);

if (errors.length) {
  console.log(`── ERRORS ──`);
  for (const i of errors) {
    console.log(`  [${i.code}] ${i.msg}${i.detail ? ' · ' + i.detail : ''}`);
  }
  console.log();
}
if (warns.length) {
  console.log(`── WARNINGS ──`);
  for (const i of warns) {
    console.log(`  [${i.code}] ${i.msg}${i.detail ? ' · ' + i.detail : ''}`);
  }
  console.log();
}
if (!errors.length && !warns.length) {
  console.log('✓ All checks passed — no internal inconsistencies found.');
}

process.exit(errors.length ? 1 : 0);
