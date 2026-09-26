// ================================================================
//  NTX Expedição — Cloudflare Worker
//  Substitui o Code.gs do Google Apps Script
//
//  Secrets necessários no Cloudflare (wrangler secret put):
//    GOOGLE_SA_EMAIL   → e-mail da Service Account
//    GOOGLE_PRIVATE_KEY → chave privada PEM (pode ter \n como literal)
//
//  Deploy:
//    1. wrangler deploy
//    2. Copie a URL do Worker e cole em ntx-expedicao.html → API_BASE
// ================================================================

const SHEET_ID   = '1AGUT3jyD1KH3H1UmCTfQjYxzQQoSJgjJBB_Ueu5uu30';
const SHEET_NAME = 'Controle de coletas NTX';
const ALLOWED    = ['https://nortexcontrol.pages.dev'];

// ── GOOGLE JWT ───────────────────────────────────────────────────────
function b64url(input) {
  const b64 = typeof input === 'string'
    ? btoa(unescape(encodeURIComponent(input)))
    : btoa(String.fromCharCode(...new Uint8Array(input)));
  return b64.replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}

async function googleToken(env) {
  const now = Math.floor(Date.now() / 1000);
  const hdr = b64url(JSON.stringify({ alg:'RS256', typ:'JWT' }));
  const pay = b64url(JSON.stringify({
    iss:   env.GOOGLE_SA_EMAIL,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud:   'https://oauth2.googleapis.com/token',
    iat:   now,
    exp:   now + 3600
  }));
  const msg = `${hdr}.${pay}`;

  // Normaliza a chave (o Cloudflare armazena \n como literal)
  const pem  = env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n');
  const body = pem.replace(/-----[A-Z ]+-----/g,'').replace(/\s+/g,'');
  const der  = Uint8Array.from(atob(body), c => c.charCodeAt(0));

  const key = await crypto.subtle.importKey(
    'pkcs8', der,
    { name:'RSASSA-PKCS1-v1_5', hash:'SHA-256' },
    false, ['sign']
  );
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(msg));
  const jwt = `${msg}.${b64url(sig)}`;

  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type':'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`
  });
  const d = await r.json();
  if (!d.access_token) throw new Error('Auth Google falhou: ' + JSON.stringify(d));
  return d.access_token;
}

// ── SHEETS HELPERS ───────────────────────────────────────────────────
async function sheetsRead(range, env) {
  const tok = await googleToken(env);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(range)}`;
  const r = await fetch(url, { headers:{ Authorization:`Bearer ${tok}` } });
  if (!r.ok) throw new Error('Sheets read: ' + await r.text());
  return (await r.json()).values || [];
}

async function sheetsWrite(range, values, env) {
  const tok = await googleToken(env);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`;
  const r = await fetch(url, {
    method: 'PUT',
    headers: { Authorization:`Bearer ${tok}`, 'Content-Type':'application/json' },
    body: JSON.stringify({ range, majorDimension:'ROWS', values })
  });
  if (!r.ok) throw new Error('Sheets write: ' + await r.text());
  return await r.json();
}

async function sheetsAppend(values, env) {
  const tok   = await googleToken(env);
  const range = `${SHEET_NAME}!A:L`;
  const url   = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization:`Bearer ${tok}`, 'Content-Type':'application/json' },
    body: JSON.stringify({ range, majorDimension:'ROWS', values })
  });
  if (!r.ok) throw new Error('Sheets append: ' + await r.text());
  return await r.json();
}

async function sheetsBatch(data, env) {
  const tok = await googleToken(env);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values:batchUpdate`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization:`Bearer ${tok}`, 'Content-Type':'application/json' },
    body: JSON.stringify({ valueInputOption:'USER_ENTERED', data })
  });
  if (!r.ok) throw new Error('Sheets batch: ' + await r.text());
  return await r.json();
}

