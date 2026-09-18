const express = require("express");
const pool = require("../db/pool");
const requireAuth = require("../middleware/requireAuth");
const { CHECKLIST_ITEMS, CHECKLIST_LABEL, sembrarChecklist } = require("../db/checklist");
const { ETAPAS_PRODUCCION, ETAPA_LABEL, sembrarProduccion } = require("../db/produccion");

const router = express.Router();
const ESTADOS = ["Preparación","En producción","Terminado","Entregado"];

router.use(requireAuth);

function isoHoy(){ const d = new Date(); return d.toISOString().slice(0,10); }

function filaPedido(row, hist, checklist, muestras, produccion){
  return {
    id: row.id, cliente: row.cliente, producto: row.producto, cantidad: row.cantidad,
    registro: row.registro, solicitada: row.solicitada, compromiso: row.compromiso,
    estado: row.estado, prioridad: row.prioridad, responsable: row.responsable, etapa: row.etapa,
    obs: row.obs, origenCotizacion: row.origen_cotizacion,
    cotizUnidades: row.cotiz_unidades != null ? Number(row.cotiz_unidades) : null,
    guiaGeneradaEn: row.guia_generada_en,
    hist: hist || [],
    checklist: (checklist || []).map(c => ({
      item: c.item, label: CHECKLIST_LABEL[c.item] || c.item, orden: c.orden,
      hecho: c.hecho, fecha: c.fecha, responsable: c.responsable
    })).sort((a,b) => a.orden - b.orden),
    muestras: (muestras || []).map(m => ({
      version: m.version, estado: m.estado, fecha: m.fecha, responsable: m.responsable,
      cambiosSolicitados: m.cambios_solicitados, comentariosCliente: m.comentarios_cliente,
      fotos: m.fotos, aprobadoPor: m.aprobado_por, aprobadoEn: m.aprobado_en
    })).sort((a,b) => a.version - b.version),
    produccion: (produccion || []).map(t => ({
      etapa: t.etapa, label: ETAPA_LABEL[t.etapa] || t.etapa, orden: t.orden,
      tipo: t.tipo, responsable: t.responsable, estado: t.estado,
      fechaPrevista: t.fecha_prevista, fechaReal: t.fecha_real
    })).sort((a,b) => a.orden - b.orden)
  };
}

async function pedidoCompleto(client, id){
  const p = await client.query("SELECT * FROM pedidos WHERE id = $1", [id]);
  if(!p.rows[0]) return null;
  const h = await client.query("SELECT fecha, texto, creado_en FROM pedido_historial WHERE pedido_id = $1 ORDER BY id ASC", [id]);
  const c = await client.query("SELECT item, orden, hecho, fecha, responsable FROM pedido_checklist WHERE pedido_id = $1", [id]);
  const m = await client.query("SELECT version, estado, fecha, responsable, cambios_solicitados, comentarios_cliente, fotos, aprobado_por, aprobado_en FROM pedido_muestras WHERE pedido_id = $1 ORDER BY version ASC", [id]);
  const t = await client.query("SELECT etapa, orden, tipo, responsable, estado, fecha_prevista, fecha_real FROM pedido_produccion WHERE pedido_id = $1", [id]);
  return filaPedido(p.rows[0], h.rows, c.rows, m.rows, t.rows);
}

router.get("/", async (req, res) => {
  const pedidos = await pool.query("SELECT * FROM pedidos ORDER BY compromiso ASC");
  const [hist, checklist, muestras, produccion] = await Promise.all([
    pool.query("SELECT pedido_id, fecha, texto, creado_en FROM pedido_historial ORDER BY id ASC"),
    pool.query("SELECT pedido_id, item, orden, hecho, fecha, responsable FROM pedido_checklist"),
    pool.query("SELECT pedido_id, version, estado, fecha, responsable, cambios_solicitados, comentarios_cliente, fotos, aprobado_por, aprobado_en FROM pedido_muestras ORDER BY version ASC"),
    pool.query("SELECT pedido_id, etapa, orden, tipo, responsable, estado, fecha_prevista, fecha_real FROM pedido_produccion")
  ]);
  const porPedido = (rows) => { const m = {}; for(const r of rows) (m[r.pedido_id] ||= []).push(r); return m; };
  const histPorPedido = porPedido(hist.rows);
  const checkPorPedido = porPedido(checklist.rows);
  const muestrasPorPedido = porPedido(muestras.rows);
  const produccionPorPedido = porPedido(produccion.rows);
  res.json(pedidos.rows.map(p => filaPedido(p, histPorPedido[p.id], checkPorPedido[p.id], muestrasPorPedido[p.id], produccionPorPedido[p.id])));
});

