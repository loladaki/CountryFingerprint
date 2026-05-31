#!/usr/bin/env node
/**
 * sync-backend-fallbacks.mjs — push the refreshed country values into
 * the backend's FB_STATS object in server.js, so that when the backend
 * itself can't reach Eurostat (e.g. transient outage), it still serves
 * values consistent with what the frontend shows in its static fallback.
 *
 * Reads canonical values from site/src/data/*.json and rewrites the
 * matching `XX: { unemp: …, youth_unemp: …, gdp: …, inflation: …, min_wage: … }`
 * lines in server.js. Preserves formatting.
 *
 * Also propagates the refreshed min-wage labels (e.g. "€1,073 min")
 * into site/src/pages/index.astro `highlights.tax` field on the
 * country cards.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DATA_DIR = join(ROOT, 'site', 'src', 'data');
const SERVER_JS = join(ROOT, 'server.js');
const INDEX_ASTRO = join(ROOT, 'site', 'src', 'pages', 'index.astro');

const EU27 = ['pt','es','fr','de','it','nl','ie','be','at','se','pl','cz','gr','dk','fi','ee','lv','lt','hu','sk','si','hr','ro','bg','lu','mt','cy'];

// ── Read canonical values from JSONs ─────────────────────────────────────
const all = {};
for (const c of EU27) {
  all[c] = JSON.parse(readFileSync(join(DATA_DIR, `${c}.json`), 'utf8'));
}

// ── 1. Update server.js FB_STATS ─────────────────────────────────────────
let serverText = readFileSync(SERVER_JS, 'utf8');
const serverChanges = [];

for (const c of EU27) {
  const d = all[c];
  const unemp = d.stats.unemployment.value;
  const youth = d.stats.youthUnemp.value;
  const gdp = d.stats.gdp.value;
  const infl = d.stats.inflation.value;
  const mw = d.stats.minWage.value;

  // Locate the existing FB_STATS line for this country and rewrite the
  // dynamic fields. Lines look like:
  //   pt: { unemp: 5.8,  youth_unemp: 18.1, gdp: 2.4, inflation: 3.0, min_wage: 920 },
  //
  // The trailing comment after `null /* … */` (Italy, Austria, etc.) stays.
  const re = new RegExp(`(\\b${c}:\\s*\\{\\s*unemp:\\s*)[-\\d.]+(,\\s*youth_unemp:\\s*)[-\\d.]+(,\\s*gdp:\\s*)[-\\d.]+(,\\s*inflation:\\s*)[-\\d.]+(,\\s*min_wage:\\s*)(?:[-\\d.]+|null)`);
  if (re.test(serverText)) {
    const mwLit = mw === null ? 'null' : String(mw);
    serverText = serverText.replace(re, `$1${unemp}$2${youth}$3${gdp}$4${infl}$5${mwLit}`);
    serverChanges.push(c);
  } else {
    console.warn(`[server.js] no FB_STATS match for ${c}`);
  }
}
writeFileSync(SERVER_JS, serverText, 'utf8');
console.log(`[server.js] FB_STATS rows refreshed: ${serverChanges.length}/${EU27.length}`);

// ── 2. Update index.astro highlights.tax min-wage labels ─────────────────
let indexText = readFileSync(INDEX_ASTRO, 'utf8');
const indexChanges = [];

for (const c of EU27) {
  const d = all[c];
  const mw = d.stats.minWage.value;
  if (mw === null) continue;       // skip non-statutory
  const newLabel = `€${mw.toLocaleString('en-US')} min`;

  // Match: { ...c, slug: 'country', blurb: '…', highlights: { ..., tax: '€XXX min' } }
  // We rewrite only `tax: '€…'` rows that look like min-wage labels.
  const re = new RegExp(`(\\{\\s*\\.\\.\\.${c},[^}]*?tax:\\s*')€[\\d,]+ min(')`, 's');
  if (re.test(indexText)) {
    indexText = indexText.replace(re, `$1${newLabel}$2`);
    indexChanges.push(`${c} → "${newLabel}"`);
  }
}
writeFileSync(INDEX_ASTRO, indexText, 'utf8');
console.log(`[index.astro] highlights.tax refreshed: ${indexChanges.length}`);
for (const c of indexChanges) console.log(`  ${c}`);
