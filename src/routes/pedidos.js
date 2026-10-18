const express = require("express");
const pool = require("../db/pool");
const requireAuth = require("../middleware/requireAuth");
const { CHECKLIST_ITEMS, CHECKLIST_LABEL, sembrarChecklist } = require("../db/checklist");
const { ETAPAS_PRODUCCION, ETAPA_LABEL, sembrarProduccion } = require("../db/produccion");
const { normalizarMatriz, derivarMatriz } = require("../db/matriz");

const router = express.Router();
const ESTADOS = ["Preparación","En producción","Terminado","Entregado"];

router.use(requireAuth);

function isoHoy(){ const d = new Date(); return d.toISOString().slice(0,10); }

/* registro de trazabilidad: quién, cuándo (creado_en) y, cuando aplica, valor anterior y
   nuevo del estado/etapa y del responsable */
async function histDet(db, req, pedidoId, texto, d){
  d = d || {};
  await db.query(
    `INSERT INTO pedido_historial (pedido_id,fecha,texto,usuario_id,usuario,tipo,etapa,anterior,nuevo,resp_anterior,resp_nuevo)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [pedidoId, isoHoy(), texto, req.user.id, req.user.nombre, d.tipo || "nota", d.etapa || "",
     d.anterior || "", d.nuevo || "", d.respAnterior || "", d.respNuevo || ""]);
}

function filaVersionPedido(m){
  return {
    id: m.id, muestraId: m.muestra_id, modelo: m.modelo || "", version: m.version, estado: m.estado, fecha: m.fecha, responsable: m.responsable,
    cambiosSolicitados: m.cambios_solicitados, comentariosCliente: m.comentarios_cliente,
    fotos: m.fotos, aprobadoPor: m.aprobado_por, aprobadoEn: m.aprobado_en,
    tallaAprobada: m.talla_aprobada, materiales: m.materiales
  };
}
function agruparModelos(filas){
  const out = [], idx = {};
  filas.forEach(m => {
    let g = idx[m.muestra_id];
    if(!g){ g = idx[m.muestra_id] = { id: m.muestra_id, titulo: m.modelo || "", matriz: m.modelo_matriz || [], versiones: [] }; out.push(g); }
    g.versiones.push(filaVersionPedido(m));
  });
  return out;
}

function filaPedido(row, hist, checklist, muestras, produccion, adjuntos){
  return {
    id: row.id, cliente: row.cliente, producto: row.producto, cantidad: row.cantidad,
    registro: row.registro, solicitada: row.solicitada, compromiso: row.compromiso,
    estado: row.estado, prioridad: row.prioridad, responsable: row.responsable, etapa: row.etapa,
    obs: row.obs, origenCotizacion: row.origen_cotizacion,
    cotizUnidades: row.cotiz_unidades != null ? Number(row.cotiz_unidades) : null,
    guiaGeneradaEn: row.guia_generada_en, entregadoEn: row.entregado_en || null,
    requiereMuestra: row.requiere_muestra,
    curva: row.curva || [], colores: row.colores || [], matriz: row.matriz || [], compras: row.compras || [],
    hist: hist || [],
    checklist: (checklist || []).map(c => ({
      id: c.id, item: c.item, label: c.label || CHECKLIST_LABEL[c.item] || c.item, orden: c.orden,
      hecho: c.hecho, fecha: c.fecha, responsable: c.responsable,
      cantidad: c.cantidad, notas: c.notas
    })).sort((a,b) => a.orden - b.orden),
    muestras: (muestras || []).map(m => filaVersionPedido(m)),
    modelos: agruparModelos(muestras || []),
    documentos: (adjuntos || []).filter(a => a.categoria === "documento").sort((a,b) => a.id - b.id)
      .map(a => ({ id:a.id, nombre:a.nombre, mime:a.mime, tamano:Number(a.tamano) || 0 })),
    produccion: (produccion || []).map(t => ({
      id: t.id, etapa: t.etapa, label: t.label || ETAPA_LABEL[t.etapa] || t.etapa, orden: t.orden,
      tipo: t.tipo, responsable: t.responsable, estado: t.estado,
      proveedor: t.proveedor || "", fechaInicio: t.fecha_inicio || null, fechaPrevista: t.fecha_prevista, fechaReal: t.fecha_real, notas: t.notas,
      materiales: t.materiales || [], controles: t.controles || [],
      fotos: (adjuntos || []).filter(a => a.etapa_id === t.id && a.categoria !== "documento").sort((a,b) => a.orden - b.orden || a.id - b.id)
        .map(a => ({ id:a.id, leyenda:a.leyenda, nombre:a.nombre }))
    })).sort((a,b) => a.orden - b.orden)
  };
}

async function pedidoCompleto(client, id){
  const p = await client.query("SELECT * FROM pedidos WHERE id = $1", [id]);
  if(!p.rows[0]) return null;
  const h = await client.query("SELECT fecha, texto, creado_en, usuario, tipo, etapa, anterior, nuevo, resp_anterior, resp_nuevo FROM pedido_historial WHERE pedido_id = $1 ORDER BY id ASC", [id]);
  const c = await client.query("SELECT id, item, label, orden, hecho, fecha, responsable, cantidad, notas FROM pedido_checklist WHERE pedido_id = $1", [id]);
  const m = await client.query("SELECT v.id, v.muestra_id, v.version, v.estado, v.fecha, v.responsable, v.cambios_solicitados, v.comentarios_cliente, v.fotos, v.aprobado_por, v.aprobado_en, v.talla_aprobada, v.materiales, m.titulo AS modelo, m.matriz AS modelo_matriz, m.pedido_id FROM pedido_muestras v JOIN muestras m ON m.id = v.muestra_id WHERE m.pedido_id = $1 ORDER BY m.id, v.version", [id]);
  const t = await client.query("SELECT id, etapa, label, orden, tipo, responsable, estado, proveedor, fecha_inicio, fecha_prevista, fecha_real, notas, materiales, controles FROM pedido_produccion WHERE pedido_id = $1", [id]);
  const ad = await client.query("SELECT id, etapa_id, leyenda, nombre, orden, categoria, mime, octet_length(bytes) AS tamano FROM pedido_adjuntos WHERE pedido_id = $1", [id]);
  return filaPedido(p.rows[0], h.rows, c.rows, m.rows, t.rows, ad.rows);
}

router.get("/", async (req, res) => {
  const pedidos = await pool.query("SELECT * FROM pedidos ORDER BY compromiso ASC");
  const [hist, checklist, muestras, produccion, adjuntos] = await Promise.all([
    pool.query("SELECT pedido_id, fecha, texto, creado_en, usuario, tipo, etapa, anterior, nuevo, resp_anterior, resp_nuevo FROM pedido_historial ORDER BY id ASC"),
    pool.query("SELECT id, pedido_id, item, label, orden, hecho, fecha, responsable, cantidad, notas FROM pedido_checklist"),
    pool.query("SELECT v.id, v.muestra_id, v.version, v.estado, v.fecha, v.responsable, v.cambios_solicitados, v.comentarios_cliente, v.fotos, v.aprobado_por, v.aprobado_en, v.talla_aprobada, v.materiales, m.titulo AS modelo, m.matriz AS modelo_matriz, m.pedido_id FROM pedido_muestras v JOIN muestras m ON m.id = v.muestra_id WHERE m.pedido_id IS NOT NULL ORDER BY m.id, v.version"),
    pool.query("SELECT id, pedido_id, etapa, label, orden, tipo, responsable, estado, proveedor, fecha_inicio, fecha_prevista, fecha_real, notas, materiales, controles FROM pedido_produccion"),
    pool.query("SELECT id, pedido_id, etapa_id, leyenda, nombre, orden, categoria, mime, octet_length(bytes) AS tamano FROM pedido_adjuntos")
  ]);
  const porPedido = (rows) => { const m = {}; for(const r of rows) (m[r.pedido_id] ||= []).push(r); return m; };
  const histPorPedido = porPedido(hist.rows);
  const checkPorPedido = porPedido(checklist.rows);
  const muestrasPorPedido = porPedido(muestras.rows);
  const produccionPorPedido = porPedido(produccion.rows);
  const adjuntosPorPedido = porPedido(adjuntos.rows);
  res.json(pedidos.rows.map(p => filaPedido(p, histPorPedido[p.id], checkPorPedido[p.id], muestrasPorPedido[p.id], produccionPorPedido[p.id], adjuntosPorPedido[p.id])));
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
    /* tallas y colores al crear: la matriz es la fuente y de ella salen curva, colores y cantidad */
    const matriz = normalizarMatriz(b.matriz);
    const der = matriz.length ? derivarMatriz(matriz) : null;
    const totalMx = der ? der.curva.reduce((s, t) => s + t.cant, 0) : 0;
    const cantidadFinal = totalMx > 0 ? totalMx : Number(b.cantidad);
    await client.query(
      `INSERT INTO pedidos (id,cliente,producto,cantidad,registro,solicitada,compromiso,estado,prioridad,responsable,etapa,obs,origen_cotizacion,cotiz_unidades,requiere_muestra,curva,colores,matriz,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'Preparación',$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
      [id, b.cliente, b.producto, cantidadFinal, registro, b.solicitada || b.compromiso, b.compromiso,
       b.prioridad || "Normal", b.responsable || "", "", b.obs || "",
       b.origenCotizacion || null, b.cotizUnidades != null ? Number(b.cotizUnidades) : null, requiereMuestra,
       JSON.stringify(der ? der.curva : (Array.isArray(b.curva) ? b.curva : [])), JSON.stringify(der ? der.colores : (Array.isArray(b.colores) ? b.colores : [])),
       JSON.stringify(matriz), req.session.userId]
    );
    await client.query("INSERT INTO pedido_historial (pedido_id,fecha,texto,usuario_id,usuario) VALUES ($1,$2,'Pedido registrado',$3,$4)", [id, registro, req.user.id, req.user.nombre]);
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
      const ms = await client.query(
        `SELECT m.titulo,
                EXISTS (SELECT 1 FROM pedido_muestras v WHERE v.muestra_id = m.id AND v.estado = 'Aprobada') AS ok,
                EXISTS (SELECT 1 FROM pedido_muestras v WHERE v.muestra_id = m.id AND v.estado <> 'Anulada') AS viva
           FROM muestras m WHERE m.pedido_id = $1`, [id]);
      const vivas = ms.rows.filter(r => r.viva);
      if(!vivas.length){
        await client.query("ROLLBACK");
        return res.status(409).json({ error:"Este pedido requiere muestra: crea o vincula una muestra y apruébala antes de pasar a producción." });
      }
      const faltan = vivas.filter(r => !r.ok);
      if(faltan.length){
        await client.query("ROLLBACK");
        return res.status(409).json({ error:"Faltan aprobar las muestras: "+faltan.map(r => "«"+r.titulo+"»").join(", ")+"." });
      }
    }
    await client.query("UPDATE pedidos SET estado = $1, entregado_en = $3, updated_at = now() WHERE id = $2", [nuevo, id, nuevo === "Entregado" ? isoHoy() : null]);
    await histDet(client, req, id, "Estado → "+nuevo, { tipo:"estado", anterior:cur.rows[0].estado, nuevo });
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

/* ---- editar los datos del resumen. La fecha comprometida la cambia solo el administrador ---- */
const CAMPOS_EDITABLES = { cliente:"Cliente", producto:"Prenda", cantidad:"Cantidad", prioridad:"Prioridad", responsable:"Responsable", obs:"Observaciones", solicitada:"Fecha solicitada", compromiso:"Fecha comprometida" };
router.patch("/:id", async (req, res) => {
  const { id } = req.params;
  const b = req.body || {};
  const cambios = Object.keys(CAMPOS_EDITABLES).filter(k => k in b);
  if(!cambios.length) return res.status(400).json({ error:"No hay datos para actualizar." });
  const client = await pool.connect();
  try{
    await client.query("BEGIN");
    const cur = (await client.query("SELECT * FROM pedidos WHERE id = $1 FOR UPDATE", [id])).rows[0];
    if(!cur){ await client.query("ROLLBACK"); return res.status(404).json({ error:"Pedido no encontrado." }); }
    const sets = [], vals = [], notas = [];
    for(const k of cambios){
      let nuevo = b[k];
      if(["cliente","producto"].includes(k)){ nuevo = String(nuevo || "").trim(); if(!nuevo){ await client.query("ROLLBACK"); return res.status(400).json({ error:CAMPOS_EDITABLES[k]+" no puede quedar vacío." }); } }
      else if(k === "cantidad"){ nuevo = Math.round(Number(nuevo)); if(!(nuevo >= 1)){ await client.query("ROLLBACK"); return res.status(400).json({ error:"La cantidad debe ser al menos 1." }); } }
      else if(k === "prioridad"){ if(!["Alta","Normal","Baja"].includes(nuevo)){ await client.query("ROLLBACK"); return res.status(400).json({ error:"Prioridad inválida." }); } }
      else if(k === "solicitada" || k === "compromiso"){ if(!/^\d{4}-\d{2}-\d{2}$/.test(String(nuevo || ""))){ await client.query("ROLLBACK"); return res.status(400).json({ error:"Fecha inválida." }); } }
      else nuevo = String(nuevo == null ? "" : nuevo).trim();
      const antes = cur[k];
      const antesTxt = antes instanceof Date ? antes.toISOString().slice(0,10) : String(antes == null ? "" : antes);
      if(String(nuevo) === antesTxt) continue;
      if(k === "compromiso" && req.user.rol !== "admin"){
        await client.query("ROLLBACK");
        return res.status(403).json({ error:"Solo el administrador puede cambiar la fecha comprometida." });
      }
      vals.push(nuevo); sets.push(k+" = $"+vals.length);
      notas.push({ k, antes:antesTxt, nuevo:String(nuevo) });
    }
    if(!sets.length){ await client.query("ROLLBACK"); return res.json(await pedidoCompleto(pool, id)); }
    vals.push(id);
    await client.query("UPDATE pedidos SET "+sets.join(", ")+", updated_at = now() WHERE id = $"+vals.length, vals);
    for(const n of notas){
      const corto = n.k === "obs" ? "" : ": "+(n.antes || "—")+" → "+(n.nuevo || "—");
      await histDet(client, req, id, "Resumen editado · "+CAMPOS_EDITABLES[n.k]+(n.k === "obs" ? " actualizadas" : corto), { tipo:"edicion", anterior:n.antes, nuevo:n.nuevo });
    }
    await client.query("COMMIT");
    res.json(await pedidoCompleto(pool, id));
  } catch(err){
    await client.query("ROLLBACK"); console.error(err);
    res.status(500).json({ error:"No se pudo actualizar el pedido." });
  } finally { client.release(); }
});

/* ---- ¿requiere muestra? se puede definir o cambiar en cualquier momento antes de producción ---- */
router.patch("/:id/requiere-muestra", async (req, res) => {
  const { id } = req.params;
  const requiere = !!(req.body && req.body.requiereMuestra);
  const r = await pool.query("UPDATE pedidos SET requiere_muestra = $1, updated_at = now() WHERE id = $2 RETURNING id", [requiere, id]);
  if(!r.rows[0]) return res.status(404).json({ error:"Pedido no encontrado." });
  await pool.query("INSERT INTO pedido_historial (pedido_id,fecha,texto,usuario_id,usuario) VALUES ($1,$2,$3,$4,$5)",
    [id, isoHoy(), "¿Requiere muestra? → "+(requiere ? "Sí" : "No"), req.user.id, req.user.nombre]);
  res.json(await pedidoCompleto(pool, id));
});

/* ---- curva (desglose por talla/color): informativa, la usa la orden de corte ---- */
router.patch("/:id/curva", async (req, res) => {
  const { id } = req.params;
  const b = req.body || {};
  /* con matriz talla x color, los totales por talla y por color se derivan de ella */
  const matriz = normalizarMatriz(b.matriz);
  const der = matriz.length ? derivarMatriz(matriz) : null;
  const curva = der ? der.curva : (Array.isArray(b.curva) ? b.curva : []);
  const colores = der ? der.colores : (Array.isArray(b.colores) ? b.colores : []);
  const total = der ? curva.reduce((s, r) => s + r.cant, 0) : null;
  const client = await pool.connect();
  try{
    await client.query("BEGIN");
    const r = await client.query(
      "UPDATE pedidos SET curva=$1, colores=$2, matriz=$3, updated_at=now() WHERE id=$4 RETURNING id, cantidad",
      [JSON.stringify(curva), JSON.stringify(colores), JSON.stringify(matriz), id]);
    if(!r.rows[0]){ await client.query("ROLLBACK"); return res.status(404).json({ error:"Pedido no encontrado." }); }
    if(b.actualizarCantidad && total && total !== r.rows[0].cantidad){
      await client.query("UPDATE pedidos SET cantidad=$1 WHERE id=$2", [total, id]);
      await histDet(client, req, id, "Cantidad ajustada de "+r.rows[0].cantidad+" a "+total+" unidades según la matriz de tallas y colores",
        { tipo:"cantidad", anterior:String(r.rows[0].cantidad), nuevo:String(total) });
    }
    await client.query("COMMIT");
  } catch(err){
    await client.query("ROLLBACK"); console.error(err);
    return res.status(500).json({ error:"No se pudo guardar el desglose." });
  } finally { client.release(); }
  res.json(await pedidoCompleto(pool, id));
});

/* ---- lista de compras (avíos): qué comprar, cuánto y de qué color — se imprime
   aparte para entregársela solo al encargado de compras ---- */
router.patch("/:id/compras", async (req, res) => {
  const { id } = req.params;
  const b = req.body || {};
  const r = await pool.query(
    "UPDATE pedidos SET compras=$1, updated_at=now() WHERE id=$2 RETURNING id",
    [JSON.stringify(Array.isArray(b.compras) ? b.compras : []), id]
  );
  if(!r.rows[0]) return res.status(404).json({ error:"Pedido no encontrado." });
  await pool.query("INSERT INTO pedido_historial (pedido_id,fecha,texto,usuario_id,usuario) VALUES ($1,$2,'Lista de compras actualizada',$3,$4)", [id, isoHoy(), req.user.id, req.user.nombre]);
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
    await client.query("INSERT INTO pedido_historial (pedido_id,fecha,texto,usuario_id,usuario) VALUES ($1,$2,$3,$4,$5)",
      [id, isoHoy(), "Checklist: se agregó \""+label+"\"", req.user.id, req.user.nombre]);
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
      await client.query("INSERT INTO pedido_historial (pedido_id,fecha,texto,usuario_id,usuario) VALUES ($1,$2,$3,$4,$5)",
        [id, isoHoy(), "Checklist: "+label+(hecho ? " marcado"+(cantidad ? " ("+cantidad+")" : "") : " desmarcado"), req.user.id, req.user.nombre]);
    } else if(label !== actual.label){
      await client.query("INSERT INTO pedido_historial (pedido_id,fecha,texto,usuario_id,usuario) VALUES ($1,$2,$3,$4,$5)",
        [id, isoHoy(), "Checklist: \""+actual.label+"\" renombrado a \""+label+"\"", req.user.id, req.user.nombre]);
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
    await client.query("INSERT INTO pedido_historial (pedido_id,fecha,texto,usuario_id,usuario) VALUES ($1,$2,$3,$4,$5)",
      [id, isoHoy(), "Checklist: se quitó \""+r.rows[0].label+"\"", req.user.id, req.user.nombre]);
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


/* ---- producción por etapa: interno/tercerizado, informativo (no bloquea nada) ----
   editable y ordenable por el usuario, igual que el checklist: no todas las prendas
   llevan las mismas etapas, así que se agregan/renombran/borran/reordenan libremente.
   Se direcciona por el id numérico de la fila, no por el slug fijo. */
const ESTADOS_TAREA = ["Pendiente","En proceso","Completado"];

router.post("/:id/produccion", async (req, res) => {
  const { id } = req.params;
  const label = (req.body && req.body.label || "").trim();
  if(!label) return res.status(400).json({ error:"La etapa necesita un nombre." });
  const client = await pool.connect();
  try{
    await client.query("BEGIN");
    const ped = await client.query("SELECT id FROM pedidos WHERE id=$1 FOR UPDATE", [id]);
    if(!ped.rows[0]){ await client.query("ROLLBACK"); return res.status(404).json({ error:"Pedido no encontrado." }); }
    const ordenRes = await client.query("SELECT COALESCE(MAX(orden),0)+1 AS n FROM pedido_produccion WHERE pedido_id=$1", [id]);
    await client.query(
      `INSERT INTO pedido_produccion (pedido_id,etapa,label,orden)
       VALUES ($1, 'custom-'||substr(md5(random()::text),1,10), $2, $3)`,
      [id, label, ordenRes.rows[0].n]
    );
    await client.query("INSERT INTO pedido_historial (pedido_id,fecha,texto,usuario_id,usuario) VALUES ($1,$2,$3,$4,$5)",
      [id, isoHoy(), "Producción: se agregó la etapa \""+label+"\"", req.user.id, req.user.nombre]);
    await client.query("COMMIT");
    res.status(201).json(await pedidoCompleto(pool, id));
  } catch(err){
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error:"No se pudo agregar la etapa." });
  } finally {
    client.release();
  }
});

router.patch("/:id/produccion/:itemId", async (req, res) => {
  const { id, itemId } = req.params;
  const b = req.body || {};
  if(b.tipo && !["Interno","Tercerizado"].includes(b.tipo)) return res.status(400).json({ error:"Tipo inválido." });
  if(b.estado && !ESTADOS_TAREA.includes(b.estado)) return res.status(400).json({ error:"Estado de tarea inválido." });

  const client = await pool.connect();
  try{
    await client.query("BEGIN");
    const cur = await client.query("SELECT * FROM pedido_produccion WHERE pedido_id=$1 AND id=$2 FOR UPDATE", [id, itemId]);
    if(!cur.rows[0]){ await client.query("ROLLBACK"); return res.status(404).json({ error:"Pedido o etapa no encontrada." }); }
    const actual = cur.rows[0];
    const label = b.label != null ? String(b.label).trim() || actual.label : actual.label;
    const tipo = b.tipo || actual.tipo;
    const responsable = b.responsable != null ? b.responsable : actual.responsable;
    const estado = b.estado || actual.estado;
    const proveedor = b.proveedor != null ? String(b.proveedor).trim() : actual.proveedor;
    const fechaPrevista = b.fechaPrevista !== undefined ? (b.fechaPrevista || null) : actual.fecha_prevista;
    let fechaInicio = b.fechaInicio !== undefined ? (b.fechaInicio || null) : actual.fecha_inicio;
    if(estado === "En proceso" && !fechaInicio) fechaInicio = isoHoy();
    let fechaReal = b.fechaReal !== undefined ? (b.fechaReal || null) : actual.fecha_real;
    if(estado === "Completado" && !fechaReal) fechaReal = isoHoy();
    const notas = b.notas != null ? String(b.notas) : actual.notas;
    const materiales = Array.isArray(b.materiales)
      ? b.materiales.map(m => ({ item:String(m.item||"").trim(), cantidad:String(m.cantidad||"").trim(), color:String(m.color||"").trim() })).filter(m => m.item)
      : actual.materiales;
    const controles = Array.isArray(b.controles) ? b.controles.map(c => String(c).trim()).filter(Boolean) : actual.controles;

    await client.query(
      "UPDATE pedido_produccion SET label=$1, tipo=$2, responsable=$3, estado=$4, fecha_prevista=$5, fecha_real=$6, notas=$7, materiales=$8, controles=$9, fecha_inicio=$12, proveedor=$13 WHERE pedido_id=$10 AND id=$11",
      [label, tipo, responsable, estado, fechaPrevista, fechaReal, notas, JSON.stringify(materiales), JSON.stringify(controles), id, itemId, fechaInicio, proveedor]
    );
    if(estado !== actual.estado){
      await histDet(client, req, id, "Producción · "+label+": "+actual.estado+" → "+estado,
        { tipo:"etapa_estado", etapa:label, anterior:actual.estado, nuevo:estado });
    }
    if(responsable !== actual.responsable){
      await histDet(client, req, id, "Producción · "+label+": responsable "+(actual.responsable || "sin asignar")+" → "+(responsable || "sin asignar"),
        { tipo:"responsable", etapa:label, respAnterior:actual.responsable, respNuevo:responsable });
    }
    if(proveedor !== actual.proveedor){
      await histDet(client, req, id, "Producción · "+label+": proveedor "+(actual.proveedor || "sin asignar")+" → "+(proveedor || "sin asignar"), { tipo:"etapa_proveedor", etapa:label, anterior:actual.proveedor, nuevo:proveedor });
    }
    if(tipo !== actual.tipo){
      await histDet(client, req, id, "Producción · "+label+": "+actual.tipo+" → "+tipo, { tipo:"etapa_tipo", etapa:label, anterior:actual.tipo, nuevo:tipo });
    }
    if(notas !== actual.notas){
      await client.query("INSERT INTO pedido_historial (pedido_id,fecha,texto,usuario_id,usuario) VALUES ($1,$2,$3,$4,$5)",
        [id, isoHoy(), "Producción · "+label+": instrucciones actualizadas", req.user.id, req.user.nombre]);
    }
    if(label !== actual.label){
      await client.query("INSERT INTO pedido_historial (pedido_id,fecha,texto,usuario_id,usuario) VALUES ($1,$2,$3,$4,$5)",
        [id, isoHoy(), "Producción: \""+actual.label+"\" renombrada a \""+label+"\"", req.user.id, req.user.nombre]);
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

/* ---- transferir el pedido a la siguiente etapa: termina la etapa actual, pasa a la siguiente
   (por defecto la que sigue en la lista, pero puede ser cualquiera), asigna al nuevo
   responsable y deja todo registrado. Si no hay siguiente, solo cierra la última etapa. ---- */
router.post("/:id/produccion/:itemId/transferir", async (req, res) => {
  const { id, itemId } = req.params;
  const b = req.body || {};
  const nuevoResp = String(b.responsable || "").trim();
  const client = await pool.connect();
  try{
    await client.query("BEGIN");
    const cur = await client.query("SELECT * FROM pedido_produccion WHERE pedido_id=$1 AND id=$2 FOR UPDATE", [id, itemId]);
    if(!cur.rows[0]){ await client.query("ROLLBACK"); return res.status(404).json({ error:"Etapa no encontrada." }); }
    const actual = cur.rows[0];
    const ped = (await client.query("SELECT responsable, etapa, estado FROM pedidos WHERE id=$1 FOR UPDATE", [id])).rows[0];
    let sig = null;
    if(b.siguienteId){
      if(String(b.siguienteId) === String(itemId)){ await client.query("ROLLBACK"); return res.status(400).json({ error:"La siguiente etapa no puede ser la misma." }); }
      const r = await client.query("SELECT * FROM pedido_produccion WHERE pedido_id=$1 AND id=$2 FOR UPDATE", [id, b.siguienteId]);
      if(!r.rows[0]){ await client.query("ROLLBACK"); return res.status(404).json({ error:"La etapa siguiente no existe en este pedido." }); }
      sig = r.rows[0];
    }
    const respAnterior = actual.responsable || ped.responsable || "";

    if(actual.estado !== "Completado"){
      await client.query("UPDATE pedido_produccion SET estado='Completado', fecha_real=COALESCE(fecha_real,$1) WHERE id=$2", [isoHoy(), actual.id]);
      await histDet(client, req, id, "Producción · "+actual.label+": "+actual.estado+" → Completado",
        { tipo:"etapa_estado", etapa:actual.label, anterior:actual.estado, nuevo:"Completado" });
    }
    if(sig){
      const respFinal = nuevoResp || sig.responsable || "";
      await client.query("UPDATE pedido_produccion SET estado='En proceso', responsable=$1, fecha_real=NULL, fecha_inicio=COALESCE(fecha_inicio, CURRENT_DATE) WHERE id=$2", [respFinal, sig.id]);
      await client.query("UPDATE pedidos SET etapa=$1, responsable=$2, updated_at=now() WHERE id=$3", [sig.label, respFinal, id]);
      await histDet(client, req, id,
        "Transferido de "+actual.label+" a "+sig.label+(respFinal ? " · asignado a "+respFinal : ""),
        { tipo:"transferencia", etapa:actual.label+" → "+sig.label, anterior:actual.label, nuevo:sig.label, respAnterior, respNuevo:respFinal });
    } else {
      await client.query("UPDATE pedidos SET etapa='', updated_at=now() WHERE id=$1", [id]);
      await histDet(client, req, id, "Etapa final terminada: "+actual.label, { tipo:"etapa_final", etapa:actual.label, anterior:actual.label, nuevo:"Terminada", respAnterior });
    }
    const pend = await client.query("SELECT COUNT(*)::int AS n FROM pedido_produccion WHERE pedido_id=$1 AND estado<>'Completado'", [id]);
    await client.query("COMMIT");
    const pedido = await pedidoCompleto(pool, id);
    pedido.sugiereTerminado = pend.rows[0].n === 0 && ped.estado === "En producción";
    res.json(pedido);
  } catch(err){
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error:"No se pudo transferir el pedido." });
  } finally {
    client.release();
  }
});

router.delete("/:id/produccion/:itemId", async (req, res) => {
  const { id, itemId } = req.params;
  const client = await pool.connect();
  try{
    await client.query("BEGIN");
    const r = await client.query("DELETE FROM pedido_produccion WHERE pedido_id=$1 AND id=$2 RETURNING label", [id, itemId]);
    if(!r.rows[0]){ await client.query("ROLLBACK"); return res.status(404).json({ error:"Etapa no encontrada." }); }
    await client.query("INSERT INTO pedido_historial (pedido_id,fecha,texto,usuario_id,usuario) VALUES ($1,$2,$3,$4,$5)",
      [id, isoHoy(), "Producción: se quitó la etapa \""+r.rows[0].label+"\"", req.user.id, req.user.nombre]);
    await client.query("COMMIT");
    res.json(await pedidoCompleto(pool, id));
  } catch(err){
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error:"No se pudo quitar la etapa." });
  } finally {
    client.release();
  }
});

/* reordenar: recibe la lista completa de ids de producción en el orden final */
router.patch("/:id/produccion-orden", async (req, res) => {
  const { id } = req.params;
  const orden = Array.isArray(req.body && req.body.orden) ? req.body.orden : null;
  if(!orden) return res.status(400).json({ error:"Falta el orden." });
  const client = await pool.connect();
  try{
    await client.query("BEGIN");
    for(let i=0;i<orden.length;i++){
      await client.query("UPDATE pedido_produccion SET orden=$1 WHERE pedido_id=$2 AND id=$3", [i+1, id, orden[i]]);
    }
    await client.query("COMMIT");
    res.json(await pedidoCompleto(pool, id));
  } catch(err){
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error:"No se pudo reordenar la producción." });
  } finally {
    client.release();
  }
});

