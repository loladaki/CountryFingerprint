# Data sources & freshness

This document is the **source-of-truth playbook** for every number on the
site. If you ever wonder "where does X come from?" or "how do I refresh
Y?", start here.

Last full audit: **2026-05-31** (against live Eurostat).

---

## Two data layers

The site is intentionally resilient — the same value can come from two
places depending on whether the backend is awake:

| Layer | Where | Refresh cadence | Use case |
|---|---|---|---|
| **Live API** | `server.js` on Render (`countryfingerprint.onrender.com`) | Re-fetches Eurostat every 12h, EU Oil Bulletin weekly, ECB on demand | Authoritative when the API is awake |
| **Static fallback** | `site/src/data/*.json` per country | Manually refreshed via `scripts/apply-corrections.mjs` | Shown when the API is asleep (Render free tier sleeps after 15 min) |

The **frontend always tries the API first**. If it times out (6 s for
fuel, 8 s for stats), it leaves the static values in place and flips
the `#live-badge` to the "offline" state.

Both layers must agree, otherwise visitors see different numbers depending
on the API state.

---

## Per-indicator inventory

### Backed by the live API (auto-refreshing)

| Indicator | API field | Source | Endpoint / dataset | Notes |
|---|---|---|---|---|
| Unemployment (monthly) | `eurostat[XX].unemp` | **Eurostat** | `une_rt_m` (s_adj=SA, age=TOTAL, sex=T, unit=PC_ACT) | Backend extracts most recent month. Falls back to `FB_STATS[XX].unemp` if missing. |
| Youth unemployment | `eurostat[XX].youth_unemp` | **Eurostat** | `une_rt_m` (age=Y15-24) | Same fallback path. |
| GDP growth (quarterly YoY) | `eurostat[XX].gdp` | **Eurostat** | `namq_10_gdp` (unit=CLV_PCH_A, na_item=B1GQ, s_adj=SCA) | |
| Inflation HICP (yearly %) | `eurostat[XX].inflation` | **Eurostat** | `prc_hicp_manr` (unit=RCH_A, coicop=CP00) | |
| Statutory minimum wage | `eurostat[XX].min_wage` | **Eurostat** | `earn_mw_cur` (currency=EUR) | Semestral values (2026-S1 etc). 5 countries return null (IT/AT/SE/DK/FI). |
| ECB main refinancing rate | `ecb_rate` | **ECB SDW** | `EUR1Y` series | Single value EU-wide. **Currently 2.00 %** since 2025-06-11. |
| Euribor 12M | `euribor_rate` | **EMMI** | Direct quote scrape | Single value EU-wide. |
| Petrol/Diesel (per country) | `combustiveis[XX_gasolina95]` etc. | **EU Oil Bulletin** | `fuel-prices.eu/weekly/llms.txt` (parsed) | Weekly. |
| Brent crude | `brent.preco` | **Yahoo Finance** | `BZ=F` quote | 30-min refresh. |

If you need to verify or override any of the above, edit
`server.js` → `FB_STATS` (per-country fallbacks) or `FB_FUEL`
(EU-wide defaults). Then run `scripts/sync-backend-fallbacks.mjs`
to propagate to the JSON files.

### Static-only (no live source — needs manual research)

These live exclusively in `site/src/data/XX.json` and the page
`.astro` files. They **don't** drift from the live API because there
is no live API value to compare against.

| Indicator | JSON path | Typical source | Refresh cadence |
|---|---|---|---|
| GDP per capita | `stats.gdpPerCapita.value` | Eurostat `nama_10_pc` | Annual |
| Total GDP | `stats.gdpTotalEuro.value` | Eurostat `nama_10_gdp` | Annual |
| Public debt | `stats.publicDebt.value` | Eurostat `gov_10dd_edpt1` | Annual |
| Budget balance | `stats.budgetBalance.value` | Eurostat `gov_10dd_edpt1` | Annual |
| Life expectancy | `stats.lifeExpectancy.value` | Eurostat `demo_mlexpec` | Annual |
| Population | `stats.population.value` | Eurostat `demo_pjan` | Annual |
| Tourists / revenue | `stats.tourists.value` / `tourismRevenue.value` | UNWTO + national tourism boards | Annual |
| Avg gross/net salary | `stats.avgGrossSalary.value` / `avgNetSalary.value` | National stats office | Annual |
| Happiness rank | `stats.happinessRank.value` | World Happiness Report | Annual |
| Regional data (map) | `map.regions[NUTS_ID].{salary,housing,rent,unemployment,population,crime,temperature,doctors,gdp}` | Eurostat NUTS2/NUTS3 + national | Annual |
| Historical series (2016–2025) | `history.{gdp,unemployment,inflation,publicDebt}` | Eurostat annual archives | Annual (just append a year) |
| EU averages (history) | `history.euAvg.{...}` | Eurostat aggregate | Should be **byte-identical** across all 27 files (the audit enforces this) |

