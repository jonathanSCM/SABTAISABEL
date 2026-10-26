const express = require("express");
const pool = require("../db/pool");
const requireAuth = require("../middleware/requireAuth");
const requireAdmin = require("../middleware/requireAdmin");
const { normalizarMatriz } = require("../db/matriz");

const router = express.Router();
router.use(requireAuth);
/* el operador no ve nada que venga de cotizaciones: se quitan esos datos de las respuestas */
router.use((req, res, next) => {
  if(req.user && req.user.rol !== "admin"){
    const enviar = res.json.bind(res);
    res.json = body => enviar(JSON.parse(JSON.stringify(body, (k, v) => (k === "origenCotizacion" || k === "cotizUnidades") ? null : v)));
  }
  next();
});

/* Una "muestra" es un modelo/prenda con sus tallas y colores y sus versiones (iteraciones).
   Puede existir sola, y se vincula a uno o varios pedidos (tabla muestra_pedidos). Un pedido también puede tener varias. */

function isoHoy(){ return new Date().toISOString().slice(0, 10); }
const pedidosRoutes = () => require("./pedidos"); // se carga tarde para evitar dependencia circular

function filaVersion(v){
  return {
    id: v.id, muestraId: v.muestra_id, version: v.version, nombre: v.nombre || "", estado: v.estado, fecha: v.fecha, responsable: v.responsable,
    cambiosSolicitados: v.cambios_solicitados, comentariosCliente: v.comentarios_cliente, fotos: v.fotos,
    aprobadoPor: v.aprobado_por, aprobadoEn: v.aprobado_en, tallaAprobada: v.talla_aprobada, materiales: v.materiales
  };
}
function resumenEstado(vs){
  const vivas = vs.filter(v => v.estado !== "Anulada");
  if(!vivas.length) return "Anulada";
  if(vivas.some(v => v.estado === "Aprobada")) return "Aprobada";
  return vivas[vivas.length - 1].estado;
}
function filaMuestra(m, versiones, pedidos){
  const vs = (versiones || []).map(filaVersion);
  const peds = (pedidos || []).map(p => ({ id: p.id, cliente: p.cliente, producto: p.producto, estado: p.estado, referencia: p.referencia || "" }));
  const unidades = (m.matriz || []).reduce((s, t) => s + (t.colores || []).reduce((a, c) => a + (Number(c.cant) || 0), 0), 0);
  return {
    id: m.id, cliente: m.cliente, titulo: m.titulo, matriz: m.matriz || [], unidades,
    pedidos: peds, pedidoId: peds.length ? peds[0].id : null,
    creadoEn: m.created_at, estado: resumenEstado(vs), versiones: vs
  };
}
async function cargar(db, ids){
  const base = "SELECT m.* FROM muestras m WHERE m.eliminado_en IS NULL";
  const ms = ids ? await db.query(base + " AND m.id = ANY($1) ORDER BY m.id DESC", [ids]) : await db.query(base + " ORDER BY m.id DESC");
  if(!ms.rows.length) return [];
  const idsM = ms.rows.map(m => m.id);
  const vs = await db.query("SELECT * FROM pedido_muestras WHERE muestra_id = ANY($1) ORDER BY version ASC", [idsM]);
  const por = {}; vs.rows.forEach(v => (por[v.muestra_id] ||= []).push(v));
  const ps = await db.query(
    `SELECT mp.muestra_id, mp.referencia, p.id, p.cliente, p.producto, p.estado
       FROM muestra_pedidos mp JOIN pedidos p ON p.id = mp.pedido_id AND p.eliminado_en IS NULL
      WHERE mp.muestra_id = ANY($1) ORDER BY mp.created_at`, [idsM]);
  const pedPor = {}; ps.rows.forEach(r => (pedPor[r.muestra_id] ||= []).push(r));
  return ms.rows.map(m => filaMuestra(m, por[m.id], pedPor[m.id]));
}
async function una(db, id){ const r = await cargar(db, [id]); return r[0] || null; }

