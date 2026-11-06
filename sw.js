// A versao abaixo e atualizada automaticamente por scripts/atualizar_base_web.py
const CACHE_NAME = 'biomonitor-sedes-20261106-1144';

// Arquivos do proprio app
const ASSETS_LOCAIS = [
  './',
  './index.html',
  './guia_campo.html',
  './analise_frequencia.html',
  './relatorio.html',
  './relatorio_sede.html',
  './atualizar_dados.js',
  './manual.html',
  './dados_mapa.js',
  './vistorias_kobo.json',
  './manifest.json',
  './favicon.ico',
  './logos/icon-192.png',
  './logos/icon-512.png',
  './logos/icon-maskable-192.png',
  './logos/icon-maskable-512.png',
  './logos/apple-touch-icon.png',
  './logos/BioMonitor_512.jpg'
];

// Bibliotecas externas: sem elas o mapa nao abre sem sinal
const ASSETS_EXTERNOS = [
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://unpkg.com/leaflet.heat@0.2.0/dist/leaflet-heat.js',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js',
  'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'
];

const HOSTS_EXTERNOS = ['unpkg.com', 'cdnjs.cloudflare.com', 'cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com'];

async function guardarUm(cache, url) {
  try {
    const req = new Request(url, url.startsWith('http') ? { mode: 'cors' } : {});
    const resp = await fetch(req, { cache: 'reload' });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    await cache.put(url, resp);
  } catch (e) {
    console.warn('[BioMonitor SW] Nao foi possivel guardar no cache:', url, e && e.message);
  }
}

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all([...ASSETS_LOCAIS, ...ASSETS_EXTERNOS].map((u) => guardarUm(cache, u)))
    )
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((nomes) => Promise.all(nomes.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // envios ao Kobo (POST) nao passam pelo cache
  const url = new URL(req.url);
  const externo = HOSTS_EXTERNOS.includes(url.hostname);
  const mesmoSite = url.origin === self.location.origin;
  if (!externo && !mesmoSite) return;

  if (externo) {
    // Bibliotecas versionadas: cache primeiro (rapido e funciona sem sinal)
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((resp) => {
        if (resp && (resp.ok || resp.type === 'opaque')) {
          const copia = resp.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, copia));
        }
        return resp;
      }))
    );
    return;
  }

  // Arquivos do app: rede primeiro (dados sempre atuais), cache se estiver sem sinal
  event.respondWith(
    fetch(req)
      .then((resp) => {
        if (resp && resp.status === 200 && resp.type === 'basic') {
          const copia = resp.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, copia));
        }
        return resp;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }))
  );
});
