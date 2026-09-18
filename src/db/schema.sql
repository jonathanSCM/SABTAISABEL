-- Santa Isabel — esquema real (Postgres)

CREATE TABLE IF NOT EXISTS usuarios (
  id SERIAL PRIMARY KEY,
  nombre TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  rol TEXT NOT NULL DEFAULT 'operador',
  activo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cotizaciones (
  id TEXT PRIMARY KEY,
  cliente TEXT NOT NULL,
  prenda TEXT NOT NULL,
  obs TEXT NOT NULL DEFAULT '',
  fecha DATE NOT NULL,
  vigencia INT NOT NULL DEFAULT 15,
  estado TEXT NOT NULL DEFAULT 'Borrador',
  img TEXT,
  pedido_id TEXT,
  curva JSONB NOT NULL DEFAULT '[]',
  colores JSONB NOT NULL DEFAULT '[]',
  groups JSONB NOT NULL DEFAULT '[]',
  muestra NUMERIC NOT NULL DEFAULT 0,
  molde NUMERIC NOT NULL DEFAULT 0,
  terms_prod TEXT NOT NULL DEFAULT '',
  terms_muestra TEXT NOT NULL DEFAULT '',
  created_by INT REFERENCES usuarios(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pedidos (
  id TEXT PRIMARY KEY,
  cliente TEXT NOT NULL,
  producto TEXT NOT NULL,
  cantidad INT NOT NULL,
  registro DATE NOT NULL,
  solicitada DATE,
  compromiso DATE NOT NULL,
  estado TEXT NOT NULL DEFAULT 'Preparación',
  prioridad TEXT NOT NULL DEFAULT 'Normal',
  responsable TEXT NOT NULL DEFAULT '',
  etapa TEXT NOT NULL DEFAULT '',
  obs TEXT NOT NULL DEFAULT '',
  origen_cotizacion TEXT REFERENCES cotizaciones(id),
  cotiz_unidades INT,
  created_by INT REFERENCES usuarios(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pedido_historial (
  id SERIAL PRIMARY KEY,
  pedido_id TEXT NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  fecha DATE NOT NULL,
  texto TEXT NOT NULL,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- checklist de preparación: informativo, no bloquea el paso a producción
CREATE TABLE IF NOT EXISTS pedido_checklist (
  id SERIAL PRIMARY KEY,
  pedido_id TEXT NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  item TEXT NOT NULL,
  orden INT NOT NULL,
  hecho BOOLEAN NOT NULL DEFAULT false,
  fecha DATE,
  responsable TEXT NOT NULL DEFAULT '',
  UNIQUE(pedido_id, item)
);

-- muestra versionada: la aprobación de una versión SÍ bloquea el paso a producción
CREATE TABLE IF NOT EXISTS pedido_muestras (
  id SERIAL PRIMARY KEY,
  pedido_id TEXT NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  version INT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'Pendiente',
  fecha DATE NOT NULL,
  responsable TEXT NOT NULL DEFAULT '',
  cambios_solicitados TEXT NOT NULL DEFAULT '',
  comentarios_cliente TEXT NOT NULL DEFAULT '',
  fotos JSONB NOT NULL DEFAULT '[]',
  aprobado_por TEXT,
  aprobado_en TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(pedido_id, version)
);

-- producción por etapa: cada etapa (Corte, Costura, ...) se marca Interno o
-- Tercerizado, con su responsable/proveedor y fechas — informativo, no bloquea
-- transiciones de estado (a diferencia de la muestra).
CREATE TABLE IF NOT EXISTS pedido_produccion (
  id SERIAL PRIMARY KEY,
  pedido_id TEXT NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  etapa TEXT NOT NULL,
  orden INT NOT NULL,
  tipo TEXT NOT NULL DEFAULT 'Interno',
  responsable TEXT NOT NULL DEFAULT '',
  estado TEXT NOT NULL DEFAULT 'Pendiente',
  fecha_prevista DATE,
  fecha_real DATE,
  UNIQUE(pedido_id, etapa)
);

-- guía de entrega: se genera cuando el pedido está Terminado; no es una tabla
-- aparte, solo se recuerda cuándo se generó por primera vez
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS guia_generada_en TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_pedidos_compromiso ON pedidos(compromiso);
CREATE INDEX IF NOT EXISTS idx_pedidos_estado ON pedidos(estado);
CREATE INDEX IF NOT EXISTS idx_pedido_historial_pedido ON pedido_historial(pedido_id);
CREATE INDEX IF NOT EXISTS idx_pedido_checklist_pedido ON pedido_checklist(pedido_id);
CREATE INDEX IF NOT EXISTS idx_pedido_muestras_pedido ON pedido_muestras(pedido_id);
CREATE INDEX IF NOT EXISTS idx_pedido_produccion_pedido ON pedido_produccion(pedido_id);
CREATE INDEX IF NOT EXISTS idx_cotizaciones_estado ON cotizaciones(estado);

-- secuencias para los códigos correlativos PD-0001 / COT-0001
CREATE SEQUENCE IF NOT EXISTS pedido_seq;
CREATE SEQUENCE IF NOT EXISTS cotizacion_seq;

-- tabla de sesiones (connect-pg-simple la usa para persistir el login, no en memoria)
CREATE TABLE IF NOT EXISTS session (
  sid VARCHAR NOT NULL COLLATE "default" PRIMARY KEY,
  sess JSON NOT NULL,
  expire TIMESTAMP(6) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_session_expire ON session(expire);
