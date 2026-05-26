const CACHE_NAME = 'denden-intercom-v2';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
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

// Fetch Event - Network First with Cache Fallback for dynamic updates
self.addEventListener('fetch', (event) => {
  // Do not intercept Supabase API or WebRTC signaling requests
  if (
    event.request.url.includes('supabase.co') || 
    event.request.url.includes('chrome-extension')
  ) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Cache newly fetched assets if successful and valid
        if (response && response.status === 200 && response.type === 'basic') {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return response;
      })
      .catch(() => {
        // Fallback to cache if offline
        return caches.match(event.request).then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse;
          }
          // If offline and navigate mode (page refresh/access), serve index.html
          if (event.request.mode === 'navigate') {
            return caches.match('/index.html');
          }
        });
      })
  );
});

// =========================================================================
// CALL NOTIFICATION MANAGEMENT (BACKGROUND INTERACTION)
// =========================================================================

self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data) return;

  if (data.type === 'SHOW_CALL_NOTIFICATION') {
    const isMicActive = data.micState === 'active';
    
    // Walkie-Talkie style dynamic buttons
    const actions = isMicActive ? [
      { action: 'mute', title: '🔇 Silenciar Micrófono' },
      { action: 'exit', title: '❌ Salir' }
    ] : [
      { action: 'handsfree', title: '🎤 Hablar (Manos Libres)' },
      { action: 'exit', title: '❌ Salir' }
    ];

    const options = {
      body: `Enlace activo en sala: ${data.roomCode}\nEstado: ${isMicActive ? '🔴 TRANSMITIENDO VOZ' : '🎙️ EN ESPERA (MUTED)'}`,
      icon: '/images/dendenmushi/denden_activo.png',
      badge: '/images/dendenmushi/denden_activo.png',
      tag: 'denden-active-call',
      renotify: false,
      requireInteraction: true,
      silent: true, // No sound since user is already in voice call
      actions: actions
    };

    event.waitUntil(
      self.registration.showNotification('Den Den Mushi Intercom', options)
    );
  } else if (data.type === 'CLEAR_CALL_NOTIFICATION') {
    event.waitUntil(
      self.registration.getNotifications({ tag: 'denden-active-call' })
        .then((notifications) => {
          notifications.forEach(n => n.close());
        })
    );
  }
});

self.addEventListener('notificationclick', (event) => {
  const notification = event.notification;
  const action = event.action;

  // For the exit action, close notification. For others, keep it to show call state.
  if (action === 'exit') {
    notification.close();
  }

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // Send the action to all pages
        clientList.forEach((client) => {
          client.postMessage({
            type: 'NOTIFICATION_ACTION',
            action: action
          });
        });

        // If clicked on the main notification body, focus the app window
        if (!action && clientList.length > 0) {
          return clientList[0].focus();
        }
      })
  );
});
