/**
 * Portugal em Números — Backend v0.4
 * Serve também o ficheiro HTML estático — acede em http://localhost:3000
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

// ── Serve o HTML na raiz ──────────────────────
// Procura o ficheiro HTML na mesma pasta do server.js
// Serve index.html at root
app.get('/', (req, res) => {
  const candidates = [
    path.join(__dirname, 'index.html'),
    path.join(__dirname, '..', 'index.html'),
    path.join(__dirname, '../..', 'index.html'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return res.sendFile(p);
  }
  res.send('<h2>Place <code>index.html</code> in the dashboard folder and restart.</h2>');
});

// Serve portugal.html at /portugal
app.get('/portugal', (req, res) => {
  const candidates = [
    path.join(__dirname, 'portugal-v4.html'),
    path.join(__dirname, '..', 'portugal-v4.html'),
    path.join(__dirname, '../..', 'portugal-v4.html'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return res.sendFile(p);
  }
  res.send('<h2>Place <code>portugal-v4.html</code> in the dashboard folder and restart.</h2>');
});

// ── Serve bibliotecas JS locais ──────────────
app.get('/libs/d3.min.js',        (req,res) => res.sendFile(path.join(__dirname,'node_modules','d3','dist','d3.min.js')));
app.get('/libs/chart.umd.js',     (req,res) => res.sendFile(path.join(__dirname,'node_modules','chart.js','dist','chart.umd.min.js')));
app.get('/libs/topojson.min.js',  (req,res) => res.sendFile(path.join(__dirname,'node_modules','topojson-client','dist','topojson-client.min.js')));
app.get('/libs/prt.topo.json',    (req,res) => res.sendFile(path.join(__dirname,'node_modules','datamaps','src','js','data','prt.topo.json')));



// ── CACHE ─────────────────────────────────────
const CACHE = {};
const TTL   = { combustiveis: 12*60*60*1000, brent: 30*60*1000 };
const cacheGet = k => { const e=CACHE[k]; return (e && Date.now()-e.ts<TTL[k]) ? e.data : null; };
const cacheSet = (k,d) => { CACHE[k]={data:d,ts:Date.now()}; };

// ── FALLBACK ──────────────────────────────────
const FB = {
  gasolina95: { atual:1.927, anterior:1.921, variacao:+0.006 },
  gasoleo:    { atual:1.958, anterior:1.928, variacao:+0.030 },
  gpl:        { atual:0.930, anterior:0.928, variacao:+0.002 },
  gasolina98: { atual:2.049, anterior:2.049, variacao: 0.000 },
};

// ── HTTP fetch com redirects ──────────────────
function fetchText(url, ms=12000, hops=0) {
  return new Promise((res,rej) => {
    if (hops>5) return rej(new Error('Demasiados redirects'));
    const lib = url.startsWith('https') ? https : http;
    const t   = setTimeout(()=>rej(new Error('Timeout')), ms);
    lib.get(url, {headers:{'User-Agent':'Mozilla/5.0','Accept':'text/plain,*/*'}}, r => {
      if ([301,302,307,308].includes(r.statusCode) && r.headers.location) {
        clearTimeout(t); r.resume();
        const next = r.headers.location.startsWith('http')
          ? r.headers.location : new URL(r.headers.location,url).href;
        fetchText(next,ms,hops+1).then(res).catch(rej);
        return;
      }
      if (r.statusCode!==200){ clearTimeout(t); return rej(new Error('HTTP '+r.statusCode)); }
      let b=''; r.on('data',c=>b+=c); r.on('end',()=>{ clearTimeout(t); res(b); });
    }).on('error',e=>{ clearTimeout(t); rej(e); });
  });
}

async function fetchJSON(url, ms=10000) {
  const t = await fetchText(url, ms);
  try { return JSON.parse(t); }
  catch(e) { throw new Error('JSON inválido: '+t.slice(0,150)); }
}