### Narrative / page text (most subjective)

The notice prose, ComparisonTable rows ("EU avg"), and section
introductions in the page `.astro` files contain editorial claims and
qualitative descriptions. These should be revisited **annually** or
when a country's situation changes materially.

---

## Maintenance scripts

All scripts live in `scripts/`.

### `audit-data.mjs`

```bash
node scripts/audit-data.mjs
```

Runs offline. Reads all 27 JSONs and checks:

- Each file exists
- `history.years` matches the canonical (pt) list
- `history.{gdp,unemployment,inflation,publicDebt}` arrays match `years` length
- `history.euAvg.*` are byte-identical across all 27 files
- `history[last]` is within 0.5 pp of `stats[same key]`
- Ticker values match the canonical sources (`fuelFallback`, `stats`)
- Values fall within plausible ranges (fuel €0.90–€3.00, min wage €400–€3500, etc.)
- `map.regions` non-empty and every region has `name + salary + population`
- `footerSources` ≥ 3 entries with absolute URLs

**Exit code 0** if clean, **1** if errors found.

### `apply-corrections.mjs`

```bash
node scripts/apply-corrections.mjs
```

Applies a hand-curated table of `{ inflation, minWage, unemployment }`
corrections derived from a fresh fetch of `/api/stats`. Also refreshes
the ECB rate across all 27 files. Preserves JSON formatting (no
re-stringification).

Update the `CORRECTIONS` object at the top of the script before each
run. To get the values, hit `https://countryfingerprint.onrender.com/api/stats`
(may need a 30 s warm-up if Render slept).

### `sync-tickers.mjs`

```bash
node scripts/sync-tickers.mjs
```

Idempotent — re-runs the `tickerItems` strings against the canonical
`stats` and `fuelFallback` values. Handles all four ticker formats
(`€XXX`, `XXX €`, `€XXX (note)`, `LOCAL_CUR (~€XXX)`).

Run after `apply-corrections.mjs`.

### `sync-backend-fallbacks.mjs`

```bash
node scripts/sync-backend-fallbacks.mjs
```

Propagates refreshed values back into:

- `server.js` → `FB_STATS` rows (so the backend's own fallback path
  serves the same numbers)
- `site/src/pages/index.astro` → `highlights.tax` labels (now legacy —
  the home page computes from stats directly)

---

## Typical refresh cycle (monthly)

1. **Wake the API:** `curl https://countryfingerprint.onrender.com/api/status`
2. **Pull current values:** `curl https://countryfingerprint.onrender.com/api/stats | jq`
3. **Update the corrections table** in `scripts/apply-corrections.mjs`
   with anything that drifted by > 0.3 pp or > €20
4. **Run the chain:**
   ```bash
   node scripts/apply-corrections.mjs
   node scripts/sync-tickers.mjs
   node scripts/sync-backend-fallbacks.mjs
   node scripts/audit-data.mjs   # must exit 0
   ```
5. **Build and commit:**
   ```bash
   (cd site && npx astro build)
   git add server.js site/src/data site/src/pages/index.astro
   git commit -m "data: refresh Eurostat values for YYYY-MM"
   git push
   ```

---

## Known caveats

- **Local-currency ticker hints** (PL `PLN 4,666 (~€1,139)`, CZ
  `CZK 18,900 (~€924)`, HU `HUF 290k (~€838)`, RO `RON 4,050 (~€795)`)
  show a local-currency amount that does **not** auto-refresh. The
  `~€XXX` portion is updated by `sync-tickers.mjs` but the local-cur
  prefix is fixed-text. Verify annually.
- **History 2025 values** are the last entry in each `history.*`
  array. When the year rolls over, **append** rather than overwrite —
  the trend charts depend on the full 10-year window.
- **EU averages** in `history.euAvg.*` are identical across all 27
  files by design. If you change them, change them everywhere; the
  audit will catch drift.
- **NUTS region codes** for the small countries (EE NUTS3, LV NUTS3,
  MT NUTS3) were assigned manually — if the choropleth map shows a
  region uncoloured, the code probably needs adjusting against the
  current Eurostat geojson at `https://github.com/eurostat/Nuts2json`.
