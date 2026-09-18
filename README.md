# Santa Isabel — sistema de pedidos y cotizaciones

Aplicación real (no demo): Node.js + Express + PostgreSQL, con usuarios,
contraseñas con hash y datos que persisten de verdad. Reemplaza al prototipo
estático anterior (`../demo-SantaIsabel`), que se dejó intacto como referencia.

## Qué incluye (Sprints 1–4)

- **Pedidos y cotizaciones** con los 4 estados reales (Preparación → En
  producción → Terminado → Entregado), un paso a la vez, sin saltos.
- **Checklist de preparación** (6 ítems, informativo).
- **Muestra versionada**: Pendiente/Aprobada/Rechazada — el pedido **no puede
  pasar a producción sin una muestra final aprobada** (validado en el
  servidor, no solo en la pantalla).
- **Producción por etapa** (Corte, Costura, Bordado/Sublimado, Acabado,
  Planchado): Interno o Tercerizado, responsable/proveedor, fechas.
- **Calendario** con carga por día y por responsable (Disponible / Carga
  normal / Sobrecargado).
- **Alertas accionables**: cada una con su botón (Abrir pedido, Iniciar
  producción, Ver día, Ver semana, Ver cotización).
- **Guía de entrega**: se genera cuando el pedido está Terminado, exportable a
  PDF (imprimir), y habilita "Marcar como entregado".
- **Exportación a CSV** (abre bien en Excel) de Pedidos, Cotizaciones, Esta
  semana y Calendario — siempre respeta los filtros/búsqueda aplicados en
  pantalla.
- **Usuarios y roles** (admin/operador), cambio de contraseña, sesiones reales.

## Arquitectura

- **Backend**: Express (`src/`), sesiones guardadas en Postgres (tabla `session`,
  vía `connect-pg-simple`) — no en memoria, sobreviven a un reinicio del proceso.
- **Base de datos**: PostgreSQL, base `santa_isabel` (separada de cualquier otra
  base que tengas en el mismo servidor Postgres).
- **Autenticación**: contraseñas con `bcrypt`, cookies de sesión `httpOnly`,
  rate-limit en login y cambio de contraseña. Cada request valida contra la
  base que el usuario siga activo (si un admin desactiva a alguien, esa persona
  queda afuera de inmediato, no recién en su próximo login).
- **Roles**: `admin` (gestiona usuarios) y `operador` (uso normal del taller).
- **Frontend**: `public/index.html` — la misma interfaz mobile-first ya
  construida, ahora hablándole a la API en vez de tener los datos en memoria.

## Primeros pasos (desarrollo local)

```bash
npm install
cp .env.example .env   # si no existe .env, copiá los valores de más abajo
npm run db:migrate     # crea/actualiza las tablas (idempotente, se puede correr de nuevo)
npm run db:seed        # usuarios + datos iniciales YA consistentes (checklist, producción,
                        # muestra aprobada y guía según corresponda) — se salta solo si ya hay usuarios
npm run dev            # http://localhost:4000, con reinicio automático al guardar
```

Un `npm run db:migrate && npm run db:seed` contra una base recién creada deja
el sistema 100% funcional de punta a punta — no hace falta ningún paso manual
extra. (Los scripts `src/db/backfill-*.js` son solo para el caso de actualizar
una base que ya tenía pedidos *antes* de que existieran el checklist/muestra/
producción/guía — no se necesitan en una instalación nueva.)

Variables de entorno (`.env`):

```
DATABASE_URL=postgres://usuario:password@localhost:5432/santa_isabel
SESSION_SECRET=algo-largo-y-aleatorio
PORT=4000
NODE_ENV=development
```

### Usuarios sembrados por `db:seed`

Todos con la contraseña `SantaIsabel2026!` — **cambiala** desde "Contraseña" en
la barra lateral apenas entres, o generá contraseñas nuevas desde la pantalla
de Usuarios si sos admin.

| Correo | Rol |
|---|---|
| admin@santaisabel.local | admin |
| marta@santaisabel.local | operador |
| luis@santaisabel.local | operador |
| rosa@santaisabel.local | operador |
| diego@santaisabel.local | operador |
| henry@santaisabel.local | operador |

## Gestión de usuarios

Solo visible para cuentas con rol `admin` (pestaña **Usuarios** en la barra
lateral). Permite:

- Crear usuarios nuevos (nombre, correo, contraseña, rol).
- Desactivar / reactivar cuentas (un admin no puede desactivarse a sí mismo).
- Restablecer la contraseña de cualquier usuario.

Cualquier usuario logueado puede cambiar su propia contraseña desde el botón
**Contraseña** en la barra lateral (pide la contraseña actual).

Todo esto también existe como API si preferís scriptearlo (requiere sesión de
admin): `GET/POST /api/usuarios`, `PATCH /api/usuarios/:id/estado`,
`POST /api/usuarios/:id/resetear-password`.