/* pedidos vigentes (fuera de la papelera) a los que está vinculada una muestra */
async function pedidosDe(db, muestraId){
  const r = await db.query("SELECT p.id FROM muestra_pedidos mp JOIN pedidos p ON p.id = mp.pedido_id AND p.eliminado_en IS NULL WHERE mp.muestra_id = $1", [muestraId]);
  return r.rows.map(x => x.id);
}
async function respuesta(db, muestraId, extra){
  const { pedidoCompleto } = pedidosRoutes();
  const muestra = await una(db, muestraId);
  const ids = [...new Set([...(await pedidosDe(db, muestraId)), ...(extra || [])].filter(Boolean))];
  const peds = {};
  for(const pid of ids) peds[pid] = await pedidoCompleto(db, pid);
  return { muestra, pedidos: peds };
}
/* deja constancia en el historial de cada pedido al que pertenece la muestra */
async function histMuestra(db, req, muestraId, texto, d){
  for(const pid of await pedidosDe(db, muestraId)) await pedidosRoutes().histDet(db, req, pid, texto, d);
}

const CAMPOS_VERSION = (b) => ({
  nombre: String(b.nombre || "").trim(), responsable: String(b.responsable || "").trim(), cambios: String(b.cambiosSolicitados || "").trim(),
  comentarios: String(b.comentariosCliente || "").trim(), talla: String(b.tallaAprobada || "").trim(), materiales: String(b.materiales || "").trim(),
  fotos: Array.isArray(b.fotos) ? b.fotos.slice(0, 6) : []
});
async function insertarVersion(db, muestraId, b){
  const n = (await db.query("SELECT COALESCE(MAX(version),0)+1 AS n FROM pedido_muestras WHERE muestra_id = $1", [muestraId])).rows[0].n;
  const c = CAMPOS_VERSION(b);
  await db.query(
    `INSERT INTO pedido_muestras (muestra_id,version,nombre,estado,fecha,responsable,cambios_solicitados,comentarios_cliente,fotos,talla_aprobada,materiales)
     VALUES ($1,$2,$3,'Pendiente',$4,$5,$6,$7,$8,$9,$10)`,
    [muestraId, n, c.nombre, isoHoy(), c.responsable, c.cambios, c.comentarios, JSON.stringify(c.fotos), c.talla, c.materiales]);
  return n;
}

router.param("id", async (req, res, next, id) => {
  try{
    const r = await pool.query("SELECT eliminado_en FROM muestras WHERE id = $1", [Number(id)]);
    if(r.rows[0] && r.rows[0].eliminado_en) return res.status(404).json({ error:"Muestra no encontrada." });
    next();
  } catch(e){ next(e); }
});

router.get("/", async (req, res) => { res.json(await cargar(pool)); });

/* modelo nuevo (con su primera versión). Con pedidoId queda vinculado a ese pedido. */
router.post("/", async (req, res) => {
  const b = req.body || {};
  const titulo = String(b.titulo || "").trim();
  let cliente = String(b.cliente || "").trim();
  if(!titulo) return res.status(400).json({ error:"Ponle un título a la muestra (por ejemplo, el nombre de la prenda)." });
  const client = await pool.connect();
  try{
    await client.query("BEGIN");
    let pedidoId = null;
    if(b.pedidoId){
      const p = (await client.query("SELECT id, cliente FROM pedidos WHERE id = $1 AND eliminado_en IS NULL", [b.pedidoId])).rows[0];
      if(!p){ await client.query("ROLLBACK"); return res.status(404).json({ error:"Pedido no encontrado." }); }
      pedidoId = p.id; if(!cliente) cliente = p.cliente;
    }
    if(!cliente){ await client.query("ROLLBACK"); return res.status(400).json({ error:"Indica el cliente de la muestra." }); }
    const m = (await client.query("INSERT INTO muestras (cliente,titulo,matriz,created_by) VALUES ($1,$2,$3,$4) RETURNING id",
      [cliente, titulo, JSON.stringify(normalizarMatriz(b.matriz)), req.session.userId])).rows[0];
    await insertarVersion(client, m.id, b);
    if(pedidoId){
      await client.query("INSERT INTO muestra_pedidos (muestra_id, pedido_id, referencia) VALUES ($1,$2,$3)", [m.id, pedidoId, String(b.referencia || "").trim()]);
      await pedidosRoutes().histDet(client, req, pedidoId, "Muestra «"+titulo+"» agregada al pedido", { tipo:"muestra" });
    }
    await client.query("COMMIT");
    res.status(201).json(await respuesta(pool, m.id));
  } catch(err){ await client.query("ROLLBACK"); console.error(err); res.status(500).json({ error:"No se pudo crear la muestra." }); }
  finally { client.release(); }
});

