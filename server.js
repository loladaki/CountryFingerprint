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

const app  = express();
const PORT = process.env.PORT || 3000;
app.use(cors());
app.use(express.json());

// ── Root + landing ────────────────────────────
// The HTML site moved to GitHub Pages (Astro build in /site).
// This Express backend now serves ONLY /api/* endpoints — everything else
// redirects users to the new frontend.
const FRONTEND = 'https://loladaki.github.io/CountryFingerprint';
app.get('/', (req, res) => res.redirect(302, FRONTEND));
app.get('/portugal', (req, res) => res.redirect(302, `${FRONTEND}/portugal`));
app.get('/spain',    (req, res) => res.redirect(302, `${FRONTEND}/spain`));
app.get('/france',   (req, res) => res.redirect(302, `${FRONTEND}/france`));
app.get('/germany',  (req, res) => res.redirect(302, `${FRONTEND}/germany`));
app.get('/italy',    (req, res) => res.redirect(302, `${FRONTEND}/italy`));

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
// Fuel fallbacks reflect the latest EU Oil Bulletin (refreshed manually each week)
const FB_FUEL = {
  gasolina95: { atual: 2.009, anterior: 1.979, variacao: +0.030 },
  gasoleo:    { atual: 1.954, anterior: 1.968, variacao: -0.014 },
  gpl:        { atual: 0.930, anterior: 0.928, variacao: +0.002 },
  gasolina98: { atual: 2.119, anterior: 2.099, variacao: +0.020 },
};
const FB_STATS = {
  pt: { unemp: 5.8,  youth_unemp: 18.1, gdp: 2.4, inflation: 2.4, min_wage: 1073 },
  es: { unemp: 10.3, youth_unemp: 24.3, gdp: 2.9, inflation: 3, min_wage: 1381, housing_yoy: 12.9 },
  fr: { unemp: 7.9,  youth_unemp: 21.1, gdp: 0.7, inflation: 0.7, min_wage: 1823, housing_idx: 127.1, housing_yoy: 1.1 },
  de: { unemp: 4,  youth_unemp: 6.5,  gdp: 0.3, inflation: 2, min_wage: 2343 },
  it: { unemp: 5.2,  youth_unemp: 19, gdp: 0.6, inflation: 1.2, min_wage: null /* No statutory min wage — CCNL */ },
  nl: { unemp: 3.9,  youth_unemp: 9.2,  gdp: 1.8, inflation: 2.7, min_wage: 2295 },
  ie: { unemp: 4.8,  youth_unemp: 10.8, gdp: 4.5, inflation: 2.7, min_wage: 2391 },
  be: { unemp: 5.5,  youth_unemp: 17.2, gdp: 1.2, inflation: 2.2, min_wage: 2112 },
  at: { unemp: 5,  youth_unemp: 11.5, gdp: 0.8, inflation: 3.8, min_wage: null /* CCNL-equivalent: sectoral collective agreements */ },
  se: { unemp: 8.5,  youth_unemp: 23, gdp: 1.6, inflation: 2.1, min_wage: null /* No statutory min wage — collective agreements */ },
  pl: { unemp: 2.8,  youth_unemp:  9.5, gdp: 3.3, inflation: 2.5, min_wage: 1139 /* PLN 4,666/mo at 0.23 EUR/PLN */ },
  cz: { unemp: 2.5,  youth_unemp:  6.8, gdp: 2.4, inflation: 1.8, min_wage:  924 /* CZK 18,900/mo */ },
  gr: { unemp: 9.5,  youth_unemp: 22.5, gdp: 2.1, inflation: 2.9, min_wage:  1027 },
  dk: { unemp: 5.5,  youth_unemp: 11, gdp: 2.5, inflation: 1.9, min_wage: null /* Collective agreements only */ },
  fi: { unemp: 10.7,  youth_unemp: 17.5, gdp: 1, inflation: 1.7, min_wage: null /* Collective agreements only */ },
  ee: { unemp: 7.5,  youth_unemp: 18, gdp: 2, inflation: 4, min_wage: 886 },
  lv: { unemp: 6.5,  youth_unemp: 15, gdp: 2.2, inflation: 3.4, min_wage: 780 },
  lt: { unemp: 7,  youth_unemp: 14, gdp: 2.8, inflation: 3.2, min_wage: 1153 },
  hu: { unemp: 4.5,  youth_unemp: 13, gdp: 2, inflation: 3.3, min_wage: 838 },
  sk: { unemp: 5.5,  youth_unemp: 19, gdp: 2, inflation: 4.1, min_wage: 915 },
  si: { unemp: 3.8,  youth_unemp: 11, gdp: 2.3, inflation: 2.6, min_wage: 1278 },
  hr: { unemp: 5.5,  youth_unemp: 18, gdp: 3, inflation: 3.8, min_wage: 1050 },
  ro: { unemp: 5.5,  youth_unemp: 21, gdp: 2.8, inflation: 8.6, min_wage: 795 },
  bg: { unemp: 4.5,  youth_unemp: 18, gdp: 2.5, inflation: 3.5, min_wage: 620 },
  lu: { unemp: 5.8,  youth_unemp: 18, gdp: 2, inflation: 3.3, min_wage: 2704 },
  mt: { unemp: 3,  youth_unemp:  8, gdp: 4, inflation: 2.4, min_wage: 994 },
  cy: { unemp: 5.5,  youth_unemp: 17, gdp: 3, inflation: 0.1, min_wage: 1088 },
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
    fetchEurostatJSON('une_rt_m',    { s_adj: 'SA', age: 'TOTAL',  sex: 'T', unit: 'PC_ACT', geo: ['PT','ES','FR','DE','IT','NL','IE','BE','AT','SE','PL','CZ','EL','DK','FI','EE','LV','LT','HU','SK','SI','HR','RO','BG','LU','MT','CY'], lastTimePeriod: 3 }),
    fetchEurostatJSON('une_rt_m',    { s_adj: 'SA', age: 'Y15-24', sex: 'T', unit: 'PC_ACT', geo: ['PT','ES','FR','DE','IT','NL','IE','BE','AT','SE','PL','CZ','EL','DK','FI','EE','LV','LT','HU','SK','SI','HR','RO','BG','LU','MT','CY'], lastTimePeriod: 3 }),
    fetchEurostatJSON('namq_10_gdp', { unit: 'CLV_PCH_A', na_item: 'B1GQ', s_adj: 'SCA', geo: ['PT','ES','FR','DE','IT','NL','IE','BE','AT','SE','PL','CZ','EL','DK','FI','EE','LV','LT','HU','SK','SI','HR','RO','BG','LU','MT','CY'], lastTimePeriod: 2 }),
    fetchEurostatJSON('prc_hicp_manr', { unit: 'RCH_A', coicop: 'CP00', geo: ['PT','ES','FR','DE','IT','NL','IE','BE','AT','SE','PL','CZ','EL','DK','FI','EE','LV','LT','HU','SK','SI','HR','RO','BG','LU','MT','CY'], lastTimePeriod: 3 }),
    fetchEurostatJSON('earn_mw_cur', { currency: 'EUR', geo: ['PT','ES','FR','DE','IT','NL','IE','BE','AT','SE','PL','CZ','EL','DK','FI','EE','LV','LT','HU','SK','SI','HR','RO','BG','LU','MT','CY'], lastTimePeriod: 2 }),
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
    it: {
      unemp:       ext(unD,   'IT', FB_STATS.it.unemp),
      youth_unemp: ext(yuD,   'IT', FB_STATS.it.youth_unemp),
      gdp:         ext(gdpD,  'IT', FB_STATS.it.gdp),
      inflation:   ext(inflD, 'IT', FB_STATS.it.inflation),
      min_wage:    ext(wageD, 'IT', FB_STATS.it.min_wage),
    },
    nl: {
      unemp:       ext(unD,   'NL', FB_STATS.nl.unemp),
      youth_unemp: ext(yuD,   'NL', FB_STATS.nl.youth_unemp),
      gdp:         ext(gdpD,  'NL', FB_STATS.nl.gdp),
      inflation:   ext(inflD, 'NL', FB_STATS.nl.inflation),
      min_wage:    ext(wageD, 'NL', FB_STATS.nl.min_wage),
    },
    ie: { unemp: ext(unD,'IE',FB_STATS.ie.unemp), youth_unemp: ext(yuD,'IE',FB_STATS.ie.youth_unemp), gdp: ext(gdpD,'IE',FB_STATS.ie.gdp), inflation: ext(inflD,'IE',FB_STATS.ie.inflation), min_wage: ext(wageD,'IE',FB_STATS.ie.min_wage) },
    be: { unemp: ext(unD,'BE',FB_STATS.be.unemp), youth_unemp: ext(yuD,'BE',FB_STATS.be.youth_unemp), gdp: ext(gdpD,'BE',FB_STATS.be.gdp), inflation: ext(inflD,'BE',FB_STATS.be.inflation), min_wage: ext(wageD,'BE',FB_STATS.be.min_wage) },
    at: { unemp: ext(unD,'AT',FB_STATS.at.unemp), youth_unemp: ext(yuD,'AT',FB_STATS.at.youth_unemp), gdp: ext(gdpD,'AT',FB_STATS.at.gdp), inflation: ext(inflD,'AT',FB_STATS.at.inflation), min_wage: ext(wageD,'AT',FB_STATS.at.min_wage) },
    se: { unemp: ext(unD,'SE',FB_STATS.se.unemp), youth_unemp: ext(yuD,'SE',FB_STATS.se.youth_unemp), gdp: ext(gdpD,'SE',FB_STATS.se.gdp), inflation: ext(inflD,'SE',FB_STATS.se.inflation), min_wage: ext(wageD,'SE',FB_STATS.se.min_wage) },
    pl: { unemp: ext(unD,'PL',FB_STATS.pl.unemp), youth_unemp: ext(yuD,'PL',FB_STATS.pl.youth_unemp), gdp: ext(gdpD,'PL',FB_STATS.pl.gdp), inflation: ext(inflD,'PL',FB_STATS.pl.inflation), min_wage: ext(wageD,'PL',FB_STATS.pl.min_wage) },
    cz: { unemp: ext(unD,'CZ',FB_STATS.cz.unemp), youth_unemp: ext(yuD,'CZ',FB_STATS.cz.youth_unemp), gdp: ext(gdpD,'CZ',FB_STATS.cz.gdp), inflation: ext(inflD,'CZ',FB_STATS.cz.inflation), min_wage: ext(wageD,'CZ',FB_STATS.cz.min_wage) },
    gr: { unemp: ext(unD,'EL',FB_STATS.gr.unemp), youth_unemp: ext(yuD,'EL',FB_STATS.gr.youth_unemp), gdp: ext(gdpD,'EL',FB_STATS.gr.gdp), inflation: ext(inflD,'EL',FB_STATS.gr.inflation), min_wage: ext(wageD,'EL',FB_STATS.gr.min_wage) },
    dk: { unemp: ext(unD,'DK',FB_STATS.dk.unemp), youth_unemp: ext(yuD,'DK',FB_STATS.dk.youth_unemp), gdp: ext(gdpD,'DK',FB_STATS.dk.gdp), inflation: ext(inflD,'DK',FB_STATS.dk.inflation), min_wage: ext(wageD,'DK',FB_STATS.dk.min_wage) },
    fi: { unemp: ext(unD,'FI',FB_STATS.fi.unemp), youth_unemp: ext(yuD,'FI',FB_STATS.fi.youth_unemp), gdp: ext(gdpD,'FI',FB_STATS.fi.gdp), inflation: ext(inflD,'FI',FB_STATS.fi.inflation), min_wage: ext(wageD,'FI',FB_STATS.fi.min_wage) },
    ee: { unemp: ext(unD,'EE',FB_STATS.ee.unemp), youth_unemp: ext(yuD,'EE',FB_STATS.ee.youth_unemp), gdp: ext(gdpD,'EE',FB_STATS.ee.gdp), inflation: ext(inflD,'EE',FB_STATS.ee.inflation), min_wage: ext(wageD,'EE',FB_STATS.ee.min_wage) },
    lv: { unemp: ext(unD,'LV',FB_STATS.lv.unemp), youth_unemp: ext(yuD,'LV',FB_STATS.lv.youth_unemp), gdp: ext(gdpD,'LV',FB_STATS.lv.gdp), inflation: ext(inflD,'LV',FB_STATS.lv.inflation), min_wage: ext(wageD,'LV',FB_STATS.lv.min_wage) },
    lt: { unemp: ext(unD,'LT',FB_STATS.lt.unemp), youth_unemp: ext(yuD,'LT',FB_STATS.lt.youth_unemp), gdp: ext(gdpD,'LT',FB_STATS.lt.gdp), inflation: ext(inflD,'LT',FB_STATS.lt.inflation), min_wage: ext(wageD,'LT',FB_STATS.lt.min_wage) },
    hu: { unemp: ext(unD,'HU',FB_STATS.hu.unemp), youth_unemp: ext(yuD,'HU',FB_STATS.hu.youth_unemp), gdp: ext(gdpD,'HU',FB_STATS.hu.gdp), inflation: ext(inflD,'HU',FB_STATS.hu.inflation), min_wage: ext(wageD,'HU',FB_STATS.hu.min_wage) },
    sk: { unemp: ext(unD,'SK',FB_STATS.sk.unemp), youth_unemp: ext(yuD,'SK',FB_STATS.sk.youth_unemp), gdp: ext(gdpD,'SK',FB_STATS.sk.gdp), inflation: ext(inflD,'SK',FB_STATS.sk.inflation), min_wage: ext(wageD,'SK',FB_STATS.sk.min_wage) },
    si: { unemp: ext(unD,'SI',FB_STATS.si.unemp), youth_unemp: ext(yuD,'SI',FB_STATS.si.youth_unemp), gdp: ext(gdpD,'SI',FB_STATS.si.gdp), inflation: ext(inflD,'SI',FB_STATS.si.inflation), min_wage: ext(wageD,'SI',FB_STATS.si.min_wage) },
    hr: { unemp: ext(unD,'HR',FB_STATS.hr.unemp), youth_unemp: ext(yuD,'HR',FB_STATS.hr.youth_unemp), gdp: ext(gdpD,'HR',FB_STATS.hr.gdp), inflation: ext(inflD,'HR',FB_STATS.hr.inflation), min_wage: ext(wageD,'HR',FB_STATS.hr.min_wage) },
    ro: { unemp: ext(unD,'RO',FB_STATS.ro.unemp), youth_unemp: ext(yuD,'RO',FB_STATS.ro.youth_unemp), gdp: ext(gdpD,'RO',FB_STATS.ro.gdp), inflation: ext(inflD,'RO',FB_STATS.ro.inflation), min_wage: ext(wageD,'RO',FB_STATS.ro.min_wage) },
    bg: { unemp: ext(unD,'BG',FB_STATS.bg.unemp), youth_unemp: ext(yuD,'BG',FB_STATS.bg.youth_unemp), gdp: ext(gdpD,'BG',FB_STATS.bg.gdp), inflation: ext(inflD,'BG',FB_STATS.bg.inflation), min_wage: ext(wageD,'BG',FB_STATS.bg.min_wage) },
    lu: { unemp: ext(unD,'LU',FB_STATS.lu.unemp), youth_unemp: ext(yuD,'LU',FB_STATS.lu.youth_unemp), gdp: ext(gdpD,'LU',FB_STATS.lu.gdp), inflation: ext(inflD,'LU',FB_STATS.lu.inflation), min_wage: ext(wageD,'LU',FB_STATS.lu.min_wage) },
    mt: { unemp: ext(unD,'MT',FB_STATS.mt.unemp), youth_unemp: ext(yuD,'MT',FB_STATS.mt.youth_unemp), gdp: ext(gdpD,'MT',FB_STATS.mt.gdp), inflation: ext(inflD,'MT',FB_STATS.mt.inflation), min_wage: ext(wageD,'MT',FB_STATS.mt.min_wage) },
    cy: { unemp: ext(unD,'CY',FB_STATS.cy.unemp), youth_unemp: ext(yuD,'CY',FB_STATS.cy.youth_unemp), gdp: ext(gdpD,'CY',FB_STATS.cy.gdp), inflation: ext(inflD,'CY',FB_STATS.cy.inflation), min_wage: ext(wageD,'CY',FB_STATS.cy.min_wage) },
    fonte: 'eurostat',
    data:  new Date().toISOString(),
  };

  console.log(`[Eurostat] ✅ PT: unemp=${result.pt.unemp.value}% gdp=${result.pt.gdp.value}% infl=${result.pt.inflation.value}%`);
  console.log(`[Eurostat] ✅ ES: unemp=${result.es.unemp.value}% gdp=${result.es.gdp.value}% infl=${result.es.inflation.value}%`);
  console.log(`[Eurostat] ✅ FR: unemp=${result.fr.unemp.value}% gdp=${result.fr.gdp.value}% infl=${result.fr.inflation.value}%`);
  console.log(`[Eurostat] ✅ DE: unemp=${result.de.unemp.value}% gdp=${result.de.gdp.value}% infl=${result.de.inflation.value}%`);
  console.log(`[Eurostat] ✅ IT: unemp=${result.it.unemp.value}% gdp=${result.it.gdp.value}% infl=${result.it.inflation.value}%`);
  console.log(`[Eurostat] ✅ NL: unemp=${result.nl.unemp.value}% gdp=${result.nl.gdp.value}% infl=${result.nl.inflation.value}%`);
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
      if (cols[0] === 'Italy')    result.it = { petrol: n(cols[1]), diesel: n(cols[2]) };
      if (cols[0] === 'Netherlands') result.nl = { petrol: n(cols[1]), diesel: n(cols[2]) };
      if (cols[0] === 'Ireland')  result.ie = { petrol: n(cols[1]), diesel: n(cols[2]) };
      if (cols[0] === 'Belgium')  result.be = { petrol: n(cols[1]), diesel: n(cols[2]) };
      if (cols[0] === 'Austria')  result.at = { petrol: n(cols[1]), diesel: n(cols[2]) };
      if (cols[0] === 'Sweden')   result.se = { petrol: n(cols[1]), diesel: n(cols[2]) };
      if (cols[0] === 'Poland')   result.pl = { petrol: n(cols[1]), diesel: n(cols[2]) };
      if (cols[0] === 'Czechia' || cols[0] === 'Czech Republic') result.cz = { petrol: n(cols[1]), diesel: n(cols[2]) };
      if (cols[0] === 'Greece')   result.gr = { petrol: n(cols[1]), diesel: n(cols[2]) };
      if (cols[0] === 'Denmark')  result.dk = { petrol: n(cols[1]), diesel: n(cols[2]) };
      if (cols[0] === 'Finland')  result.fi = { petrol: n(cols[1]), diesel: n(cols[2]) };
      if (cols[0] === 'Estonia')    result.ee = { petrol: n(cols[1]), diesel: n(cols[2]) };
      if (cols[0] === 'Latvia')     result.lv = { petrol: n(cols[1]), diesel: n(cols[2]) };
      if (cols[0] === 'Lithuania')  result.lt = { petrol: n(cols[1]), diesel: n(cols[2]) };
      if (cols[0] === 'Hungary')    result.hu = { petrol: n(cols[1]), diesel: n(cols[2]) };
      if (cols[0] === 'Slovakia')   result.sk = { petrol: n(cols[1]), diesel: n(cols[2]) };
      if (cols[0] === 'Slovenia')   result.si = { petrol: n(cols[1]), diesel: n(cols[2]) };
      if (cols[0] === 'Croatia')    result.hr = { petrol: n(cols[1]), diesel: n(cols[2]) };
      if (cols[0] === 'Romania')    result.ro = { petrol: n(cols[1]), diesel: n(cols[2]) };
      if (cols[0] === 'Bulgaria')   result.bg = { petrol: n(cols[1]), diesel: n(cols[2]) };
      if (cols[0] === 'Luxembourg') result.lu = { petrol: n(cols[1]), diesel: n(cols[2]) };
      if (cols[0] === 'Malta')      result.mt = { petrol: n(cols[1]), diesel: n(cols[2]) };
      if (cols[0] === 'Cyprus')     result.cy = { petrol: n(cols[1]), diesel: n(cols[2]) };
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
      es_gasolina95: parsed.es ? mkFuel(parsed.es.petrol, 1.548) : { atual: 1.548, serie: [] },
      es_gasoleo:    parsed.es ? mkFuel(parsed.es.diesel, 1.685) : { atual: 1.685, serie: [] },
      fr_gasolina95: parsed.fr ? mkFuel(parsed.fr.petrol, 2.083) : { atual: 2.083, serie: [] },
      fr_gasoleo:    parsed.fr ? mkFuel(parsed.fr.diesel, 2.118) : { atual: 2.118, serie: [] },
      de_gasolina95: parsed.de ? mkFuel(parsed.de.petrol, 2.043) : { atual: 2.043, serie: [] },
      de_gasoleo:    parsed.de ? mkFuel(parsed.de.diesel, 1.972) : { atual: 1.972, serie: [] },
      it_gasolina95: parsed.it ? mkFuel(parsed.it.petrol, 1.937) : { atual: 1.937, serie: [] },
      it_gasoleo:    parsed.it ? mkFuel(parsed.it.diesel, 1.983) : { atual: 1.983, serie: [] },
      nl_gasolina95: parsed.nl ? mkFuel(parsed.nl.petrol, 2.388) : { atual: 2.388, serie: [] },
      nl_gasoleo:    parsed.nl ? mkFuel(parsed.nl.diesel, 2.285) : { atual: 2.285, serie: [] },
      ie_gasolina95: parsed.ie ? mkFuel(parsed.ie.petrol, 1.826) : { atual: 1.826, serie: [] },
      ie_gasoleo:    parsed.ie ? mkFuel(parsed.ie.diesel, 1.950) : { atual: 1.950, serie: [] },
      be_gasolina95: parsed.be ? mkFuel(parsed.be.petrol, 1.889) : { atual: 1.889, serie: [] },
      be_gasoleo:    parsed.be ? mkFuel(parsed.be.diesel, 2.112) : { atual: 2.112, serie: [] },
      at_gasolina95: parsed.at ? mkFuel(parsed.at.petrol, 1.813) : { atual: 1.813, serie: [] },
      at_gasoleo:    parsed.at ? mkFuel(parsed.at.diesel, 1.914) : { atual: 1.914, serie: [] },
      se_gasolina95: parsed.se ? mkFuel(parsed.se.petrol, 1.716) : { atual: 1.716, serie: [] },
      se_gasoleo:    parsed.se ? mkFuel(parsed.se.diesel, 1.896) : { atual: 1.896, serie: [] },
      pl_gasolina95: parsed.pl ? mkFuel(parsed.pl.petrol, 1.490) : { atual: 1.490, serie: [] },
      pl_gasoleo:    parsed.pl ? mkFuel(parsed.pl.diesel, 1.576) : { atual: 1.576, serie: [] },
      cz_gasolina95: parsed.cz ? mkFuel(parsed.cz.petrol, 1.743) : { atual: 1.743, serie: [] },
      cz_gasoleo:    parsed.cz ? mkFuel(parsed.cz.diesel, 1.673) : { atual: 1.673, serie: [] },
      gr_gasolina95: parsed.gr ? mkFuel(parsed.gr.petrol, 2.119) : { atual: 2.119, serie: [] },
      gr_gasoleo:    parsed.gr ? mkFuel(parsed.gr.diesel, 1.815) : { atual: 1.815, serie: [] },
      dk_gasolina95: parsed.dk ? mkFuel(parsed.dk.petrol, 2.339) : { atual: 2.339, serie: [] },
      dk_gasoleo:    parsed.dk ? mkFuel(parsed.dk.diesel, 2.181) : { atual: 2.181, serie: [] },
      fi_gasolina95: parsed.fi ? mkFuel(parsed.fi.petrol, 2.025) : { atual: 2.025, serie: [] },
      fi_gasoleo:    parsed.fi ? mkFuel(parsed.fi.diesel, 2.140) : { atual: 2.140, serie: [] },
      ee_gasolina95: parsed.ee ? mkFuel(parsed.ee.petrol, 1.812) : { atual: 1.812, serie: [] },
      ee_gasoleo:    parsed.ee ? mkFuel(parsed.ee.diesel, 1.802) : { atual: 1.802, serie: [] },
      lv_gasolina95: parsed.lv ? mkFuel(parsed.lv.petrol, 1.879) : { atual: 1.879, serie: [] },
      lv_gasoleo:    parsed.lv ? mkFuel(parsed.lv.diesel, 1.892) : { atual: 1.892, serie: [] },
      lt_gasolina95: parsed.lt ? mkFuel(parsed.lt.petrol, 1.824) : { atual: 1.824, serie: [] },
      lt_gasoleo:    parsed.lt ? mkFuel(parsed.lt.diesel, 1.926) : { atual: 1.926, serie: [] },
      hu_gasolina95: parsed.hu ? mkFuel(parsed.hu.petrol, 1.685) : { atual: 1.685, serie: [] },
      hu_gasoleo:    parsed.hu ? mkFuel(parsed.hu.diesel, 1.754) : { atual: 1.754, serie: [] },
      sk_gasolina95: parsed.sk ? mkFuel(parsed.sk.petrol, 1.801) : { atual: 1.801, serie: [] },
      sk_gasoleo:    parsed.sk ? mkFuel(parsed.sk.diesel, 1.718) : { atual: 1.718, serie: [] },
      si_gasolina95: parsed.si ? mkFuel(parsed.si.petrol, 1.699) : { atual: 1.699, serie: [] },
      si_gasoleo:    parsed.si ? mkFuel(parsed.si.diesel, 1.751) : { atual: 1.751, serie: [] },
      hr_gasolina95: parsed.hr ? mkFuel(parsed.hr.petrol, 1.700) : { atual: 1.700, serie: [] },
      hr_gasoleo:    parsed.hr ? mkFuel(parsed.hr.diesel, 1.785) : { atual: 1.785, serie: [] },
      ro_gasolina95: parsed.ro ? mkFuel(parsed.ro.petrol, 1.785) : { atual: 1.785, serie: [] },
      ro_gasoleo:    parsed.ro ? mkFuel(parsed.ro.diesel, 1.820) : { atual: 1.820, serie: [] },
      bg_gasolina95: parsed.bg ? mkFuel(parsed.bg.petrol, 1.530) : { atual: 1.530, serie: [] },
      bg_gasoleo:    parsed.bg ? mkFuel(parsed.bg.diesel, 1.706) : { atual: 1.706, serie: [] },
      lu_gasolina95: parsed.lu ? mkFuel(parsed.lu.petrol, 1.814) : { atual: 1.814, serie: [] },
      lu_gasoleo:    parsed.lu ? mkFuel(parsed.lu.diesel, 1.840) : { atual: 1.840, serie: [] },
      mt_gasolina95: parsed.mt ? mkFuel(parsed.mt.petrol, 1.340) : { atual: 1.340, serie: [] },
      mt_gasoleo:    parsed.mt ? mkFuel(parsed.mt.diesel, 1.210) : { atual: 1.210, serie: [] },
      cy_gasolina95: parsed.cy ? mkFuel(parsed.cy.petrol, 1.591) : { atual: 1.591, serie: [] },
      cy_gasoleo:    parsed.cy ? mkFuel(parsed.cy.diesel, 1.803) : { atual: 1.803, serie: [] },
      de_gasoleo:    parsed.de ? mkFuel(parsed.de.diesel, 1.680) : { atual: 1.680, serie: [] },
      fonte: 'eu_oil_bulletin', data: new Date().toISOString(),
    };
    cacheSet('combustiveis', r);
    return r;
  } catch(err) {
    console.error('[Comb] Erro:', err.message, '— fallback');
    return {
      ...Object.fromEntries(Object.entries(FB_FUEL).map(([k, v]) => [k, { ...v, dataActual: '2026-05-11', serie: [] }])),
      es_gasolina95: { atual: 1.548, serie: [] },
      es_gasoleo:    { atual: 1.685, serie: [] },
      fr_gasolina95: { atual: 2.083, serie: [] },
      fr_gasoleo:    { atual: 2.118, serie: [] },
      de_gasolina95: { atual: 2.043, serie: [] },
      de_gasoleo:    { atual: 1.972, serie: [] },
      it_gasolina95: { atual: 1.937, serie: [] },
      it_gasoleo:    { atual: 1.983, serie: [] },
      nl_gasolina95: { atual: 2.388, serie: [] },
      nl_gasoleo:    { atual: 2.285, serie: [] },
      ie_gasolina95: { atual: 1.826, serie: [] },
      ie_gasoleo:    { atual: 1.950, serie: [] },
      be_gasolina95: { atual: 1.889, serie: [] },
      be_gasoleo:    { atual: 2.112, serie: [] },
      at_gasolina95: { atual: 1.813, serie: [] },
      at_gasoleo:    { atual: 1.914, serie: [] },
      se_gasolina95: { atual: 1.716, serie: [] },
      se_gasoleo:    { atual: 1.896, serie: [] },
      pl_gasolina95: { atual: 1.490, serie: [] },
      pl_gasoleo:    { atual: 1.576, serie: [] },
      cz_gasolina95: { atual: 1.743, serie: [] },
      cz_gasoleo:    { atual: 1.673, serie: [] },
      gr_gasolina95: { atual: 2.119, serie: [] },
      gr_gasoleo:    { atual: 1.815, serie: [] },
      dk_gasolina95: { atual: 2.339, serie: [] },
      dk_gasoleo:    { atual: 2.181, serie: [] },
      fi_gasolina95: { atual: 2.025, serie: [] },
      fi_gasoleo:    { atual: 2.140, serie: [] },
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
    return { preco: 100.21, moeda: 'USD', fonte: 'fallback', data: new Date().toISOString() };
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
