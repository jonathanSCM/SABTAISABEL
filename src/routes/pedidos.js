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
    requiereMuestra: row.requiere_muestra,
    curva: row.curva || [], colores: row.colores || [],
    hist: hist || [],
    checklist: (checklist || []).map(c => ({
      id: c.id, item: c.item, label: c.label || CHECKLIST_LABEL[c.item] || c.item, orden: c.orden,
      hecho: c.hecho, fecha: c.fecha, responsable: c.responsable,
      cantidad: c.cantidad, notas: c.notas
    })).sort((a,b) => a.orden - b.orden),
    muestras: (muestras || []).map(m => ({
      version: m.version, estado: m.estado, fecha: m.fecha, responsable: m.responsable,
      cambiosSolicitados: m.cambios_solicitados, comentariosCliente: m.comentarios_cliente,
      fotos: m.fotos, aprobadoPor: m.aprobado_por, aprobadoEn: m.aprobado_en,
      tallaAprobada: m.talla_aprobada, materiales: m.materiales
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
  const c = await client.query("SELECT id, item, label, orden, hecho, fecha, responsable, cantidad, notas FROM pedido_checklist WHERE pedido_id = $1", [id]);
  const m = await client.query("SELECT version, estado, fecha, responsable, cambios_solicitados, comentarios_cliente, fotos, aprobado_por, aprobado_en, talla_aprobada, materiales FROM pedido_muestras WHERE pedido_id = $1 ORDER BY version ASC", [id]);
  const t = await client.query("SELECT etapa, orden, tipo, responsable, estado, fecha_prevista, fecha_real FROM pedido_produccion WHERE pedido_id = $1", [id]);
  return filaPedido(p.rows[0], h.rows, c.rows, m.rows, t.rows);
}

router.get("/", async (req, res) => {
  const pedidos = await pool.query("SELECT * FROM pedidos ORDER BY compromiso ASC");
  const [hist, checklist, muestras, produccion] = await Promise.all([
    pool.query("SELECT pedido_id, fecha, texto, creado_en FROM pedido_historial ORDER BY id ASC"),
    pool.query("SELECT id, pedido_id, item, label, orden, hecho, fecha, responsable, cantidad, notas FROM pedido_checklist"),
    pool.query("SELECT pedido_id, version, estado, fecha, responsable, cambios_solicitados, comentarios_cliente, fotos, aprobado_por, aprobado_en, talla_aprobada, materiales FROM pedido_muestras ORDER BY version ASC"),
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
    const requiereMuestra = b.requiereMuestra !== false; // por defecto Sí, salvo que se pida explícitamente que no
    await client.query(
      `INSERT INTO pedidos (id,cliente,producto,cantidad,registro,solicitada,compromiso,estado,prioridad,responsable,etapa,obs,origen_cotizacion,cotiz_unidades,requiere_muestra,curva,colores,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'Preparación',$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [id, b.cliente, b.producto, Number(b.cantidad), registro, b.solicitada || b.compromiso, b.compromiso,
       b.prioridad || "Normal", b.responsable || "", b.etapa || "", b.obs || "",
       b.origenCotizacion || null, b.cotizUnidades != null ? Number(b.cotizUnidades) : null, requiereMuestra,
       JSON.stringify(Array.isArray(b.curva) ? b.curva : []), JSON.stringify(Array.isArray(b.colores) ? b.colores : []),
       req.session.userId]
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
    const cur = await client.query("SELECT estado, requiere_muestra FROM pedidos WHERE id = $1 FOR UPDATE", [id]);
    if(!cur.rows[0]){ await client.query("ROLLBACK"); return res.status(404).json({ error:"Pedido no encontrado." }); }
    const actualIdx = ESTADOS.indexOf(cur.rows[0].estado);
    const nuevoIdx = ESTADOS.indexOf(nuevo);
    if(Math.abs(actualIdx - nuevoIdx) !== 1){
      await client.query("ROLLBACK");
      return res.status(409).json({ error:"Los estados se avanzan o retroceden de a un paso a la vez, sin saltos." });
    }
    if(nuevo === "En producción" && cur.rows[0].requiere_muestra){
      const aprobada = await client.query("SELECT 1 FROM pedido_muestras WHERE pedido_id = $1 AND estado = 'Aprobada' LIMIT 1", [id]);
      if(!aprobada.rows[0]){
        await client.query("ROLLBACK");
        return res.status(409).json({ error:"Este pedido requiere muestra — no se puede pasar a producción sin una muestra final aprobada." });
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

/* ---- ¿requiere muestra? se puede definir o cambiar en cualquier momento antes de producción ---- */
router.patch("/:id/requiere-muestra", async (req, res) => {
  const { id } = req.params;
  const requiere = !!(req.body && req.body.requiereMuestra);
  const r = await pool.query("UPDATE pedidos SET requiere_muestra = $1, updated_at = now() WHERE id = $2 RETURNING id", [requiere, id]);
  if(!r.rows[0]) return res.status(404).json({ error:"Pedido no encontrado." });
  await pool.query("INSERT INTO pedido_historial (pedido_id,fecha,texto) VALUES ($1,$2,$3)",
    [id, isoHoy(), "¿Requiere muestra? → "+(requiere ? "Sí" : "No")]);
  res.json(await pedidoCompleto(pool, id));
});

/* ---- curva (desglose por talla/color): informativa, la usa la orden de corte ---- */
router.patch("/:id/curva", async (req, res) => {
  const { id } = req.params;
  const b = req.body || {};
  const r = await pool.query(
    "UPDATE pedidos SET curva=$1, colores=$2, updated_at=now() WHERE id=$3 RETURNING id",
    [JSON.stringify(Array.isArray(b.curva) ? b.curva : []), JSON.stringify(Array.isArray(b.colores) ? b.colores : []), id]
  );
  if(!r.rows[0]) return res.status(404).json({ error:"Pedido no encontrado." });
  res.json(await pedidoCompleto(pool, id));
});

/* ---- checklist de preparación: informativo, no bloquea nada ----
   editable y ordenable por el usuario: se agregan/renombran/borran ítems libremente
   y se reordenan con subir/bajar. Se direcciona por el id numérico de la fila, no por
   un slug fijo, porque los ítems que agrega el usuario no tienen un slug conocido. */
router.post("/:id/checklist", async (req, res) => {
  const { id } = req.params;
  const label = (req.body && req.body.label || "").trim();
  if(!label) return res.status(400).json({ error:"El ítem necesita un nombre." });
  const client = await pool.connect();
  try{
    await client.query("BEGIN");
    const ped = await client.query("SELECT id FROM pedidos WHERE id=$1 FOR UPDATE", [id]);
    if(!ped.rows[0]){ await client.query("ROLLBACK"); return res.status(404).json({ error:"Pedido no encontrado." }); }
    const ordenRes = await client.query("SELECT COALESCE(MAX(orden),0)+1 AS n FROM pedido_checklist WHERE pedido_id=$1", [id]);
    await client.query(
      `INSERT INTO pedido_checklist (pedido_id,item,label,orden)
       VALUES ($1, 'custom-'||substr(md5(random()::text),1,10), $2, $3)`,
      [id, label, ordenRes.rows[0].n]
    );
    await client.query("INSERT INTO pedido_historial (pedido_id,fecha,texto) VALUES ($1,$2,$3)",
      [id, isoHoy(), "Checklist: se agregó \""+label+"\""]);
    await client.query("COMMIT");
    res.status(201).json(await pedidoCompleto(pool, id));
  } catch(err){
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error:"No se pudo agregar el ítem." });
  } finally {
    client.release();
  }
});

router.patch("/:id/checklist/:itemId", async (req, res) => {
  const { id, itemId } = req.params;
  const b = req.body || {};
  const client = await pool.connect();
  try{
    await client.query("BEGIN");
    const cur = await client.query("SELECT * FROM pedido_checklist WHERE pedido_id=$1 AND id=$2 FOR UPDATE", [id, itemId]);
    if(!cur.rows[0]){ await client.query("ROLLBACK"); return res.status(404).json({ error:"Ítem no encontrado." }); }
    const actual = cur.rows[0];
    const label = b.label != null ? String(b.label).trim() || actual.label : actual.label;
    const hecho = b.hecho != null ? !!b.hecho : actual.hecho;
    const cantidad = b.cantidad != null ? String(b.cantidad) : actual.cantidad;
    const notas = b.notas != null ? String(b.notas) : actual.notas;
    await client.query(
      `UPDATE pedido_checklist SET label=$1, hecho=$2, fecha=$3, responsable=$4, cantidad=$5, notas=$6
       WHERE pedido_id=$7 AND id=$8`,
      [label, hecho, hecho ? (actual.fecha || isoHoy()) : null, hecho ? (actual.responsable || req.user.nombre || "") : "",
       cantidad, notas, id, itemId]
    );
    if(hecho !== actual.hecho){
      await client.query("INSERT INTO pedido_historial (pedido_id,fecha,texto) VALUES ($1,$2,$3)",
        [id, isoHoy(), "Checklist: "+label+(hecho ? " marcado"+(cantidad ? " ("+cantidad+")" : "") : " desmarcado")]);
    } else if(label !== actual.label){
      await client.query("INSERT INTO pedido_historial (pedido_id,fecha,texto) VALUES ($1,$2,$3)",
        [id, isoHoy(), "Checklist: \""+actual.label+"\" renombrado a \""+label+"\""]);
    }
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

router.delete("/:id/checklist/:itemId", async (req, res) => {
  const { id, itemId } = req.params;
  const client = await pool.connect();
  try{
    await client.query("BEGIN");
    const r = await client.query("DELETE FROM pedido_checklist WHERE pedido_id=$1 AND id=$2 RETURNING label", [id, itemId]);
    if(!r.rows[0]){ await client.query("ROLLBACK"); return res.status(404).json({ error:"Ítem no encontrado." }); }
    await client.query("INSERT INTO pedido_historial (pedido_id,fecha,texto) VALUES ($1,$2,$3)",
      [id, isoHoy(), "Checklist: se quitó \""+r.rows[0].label+"\""]);
    await client.query("COMMIT");
    res.json(await pedidoCompleto(pool, id));
  } catch(err){
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error:"No se pudo quitar el ítem." });
  } finally {
    client.release();
  }
});

/* reordenar: recibe la lista completa de ids del checklist en el orden final */
router.patch("/:id/checklist-orden", async (req, res) => {
  const { id } = req.params;
  const orden = Array.isArray(req.body && req.body.orden) ? req.body.orden : null;
  if(!orden) return res.status(400).json({ error:"Falta el orden." });
  const client = await pool.connect();
  try{
    await client.query("BEGIN");
    for(let i=0;i<orden.length;i++){
      await client.query("UPDATE pedido_checklist SET orden=$1 WHERE pedido_id=$2 AND id=$3", [i+1, id, orden[i]]);
    }
    await client.query("COMMIT");
    res.json(await pedidoCompleto(pool, id));
  } catch(err){
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error:"No se pudo reordenar el checklist." });
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
      `INSERT INTO pedido_muestras (pedido_id,version,estado,fecha,responsable,cambios_solicitados,comentarios_cliente,fotos,talla_aprobada,materiales)
       VALUES ($1,$2,'Pendiente',$3,$4,$5,$6,$7,$8,$9)`,
      [id, version, isoHoy(), b.responsable || "", b.cambiosSolicitados || "", b.comentariosCliente || "", JSON.stringify(fotos),
       b.tallaAprobada || "", b.materiales || ""]
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

/* ---- ficha técnica de la muestra: campos editables aun después de creada
   (estilo/talla/materiales/observaciones), tal como pidió el taller ---- */
router.patch("/:id/muestras/:version/ficha", async (req, res) => {
  const { id, version } = req.params;
  const b = req.body || {};
  const r = await pool.query(
    `UPDATE pedido_muestras SET talla_aprobada=$1, materiales=$2, comentarios_cliente=$3, cambios_solicitados=$4
     WHERE pedido_id=$5 AND version=$6 RETURNING 1`,
    [b.tallaAprobada || "", b.materiales || "", b.comentariosCliente || "", b.cambiosSolicitados || "", id, version]
  );
  if(!r.rowCount) return res.status(404).json({ error:"Muestra no encontrada." });
  res.json(await pedidoCompleto(pool, id));
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

/* ---- moldes (patrones): se archivan por cliente y se reusan en pedidos futuros ---- */
router.get("/:id/moldes", async (req, res) => {
  const ped = await pool.query("SELECT cliente FROM pedidos WHERE id=$1", [req.params.id]);
  if(!ped.rows[0]) return res.status(404).json({ error:"Pedido no encontrado." });
  const r = await pool.query(
    "SELECT id, cliente, prenda, pedido_id, notas, fotos, responsable, created_at FROM moldes WHERE cliente=$1 ORDER BY created_at DESC",
    [ped.rows[0].cliente]
  );
  res.json(r.rows.map(m => ({
    id:m.id, cliente:m.cliente, prenda:m.prenda, pedidoId:m.pedido_id, notas:m.notas,
    fotos:m.fotos, responsable:m.responsable, creadoEn:m.created_at
  })));
});

router.post("/:id/moldes", async (req, res) => {
  const { id } = req.params;
  const b = req.body || {};
  const ped = await pool.query("SELECT cliente, producto FROM pedidos WHERE id=$1", [id]);
  if(!ped.rows[0]) return res.status(404).json({ error:"Pedido no encontrado." });
  const fotos = Array.isArray(b.fotos) ? b.fotos.slice(0,6) : [];
  const r = await pool.query(
    `INSERT INTO moldes (cliente,prenda,pedido_id,notas,fotos,responsable,created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, cliente, prenda, pedido_id, notas, fotos, responsable, created_at`,
    [ped.rows[0].cliente, b.prenda || ped.rows[0].producto, id, b.notas || "", JSON.stringify(fotos), b.responsable || "", req.session.userId]
  );
  await pool.query("INSERT INTO pedido_historial (pedido_id,fecha,texto) VALUES ($1,$2,'Molde archivado')", [id, isoHoy()]);
  const m = r.rows[0];
  res.status(201).json({ id:m.id, cliente:m.cliente, prenda:m.prenda, pedidoId:m.pedido_id, notas:m.notas, fotos:m.fotos, responsable:m.responsable, creadoEn:m.created_at });
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