router.patch("/:id", async (req, res) => {
  const b = req.body || {};
  const cur = (await pool.query("SELECT * FROM muestras WHERE id = $1", [req.params.id])).rows[0];
  if(!cur) return res.status(404).json({ error:"Muestra no encontrada." });
  const titulo = b.titulo != null ? String(b.titulo).trim() : cur.titulo;
  const cliente = b.cliente != null ? String(b.cliente).trim() : cur.cliente;
  if(!titulo || !cliente) return res.status(400).json({ error:"El cliente y el título no pueden quedar vacíos." });
  const matriz = b.matriz != null ? normalizarMatriz(b.matriz) : cur.matriz;
  await pool.query("UPDATE muestras SET titulo=$1, cliente=$2, matriz=$3 WHERE id=$4", [titulo, cliente, JSON.stringify(matriz), cur.id]);
  await histMuestra(pool, req, cur.id, "Muestra «"+titulo+"» editada", { tipo:"muestra_edicion" });
  res.json(await respuesta(pool, cur.id));
});

/* nueva iteración del mismo modelo */
router.post("/:id/versiones", async (req, res) => {
  const cur = (await pool.query("SELECT * FROM muestras WHERE id = $1", [req.params.id])).rows[0];
  if(!cur) return res.status(404).json({ error:"Muestra no encontrada." });
  const client = await pool.connect();
  try{
    await client.query("BEGIN");
    const n = await insertarVersion(client, cur.id, req.body || {});
    await histMuestra(client, req, cur.id, "Muestra «"+cur.titulo+"» · versión "+n+" registrada", { tipo:"muestra" });
    await client.query("COMMIT");
    res.status(201).json(await respuesta(pool, cur.id));
  } catch(err){ await client.query("ROLLBACK"); console.error(err); res.status(500).json({ error:"No se pudo registrar la versión." }); }
  finally { client.release(); }
});

/* vincular una muestra a un pedido (puede estar en varios pedidos a la vez) */
router.post("/:id/vincular", async (req, res) => {
  const cur = (await pool.query("SELECT * FROM muestras WHERE id = $1", [req.params.id])).rows[0];
  if(!cur) return res.status(404).json({ error:"Muestra no encontrada." });
  const b = req.body || {};
  const p = (await pool.query("SELECT id FROM pedidos WHERE id = $1 AND eliminado_en IS NULL", [b.pedidoId])).rows[0];
  if(!p) return res.status(404).json({ error:"Pedido no encontrado." });
  const ya = (await pool.query("SELECT 1 FROM muestra_pedidos WHERE muestra_id = $1 AND pedido_id = $2", [cur.id, p.id])).rows[0];
  await pool.query(
    `INSERT INTO muestra_pedidos (muestra_id, pedido_id, referencia) VALUES ($1,$2,$3)
     ON CONFLICT (muestra_id, pedido_id) DO UPDATE SET referencia = CASE WHEN $4 THEN EXCLUDED.referencia ELSE muestra_pedidos.referencia END`,
    [cur.id, p.id, String(b.referencia || "").trim(), b.referencia != null]);
  if(!ya) await pedidosRoutes().histDet(pool, req, p.id, "Muestra «"+cur.titulo+"» vinculada al pedido", { tipo:"muestra" });
  res.json(await respuesta(pool, cur.id, [p.id]));
});

router.post("/:id/desvincular", async (req, res) => {
  const cur = (await pool.query("SELECT * FROM muestras WHERE id = $1", [req.params.id])).rows[0];
  if(!cur) return res.status(404).json({ error:"Muestra no encontrada." });
  let pid = req.body && req.body.pedidoId;
  if(!pid){ const ids = await pedidosDe(pool, cur.id); if(ids.length === 1) pid = ids[0]; }
  if(!pid) return res.status(400).json({ error:"Indica de qué pedido quitar la muestra." });
  const r = await pool.query("DELETE FROM muestra_pedidos WHERE muestra_id = $1 AND pedido_id = $2 RETURNING pedido_id", [cur.id, pid]);
  if(r.rows[0]) await pedidosRoutes().histDet(pool, req, pid, "Muestra «"+cur.titulo+"» quitada del pedido", { tipo:"muestra" });
  res.json(await respuesta(pool, cur.id, [pid]));
});