// ── DATA HELPERS ─────────────────────────────────────────────────────
function fmtDate(v) {
  if (v == null || v === '' || String(v).toUpperCase() === 'A DEFINIR') return 'A DEFINIR';
  if (typeof v === 'number') {
    const d = new Date((v - 25569) * 86400000);
    return [String(d.getUTCDate()).padStart(2,'0'), String(d.getUTCMonth()+1).padStart(2,'0'), d.getUTCFullYear()].join('/');
  }
  return String(v).trim();
}
function toNum(v) {
  if (typeof v === 'number') return v;
  const n = Number(String(v||'0').replace(',','.'));
  return isNaN(n) ? 0 : n;
}
function norm(v) {
  if (typeof v === 'boolean') return v;
  return ['SIM','TRUE','VERDADEIRO','X','1','RT'].includes(String(v||'').trim().toUpperCase());
}
function agora() {
  return new Date().toLocaleString('pt-BR', {
    timeZone:'America/Sao_Paulo',
    day:'2-digit', month:'2-digit', year:'numeric',
    hour:'2-digit', minute:'2-digit'
  });
}
function parseRows(rows) {
  return rows
    .map(r => ({
      nf:              String(r[0]||'').trim(),
      emissao:         fmtDate(r[1]),
      cliente:         String(r[2]||'').trim(),
      uf:              String(r[3]||'').trim().toUpperCase(),
      volumes:         toNum(r[4]),
      pesoBruto:       toNum(r[5]),
      metragem:        toNum(r[6]),
      dataColeta:      fmtDate(r[7]),
      transportadora:  String(r[8]||'').trim(),
      retida:          norm(r[9]),
      embarcada:       norm(r[10]),
      coletaSolicitada:norm(r[11])
    }))
    .filter(n => n.nf);
}
function notaToRow(n, cs = false) {
  return [
    n.nf||'', n.emissao||'', n.cliente||'', (n.uf||'').toUpperCase(),
    toNum(n.volumes), toNum(n.pesoBruto), toNum(n.metragem),
    n.dataColeta||'A DEFINIR', n.transportadora||'',
    n.retida?'SIM':'NÃO', n.embarcada?'SIM':'NÃO',
    cs?'SIM':'NÃO'
  ];
}
function buildResumo(notas) {
  const r = { totalNotas:notas.length, totalVolumes:0, totalPeso:0, totalMetragem:0, totalRetidas:0, totalEmbarcadas:0, porTransportadora:{}, porUF:{} };
  notas.forEach(n => {
    r.totalVolumes  += n.volumes||0;
    r.totalPeso     += n.pesoBruto||0;
    r.totalMetragem += n.metragem||0;
    if (n.retida)   r.totalRetidas++;
    if (n.embarcada) r.totalEmbarcadas++;
    if (n.transportadora) {
      if (!r.porTransportadora[n.transportadora]) r.porTransportadora[n.transportadora]={volumes:0,peso:0,metragem:0,notas:0};
      r.porTransportadora[n.transportadora].volumes  += n.volumes||0;
      r.porTransportadora[n.transportadora].peso     += n.pesoBruto||0;
      r.porTransportadora[n.transportadora].metragem += n.metragem||0;
      r.porTransportadora[n.transportadora].notas++;
    }
    if (n.uf) {
      if (!r.porUF[n.uf]) r.porUF[n.uf]={volumes:0,notas:0};
      r.porUF[n.uf].volumes += n.volumes||0;
      r.porUF[n.uf].notas++;
    }
  });
  return r;
}

// ── HANDLERS ─────────────────────────────────────────────────────────
async function handleGetDados(env) {
  const rows  = await sheetsRead(`${SHEET_NAME}!A2:L`, env);
  const notas = parseRows(rows);
  return { notas, resumo:buildResumo(notas), atualizado:agora() };
}