// ── Parse fuel-prices.eu ──────────────────────
function parseWeeklyTable(text) {
  const dateM = text.match(/##\s+Latest Report:\s+([A-Za-z]+ \d+, \d+)/);
  const date  = dateM ? new Date(dateM[1]).toISOString().slice(0,10) : null;
  for (const line of text.split('\n')) {
    if (!line.includes('Portugal')) continue;
    const cols = line.split('|').map(s=>s.trim()).filter(Boolean);
    if (cols.length>=3 && cols[0]==='Portugal') {
      const n = s => parseFloat(s.replace(/[€$\s]/g,'').replace(',','.'));
      return { petrol: n(cols[1]), diesel: n(cols[2]), date };
    }
  }
  throw new Error('Portugal não encontrado na tabela');
}

// ── Combustíveis ──────────────────────────────
async function fetchCombustiveis() {
  const cached = cacheGet('combustiveis');
  if (cached) { console.log('[Comb] cache hit'); return cached; }
  try {
    console.log('[Comb] A buscar fuel-prices.eu...');
    const text   = await fetchText('https://www.fuel-prices.eu/weekly/llms.txt');
    const parsed = parseWeeklyTable(text);
    console.log(`[Comb] ✅  gasolina95: ${parsed.petrol} | gasóleo: ${parsed.diesel} | ${parsed.date}`);
    const r = {
      gasolina95: { atual:parsed.petrol, anterior:FB.gasolina95.atual, variacao:+(parsed.petrol-FB.gasolina95.atual).toFixed(4), dataActual:parsed.date, serie:[] },
      gasoleo:    { atual:parsed.diesel, anterior:FB.gasoleo.atual,    variacao:+(parsed.diesel-FB.gasoleo.atual).toFixed(4),    dataActual:parsed.date, serie:[] },
      gpl:        { ...FB.gpl,        dataActual:parsed.date, serie:[] },
      gasolina98: { ...FB.gasolina98, dataActual:parsed.date, serie:[] },
      fonte:'eu_oil_bulletin', data:new Date().toISOString(),
    };
    cacheSet('combustiveis', r);
    return r;
  } catch(err) {
    console.error('[Comb] Erro:', err.message, '— fallback');
    return { ...Object.fromEntries(Object.entries(FB).map(([k,v])=>[k,{...v,dataActual:'2026-04-27',serie:[]}])),
             fonte:'fallback', erro:err.message, data:new Date().toISOString() };
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
    const r = { preco:parseFloat(preco.toFixed(2)), moeda:'USD', fonte:'yahoo_finance', data:new Date().toISOString() };
    console.log(`[Brent] ✅  ${r.preco} USD/bbl`);
    cacheSet('brent', r);
    return r;
  } catch(err) {
    console.error('[Brent] Erro:', err.message, '— fallback');
    return { preco:108.0, moeda:'USD', fonte:'fallback', data:new Date().toISOString() };
  }
}

// ── ROTAS API ─────────────────────────────────
app.get('/api/combustiveis', async (req,res) => {
  const [combustiveis, brent] = await Promise.all([fetchCombustiveis(), fetchBrent()]);
  res.json({ ok:true, combustiveis, brent, timestamp:new Date().toISOString() });
});

app.get('/api/status', (req,res) => {
  const age = k => CACHE[k] ? Math.round((Date.now()-CACHE[k].ts)/60000) : null;
  res.json({ ok:true, versao:'0.4',
    cache:{ combustiveis:{idade_min:age('combustiveis')}, brent:{idade_min:age('brent')} },
    timestamp:new Date().toISOString() });
});

app.get('/api/refresh', async (req,res) => {
  delete CACHE.combustiveis; delete CACHE.brent;
  const [combustiveis, brent] = await Promise.all([fetchCombustiveis(), fetchBrent()]);
  res.json({ ok:true, msg:'Cache actualizado', combustiveis, brent });
});

// ── ARRANQUE ──────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🇵🇹  Portugal em Números — Backend v0.4`);
  console.log(`\n     🌐 Abre o dashboard em: http://localhost:${PORT}`);
  console.log(`\n     📡 API: http://localhost:${PORT}/api/combustiveis`);
  console.log(`     📡 API: http://localhost:${PORT}/api/status`);
  console.log(`     📡 API: http://localhost:${PORT}/api/refresh\n`);
  fetchCombustiveis();
  fetchBrent();
});