/* ---- fotos de una etapa: se suben como archivo binario (ya comprimido por el
   navegador), no como base64 dentro de JSON. Máximo 8 por etapa. ---- */
const MAX_FOTOS_ETAPA = 8;
router.post("/:id/produccion/:itemId/fotos", express.raw({ type:"image/*", limit:"6mb" }), async (req, res) => {
  const { id, itemId } = req.params;
  const mime = (req.headers["content-type"] || "").split(";")[0];
  if(!/^image\/(jpeg|png|webp)$/.test(mime)) return res.status(400).json({ error:"Solo se aceptan fotos JPG, PNG o WebP." });
  if(!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error:"La foto llegó vacía." });
  const e = await pool.query("SELECT id FROM pedido_produccion WHERE pedido_id=$1 AND id=$2", [id, itemId]);
  if(!e.rows[0]) return res.status(404).json({ error:"Etapa no encontrada." });
  const cnt = await pool.query("SELECT COUNT(*)::int AS n, COALESCE(MAX(orden),0)+1 AS sig FROM pedido_adjuntos WHERE etapa_id=$1", [itemId]);
  if(cnt.rows[0].n >= MAX_FOTOS_ETAPA) return res.status(409).json({ error:"Máximo "+MAX_FOTOS_ETAPA+" fotos por etapa." });
  let nombre = "";
  try{ nombre = decodeURIComponent(req.headers["x-nombre"] || "").slice(0,120); }catch(_){}
  await pool.query(
    "INSERT INTO pedido_adjuntos (pedido_id,etapa_id,nombre,mime,bytes,orden,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)",
    [id, itemId, nombre, mime, req.body, cnt.rows[0].sig, req.session.userId]
  );
  res.status(201).json(await pedidoCompleto(pool, id));
});

