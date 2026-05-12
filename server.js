/**
 * EU Stats — Backend v0.5
 * APIs: combustíveis (EU Oil Bulletin), Brent (Yahoo Finance),
 *       Eurostat (desemprego, PIB, inflação, salário mínimo),
 *       ECB (taxa directora, Euribor 12M)
 */

const express = require('express');
const cors    = require('cors');
const https   = require('https');
const http    = require('http');
const path    = require('path');
const fs      = require('fs');

const app  = express();
const PORT = process.env.PORT || 3000;
app.use(cors());
app.use(express.json());

// ── Servir HTML ───────────────────────────────
function serveFile(res, ...candidates) {
  for (const p of candidates) {
    if (fs.existsSync(p)) return res.sendFile(p);
  }
  res.status(404).send('<h2>Ficheiro não encontrado.</h2>');
}

app.get('/',        (req, res) => serveFile(res, path.join(__dirname, 'index.html')));
app.get('/portugal', (req, res) => serveFile(res, path.join(__dirname, 'portugal-v4.html')));
app.get('/spain',    (req, res) => serveFile(res, path.join(__dirname, 'spain-v4.html')));

// ── Bibliotecas JS locais ─────────────────────
app.get('/libs/d3.min.js',       (req, res) => res.sendFile(path.join(__dirname,'node_modules','d3','dist','d3.min.js')));
app.get('/libs/chart.umd.js',    (req, res) => res.sendFile(path.join(__dirname,'node_modules','chart.js','dist','chart.umd.min.js')));
app.get('/libs/topojson.min.js', (req, res) => res.sendFile(path.join(__dirname,'node_modules','topojson-client','dist','topojson-client.min.js')));
app.get('/libs/prt.topo.json',   (req, res) => res.sendFile(path.join(__dirname,'node_modules','datamaps','src','js','data','prt.topo.json')));

// ── Cache ─────────────────────────────────────
const CACHE = {};
const TTL = {
  combustiveis: 12 * 60 * 60 * 1000,  // 12h — EU Oil Bulletin publica semanalmente
  brent:         30 * 60 * 1000,       // 30min
  eurostat:       6 * 60 * 60 * 1000,  // 6h — dados mensais/trimestrais
  ecb:            4 * 60 * 60 * 1000,  // 4h
  euribor:        4 * 60 * 60 * 1000,  // 4h
};
const cacheGet = k => { const e = CACHE[k]; return (e && Date.now() - e.ts < TTL[k]) ? e.data : null; };
const cacheSet = (k, d) => { CACHE[k] = { data: d, ts: Date.now() }; };

// ── Fallbacks ─────────────────────────────────
const FB_FUEL = {
  gasolina95: { atual: 1.927, anterior: 1.921, variacao: +0.006 },
  gasoleo:    { atual: 1.958, anterior: 1.928, variacao: +0.030 },
  gpl:        { atual: 0.930, anterior: 0.928, variacao: +0.002 },
  gasolina98: { atual: 2.049, anterior: 2.049, variacao:  0.000 },
};
const FB_STATS = {
  pt: { unemp: 5.8, youth_unemp: 18.1, gdp: 2.4, inflation: 2.1, min_wage: 920 },
  es: { unemp: 10.3, youth_unemp: 24.3, gdp: 2.9, inflation: 2.6, min_wage: 1221 },
};

