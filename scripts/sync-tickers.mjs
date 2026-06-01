#!/usr/bin/env node
/**
 * sync-tickers.mjs — keep tickerItems strings in sync with stats values.
 *
 * The ticker entries are display strings (e.g. "5.8%", "€920", "+2.4%")
 * that visitors see when the live API is asleep. They must reflect the
 * canonical values in stats/fuelFallback so we don't ship contradictory
 * numbers between the ticker and the rest of the page.
 *
 * The script updates, by ID where available:
 *   tick-g95   ← fuelFallback.gasolina95.atual
 *   tick-gsl   ← fuelFallback.gasoleo.atual
 *   tick-unemp ← stats.unemployment.value
 *   tick-gdp   ← stats.gdp.value (with leading + sign)
 *
 * And by label heuristic for the unlabelled min-wage row when it's a
 * pure "€XXX" string (we skip rows that embed local currency, e.g.
 * "HUF 290k (~€720)", to avoid drifting the FX conversion).
 *
 * Idempotent — safe to re-run after each apply-corrections pass.
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'site', 'src', 'data');

const EU27 = ['pt','es','fr','de','it','nl','ie','be','at','se','pl','cz','gr','dk','fi','ee','lv','lt','hu','sk','si','hr','ro','bg','lu','mt','cy'];

const fmtPct = (n) => `${n.toFixed(1)}%`;
const fmtSgn = (n) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;
const fmtEur = (n) => `€${n.toLocaleString('en-US')}`;
const fmtFuel = (n) => `${n.toFixed(3)} €/L`;

// Detect a min-wage ticker entry by icon + presence of EUR amount or
// recognised min-wage label tokens.
const isMinWageTicker = (t) => {
  if (t.icon !== '💶') return false;
  const label = String(t.label || '').toLowerCase();
  if (/min ?wage|wage|smic|rmmg|smi|mindestlohn|salario|salaire/.test(label)) return true;
  return /€/.test(String(t.value || ''));
};

// Rewrite the euro portion of a ticker value while preserving the rest.
// Patterns handled:
//   "€XXX"            → "€NEW"
//   "XXX €"           → "€NEW"          (normalise)
//   "€XXX (note)"     → "€NEW (note)"
//   "XXX € (note)"    → "€NEW (note)"
//   "CUR amount (~€XXX)" → "CUR amount (~€NEW)"  (local-currency rows)
const rewriteMinWageValue = (oldVal, newAmt) => {
  if (!oldVal) return oldVal;
  // C: local-currency with embedded "~€XXX"
  if (/~€[\d,]+/.test(oldVal)) {
    return oldVal.replace(/~€[\d,]+/, `~€${newAmt.toLocaleString('en-US')}`);
  }
  // Extract a parenthetical note if present
  const noteMatch = oldVal.match(/\s*(\(.+\))\s*$/);
  const note = noteMatch ? ' ' + noteMatch[1] : '';
  // Strip everything else to a clean "€NEW" + note
  return `${fmtEur(newAmt)}${note}`;
};

const summary = [];

for (const code of EU27) {
  const path = join(DATA_DIR, `${code}.json`);
  const d = JSON.parse(readFileSync(path, 'utf8'));
  let text = readFileSync(path, 'utf8');
  const changes = [];

  const apply = (oldStr, newStr, label) => {
    if (oldStr === newStr || !oldStr) return;
    const safe = oldStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`("value"\\s*:\\s*)"${safe}"`);
    if (re.test(text)) {
      text = text.replace(re, `$1"${newStr}"`);
      changes.push(`${label}: "${oldStr}" → "${newStr}"`);
    }
  };

  // Walk tickerItems looking for IDs we know how to refresh
  for (const t of d.tickerItems || []) {
    if (t.id === 'tick-g95' && d.fuelFallback?.gasolina95?.atual != null) {
      apply(t.value, fmtFuel(d.fuelFallback.gasolina95.atual), 'tick-g95');
    } else if (t.id === 'tick-gsl' && d.fuelFallback?.gasoleo?.atual != null) {
      apply(t.value, fmtFuel(d.fuelFallback.gasoleo.atual), 'tick-gsl');
    } else if (t.id === 'tick-unemp' && typeof d.stats.unemployment?.value === 'number') {
      apply(t.value, fmtPct(d.stats.unemployment.value), 'tick-unemp');
    } else if (t.id === 'tick-gdp' && typeof d.stats.gdp?.value === 'number') {
      apply(t.value, fmtSgn(d.stats.gdp.value), 'tick-gdp');
    } else if (isMinWageTicker(t) && typeof d.stats.minWage?.value === 'number') {
      // Skip null-min-wage countries (CCNL/collective bargaining only)
      apply(t.value, rewriteMinWageValue(t.value, d.stats.minWage.value), 'min-wage');
    } else if (
      // Tourists row — icon ✈ or label contains "tourists"
      (t.icon === '✈' || /tourists/i.test(t.label || '')) &&
      typeof d.stats.tourists?.value === 'string'
    ) {
      apply(t.value, d.stats.tourists.value, 'tourists');
    }
  }

  if (changes.length) {
    writeFileSync(path, text, 'utf8');
    summary.push({ code, changes });
  }
}

if (summary.length === 0) {
  console.log('✓ All tickers already in sync.');
} else {
  console.log('── Tickers refreshed ───────────────────────');
  for (const s of summary) {
    console.log(`  [${s.code}]`);
    for (const c of s.changes) console.log(`    ${c}`);
  }
  console.log(`\nFiles touched: ${summary.length}`);
}