router.patch("/:id/fotos/:fotoId", async (req, res) => {
  const { id, fotoId } = req.params;
  const r = await pool.query("UPDATE pedido_adjuntos SET leyenda=$1 WHERE pedido_id=$2 AND id=$3 RETURNING id",
    [String(req.body && req.body.leyenda || "").slice(0,200), id, fotoId]);
  if(!r.rows[0]) return res.status(404).json({ error:"Foto no encontrada." });
  res.json(await pedidoCompleto(pool, id));
});

router.delete("/:id/fotos/:fotoId", async (req, res) => {
  const { id, fotoId } = req.params;
  const r = await pool.query("DELETE FROM pedido_adjuntos WHERE pedido_id=$1 AND id=$2 RETURNING id", [id, fotoId]);
  if(!r.rows[0]) return res.status(404).json({ error:"Foto no encontrada." });
  res.json(await pedidoCompleto(pool, id));
});

/* reordenar las fotos de una etapa: lista completa de ids en el orden final */
router.patch("/:id/produccion/:itemId/fotos-orden", async (req, res) => {
  const { id, itemId } = req.params;
  const orden = Array.isArray(req.body && req.body.orden) ? req.body.orden : null;
  if(!orden) return res.status(400).json({ error:"Falta el orden." });
  for(let i=0;i<orden.length;i++){
    await pool.query("UPDATE pedido_adjuntos SET orden=$1 WHERE pedido_id=$2 AND etapa_id=$3 AND id=$4", [i+1, id, itemId, orden[i]]);
  }
  res.json(await pedidoCompleto(pool, id));
});

