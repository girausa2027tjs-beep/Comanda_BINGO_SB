/* Comandas · Gira USA Monkeys — frontend */
(function () {
  'use strict';

  var CFG = window.APP_CONFIG || {};
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var S = {
    token: null, usuario: null,
    productos: [], prodMap: {},
    carrito: {}, tipoVenta: '',
    edit: null,            // { numero, version, items } cuando se edita un pedido
    reqId: null,           // id de envío (anti-duplicado) del pedido en curso
    mis: [], todos: [],
    filtroMis: 'todos', filtroAdmin: 'todos',
    enviando: [],          // pedidos nuevos guardándose en segundo plano
    desde: { mis: null, todos: null },        // sello del último cambio recibido (descargas incrementales)
    ultCompleta: { mis: 0, todos: 0 },        // hora de la última descarga completa
    espera: 4000, proximo: 0, modalNoBloquea: false,
    seq: { mis: 0, todos: 0 }, aplicado: { mis: 0, todos: 0 }, cargado: { mis: false, todos: false }, ordenAsc: true, buscaAdmin: '',
    timer: null, ocupado: false
  };

  /* ================= Utilidades ================= */

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  // Fotos de Drive en tamaño chico: cargan más rápido y gastan menos datos del celular.
  function miniatura(url, ancho) {
    return String(url || '').replace(/([?&]sz=)w\d+/, '$1w' + (ancho || 360));
  }
  /*
   * Fotos de productos:
   *  - enlace https (Google Drive, etc.) → se usa en tamaño chico;
   *  - "db:<versión>" → foto subida desde la app, guardada en la base. Se pide
   *    una sola vez por lote y queda guardada en el navegador (no gasta
   *    transferencia cada vez que se abre la pantalla).
   */
  var Fotos = (function () {
    var mem = {}, pendientes = {}, timer = null, oyentes = [];
    function clave(id) { return 'comandas_foto_' + id; }
    function leer(id) {
      if (mem[id]) return mem[id];
      try { var v = JSON.parse(localStorage.getItem(clave(id)) || 'null'); if (v) mem[id] = v; return v; } catch (e) { return null; }
    }
    function guardar(id, foto, datos) {
      mem[id] = { foto: foto, datos: datos };
      try { localStorage.setItem(clave(id), JSON.stringify(mem[id])); } catch (e) { /* sin espacio: queda en memoria */ }
    }
    function pedir() {
      timer = null;
      var ids = Object.keys(pendientes).slice(0, 60);
      ids.forEach(function (i) { delete pendientes[i]; });
      if (!ids.length || !S.token) return;
      api('imagenes', { ids: ids.map(Number) }, { silencioso: true }).then(function (r) {
        r.imagenes.forEach(function (im) { guardar(im.id, im.foto, im.datos); });
        oyentes.forEach(function (f) { try { f(); } catch (e) {} });
      }).catch(function () {});
    }
    return {
      url: function (p, ancho) {
        var f = String((p && p.foto) || '');
        if (!f) return '';
        if (f.indexOf('db:') !== 0) return miniatura(f, ancho);
        var c = leer(p.id);
        if (c && c.foto === f) return c.datos;
        if (!pendientes[p.id]) { pendientes[p.id] = 1; if (!timer) timer = setTimeout(pedir, 60); }
        return '';
      },
      guardar: guardar,
      alLlegar: function (f) { oyentes.push(f); }
    };
  })();
  function estiloFoto(p, ancho) {
    var u = Fotos.url(p, ancho);
    return u ? ' style="background-image:url(\'' + esc(u).replace(/'/g, '%27') + '\')"' : '';
  }

  // Enlace de Google Drive (compartir) → enlace directo de imagen.
  function enlaceDrive(url) {
    url = String(url || '').trim();
    var m = url.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:export=\w+&)?id=|thumbnail\?id=)([\w-]{20,})/);
    return m ? 'https://drive.google.com/thumbnail?id=' + m[1] + '&sz=w1000' : url;
  }

  // Achica una foto en el navegador (máx. 480 px, JPEG) para que pese ~20–40 KB.
  function achicarFoto(archivo) {
    return new Promise(function (ok, mal) {
      if (!archivo || !/^image\//.test(archivo.type)) return mal(new Error('Elige un archivo de imagen.'));
      var lector = new FileReader();
      lector.onerror = function () { mal(new Error('No se pudo leer la imagen.')); };
      lector.onload = function () {
        var img = new Image();
        img.onerror = function () { mal(new Error('No se pudo abrir la imagen.')); };
        img.onload = function () {
          var max = 480, w = img.naturalWidth, h = img.naturalHeight, k = Math.min(1, max / Math.max(w, h));
          var c = document.createElement('canvas');
          c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
          var ctx = c.getContext('2d');
          ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
          ctx.drawImage(img, 0, 0, c.width, c.height);
          var q = 0.8, datos = c.toDataURL('image/jpeg', q);
          while (datos.length > 150000 && q > 0.35) { q -= 0.1; datos = c.toDataURL('image/jpeg', q); }
          if (datos.length > 190000) return mal(new Error('La foto es demasiado grande.'));
          ok(datos);
        };
        img.src = lector.result;
      };
      lector.readAsDataURL(archivo);
    });
  }

  function plata(n) { return '$' + Math.round(Number(n) || 0).toLocaleString('es-CL'); }
  function norm(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
  }
  // Mismo reqId mientras la misma acción sobre el mismo pedido no se confirme.
  var pendientes = {};
  function reqIdPara(clave) { return pendientes[clave] || (pendientes[clave] = uuid()); }
  function confirmado(clave) { delete pendientes[clave]; }

  function guardarSesion(v) { try { v ? sessionStorage.setItem('comandas_ses', JSON.stringify(v)) : sessionStorage.removeItem('comandas_ses'); } catch (e) {} }
  function leerSesion() { try { return JSON.parse(sessionStorage.getItem('comandas_ses') || 'null'); } catch (e) { return null; } }

  var toastT;
  function toast(msg, tipo) {
    var t = $('#toast');
    t.textContent = msg;
    t.className = 'toast ver ' + (tipo || '');
    clearTimeout(toastT);
    toastT = setTimeout(function () { t.className = 'toast'; }, tipo === 'mal' ? 5200 : 3200);
  }
  function cargando(on, texto) {
    $('#cargando').hidden = !on;
    $('#cargandoTxt').textContent = on ? (texto || '') : '';
  }

  /* ================= API ================= */

  var ESCRITURAS = { crear: 1, editar: 1, estado: 1 };

  // Supabase: toda la lógica está en la función SQL public.api(p jsonb).
  var URL_API = String(CFG.SUPABASE_URL || '').replace(/\/+$/, '') + '/rest/v1/rpc/api';
  var CONFIGURADO = !!(CFG.SUPABASE_URL && CFG.SUPABASE_KEY);

  function cabeceras() {
    var h = { 'Content-Type': 'application/json', 'apikey': CFG.SUPABASE_KEY };
    // Las claves antiguas ("anon", un JWT) también van como Bearer; las nuevas sb_publishable_ no.
    if (/^ey/.test(CFG.SUPABASE_KEY || '')) h.Authorization = 'Bearer ' + CFG.SUPABASE_KEY;
    return h;
  }

  // Un intento de red. Marca como "transitorio" todo error en que la respuesta
  // se perdió (sin red, tiempo agotado, error 5xx, respuesta incompleta):
  // en esos casos el servidor pudo haber guardado igual.
  function intento(body) {
    var ctrl = window.AbortController ? new AbortController() : null;
    var t = ctrl ? setTimeout(function () { ctrl.abort(); }, 20000) : null;
    return fetch(URL_API, {
      method: 'POST',
      headers: cabeceras(),
      body: JSON.stringify({ p: body }),
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (r) {
      if (!r.ok) {
        var e;
        if (r.status === 401 || r.status === 403) e = new Error('Supabase rechazó la clave: revisa SUPABASE_KEY en assets/config.js.');
        else if (r.status === 404) e = new Error('No encuentro la función api en Supabase: ¿ejecutaste 1_estructura.sql?');
        else { e = new Error('El servidor respondió ' + r.status + '.'); e.transitorio = r.status >= 500 || r.status === 408 || r.status === 429; }
        throw e;
      }
      return r.text();
    }).then(function (txt) {
      try { return JSON.parse(txt); } catch (e) { var x = new Error('Respuesta incompleta del servidor.'); x.transitorio = true; throw x; }
    }).catch(function (err) {
      if (err && (err.transitorio || /Supabase|función api|respondió/.test(err.message))) throw err;
      var e = new Error(err && err.name === 'AbortError' ? 'El servidor tardó demasiado.' : 'Sin conexión. Revisa internet.');
      e.transitorio = true;
      throw e;
    }).finally(function () { if (t) clearTimeout(t); });
  }

  function api(action, datos, opts) {
    if (!CONFIGURADO) return Promise.reject(new Error('Falta configurar SUPABASE_URL y SUPABASE_KEY en assets/config.js'));
    var body = Object.assign({ action: action, token: S.token }, datos || {});
    var silencioso = opts && opts.silencioso;
    if (!silencioso) cargando(true);
    // Escrituras: hasta 4 intentos con el MISMO reqId. El servidor reconoce el
    // reqId y no vuelve a escribir, así reintentar nunca duplica nada.
    // Lecturas: 2 intentos.
    var max = ESCRITURAS[action] ? 4 : 2, n = 0;
    function correr() {
      n++;
      return intento(body).catch(function (err) {
        if (!err.transitorio || n >= max) {
          if (err.transitorio && ESCRITURAS[action]) {
            err.message += ' No se pudo confirmar. Revisa la lista antes de repetir: si el pedido aparece, ya quedó guardado.';
          }
          throw err;
        }
        if (!silencioso) cargando(true, 'Confirmando con el servidor…');
        return new Promise(function (res) { setTimeout(res, 700 * n); }).then(correr);
      });
    }
    return correr().then(function (j) {
      if (!j || !j.ok) {
        var e = new Error((j && j.error) || 'Error desconocido.');
        e.codigo = j && j.codigo;
        if (e.codigo === 'SESION') { salir(e.message); }
        throw e;
      }
      if (j.ms != null && window.console) console.debug('[comandas] ' + action + ': ' + j.ms + ' ms en el servidor');
      return j;
    }).finally(function () { if (!(opts && opts.silencioso)) cargando(false); });
  }

  /* ================= Ingreso ================= */

  function iniciarLogin(msg) {
    $('#vistaApp').hidden = true;
    $('#vistaLogin').hidden = false;
    $('#errLogin').textContent = msg || '';
    if (!CONFIGURADO) {
      $('#errLogin').textContent = 'Falta pegar SUPABASE_URL y SUPABASE_KEY en assets/config.js.';
      $('#selCurso').innerHTML = '<option value="">Sin conexión</option>';
      return;
    }
    api('inicio', {}, { silencioso: true }).then(function (r) {
      $('#selCurso').innerHTML = '<option value="">Elige tu curso</option>' +
        r.cursos.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('');
      $('#tiposUsuario').innerHTML = r.tiposUsuario.map(function (t, i) {
        return '<label><input type="radio" name="tipoUsuario" value="' + esc(t) + '"' + (i === 0 ? ' checked' : '') + '><span>' + esc(t) + '</span></label>';
      }).join('');
    }).catch(function (e) { $('#errLogin').textContent = e.message; });
  }

  $('#selCurso').addEventListener('change', function () {
    var sel = $('#selAlumno');
    sel.disabled = true;
    if (!this.value) { sel.innerHTML = '<option value="">Primero elige el curso</option>'; return; }
    sel.innerHTML = '<option value="">Cargando…</option>';
    api('alumnos', { curso: this.value }, { silencioso: true }).then(function (r) {
      sel.innerHTML = '<option value="">Elige tu nombre</option>' + r.alumnos.map(function (a) {
        return '<option value="' + a.id + '">' + esc(a.nombre) + '</option>';
      }).join('');
      sel.disabled = false;
    }).catch(function (e) { $('#errLogin').textContent = e.message; });
  });

  $('#formLogin').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var err = $('#errLogin');
    var curso = $('#selCurso').value, id = $('#selAlumno').value, clave = $('#inpClave').value.trim();
    if (!curso) return (err.textContent = 'Elige tu curso.');
    if (!id) return (err.textContent = 'Elige el alumno.');
    if (!clave) return (err.textContent = 'Escribe la contraseña.');
    err.textContent = '';
    var tipo = ($('input[name="tipoUsuario"]:checked') || {}).value || '';
    var perfil = $('input[name="perfil"]:checked').value;
    $('#btnIngresar').disabled = true;
    api('login', { id_usuario: Number(id), clave: clave, tipo_usuario: tipo, perfil: perfil })
      .then(function (r) {
        S.token = r.token; S.usuario = r.usuario;
        guardarSesion({ token: r.token, usuario: r.usuario });
        $('#inpClave').value = '';
        entrar();
      })
      .catch(function (e) { err.textContent = e.message; })
      .finally(function () { $('#btnIngresar').disabled = false; });
  });

  function salir(msg) {
    if (S.token && !msg) api('logout', {}, { silencioso: true }).catch(function () {});
    clearInterval(S.timer);
    S.token = null; S.usuario = null; S.carrito = {}; S.edit = null; S.reqId = null;
    S.mis = []; S.todos = []; S.cargado = { mis: false, todos: false }; S.enviando = [];
    clearTimeout(S.timer); S.desde = { mis: null, todos: null };
    ['#listaMis', '#listaAdmin'].forEach(function (s) { $(s).innerHTML = '<div class="vacio">Cargando pedidos…</div>'; });
    aviso('mis', null); aviso('todos', null);
    guardarSesion(null);
    cerrarModal();
    iniciarLogin(msg);
  }
  $('#btnSalir').addEventListener('click', function () {
    if (S.enviando.length && !confirm('Hay pedidos guardándose o sin guardar. Si sales ahora podrían perderse. ¿Salir igual?')) return;
    if (Object.keys(S.carrito).length && !confirm('Tienes un pedido sin enviar. ¿Salir igual?')) return;
    salir();
  });

  function entrar() {
    $('#vistaLogin').hidden = true;
    $('#vistaApp').hidden = false;
    var u = S.usuario;
    $('#lblUsuario').textContent = u.nombre + ' · ' + u.curso;
    $('#lblPerfil').textContent = (u.perfil === 'admin' ? 'ADMINISTRADOR' : 'VENDEDOR') + (u.tipo && u.tipo !== 'Alumno' ? ' · ' + u.tipo.toUpperCase() : '');
    var admin = u.perfil === 'admin';
    $('#vistaAdmin').hidden = !admin;
    $('#vistaVendedor').hidden = admin;
    $('#btnImpresora').hidden = !admin;
    cargarProductos(false).catch(function (e) { toast(e.message, 'mal'); });
    if (admin) cargarTodos(); else { mostrarTab('venta'); cargarMis(true); }
    S.version = { pedidos: null, productos: null };
    S.desde = { mis: null, todos: null };
    S.espera = ESPERA_MIN;
    programar(ESPERA_MIN);
  }

  /*
   * Consulta adaptativa (cuida el plan gratuito): cada 4 s mientras hay
   * movimiento; si no cambia nada se va espaciando hasta 20 s. Cualquier
   * toque en la pantalla o un cambio la vuelve a 4 s. Con la pestaña
   * oculta no consulta nada.
   */
  var ESPERA_MIN = Math.max(2, CFG.REFRESCO_SEGUNDOS || 4) * 1000;
  var ESPERA_MAX = Math.max(ESPERA_MIN, (CFG.REFRESCO_MAX_SEGUNDOS || 20) * 1000);
  function programar(ms) {
    clearTimeout(S.timer);
    S.proximo = Date.now() + ms;
    S.timer = setTimeout(function () {
      refrescar(false).then(function (hubo) {
        S.espera = hubo ? ESPERA_MIN : Math.min(ESPERA_MAX, S.espera + 2000);
      }).finally(function () { if (S.token) programar(S.espera); });
    }, ms);
  }
  ['click', 'keydown', 'touchstart'].forEach(function (ev) {
    document.addEventListener(ev, function () {
      if (!S.token) return;
      S.espera = ESPERA_MIN;
      if (S.proximo - Date.now() > ESPERA_MIN) programar(ESPERA_MIN);
    }, { passive: true });
  });

  /*
   * Actualización automática: cada pocos segundos se pregunta a la base un
   * número de "versión" (consulta mínima). Solo si cambió se descargan de nuevo
   * los pedidos o los productos. Así todos ven los cambios casi al instante.
   */
  var revisando = false;
  function refrescar(forzar) {
    if ((document.hidden && !forzar) || !S.token || revisando) return Promise.resolve(false);
    // Pedidos que quedaron "Sin guardar" por la red: se reintentan solos (nunca duplican).
    S.enviando.forEach(function (env) { if (env.estado === 'error' && env.transitorio) enviarEnFondo(env); });
    revisando = true;
    return api('version', {}, { silencioso: true }).then(function (v) {
      var prev = S.version || {};
      var cambioProd = prev.productos !== null && prev.productos !== undefined && prev.productos !== v.productos;
      var cambioPed = prev.pedidos !== v.pedidos;
      var listaFallida = S.usuario && $(S.usuario.perfil === 'admin' ? '#avisoAdmin' : '#avisoMis').hidden === false;
      S.version = { pedidos: v.pedidos, productos: v.productos };
      if (cambioProd) cargarProductos(false).then(function (r) {
        if (r.quitados.length) toast('Cambiaron los productos. Se quitó del pedido: ' + r.quitados.join(', ') + ' (ya no está disponible)', 'mal');
      }).catch(function () {});
      var tipo = S.usuario.perfil === 'admin' ? 'todos' : 'mis';
      // Descarga completa solo si cambiaron productos (nombres) o como resguardo cada 5 min.
      var completa = cambioProd || Date.now() - S.ultCompleta[tipo] > 300000;
      if ((cambioPed || listaFallida || cambioProd) && !S.ocupado && ($('#modal').hidden || S.modalNoBloquea)) {
        if (tipo === 'todos') cargarTodos(true, completa); else cargarMis(true, completa);
      } else if (cambioPed) {
        S.version.pedidos = prev.pedidos;     // se reintentará cuando se cierre la ventana
      }
      return cambioPed || cambioProd;
    }).catch(function () { return false; }).finally(function () { revisando = false; });
  }
  document.addEventListener('visibilitychange', function () { if (!document.hidden) refrescar(true); });

  /* ================= VENDEDOR: nueva venta ================= */

  $$('.tab').forEach(function (b) { b.addEventListener('click', function () { mostrarTab(b.dataset.tab); }); });
  function mostrarTab(t) {
    $$('.tab').forEach(function (b) { b.classList.toggle('activo', b.dataset.tab === t); });
    $('#panelVenta').hidden = t !== 'venta';
    $('#panelMis').hidden = t !== 'mis';
    actualizarCarrito();
    if (t === 'mis') cargarMis(true);
  }

  function productosVisibles() {
    var lista = S.productos.slice();
    // En edición, también se muestran productos del pedido que hoy están inactivos.
    if (S.edit) S.edit.items.forEach(function (it) {
      if (!S.prodMap[it.id]) lista.push({ id: it.id, nombre: it.nombre, precio: it.precio, foto: '', activo: false });
    });
    var q = norm($('#buscaProd').value);
    return q ? lista.filter(function (p) { return norm(p.nombre).indexOf(q) >= 0; }) : lista;
  }

  function precioDe(id) {
    if (S.edit) { var prev = S.edit.items.filter(function (i) { return i.id === id; })[0]; if (prev) return prev.precio; }
    return S.prodMap[id] ? S.prodMap[id].precio : 0;
  }
  function nombreDe(id) {
    if (S.prodMap[id]) return S.prodMap[id].nombre;
    var all = (S.edit ? S.edit.items : []).concat(S.todos.reduce(function (a, p) { return a.concat(p.items); }, []));
    var f = all.filter(function (i) { return i.id === id; })[0];
    return f ? f.nombre : 'Producto ' + id;
  }

  function renderProductos() {
    var lista = productosVisibles();
    var g = $('#gridProductos');
    if (!lista.length) { g.innerHTML = '<div class="vacio">No hay productos que coincidan.</div>'; return; }
    g.innerHTML = lista.map(function (p) {
      var c = S.carrito[p.id] || 0;
      var foto = estiloFoto(p);
      return '<article class="prod' + (c ? ' elegido' : '') + '" data-id="' + p.id + '">' +
        '<div class="prod-foto"' + foto + '>' + (c ? '<span class="cant-badge">' + c + '</span>' : '') + '</div>' +
        '<div class="prod-info"><div class="prod-nombre">' + esc(p.nombre) + '</div>' +
        '<div class="prod-precio">' + plata(precioDe(p.id)) + '</div>' +
        (p.activo === false ? '<div class="prod-inactivo">No disponible para nuevos pedidos</div>' : '') + '</div>' +
        '<div class="stepper"><button type="button" class="menos" aria-label="Quitar uno de ' + esc(p.nombre) + '">−</button>' +
        '<output>' + c + '</output>' +
        '<button type="button" class="mas" aria-label="Agregar uno de ' + esc(p.nombre) + '"' + (p.activo === false && !c ? ' disabled' : '') + '>+</button></div>' +
        '</article>';
    }).join('');
  }

  $('#gridProductos').addEventListener('click', function (ev) {
    var b = ev.target.closest('button'); if (!b) return;
    var card = b.closest('.prod'); var id = Number(card.dataset.id);
    cambiarCant(id, b.classList.contains('mas') ? 1 : -1);
    renderProductos();
  });
  $('#buscaProd').addEventListener('input', renderProductos);
  // Si cambian mesa o cliente, es un envío distinto (nuevo id anti-duplicado).
  ['#inpMesa', '#inpCliente', '#inpComentario'].forEach(function (s) {
    $(s).addEventListener('input', function () { S.reqId = null; this.classList.remove('invalido'); });
  });

  function cambiarCant(id, d) {
    var n = Math.max(0, Math.min(99, (S.carrito[id] || 0) + d));
    if (n) S.carrito[id] = n; else delete S.carrito[id];
    S.reqId = null;        // el contenido cambió: es un envío nuevo
    actualizarCarrito();
  }

  function totalCarrito() {
    return Object.keys(S.carrito).reduce(function (s, id) { return s + precioDe(Number(id)) * S.carrito[id]; }, 0);
  }

  function actualizarCarrito() {
    var n = Object.keys(S.carrito).reduce(function (s, id) { return s + S.carrito[id]; }, 0);
    var visible = !$('#panelVenta').hidden && (n > 0 || !!S.edit);
    $('#barraCarrito').hidden = !visible;
    $('#carritoCant').textContent = n + (n === 1 ? ' producto' : ' productos');
    $('#carritoTotal').textContent = plata(totalCarrito());
    $('#btnRevisar').textContent = S.edit ? 'Revisar cambios' : 'Revisar pedido';
  }

  function validarCabecera() {
    var mesa = $('#inpMesa'), cli = $('#inpCliente'), ok = true;
    [mesa, cli].forEach(function (i) { i.classList.remove('invalido'); });
    if (!mesa.value.trim()) { mesa.classList.add('invalido'); ok = false; }
    else if (!/^[0-9A-Za-z\- ]+$/.test(mesa.value.trim())) { mesa.classList.add('invalido'); toast('La mesa solo admite números y letras.', 'mal'); return false; }
    if (cli.value.trim().length < 2) { cli.classList.add('invalido'); ok = false; }
    if (!ok) { toast('Completa el número de mesa y el nombre del cliente.', 'mal'); (mesa.value.trim() ? cli : mesa).focus(); }
    return ok;
  }

  $('#btnRevisar').addEventListener('click', function () {
    if (!validarCabecera()) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    if (!Object.keys(S.carrito).length) return toast('Agrega al menos un producto.', 'mal');
    abrirResumen();
  });

  function lineasCarritoHTML() {
    var ids = Object.keys(S.carrito).map(Number);
    if (!ids.length) return '<div class="vacio">El pedido está vacío.</div>';
    return '<ul class="lineas">' + ids.map(function (id) {
      var c = S.carrito[id], pr = precioDe(id);
      return '<li class="linea" data-id="' + id + '"><div class="linea-nombre">' + esc(nombreDe(id)) + '<small>' + plata(pr) + ' c/u</small></div>' +
        '<div class="mini-stepper"><button type="button" class="quitar" data-d="-99" aria-label="Eliminar">🗑</button>' +
        '<button type="button" data-d="-1" aria-label="Menos">−</button><output>' + c + '</output>' +
        '<button type="button" data-d="1" aria-label="Más">+</button></div>' +
        '<div class="linea-sub">' + plata(pr * c) + '</div></li>';
    }).join('') + '</ul>';
  }

  function abrirResumen() {
    var tv = S.tipoVenta;
    var cuerpo = function () {
      var com = $('#inpComentario').value.trim();
      return '<div class="detalle-cabeza"><div><div class="pedido-meta">Cliente</div><div class="pedido-cliente">' + esc($('#inpCliente').value.trim()) + '</div>' +
        (com ? '<div class="pedido-coment">📝 ' + esc(com) + '</div>' : '') + '</div>' +
        '<div class="pedido-mesa"><small>MESA</small><b>' + esc($('#inpMesa').value.trim()) + '</b></div></div>' +
        lineasCarritoHTML() +
        '<div class="total-grande"><span>Total</span><b>' + plata(totalCarrito()) + '</b></div>' +
        '<div class="campo"><span>Tipo de venta *</span><div class="chips" id="chipsVenta">' +
        ['Efectivo', 'Transferencia'].map(function (t) {
          return '<label><input type="radio" name="tv" value="' + t + '"' + (tv === t ? ' checked' : '') + '><span>' + (t === 'Efectivo' ? '💵 ' : '🏦 ') + t + '</span></label>';
        }).join('') + '</div></div>';
    };
    abrirModal(S.edit ? 'Editar pedido #' + S.edit.numero : 'Confirmar pedido', cuerpo(),
      '<button class="btn btn-borde" data-cerrar>Seguir agregando</button>' +
      '<button class="btn btn-rojo" id="btnConfirmar">' + (S.edit ? 'Guardar cambios' : 'Crear pedido') + '</button>');

    var mc = $('#modalCuerpo');
    mc.onclick = function (ev) {
      var b = ev.target.closest('.mini-stepper button'); if (!b) return;
      var id = Number(b.closest('.linea').dataset.id);
      cambiarCant(id, Number(b.dataset.d));
      tv = ($('input[name="tv"]:checked') || {}).value || tv;
      mc.innerHTML = cuerpo();
      renderProductos();
    };
    mc.onchange = function (ev) { if (ev.target.name === 'tv') { tv = ev.target.value; S.tipoVenta = tv; } };

    $('#btnConfirmar').onclick = function () {
      var tipo = ($('input[name="tv"]:checked') || {}).value;
      if (!tipo) return toast('Selecciona Efectivo o Transferencia.', 'mal');
      if (!Object.keys(S.carrito).length) return toast('Agrega al menos un producto.', 'mal');
      S.tipoVenta = tipo;
      enviarPedido(this);
    };
  }

  function enviarPedido(btn) {
    var items = Object.keys(S.carrito).map(function (id) { return { id: Number(id), cantidad: S.carrito[id] }; });
    var datos = { mesa: $('#inpMesa').value.trim(), cliente: $('#inpCliente').value.trim(), comentario: $('#inpComentario').value.trim(), tipoVenta: S.tipoVenta, items: items };
    if (!S.edit) return crearEnFondo(datos);
    btn.disabled = true; S.ocupado = true;
    var n = turno('mis');
    var p, clave = null;
    if (S.edit) {
      clave = 'editar:' + S.edit.numero + ':' + S.edit.version + ':' + JSON.stringify([datos.mesa, datos.cliente, datos.tipoVenta, items]);
      p = api('editar', Object.assign(datos, { numero: S.edit.numero, version: S.edit.version, reqId: reqIdPara(clave), desde: desdePara('mis') }));
    } else {
      if (!S.reqId) S.reqId = uuid();          // se conserva si hay que reintentar
      p = api('crear', Object.assign(datos, { reqId: S.reqId }));
    }
    p.then(function (r) {
      if (clave) confirmado(clave);
      toast(S.edit ? 'Pedido #' + r.numero + ' actualizado ✔' : 'Pedido #' + r.numero + ' creado ✔', 'ok');
      limpiarVenta();
      cerrarModal();
      if (!aplicarLista('mis', r.lista, n)) cargarMis(true);
    }).catch(function (e) {
      toast(e.message, 'mal');
      if (e.codigo === 'VERSION') { limpiarVenta(); cerrarModal(); mostrarTab('mis'); }
    }).finally(function () { btn.disabled = false; S.ocupado = false; });
  }

  /*
   * Pedido nuevo en segundo plano: el formulario queda libre al instante para la
   * siguiente venta y el pedido aparece arriba en "Mis pedidos" como "Guardando…".
   * Usa el mismo reqId en todos los reintentos, así nunca se duplica.
   */
  function crearEnFondo(datos) {
    var env = {
      reqId: S.reqId || uuid(), datos: datos, total: totalCarrito(), hora: hhmm(),
      lineas: datos.items.map(function (i) { return { nombre: nombreDe(i.id), cantidad: i.cantidad, subtotal: precioDe(i.id) * i.cantidad }; })
    };
    S.enviando.unshift(env);
    limpiarVenta();
    cerrarModal();
    toast('Enviando pedido de mesa ' + datos.mesa + '… ya puedes tomar el siguiente.', '');
    enviarEnFondo(env);
  }

  /*
   * Si la lista ya trae un pedido que estaba "Guardando…" o "Sin guardar"
   * (la respuesta se perdió, pero sí se guardó), se retira la tarjeta
   * pendiente y se avisa. Se reconoce por el identificador de envío.
   */
  function reconciliarEnviando() {
    if (!S.enviando.length) return;
    var porReq = {};
    S.mis.forEach(function (p) { if (p.reqId) porReq[p.reqId] = p; });
    S.enviando = S.enviando.filter(function (env) {
      var p = porReq[env.reqId];
      if (!p) return true;
      toast('Pedido #' + p.numero + ' (mesa ' + p.mesa + ') creado ✔', 'ok');
      return false;
    });
  }

  function enviarEnFondo(env) {
    env.estado = 'enviando'; env.error = '';
    renderMis();
    var n = turno('mis');
    api('crear', Object.assign({}, env.datos, { reqId: env.reqId, desde: desdePara('mis') }), { silencioso: true })
      .then(function (r) {
        if (!S.token) return;
        var seguia = S.enviando.indexOf(env) >= 0;      // pudo resolverse antes por la lista
        S.enviando = S.enviando.filter(function (x) { return x !== env; });
        if (seguia) toast('Pedido #' + r.numero + ' (mesa ' + env.datos.mesa + ') creado ✔', 'ok');
        if (!aplicarLista('mis', r.lista, n)) { renderMis(); cargarMis(true); }
      })
      .catch(function (e) {
        if (e.codigo === 'SESION' || !S.token) return;
        if (S.enviando.indexOf(env) < 0) return;           // ya apareció guardado en la lista
        env.estado = 'error';
        env.error = e.message;
        env.transitorio = !!e.transitorio;
        toast('El pedido de mesa ' + env.datos.mesa + ' no se pudo guardar. Revísalo en "Mis pedidos".', 'mal');
        renderMis();
      });
  }

  function tarjetaPendiente(env) {
    var acc = env.estado === 'error'
      ? '<div class="acciones"><button class="btn btn-azul btn-chico" data-env="reintentar" data-req="' + env.reqId + '">↻ Reintentar</button>' +
        (env.transitorio ? '' : '<button class="btn btn-borde btn-chico" data-env="editar" data-req="' + env.reqId + '">✏️ Corregir</button>') +
        '<button class="btn btn-peligro btn-chico" data-env="descartar" data-req="' + env.reqId + '">Descartar</button></div>'
      : '';
    return '<article class="pedido pendiente' + (env.estado === 'error' ? ' con-error' : '') + '">' +
      '<div class="pedido-cabeza"><div class="pedido-num"><small>' + env.hora + '</small>' +
      (env.estado === 'error' ? '⚠️ Sin guardar' : '<span class="mini-spin"></span> Guardando…') + '</div>' +
      '<div class="pedido-mesa"><small>MESA</small><b>' + esc(env.datos.mesa) + '</b></div></div>' +
      '<div class="pedido-cliente">' + esc(env.datos.cliente) + '</div>' +
      (env.datos.comentario ? '<div class="pedido-coment">📝 ' + esc(env.datos.comentario) + '</div>' : '') +
      '<ul class="pedido-items">' + env.lineas.map(function (i) {
        return '<li><span><b>' + i.cantidad + '×</b> ' + esc(i.nombre) + '</span><span>' + plata(i.subtotal) + '</span></li>';
      }).join('') + '</ul>' +
      '<div class="pedido-total"><span class="tipo-venta">' + esc(env.datos.tipoVenta) + '</span><span>' + plata(env.total) + '</span></div>' +
      (env.estado === 'error' ? '<p class="nota">' + esc(env.error) +
        (env.transitorio ? ' Se volverá a intentar automáticamente.' : '') + '</p>' : '') + acc + '</article>';
  }

  $('#listaMis').addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-env]'); if (!b) return;
    var env = S.enviando.filter(function (x) { return x.reqId === b.dataset.req; })[0];
    if (!env) return;
    if (b.dataset.env === 'reintentar') return enviarEnFondo(env);
    if (b.dataset.env === 'descartar') {
      if (!confirm('¿Descartar este pedido sin guardar? Si alcanzó a guardarse igual aparecerá en la lista.')) return;
      S.enviando = S.enviando.filter(function (x) { return x !== env; });
      renderMis(); cargarMis(true); return;
    }
    if (b.dataset.env === 'editar') {
      // El servidor lo rechazó (no se guardó): se devuelve al formulario para corregirlo.
      if (Object.keys(S.carrito).length && !confirm('Tienes una venta en el formulario. Se reemplazará. ¿Continuar?')) return;
      S.enviando = S.enviando.filter(function (x) { return x !== env; });
      limpiarVenta();
      env.datos.items.forEach(function (i) { S.carrito[i.id] = i.cantidad; });
      $('#inpMesa').value = env.datos.mesa; $('#inpCliente').value = env.datos.cliente; $('#inpComentario').value = env.datos.comentario || '';
      S.tipoVenta = env.datos.tipoVenta;
      mostrarTab('venta'); renderProductos(); actualizarCarrito();
    }
  });

  window.addEventListener('beforeunload', function (ev) {
    if (S.enviando.some(function (x) { return x.estado === 'enviando'; })) { ev.preventDefault(); ev.returnValue = ''; }
  });

  function limpiarVenta() {
    S.carrito = {}; S.edit = null; S.reqId = null; S.tipoVenta = '';
    $('#inpMesa').value = ''; $('#inpCliente').value = ''; $('#inpComentario').value = ''; $('#buscaProd').value = '';
    $('#bannerEdicion').hidden = true;
    renderProductos(); actualizarCarrito();
  }

  $('#btnCancelarEdicion').addEventListener('click', function () { limpiarVenta(); mostrarTab('mis'); });

  /* ================= VENDEDOR: mis pedidos ================= */

  /*
   * Listas de pedidos:
   *  - cada pedido de lista toma un "turno"; una respuesta vieja que llega tarde
   *    nunca reemplaza una más nueva;
   *  - si la carga falla, se conserva la última lista buena y se muestra un aviso
   *    con botón Reintentar (nunca queda en blanco sin explicación).
   */
  function turno(tipo) { return ++S.seq[tipo]; }

  // Sello a enviar: con lista ya cargada se piden solo los cambios; si no, todo.
  function desdePara(tipo, completa) {
    return (!completa && S.cargado[tipo] && S.desde[tipo] != null) ? S.desde[tipo] : null;
  }

  /*
   * Aplica una respuesta de lista { pedidos, parcial, desde, total }.
   * parcial = true → trae solo los pedidos que cambiaron: se unen con los que ya
   * están en pantalla. Si al unir no cuadra el total, se pide la lista completa.
   */
  function aplicarLista(tipo, r, n) {
    if (!r || !Array.isArray(r.pedidos) || n < S.aplicado[tipo]) return false;
    var lista = r.pedidos;
    if (r.parcial) {
      if (!S.cargado[tipo]) return false;
      var mapa = {};
      (tipo === 'mis' ? S.mis : S.todos).forEach(function (p) { mapa[p.numero] = p; });
      r.pedidos.forEach(function (p) { mapa[p.numero] = p; });
      lista = Object.keys(mapa).map(function (k) { return mapa[k]; });
      lista.sort(function (a, b) { return tipo === 'mis' ? b.numero - a.numero : a.numero - b.numero; });
      if (typeof r.total === 'number' && lista.length !== r.total) { S.desde[tipo] = null; return false; }
    } else {
      S.ultCompleta[tipo] = Date.now();
    }
    S.aplicado[tipo] = n;
    S.cargado[tipo] = true;
    if (r.desde != null) S.desde[tipo] = r.desde;
    if (tipo === 'mis') { S.mis = lista; reconciliarEnviando(); renderMis(); } else { S.todos = lista; renderAdmin(); }
    aviso(tipo, null);
    var hora = r.hora || new Date().toLocaleTimeString('es-CL', { hour12: false });
    if (tipo === 'todos') $('#lblActualizado').textContent = 'Actualizado a las ' + hora + ' · se actualiza solo al haber cambios';
    else $('#lblActMis').textContent = 'Actualizado ' + hora.slice(0, 5);
    return true;
  }
  function aviso(tipo, msg) {
    var el = $(tipo === 'mis' ? '#avisoMis' : '#avisoAdmin');
    if (!msg) { el.hidden = true; el.innerHTML = ''; return; }
    el.innerHTML = '<span>⚠️ ' + esc(msg) + '</span><button class="btn btn-peligro btn-chico" data-reintentar="' + tipo + '">Reintentar</button>';
    el.hidden = false;
    if (!S.cargado[tipo]) {
      $(tipo === 'mis' ? '#listaMis' : '#listaAdmin').innerHTML = '<div class="vacio">No se pudieron cargar los pedidos.</div>';
    }
  }
  document.addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-reintentar]');
    if (b) { if (b.dataset.reintentar === 'mis') cargarMis(false); else cargarTodos(false); return; }
    var v = ev.target.closest('[data-ver-todos]');
    if (v) {
      var cont = v.dataset.verTodos === 'mis' ? '#filtrosMis' : '#filtrosAdmin';
      $(cont + ' .chip[data-f="todos"]').click();
    }
  });
  function hhmm() { return new Date().toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', hour12: false }); }

  /** completa = true → descarga toda la lista; si no, solo los cambios. */
  function cargarMis(silencioso, completa) {
    var n = turno('mis');
    return api('misPedidos', { desde: desdePara('mis', completa) }, { silencioso: silencioso }).then(function (r) {
      if (!aplicarLista('mis', r, n) && r.parcial && S.desde.mis === null) return cargarMis(silencioso, true);
      return true;
    }).catch(function (e) {
      if (e.codigo === 'SESION') return false;
      aviso('mis', 'No se pudo actualizar la lista (' + hhmm() + '): ' + e.message + ' Se reintentará sola.');
      return false;
    });
  }

  /** Productos activos desde el servidor; fresco = releer la planilla. */
  function cargarProductos(fresco) {
    return api('productos', fresco ? { fresco: true } : {}, { silencioso: true }).then(function (r) {
      var antes = S.prodMap;               // nombres previos, para avisar qué se quitó
      // la versión de productos viaja con la lista: así nunca se pierde un cambio ocurrido justo al entrar
      if (r.version != null) { S.version = S.version || {}; S.version.productos = r.version; }
      S.productos = r.productos;
      S.prodMap = {};
      r.productos.forEach(function (p) { S.prodMap[p.id] = p; });
      // Productos que ya no están disponibles salen del pedido en curso (no al editar uno existente).
      var quitados = [];
      if (!S.edit) Object.keys(S.carrito).forEach(function (id) {
        if (!S.prodMap[id]) { quitados.push(antes[id] ? antes[id].nombre : 'Producto ' + id); delete S.carrito[id]; }
      });
      if (S.usuario && S.usuario.perfil !== 'admin') { renderProductos(); actualizarCarrito(); }
      return { total: r.productos.length, quitados: quitados };
    });
  }

  /*
   * Botones "Actualizar pedidos" / "Actualizar productos" (ambos perfiles).
   * Piden al servidor releer la planilla, sin usar la memoria rápida.
   */
  document.addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-actualizar]'); if (!b || b.classList.contains('girando')) return;
    var que = b.dataset.actualizar;
    b.classList.add('girando'); b.disabled = true;
    b.innerHTML = '<span class="spin-ic">↻</span> ' + b.innerHTML.replace(/^↻\s*/, '');
    var fin = function () {
      b.classList.remove('girando'); b.disabled = false;
      var sp = b.querySelector('.spin-ic'); if (sp) sp.outerHTML = '↻';
    };
    var p;
    if (que === 'productos') {
      p = cargarProductos(true).then(function (r) {
        toast('Productos actualizados: ' + r.total + ' disponibles' +
          (r.quitados.length ? '. Se quitó del pedido: ' + r.quitados.join(', ') + ' (ya no está disponible)' : ' ✔'),
          r.quitados.length ? 'mal' : 'ok');
      }, function (e) { toast('No se pudieron actualizar los productos: ' + e.message, 'mal'); });
    } else {
      // Pedidos "Sin guardar" por la red también se reintentan al actualizar.
      S.enviando.forEach(function (env) { if (env.estado === 'error' && env.transitorio) enviarEnFondo(env); });
      p = (que === 'todos' ? cargarTodos(true, true) : cargarMis(true, true)).then(function (ok) {
        if (ok) toast('Pedidos actualizados (' + hhmm() + ') ✔', 'ok');
      });
    }
    p.then(fin, fin);
  });

  // Cuenta por filtro en cada botón y mensaje de vista vacía que explica dónde están los pedidos.
  function contarChips(cont, lista) {
    $$(cont + ' .chip').forEach(function (c) {
      var f = c.dataset.f, n = lista.filter(function (p) { return pasaFiltro(p, f); }).length;
      var b = c.querySelector('.n'); if (b) b.textContent = '(' + n + ')';
    });
  }
  function vacioHTML(tipo, total, filtro, buscando) {
    if (!S.cargado[tipo]) return '<div class="vacio">Cargando pedidos…</div>';
    if (!total) return '<div class="vacio">Aún no hay pedidos.</div>';
    var nombre = ($((tipo === 'mis' ? '#filtrosMis' : '#filtrosAdmin') + ' .chip[data-f="' + filtro + '"]') || {}).textContent || '';
    nombre = nombre.replace(/\s*\(\d+\)\s*$/, '').trim();
    var txt = buscando ? 'Ningún pedido coincide con la búsqueda.' : 'No hay pedidos en «' + esc(nombre) + '».';
    return '<div class="vacio">' + txt + '<br>Hay ' + total + ' pedido' + (total === 1 ? '' : 's') + ' en total.' +
      (filtro !== 'todos' ? '<br><button class="btn btn-navy btn-chico" data-ver-todos="' + tipo + '">Ver todos</button>' : '') + '</div>';
  }

  $('#filtrosMis').addEventListener('click', function (ev) {
    var b = ev.target.closest('.chip'); if (!b) return;
    S.filtroMis = b.dataset.f;
    $$('#filtrosMis .chip').forEach(function (c) { c.classList.toggle('activo', c === b); });
    renderMis();
  });

  function pasaFiltro(p, f) {
    if (f === 'todos') return true;
    if (f === 'activos') return p.estado === 'Creado' || p.estado === 'En preparación';
    return p.estado === f;
  }

  function renderMis() {
    var activos = S.mis.filter(function (p) { return pasaFiltro(p, 'activos'); }).length + S.enviando.length;
    $('#cntMis').textContent = activos;
    contarChips('#filtrosMis', S.mis);
    var lista = S.mis.filter(function (p) { return pasaFiltro(p, S.filtroMis); });
    var pend = S.enviando.map(tarjetaPendiente).join('');
    $('#listaMis').innerHTML = pend + (lista.length ? lista.map(function (p) { return tarjetaPedido(p, 'vendedor'); }).join('')
      : (pend ? '' : vacioHTML('mis', S.mis.length, S.filtroMis, false)));
  }

  function historialHTML(p) {
    return '<ul class="historial">' + p.historial.map(function (h, i) {
      return '<li class="' + (i === p.historial.length - 1 ? 'actual' : '') + '">' + esc(h.estado) + ' ' + esc(h.hora.slice(0, 5)) +
        (h.fecha !== p.fecha ? ' (' + esc(h.fecha) + ')' : '') + '</li>';
    }).join('') + '</ul>';
  }

  function tarjetaPedido(p, modo) {
    var acc = '';
    if (p.guardando) {
      acc = '';
    } else if (modo === 'vendedor') {
      if (p.estado === 'Creado') acc += '<button class="btn btn-azul btn-chico" data-acc="editar">✏️ Editar</button>';
      if (p.estado === 'En preparación') acc += '<button class="btn btn-verde btn-chico" data-acc="entregar">✔ Marcar entregado</button>';
      if (p.estado === 'Creado' || p.estado === 'En preparación') acc += '<button class="btn btn-peligro btn-chico" data-acc="eliminar">Eliminar</button>';
    } else if (modo === 'admin') {
      if (p.estado === 'Creado') acc += '<button class="btn btn-oro btn-chico" data-acc="preparar">🍳 A preparación + imprimir</button>';
      acc += '<button class="btn btn-borde btn-chico" data-acc="imprimir">🖨️ ' + (p.historial.some(function (h) { return h.estado === 'En preparación'; }) ? 'Reimprimir' : 'Imprimir') + '</button>';
    }
    var tipoCls = norm(p.tipoVenta) === 'efectivo' ? ' efectivo' : '';
    return '<article class="pedido" data-num="' + p.numero + '" data-estado="' + esc(p.estado) + '">' +
      '<div class="pedido-cabeza"><div class="pedido-num"><small>' + esc(p.fecha) + ' · ' + esc(p.hora.slice(0, 5)) + '</small>#' + p.numero + '</div>' +
      '<div class="pedido-mesa"><small>MESA</small><b>' + esc(p.mesa) + '</b></div></div>' +
      '<div class="pedido-cliente">' + esc(p.cliente) + '</div>' +
      (p.comentario ? '<div class="pedido-coment">📝 ' + esc(p.comentario) + '</div>' : '') +
      (modo === 'admin' ? '<div class="pedido-meta">Vende: ' + esc(p.usuario) + (p.tipoUsuario && p.tipoUsuario !== 'Alumno' ? ' (' + esc(p.tipoUsuario) + ')' : '') + '</div>' : '') +
      '<ul class="pedido-items">' + p.items.map(function (i) {
        return '<li><span><b>' + i.cantidad + '×</b> ' + esc(i.nombre) + '</span><span>' + plata(i.subtotal) + '</span></li>';
      }).join('') + '</ul>' +
      '<div class="pedido-total"><span class="estado" data-e="' + esc(p.estado) + '">' + esc(p.estado) + '</span>' +
      (p.guardando ? '<span class="guardando"><span class="mini-spin"></span> Guardando…</span>' : '') +
      '<span><span class="tipo-venta' + tipoCls + '">' + esc(p.tipoVenta) + '</span> ' + plata(p.total) + '</span></div>' +
      historialHTML(p) +
      (acc ? '<div class="acciones">' + acc + '</div>' : '') +
      '</article>';
  }

  $('#listaMis').addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-acc]'); if (!b) return;
    var p = S.mis.filter(function (x) { return x.numero === Number(b.closest('.pedido').dataset.num); })[0];
    if (!p) return;
    var acc = b.dataset.acc;
    if (acc === 'editar') return editarPedidoVendedor(p);
    if (acc === 'entregar') return cambiarEstado(p, 3, '¿Marcar el pedido #' + p.numero + ' como ENTREGADO?');
    if (acc === 'eliminar') return cambiarEstado(p, 4, '¿Eliminar el pedido #' + p.numero + ' (' + p.cliente + ')? Quedará marcado como Eliminado.');
  });

  function editarPedidoVendedor(p) {
    if (Object.keys(S.carrito).length && !S.edit && !confirm('Tienes una venta sin enviar. Se reemplazará por el pedido #' + p.numero + '. ¿Continuar?')) return;
    S.edit = { numero: p.numero, version: p.version, items: p.items };
    S.carrito = {};
    p.items.forEach(function (i) { S.carrito[i.id] = i.cantidad; });
    S.tipoVenta = p.tipoVenta;
    $('#inpMesa').value = p.mesa; $('#inpCliente').value = p.cliente; $('#inpComentario').value = p.comentario || '';
    $('#lblEditNum').textContent = '#' + p.numero;
    $('#bannerEdicion').hidden = false;
    mostrarTab('venta');
    renderProductos();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function cambiarEstado(p, nuevo, pregunta) {
    if (pregunta && !confirm(pregunta)) return Promise.resolve(null);
    var clave = 'estado:' + p.numero + ':' + p.version + ':' + nuevo;
    var lista = null, tipo = S.usuario.perfil === 'admin' ? 'todos' : 'mis', n = turno(tipo);
    var optimista = tipo === 'mis';
    if (optimista) {
      // Se muestra el cambio al instante; si el servidor lo rechaza, se vuelve atrás.
      S.aplicado.mis = n;              // descarta listas pedidas antes de este cambio
      var nombre = { 2: 'En preparación', 3: 'Entregado', 4: 'Eliminado' }[nuevo];
      S.mis = S.mis.map(function (x) {
        return x.numero !== p.numero ? x : Object.assign({}, x, {
          estado: nombre, guardando: true,
          historial: x.historial.concat([{ estado: nombre, fecha: x.fecha, hora: '…' }])
        });
      });
      renderMis();
    } else {
      S.ocupado = true;
    }
    var fallo = false;
    return api('estado', { numero: p.numero, version: p.version, nuevo: nuevo, reqId: reqIdPara(clave), desde: desdePara(tipo) }, { silencioso: optimista })
      .then(function (r) {
        confirmado(clave);
        lista = r.lista || null;
        toast('Pedido #' + p.numero + ': ' + r.estado + ' (' + r.hora.slice(0, 5) + ')', 'ok');
        return r;
      })
      .catch(function (e) { toast(e.message, 'mal'); fallo = true; return null; })
      .finally(function () {
        S.ocupado = false;
        if (lista && aplicarLista(tipo, lista, n)) return;
        // si falló, descarga completa para deshacer el cambio mostrado de antemano
        return tipo === 'todos' ? cargarTodos(true, fallo) : cargarMis(true, fallo);
      });
  }

  /* ================= ADMINISTRADOR ================= */

  function cargarTodos(silencioso, completa) {
    var n = turno('todos');
    return api('todosPedidos', { desde: desdePara('todos', completa) }, { silencioso: silencioso }).then(function (r) {
      if (!aplicarLista('todos', r, n) && r.parcial && S.desde.todos === null) return cargarTodos(silencioso, true);
      return true;
    }).catch(function (e) {
      if (e.codigo === 'SESION') return false;
      aviso('todos', 'No se pudo actualizar la lista (' + hhmm() + '): ' + e.message + ' Se reintentará sola.');
      return false;
    });
  }

  $('#filtrosAdmin').addEventListener('click', function (ev) {
    var b = ev.target.closest('.chip'); if (!b) return;
    S.filtroAdmin = b.dataset.f;
    $$('#filtrosAdmin .chip').forEach(function (c) { c.classList.toggle('activo', c === b); });
    renderAdmin();
  });
  $('#buscaAdmin').addEventListener('input', function () { S.buscaAdmin = norm(this.value); renderAdmin(); });
  $('#btnOrden').addEventListener('click', function () {
    S.ordenAsc = !S.ordenAsc;
    this.textContent = S.ordenAsc ? '↑ Más antiguo primero' : '↓ Más reciente primero';
    renderAdmin();
  });

  function renderAdmin() {
    var vig = S.todos.filter(function (p) { return p.estado !== 'Eliminado'; });
    var cuenta = function (e) { return S.todos.filter(function (p) { return p.estado === e; }).length; };
    var suma = function (f) { return vig.filter(f).reduce(function (s, p) { return s + p.total; }, 0); };
    $('#resumenAdmin').innerHTML =
      kpi('Creados', cuenta('Creado')) + kpi('En preparación', cuenta('En preparación')) + kpi('Entregados', cuenta('Entregado')) +
      kpi('Total vendido', plata(suma(function () { return true; }))) +
      kpi('Efectivo', plata(suma(function (p) { return norm(p.tipoVenta) === 'efectivo'; }))) +
      kpi('Transferencia', plata(suma(function (p) { return norm(p.tipoVenta) === 'transferencia'; })));

    var q = S.buscaAdmin;
    var lista = S.todos.filter(function (p) {
      if (!pasaFiltro(p, S.filtroAdmin)) return false;
      if (!q) return true;
      return norm(['#' + p.numero, p.numero, 'mesa ' + p.mesa, p.cliente, p.usuario].join(' ')).indexOf(q) >= 0;
    });
    lista.sort(function (a, b) { return S.ordenAsc ? a.numero - b.numero : b.numero - a.numero; });
    contarChips('#filtrosAdmin', S.todos);
    $('#listaAdmin').innerHTML = lista.length ? lista.map(function (p) { return tarjetaPedido(p, 'admin'); }).join('')
      : vacioHTML('todos', S.todos.length, S.filtroAdmin, !!q);
  }
  function kpi(t, v) { return '<div class="kpi"><span>' + t + '</span><b>' + v + '</b></div>'; }

  $('#listaAdmin').addEventListener('click', function (ev) {
    var card = ev.target.closest('.pedido'); if (!card) return;
    var p = S.todos.filter(function (x) { return x.numero === Number(card.dataset.num); })[0];
    if (!p) return;
    var b = ev.target.closest('[data-acc]');
    if (b && b.dataset.acc === 'imprimir') return imprimir(p, true);
    if (b && b.dataset.acc === 'preparar') return prepararEImprimir(p);
    abrirDetalleAdmin(p);
  });

  function prepararEImprimir(p) {
    return cambiarEstado(p, 2, null).then(function (r) {
      if (!r) return;
      var actualizado = S.todos.filter(function (x) { return x.numero === p.numero; })[0] || p;
      cerrarModal();
      imprimir(actualizado, false);
    });
  }

  function imprimir(p, reimpresion) {
    return Impresora.imprimir(p, { reimpresion: reimpresion })
      .then(function () { if (Impresora.config().modo !== 'navegador') toast('Ticket #' + p.numero + ' enviado a la impresora 🖨️', 'ok'); })
      .catch(function (e) {
        toast('No se pudo imprimir: ' + (e && e.message ? e.message : e) + '. Revisa la impresora.', 'mal');
      });
  }

  function abrirDetalleAdmin(p) {
    var editable = p.estado === 'Creado' || p.estado === 'En preparación';
    var lineas = p.items.map(function (i) { return { id: i.id, nombre: i.nombre, precio: i.precio, cantidad: i.cantidad }; });
    var original = JSON.stringify(lineas.map(function (l) { return [l.id, l.cantidad]; }));
    var sucio = function () { return JSON.stringify(lineas.map(function (l) { return [l.id, l.cantidad]; })) !== original; };
    var total = function () { return lineas.reduce(function (s, l) { return s + l.precio * l.cantidad; }, 0); };

    function cuerpo() {
      var opciones = S.productos.filter(function (pr) { return !lineas.some(function (l) { return l.id === pr.id; }); });
      return '<div class="detalle-cabeza"><div><div class="pedido-meta">' + esc(p.fecha) + ' ' + esc(p.hora) + ' · Vende ' + esc(p.usuario) +
        (p.tipoUsuario && p.tipoUsuario !== 'Alumno' ? ' (' + esc(p.tipoUsuario) + ')' : '') + '</div>' +
        '<div class="pedido-cliente">' + esc(p.cliente) + '</div>' +
        (p.comentario ? '<div class="pedido-coment">📝 ' + esc(p.comentario) + '</div>' : '') +
        '<div><span class="estado" data-e="' + esc(p.estado) + '">' + esc(p.estado) + '</span> <span class="tipo-venta' + (norm(p.tipoVenta) === 'efectivo' ? ' efectivo' : '') + '">' + esc(p.tipoVenta) + '</span></div>' +
        historialHTML(p) + '</div>' +
        '<div class="pedido-mesa"><small>MESA</small><b>' + esc(p.mesa) + '</b></div></div>' +
        (lineas.length ? '<ul class="lineas">' + lineas.map(function (l, ix) {
          return '<li class="linea" data-ix="' + ix + '"><div class="linea-nombre">' + esc(l.nombre) + '<small>' + plata(l.precio) + ' c/u</small></div>' +
            (editable ? '<div class="mini-stepper"><button type="button" class="quitar" data-d="x" aria-label="Eliminar producto">🗑</button>' +
              '<button type="button" data-d="-1" aria-label="Menos">−</button><output>' + l.cantidad + '</output>' +
              '<button type="button" data-d="1" aria-label="Más">+</button></div>'
              : '<div class="mini-stepper"><output>' + l.cantidad + ' ×</output></div>') +
            '<div class="linea-sub">' + plata(l.precio * l.cantidad) + '</div></li>';
        }).join('') + '</ul>' : '<div class="vacio">Sin productos. Agrega al menos uno para guardar.</div>') +
        (editable ? '<div class="agregar-prod"><select id="selAgregar" aria-label="Producto para agregar"><option value="">+ Agregar producto…</option>' +
          opciones.map(function (o) { return '<option value="' + o.id + '">' + esc(o.nombre) + ' · ' + plata(o.precio) + '</option>'; }).join('') +
          '</select><button class="btn btn-navy btn-chico" type="button" id="btnAgregar">Agregar</button></div>' : '') +
        '<div class="total-grande"><span>Total</span><b>' + plata(total()) + '</b></div>' +
        (sucio() ? '<p class="nota">Hay cambios sin guardar. Guarda antes de pasar a preparación o imprimir.</p>' : '') +
        '<div class="ticket-preview">' + Impresora.htmlTicket(p, { reimpresion: false }) + '</div>';
    }
    function pie() {
      var h = '';
      if (editable) h += '<button class="btn btn-azul" id="btnGuardarAdm"' + (sucio() && lineas.length ? '' : ' disabled') + '>Guardar cambios</button>';
      if (p.estado === 'Creado') h += '<button class="btn btn-oro" id="btnPrepAdm"' + (sucio() ? ' disabled' : '') + '>🍳 Pasar a En preparación e imprimir</button>';
      h += '<button class="btn btn-borde" id="btnImpAdm"' + (sucio() ? ' disabled' : '') + '>🖨️ ' + (p.estado === 'Creado' ? 'Imprimir' : 'Reimprimir') + '</button>';
      return h;
    }
    function pintar() {
      $('#modalCuerpo').innerHTML = cuerpo();
      $('#modalPie').innerHTML = pie();
      enlazarPie();
    }
    function enlazarPie() {
      var g = $('#btnGuardarAdm');
      if (g) g.onclick = function () {
        g.disabled = true; S.ocupado = true;
        var its = lineas.map(function (l) { return { id: l.id, cantidad: l.cantidad }; });
        var clave = 'editarAdm:' + p.numero + ':' + p.version + ':' + JSON.stringify(its);
        var nT = turno('todos');
        api('editar', { numero: p.numero, version: p.version, items: its, reqId: reqIdPara(clave), desde: desdePara('todos') })
          .then(function (r) {
            confirmado(clave);
            toast('Pedido #' + p.numero + ' actualizado ✔', 'ok');
            var listo = aplicarLista('todos', r.lista, nT) ? Promise.resolve() : cargarTodos(true);
            return listo.then(function () {
              var nuevo = S.todos.filter(function (x) { return x.numero === p.numero; })[0];
              if (nuevo) abrirDetalleAdmin(nuevo); else cerrarModal();
            });
          })
          .catch(function (e) {
            toast(e.message, 'mal');
            if (e.codigo === 'VERSION') { cerrarModal(); cargarTodos(true); } else g.disabled = false;
          })
          .finally(function () { S.ocupado = false; });
      };
      var pr = $('#btnPrepAdm');
      if (pr) pr.onclick = function () { pr.disabled = true; prepararEImprimir(p); };
      var im = $('#btnImpAdm');
      if (im) im.onclick = function () { imprimir(p, p.estado !== 'Creado'); };
    }

    abrirModal('Pedido #' + p.numero, '', '', true);
    pintar();

    var mc = $('#modalCuerpo');
    mc.onclick = function (ev) {
      if (ev.target.id === 'btnAgregar') {
        var id = Number($('#selAgregar').value);
        if (!id) return toast('Elige un producto para agregar.', 'mal');
        var pr = S.prodMap[id];
        lineas.push({ id: id, nombre: pr.nombre, precio: pr.precio, cantidad: 1 });
        return pintar();
      }
      var b = ev.target.closest('.mini-stepper button'); if (!b) return;
      var ix = Number(b.closest('.linea').dataset.ix);
      if (b.dataset.d === 'x') {
        if (lineas.length === 1) return toast('El pedido debe tener al menos un producto.', 'mal');
        lineas.splice(ix, 1);
      } else {
        lineas[ix].cantidad = Math.max(1, Math.min(99, lineas[ix].cantidad + Number(b.dataset.d)));
      }
      pintar();
    };
    mc.onchange = null;
  }

  Fotos.alLlegar(function () {
    if (S.usuario && S.usuario.perfil !== 'admin') renderProductos();
    if (S.repintarPanel) S.repintarPanel();
  });

  /* ================= Productos (Administrador) ================= */
  /*
   * Lista de TODOS los productos con un interruptor Disponible / Agotado.
   * Al marcar uno como agotado desaparece al instante de la pantalla de venta
   * de todos los vendedores (y se quita, con aviso, de los pedidos sin enviar).
   */
  $('#btnProductosAdm').addEventListener('click', abrirProductosAdmin);

  function abrirProductosAdmin() {
    var lista = [], q = '', ver = 'todos';
    abrirModal('Productos', '<div id="vistaListaProd"><div class="uso-base" id="usoBase">Revisando espacio usado…</div>' +
      '<div class="barra-acciones"><input id="buscaProdAdm" type="search" placeholder="Buscar producto…" aria-label="Buscar producto">' +
      '<button class="btn btn-rojo btn-chico" type="button" id="btnNuevoProd">＋ Nuevo producto</button></div>' +
      '<div class="filtros" id="filtrosProdAdm">' +
        '<button class="chip activo" data-v="todos">Todos <b class="n"></b></button>' +
        '<button class="chip" data-v="si">Disponibles <b class="n"></b></button>' +
        '<button class="chip" data-v="no">Agotados <b class="n"></b></button></div>' +
      '<ul class="lista-prod-adm" id="listaProdAdm"><li class="vacio">Cargando productos…</li></ul>' +
      '<p class="nota">Toca el nombre de un producto para cambiar su nombre, precio o foto. La <b>estación</b> ordena los productos en la comanda impresa (línea de armado). Los cambios llegan solos a todos los equipos en unos segundos.</p></div>' +
      '<div id="vistaFormProd" hidden></div>',
      '<button class="btn btn-navy" data-cerrar>Listo</button>', true);
    S.modalNoBloquea = true;
    S.repintarPanel = function () { if ($('#listaProdAdm')) pintar(); if (form && form.repintarFoto) form.repintarFoto(); };
    var form = null;     // producto que se está creando o editando

    function recargarLista() {
      return api('productosTodos', {}, { silencioso: true }).then(function (r) { lista = r.productos; pintar(); });
    }

    function abrirForm(p) {
      var nuevo = !p;
      form = { id: nuevo ? null : p.id, nombre: nuevo ? '' : p.nombre, precio: nuevo ? '' : String(p.precio),
               grupo: nuevo ? null : p.grupo, activo: nuevo ? true : p.activo, foto: nuevo ? '' : (p.foto || ''),
               datos: null, url: null, guardando: false };
      $('#vistaListaProd').hidden = true;
      var v = $('#vistaFormProd'); v.hidden = false;
      var max = Math.max(6, lista.reduce(function (m, x) { return Math.max(m, Number(x.grupo) || 0); }, 0));
      var nombres = CFG.ESTACIONES || {}, ops = '<option value="">Sin estación</option>';
      for (var g = 1; g <= max; g++) ops += '<option value="' + g + '"' + (Number(form.grupo) === g ? ' selected' : '') + '>Estación ' + g + (nombres[g] ? ' · ' + esc(nombres[g]) : '') + '</option>';
      v.innerHTML = '<h4 class="form-prod-titulo">' + (nuevo ? 'Nuevo producto' : 'Editar producto') + '</h4>' +
        '<div class="form-prod tarjeta">' +
          '<div class="foto-prev" id="fotoPrev"><span>Sin foto</span></div>' +
          '<div class="foto-acciones">' +
            '<label class="btn btn-azul btn-chico">📷 Subir foto<input type="file" id="fotoArchivo" accept="image/*" hidden></label>' +
            '<button class="btn btn-borde btn-chico" type="button" id="btnFotoEnlace">🔗 Enlace de Drive</button>' +
          '</div>' +
          '<label class="campo" id="campoEnlace" hidden><span>Enlace de la foto <small>(Google Drive: Compartir → "Cualquier persona con el enlace")</small></span>' +
            '<input id="fotoUrl" placeholder="https://drive.google.com/file/d/…"></label>' +
          '<label class="campo"><span>Nombre *</span><input id="prodNombre" maxlength="40" value="' + esc(form.nombre) + '" placeholder="Ej: Empanada"></label>' +
          '<div class="form-prod-fila">' +
            '<label class="campo"><span>Precio *</span><input id="prodPrecio" inputmode="numeric" maxlength="9" value="' + esc(form.precio) + '" placeholder="Ej: 1500"></label>' +
            '<label class="campo"><span>Estación</span><select id="prodGrupo">' + ops + '</select></label>' +
          '</div>' +
          '<label class="check-linea"><input type="checkbox" id="prodActivo"' + (form.activo ? ' checked' : '') + '> Disponible para vender</label>' +
          '<p class="error" id="errProd"></p>' +
          '<div class="acciones"><button class="btn btn-borde" type="button" id="btnVolverProd">Volver</button>' +
          '<button class="btn btn-rojo" type="button" id="btnGuardarProd">' + (nuevo ? 'Crear producto' : 'Guardar cambios') + '</button></div>' +
        '</div>';
      form.repintarFoto = function () {
        var u = form.datos || (form.url ? miniatura(form.url, 480) : Fotos.url({ id: form.id, foto: form.foto }, 480));
        var pv = $('#fotoPrev'); if (!pv) return;
        pv.style.backgroundImage = u ? 'url("' + u.replace(/"/g, '%22') + '")' : '';
        pv.classList.toggle('con-foto', !!u);
      };
      form.repintarFoto();
      $('#prodNombre').focus();
    }

    function cerrarForm() {
      form = null;
      $('#vistaFormProd').hidden = true; $('#vistaFormProd').innerHTML = '';
      $('#vistaListaProd').hidden = false;
    }

    function guardarForm() {
      if (!form || form.guardando) return;
      var err = $('#errProd'); err.textContent = '';
      var nombre = $('#prodNombre').value.trim(), precio = $('#prodPrecio').value.replace(/[$.\s]/g, '');
      if (nombre.length < 2) { err.textContent = 'Escribe el nombre del producto.'; return $('#prodNombre').focus(); }
      if (!/^\d{1,7}$/.test(precio) || Number(precio) < 1) { err.textContent = 'Escribe un precio válido (número entero, por ejemplo 1500).'; return $('#prodPrecio').focus(); }
      var datos = { nombre: nombre, precio: Number(precio), grupo: $('#prodGrupo').value === '' ? null : Number($('#prodGrupo').value),
                    activo: $('#prodActivo').checked };
      if (form.id) datos.id = form.id;
      if (form.datos) datos.foto = { datos: form.datos };
      else if (form.url) datos.foto = { url: form.url };
      var nuevo = !form.id, subida = form.datos;
      form.guardando = true;
      var b = $('#btnGuardarProd'); b.disabled = true; b.textContent = 'Guardando…';
      api('productoGuardar', datos, { silencioso: true }).then(function (r) {
        if (subida) Fotos.guardar(r.id, r.foto, subida);       // ya la tenemos: no se vuelve a descargar
        toast((nuevo ? 'Producto creado: ' : 'Producto actualizado: ') + r.nombre + ' ✔', 'ok');
        cerrarForm();
        recargarLista().catch(function () {});
        cargarProductos(false).catch(function () {});
      }).catch(function (e) {
        if (!form) return;
        form.guardando = false; b.disabled = false; b.textContent = nuevo ? 'Crear producto' : 'Guardar cambios';
        err.textContent = e.message;
      });
    }

    // Selector de estación (grupo): ordena los productos en la comanda impresa.
    function selEstacion(p) {
      var max = Math.max(6, lista.reduce(function (m, x) { return Math.max(m, Number(x.grupo) || 0); }, 0));
      var nombres = CFG.ESTACIONES || {};
      var ops = '<option value="">Sin estación</option>';
      for (var g = 1; g <= max; g++) {
        ops += '<option value="' + g + '"' + (Number(p.grupo) === g ? ' selected' : '') + '>Estación ' + g + (nombres[g] ? ' · ' + esc(nombres[g]) : '') + '</option>';
      }
      return '<select class="sel-estacion" data-grupo-prod="' + p.id + '" aria-label="Estación de ' + esc(p.nombre) + '"' + (p.guardando ? ' disabled' : '') + '>' + ops + '</select>';
    }

    function pintar() {
      var qn = norm(q);
      var nSi = lista.filter(function (p) { return p.activo; }).length;
      var cuentas = { todos: lista.length, si: nSi, no: lista.length - nSi };
      $$('#filtrosProdAdm .chip').forEach(function (c) {
        c.classList.toggle('activo', c.dataset.v === ver);
        c.querySelector('.n').textContent = '(' + cuentas[c.dataset.v] + ')';
      });
      var vis = lista.filter(function (p) {
        if (ver === 'si' && !p.activo) return false;
        if (ver === 'no' && p.activo) return false;
        return !qn || norm(p.nombre).indexOf(qn) >= 0;
      });
      $('#listaProdAdm').innerHTML = vis.length ? vis.map(function (p) {
        return '<li class="prod-fila' + (p.activo ? '' : ' agotado') + (p.guardando ? ' guardando-fila' : '') + '" data-id="' + p.id + '">' +
          '<span class="prod-mini"' + estiloFoto(p, 120) + '></span>' +
          '<button type="button" class="prod-dato" data-editar="' + p.id + '" title="Editar nombre, precio o foto"><b>' + esc(p.nombre) + ' <i class="lapiz">✏️</i></b><small>' + plata(p.precio) + (p.guardando ? ' · guardando…' : '') + '</small></button>' +
          selEstacion(p) +
          '<label class="interruptor" title="' + (p.activo ? 'Marcar como agotado' : 'Marcar como disponible') + '">' +
            '<input type="checkbox" data-prod="' + p.id + '"' + (p.activo ? ' checked' : '') + (p.guardando ? ' disabled' : '') + '>' +
            '<span class="pista"></span><span class="txt">' + (p.activo ? 'Disponible' : 'Agotado') + '</span></label></li>';
      }).join('') : '<li class="vacio">No hay productos en esta vista.</li>';
    }

    recargarLista()
      .catch(function (e) { $('#listaProdAdm').innerHTML = '<li class="vacio">No se pudieron cargar: ' + esc(e.message) + '</li>'; });
    api('uso', {}, { silencioso: true }).then(function (r) {
      if (r.bytes == null) { $('#usoBase').hidden = true; return; }
      var mb = r.bytes / 1048576, lim = r.limite / 1048576, pct = Math.min(100, mb / lim * 100);
      $('#usoBase').innerHTML = '<span>Base de datos: <b>' + mb.toLocaleString('es-CL', { maximumFractionDigits: 1 }) + ' MB</b> de ' + lim + ' MB del plan gratuito (' + pct.toLocaleString('es-CL', { maximumFractionDigits: 1 }) + '%) · ' + r.pedidos + (r.pedidos === 1 ? ' pedido' : ' pedidos') + '</span>' +
        '<span class="uso-barra"><i style="width:' + Math.max(1, pct) + '%"></i></span>';
      $('#usoBase').classList.toggle('alto', pct > 80);
    }).catch(function () { $('#usoBase').hidden = true; });

    var mc = $('#modalCuerpo');
    mc.oninput = function (ev) { if (ev.target.id === 'buscaProdAdm') { q = ev.target.value; pintar(); } };
    mc.onclick = function (ev) {
      var c = ev.target.closest('#filtrosProdAdm .chip'); if (c) { ver = c.dataset.v; pintar(); return; }
      if (ev.target.closest('#btnNuevoProd')) return abrirForm(null);
      var ed = ev.target.closest('[data-editar]');
      if (ed) { var pe = lista.filter(function (x) { return x.id === Number(ed.dataset.editar); })[0]; if (pe) abrirForm(pe); return; }
      if (ev.target.closest('#btnVolverProd')) return cerrarForm();
      if (ev.target.closest('#btnGuardarProd')) return guardarForm();
      if (ev.target.closest('#btnFotoEnlace')) { $('#campoEnlace').hidden = false; $('#fotoUrl').focus(); }
    };
    mc.onchange = function (ev) {
      if (ev.target.id === 'fotoArchivo' && form) {
        var arch = ev.target.files && ev.target.files[0]; if (!arch) return;
        $('#errProd').textContent = 'Preparando foto…';
        achicarFoto(arch).then(function (d) {
          if (!form) return;
          form.datos = d; form.url = null; $('#errProd').textContent = '';
          form.repintarFoto();
        }).catch(function (e) { $('#errProd').textContent = e.message; });
        return;
      }
      if (ev.target.id === 'fotoUrl' && form) {
        var u = enlaceDrive(ev.target.value);
        if (u && !/^https:\/\//.test(u)) { $('#errProd').textContent = 'El enlace debe empezar con https://'; return; }
        form.url = u || null; form.datos = null; ev.target.value = u; $('#errProd').textContent = '';
        form.repintarFoto();
        return;
      }
      var sel = ev.target.closest('select[data-grupo-prod]');
      if (sel) {
        var pid = Number(sel.dataset.grupoProd), nuevo = sel.value === '' ? null : Number(sel.value);
        var pr = lista.filter(function (x) { return x.id === pid; })[0]; if (!pr) return;
        var previo = pr.grupo;
        pr.grupo = nuevo; pr.guardando = true; pintar();
        api('productoGrupo', { id: pid, grupo: nuevo }, { silencioso: true }).then(function (r) {
          pr.guardando = false; pintar();
          toast(r.nombre + ': ' + (r.grupo == null ? 'sin estación' : Impresora.nombreEstacion(r.grupo).toLowerCase().replace(/^estación/, 'estación')) + ' ✔', 'ok');
        }).catch(function (e) {
          pr.grupo = previo; pr.guardando = false; pintar();
          toast('No se pudo cambiar la estación de "' + pr.nombre + '": ' + e.message, 'mal');
        });
        return;
      }
      var inp = ev.target.closest('input[data-prod]'); if (!inp) return;
      var id = Number(inp.dataset.prod), activo = inp.checked;
      var p = lista.filter(function (x) { return x.id === id; })[0]; if (!p) return;
      var antes = p.activo;
      p.activo = activo; p.guardando = true; pintar();
      api('productoActivo', { id: id, activo: activo }, { silencioso: true }).then(function (r) {
        p.guardando = false; pintar();
        toast(r.nombre + (activo ? ': disponible ✔' : ': marcado como AGOTADO'), activo ? 'ok' : '');
        cargarProductos(false).catch(function () {});
      }).catch(function (e) {
        p.activo = antes; p.guardando = false; pintar();
        toast('No se pudo cambiar "' + p.nombre + '": ' + e.message, 'mal');
      });
    };
  }

  /* ================= Usuarios (Administrador) ================= */
  /*
   * Bloquear un alumno impide que entre (como Alumno, Mamá o Papá) y cierra al
   * instante las sesiones que tenga abiertas. Sus pedidos ya hechos no cambian.
   */
  $('#btnUsuariosAdm').addEventListener('click', abrirUsuariosAdmin);

  function abrirUsuariosAdmin() {
    var lista = [], q = '', ver = 'todos';
    abrirModal('Usuarios', '<div class="barra-acciones"><input id="buscaUsr" type="search" placeholder="Buscar alumno…" aria-label="Buscar alumno"></div>' +
      '<div class="filtros" id="filtrosUsr"></div>' +
      '<ul class="lista-prod-adm" id="listaUsr"><li class="vacio">Cargando usuarios…</li></ul>' +
      '<p class="nota">Un alumno bloqueado no puede entrar a la app (ni como Alumno, Mamá o Papá) y, si estaba conectado, sale en unos segundos. Sus pedidos ya hechos no cambian.</p>',
      '<button class="btn btn-navy" data-cerrar>Listo</button>', true);
    S.modalNoBloquea = true;

    function pintar() {
      var cursos = [];
      lista.forEach(function (u) { if (cursos.indexOf(u.curso) < 0) cursos.push(u.curso); });
      var nBloq = lista.filter(function (u) { return u.bloqueado; }).length;
      var chips = [['todos', 'Todos', lista.length]].concat(cursos.map(function (c) {
        return [c, c, lista.filter(function (u) { return u.curso === c; }).length];
      })).concat([['bloq', 'Bloqueados', nBloq]]);
      $('#filtrosUsr').innerHTML = chips.map(function (c) {
        return '<button class="chip' + (ver === c[0] ? ' activo' : '') + '" data-v="' + esc(c[0]) + '">' + esc(c[1]) + ' <b class="n">(' + c[2] + ')</b></button>';
      }).join('');
      var qn = norm(q);
      var vis = lista.filter(function (u) {
        if (ver === 'bloq' && !u.bloqueado) return false;
        if (ver !== 'todos' && ver !== 'bloq' && u.curso !== ver) return false;
        return !qn || norm(u.nombre).indexOf(qn) >= 0;
      });
      $('#listaUsr').innerHTML = vis.length ? vis.map(function (u) {
        var yo = S.usuario && u.id === S.usuario.id;
        return '<li class="prod-fila usr-fila' + (u.bloqueado ? ' agotado' : '') + (u.guardando ? ' guardando-fila' : '') + '">' +
          '<span class="usr-ini">' + esc(u.nombre.split(' ').map(function (x) { return x[0]; }).join('').slice(0, 2)) + '</span>' +
          '<span class="prod-dato"><b>' + esc(u.nombre) + (yo ? ' (tú)' : '') + '</b><small>' + esc(u.curso) + ' · ' + u.pedidos + (u.pedidos === 1 ? ' pedido' : ' pedidos') +
            (u.admin ? ' · <span class="etq-admin">Admin</span>' : '') +
            (u.frenado && !u.bloqueado ? ' · <button type="button" class="link-liberar" data-liberar="' + u.id + '">⚠️ trabado por intentos: liberar</button>' : '') + '</small></span>' +
          '<label class="interruptor" title="' + (yo ? 'No puedes bloquearte a ti mismo' : (u.bloqueado ? 'Desbloquear' : 'Bloquear')) + '">' +
            '<input type="checkbox" data-usr="' + u.id + '"' + (u.bloqueado ? '' : ' checked') + (yo || u.guardando ? ' disabled' : '') + '>' +
            '<span class="pista"></span><span class="txt">' + (u.bloqueado ? 'Bloqueado' : 'Habilitado') + '</span></label></li>';
      }).join('') : '<li class="vacio">No hay usuarios en esta vista.</li>';
    }

    function cambiar(u, bloquear) {
      var antes = u.bloqueado;
      u.bloqueado = bloquear; u.guardando = true; pintar();
      return api('usuarioBloqueo', { id: u.id, bloqueado: bloquear }, { silencioso: true }).then(function (r) {
        u.guardando = false; u.frenado = false; pintar();
        toast(r.nombre + (bloquear ? ': BLOQUEADO' : ': habilitado ✔'), bloquear ? '' : 'ok');
      }).catch(function (e) {
        u.bloqueado = antes; u.guardando = false; pintar();
        toast('No se pudo cambiar a ' + u.nombre + ': ' + e.message, 'mal');
      });
    }

    api('usuariosTodos', {}, { silencioso: true }).then(function (r) { lista = r.usuarios; pintar(); })
      .catch(function (e) { $('#listaUsr').innerHTML = '<li class="vacio">No se pudieron cargar: ' + esc(e.message) + '</li>'; });

    var mc = $('#modalCuerpo');
    mc.oninput = function (ev) { if (ev.target.id === 'buscaUsr') { q = ev.target.value; pintar(); } };
    mc.onclick = function (ev) {
      var c = ev.target.closest('#filtrosUsr .chip'); if (c) { ver = c.dataset.v; pintar(); return; }
      var lb = ev.target.closest('[data-liberar]');
      if (lb) { var ul = lista.filter(function (x) { return x.id === Number(lb.dataset.liberar); })[0]; if (ul) cambiar(ul, false); }
    };
    mc.onchange = function (ev) {
      var inp = ev.target.closest('input[data-usr]'); if (!inp) return;
      var u = lista.filter(function (x) { return x.id === Number(inp.dataset.usr); })[0]; if (!u) return;
      var bloquear = !inp.checked;
      if (bloquear && !confirm('¿Bloquear a ' + u.nombre + '?\nNo podrá entrar (ni como Alumno, Mamá o Papá) y se cerrará su sesión si está conectado.')) {
        inp.checked = true; return;
      }
      cambiar(u, bloquear);
    };
  }

  /* ================= Impresora ================= */

  $('#btnImpresora').addEventListener('click', abrirImpresora);

  function abrirImpresora() {
    function cuerpo() {
      var c = Impresora.config(), e = Impresora.estado();
      var modos = [['navegador', 'Instalada en el equipo (driver)'], ['usb', 'USB directo'], ['serial', 'Puerto serie / COM'], ['bluetooth', 'Bluetooth']];
      return '<div class="estado-impresora ' + (e.ok ? 'ok' : 'no') + '">' + esc(e.texto) + '</div>' +
        '<div class="campo"><span>Conexión con SPRT POS 58/80</span><div class="chips">' + modos.map(function (m) {
          var dis = !Impresora.soporte(m[0]);
          return '<label title="' + (dis ? 'No disponible en este navegador' : '') + '"><input type="radio" name="modoImp" value="' + m[0] + '"' + (c.modo === m[0] ? ' checked' : '') + (dis ? ' disabled' : '') + '><span' + (dis ? ' style="opacity:.45"' : '') + '>' + m[1] + '</span></label>';
        }).join('') + '</div></div>' +
        '<div class="campo"><span>Ancho de papel</span><div class="chips">' + [58, 80].map(function (w) {
          return '<label><input type="radio" name="papelImp" value="' + w + '"' + (c.papel === w ? ' checked' : '') + '><span>' + w + ' mm</span></label>';
        }).join('') + '</div></div>' +
        (c.modo === 'serial' ? '<label class="campo"><span>Velocidad (baudios)</span><select id="selBaud">' + [9600, 19200, 38400, 115200].map(function (b) {
          return '<option' + (Number(c.baudios) === b ? ' selected' : '') + '>' + b + '</option>';
        }).join('') + '</select></label>' : '') +
        '<p class="nota">' + (c.modo === 'navegador'
          ? 'Instala el driver de la SPRT POS58, déjala como impresora y elige su tamaño de papel. Para imprimir sin diálogo, abre Chrome con <b>--kiosk-printing</b> y deja la SPRT como predeterminada.'
          : 'Conecta la impresora y presiona "Conectar". El navegador mostrará la lista de dispositivos: elige la SPRT POS58. ' +
            (c.modo === 'usb' ? 'En Windows, si la impresora tiene el driver instalado, el modo USB directo puede no tener acceso; en ese caso usa "Instalada en el equipo".' : '')) + '</p>';
    }
    abrirModal('Impresora térmica', cuerpo(),
      '<button class="btn btn-borde" id="btnPruebaImp">Imprimir prueba</button><button class="btn btn-navy" id="btnConectarImp">Conectar</button>');
    var mc = $('#modalCuerpo');
    function repintar() {
      mc.innerHTML = cuerpo();
      $('#btnConectarImp').hidden = Impresora.config().modo === 'navegador';
    }
    repintar();
    mc.onclick = null;
    mc.onchange = function (ev) {
      if (ev.target.name === 'modoImp') Impresora.guardar({ modo: ev.target.value });
      if (ev.target.name === 'papelImp') Impresora.guardar({ papel: Number(ev.target.value) });
      if (ev.target.id === 'selBaud') Impresora.guardar({ baudios: Number(ev.target.value) });
      repintar();
    };
    $('#btnConectarImp').onclick = function () {
      Impresora.conectar().then(function () { toast('Impresora conectada ✔', 'ok'); repintar(); })
        .catch(function (e) { toast('No se conectó: ' + (e.message || e), 'mal'); repintar(); });
    };
    $('#btnPruebaImp').onclick = function () {
      Impresora.prueba().then(function () { repintar(); }).catch(function (e) { toast('Error al imprimir: ' + (e.message || e), 'mal'); });
    };
  }

  /* ================= Modal ================= */

  function abrirModal(titulo, cuerpo, pie, ancha) {
    $('#modalTitulo').textContent = titulo;
    $('#modalCuerpo').innerHTML = cuerpo;
    $('#modalPie').innerHTML = pie;
    $('#modalPie').hidden = !pie && !ancha;
    $('.modal-caja').classList.toggle('ancha', !!ancha);
    $('#modal').hidden = false;
    var f = $('#modal [data-cerrar].btn-x'); if (f) f.focus();
  }
  function cerrarModal() {
    $('#modal').hidden = true;
    S.modalNoBloquea = false;
    S.repintarPanel = null;
    var mc = $('#modalCuerpo'); mc.onclick = null; mc.onchange = null; mc.oninput = null; mc.innerHTML = '';
  }
  $('#modal').addEventListener('click', function (ev) { if (ev.target.closest('[data-cerrar]')) cerrarModal(); });
  document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' && !$('#modal').hidden) cerrarModal(); });

  /* ================= Arranque ================= */

  var ses = leerSesion();
  // Conexión anticipada con Supabase (ahorra tiempo en la primera llamada)
  if (CONFIGURADO) {
    try {
      var pre = document.createElement('link');
      pre.rel = 'preconnect'; pre.href = String(CFG.SUPABASE_URL).replace(/\/+$/, ''); pre.crossOrigin = '';
      document.head.appendChild(pre);
    } catch (e) {}
  }
  if (ses && ses.token && CONFIGURADO) {
    S.token = ses.token; S.usuario = ses.usuario;
    entrar();
    iniciarLoginSilencioso();
  } else {
    iniciarLogin();
  }
  // Precarga cursos por si la sesión guardada expiró y hay que volver al ingreso.
  function iniciarLoginSilencioso() {
    api('inicio', {}, { silencioso: true }).then(function (r) {
      $('#selCurso').innerHTML = '<option value="">Elige tu curso</option>' + r.cursos.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('');
      $('#tiposUsuario').innerHTML = r.tiposUsuario.map(function (t, i) {
        return '<label><input type="radio" name="tipoUsuario" value="' + esc(t) + '"' + (i === 0 ? ' checked' : '') + '><span>' + esc(t) + '</span></label>';
      }).join('');
    }).catch(function () {});
  }
})();