/* referencia de la muestra dentro de un pedido (editable) */
router.patch("/:id/vinculos/:pedidoId", async (req, res) => {
  const cur = (await pool.query("SELECT * FROM muestras WHERE id = $1", [req.params.id])).rows[0];
  if(!cur) return res.status(404).json({ error:"Muestra no encontrada." });
  const ref = String((req.body && req.body.referencia) || "").trim();
  const r = await pool.query("UPDATE muestra_pedidos SET referencia = $1 WHERE muestra_id = $2 AND pedido_id = $3 RETURNING pedido_id", [ref, cur.id, req.params.pedidoId]);
  if(!r.rows[0]) return res.status(404).json({ error:"Esa muestra no está en ese pedido." });
  res.json(await respuesta(pool, cur.id, [req.params.pedidoId]));
});

/* duplicar: modelo nuevo (por ejemplo, la misma muestra en otro color) que parte de la última versión aprobada */
router.post("/:id/duplicar", async (req, res) => {
  const b = req.body || {};
  const cur = (await pool.query("SELECT * FROM muestras WHERE id = $1", [req.params.id])).rows[0];
  if(!cur) return res.status(404).json({ error:"Muestra no encontrada." });
  const client = await pool.connect();
  try{
    await client.query("BEGIN");
    let pedidoId = null;
    if(b.pedidoId){
      const p = (await client.query("SELECT id FROM pedidos WHERE id = $1 AND eliminado_en IS NULL", [b.pedidoId])).rows[0];
      if(!p){ await client.query("ROLLBACK"); return res.status(404).json({ error:"Pedido no encontrado." }); }
      pedidoId = p.id;
    }
    const titulo = String(b.titulo || "").trim() || "Copia de " + cur.titulo;
    const nuevo = (await client.query("INSERT INTO muestras (cliente,titulo,matriz,created_by) VALUES ($1,$2,$3,$4) RETURNING id",
      [cur.cliente, titulo, JSON.stringify(cur.matriz || []), req.session.userId])).rows[0];
    const vs = (await client.query("SELECT * FROM pedido_muestras WHERE muestra_id = $1 AND estado <> 'Anulada' ORDER BY version", [cur.id])).rows;
    const base = vs.filter(v => v.estado === "Aprobada").slice(-1)[0] || vs.slice(-1)[0];
    await insertarVersion(client, nuevo.id, base ? {
      nombre: "Copia de la versión " + base.version, responsable: base.responsable, tallaAprobada: base.talla_aprobada,
      materiales: base.materiales, fotos: base.fotos, cambiosSolicitados: "", comentariosCliente: ""
    } : {});
    if(pedidoId){
      await client.query("INSERT INTO muestra_pedidos (muestra_id, pedido_id) VALUES ($1,$2)", [nuevo.id, pedidoId]);
      await pedidosRoutes().histDet(client, req, pedidoId, "Muestra «"+titulo+"» agregada al pedido (copia de «"+cur.titulo+"»)", { tipo:"muestra" });
    }
    await client.query("COMMIT");
    res.status(201).json(await respuesta(pool, nuevo.id));
  } catch(err){ await client.query("ROLLBACK"); console.error(err); res.status(500).json({ error:"No se pudo duplicar la muestra." }); }
  finally { client.release(); }
});

/* eliminar una muestra = moverla a la papelera (solo administrador) */
router.delete("/:id", requireAdmin, async (req, res) => {
  const afectados = await pedidosDe(pool, Number(req.params.id));
  const cur = (await pool.query("UPDATE muestras SET eliminado_en = now(), eliminado_por = $2 WHERE id = $1 AND eliminado_en IS NULL RETURNING *", [req.params.id, req.user.nombre])).rows[0];
  if(!cur) return res.status(404).json({ error:"Muestra no encontrada." });
  const { pedidoCompleto, histDet } = pedidosRoutes();
  const peds = {};
  for(const pid of afectados){ await histDet(pool, req, pid, "Muestra «"+cur.titulo+"» movida a la papelera", { tipo:"muestra" }); peds[pid] = await pedidoCompleto(pool, pid); }
  res.json({ ok:true, id:cur.id, pedidos:peds, papelera:true });
});

/* ---- versiones ---- */
async function versionYModelo(vid){
  const v = (await pool.query("SELECT * FROM pedido_muestras WHERE id = $1", [vid])).rows[0];
  if(!v) return {};
  const m = (await pool.query("SELECT * FROM muestras WHERE id = $1 AND eliminado_en IS NULL", [v.muestra_id])).rows[0];
  if(!m) return {};
  return { v, m };
}

