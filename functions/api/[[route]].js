// ================================================================
//  NTX Expedição — Cloudflare Pages Function (catch-all /api/*)
//  Roda dentro do mesmo projeto Pages — sem Worker separado
//
//  Secrets: Settings → Environment variables do projeto Pages
//    GOOGLE_SA_EMAIL   → e-mail da Service Account
//    GOOGLE_PRIVATE_KEY → chave privada PEM
//
//  Rotas (prefixo /api/ automático pelo diretório functions/api/):
//    GET  /api/dados            → lê todos os registros
//    GET  /api/transportadoras  → lista transportadoras com pendências
//    POST /api/inserir          → insere nota
//    POST /api/atualizar        → atualiza nota
//    POST /api/importar         → importação em lote
//    POST /api/email-coleta     → notas pendentes por transportadora
//    POST /api/marcar-coleta    → marca coleta solicitada
//    POST /api/reabrir-coleta   → reabre coleta
// ================================================================

const SHEET_ID   = '1AGUT3jyD1KH3H1UmCTfQjYxzQQoSJgjJBB_Ueu5uu30';
const SHEET_NAME = 'Controle de coletas NTX';

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
    iat:   now, exp: now + 3600
  }));
  const msg = `${hdr}.${pay}`;
  const pem  = env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n');
  const body = pem.replace(/-----[A-Z ]+-----/g,'').replace(/\s+/g,'');
  const der  = Uint8Array.from(atob(body), c => c.charCodeAt(0));
  const key  = await crypto.subtle.importKey(
    'pkcs8', der, { name:'RSASSA-PKCS1-v1_5', hash:'SHA-256' }, false, ['sign']
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

// ── SHEETS API ───────────────────────────────────────────────────────
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
  const r = await fetch(url, { method:'PUT', headers:{ Authorization:`Bearer ${tok}`, 'Content-Type':'application/json' }, body: JSON.stringify({ range, majorDimension:'ROWS', values }) });
  if (!r.ok) throw new Error('Sheets write: ' + await r.text());
  return await r.json();
}
async function sheetsAppend(values, env) {
  const tok   = await googleToken(env);
  const range = `${SHEET_NAME}!A:L`;
  const url   = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
  const r = await fetch(url, { method:'POST', headers:{ Authorization:`Bearer ${tok}`, 'Content-Type':'application/json' }, body: JSON.stringify({ range, majorDimension:'ROWS', values }) });
  if (!r.ok) throw new Error('Sheets append: ' + await r.text());
  return await r.json();
}
async function sheetsBatch(data, env) {
  const tok = await googleToken(env);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values:batchUpdate`;
  const r = await fetch(url, { method:'POST', headers:{ Authorization:`Bearer ${tok}`, 'Content-Type':'application/json' }, body: JSON.stringify({ valueInputOption:'USER_ENTERED', data }) });
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
function toNum(v) { if (typeof v === 'number') return v; const n = Number(String(v||'0').replace(',','.')); return isNaN(n) ? 0 : n; }
function norm(v)  { if (typeof v === 'boolean') return v; return ['SIM','TRUE','VERDADEIRO','X','1','RT'].includes(String(v||'').trim().toUpperCase()); }
function agora()  { return new Date().toLocaleString('pt-BR', { timeZone:'America/Sao_Paulo', day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' }); }

function parseRows(rows) {
  return rows.map(r => ({
    nf: String(r[0]||'').trim(), emissao: fmtDate(r[1]),
    cliente: String(r[2]||'').trim(), uf: String(r[3]||'').trim().toUpperCase(),
    volumes: toNum(r[4]), pesoBruto: toNum(r[5]), metragem: toNum(r[6]),
    dataColeta: fmtDate(r[7]), transportadora: String(r[8]||'').trim(),
    retida: norm(r[9]), embarcada: norm(r[10]), coletaSolicitada: norm(r[11])
  })).filter(n => n.nf);
}
function notaToRow(n, cs = false) {
  return [ n.nf||'', n.emissao||'', n.cliente||'', (n.uf||'').toUpperCase(),
    toNum(n.volumes), toNum(n.pesoBruto), toNum(n.metragem),
    n.dataColeta||'A DEFINIR', n.transportadora||'',
    n.retida?'SIM':'NÃO', n.embarcada?'SIM':'NÃO', cs?'SIM':'NÃO' ];
}

// ── HANDLERS ─────────────────────────────────────────────────────────
async function getDados(env) {
  const rows  = await sheetsRead(`${SHEET_NAME}!A2:L`, env);
  const notas = parseRows(rows);
  return { notas, atualizado: agora() };
}
async function inserirNota(body, env) {
  const d = body.data || body;
  if (!d.nf || !d.cliente || !d.uf || !d.transportadora)
    return { sucesso:false, mensagem:'Campos obrigatórios faltando.' };
  await sheetsAppend([notaToRow(d)], env);
  return { sucesso:true, mensagem:`Nota ${d.nf} inserida com sucesso!` };
}
async function atualizarNota(body, env) {
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
async function importar(body, env) {
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
  return { sucesso:true, inseridas:inserts.length, atualizadas:updates.length, ignoradas, erros:[],
    mensagem:`Importação concluída! ${inserts.length} inseridas, ${updates.length} atualizadas, ${ignoradas} ignoradas.` };
}
async function getTransportadoras(env) {
  const rows = await sheetsRead(`${SHEET_NAME}!I2:K`, env);
  const set  = {};
  rows.forEach(r => { const t=String(r[0]||'').trim(); if(t&&!norm(r[2])) set[t]=true; });
  return Object.keys(set).sort();
}
async function emailColeta(body, env) {
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
    if (norm(r[10])||nfsEmbarcadas[nf]) return;
    if (norm(r[11])) return;
    notas.push({ nf, cliente:String(r[2]||'').trim(), uf:String(r[3]||'').trim().toUpperCase(),
      volumes:toNum(r[4]), pesoBruto:toNum(r[5]), metragem:toNum(r[6]),
      transportadora:transp, retida:norm(r[9])||!!nfsRetidas[nf] });
  });
  notas.sort((a,b)=>String(a.nf).localeCompare(String(b.nf),'pt-BR',{numeric:true}));
  const totais={notas:notas.length,volumes:0,pesoBruto:0,metragem:0,retidas:0};
  notas.forEach(n=>{totais.volumes+=n.volumes||0;totais.pesoBruto+=n.pesoBruto||0;totais.metragem+=n.metragem||0;if(n.retida)totais.retidas++;});
  return { sucesso:true, transportadora, notas, totais, mensagem:`${notas.length} notas pendentes encontradas.` };
}
async function marcarColeta(body, env, marcar) {
  const nfs = body.nfs || [];
  if (!nfs.length) return { sucesso:false, mensagem:'Nenhuma NF informada.' };
  const colA = await sheetsRead(`${SHEET_NAME}!A2:A`, env);
  const set  = new Set(nfs.map(n=>String(n).trim()));
  const updates = [];
  colA.forEach((r,i)=>{ const nf=String(r[0]||'').trim(); if(nf&&set.has(nf)) updates.push({ range:`${SHEET_NAME}!L${i+2}`, majorDimension:'ROWS', values:[[marcar?'SIM':'NÃO']] }); });
  if (updates.length) await sheetsBatch(updates, env);
  return { sucesso:true, marcadas:updates.length, mensagem:`${updates.length} NF(s) ${marcar?'marcadas':'reabertas'}.` };
}

// ── RESPONSE ─────────────────────────────────────────────────────────
function ok(data)  { return new Response(JSON.stringify(data), { headers:{ 'Content-Type':'application/json' } }); }
function err(msg, status=500) { return new Response(JSON.stringify({ sucesso:false, erro:msg }), { status, headers:{ 'Content-Type':'application/json' } }); }

// ── ENTRY POINT (Pages Function) ─────────────────────────────────────
export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS')
    return new Response(null, { status:204, headers:{ 'Access-Control-Allow-Origin':'*', 'Access-Control-Allow-Methods':'GET,POST,OPTIONS', 'Access-Control-Allow-Headers':'Content-Type' } });

  const path = new URL(request.url).pathname.replace(/\/api\/?/,'').replace(/\/+$/,'');

  try {
    if (request.method === 'GET') {
      if (path === 'dados')           return ok(await getDados(env));
      if (path === 'transportadoras') return ok(await getTransportadoras(env));
    }
    if (request.method === 'POST') {
      const b = await request.json().catch(()=>({}));
      if (path === 'inserir')         return ok(await inserirNota(b, env));
      if (path === 'atualizar')       return ok(await atualizarNota(b, env));
      if (path === 'importar')        return ok(await importar(b, env));
      if (path === 'email-coleta')    return ok(await emailColeta(b, env));
      if (path === 'marcar-coleta')   return ok(await marcarColeta(b, env, true));
      if (path === 'reabrir-coleta')  return ok(await marcarColeta(b, env, false));
    }
    return err('Rota não encontrada', 404);
  } catch(e) {
    console.error('[NTX Pages Function]', e);
    return err(e.message || 'Erro interno', 500);
  }
}
