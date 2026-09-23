// ══════════════════════════════════════════
// Notas Santana — App Shell compartilhado (padrão Nortex)
// Auth guard, sessão com expiração, toast, drawer, bottom nav, API e leitor
// de código de barras. Carregado no FIM do <body> de todas as páginas.
//
// Páginas públicas (login) usam <body data-publica> e ficam sem guarda.
// ══════════════════════════════════════════

// ── CONFIGURAÇÃO DO APP (o script novo_app.py preenche isto) ──
const APP = {
  nome: 'Notas Santana',
  prefixo: 'notas',        // prefixo das chaves do localStorage
  apiBase: 'https://SEU-WORKER.workers.dev',           // URL do Cloudflare Worker
  apiPrefixo: '/api/notas',     // ex.: /api/meuapp — todo apiGet('/x') vira apiBase + apiPrefixo + '/x'
  sessaoMin: 10,                     // minutos de inatividade até deslogar
  avisoSeg: 30,                      // segundos de aviso antes de expirar
  demo: true,               // true = usa window.APP_DEMO em vez do servidor (só para ver o visual)
};

const _k = (nome) => APP.prefixo + '_' + nome;

// ── SESSÃO ──
// O token assinado pelo servidor é quem AUTORIZA. Os outros campos servem só para
// a interface (mostrar nome, esconder menu de ADM) — o backend valida tudo de novo.
const SESSAO = {
  token: localStorage.getItem(_k('token')),
  usuario: localStorage.getItem(_k('usuario')),
  nome: localStorage.getItem(_k('nome')),
  funcao: localStorage.getItem(_k('funcao')) || '',
  email: localStorage.getItem(_k('email')) || '',
  nivel: localStorage.getItem(_k('nivel')) || 'NORMAL',
};
const IS_ADM = SESSAO.nivel === 'ADM';
const PAGINA_PUBLICA = document.body && document.body.hasAttribute('data-publica');

function salvarSessao(dados, usuario) {
  localStorage.setItem(_k('token'), dados.token);
  localStorage.setItem(_k('usuario'), usuario);
  localStorage.setItem(_k('nome'), dados.nome);
  localStorage.setItem(_k('funcao'), dados.funcao || '');
  localStorage.setItem(_k('email'), dados.email || '');
  localStorage.setItem(_k('nivel'), dados.nivel || 'NORMAL');
  localStorage.setItem(_k('login_time'), String(Date.now()));
}

if (!PAGINA_PUBLICA && (!SESSAO.token || !SESSAO.usuario || !SESSAO.nome)) {
  window.location.replace('login.html');
}

async function appLimparCaches() {
  // Sem isso, respostas de API continuariam acessíveis pelo Cache Storage depois
  // do logout — problema real em coletor ou tablet compartilhado.
  try {
    if (window.caches) {
      const chaves = await caches.keys();
      await Promise.all(chaves.map((k) => caches.delete(k)));
    }
  } catch (e) { /* cache indisponível, segue o logout */ }
}

async function appLogout() {
  ['token', 'usuario', 'nome', 'funcao', 'email', 'nivel', 'login_time'].forEach((c) => localStorage.removeItem(_k(c)));
  await appLimparCaches();
  window.location.replace('login.html');
}

// Chamar no topo de páginas restritas a ADM. Isto é só UX: quem bloqueia de verdade é o backend.
function exigirAdmin() {
  if (!IS_ADM) window.location.replace('index.html');
}

