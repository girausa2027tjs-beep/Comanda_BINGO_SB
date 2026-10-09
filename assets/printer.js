/*
 * Impresión de tickets para la SPRT POS 58 / 80 mm (impresora térmica ESC/POS).
 *
 * Modos:
 *  - navegador : la impresora instalada en el sistema con su driver.
 *                Se abre el diálogo de impresión con un ticket de 58/80 mm.
 *                (En Chrome con --kiosk-printing imprime sin diálogo.)
 *  - usb       : envía ESC/POS directo por WebUSB (Chrome/Edge, Android).
 *  - serial    : envía ESC/POS por Web Serial (puerto COM / USB-serial).
 *  - bluetooth : envía ESC/POS por Web Bluetooth (modelos BT, Chrome Android/PC).
 * Los modos directos permiten imprimir el número en tamaño gigante sin diálogo.
 */
(function () {
  'use strict';

  var CLAVE = 'comandas_impresora';
  var defecto = (window.APP_CONFIG && window.APP_CONFIG.IMPRESORA) || { modo: 'navegador', papel: 58, baudios: 9600, codepage: 2 };
  var cfg = Object.assign({}, defecto, leer());
  var disp = null;        // dispositivo/puerto abierto
  var escribir = null;    // función(Uint8Array) → Promise

  // UUID de servicios BLE habituales en impresoras térmicas chinas (SPRT, Xprinter, etc.)
  var BLE_SERVICIOS = [
    '000018f0-0000-1000-8000-00805f9b34fb',
    'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
    '49535343-fe7d-4ae5-8fa9-9fafd205e455',
    '0000ff00-0000-1000-8000-00805f9b34fb',
    '0000fee7-0000-1000-8000-00805f9b34fb'
  ];

  function leer() { try { return JSON.parse(localStorage.getItem(CLAVE) || '{}'); } catch (e) { return {}; } }
  function guardar(nuevo) {
    var cambioModo = nuevo.modo && nuevo.modo !== cfg.modo;
    cfg = Object.assign({}, cfg, nuevo);
    cfg.papel = Number(cfg.papel) === 80 ? 80 : 58;
    try { localStorage.setItem(CLAVE, JSON.stringify(cfg)); } catch (e) { /* sin almacenamiento */ }
    if (cambioModo) desconectar();
  }

  function soporte(modo) {
    if (modo === 'usb') return !!navigator.usb;
    if (modo === 'serial') return !!navigator.serial;
    if (modo === 'bluetooth') return !!navigator.bluetooth;
    return true;
  }

  function estado() {
    if (cfg.modo === 'navegador') return { ok: true, texto: 'Usa la impresora instalada en este equipo (diálogo de impresión).' };
    if (!soporte(cfg.modo)) return { ok: false, texto: 'Este navegador no soporta el modo ' + cfg.modo + '. Usa Chrome o Edge.' };
    return escribir ? { ok: true, texto: 'Impresora conectada (' + cfg.modo + ').' } : { ok: false, texto: 'Impresora no conectada. Presiona "Conectar".' };
  }

  /* ---------------- Conexión ---------------- */

  function conectar(pedirNueva) {
    if (cfg.modo === 'usb') return conectarUSB(pedirNueva);
    if (cfg.modo === 'serial') return conectarSerial(pedirNueva);
    if (cfg.modo === 'bluetooth') return conectarBLE();
    return Promise.resolve();
  }

  async function conectarUSB(pedirNueva) {
    if (!navigator.usb) throw new Error('WebUSB no disponible en este navegador.');
    var d = null;
    if (!pedirNueva) { var ya = await navigator.usb.getDevices(); d = ya[0] || null; }
    if (!d) d = await navigator.usb.requestDevice({ filters: [] });
    await d.open();
    if (d.configuration === null) await d.selectConfiguration(1);
    var elegido = null;
    d.configuration.interfaces.forEach(function (itf) {
      itf.alternates.forEach(function (alt) {
        if (elegido) return;
        var ep = alt.endpoints.filter(function (e) { return e.direction === 'out'; })[0];
        if (ep) elegido = { itf: itf.interfaceNumber, alt: alt.alternateSetting, ep: ep.endpointNumber, clase: alt.interfaceClass };
      });
    });
    if (!elegido) throw new Error('No encontré una salida de datos en el dispositivo USB.');
    await d.claimInterface(elegido.itf);
    try { await d.selectAlternateInterface(elegido.itf, elegido.alt); } catch (e) { /* opcional */ }
    disp = d;
    escribir = async function (bytes) {
      for (var i = 0; i < bytes.length; i += 4096) await d.transferOut(elegido.ep, bytes.slice(i, i + 4096));
    };
  }

  async function conectarSerial(pedirNueva) {
    if (!navigator.serial) throw new Error('Web Serial no disponible en este navegador.');
    var p = null;
    if (!pedirNueva) { var ya = await navigator.serial.getPorts(); p = ya[0] || null; }
    if (!p) p = await navigator.serial.requestPort();
    await p.open({ baudRate: Number(cfg.baudios) || 9600 });
    disp = p;
    escribir = async function (bytes) {
      var w = p.writable.getWriter();
      try { await w.write(bytes); } finally { w.releaseLock(); }
    };
  }

  async function conectarBLE() {
    if (!navigator.bluetooth) throw new Error('Web Bluetooth no disponible en este navegador.');
    var d = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: BLE_SERVICIOS });
    var gatt = await d.gatt.connect();
    var car = null;
    var servicios = await gatt.getPrimaryServices();
    for (var s = 0; s < servicios.length && !car; s++) {
      var cs = await servicios[s].getCharacteristics();
      for (var c = 0; c < cs.length; c++) {
        if (cs[c].properties.write || cs[c].properties.writeWithoutResponse) { car = cs[c]; break; }
      }
    }
    if (!car) throw new Error('La impresora Bluetooth no expone un canal de escritura conocido.');
    disp = d;
    d.addEventListener('gattserverdisconnected', function () { escribir = null; });
    escribir = async function (bytes) {
      for (var i = 0; i < bytes.length; i += 180) {
        var trozo = bytes.slice(i, i + 180);
        if (car.properties.writeWithoutResponse && car.writeValueWithoutResponse) await car.writeValueWithoutResponse(trozo);
        else await car.writeValue(trozo);
        await new Promise(function (r) { setTimeout(r, 25); });
      }
    };
  }

  function desconectar() {
    try {
      if (disp && disp.close) disp.close();
      if (disp && disp.gatt && disp.gatt.connected) disp.gatt.disconnect();
    } catch (e) { /* nada */ }
    disp = null; escribir = null;
  }

  /* ---------------- Ticket ESC/POS ---------------- */

  var CP850 = {
    'á': 0xA0, 'é': 0x82, 'í': 0xA1, 'ó': 0xA2, 'ú': 0xA3, 'ñ': 0xA4, 'Ñ': 0xA5,
    'Á': 0xB5, 'É': 0x90, 'Í': 0xD6, 'Ó': 0xE0, 'Ú': 0xE9, 'ü': 0x81, 'Ü': 0x9A,
    '¿': 0xA8, '¡': 0xAD, 'º': 0xA7, '°': 0xF8, '$': 0x24
  };

  function Esc() { this.b = []; }
  Esc.prototype.raw = function () { for (var i = 0; i < arguments.length; i++) this.b.push(arguments[i]); return this; };
  Esc.prototype.txt = function (s) {
    s = String(s == null ? '' : s);
    for (var i = 0; i < s.length; i++) {
      var ch = s[i], code = ch.charCodeAt(0);
      if (CP850[ch] !== undefined) this.b.push(CP850[ch]);
      else if (code < 128) this.b.push(code);
      else this.b.push(sinTilde(ch).charCodeAt(0) < 128 ? sinTilde(ch).charCodeAt(0) : 0x3F);
    }
    return this;
  };
  Esc.prototype.ln = function (s) { return this.txt(s || '').raw(0x0A); };
  Esc.prototype.alin = function (n) { return this.raw(0x1B, 0x61, n); };           // 0 izq, 1 centro, 2 der
  Esc.prototype.negrita = function (on) { return this.raw(0x1B, 0x45, on ? 1 : 0); };
  Esc.prototype.tam = function (ancho, alto) { return this.raw(0x1D, 0x21, ((ancho - 1) << 4) | (alto - 1)); };
  Esc.prototype.bytes = function () { return new Uint8Array(this.b); };

  function sinTilde(s) { return s.normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  function plata(n) { return '$' + Math.round(Number(n) || 0).toLocaleString('es-CL'); }
  function ancho() { return cfg.papel === 80 ? 48 : 32; }

  function partir(texto, max) {
    var palabras = String(texto || '').split(/\s+/), lineas = [], act = '';
    palabras.forEach(function (p) {
      while (p.length > max) { if (act) { lineas.push(act); act = ''; } lineas.push(p.slice(0, max)); p = p.slice(max); }
      if (!p) return;
      if ((act + ' ' + p).trim().length > max) { lineas.push(act); act = p; } else act = (act + ' ' + p).trim();
    });
    if (act) lineas.push(act);
    return lineas.length ? lineas : [''];
  }

  function fila(izq, der, w) {
    izq = String(izq); der = String(der);
    var esp = w - der.length - 1;
    var ls = partir(izq, esp);
    var out = [];
    ls.forEach(function (l, i) {
      out.push(i === ls.length - 1 ? l + ' '.repeat(Math.max(1, w - l.length - der.length)) + der : l);
    });
    return out;
  }

  /*
   * Estaciones (columna grupo del producto): la comanda se imprime ordenada por
   * estación para armar el pedido como en una línea de ensamblaje.
   * Devuelve [{ titulo, items }]. Si ningún producto tiene estación, un solo
   * bloque sin título.
   */
  function nombreEstacion(g) {
    if (g == null || g === '') return 'SIN ESTACIÓN';
    var nombres = (window.APP_CONFIG && window.APP_CONFIG.ESTACIONES) || {};
    return 'ESTACIÓN ' + g + (nombres[g] ? ' · ' + String(nombres[g]).toUpperCase() : '');
  }
  function porEstacion(items) {
    var lista = (items || []).slice();
    var hay = lista.some(function (it) { return it.grupo != null && it.grupo !== ''; });
    if (!hay) return [{ titulo: null, items: lista }];
    // orden estable: estación ascendente, sin estación al final
    lista = lista.map(function (it, i) { return { it: it, i: i }; }).sort(function (a, b) {
      var ga = a.it.grupo == null || a.it.grupo === '' ? 1e9 : Number(a.it.grupo);
      var gb = b.it.grupo == null || b.it.grupo === '' ? 1e9 : Number(b.it.grupo);
      return ga - gb || a.i - b.i;
    }).map(function (x) { return x.it; });
    var bloques = [];
    lista.forEach(function (it) {
      var t = nombreEstacion(it.grupo);
      if (!bloques.length || bloques[bloques.length - 1].titulo !== t) bloques.push({ titulo: t, items: [] });
      bloques[bloques.length - 1].items.push(it);
    });
    return bloques;
  }

  function ticketEscPos(p, opts) {
    var w = ancho(), t = window.APP_CONFIG || {};
    var e = new Esc();
    e.raw(0x1B, 0x40);                                  // reset
    e.raw(0x1B, 0x74, Number(cfg.codepage) || 2);        // tabla de caracteres
    e.alin(1).negrita(true).ln(t.TICKET_TITULO || 'COMANDA').negrita(false);
    if (t.TICKET_SUBTITULO) e.ln(t.TICKET_SUBTITULO);
    e.ln('-'.repeat(w));
    e.negrita(true).ln('PEDIDO');
    e.tam(4, 4).ln('#' + p.numero);
    e.tam(1, 1).ln('');
    e.tam(3, 3).ln('MESA ' + p.mesa);
    e.tam(2, 2);
    partir(p.cliente, Math.floor(w / 2)).forEach(function (l) { e.ln(l); });
    e.tam(1, 1).negrita(false);
    if (p.comentario) {
      e.alin(0).ln('-'.repeat(w)).negrita(true).tam(1, 2);
      partir('NOTA: ' + p.comentario, w).forEach(function (l) { e.ln(l); });
      e.tam(1, 1).negrita(false).ln('-'.repeat(w)).alin(1);
    }
    e.ln(p.fecha + '  ' + p.hora);
    e.ln('Vende: ' + p.usuario + (p.tipoUsuario && p.tipoUsuario !== 'Alumno' ? ' (' + p.tipoUsuario + ')' : ''));
    e.ln('Pago: ' + p.tipoVenta);
    e.alin(0).ln('-'.repeat(w));
    porEstacion(p.items).forEach(function (bq, i) {
      if (bq.titulo) {
        if (i > 0) e.ln('');
        var tt = ' ' + bq.titulo + ' ';
        var lado = Math.max(1, Math.floor((w - tt.length) / 2));
        e.alin(0).negrita(true).ln(('='.repeat(lado) + tt + '='.repeat(w)).slice(0, w)).negrita(false);
      }
      bq.items.forEach(function (it) {
        e.negrita(true).tam(1, 2);
        fila(it.cantidad + ' x ' + it.nombre, plata(it.subtotal), w).forEach(function (l) { e.ln(l); });
        e.tam(1, 1).negrita(false);
      });
    });
    e.ln('-'.repeat(w));
    e.negrita(true).tam(2, 2);
    var tt = 'TOTAL ' + plata(p.total);
    e.alin(2).ln(tt.length * 2 > w ? plata(p.total) : tt);
    e.tam(1, 1).negrita(false).alin(1);
    if (opts && opts.reimpresion) e.ln('').negrita(true).ln('*** REIMPRESION ***').negrita(false);
    e.ln('Impreso ' + new Date().toLocaleTimeString('es-CL', { hour12: false }));
    e.raw(0x0A, 0x0A, 0x0A, 0x0A);
    e.raw(0x1D, 0x56, 0x42, 0x00);                      // corte (si tiene cortador)
    return e.bytes();
  }

  /* ---------------- Ticket HTML (modo navegador y vista previa) ---------------- */

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function htmlTicket(p, opts) {
    var t = window.APP_CONFIG || {};
    var filas = porEstacion(p.items).map(function (bq) {
      return (bq.titulo ? '<tr><td colspan="2" class="estacion">' + esc(bq.titulo) + '</td></tr>' : '') +
        bq.items.map(function (it) {
          return '<tr><td class="b it">' + it.cantidad + ' x ' + esc(it.nombre) + '</td><td class="r">' + plata(it.subtotal) + '</td></tr>';
        }).join('');
    }).join('');
    return '<div class="ticket' + (cfg.papel === 80 ? ' p80' : '') + '">' +
      '<div class="c b">' + esc(t.TICKET_TITULO || 'COMANDA') + '</div>' +
      (t.TICKET_SUBTITULO ? '<div class="c">' + esc(t.TICKET_SUBTITULO) + '</div>' : '') +
      '<div class="sep"></div>' +
      '<div class="c b">PEDIDO</div>' +
      '<div class="c num">#' + esc(p.numero) + '</div>' +
      '<div class="c mesa">MESA ' + esc(p.mesa) + '</div>' +
      '<div class="c cli">' + esc(p.cliente) + '</div>' +
      (p.comentario ? '<div class="nota-t">NOTA: ' + esc(p.comentario) + '</div>' : '') +
      '<div class="c">' + esc(p.fecha) + ' ' + esc(p.hora) + '</div>' +
      '<div class="c">Vende: ' + esc(p.usuario) + (p.tipoUsuario && p.tipoUsuario !== 'Alumno' ? ' (' + esc(p.tipoUsuario) + ')' : '') + '</div>' +
      '<div class="c">Pago: ' + esc(p.tipoVenta) + '</div>' +
      '<div class="sep"></div><table>' + filas + '</table><div class="sep"></div>' +
      '<table><tr><td class="tot">TOTAL</td><td class="r tot">' + plata(p.total) + '</td></tr></table>' +
      (opts && opts.reimpresion ? '<div class="c b reimp">*** REIMPRESIÓN ***</div>' : '') +
      '</div>';
  }

  function imprimirNavegador(p, opts) {
    var cont = document.getElementById('ticketImpresion');
    cont.innerHTML = htmlTicket(p, opts);
    var st = document.getElementById('estiloPapel');
    if (!st) { st = document.createElement('style'); st.id = 'estiloPapel'; document.head.appendChild(st); }
    st.textContent = '@media print { @page { size: ' + cfg.papel + 'mm auto; margin: 0; } }';
    return new Promise(function (res) {
      setTimeout(function () { window.print(); res(); }, 60);
    });
  }

  async function imprimir(p, opts) {
    if (cfg.modo === 'navegador') return imprimirNavegador(p, opts);
    if (!escribir) await conectar(false);
    try {
      await escribir(ticketEscPos(p, opts));
    } catch (err) {
      // reintento único reconectando (la impresora pudo apagarse o dormirse)
      desconectar();
      await conectar(false);
      await escribir(ticketEscPos(p, opts));
    }
  }

  function prueba() {
    return imprimir({
      numero: 0, mesa: '0', cliente: 'Prueba de impresión ñ á é í ó ú', fecha: new Date().toLocaleDateString('es-CL'),
      hora: new Date().toLocaleTimeString('es-CL', { hour12: false }), usuario: 'Sistema', tipoUsuario: '', tipoVenta: 'Efectivo',
      items: [{ cantidad: 2, nombre: 'Producto de ejemplo', subtotal: 2000 }], total: 2000
    }, {});
  }

  window.Impresora = {
    config: function () { return Object.assign({}, cfg); },
    guardar: guardar,
    soporte: soporte,
    estado: estado,
    conectar: function () { desconectar(); return conectar(true); },
    imprimir: imprimir,
    prueba: prueba,
    htmlTicket: htmlTicket,
    porEstacion: porEstacion,
    nombreEstacion: nombreEstacion,
    _escpos: ticketEscPos
  };
})();