/* ---- documentos de referencia del pedido (ficha técnica única) ---- */
const MAX_DOCS_PEDIDO = 12;
const MIME_DOCS = ["application/pdf","image/jpeg","image/png","image/webp","text/plain","text/csv",
  "application/msword","application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"];
router.post("/:id/documentos", express.raw({ type:MIME_DOCS, limit:"12mb" }), async (req, res) => {
  const { id } = req.params;
  const mime = (req.headers["content-type"] || "").split(";")[0];
  if(!MIME_DOCS.includes(mime)) return res.status(400).json({ error:"Formato no permitido. Sube PDF, imagen, Word, Excel o texto." });
  if(!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error:"El archivo llegó vacío." });
  const ped = await pool.query("SELECT 1 FROM pedidos WHERE id=$1", [id]);
  if(!ped.rows[0]) return res.status(404).json({ error:"Pedido no encontrado." });
  const cnt = await pool.query("SELECT COUNT(*)::int AS n FROM pedido_adjuntos WHERE pedido_id=$1 AND categoria='documento'", [id]);
  if(cnt.rows[0].n >= MAX_DOCS_PEDIDO) return res.status(409).json({ error:"Máximo "+MAX_DOCS_PEDIDO+" documentos por pedido." });
  let nombre = "documento";
  try{ nombre = decodeURIComponent(req.headers["x-nombre"] || "documento").slice(0,160); }catch(_){}
  await pool.query(
    "INSERT INTO pedido_adjuntos (pedido_id,etapa_id,nombre,mime,bytes,categoria,created_by) VALUES ($1,NULL,$2,$3,$4,'documento',$5)",
    [id, nombre, mime, req.body, req.user.id]);
  await histDet(pool, req, id, "Documento agregado: "+nombre);
  res.status(201).json(await pedidoCompleto(pool, id));
});
router.delete("/:id/documentos/:docId", async (req, res) => {
  const { id, docId } = req.params;
  const r = await pool.query("DELETE FROM pedido_adjuntos WHERE pedido_id=$1 AND id=$2 AND categoria='documento' RETURNING nombre", [id, docId]);
  if(!r.rows[0]) return res.status(404).json({ error:"Documento no encontrado." });
  await histDet(pool, req, id, "Documento quitado: "+r.rows[0].nombre);
  res.json(await pedidoCompleto(pool, id));
});