// ── SESSÃO COM EXPIRAÇÃO POR INATIVIDADE ──
(function iniciarControleSessao() {
  if (PAGINA_PUBLICA || !SESSAO.token || APP.demo) return;

  const DURACAO_MS = APP.sessaoMin * 60 * 1000;
  const AVISO_MS = APP.avisoSeg * 1000;

  let loginTime = parseInt(localStorage.getItem(_k('login_time')), 10);
  if (!loginTime || isNaN(loginTime)) {
    loginTime = Date.now();
    localStorage.setItem(_k('login_time'), String(loginTime));
  }
  if (Date.now() >= loginTime + DURACAO_MS) { appLogout(); return; }

  let modalEl = null, contadorInterval = null, expiracaoTimeout = null, avisoTimeout = null;

  function criarModalSessao() {
    if (modalEl) return modalEl;
    const div = document.createElement('div');
    div.innerHTML = `
      <div class="modal-overlay" id="modalSessaoExpirando" style="z-index:999;">
        <div class="modal-sheet" style="text-align:center;padding-top:28px;">
          <div style="width:54px;height:54px;border-radius:50%;background:var(--color-warning-dim);display:flex;align-items:center;justify-content:center;margin:0 auto 16px;">
            <svg viewBox="0 0 24 24" width="26" height="26" stroke="var(--color-warning)" fill="none" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          </div>
          <div style="font-size:16.5px;font-weight:800;color:var(--color-on-surface);margin-bottom:6px;">Sua sessão vai expirar</div>
          <div style="font-size:13px;color:var(--color-muted-light);margin-bottom:18px;">Por segurança, você será desconectado em <span id="contadorSessao" style="font-family:var(--font-mono);font-weight:700;color:var(--color-danger);">${APP.avisoSeg}</span> segundos</div>
          <div style="display:flex;gap:10px;">
            <button class="btn btn-outline" style="flex:1;" id="btnSairAgoraSessao">Sair agora</button>
            <button class="btn btn-primary" style="flex:1;" id="btnContinuarSessao">Continuar conectado</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(div.firstElementChild);
    modalEl = document.getElementById('modalSessaoExpirando');
    document.getElementById('btnContinuarSessao').addEventListener('click', () => renovarSessao(false));
    document.getElementById('btnSairAgoraSessao').addEventListener('click', appLogout);
    return modalEl;
  }

  function mostrarAvisoExpiracao() {
    criarModalSessao().classList.add('show');
    let restantes = APP.avisoSeg;
    const tv = document.getElementById('contadorSessao');
    if (tv) tv.textContent = restantes;
    contadorInterval = setInterval(() => {
      restantes -= 1;
      if (tv) tv.textContent = Math.max(restantes, 0);
      if (restantes <= 0) clearInterval(contadorInterval);
    }, 1000);
  }

  function limparTimers() {
    clearTimeout(avisoTimeout);
    clearTimeout(expiracaoTimeout);
    clearInterval(contadorInterval);
  }

  function agendarTimers() {
    const msAteExpirar = (loginTime + DURACAO_MS) - Date.now();
    const msAteAviso = msAteExpirar - AVISO_MS;
    if (msAteAviso > 0) avisoTimeout = setTimeout(mostrarAvisoExpiracao, msAteAviso);
    else mostrarAvisoExpiracao();
    expiracaoTimeout = setTimeout(appLogout, Math.max(msAteExpirar, 0));
  }

  async function renovarSessao(silencioso) {
    limparTimers();
    if (modalEl) modalEl.classList.remove('show');
    // Renova de verdade: pede um token novo ao servidor. Se falhar, desloga —
    // não adianta "renovar" só o contador local se o token já morreu.
    try {
      const r = await apiPost('/renovar', {});
      if (r && r.token) localStorage.setItem(_k('token'), r.token);
    } catch (e) { appLogout(); return; }
    loginTime = Date.now();
    localStorage.setItem(_k('login_time'), String(loginTime));
    agendarTimers();
    if (!silencioso) toast('Sessão renovada', 'success', 2000);
  }

  agendarTimers();

  // Atividade real renova a sessão (throttle de 60 s para não bater no servidor a cada
  // tecla). O leitor de código de barras digita como teclado, então também conta.
  let ultimaRenovacao = Date.now();
  function aoDetectarAtividade() {
    if (Date.now() - ultimaRenovacao < 60 * 1000) return;
    ultimaRenovacao = Date.now();
    renovarSessao(true);
  }
  ['keydown', 'input', 'click', 'touchstart'].forEach((e) => document.addEventListener(e, aoDetectarAtividade, { passive: true }));
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && Date.now() >= loginTime + DURACAO_MS) appLogout();
  });
})();

// ── TOAST ──
function toast(msg, tipo = 'info', dur = 3000) {
  let wrap = document.querySelector('.toast-wrap');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.className = 'toast-wrap';
    document.body.appendChild(wrap);
  }
  const t = document.createElement('div');
  t.className = 'toast ' + tipo;
  t.textContent = msg;
  wrap.appendChild(t);
  setTimeout(() => t.remove(), dur);
}

// ── DRAWER (gaveta lateral) ──
function initDrawer() {
  const overlay = document.getElementById('drawerOverlay');
  const drawer = document.getElementById('drawer');
  const abrir = () => { drawer?.classList.add('open'); overlay?.classList.add('open'); };
  const fechar = () => { drawer?.classList.remove('open'); overlay?.classList.remove('open'); };

  document.getElementById('btnGaveta')?.addEventListener('click', abrir);
  document.getElementById('btnFecharGaveta')?.addEventListener('click', fechar);
  overlay?.addEventListener('click', fechar);
  document.getElementById('btnSair')?.addEventListener('click', appLogout);

  const tvNome = document.getElementById('drawerNome');
  const tvFuncao = document.getElementById('drawerFuncao');
  if (tvNome) tvNome.textContent = SESSAO.nome;
  if (tvFuncao) tvFuncao.textContent = (SESSAO.funcao || '').toUpperCase() || '—';

  // Itens exclusivos de ADM: <div data-somente-adm style="display:none">
  if (IS_ADM) document.querySelectorAll('[data-somente-adm]').forEach((el) => { el.style.display = ''; });
}

// ── BOTTOM NAV ──
function initBottomNav(paginaAtual) {
  document.querySelectorAll('.nav-item').forEach((item) => {
    item.classList.toggle('active', item.dataset.page === paginaAtual);
  });
}

// ── MODAL (bottom sheet) ──
function abrirModal(id) { document.getElementById(id)?.classList.add('show'); }
function fecharModal(id) { document.getElementById(id)?.classList.remove('show'); }
// Toque fora da folha fecha o modal
document.querySelectorAll('.modal-overlay').forEach((ov) => {
  ov.addEventListener('click', (e) => { if (e.target === ov) ov.classList.remove('show'); });
});

// ── SERVICE WORKER + NOTIFICAÇÕES ──
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('service-worker.js').catch(() => {});
}
async function pedirPermissaoNotificacao() {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  return (await Notification.requestPermission()) === 'granted';
}

// ── API ──
// Toda chamada leva o token no header Authorization. 401 = sessão morta → volta ao login.
// Formato de resposta esperado do Worker: { ok: true, ...dados } ou { ok: false, erro: "mensagem" }.
async function apiFetch(caminho, opcoes = {}) {
  if (APP.demo) {
    // Modo demo nunca chama o servidor: usa window.APP_DEMO[caminho] ou responde { ok: true }.
    const chave = caminho.split('?')[0];
    const d = window.APP_DEMO && window.APP_DEMO[chave];
    if (d === undefined) return { ok: true };
    return typeof d === 'function' ? d(opcoes) : d;
  }

  const token = localStorage.getItem(_k('token'));
  const r = await fetch(APP.apiBase + APP.apiPrefixo + caminho, {
    ...opcoes,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...(opcoes.headers || {}),
    },
  });

  if (r.status === 401) {
    await appLogout();
    throw new Error('Sessão expirada');
  }

  let data = null;
  try { data = await r.json(); } catch (e) { /* resposta sem corpo JSON */ }

  if (!r.ok || (data && data.ok === false)) {
    throw new Error((data && data.erro) || 'HTTP ' + r.status);
  }
  return data;
}

function apiGet(caminho) {
  const sep = caminho.includes('?') ? '&' : '?';
  return apiFetch(caminho + sep + '_cb=' + Date.now(), { method: 'GET' });
}
function apiPost(caminho, corpo) {
  return apiFetch(caminho, { method: 'POST', body: JSON.stringify(corpo || {}) });
}

// ── UTILITÁRIOS ──
// TODO texto vindo do servidor/usuário e interpolado em innerHTML passa por escHtml.
function escHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function fmtNumero(n) { return Number(n || 0).toLocaleString('pt-BR'); }
function fmtDataHora(valor) {
  const d = valor instanceof Date ? valor : new Date(valor);
  if (isNaN(d)) return '—';
  return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

// ── DETECTOR DE LEITOR DE CÓDIGO DE BARRAS ──
// Leitores tipo Zebra digitam muito rápido: se o campo parar de mudar por ~150 ms
// depois de uma sequência rápida de teclas, processa sozinho (sem precisar do Enter).
function criarDetectorLeitor(inputEl, aoLer, opcoes = {}) {
  if (!inputEl) return;
  const minChars = opcoes.minChars || 5;
  const msParada = opcoes.msParada || 150;
  const msEntreTeclas = opcoes.msEntreTeclas || 40;

  let ultimoInput = 0, rapidos = 0, timeout = null;

  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      clearTimeout(timeout);
      rapidos = 0;
      const codigo = inputEl.value.trim();
      if (codigo) aoLer(codigo);
    }
  });

  inputEl.addEventListener('input', () => {
    const agora = Date.now();
    if (agora - ultimoInput < msEntreTeclas) rapidos++;
    ultimoInput = agora;
    clearTimeout(timeout);
    timeout = setTimeout(() => {
      const codigo = inputEl.value.trim();
      if (codigo.length >= minChars && rapidos >= 2) aoLer(codigo);
      rapidos = 0;
    }, msParada);
  });
}
