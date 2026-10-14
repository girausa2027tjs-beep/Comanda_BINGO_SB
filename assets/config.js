// Configuración de la app de comandas (versión Supabase).
// En Supabase: Project Settings → API (o "API Keys").
window.APP_CONFIG = {
  // Project URL, por ejemplo: 'https://abcdefghijkl.supabase.co'
  SUPABASE_URL: 'https://vkkkrkngailgiwnqgxbg.supabase.co',

  // Clave PÚBLICA: "Publishable key" (sb_publishable_…) o la antigua "anon public".
  // ¡Nunca pongas aquí la "secret" ni la "service_role"!
  SUPABASE_KEY: 'sb_publishable_wo1J4TcRrvLdMdBhDIh9tA_jHiAb-XP',

  // Cada cuántos segundos se revisa si hay cambios (consulta muy liviana).
  // Sin movimiento se va espaciando hasta REFRESCO_MAX_SEGUNDOS (cuida el plan gratuito).
  REFRESCO_SEGUNDOS: 4,
  REFRESCO_MAX_SEGUNDOS: 20,

  // Nombres opcionales de las estaciones (columna "grupo" del producto).
  // La comanda impresa agrupa los productos por estación, en este orden.
  // Ejemplo: ESTACIONES: { 1: 'Dulces', 2: 'Fritos', 3: 'Bebidas' },
  ESTACIONES: {},

  // Encabezado del ticket impreso.
  TICKET_TITULO: 'GIRA USA MONKEYS',
  TICKET_SUBTITULO: 'TJSS - Generacion 2028',

  // Valores iniciales de la impresora (cada equipo puede cambiarlos
  // desde el botón "Impresora"; se recuerdan en ese navegador).
  IMPRESORA: {
    modo: 'navegador',   // navegador | usb | serial | bluetooth
    papel: 58,           // 58 u 80 (mm)
    baudios: 9600,       // solo modo serial
    codepage: 2          // ESC t n → 2 = PC850 (tildes y ñ)
  }
};