## Corriendo como proceso administrado

Un `node src/server.js` suelto muere si el proceso revienta o si cierra la
terminal. Para que se reinicie solo y quede logueado, hay dos caminos:

### Opción A — PM2 (sin Docker, en una VM/VPS propia)

```bash
npm install -g pm2
npm run pm2:start     # arranca con ecosystem.config.js, autorestart activado
npm run pm2:logs       # ver logs (o logs/out.log y logs/error.log directo)
npm run pm2:restart
npm run pm2:stop
pm2 save && pm2 startup   # para que sobreviva a un reinicio del servidor
```

`ecosystem.config.js` reinicia el proceso automáticamente si se cae (probado:
matando el proceso a la fuerza, PM2 lo levantó de nuevo en menos de 2s).

### Opción B — Docker / Coolify (recomendado para producción real)

Igual que el demo anterior, pero ahora con la app y su base de datos:

```bash
docker compose up -d --build
```

El `Dockerfile` corre la app con PM2 **adentro** del contenedor (doble capa de
resiliencia: si el proceso Node se cae, PM2 lo reinicia sin que el contenedor
entero se caiga). El entrypoint aplica el esquema de la base automáticamente
al arrancar (`CREATE TABLE IF NOT EXISTS`, seguro de correr muchas veces); el
seed de usuarios de ejemplo **no** se corre automático — es a propósito, para
no meter datos de prueba a un ambiente real. Corré `npm run db:seed` manualmente
la primera vez si querés esos datos, o creá el primer admin a mano.

En Coolify: apuntá el proyecto a este `Dockerfile`, agregá una base Postgres
gestionada por Coolify (o apuntá `DATABASE_URL` a una existente), y dejá que
Coolify/Traefik pongan el certificado HTTPS real (Let's Encrypt) delante —
así es como ya tenías desplegado el demo anterior. La app adentro sigue
hablando por HTTP plano; el proxy de Coolify es quien termina TLS.

### HTTPS sin proxy delante (VPS pelado, sin Coolify)

Si en algún momento corrés esta app sola, expuesta directo a internet sin
Traefik/nginx/Coolify adelante, necesitás que el propio proceso Node hable
HTTPS. `src/server.js` ya lo soporta: si están seteadas `SSL_KEY_PATH` y
`SSL_CERT_PATH`, arranca en HTTPS en vez de HTTP.

Para un certificado real ahí, lo más simple sigue siendo poner Coolify o
Caddy/nginx delante (certificados de Let's Encrypt, renovación automática).
Para pruebas o una red interna, generá uno autofirmado:

```bash
npm run cert:selfsigned
# agrega a tu .env: SSL_KEY_PATH=.../certs/key.pem y SSL_CERT_PATH=.../certs/cert.pem
```

El navegador va a marcar el certificado autofirmado como no confiable — es
esperable, no es un certificado emitido por una autoridad real.

### Nota sobre Windows

El apagado ordenado (`server.js` cierra la conexión a Postgres antes de
salir cuando recibe `SIGTERM`/`SIGINT`) se probó y funciona corriendo la app
en Linux (el contenedor Docker) y con PM2. Corriendo el proceso Node nativo
directo en Windows, las señales POSIX no llegan de forma confiable (limitación
conocida de Node en Windows, no de esta app) — para desarrollo local en
Windows no es un problema (Ctrl+C en la terminal corta igual), pero para un
apagado 100% ordenado en producción, corré esto dentro de un contenedor Linux
(Docker) como se documenta arriba.

## Estructura

```
src/
  app.js                    # Express app: sesión, rutas, estáticos
  server.js                 # arranque HTTP/HTTPS + apagado ordenado
  db/
    schema.sql                # esquema completo (idempotente)
    migrate.js                 # aplica schema.sql
    seed.js                     # usuarios + datos de ejemplo, ya consistentes
                                  # (checklist/producción/muestra/guía según estado)
    checklist.js                 # los 6 ítems fijos del checklist de preparación
    produccion.js                 # las 5 etapas fijas de producción
    backfill-checklist.js          # uso único: solo para bases previas a Sprint 2
    backfill-produccion.js          # uso único: solo para bases previas a Sprint 3
    pool.js                          # pool de Postgres + parseo de fechas
  middleware/
    requireAuth.js            # valida sesión contra la base en cada request
    requireAdmin.js            # exige rol admin (va después de requireAuth)
  routes/
    auth.js                    # login, logout, /me, cambiar mi contraseña
    usuarios.js                 # gestión de usuarios (solo admin)
    pedidos.js                   # pedidos, checklist, muestra, producción, guía, historial
    cotizaciones.js               # cotizaciones + aprobar → crea pedido vinculado
public/
  index.html                # la app (mobile-first)
  login.html                 # pantalla de login
```
