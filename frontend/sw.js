/* AIITS Service Worker v5 - fixed clone error, AdSense compatible */
var CACHE_NAME = 'aiits-v5';
var STATIC_FILES = ['/', '/manifest.json'];

self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(STATIC_FILES);
    }).then(function() {
      return self.skipWaiting();
    }).catch(function(err) {
      console.warn('[SW] Install cache failed:', err);
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) { return k !== CACHE_NAME; })
            .map(function(k) { return caches.delete(k); })
      );
    }).then(function() {
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', function(e) {
  var url = e.request.url;
  var method = e.request.method;

  // Only handle GET requests
  if (method !== 'GET') return;

  // Never intercept these — let them go straight to network
  if (
    url.includes('/socket.io') ||
    url.includes('googlesyndication') ||
    url.includes('googleadservices') ||
    url.includes('doubleclick') ||
    url.includes('adtrafficquality') ||
    url.includes('sodar') ||
    url.includes('pagead') ||
    url.includes('adsbygoogle') ||
    url.includes('googleapis.com') ||
    url.includes('gstatic.com') ||
    url.includes('fonts.googleapis') ||
    url.includes('cdnjs.cloudflare')
  ) {
    return; // let browser handle it normally
  }

  var parsedUrl = new URL(url);

  // API calls — network only, no cache, no clone issues
  if (parsedUrl.pathname.startsWith('/api/')) {
    e.respondWith(
      fetch(e.request).catch(function() {
        return new Response(
          JSON.stringify({ error: 'You appear to be offline.' }),
          { status: 503, headers: { 'Content-Type': 'application/json' } }
        );
      })
    );
    return;
  }

  // HTML pages — network first, fall back to cache
  if (e.request.headers.get('accept') && e.request.headers.get('accept').includes('text/html')) {
    e.respondWith(
      fetch(e.request).then(function(response) {
        // Only cache successful same-origin responses
        if (response && response.status === 200 && response.type === 'basic') {
          var toCache = response.clone(); // clone BEFORE using
          caches.open(CACHE_NAME).then(function(cache) {
            cache.put(e.request, toCache);
          });
        }
        return response;
      }).catch(function() {
        return caches.match(e.request).then(function(cached) {
          return cached || caches.match('/');
        });
      })
    );
    return;
  }

  // Static assets (images, CSS, JS from same origin) — cache first
  e.respondWith(
    caches.match(e.request).then(function(cached) {
      if (cached) return cached;
      return fetch(e.request).then(function(response) {
        if (response && response.status === 200 && response.type === 'basic') {
          var toCache = response.clone(); // clone BEFORE using
          caches.open(CACHE_NAME).then(function(cache) {
            cache.put(e.request, toCache);
          });
        }
        return response;
      }).catch(function() {
        return new Response('', { status: 404 });
      });
    })
  );
});

// Push notifications
self.addEventListener('push', function(e) {
  var data = {};
  try { data = e.data ? e.data.json() : {}; } catch(err) {}
  var title = data.title || 'AIITS — New Update';
  var options = {
    body:    data.body  || 'Check the latest from Vibrant Academy.',
    icon:    '/images/icon-192.png',
    badge:   '/images/icon-192.png',
    tag:     'aiits-notification',
    data:    { url: data.url || '/' },
    vibrate: [200, 100, 200]
  };
  e.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', function(e) {
  e.notification.close();
  var url = (e.notification.data && e.notification.data.url) ? e.notification.data.url : '/';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(list) {
      for (var i = 0; i < list.length; i++) {
        if (list[i].url.includes(self.location.origin) && 'focus' in list[i]) {
          list[i].navigate(url);
          return list[i].focus();
        }
      }
      return clients.openWindow(url);
    })
  );
});