router.post("/", async (req, res) => {
  const b = req.body || {};
  if(!b.cliente || !b.producto || !b.cantidad || !b.compromiso){
    return res.status(400).json({ error:"Faltan campos obligatorios (cliente, producto, cantidad, compromiso)." });
  }
  const client = await pool.connect();
  try{
    await client.query("BEGIN");
    const seqRes = await client.query("SELECT nextval('pedido_seq') AS n");
    const id = "PD-"+String(seqRes.rows[0].n).padStart(4,"0");
    const registro = isoHoy();
    await client.query(
      `INSERT INTO pedidos (id,cliente,producto,cantidad,registro,solicitada,compromiso,estado,prioridad,responsable,etapa,obs,origen_cotizacion,cotiz_unidades,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'Preparación',$8,$9,$10,$11,$12,$13,$14)`,
      [id, b.cliente, b.producto, Number(b.cantidad), registro, b.solicitada || b.compromiso, b.compromiso,
       b.prioridad || "Normal", b.responsable || "", b.etapa || "", b.obs || "",
       b.origenCotizacion || null, b.cotizUnidades != null ? Number(b.cotizUnidades) : null, req.session.userId]
    );
    await client.query("INSERT INTO pedido_historial (pedido_id,fecha,texto) VALUES ($1,$2,'Pedido registrado')", [id, registro]);
    await sembrarChecklist(client, id);
    await sembrarProduccion(client, id);
    await client.query("COMMIT");
    res.status(201).json(await pedidoCompleto(pool, id));
  } catch(err){
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error:"No se pudo crear el pedido." });
  } finally {
    client.release();
  }
});

router.patch("/:id/estado", async (req, res) => {
  const { id } = req.params;
  const nuevo = req.body && req.body.estado;
  if(!ESTADOS.includes(nuevo)) return res.status(400).json({ error:"Estado inválido." });

  const client = await pool.connect();
  try{
    await client.query("BEGIN");
    const cur = await client.query("SELECT estado FROM pedidos WHERE id = $1 FOR UPDATE", [id]);
    if(!cur.rows[0]){ await client.query("ROLLBACK"); return res.status(404).json({ error:"Pedido no encontrado." }); }
    const actualIdx = ESTADOS.indexOf(cur.rows[0].estado);
    const nuevoIdx = ESTADOS.indexOf(nuevo);
    if(Math.abs(actualIdx - nuevoIdx) !== 1){
      await client.query("ROLLBACK");
      return res.status(409).json({ error:"Los estados se avanzan o retroceden de a un paso a la vez, sin saltos." });
    }
    if(nuevo === "En producción"){
      const aprobada = await client.query("SELECT 1 FROM pedido_muestras WHERE pedido_id = $1 AND estado = 'Aprobada' LIMIT 1", [id]);
      if(!aprobada.rows[0]){
        await client.query("ROLLBACK");
        return res.status(409).json({ error:"No se puede pasar a producción sin una muestra final aprobada." });
      }
    }
    await client.query("UPDATE pedidos SET estado = $1, updated_at = now() WHERE id = $2", [nuevo, id]);
    await client.query("INSERT INTO pedido_historial (pedido_id,fecha,texto) VALUES ($1,$2,$3)",
      [id, isoHoy(), "Estado → "+nuevo]);
    await client.query("COMMIT");
    res.json(await pedidoCompleto(pool, id));
  } catch(err){
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error:"No se pudo cambiar el estado." });
  } finally {
    client.release();
  }
});