async function handleInserirNota(body, env) {
  const d = body.data || body;
  if (!d.nf || !d.cliente || !d.uf || !d.transportadora)
    return { sucesso:false, mensagem:'Campos obrigatórios faltando (nf, cliente, uf, transportadora).' };
  await sheetsAppend([notaToRow(d)], env);
  return { sucesso:true, mensagem:`Nota ${d.nf} inserida com sucesso!` };
}

async function handleAtualizarNota(body, env) {
  const { nf, campos } = body;
  const colA = await sheetsRead(`${SHEET_NAME}!A2:A`, env);
  const idx  = colA.findIndex(r => String(r[0]||'').trim() === String(nf).trim());
  if (idx === -1) return { sucesso:false, mensagem:`NF ${nf} não encontrada.` };
  const rowNum   = idx + 2;
  const existing = await sheetsRead(`${SHEET_NAME}!A${rowNum}:L${rowNum}`, env);
  const linha    = existing[0] || Array(12).fill('');
  const keys     = ['nf','emissao','cliente','uf','volumes','pesoBruto','metragem','dataColeta','transportadora','retida','embarcada','coletaSolicitada'];
  keys.forEach((k,i) => {
    if (campos[k] === undefined) return;
    linha[i] = (k==='retida'||k==='embarcada'||k==='coletaSolicitada') ? (campos[k]?'SIM':'NÃO') : campos[k];
  });
  await sheetsWrite(`${SHEET_NAME}!A${rowNum}:L${rowNum}`, [linha], env);
  return { sucesso:true, mensagem:`NF ${nf} atualizada com sucesso!` };
}

async function handleImportar(body, env) {
  const lista = body.notas || [];
  if (!lista.length) return { sucesso:false, mensagem:'Nenhuma nota válida recebida.' };
  const colA = await sheetsRead(`${SHEET_NAME}!A2:A`, env);
  const mapa = {};
  colA.forEach((r,i) => { const nf=String(r[0]||'').trim(); if(nf) mapa[nf]=i+2; });
  const updates=[], inserts=[];
  let ignoradas=0;
  lista.forEach(n => {
    const nf = String(n.nf||'').trim();
    if (!nf) { ignoradas++; return; }
    const row = notaToRow(n);
    if (mapa[nf]) updates.push({ range:`${SHEET_NAME}!A${mapa[nf]}:L${mapa[nf]}`, majorDimension:'ROWS', values:[row] });
    else inserts.push(row);
  });
  if (updates.length) await sheetsBatch(updates, env);
  if (inserts.length) await sheetsAppend(inserts, env);
  const msg = `Importação concluída! ${inserts.length} inseridas, ${updates.length} atualizadas, ${ignoradas} ignoradas.`;
  return { sucesso:true, inseridas:inserts.length, atualizadas:updates.length, ignoradas, erros:[], mensagem:msg };
}

async function handleGetTransportadoras(env) {
  const rows = await sheetsRead(`${SHEET_NAME}!I2:K`, env);
  const set  = {};
  rows.forEach(r => { const t=String(r[0]||'').trim(); if(t&&!norm(r[2])) set[t]=true; });
  return Object.keys(set).sort();
}

