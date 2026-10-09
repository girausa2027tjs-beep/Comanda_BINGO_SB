# Comandas · Gira USA Monkeys — Instalación desde cero

Tiempo aproximado: 30 minutos. Necesitas tu proyecto de Supabase (ya creado) y una cuenta de GitHub.

## Qué hay en esta carpeta
| Archivo | Para qué |
|---|---|
| `supabase/1_estructura.sql` | Crea las tablas, la seguridad y toda la lógica. |
| `supabase/2_datos.sql` | Carga los 63 alumnos, los tipos de usuario y los 29 productos de la planilla. |
| `supabase/3_pedidos_de_prueba.sql` | **Opcional.** Los 7 pedidos de prueba de la planilla. No hace falta. |
| `supabase/extra_borrar_todos_los_pedidos.sql` | Deja los pedidos en cero antes del evento (con seguro). |
| `index.html` y carpeta `assets/` | La página que se publica en GitHub Pages. |

⚠️ **La carpeta `supabase/` NO se sube a GitHub**: `2_datos.sql` contiene los segundos apellidos, que son las contraseñas.

---

## Parte A · Base de datos en Supabase

> **¿Ya ejecutaste `1_estructura.sql` antes?** Vuelve a ejecutarlo con esta versión nueva (es seguro:
> agrega lo nuevo y no borra nada). No hace falta repetir `2_datos.sql`.

**1. Crear la estructura**
1. Entra a supabase.com y abre tu proyecto.
2. Menú izquierdo → **SQL Editor** → **New query**.
3. Abre `supabase/1_estructura.sql` con el Bloc de notas, selecciona todo (Ctrl+A), copia y pega en Supabase.
4. Presiona **Run**. Debe decir **"Success. No rows returned"**.

**2. Cargar alumnos y productos**
1. **New query** → pega todo `supabase/2_datos.sql` → **Run**.
2. Abajo aparece una tablita: `producto 29`, `usuario 63`, `administradores 0`.

**3. (Opcional) Pedidos de prueba de la planilla:** solo si quieres conservarlos, ejecuta
`supabase/3_pedidos_de_prueba.sql` igual que los anteriores. Si no, sáltate este paso.

**4. Elegir administradores**
1. Busca el `id_usuario` de cada administrador: menú **Table Editor** → tabla **usuario**.
2. **SQL Editor → New query**, escribe una línea con los números separados por coma y presiona **Run**.
   Ejemplo para Ema Rodríguez (40) y María Paz Ginouves (17):
   ```sql
   insert into public.administrador values (40), (17) on conflict do nothing;
   ```
   Para quitar uno: `delete from public.administrador where id_usuario = 17;`

---

## Parte B · Conectar la página con Supabase

**5. Copiar la dirección y la clave pública**

*La dirección (Project URL)* — la forma más segura:
1. Con tu proyecto abierto, mira la barra de direcciones del navegador:
   `https://supabase.com/dashboard/project/abcdefghijkl/...`
2. Las letras después de `project/` son el identificador del proyecto (`abcdefghijkl`).
3. Tu Project URL es: `https://abcdefghijkl.supabase.co` (identificador + `.supabase.co`).
   También aparece en **Project Settings → General** como "Project ID".

*La clave pública:*
1. Menú izquierdo, abajo: ícono de engranaje **Project Settings**.
2. Sección **API Keys**.
3. En la pestaña principal copia la **Publishable key** (empieza con `sb_publishable_`).
   Si no aparece, en la pestaña **Legacy API Keys** copia la clave **anon public** (empieza con `eyJ`).

Atajo: el botón **Connect** (arriba, en la página del proyecto) muestra juntas la URL y la clave pública.

⚠️ Nunca uses la **Secret key** ni la **service_role**: esas dan acceso total a todo.

**6. Pegarlas en `assets/config.js`** (ábrelo con el Bloc de notas):
```js
SUPABASE_URL: 'https://abcdefghijkl.supabase.co',
SUPABASE_KEY: 'pega-aquí-la-clave-pública',
```
Opcional, en el mismo archivo, nombres para las estaciones (salen en la comanda impresa):
```js
ESTACIONES: { 1: 'Dulces', 2: 'Bebidas', 3: 'Plancha' },
```
Guarda el archivo.

---

## Parte C · Publicar en GitHub Pages

**7. Crear el repositorio**
1. En github.com → **New repository** → nombre, por ejemplo `comandas` → **Public** → **Create repository**.
2. Clic en **uploading an existing file**.
3. Arrastra **`index.html`** y la **carpeta `assets`** completa (no la carpeta `supabase`) → **Commit changes**.

**8. Activar la página**
1. En el repositorio → **Settings** → **Pages**.
2. En *Branch* elige **main** y **/(root)** → **Save**.
3. Espera 1–2 minutos y recarga: aparece la dirección, por ejemplo `https://tu-usuario.github.io/comandas/`.

Si después cambias `config.js`: en GitHub abre `assets/config.js` → lápiz ✏️ → edita → **Commit changes**.

---

## Parte D · Probar antes del evento

**9. Administrador** (computador con la impresora)
1. Abre la dirección → perfil **Administrador** → tu curso, tu nombre y tu segundo apellido.
2. Botón **🍩 Productos**:
   - Revisa qué está **Disponible / Agotado**.
   - Asigna la **Estación** de cada producto. Hoy solo 4 tienen estación (Alfajor, Rollo de canela y Donut en la 1;
     Sopaipilla en la 2); los demás saldrán al final de la comanda como "SIN ESTACIÓN".
