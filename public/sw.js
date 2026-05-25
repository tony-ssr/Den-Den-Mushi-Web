const CACHE_NAME = 'denden-intercom-v1';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/src/index.css',
  '/src/main.js',
  '/src/supabase.js',
  '/src/audio.js',
  '/src/webrtc.js',
  '/sounds/gacha.mp3',
  '/sounds/purupuru.mp3',
  '/images/dendenmushi/denden_dormido.png',
  '/images/dendenmushi/denden_activo.png',
  '/images/dendenmushi/denden_hablando.png',
  '/manifest.json'
];

// Install Event - Caching App Shell
self.addEventListener('install', (event) => {
  console.log('[Service Worker] Instalando y almacenando en caché app shell...');
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE).catch(err => {
        console.warn('Algunos recursos no pudieron almacenarse en caché durante la instalación:', err);
      });
    })
  );
  self.skipWaiting();
});

// Activate Event - Cleaning old caches
self.addEventListener('activate', (event) => {
  console.log('[Service Worker] Activando y limpiando cachés obsoletas...');
  event.waitUntil(
    caches.keys().then((keyList) => {
      return Promise.all(
        keyList.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[Service Worker] Eliminando caché antigua:', key);
            return caches.delete(key);
          }
        })
      );
    })
  );
  return self.clients.claim();
});

// Fetch Event - Cache First with Network Fallback
self.addEventListener('fetch', (event) => {
  // Do not intercept Supabase API or WebRTC signaling requests
  if (
    event.request.url.includes('supabase.co') || 
    event.request.url.includes('chrome-extension')
  ) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request).then((response) => {
        // Cache newly fetched assets if applicable
        if (response && response.status === 200 && response.type === 'basic') {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return response;
      }).catch(() => {
        // Offline fallback
        return caches.match('/index.html');
      });
    })
  );
});
