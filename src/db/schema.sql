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
-- recepción de insumos: cuánto y cuándo se recibió cada ítem del checklist
-- (pedido explícito del taller: "que se pueda decir se recibieron 250 metros de tela, tal fecha")
ALTER TABLE pedido_checklist ADD COLUMN IF NOT EXISTS cantidad TEXT NOT NULL DEFAULT '';
ALTER TABLE pedido_checklist ADD COLUMN IF NOT EXISTS notas TEXT NOT NULL DEFAULT '';

-- checklist editable y ordenable: el texto ya no depende de una lista fija en código,
-- se guarda por fila (y se puede agregar/renombrar/borrar/reordenar por pedido).
-- "item" sigue existiendo solo para los 6 ítems de fábrica (idempotencia del seed);
-- los ítems que agrega el usuario llevan un valor generado que nunca choca.
ALTER TABLE pedido_checklist ADD COLUMN IF NOT EXISTS label TEXT NOT NULL DEFAULT '';
ALTER TABLE pedido_checklist ALTER COLUMN item DROP NOT NULL;
UPDATE pedido_checklist SET label = CASE item
  WHEN 'tela' THEN 'Tela recibida' WHEN 'avios' THEN 'Avíos disponibles'
  WHEN 'colores' THEN 'Colores confirmados' WHEN 'diseno' THEN 'Diseño aprobado'
  WHEN 'insumos' THEN 'Insumos comprados' WHEN 'info' THEN 'Información completa'
  ELSE label END
WHERE label = '';

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
-- ficha técnica: campos estructurados de la tarjeta que el taller imprime por cada
-- muestra (estilo/talla aprobada/materiales), además de fotos y observaciones libres
ALTER TABLE pedido_muestras ADD COLUMN IF NOT EXISTS talla_aprobada TEXT NOT NULL DEFAULT '';
ALTER TABLE pedido_muestras ADD COLUMN IF NOT EXISTS materiales TEXT NOT NULL DEFAULT '';

