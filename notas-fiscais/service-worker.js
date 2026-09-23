// ══════════════════════════════════════════
// Notas Santana — Service Worker
// Cache do "casco" do app (HTML/CSS/JS/ícones) + notificações push.
//
// REGRA DE OURO: respostas de API NUNCA entram no cache. Se entrarem, listas de
// usuários, estoque e chat ficam no Cache Storage do aparelho e podem ser lidas
// depois do logout (coletor/tablet compartilhado). Só cacheamos assets estáticos
// da própria origem.
//
// Ao publicar uma versão nova, suba o número em CACHE_NAME.
// ══════════════════════════════════════════

const CACHE_NAME = 'notas-v1';
const CACHE_URLS = [
  '/login.html',
  '/index.html',
  '/lista.html',
  '/formulario.html',
  '/app-style.css',
  '/app-shell.js',
  '/manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // addAll falha inteiro se um arquivo faltar; cacheamos um a um.
      Promise.all(CACHE_URLS.map((u) => cache.add(u).catch(() => {})))
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Rede primeiro; se estiver offline, usa o cache. Só guarda respostas válidas da própria origem.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  event.respondWith(
    fetch(req)
      .then((response) => {
        if (response && response.status === 200 && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
        }
        return response;
      })
      .catch(() => caches.match(req))
  );
});

// ── Notificações push ──
self.addEventListener('push', (event) => {
  let data = { title: 'Notas Santana', body: 'Você tem uma nova notificação', tag: 'geral' };
  try { if (event.data) data = event.data.json(); } catch (e) {}
  event.waitUntil(self.registration.showNotification(data.title, {
    body: data.body,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: data.tag || 'geral',
    data: { url: data.url || '/index.html' },
    vibrate: [200, 100, 200]
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/index.html';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((lista) => {
      for (const c of lista) if (c.url.includes(url) && 'focus' in c) return c.focus();
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
