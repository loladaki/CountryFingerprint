#!/usr/bin/env node
/**
 * verify-nuts-codes.mjs — confirm that every NUTS code referenced in
 * map.regions of each country JSON actually exists in the Eurostat
 * geojson at the URL the country declares.
 *
 * A missing code shows up as a transparent region on the map (the data
 * is there but no shape can be filled). This script catches those
 * silent gaps before deploy.
 *
 * Fetches the geojson files once per URL (cached), so the run is fast
 * even though it covers 27 countries.
 *
 * Usage: node scripts/verify-nuts-codes.mjs
 *
 * Exit 0 if all clean, 1 if any unknown codes found.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'site', 'src', 'data');

const EU27 = ['pt','es','fr','de','it','nl','ie','be','at','se','pl','cz','gr','dk','fi','ee','lv','lt','hu','sk','si','hr','ro','bg','lu','mt','cy'];

const fetchCache = new Map();
async function fetchFeatures(url) {
  if (fetchCache.has(url)) return fetchCache.get(url);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${url}`);
  const raw = await res.json();

  // Could be TopoJSON or GeoJSON
  let features;
  if (raw.objects) {
    features = [];
    for (const key of Object.keys(raw.objects)) {
      const g = raw.objects[key];
      if (g.geometries) features.push(...g.geometries);
    }
  } else if (raw.features) {
    features = raw.features;
  } else {
    features = [];
  }
  fetchCache.set(url, features);
  return features;
}

// Run a country's own featureIdResolver against the geojson to get the
// IDs it would extract — same logic as InteractiveMap at runtime.
function idsForCountry(features, resolverSrc) {
  const resolve = new Function('f', 'return (' + resolverSrc + ')(f);');
  const ids = new Set();
  for (const f of features) {
    try {
      const id = resolve(f);
      if (id) ids.add(String(id));
    } catch { /* ignore individual feature errors */ }
  }
  return ids;
}

const issues = [];
const ok = [];

for (const code of EU27) {
  const d = JSON.parse(readFileSync(join(DATA_DIR, `${code}.json`), 'utf8'));
  const url = d.map?.geojsonUrl;
  const regions = d.map?.regions || {};
  const localRegions = !url || url.startsWith('/');

  if (localRegions) {
    ok.push({ code, status: 'skipped (local geojson)', n: Object.keys(regions).length });
    continue;
  }

  try {
    const features = await fetchFeatures(url);
    const validIds = idsForCountry(features, d.map.featureIdResolver);
    const declared = Object.keys(regions);
    const missing  = declared.filter((k) => !validIds.has(k));
    if (missing.length) {
      issues.push({ code, url, missing, declared, validSample: [...validIds].slice(0, 10) });
    } else {
      ok.push({ code, status: 'ok', n: declared.length });
    }
  } catch (e) {
    issues.push({ code, url, error: e.message });
  }
}

console.log('── NUTS code verification ─────────────────────');
for (const r of ok) console.log(`  [${r.code}] ${r.status} (${r.n ?? '?'} regions)`);
if (issues.length) {
  console.log('\n── ISSUES ──');
  for (const i of issues) {
    if (i.error) {
      console.log(`  [${i.code}] FETCH FAILED — ${i.error}`);
    } else {
      console.log(`  [${i.code}] MISSING: ${i.missing.join(', ')} (declared ${i.declared.length})`);
      console.log(`    valid sample: ${i.validSample.join(', ')}`);
      console.log(`    url=${i.url}`);
    }
  }
  process.exit(1);
}
console.log('\n✓ Every declared NUTS code resolves to a real shape.');