/* ---- checklist de preparación: informativo, no bloquea nada ---- */
router.patch("/:id/checklist/:slug", async (req, res) => {
  const { id, slug } = req.params;
  const hecho = !!(req.body && req.body.hecho);
  const item = CHECKLIST_ITEMS.find(i => i.slug === slug);
  if(!item) return res.status(400).json({ error:"Ítem de checklist inválido." });

  const client = await pool.connect();
  try{
    await client.query("BEGIN");
    const r = await client.query(
      `UPDATE pedido_checklist SET hecho=$1, fecha=$2, responsable=$3 WHERE pedido_id=$4 AND item=$5 RETURNING 1`,
      [hecho, hecho ? isoHoy() : null, hecho ? (req.user.nombre || "") : "", id, slug]
    );
    if(!r.rowCount){ await client.query("ROLLBACK"); return res.status(404).json({ error:"Pedido o ítem no encontrado." }); }
    await client.query("INSERT INTO pedido_historial (pedido_id,fecha,texto) VALUES ($1,$2,$3)",
      [id, isoHoy(), "Checklist: "+item.label+(hecho ? " marcado" : " desmarcado")]);
    await client.query("COMMIT");
    res.json(await pedidoCompleto(pool, id));
  } catch(err){
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error:"No se pudo actualizar el checklist." });
  } finally {
    client.release();
  }
});

/* ---- muestra versionada: aprobar una versión SÍ bloquea/desbloquea el paso a producción ---- */
router.post("/:id/muestras", async (req, res) => {
  const { id } = req.params;
  const b = req.body || {};
  const client = await pool.connect();
  try{
    await client.query("BEGIN");
    const ped = await client.query("SELECT id FROM pedidos WHERE id=$1 FOR UPDATE", [id]);
    if(!ped.rows[0]){ await client.query("ROLLBACK"); return res.status(404).json({ error:"Pedido no encontrado." }); }
    const vRes = await client.query("SELECT COALESCE(MAX(version),0)+1 AS n FROM pedido_muestras WHERE pedido_id=$1", [id]);
    const version = vRes.rows[0].n;
    const fotos = Array.isArray(b.fotos) ? b.fotos.slice(0,6) : [];
    await client.query(
      `INSERT INTO pedido_muestras (pedido_id,version,estado,fecha,responsable,cambios_solicitados,comentarios_cliente,fotos)
       VALUES ($1,$2,'Pendiente',$3,$4,$5,$6,$7)`,
      [id, version, isoHoy(), b.responsable || "", b.cambiosSolicitados || "", b.comentariosCliente || "", JSON.stringify(fotos)]
    );
    await client.query("INSERT INTO pedido_historial (pedido_id,fecha,texto) VALUES ($1,$2,$3)",
      [id, isoHoy(), "Muestra "+version+" registrada"]);
    await client.query("COMMIT");
    res.status(201).json(await pedidoCompleto(pool, id));
  } catch(err){
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error:"No se pudo registrar la muestra." });
  } finally {
    client.release();
  }
});

router.patch("/:id/muestras/:version/estado", async (req, res) => {
  const { id, version } = req.params;
  const nuevo = req.body && req.body.estado;
  if(!["Aprobada","Rechazada"].includes(nuevo)) return res.status(400).json({ error:"Estado de muestra inválido." });

  const client = await pool.connect();
  try{
    await client.query("BEGIN");
    const cur = await client.query("SELECT estado FROM pedido_muestras WHERE pedido_id=$1 AND version=$2 FOR UPDATE", [id, version]);
    if(!cur.rows[0]){ await client.query("ROLLBACK"); return res.status(404).json({ error:"Muestra no encontrada." }); }
    if(cur.rows[0].estado !== "Pendiente"){
      await client.query("ROLLBACK");
      return res.status(409).json({ error:"Esta versión ya fue "+cur.rows[0].estado.toLowerCase()+"." });
    }
    if(nuevo === "Aprobada"){
      const otra = await client.query("SELECT version FROM pedido_muestras WHERE pedido_id=$1 AND estado='Aprobada'", [id]);
      if(otra.rows[0]){
        await client.query("ROLLBACK");
        return res.status(409).json({ error:"Ya hay una muestra final aprobada (versión "+otra.rows[0].version+")." });
      }
    }
    await client.query(
      `UPDATE pedido_muestras SET estado=$1, aprobado_por=$2, aprobado_en=CASE WHEN $1='Aprobada' THEN now() ELSE aprobado_en END
       WHERE pedido_id=$3 AND version=$4`,
      [nuevo, nuevo === "Aprobada" ? (req.user.nombre || "") : null, id, version]
    );
    await client.query("INSERT INTO pedido_historial (pedido_id,fecha,texto) VALUES ($1,$2,$3)",
      [id, isoHoy(), "Muestra "+version+" → "+nuevo+(nuevo==="Aprobada" ? " (muestra final)" : "")]);
    await client.query("COMMIT");
    res.json(await pedidoCompleto(pool, id));
  } catch(err){
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error:"No se pudo actualizar la muestra." });
  } finally {
    client.release();
  }
});

