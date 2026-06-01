#!/usr/bin/env node
/**
 * upgrade-map-resolution.mjs — switch every country JSON from the
 * coarsest Nuts2json geometry (20M) to the finest stable one (03M).
 *
 * 03M is roughly 6–8× the bytes of 20M but the geometry actually looks
 * professional — no more jagged sketch-style coastlines on small
 * countries. jsdelivr caches both per-URL aggressively, so the cost is
 * paid once per visitor.
 *
 * Idempotent. Run as: node scripts/upgrade-map-resolution.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'site', 'src', 'data');

const EU27 = ['pt','es','fr','de','it','nl','ie','be','at','se','pl','cz','gr','dk','fi','ee','lv','lt','hu','sk','si','hr','ro','bg','lu','mt','cy'];

const changes = [];
for (const code of EU27) {
  const path = join(DATA_DIR, `${code}.json`);
  let text = readFileSync(path, 'utf8');
  // /4326/20M/ → /4326/03M/
  // /4326/10M/ → /4326/03M/   (in case some files were on 10M)
  const updated = text.replace(/\/4326\/(20M|10M)\//g, '/4326/03M/');
  if (updated !== text) {
    writeFileSync(path, updated, 'utf8');
    changes.push(code);
  }
}

if (changes.length === 0) {
  console.log('✓ All country maps already at 03M.');
} else {
  console.log(`Upgraded to 03M resolution: ${changes.join(', ')} (${changes.length}/${EU27.length})`);
}
