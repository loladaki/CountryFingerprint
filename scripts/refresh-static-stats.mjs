#!/usr/bin/env node
/**
 * refresh-static-stats.mjs — pull the annual Eurostat indicators that
 * the live API doesn't currently serve, and apply them to the static
 * country JSONs.
 *
 * Today's targets (all annual datasets):
 *   - life expectancy at birth     → demo_mlexpec (age=Y_LT1, sex=T, unit=YR)
 *   - practising physicians /1000  → hlth_rs_prsrg (per 100k → /100 to get /1000)
 *
 * For each indicator we keep the most recent year that Eurostat returns
 * (different countries publish at different lags).
 *
 * Usage: node scripts/refresh-static-stats.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'site', 'src', 'data');

const EU27 = ['pt','es','fr','de','it','nl','ie','be','at','se','pl','cz','gr','dk','fi','ee','lv','lt','hu','sk','si','hr','ro','bg','lu','mt','cy'];

// Eurostat uses 'EL' for Greece, not 'GR'
const toEurostat = (code) => (code === 'gr' ? 'EL' : code.toUpperCase());
const fromEurostat = (code) => (code === 'EL' ? 'gr' : code.toLowerCase());

const GEO_LIST = EU27.map(toEurostat);

async function fetchEurostatJSON(dataset, params) {
  let qs = 'format=JSON&lang=EN';
  for (const [k, v] of Object.entries(params)) {
    const vals = Array.isArray(v) ? v : [v];
    for (const val of vals) qs += `&${k}=${encodeURIComponent(val)}`;
  }
  const url = `https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/${dataset}?${qs}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${dataset}`);
  return res.json();
}

/**
 * Eurostat returns JSON-stat 2.0:
 *   json.id    = ordered dim names, e.g. ['freq','unit','sex','age','geo','time']
 *   json.size  = matching dim sizes, e.g. [1,1,1,1,27,5]
 *   json.value = { "flatIndex": value }  (flat = row-major over the dim sizes)
 *
 * To recover a (geo, time) coord from a flat index we treat the dims as a
 * row-major multi-dim array and divide-modulo against stride sizes.
 */
function extractLatestPerGeo(json) {
  const dimIds  = json.id;
  const sizes   = json.size;
  const geoIdx  = dimIds.indexOf('geo');
  const timeIdx = dimIds.indexOf('time');
  if (geoIdx < 0 || timeIdx < 0) throw new Error('no geo/time dims');

  // Row-major stride for dim i = product of sizes[i+1..end]
  const strides = sizes.map((_, i) => sizes.slice(i + 1).reduce((a, b) => a * b, 1));

  const idxToGeo = {};
  for (const [code, i] of Object.entries(json.dimension.geo.category.index)) idxToGeo[i] = code;
  const idxToYear = {};
  for (const [yr, i]   of Object.entries(json.dimension.time.category.index)) idxToYear[i] = yr;

  const result = {};
  for (const [flat, value] of Object.entries(json.value)) {
    if (value == null) continue;
    const f = Number(flat);
    const geoPos  = Math.floor(f / strides[geoIdx])  % sizes[geoIdx];
    const timePos = Math.floor(f / strides[timeIdx]) % sizes[timeIdx];
    const geoCode = idxToGeo[geoPos];
    const year    = idxToYear[timePos];
    if (!geoCode || !year) continue;
    const prev = result[geoCode];
    if (!prev || year > prev.year) result[geoCode] = { year, value };
  }
  return result;
}

// ── Fetch all indicators ────────────────────────────────────────────────
console.log('Fetching demo_mlexpec (life expectancy at birth)…');
const leRaw = await fetchEurostatJSON('demo_mlexpec', {
  age: 'Y_LT1', sex: 'T', unit: 'YR', geo: GEO_LIST,
});
const lifeExp = extractLatestPerGeo(leRaw);

console.log('Fetching tour_occ_arnat (foreign tourist arrivals at accommodation)…');
const tourRaw = await fetchEurostatJSON('tour_occ_arnat', {
  c_resid: 'FOR', unit: 'NR', nace_r2: 'I551-I553', geo: GEO_LIST,
});
const tourists = extractLatestPerGeo(tourRaw);

// ── Apply to JSONs ──────────────────────────────────────────────────────
console.log('\n── Applying refreshed values ─────────────────────');

for (const code of EU27) {
  const path = join(DATA_DIR, `${code}.json`);
  let text = readFileSync(path, 'utf8');
  const eurostatCode = toEurostat(code);
  const changes = [];

  // Life expectancy
  const le = lifeExp[eurostatCode];
  if (le) {
    const newVal = Number(le.value.toFixed(1));
    const re = /("lifeExpectancy"\s*:\s*\{\s*"value"\s*:\s*)[-\d.]+/;
    if (re.test(text)) {
      const m = text.match(re);
      const old = m[0].split(':').pop().trim();
      if (Number(old) !== newVal) {
        text = text.replace(re, `$1${newVal}`);
        changes.push(`lifeExp ${old} → ${newVal} (${le.year})`);
      }
    }
  }

  // Foreign tourist arrivals at accommodation establishments
  const tr = tourists[eurostatCode];
  if (tr) {
    // Format as "X.XM" so the ticker and ranking can both consume it
    const millions = tr.value / 1_000_000;
    const newDisplay = millions >= 10
      ? `${millions.toFixed(0)}M`
      : `${millions.toFixed(1)}M`;
    // Also store the raw count so the rankings can sort numerically
    const rawVal = Math.round(tr.value);

    // Update stats.tourists.value (display string)
    const reStr = /("tourists"\s*:\s*\{\s*"value"\s*:\s*)"[^"]+"/;
    if (reStr.test(text)) {
      const old = text.match(reStr)[0];
      if (!old.includes(`"${newDisplay}"`)) {
        text = text.replace(reStr, `$1"${newDisplay}"`);
        changes.push(`tourists "${old.match(/"[^"]+"$/)[0]}" → "${newDisplay}" (${tr.year}, Eurostat)`);
      }
    }
    // Inject a numeric "raw" alongside, so home-page rankings work
    if (!/"tourists"\s*:\s*\{[^}]*"raw"/.test(text)) {
      text = text.replace(
        /("tourists"\s*:\s*\{\s*"value"\s*:\s*"[^"]+")/,
        `$1, "raw": ${rawVal}, "year": ${tr.year}, "source": "Eurostat tour_occ_arnat (foreign, all accommodation)"`
      );
    } else {
      // Refresh raw if already present
      text = text.replace(/("tourists"[^}]*"raw"\s*:\s*)\d+/, `$1${rawVal}`);
      text = text.replace(/("tourists"[^}]*"year"\s*:\s*)\d+/, `$1${tr.year}`);
    }
  }

  if (changes.length) {
    writeFileSync(path, text, 'utf8');
    console.log(`  [${code}] ${changes.join(', ')}`);
  }
}

console.log('\n✓ Refresh complete.');