/* ---- producción por etapa: interno/tercerizado, informativo (no bloquea nada) ---- */
const ESTADOS_TAREA = ["Pendiente","En proceso","Completado"];
router.patch("/:id/produccion/:slug", async (req, res) => {
  const { id, slug } = req.params;
  const b = req.body || {};
  const etapa = ETAPAS_PRODUCCION.find(e => e.slug === slug);
  if(!etapa) return res.status(400).json({ error:"Etapa de producción inválida." });
  if(b.tipo && !["Interno","Tercerizado"].includes(b.tipo)) return res.status(400).json({ error:"Tipo inválido." });
  if(b.estado && !ESTADOS_TAREA.includes(b.estado)) return res.status(400).json({ error:"Estado de tarea inválido." });

  const client = await pool.connect();
  try{
    await client.query("BEGIN");
    const cur = await client.query("SELECT * FROM pedido_produccion WHERE pedido_id=$1 AND etapa=$2 FOR UPDATE", [id, slug]);
    if(!cur.rows[0]){ await client.query("ROLLBACK"); return res.status(404).json({ error:"Pedido o etapa no encontrada." }); }
    const actual = cur.rows[0];
    const tipo = b.tipo || actual.tipo;
    const responsable = b.responsable != null ? b.responsable : actual.responsable;
    const estado = b.estado || actual.estado;
    const fechaPrevista = b.fechaPrevista !== undefined ? (b.fechaPrevista || null) : actual.fecha_prevista;
    let fechaReal = b.fechaReal !== undefined ? (b.fechaReal || null) : actual.fecha_real;
    if(estado === "Completado" && !fechaReal) fechaReal = isoHoy();

    await client.query(
      "UPDATE pedido_produccion SET tipo=$1, responsable=$2, estado=$3, fecha_prevista=$4, fecha_real=$5 WHERE pedido_id=$6 AND etapa=$7",
      [tipo, responsable, estado, fechaPrevista, fechaReal, id, slug]
    );
    if(estado !== actual.estado){
      await client.query("INSERT INTO pedido_historial (pedido_id,fecha,texto) VALUES ($1,$2,$3)",
        [id, isoHoy(), "Producción · "+etapa.label+" → "+estado]);
    }
    if(tipo !== actual.tipo || responsable !== actual.responsable){
      await client.query("INSERT INTO pedido_historial (pedido_id,fecha,texto) VALUES ($1,$2,$3)",
        [id, isoHoy(), "Producción · "+etapa.label+": "+tipo+(responsable ? " ("+responsable+")" : "")]);
    }
    await client.query("COMMIT");
    res.json(await pedidoCompleto(pool, id));
  } catch(err){
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error:"No se pudo actualizar la etapa de producción." });
  } finally {
    client.release();
  }
});

/* ---- guía de entrega: se puede generar/reimprimir una vez el pedido está Terminado o Entregado ---- */
router.post("/:id/guia", async (req, res) => {
  const { id } = req.params;
  const client = await pool.connect();
  try{
    await client.query("BEGIN");
    const cur = await client.query("SELECT estado, guia_generada_en FROM pedidos WHERE id=$1 FOR UPDATE", [id]);
    if(!cur.rows[0]){ await client.query("ROLLBACK"); return res.status(404).json({ error:"Pedido no encontrado." }); }
    if(!["Terminado","Entregado"].includes(cur.rows[0].estado)){
      await client.query("ROLLBACK");
      return res.status(409).json({ error:"La guía de entrega se genera recién cuando el pedido está Terminado." });
    }
    const primeraVez = !cur.rows[0].guia_generada_en;
    if(primeraVez){
      await client.query("UPDATE pedidos SET guia_generada_en = now() WHERE id = $1", [id]);
      await client.query("INSERT INTO pedido_historial (pedido_id,fecha,texto) VALUES ($1,$2,'Guía de entrega generada')", [id, isoHoy()]);
    }
    await client.query("COMMIT");
    res.json(await pedidoCompleto(pool, id));
  } catch(err){
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error:"No se pudo generar la guía de entrega." });
  } finally {
    client.release();
  }
});

module.exports = router;