// ── HTTP fetch com redirects ──────────────────
function fetchText(url, ms = 12000, hops = 0) {
  return new Promise((res, rej) => {
    if (hops > 5) return rej(new Error('Demasiados redirects'));
    const lib = url.startsWith('https') ? https : http;
    const t   = setTimeout(() => rej(new Error('Timeout')), ms);
    lib.get(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json,text/plain,*/*' } }, r => {
      if ([301, 302, 307, 308].includes(r.statusCode) && r.headers.location) {
        clearTimeout(t); r.resume();
        const next = r.headers.location.startsWith('http')
          ? r.headers.location : new URL(r.headers.location, url).href;
        fetchText(next, ms, hops + 1).then(res).catch(rej);
        return;
      }
      if (r.statusCode !== 200) { clearTimeout(t); return rej(new Error('HTTP ' + r.statusCode)); }
      let b = ''; r.on('data', c => b += c); r.on('end', () => { clearTimeout(t); res(b); });
    }).on('error', e => { clearTimeout(t); rej(e); });
  });
}

async function fetchJSON(url, ms = 10000) {
  const t = await fetchText(url, ms);
  try { return JSON.parse(t); }
  catch(e) { throw new Error('JSON inválido: ' + t.slice(0, 150)); }
}

// ── Eurostat: extractor JSON-stat ─────────────
function euExtract(data, geoCode) {
  try {
    const dims = data.id;
    const sizes = data.size;
    const geoIdx = data.dimension?.geo?.category?.index?.[geoCode];
    if (geoIdx === undefined) return { value: null, period: null };

    const timeCats = data.dimension?.time?.category;
    if (!timeCats) return { value: null, period: null };
    // Ordenar períodos descendentemente para obter o mais recente
    const latestKey = Object.keys(timeCats.index).sort().reverse()[0];
    const timeIdx   = timeCats.index[latestKey];
    const period    = timeCats.label?.[latestKey] ?? latestKey;

    let flatIdx = 0, stride = 1;
    for (let i = dims.length - 1; i >= 0; i--) {
      let idx;
      if (dims[i] === 'geo')  idx = geoIdx;
      else if (dims[i] === 'time') idx = timeIdx;
      else idx = Object.values(data.dimension[dims[i]]?.category?.index ?? { _: 0 })[0] ?? 0;
      flatIdx += idx * stride;
      stride  *= sizes[i];
    }

    const val = data.value[flatIdx];
    return { value: typeof val === 'number' ? +val.toFixed(2) : null, period };
  } catch(e) {
    return { value: null, period: null };
  }
}

async function fetchEurostatJSON(dataset, params) {
  let qs = 'format=JSON&lang=EN';
  for (const [k, v] of Object.entries(params)) {
    const vals = Array.isArray(v) ? v : [v];
    vals.forEach(val => qs += `&${k}=${encodeURIComponent(val)}`);
  }
  const url = `https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/${dataset}?${qs}`;
  return fetchJSON(url, 15000);
}

// ── ECB: taxa directora + Euribor 12M ─────────
async function fetchECBRate() {
  const cached = cacheGet('ecb');
  if (cached) { console.log('[ECB] cache hit'); return cached; }
  try {
    console.log('[ECB] A buscar taxa directora...');
    const raw = await fetchJSON(
      'https://data-api.ecb.europa.eu/service/data/FM/B.U2.EUR.4F.KR.DFR.LEV?lastNObservations=1&format=jsondata',
      8000
    );
    const seriesKey = Object.keys(raw?.dataSets?.[0]?.series ?? {})[0];
    const obs  = Object.values(raw?.dataSets?.[0]?.series?.[seriesKey]?.observations ?? {})[0];
    const rate = obs?.[0];
    if (typeof rate !== 'number') throw new Error('Sem dados');
    const period = raw?.structure?.dimensions?.observation?.[0]?.values?.[0]?.id ?? null;
    const r = { rate: +rate.toFixed(2), period, fonte: 'ecb_api', data: new Date().toISOString() };
    console.log(`[ECB] ✅ ${r.rate}% · ${r.period}`);
    cacheSet('ecb', r);
    return r;
  } catch(e) {
    console.error('[ECB] Erro:', e.message, '— fallback');
    return { rate: 2.25, period: '2026-04', fonte: 'fallback', data: new Date().toISOString() };
  }
}

async function fetchEuribor12M() {
  const cached = cacheGet('euribor');
  if (cached) { console.log('[Euribor] cache hit'); return cached; }
  try {
    console.log('[Euribor] A buscar Euribor 12M...');
    const raw = await fetchJSON(
      'https://data-api.ecb.europa.eu/service/data/FM/B.U2.EUR.RT.MM.EURIBOR1YD_?lastNObservations=1&format=jsondata',
      8000
    );
    const seriesKey = Object.keys(raw?.dataSets?.[0]?.series ?? {})[0];
    const obs  = Object.values(raw?.dataSets?.[0]?.series?.[seriesKey]?.observations ?? {})[0];
    const rate = obs?.[0];
    if (typeof rate !== 'number') throw new Error('Sem dados');
    const r = { rate: +rate.toFixed(3), fonte: 'ecb_api', data: new Date().toISOString() };
    console.log(`[Euribor] ✅ ${r.rate}%`);
    cacheSet('euribor', r);
    return r;
  } catch(e) {
    console.error('[Euribor] Erro:', e.message, '— fallback');
    return { rate: 2.4, fonte: 'fallback', data: new Date().toISOString() };
  }
}

// ── Eurostat: desemprego, PIB, inflação, salários
async function fetchEurostatStats() {
  const cached = cacheGet('eurostat');
  if (cached) { console.log('[Eurostat] cache hit'); return cached; }
  console.log('[Eurostat] A buscar dados...');

  const [unemp, youthUnemp, gdp, infl, minWage] = await Promise.allSettled([
    fetchEurostatJSON('une_rt_m',    { s_adj: 'SA', age: 'TOTAL',  sex: 'T', unit: 'PC_ACT', geo: ['PT','ES'], lastTimePeriod: 3 }),
    fetchEurostatJSON('une_rt_m',    { s_adj: 'SA', age: 'Y15-24', sex: 'T', unit: 'PC_ACT', geo: ['PT','ES'], lastTimePeriod: 3 }),
    fetchEurostatJSON('namq_10_gdp', { unit: 'CLV_PCH_A', na_item: 'B1GQ', s_adj: 'SCA', geo: ['PT','ES'], lastTimePeriod: 2 }),
    fetchEurostatJSON('prc_hicp_manr', { unit: 'RCH_A', coicop: 'CP00', geo: ['PT','ES'], lastTimePeriod: 3 }),
    fetchEurostatJSON('earn_mw_cur', { currency: 'EUR', geo: ['PT','ES'], lastTimePeriod: 2 }),
  ]);

  const ok  = r => r.status === 'fulfilled' ? r.value : null;
  const ext = (data, geo, fb) => {
    if (!data) return { value: fb, period: 'fallback' };
    const r = euExtract(data, geo);
    return r.value !== null ? r : { value: fb, period: 'fallback' };
  };

  const unD = ok(unemp), yuD = ok(youthUnemp), gdpD = ok(gdp), inflD = ok(infl), wageD = ok(minWage);

  const result = {
    pt: {
      unemp:       ext(unD,   'PT', FB_STATS.pt.unemp),
      youth_unemp: ext(yuD,   'PT', FB_STATS.pt.youth_unemp),
      gdp:         ext(gdpD,  'PT', FB_STATS.pt.gdp),
      inflation:   ext(inflD, 'PT', FB_STATS.pt.inflation),
      min_wage:    ext(wageD, 'PT', FB_STATS.pt.min_wage),
    },
    es: {
      unemp:       ext(unD,   'ES', FB_STATS.es.unemp),
      youth_unemp: ext(yuD,   'ES', FB_STATS.es.youth_unemp),
      gdp:         ext(gdpD,  'ES', FB_STATS.es.gdp),
      inflation:   ext(inflD, 'ES', FB_STATS.es.inflation),
      min_wage:    ext(wageD, 'ES', FB_STATS.es.min_wage),
    },
    fonte: 'eurostat',
    data:  new Date().toISOString(),
  };

  console.log(`[Eurostat] ✅ PT: unemp=${result.pt.unemp.value}% gdp=${result.pt.gdp.value}% infl=${result.pt.inflation.value}%`);
  console.log(`[Eurostat] ✅ ES: unemp=${result.es.unemp.value}% gdp=${result.es.gdp.value}% infl=${result.es.inflation.value}%`);
  cacheSet('eurostat', result);
  return result;
}

// ── Combustíveis (PT + ES) ────────────────────
function parseWeeklyTable(text) {
  const dateM = text.match(/##\s+Latest Report:\s+([A-Za-z]+ \d+, \d+)/);
  const date  = dateM ? new Date(dateM[1]).toISOString().slice(0, 10) : null;
  const n = s => parseFloat(s.replace(/[€$\s]/g, '').replace(',', '.'));
  const result = { date };
  for (const line of text.split('\n')) {
    const cols = line.split('|').map(s => s.trim()).filter(Boolean);
    if (cols.length >= 3) {
      if (cols[0] === 'Portugal') result.pt = { petrol: n(cols[1]), diesel: n(cols[2]) };
      if (cols[0] === 'Spain')    result.es = { petrol: n(cols[1]), diesel: n(cols[2]) };
    }
  }
  if (!result.pt?.petrol) throw new Error('Portugal não encontrado na tabela');
  return result;
}

async function fetchCombustiveis() {
  const cached = cacheGet('combustiveis');
  if (cached) { console.log('[Comb] cache hit'); return cached; }
  try {
    console.log('[Comb] A buscar fuel-prices.eu...');
    const text   = await fetchText('https://www.fuel-prices.eu/weekly/llms.txt');
    const parsed = parseWeeklyTable(text);
    console.log(`[Comb] ✅ PT g95=${parsed.pt.petrol} gsl=${parsed.pt.diesel} | ES g95=${parsed.es?.petrol ?? '—'}`);

    const mkFuel = (atual, prev) => ({
      atual, anterior: prev, variacao: +(atual - prev).toFixed(4),
      dataActual: parsed.date, serie: [],
    });

    const r = {
      gasolina95:    mkFuel(parsed.pt.petrol, FB_FUEL.gasolina95.atual),
      gasoleo:       mkFuel(parsed.pt.diesel, FB_FUEL.gasoleo.atual),
      gpl:           { ...FB_FUEL.gpl,        dataActual: parsed.date, serie: [] },
      gasolina98:    { ...FB_FUEL.gasolina98,  dataActual: parsed.date, serie: [] },
      es_gasolina95: parsed.es ? mkFuel(parsed.es.petrol, 1.905) : { atual: 1.905, serie: [] },
      es_gasoleo:    parsed.es ? mkFuel(parsed.es.diesel, 1.952) : { atual: 1.952, serie: [] },
      fonte: 'eu_oil_bulletin', data: new Date().toISOString(),
    };
    cacheSet('combustiveis', r);
    return r;
  } catch(err) {
    console.error('[Comb] Erro:', err.message, '— fallback');
    return {
      ...Object.fromEntries(Object.entries(FB_FUEL).map(([k, v]) => [k, { ...v, dataActual: '2026-05-05', serie: [] }])),
      es_gasolina95: { atual: 1.905, serie: [] },
      es_gasoleo:    { atual: 1.952, serie: [] },
      fonte: 'fallback', erro: err.message, data: new Date().toISOString(),
    };
  }
}

// ── Brent ─────────────────────────────────────
async function fetchBrent() {
  const cached = cacheGet('brent');
  if (cached) { console.log('[Brent] cache hit'); return cached; }
  try {
    console.log('[Brent] A buscar Yahoo Finance...');
    const raw    = await fetchJSON('https://query1.finance.yahoo.com/v8/finance/chart/BZ%3DF?interval=1d&range=5d', 8000);
    const closes = raw?.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [];
    const preco  = closes.filter(Boolean).at(-1);
    if (!preco) throw new Error('Sem dados');
    const r = { preco: parseFloat(preco.toFixed(2)), moeda: 'USD', fonte: 'yahoo_finance', data: new Date().toISOString() };
    console.log(`[Brent] ✅ ${r.preco} USD/bbl`);
    cacheSet('brent', r);
    return r;
  } catch(err) {
    console.error('[Brent] Erro:', err.message, '— fallback');
    return { preco: 108.17, moeda: 'USD', fonte: 'fallback', data: new Date().toISOString() };
  }
}

// ── ROTAS API ─────────────────────────────────
app.get('/api/combustiveis', async (req, res) => {
  const [combustiveis, brent] = await Promise.all([fetchCombustiveis(), fetchBrent()]);
  res.json({ ok: true, combustiveis, brent, timestamp: new Date().toISOString() });
});

app.get('/api/stats', async (req, res) => {
  const [eurostat, ecb, euribor] = await Promise.all([
    fetchEurostatStats(),
    fetchECBRate(),
    fetchEuribor12M(),
  ]);
  res.json({ ok: true, eurostat, ecb, euribor, timestamp: new Date().toISOString() });
});

app.get('/api/status', (req, res) => {
  const age = k => CACHE[k] ? Math.round((Date.now() - CACHE[k].ts) / 60000) : null;
  res.json({
    ok: true, versao: '0.5',
    cache: {
      combustiveis: { idade_min: age('combustiveis') },
      brent:        { idade_min: age('brent') },
      eurostat:     { idade_min: age('eurostat') },
      ecb:          { idade_min: age('ecb') },
      euribor:      { idade_min: age('euribor') },
    },
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/refresh', async (req, res) => {
  ['combustiveis', 'brent', 'eurostat', 'ecb', 'euribor'].forEach(k => delete CACHE[k]);
  const [combustiveis, brent, eurostat, ecb, euribor] = await Promise.all([
    fetchCombustiveis(), fetchBrent(), fetchEurostatStats(), fetchECBRate(), fetchEuribor12M(),
  ]);
  res.json({ ok: true, msg: 'Cache actualizado', combustiveis, brent, eurostat, ecb, euribor });
});

// ── Arranque ──────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🇪🇺  EU Stats — Backend v0.5`);
  console.log(`\n     🌐  http://localhost:${PORT}`);
  console.log(`     📡  /api/combustiveis  /api/stats  /api/status  /api/refresh\n`);
  fetchCombustiveis();
  fetchBrent();
  fetchEurostatStats();
  fetchECBRate();
  fetchEuribor12M();
});