-- moldes (patrones): se hacen antes de coser la muestra y se archivan por cliente
-- para reusarlos en pedidos futuros ("hazme lo mismo de nuevo"); no bloquean nada
CREATE TABLE IF NOT EXISTS moldes (
  id SERIAL PRIMARY KEY,
  cliente TEXT NOT NULL,
  prenda TEXT NOT NULL DEFAULT '',
  pedido_id TEXT REFERENCES pedidos(id) ON DELETE SET NULL,
  notas TEXT NOT NULL DEFAULT '',
  fotos JSONB NOT NULL DEFAULT '[]',
  responsable TEXT NOT NULL DEFAULT '',
  created_by INT REFERENCES usuarios(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_moldes_cliente ON moldes(cliente);
CREATE INDEX IF NOT EXISTS idx_moldes_pedido ON moldes(pedido_id);

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
-- instrucciones internas por etapa: texto libre y detallado ("en corte, cortar tal
-- por cual, por cuánto"), editable, para imprimir la hoja de esa sola etapa y
-- entregársela solo a su encargado (sin el resto del pedido)
ALTER TABLE pedido_produccion ADD COLUMN IF NOT EXISTS notas TEXT NOT NULL DEFAULT '';

-- etapas de producción editables y personalizables por pedido: no todas las prendas
-- llevan las mismas etapas, así que se pueden agregar/renombrar/borrar/reordenar
-- igual que el checklist. "etapa" sigue existiendo solo para las 5 de fábrica.
ALTER TABLE pedido_produccion ADD COLUMN IF NOT EXISTS label TEXT NOT NULL DEFAULT '';
ALTER TABLE pedido_produccion ALTER COLUMN etapa DROP NOT NULL;
UPDATE pedido_produccion SET label = CASE etapa
  WHEN 'corte' THEN 'Corte' WHEN 'costura' THEN 'Costura'
  WHEN 'bordado' THEN 'Bordado/Sublimado' WHEN 'acabado' THEN 'Acabado'
  WHEN 'planchado' THEN 'Planchado' ELSE label END
WHERE label = '';

-- guía de entrega: se genera cuando el pedido está Terminado; no es una tabla
-- aparte, solo se recuerda cuándo se generó por primera vez
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS guia_generada_en TIMESTAMPTZ;

-- la muestra es opcional por pedido: si no la requiere, el paso a producción
-- no se bloquea aunque no haya ninguna muestra aprobada
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS requiere_muestra BOOLEAN NOT NULL DEFAULT true;

-- lista de compras (avíos): qué comprar, cuánto y de qué color, para imprimir y
-- entregarle al encargado de compras una hoja aparte. Vive junto a producción,
-- no junto al checklist, porque a veces se compra sobre la marcha durante producción.
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS compras JSONB NOT NULL DEFAULT '[]';

-- desglose del pedido por talla y color (curva), necesario para la orden de corte:
-- Lucho corta contra esto, no contra el total de unidades. Se copia de la cotización
-- al aprobarla; en un pedido creado directo se puede completar a mano.
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS curva JSONB NOT NULL DEFAULT '[]';
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS colores JSONB NOT NULL DEFAULT '[]';

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

-- hojas por etapa: materiales que usa esa etapa y puntos de control (casilleros a
-- marcar al imprimir), además de las instrucciones largas (columna notas)
ALTER TABLE pedido_produccion ADD COLUMN IF NOT EXISTS materiales JSONB NOT NULL DEFAULT '[]';
ALTER TABLE pedido_produccion ADD COLUMN IF NOT EXISTS controles JSONB NOT NULL DEFAULT '[]';

-- fotos de cada etapa. Se guardan aparte (no dentro del JSON del pedido) para que
-- listar pedidos no cargue megas de imágenes; el navegador las pide por URL y las cachea.
CREATE TABLE IF NOT EXISTS pedido_adjuntos (
  id SERIAL PRIMARY KEY,
  pedido_id TEXT NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  etapa_id INT REFERENCES pedido_produccion(id) ON DELETE CASCADE,
  nombre TEXT NOT NULL DEFAULT '',
  leyenda TEXT NOT NULL DEFAULT '',
  mime TEXT NOT NULL,
  bytes BYTEA NOT NULL,
  orden INT NOT NULL DEFAULT 0,
  created_by INT REFERENCES usuarios(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_adjuntos_pedido ON pedido_adjuntos(pedido_id);
CREATE INDEX IF NOT EXISTS idx_adjuntos_etapa ON pedido_adjuntos(etapa_id);

-- trazabilidad: cada cambio guarda quién lo hizo y, cuando aplica, el valor anterior y el nuevo
-- (estado/etapa y responsable). Los registros viejos quedan con usuario vacío ("Sistema").
ALTER TABLE pedido_historial ADD COLUMN IF NOT EXISTS usuario_id INT;
ALTER TABLE pedido_historial ADD COLUMN IF NOT EXISTS usuario TEXT NOT NULL DEFAULT '';
ALTER TABLE pedido_historial ADD COLUMN IF NOT EXISTS tipo TEXT NOT NULL DEFAULT 'nota';
ALTER TABLE pedido_historial ADD COLUMN IF NOT EXISTS etapa TEXT NOT NULL DEFAULT '';
ALTER TABLE pedido_historial ADD COLUMN IF NOT EXISTS anterior TEXT NOT NULL DEFAULT '';
ALTER TABLE pedido_historial ADD COLUMN IF NOT EXISTS nuevo TEXT NOT NULL DEFAULT '';
ALTER TABLE pedido_historial ADD COLUMN IF NOT EXISTS resp_anterior TEXT NOT NULL DEFAULT '';
ALTER TABLE pedido_historial ADD COLUMN IF NOT EXISTS resp_nuevo TEXT NOT NULL DEFAULT '';

-- documentos de referencia del pedido (PDF, imágenes, Word/Excel): forman parte de la
-- ficha técnica única y se consultan desde cada etapa. Comparten tabla con las fotos de
-- etapa: categoria 'foto' (con etapa_id) o 'documento' (sin etapa).
ALTER TABLE pedido_adjuntos ADD COLUMN IF NOT EXISTS categoria TEXT NOT NULL DEFAULT 'foto';

-- matriz talla x color: [{ talla, consumo, colores:[{ color, cant }] }]. Cuando existe es la
-- fuente de verdad; "curva" y "colores" se derivan de ella (totales por talla y por color).
ALTER TABLE cotizaciones ADD COLUMN IF NOT EXISTS matriz JSONB NOT NULL DEFAULT '[]';
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS matriz JSONB NOT NULL DEFAULT '[]';