/* ---- moldes (patrones): se archivan por cliente y se reusan en pedidos futuros ---- */
router.get("/:id/moldes", async (req, res) => {
  const ped = await pool.query("SELECT cliente FROM pedidos WHERE id=$1", [req.params.id]);
  if(!ped.rows[0]) return res.status(404).json({ error:"Pedido no encontrado." });
  const r = await pool.query(
    "SELECT id, cliente, prenda, pedido_id, notas, fotos, responsable, codigo, ubicacion, created_at FROM moldes WHERE cliente=$1 ORDER BY created_at DESC",
    [ped.rows[0].cliente]
  );
  res.json(r.rows.map(m => ({
    id:m.id, cliente:m.cliente, prenda:m.prenda, pedidoId:m.pedido_id, notas:m.notas,
    fotos:m.fotos, responsable:m.responsable, codigo:m.codigo, ubicacion:m.ubicacion, creadoEn:m.created_at
  })));
});

router.post("/:id/moldes", async (req, res) => {
  const { id } = req.params;
  const b = req.body || {};
  const ped = await pool.query("SELECT cliente, producto FROM pedidos WHERE id=$1", [id]);
  if(!ped.rows[0]) return res.status(404).json({ error:"Pedido no encontrado." });
  const fotos = Array.isArray(b.fotos) ? b.fotos.slice(0,6) : [];
  const r = await pool.query(
    `INSERT INTO moldes (cliente,prenda,pedido_id,notas,fotos,responsable,created_by,codigo,ubicacion)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id, cliente, prenda, pedido_id, notas, fotos, responsable, codigo, ubicacion, created_at`,
    [ped.rows[0].cliente, b.prenda || ped.rows[0].producto, id, b.notas || "", JSON.stringify(fotos), b.responsable || "", req.session.userId, String(b.codigo || "").trim(), String(b.ubicacion || "").trim()]
  );
  await pool.query("INSERT INTO pedido_historial (pedido_id,fecha,texto,usuario_id,usuario) VALUES ($1,$2,'Molde archivado',$3,$4)", [id, isoHoy(), req.user.id, req.user.nombre]);
  const m = r.rows[0];
  res.status(201).json({ id:m.id, cliente:m.cliente, prenda:m.prenda, pedidoId:m.pedido_id, notas:m.notas, fotos:m.fotos, responsable:m.responsable, codigo:m.codigo, ubicacion:m.ubicacion, creadoEn:m.created_at });
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
      await client.query("INSERT INTO pedido_historial (pedido_id,fecha,texto,usuario_id,usuario) VALUES ($1,$2,'Guía de entrega generada',$3,$4)", [id, isoHoy(), req.user.id, req.user.nombre]);
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
module.exports.pedidoCompleto = pedidoCompleto;
module.exports.histDet = histDet;