async function handleEmailColeta(body, env) {
  const { transportadora } = body;
  if (!transportadora) return { sucesso:false, mensagem:'Transportadora não informada.' };
  const rows = await sheetsRead(`${SHEET_NAME}!A2:L`, env);
  const nfsRetidas={}, nfsEmbarcadas={};
  try { (await sheetsRead('Retidas!A2:A', env)).forEach(r=>{ const nf=String(r[0]||'').trim(); if(nf) nfsRetidas[nf]=true; }); } catch(e){}
  try { (await sheetsRead('Embarcada!A2:A', env)).forEach(r=>{ const nf=String(r[0]||'').trim(); if(nf) nfsEmbarcadas[nf]=true; }); } catch(e){}
  const notas = [];
  rows.forEach(r => {
    const nf=String(r[0]||'').trim(), transp=String(r[8]||'').trim();
    if (!nf) return;
    if (transp.toUpperCase()!==transportadora.toUpperCase()) return;
    if (norm(r[10])||nfsEmbarcadas[nf]) return;  // embarcada
    if (norm(r[11])) return;                       // coleta já solicitada
    notas.push({ nf, cliente:String(r[2]||'').trim(), uf:String(r[3]||'').trim().toUpperCase(),
      volumes:toNum(r[4]), pesoBruto:toNum(r[5]), metragem:toNum(r[6]),
      transportadora:transp, retida:norm(r[9])||!!nfsRetidas[nf] });
  });
  notas.sort((a,b)=>String(a.nf).localeCompare(String(b.nf),'pt-BR',{numeric:true}));
  const totais={notas:notas.length,volumes:0,pesoBruto:0,metragem:0,retidas:0};
  notas.forEach(n=>{totais.volumes+=n.volumes||0;totais.pesoBruto+=n.pesoBruto||0;totais.metragem+=n.metragem||0;if(n.retida)totais.retidas++;});
  return { sucesso:true, transportadora, notas, totais, mensagem:`${notas.length} notas pendentes encontradas.` };
}

async function handleMarcarColeta(body, env, marcar) {
  const nfs = body.nfs || [];
  if (!nfs.length) return { sucesso:false, mensagem:'Nenhuma NF informada.' };
  const colA = await sheetsRead(`${SHEET_NAME}!A2:A`, env);
  const set  = new Set(nfs.map(n=>String(n).trim()));
  const updates = [];
  colA.forEach((r,i) => {
    const nf=String(r[0]||'').trim();
    if (nf&&set.has(nf)) updates.push({ range:`${SHEET_NAME}!L${i+2}`, majorDimension:'ROWS', values:[[marcar?'SIM':'NÃO']] });
  });
  if (updates.length) await sheetsBatch(updates, env);
  const acao = marcar ? 'marcadas como "Coleta Solicitada"' : 'reabertas para nova solicitação';
  return { sucesso:true, marcadas:updates.length, mensagem:`${updates.length} NF(s) ${acao}.` };
}

// ── CORS / RESPONSE ──────────────────────────────────────────────────
function corsHeaders(origin) {
  const ao = ALLOWED.includes(origin) ? origin : ALLOWED[0];
  return {
    'Access-Control-Allow-Origin':  ao,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age':       '86400'
  };
}
function respond(data, status=200, origin='') {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type':'application/json', ...corsHeaders(origin) }
  });
}

// ── ROUTER ───────────────────────────────────────────────────────────
export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin') || '';

    if (req.method === 'OPTIONS')
      return new Response(null, { status:204, headers:corsHeaders(origin) });

    const path = new URL(req.url).pathname.replace(/\/+$/,'');

    try {
      if (req.method === 'GET') {
        if (path === '/dados')           return respond(await handleGetDados(env), 200, origin);
        if (path === '/transportadoras') return respond(await handleGetTransportadoras(env), 200, origin);
      }
      if (req.method === 'POST') {
        const b = await req.json().catch(()=>({}));
        if (path === '/inserir')         return respond(await handleInserirNota(b, env), 200, origin);
        if (path === '/atualizar')       return respond(await handleAtualizarNota(b, env), 200, origin);
        if (path === '/importar')        return respond(await handleImportar(b, env), 200, origin);
        if (path === '/email-coleta')    return respond(await handleEmailColeta(b, env), 200, origin);
        if (path === '/marcar-coleta')   return respond(await handleMarcarColeta(b, env, true), 200, origin);
        if (path === '/reabrir-coleta')  return respond(await handleMarcarColeta(b, env, false), 200, origin);
      }
      return respond({ erro:'Rota não encontrada' }, 404, origin);
    } catch(e) {
      console.error('[NTX Worker]', e);
      return respond({ sucesso:false, erro:e.message||'Erro interno' }, 500, origin);
    }
  }
};
