const express = require("express");
const pool = require("../db/pool");
const requireAuth = require("../middleware/requireAuth");
const { normalizarMatriz } = require("../db/matriz");

const router = express.Router();
router.use(requireAuth);

/* Una "muestra" es un modelo/prenda con sus tallas y colores y sus versiones (iteraciones).
   Puede existir sola (sin pedido) y vincularse después a un pedido; un pedido puede tener varias. */

function isoHoy(){ return new Date().toISOString().slice(0, 10); }
const pedidosRoutes = () => require("./pedidos"); // se carga tarde para evitar dependencia circular

function filaVersion(v){
  return {
    id: v.id, muestraId: v.muestra_id, version: v.version, estado: v.estado, fecha: v.fecha, responsable: v.responsable,
    cambiosSolicitados: v.cambios_solicitados, comentariosCliente: v.comentarios_cliente, fotos: v.fotos,
    aprobadoPor: v.aprobado_por, aprobadoEn: v.aprobado_en, tallaAprobada: v.talla_aprobada, materiales: v.materiales
  };
}
function resumenEstado(vs){
  const vivas = vs.filter(v => v.estado !== "Anulada");
  if(!vivas.length) return "Anulada";
  if(vivas.some(v => v.estado === "Aprobada")) return "Aprobada";
  const ult = vivas[vivas.length - 1];
  return ult.estado;
}
function filaMuestra(m, versiones){
  const vs = (versiones || []).map(filaVersion);
  const unidades = (m.matriz || []).reduce((s, t) => s + (t.colores || []).reduce((a, c) => a + (Number(c.cant) || 0), 0), 0);
  return {
    id: m.id, cliente: m.cliente, titulo: m.titulo, matriz: m.matriz || [], unidades,
    pedidoId: m.pedido_id || null, creadoEn: m.created_at, estado: resumenEstado(vs), versiones: vs
  };
}
async function cargar(db, ids){
  const ms = ids ? await db.query("SELECT * FROM muestras WHERE id = ANY($1) ORDER BY id DESC", [ids]) : await db.query("SELECT * FROM muestras ORDER BY id DESC");
  if(!ms.rows.length) return [];
  const vs = await db.query("SELECT * FROM pedido_muestras WHERE muestra_id = ANY($1) ORDER BY version ASC", [ms.rows.map(m => m.id)]);
  const por = {}; vs.rows.forEach(v => (por[v.muestra_id] ||= []).push(v));
  return ms.rows.map(m => filaMuestra(m, por[m.id]));
}
async function una(db, id){ const r = await cargar(db, [id]); return r[0] || null; }

async function respuesta(db, muestraId, pedidoIds){
  const { pedidoCompleto } = pedidosRoutes();
  const muestra = await una(db, muestraId);
  const peds = {};
  for(const pid of [...new Set((pedidoIds || []).filter(Boolean))]) peds[pid] = await pedidoCompleto(db, pid);
  return { muestra, pedidos: peds };
}
async function hist(db, req, pedidoId, texto, d){ if(pedidoId) await pedidosRoutes().histDet(db, req, pedidoId, texto, d); }

const CAMPOS_VERSION = (b) => ({
  responsable: String(b.responsable || "").trim(), cambios: String(b.cambiosSolicitados || "").trim(), comentarios: String(b.comentariosCliente || "").trim(),
  talla: String(b.tallaAprobada || "").trim(), materiales: String(b.materiales || "").trim(), fotos: Array.isArray(b.fotos) ? b.fotos.slice(0, 6) : []
});
async function insertarVersion(db, muestraId, b){
  const n = (await db.query("SELECT COALESCE(MAX(version),0)+1 AS n FROM pedido_muestras WHERE muestra_id = $1", [muestraId])).rows[0].n;
  const c = CAMPOS_VERSION(b);
  await db.query(
    `INSERT INTO pedido_muestras (muestra_id,version,estado,fecha,responsable,cambios_solicitados,comentarios_cliente,fotos,talla_aprobada,materiales)
     VALUES ($1,$2,'Pendiente',$3,$4,$5,$6,$7,$8,$9)`,
    [muestraId, n, isoHoy(), c.responsable, c.cambios, c.comentarios, JSON.stringify(c.fotos), c.talla, c.materiales]);
  return n;
}

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
      const p = (await client.query("SELECT id, cliente FROM pedidos WHERE id = $1", [b.pedidoId])).rows[0];
      if(!p){ await client.query("ROLLBACK"); return res.status(404).json({ error:"Pedido no encontrado." }); }
      pedidoId = p.id; if(!cliente) cliente = p.cliente;
    }
    if(!cliente){ await client.query("ROLLBACK"); return res.status(400).json({ error:"Indica el cliente de la muestra." }); }
    const m = (await client.query("INSERT INTO muestras (cliente,titulo,matriz,pedido_id,created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id",
      [cliente, titulo, JSON.stringify(normalizarMatriz(b.matriz)), pedidoId, req.session.userId])).rows[0];
    await insertarVersion(client, m.id, b);
    await hist(client, req, pedidoId, "Muestra «"+titulo+"» agregada al pedido", { tipo:"muestra" });
    await client.query("COMMIT");
    res.status(201).json(await respuesta(pool, m.id, [pedidoId]));
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
  await hist(pool, req, cur.pedido_id, "Muestra «"+titulo+"» editada", { tipo:"muestra_edicion" });
  res.json(await respuesta(pool, cur.id, [cur.pedido_id]));
});