router.patch("/versiones/:vid", async (req, res) => {
  const b = req.body || {};
  const { v, m } = await versionYModelo(req.params.vid);
  if(!v) return res.status(404).json({ error:"Versión no encontrada." });
  if(v.estado === "Anulada") return res.status(409).json({ error:"Esta versión está anulada y no se puede editar." });
  const nuevo = {
    nombre: b.nombre != null ? String(b.nombre).trim() : (v.nombre || ""),
    responsable: b.responsable != null ? String(b.responsable).trim() : v.responsable,
    talla_aprobada: b.tallaAprobada != null ? String(b.tallaAprobada).trim() : v.talla_aprobada,
    materiales: b.materiales != null ? String(b.materiales).trim() : v.materiales,
    cambios_solicitados: b.cambiosSolicitados != null ? String(b.cambiosSolicitados).trim() : v.cambios_solicitados,
    comentarios_cliente: b.comentariosCliente != null ? String(b.comentariosCliente).trim() : v.comentarios_cliente
  };
  const etiquetas = { nombre:"nombre", responsable:"responsable", talla_aprobada:"talla", materiales:"materiales", cambios_solicitados:"cambios solicitados", comentarios_cliente:"observaciones" };
  const cambiados = Object.keys(nuevo).filter(k => nuevo[k] !== (v[k] || ""));
  if(cambiados.length){
    await pool.query("UPDATE pedido_muestras SET nombre=$1, responsable=$2, talla_aprobada=$3, materiales=$4, cambios_solicitados=$5, comentarios_cliente=$6 WHERE id=$7",
      [nuevo.nombre, nuevo.responsable, nuevo.talla_aprobada, nuevo.materiales, nuevo.cambios_solicitados, nuevo.comentarios_cliente, v.id]);
    await histMuestra(pool, req, m.id, "Muestra «"+m.titulo+"» v"+v.version+" editada ("+cambiados.map(k => etiquetas[k]).join(", ")+")", { tipo:"muestra_edicion" });
  }
  res.json(await respuesta(pool, m.id));
});

router.patch("/versiones/:vid/estado", async (req, res) => {
  const nuevo = req.body && req.body.estado;
  if(!["Aprobada", "Rechazada"].includes(nuevo)) return res.status(400).json({ error:"Estado de muestra inválido." });
  const { v, m } = await versionYModelo(req.params.vid);
  if(!v) return res.status(404).json({ error:"Versión no encontrada." });
  if(v.estado !== "Pendiente") return res.status(409).json({ error:"Esta versión ya fue "+v.estado.toLowerCase()+"." });
  if(nuevo === "Aprobada"){
    const otra = (await pool.query("SELECT version FROM pedido_muestras WHERE muestra_id=$1 AND estado='Aprobada'", [m.id])).rows[0];
    if(otra) return res.status(409).json({ error:"Este modelo ya tiene una versión final aprobada (versión "+otra.version+")." });
  }
  await pool.query(
    `UPDATE pedido_muestras SET estado=$1, aprobado_por=$2, aprobado_en=CASE WHEN $1='Aprobada' THEN now() ELSE aprobado_en END WHERE id=$3`,
    [nuevo, nuevo === "Aprobada" ? (req.user.nombre || "") : null, v.id]);
  await histMuestra(pool, req, m.id, "Muestra «"+m.titulo+"» v"+v.version+" → "+nuevo+(nuevo === "Aprobada" ? " (versión final)" : ""), { tipo:"muestra", anterior:"Pendiente", nuevo });
  res.json(await respuesta(pool, m.id));
});

router.post("/versiones/:vid/anular", async (req, res) => {
  const { v, m } = await versionYModelo(req.params.vid);
  if(!v) return res.status(404).json({ error:"Versión no encontrada." });
  if(v.estado === "Anulada") return res.status(409).json({ error:"Esta versión ya está anulada." });
  await pool.query("UPDATE pedido_muestras SET estado='Anulada' WHERE id = $1", [v.id]);
  await histMuestra(pool, req, m.id, "Muestra «"+m.titulo+"» v"+v.version+" anulada (antes: "+v.estado+")", { tipo:"muestra_anulada", anterior:v.estado, nuevo:"Anulada" });
  res.json(await respuesta(pool, m.id));
});

module.exports = router;
