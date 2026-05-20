/**
 * EU Stats — Backend v1.0
 * APIs: combustíveis (EU Oil Bulletin), Brent (Yahoo Finance),
 *       Eurostat (desemprego, PIB, inflação, salário mínimo),
 *       ECB (taxa directora, Euribor 12M),
 *       INE España (desemprego EPA, preços habitação IPV),
 *       INSEE France (desemprego BIT, preços habitação, IPC)
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

app.get('/',               (req, res) => serveFile(res, path.join(__dirname, 'index.html')));
app.get('/index.html',     (req, res) => serveFile(res, path.join(__dirname, 'index.html')));
app.get('/portugal',       (req, res) => serveFile(res, path.join(__dirname, 'portugal-v4.html')));
app.get('/portugal-v4.html', (req, res) => serveFile(res, path.join(__dirname, 'portugal-v4.html')));
app.get('/spain',          (req, res) => serveFile(res, path.join(__dirname, 'spain-v4.html')));
app.get('/spain-v4.html',  (req, res) => serveFile(res, path.join(__dirname, 'spain-v4.html')));
app.get('/france',         (req, res) => serveFile(res, path.join(__dirname, 'france-v1.html')));
app.get('/france-v1.html', (req, res) => serveFile(res, path.join(__dirname, 'france-v1.html')));
app.get('/germany',         (req, res) => serveFile(res, path.join(__dirname, 'germany-v1.html')));
app.get('/germany-v1.html', (req, res) => serveFile(res, path.join(__dirname, 'germany-v1.html')));

// ── Bibliotecas JS locais ─────────────────────
app.get('/libs/d3.min.js',        (req, res) => res.sendFile(path.join(__dirname,'node_modules','d3','dist','d3.min.js')));
app.get('/libs/chart.umd.js',     (req, res) => res.sendFile(path.join(__dirname,'node_modules','chart.js','dist','chart.umd.min.js')));
app.get('/libs/topojson.min.js',  (req, res) => res.sendFile(path.join(__dirname,'node_modules','topojson-client','dist','topojson-client.min.js')));
app.get('/libs/prt.topo.json',    (req, res) => res.sendFile(path.join(__dirname,'node_modules','datamaps','src','js','data','prt.topo.json')));
app.get('/libs/esp.topo.json',    (req, res) => res.sendFile(path.join(__dirname,'node_modules','datamaps','src','js','data','esp.topo.json')));

// ── SEO ───────────────────────────────────────
app.get('/robots.txt', (req, res) => res.sendFile(path.join(__dirname, 'robots.txt')));
app.get('/sitemap.xml', (req, res) => res.type('application/xml').sendFile(path.join(__dirname, 'sitemap.xml')));

// ── Cache ─────────────────────────────────────
const CACHE = {};
const TTL = {
  combustiveis: 12 * 60 * 60 * 1000,  // 12h — EU Oil Bulletin publica semanalmente
  brent:         30 * 60 * 1000,       // 30min
  eurostat:       6 * 60 * 60 * 1000,  // 6h — dados mensais/trimestrais
  ecb:            4 * 60 * 60 * 1000,  // 4h
  euribor:        4 * 60 * 60 * 1000,  // 4h
  ine_es:         8 * 60 * 60 * 1000,  // 8h — INE España trimestrais/mensais
  insee_fr:       8 * 60 * 60 * 1000,  // 8h — INSEE France trimestrais/mensais
};
const cacheGet = k => { const e = CACHE[k]; return (e && Date.now() - e.ts < TTL[k]) ? e.data : null; };
const cacheSet = (k, d) => { CACHE[k] = { data: d, ts: Date.now() }; };

// ── Fallbacks ─────────────────────────────────
const FB_FUEL = {
  gasolina95: { atual: 1.979, anterior: 1.927, variacao: +0.052 },
  gasoleo:    { atual: 1.968, anterior: 1.958, variacao: +0.010 },
  gpl:        { atual: 0.930, anterior: 0.928, variacao: +0.002 },
  gasolina98: { atual: 2.099, anterior: 2.049, variacao: +0.050 },
};
const FB_STATS = {
  pt: { unemp: 5.8, youth_unemp: 18.1, gdp: 2.4, inflation: 3.0, min_wage: 920 },
  es: { unemp: 10.3, youth_unemp: 24.3, gdp: 2.9, inflation: 2.0, min_wage: 1184, housing_yoy: 12.9 },
  fr: { unemp: 7.9, youth_unemp: 21.1, gdp: 0.7, inflation: 3.2, min_wage: 1802, housing_idx: 127.1, housing_yoy: 1.1 },
  de: { unemp: 4.0, youth_unemp: 6.5,  gdp: 0.3, inflation: 2.6, min_wage: 2222 },
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

// ── SDMX XML parser (INSEE BDM) ───────────────
function parseSDMXObs(xml) {
  const obs = [];
  // Compact SDMX: <Obs TIME_PERIOD="..." OBS_VALUE="..." .../>
  const tagRe = /<Obs\b[^>]*>/gi;
  let m;
  while ((m = tagRe.exec(xml)) !== null) {
    const tpM = m[0].match(/TIME_PERIOD="([^"]+)"/);
    const ovM = m[0].match(/OBS_VALUE="([^"]+)"/);
    if (tpM && ovM && ovM[1] !== 'NaN') {
      const v = parseFloat(ovM[1]);
      if (!isNaN(v)) obs.push({ period: tpM[1], value: v });
    }
  }
  if (obs.length) return obs.sort((a, b) => a.period < b.period ? -1 : 1);
  // Generic SDMX fallback: <Value id="TIME_PERIOD" value="..."/> + <ObsValue value="..."/>
  const blocks = [...xml.matchAll(/<Obs>[\s\S]*?<\/Obs>/g)];
  for (const blk of blocks) {
    const tpM = blk[0].match(/id="TIME_PERIOD"\s+value="([^"]+)"/);
    const ovM = blk[0].match(/<ObsValue[^>]+value="([^"]+)"/);
    if (tpM && ovM && ovM[1] !== 'NaN') {
      const v = parseFloat(ovM[1]);
      if (!isNaN(v)) obs.push({ period: tpM[1], value: v });
    }
  }
  return obs.sort((a, b) => a.period < b.period ? -1 : 1);
}

// ── INE España (EPA + IPV) ────────────────────
async function fetchINESpain() {
  const cached = cacheGet('ine_es');
  if (cached) { console.log('[INE ES] cache hit'); return cached; }
  try {
    console.log('[INE ES] A buscar dados INE España...');
    const base = 'https://servicios.ine.es/wstempus/js/EN/DATOS_SERIE/';
    const [unempR, housingR] = await Promise.allSettled([
      fetchJSON(`${base}EPA423474?nult=2`, 12000),  // taxa desemprego EPA (trimestral)
      fetchJSON(`${base}IPV948?nult=2`,    12000),  // variação anual preços habitação (trimestral)
    ]);
    const parseINE = result => {
      if (result.status !== 'fulfilled') return null;
      const raw = result.value;
      // API devolve objecto com campo Data (ou array de objectos)
      const arr  = Array.isArray(raw) ? raw : [raw];
      const data = arr[0]?.Data ?? arr[0]?.data ?? null;
      if (!data?.length) return null;
      const latest = data[data.length - 1];
      // INE usa "Valor" — fallback para grafias alternativas
      const val = latest.Valor ?? latest.valor ?? latest.Dato ?? latest.dato ?? null;
      if (val === null || isNaN(val)) return null;
      // Derivar trimestre a partir do timestamp Fecha (ms)
      let period = String(latest.Anyo ?? '');
      if (latest.Fecha) {
        const d = new Date(latest.Fecha);
        const q = Math.floor(d.getMonth() / 3) + 1;
        period  = `${d.getFullYear()}-Q${q}`;
      }
      return { value: +parseFloat(val).toFixed(2), period };
    };
    const unemp   = parseINE(unempR);
    const housing = parseINE(housingR);
    const r = {
      unemp:       unemp   ? unemp   : { value: FB_STATS.es.unemp,       period: 'fallback' },
      housing_yoy: housing ? housing : { value: FB_STATS.es.housing_yoy, period: 'fallback' },
      fonte: unemp ? 'ine_es' : 'fallback',
      data:  new Date().toISOString(),
    };
    console.log(`[INE ES] ✅ unemp=${r.unemp.value}% (${r.unemp.period}) housing_yoy=${r.housing_yoy.value}% (${r.housing_yoy.period})`);
    cacheSet('ine_es', r);
    return r;
  } catch(e) {
    console.error('[INE ES] Erro:', e.message, '— fallback');
    return { unemp: { value: FB_STATS.es.unemp, period: 'fallback' }, housing_yoy: { value: FB_STATS.es.housing_yoy, period: 'fallback' }, fonte: 'fallback', data: new Date().toISOString() };
  }
}

// ── INSEE France (BDM SDMX) ───────────────────
async function fetchINSEEFrance() {
  const cached = cacheGet('insee_fr');
  if (cached) { console.log('[INSEE] cache hit'); return cached; }
  try {
    console.log('[INSEE] A buscar dados INSEE France...');
    const base = 'https://bdm.insee.fr/series/sdmx/data/SERIES_BDM/';
    const [unempXml, youthXml, housingXml, cpiXml] = await Promise.allSettled([
      fetchText(`${base}001688526?lastNObservations=1`,  12000), // taxa desemprego BIT total
      fetchText(`${base}001688537?lastNObservations=1`,  12000), // taxa desemprego <25 anos
      fetchText(`${base}010567119?lastNObservations=8`,  12000), // índice preços logements anciens
      fetchText(`${base}011812231?lastNObservations=14`, 12000), // IPCH base 2025 (para variação anual)
    ]);

    const latest = result => {
      if (result.status !== 'fulfilled') return null;
      const obs = parseSDMXObs(result.value);
      return obs.length ? obs[obs.length - 1] : null;
    };

    const unemp = latest(unempXml);
    const youth = latest(youthXml);

    // Habitação: YoY a partir do índice (comparar com mesmo trimestre do ano anterior)
    let housingYoY = null, housingIdx = null;
    if (housingXml.status === 'fulfilled') {
      const obs = parseSDMXObs(housingXml.value);
      if (obs.length) {
        const last = obs[obs.length - 1];
        housingIdx = +last.value.toFixed(1);
        const parts = last.period.match(/^(\d{4})-(Q\d)$/);
        if (parts) {
          const yearAgo = `${parseInt(parts[1]) - 1}-${parts[2]}`;
          const prev = obs.find(o => o.period === yearAgo);
          if (prev) housingYoY = +((last.value / prev.value - 1) * 100).toFixed(1);
        }
      }
    }

    // IPC: variação homóloga a partir do índice IPCH base 2025
    let cpiYoY = null, cpiPeriod = null;
    if (cpiXml.status === 'fulfilled') {
      const obs = parseSDMXObs(cpiXml.value);
      if (obs.length >= 13) {
        const last     = obs[obs.length - 1];
        const yearAgo  = obs[obs.length - 13];
        cpiYoY   = +((last.value / yearAgo.value - 1) * 100).toFixed(1);
        cpiPeriod = last.period;
      }
    }

    const r = {
      unemp:       unemp ? { value: +unemp.value.toFixed(1), period: unemp.period }
                         : { value: FB_STATS.fr.unemp,       period: 'fallback' },
      youth_unemp: youth ? { value: +youth.value.toFixed(1), period: youth.period }
                         : { value: FB_STATS.fr.youth_unemp, period: 'fallback' },
      housing_idx: housingIdx  !== null ? housingIdx  : FB_STATS.fr.housing_idx,
      housing_yoy: housingYoY  !== null ? { value: housingYoY,  period: 'recent' }
                                        : { value: FB_STATS.fr.housing_yoy, period: 'fallback' },
      cpi_yoy:     cpiYoY !== null ? { value: cpiYoY, period: cpiPeriod }
                                   : { value: FB_STATS.fr.inflation, period: 'fallback' },
      fonte: unemp ? 'insee' : 'fallback',
      data:  new Date().toISOString(),
    };
    console.log(`[INSEE] ✅ unemp=${r.unemp.value}% (${r.unemp.period}) youth=${r.youth_unemp.value}% housing_idx=${r.housing_idx} cpi_yoy=${r.cpi_yoy.value}%`);
    cacheSet('insee_fr', r);
    return r;
  } catch(e) {
    console.error('[INSEE] Erro:', e.message, '— fallback');
    return {
      unemp:       { value: FB_STATS.fr.unemp,       period: 'fallback' },
      youth_unemp: { value: FB_STATS.fr.youth_unemp, period: 'fallback' },
      housing_idx: FB_STATS.fr.housing_idx,
      housing_yoy: { value: FB_STATS.fr.housing_yoy, period: 'fallback' },
      cpi_yoy:     { value: FB_STATS.fr.inflation,   period: 'fallback' },
      fonte: 'fallback', data: new Date().toISOString(),
    };
  }
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
    // ECB FM dataset via ?key= parameter (path format deprecated — returns 400)
    // Fetches broader FM dataset and finds EURIBOR1YD_ series
    const raw = await fetchJSON(
      'https://data-api.ecb.europa.eu/service/data/FM?key=B.U2.EUR.RT.MM.EURIBOR1YD_&lastNObservations=1&format=jsondata',
      12000
    );
    // Find the series whose attributes include EURIBOR1YD_ in PROVIDER_FM_ID dimension
    const structure = raw?.structure?.dimensions?.series ?? [];
    const provIdx = structure.findIndex(d => d.id === 'PROVIDER_FM_ID');
    const euriborIdx = provIdx >= 0
      ? structure[provIdx]?.values?.findIndex(v => v.id === 'EURIBOR1YD_')
      : -1;
    let rate = null;
    if (euriborIdx >= 0) {
      const series = raw?.dataSets?.[0]?.series ?? {};
      for (const [key, val] of Object.entries(series)) {
        const parts = key.split(':');
        if (parts[provIdx] === String(euriborIdx)) {
          const obsVals = Object.values(val?.observations ?? {});
          if (obsVals.length) { rate = obsVals[obsVals.length - 1]?.[0]; break; }
        }
      }
    }
    if (typeof rate !== 'number' || isNaN(rate)) throw new Error('Série não encontrada');
    const r = { rate: +rate.toFixed(3), fonte: 'ecb_api', data: new Date().toISOString() };
    console.log(`[Euribor] ✅ ${r.rate}%`);
    cacheSet('euribor', r);
    return r;
  } catch(e) {
    console.error('[Euribor] Erro:', e.message, '— fallback');
    return { rate: 2.222, fonte: 'fallback', data: new Date().toISOString() };
  }
}

// ── Eurostat: desemprego, PIB, inflação, salários
async function fetchEurostatStats() {
  const cached = cacheGet('eurostat');
  if (cached) { console.log('[Eurostat] cache hit'); return cached; }
  console.log('[Eurostat] A buscar dados...');

  const [unemp, youthUnemp, gdp, infl, minWage] = await Promise.allSettled([
    fetchEurostatJSON('une_rt_m',    { s_adj: 'SA', age: 'TOTAL',  sex: 'T', unit: 'PC_ACT', geo: ['PT','ES','FR','DE'], lastTimePeriod: 3 }),
    fetchEurostatJSON('une_rt_m',    { s_adj: 'SA', age: 'Y15-24', sex: 'T', unit: 'PC_ACT', geo: ['PT','ES','FR','DE'], lastTimePeriod: 3 }),
    fetchEurostatJSON('namq_10_gdp', { unit: 'CLV_PCH_A', na_item: 'B1GQ', s_adj: 'SCA', geo: ['PT','ES','FR','DE'], lastTimePeriod: 2 }),
    fetchEurostatJSON('prc_hicp_manr', { unit: 'RCH_A', coicop: 'CP00', geo: ['PT','ES','FR','DE'], lastTimePeriod: 3 }),
    fetchEurostatJSON('earn_mw_cur', { currency: 'EUR', geo: ['PT','ES','FR','DE'], lastTimePeriod: 2 }),
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
    fr: {
      unemp:       ext(unD,   'FR', FB_STATS.fr.unemp),
      youth_unemp: ext(yuD,   'FR', FB_STATS.fr.youth_unemp),
      gdp:         ext(gdpD,  'FR', FB_STATS.fr.gdp),
      inflation:   ext(inflD, 'FR', FB_STATS.fr.inflation),
      min_wage:    ext(wageD, 'FR', FB_STATS.fr.min_wage),
    },
    de: {
      unemp:       ext(unD,   'DE', FB_STATS.de.unemp),
      youth_unemp: ext(yuD,   'DE', FB_STATS.de.youth_unemp),
      gdp:         ext(gdpD,  'DE', FB_STATS.de.gdp),
      inflation:   ext(inflD, 'DE', FB_STATS.de.inflation),
      min_wage:    ext(wageD, 'DE', FB_STATS.de.min_wage),
    },
    fonte: 'eurostat',
    data:  new Date().toISOString(),
  };

  console.log(`[Eurostat] ✅ PT: unemp=${result.pt.unemp.value}% gdp=${result.pt.gdp.value}% infl=${result.pt.inflation.value}%`);
  console.log(`[Eurostat] ✅ ES: unemp=${result.es.unemp.value}% gdp=${result.es.gdp.value}% infl=${result.es.inflation.value}%`);
  console.log(`[Eurostat] ✅ FR: unemp=${result.fr.unemp.value}% gdp=${result.fr.gdp.value}% infl=${result.fr.inflation.value}%`);
  console.log(`[Eurostat] ✅ DE: unemp=${result.de.unemp.value}% gdp=${result.de.gdp.value}% infl=${result.de.inflation.value}%`);
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
      if (cols[0] === 'France')   result.fr = { petrol: n(cols[1]), diesel: n(cols[2]) };
      if (cols[0] === 'Germany')  result.de = { petrol: n(cols[1]), diesel: n(cols[2]) };
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
      es_gasolina95: parsed.es ? mkFuel(parsed.es.petrol, 1.541) : { atual: 1.541, serie: [] },
      es_gasoleo:    parsed.es ? mkFuel(parsed.es.diesel, 1.718) : { atual: 1.718, serie: [] },
      fr_gasolina95: parsed.fr ? mkFuel(parsed.fr.petrol, 2.083) : { atual: 2.083, serie: [] },
      fr_gasoleo:    parsed.fr ? mkFuel(parsed.fr.diesel, 2.157) : { atual: 2.157, serie: [] },
      de_gasolina95: parsed.de ? mkFuel(parsed.de.petrol, 1.790) : { atual: 1.790, serie: [] },
      de_gasoleo:    parsed.de ? mkFuel(parsed.de.diesel, 1.680) : { atual: 1.680, serie: [] },
      fonte: 'eu_oil_bulletin', data: new Date().toISOString(),
    };
    cacheSet('combustiveis', r);
    return r;
  } catch(err) {
    console.error('[Comb] Erro:', err.message, '— fallback');
    return {
      ...Object.fromEntries(Object.entries(FB_FUEL).map(([k, v]) => [k, { ...v, dataActual: '2026-05-11', serie: [] }])),
      es_gasolina95: { atual: 1.541, serie: [] },
      es_gasoleo:    { atual: 1.718, serie: [] },
      fr_gasolina95: { atual: 2.083, serie: [] },
      fr_gasoleo:    { atual: 2.157, serie: [] },
      de_gasolina95: { atual: 1.790, serie: [] },
      de_gasoleo:    { atual: 1.680, serie: [] },
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
    return { preco: 105.84, moeda: 'USD', fonte: 'fallback', data: new Date().toISOString() };
  }
}

// ── ROTAS API ─────────────────────────────────
app.get('/api/combustiveis', async (req, res) => {
  const [combustiveis, brent] = await Promise.all([fetchCombustiveis(), fetchBrent()]);
  res.json({ ok: true, combustiveis, brent, timestamp: new Date().toISOString() });
});

app.get('/api/stats', async (req, res) => {
  const [eurostat, ecb, euribor, ineEs, inseeFr] = await Promise.all([
    fetchEurostatStats(),
    fetchECBRate(),
    fetchEuribor12M(),
    fetchINESpain(),
    fetchINSEEFrance(),
  ]);
  res.json({ ok: true, eurostat, ecb, euribor, ine_es: ineEs, insee_fr: inseeFr, timestamp: new Date().toISOString() });
});

app.get('/api/status', (req, res) => {
  const age = k => CACHE[k] ? Math.round((Date.now() - CACHE[k].ts) / 60000) : null;
  res.json({
    ok: true, versao: '1.0',
    cache: {
      combustiveis: { idade_min: age('combustiveis') },
      brent:        { idade_min: age('brent') },
      eurostat:     { idade_min: age('eurostat') },
      ecb:          { idade_min: age('ecb') },
      euribor:      { idade_min: age('euribor') },
      ine_es:       { idade_min: age('ine_es') },
      insee_fr:     { idade_min: age('insee_fr') },
    },
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/refresh', async (req, res) => {
  ['combustiveis', 'brent', 'eurostat', 'ecb', 'euribor', 'ine_es', 'insee_fr'].forEach(k => delete CACHE[k]);
  const [combustiveis, brent, eurostat, ecb, euribor, ineEs, inseeFr] = await Promise.all([
    fetchCombustiveis(), fetchBrent(), fetchEurostatStats(), fetchECBRate(), fetchEuribor12M(),
    fetchINESpain(), fetchINSEEFrance(),
  ]);
  res.json({ ok: true, msg: 'Cache actualizado', combustiveis, brent, eurostat, ecb, euribor, ine_es: ineEs, insee_fr: inseeFr });
});

// ── Arranque ──────────────────────────────────
// Bind explicitly to 0.0.0.0 — Railway proxy only routes to all-interfaces bindings
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🇪🇺  EU Stats — Backend v1.0`);
  console.log(`\n     🌐  http://0.0.0.0:${PORT}`);
  console.log(`     📡  /api/combustiveis  /api/stats  /api/status  /api/refresh\n`);
  fetchCombustiveis();
  fetchBrent();
  fetchEurostatStats();
  fetchECBRate();
  fetchEuribor12M();
  fetchINESpain();
  fetchINSEEFrance();
});
