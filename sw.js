/*
 * Comandas · Gira USA Monkeys — guarda la app en el equipo.
 * Con señal: siempre usa la versión más nueva (y la guarda).
 * Sin señal (o muy lenta): abre la última versión guardada.
 * Las consultas a Supabase NO pasan por aquí (van directo y nunca se guardan).
 */
var CACHE = 'comandas-v1';
var APP = ['./', 'index.html', 'assets/styles.css', 'assets/config.js', 'assets/printer.js', 'assets/app.js', 'assets/logo.png'];

self.addEventListener('install', function (ev) {
  ev.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(APP); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (ev) {
  ev.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

// Red primero, con espera máxima: si no responde a tiempo, se usa lo guardado.
function redPrimero(req, ms) {
  return caches.open(CACHE).then(function (c) {
    return new Promise(function (ok) {
      var listo = false;
      var t = setTimeout(function () {
        c.match(req, { ignoreSearch: true }).then(function (r) { if (r && !listo) { listo = true; ok(r); } });
      }, ms);
      fetch(req).then(function (r) {
        if (r && r.ok) c.put(req, r.clone());
        if (!listo) { listo = true; clearTimeout(t); ok(r); }
      }).catch(function () {
        clearTimeout(t);
        c.match(req, { ignoreSearch: true }).then(function (r) {
          if (!listo) { listo = true; ok(r || c.match('index.html')); }
        });
      });
    });
  });
}
// Guardado primero (tipografías y fotos de Drive): rápido y sin gastar datos.
function guardadoPrimero(req) {
  return caches.open(CACHE).then(function (c) {
    return c.match(req).then(function (r) {
      var red = fetch(req).then(function (n) { if (n && (n.ok || n.type === 'opaque')) c.put(req, n.clone()); return n; }).catch(function () { return r; });
      return r || red;
    });
  });
}

self.addEventListener('fetch', function (ev) {
  var req = ev.request;
  if (req.method !== 'GET') return;
  var u = new URL(req.url);
  if (u.origin === self.location.origin) { ev.respondWith(redPrimero(req, 4000)); return; }
  if (/fonts\.(googleapis|gstatic)\.com$/.test(u.hostname) || (u.hostname === 'drive.google.com' && u.pathname === '/thumbnail')) {
    ev.respondWith(guardadoPrimero(req));
  }
});