/* nueva iteración del mismo modelo */
router.post("/:id/versiones", async (req, res) => {
  const cur = (await pool.query("SELECT * FROM muestras WHERE id = $1", [req.params.id])).rows[0];
  if(!cur) return res.status(404).json({ error:"Muestra no encontrada." });
  const client = await pool.connect();
  try{
    await client.query("BEGIN");
    const n = await insertarVersion(client, cur.id, req.body || {});
    await hist(client, req, cur.pedido_id, "Muestra «"+cur.titulo+"» · versión "+n+" registrada", { tipo:"muestra" });
    await client.query("COMMIT");
    res.status(201).json(await respuesta(pool, cur.id, [cur.pedido_id]));
  } catch(err){ await client.query("ROLLBACK"); console.error(err); res.status(500).json({ error:"No se pudo registrar la versión." }); }
  finally { client.release(); }
});

/* vincular un modelo existente a un pedido (o soltarlo) */
router.post("/:id/vincular", async (req, res) => {
  const cur = (await pool.query("SELECT * FROM muestras WHERE id = $1", [req.params.id])).rows[0];
  if(!cur) return res.status(404).json({ error:"Muestra no encontrada." });
  const pid = req.body && req.body.pedidoId;
  const p = (await pool.query("SELECT id FROM pedidos WHERE id = $1", [pid])).rows[0];
  if(!p) return res.status(404).json({ error:"Pedido no encontrado." });
  if(cur.pedido_id === p.id) return res.json(await respuesta(pool, cur.id, [p.id]));
  if(cur.pedido_id) return res.status(409).json({ error:"Esta muestra ya está en el pedido "+cur.pedido_id+". Quítala de ahí primero." });
  await pool.query("UPDATE muestras SET pedido_id = $1 WHERE id = $2", [p.id, cur.id]);
  await hist(pool, req, p.id, "Muestra «"+cur.titulo+"» vinculada al pedido", { tipo:"muestra" });
  res.json(await respuesta(pool, cur.id, [p.id]));
});

router.post("/:id/desvincular", async (req, res) => {
  const cur = (await pool.query("SELECT * FROM muestras WHERE id = $1", [req.params.id])).rows[0];
  if(!cur) return res.status(404).json({ error:"Muestra no encontrada." });
  if(!cur.pedido_id) return res.json(await respuesta(pool, cur.id, []));
  await pool.query("UPDATE muestras SET pedido_id = NULL WHERE id = $1", [cur.id]);
  await hist(pool, req, cur.pedido_id, "Muestra «"+cur.titulo+"» quitada del pedido", { tipo:"muestra" });
  res.json(await respuesta(pool, cur.id, [cur.pedido_id]));
});

/* ---- versiones ---- */
async function versionYModelo(vid){
  const v = (await pool.query("SELECT * FROM pedido_muestras WHERE id = $1", [vid])).rows[0];
  if(!v) return {};
  const m = (await pool.query("SELECT * FROM muestras WHERE id = $1", [v.muestra_id])).rows[0];
  return { v, m };
}

router.patch("/versiones/:vid", async (req, res) => {
  const b = req.body || {};
  const { v, m } = await versionYModelo(req.params.vid);
  if(!v) return res.status(404).json({ error:"Versión no encontrada." });
  if(v.estado === "Anulada") return res.status(409).json({ error:"Esta versión está anulada y no se puede editar." });
  const nuevo = {
    responsable: b.responsable != null ? String(b.responsable).trim() : v.responsable,
    talla_aprobada: b.tallaAprobada != null ? String(b.tallaAprobada).trim() : v.talla_aprobada,
    materiales: b.materiales != null ? String(b.materiales).trim() : v.materiales,
    cambios_solicitados: b.cambiosSolicitados != null ? String(b.cambiosSolicitados).trim() : v.cambios_solicitados,
    comentarios_cliente: b.comentariosCliente != null ? String(b.comentariosCliente).trim() : v.comentarios_cliente
  };
  const etiquetas = { responsable:"responsable", talla_aprobada:"talla", materiales:"materiales", cambios_solicitados:"cambios solicitados", comentarios_cliente:"observaciones" };
  const cambiados = Object.keys(nuevo).filter(k => nuevo[k] !== v[k]);
  if(cambiados.length){
    await pool.query("UPDATE pedido_muestras SET responsable=$1, talla_aprobada=$2, materiales=$3, cambios_solicitados=$4, comentarios_cliente=$5 WHERE id=$6",
      [nuevo.responsable, nuevo.talla_aprobada, nuevo.materiales, nuevo.cambios_solicitados, nuevo.comentarios_cliente, v.id]);
    await hist(pool, req, m.pedido_id, "Muestra «"+m.titulo+"» v"+v.version+" editada ("+cambiados.map(k => etiquetas[k]).join(", ")+")", { tipo:"muestra_edicion" });
  }
  res.json(await respuesta(pool, m.id, [m.pedido_id]));
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
  await hist(pool, req, m.pedido_id, "Muestra «"+m.titulo+"» v"+v.version+" → "+nuevo+(nuevo === "Aprobada" ? " (versión final)" : ""), { tipo:"muestra", anterior:"Pendiente", nuevo });
  res.json(await respuesta(pool, m.id, [m.pedido_id]));
});

router.post("/versiones/:vid/anular", async (req, res) => {
  const { v, m } = await versionYModelo(req.params.vid);
  if(!v) return res.status(404).json({ error:"Versión no encontrada." });
  if(v.estado === "Anulada") return res.status(409).json({ error:"Esta versión ya está anulada." });
  await pool.query("UPDATE pedido_muestras SET estado='Anulada' WHERE id = $1", [v.id]);
  await hist(pool, req, m.pedido_id, "Muestra «"+m.titulo+"» v"+v.version+" anulada (antes: "+v.estado+")", { tipo:"muestra_anulada", anterior:v.estado, nuevo:"Anulada" });
  res.json(await respuesta(pool, m.id, [m.pedido_id]));
});

module.exports = router;