3. Botón **Impresora** → elige cómo está conectada la SPRT POS 58 y el papel (58 mm) → **Imprimir prueba**.

**10. Vendedor** (en un celular)
1. Abre la misma dirección → perfil **Vendedor** → curso, alumno, quién vende (Alumno/Mamá/Papá) y segundo apellido.
2. Crea un pedido de prueba con productos de distintas estaciones y un comentario.
3. En unos segundos aparece solo en la pantalla del Administrador → **🍩 A preparación + imprimir**.
   La comanda sale ordenada por estación.
4. En el celular, **Mis pedidos** → **Marcar entregado**.

**11. Dejar los pedidos en cero** (cuando termines de probar)
1. Abre `supabase/extra_borrar_todos_los_pedidos.sql` y cambia `'NO'` por `'SI'` en la línea marcada con `>>>`.
2. Pégalo en **SQL Editor → New query** → **Run**. Dice cuántos pedidos borró; el próximo será el N° 1.
3. Todos deben volver a ingresar a la app.

---

## Antes de cada evento
- Supabase gratuito **pausa el proyecto tras 7 días sin uso**. Entra al panel: si dice **Paused**, presiona
  **Restore** y espera 1–2 minutos. No se pierden datos.
- Revisa productos agotados y estaciones en **🍩 Productos**.

## Productos: agregar, editar y agotar (Administrador → 🍩 Productos)
- **＋ Nuevo producto:** nombre, precio, estación, disponible y foto.
  - **📷 Subir foto:** desde el celular (puede ser con la cámara) o el computador. La app la achica sola
    (una foto de celular de 1,5 MB queda en ~15–40 KB). Cada equipo la descarga una sola vez.
  - **🔗 Enlace de Drive:** pega el enlace de "Compartir" del archivo (con acceso "Cualquier persona con el
    enlace"); la app lo convierte solo.
- **Editar:** toca el nombre de un producto (✏️) para cambiar nombre, precio, estación o foto.
  Los pedidos ya hechos conservan el precio con que se vendieron.
- **Agotado / Disponible:** interruptor de cada producto. No se borran productos: se marcan agotados.

## Usuarios: bloquear y desbloquear (Administrador → 👥 Usuarios)
- Lista de alumnos por curso, con buscador y filtro **Bloqueados**.
- **Bloquear** a un alumno: no puede entrar (ni como Alumno, Mamá o Papá) y, si está conectado, la app lo
  saca en unos segundos con el aviso "Tu usuario fue bloqueado". Sus pedidos ya hechos no cambian.
- **Desbloquear:** vuelve a poder entrar de inmediato.
- Si alguien se equivocó 8 veces de contraseña aparece "⚠️ trabado por intentos: liberar"; tócalo para que
  pueda volver a intentar sin esperar.
- Un administrador no puede bloquearse a sí mismo.

## Durante el evento
- Los pedidos y cambios aparecen solos en todas las pantallas (cada 4 s con movimiento, hasta 20 s si está quieto).
- Si un producto se acaba: **🍩 Productos** → interruptor en **Agotado**. Desaparece de todos los vendedores en segundos.
- Botones **↻ Actualizar** por si alguien duda de lo que ve.

## Reglas de la app
| Quién | Puede |
|---|---|
| Vendedor | Crear pedidos (mesa y cliente obligatorios, comentario opcional, Efectivo/Transferencia); editar solo en **Creado**; **En preparación → Entregado**; **Eliminar** solo en Creado o En preparación. Ve solo sus pedidos (el Alumno, su Mamá y su Papá tienen listas separadas). |
| Administrador | Ve todos los pedidos con quién vendió; edita productos/cantidades en Creado o En preparación; **Creado → En preparación** + imprime; reimprime; marca productos agotados y asigna estaciones. |

## Plan gratuito de Supabase (500 MB de base, 5 GB de transferencia al mes)
- Las pantallas descargan solo los pedidos que cambiaron; una revisión sin cambios pesa ~90 bytes.
- Fotos desde Google Drive (no gastan Supabase), en tamaño chico.
- Limpieza automática de sesiones y datos de control antiguos.
- El panel **🍩 Productos** muestra cuánto ocupa la base. Transferencia del mes: Supabase → **Usage** → Egress.

## Seguridad
- La clave pública no permite leer ni modificar ninguna tabla: todo pasa por la función `api()`, que valida
  contraseña, sesión (12 h), dueño del pedido, reglas de estados y precios.
- 8 contraseñas fallidas en 10 minutos bloquean a ese alumno unos minutos.
- La contraseña nunca se envía de vuelta al navegador.

## Editar datos a mano (Supabase → Table Editor)
- `producto`: nombre, precio, foto, activo, grupo (= estación). Mejor desde la app (🍩 Productos).
  Las fotos subidas desde la app están en `producto_imagen`.
- `usuario`: alumnos (columna `bloqueado`; mejor desde la app, 👥 Usuarios). `administrador`: quiénes entran como Administrador.
- `pedido`, `detalle_pedido`, `pedido_estado`: historial. Para exportar: **Export → CSV**.
- No edites a mano `numero_pedido` ni borres filas de pedidos: usa la app (eliminar = estado "Eliminado").
