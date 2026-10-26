const express = require("express");
const pool = require("../db/pool");
const requireAuth = require("../middleware/requireAuth");
const requireAdmin = require("../middleware/requireAdmin");
const { sembrarChecklist, CHECKLIST_LABEL } = require("../db/checklist");
const { sembrarProduccion, ETAPA_LABEL } = require("../db/produccion");
const { normalizarMatriz, derivarMatriz } = require("../db/matriz");

const router = express.Router();

router.use(requireAuth);
router.use(requireAdmin); // el operador no ve cotizaciones (precios y totales)
router.param("id", async (req, res, next, id) => {
  try{
    const r = await pool.query("SELECT eliminado_en FROM cotizaciones WHERE id = $1", [id]);
    if(r.rows[0] && r.rows[0].eliminado_en) return res.status(404).json({ error:"Cotización no encontrada." });
    next();
  } catch(e){ next(e); }
});

function isoHoy(){ const d = new Date(); return d.toISOString().slice(0,10); }
function qUnidades(curva){ return (curva || []).reduce((s,r) => s + Number(r.cant || 0), 0); }

const TERMS_PROD_DEFAULT = `Los precios del detalle no incluyen IGV; el total de la cotización lo incluye (18%). La presente cotización se ha realizado en base a {{UND}} unidades y tiene una vigencia de {{VIG}} días.
Al realizar el pago se deberá previamente solicitar la factura, la cual se emite a nombre del cliente, incluyendo el IGV.
La muestra y el molde aprobados son necesarios para programar el inicio de producción y se deben cancelar al 100%.
Para iniciar la producción se debe abonar el 50% del total de la misma.
Si durante el proceso se modifica la muestra y/o el molde, se detiene la producción y se sujeta a una nueva cotización.
El tiempo de entrega a partir de la aprobación de la muestra y el 100% de insumos entregados es de 30 días hábiles.
Luego de la fecha de entrega, el cliente tiene 5 días hábiles para hacer control de calidad a las prendas.`;
const TERMS_MUESTRA_DEFAULT = `El cliente realiza su solicitud y se elabora una ficha técnica con especificaciones en el plano. Se abona el 100% para dar inicio al proceso.
El costo de la muestra no incluye la tela; el cliente provee los materiales de referencia.
El costo de la muestra es referente a una sola talla e incluye 1 contramuestra.
Una vez aprobada la muestra no se aceptan modificaciones al modelo y especificaciones.`;

/* otras prendas de la cotización: cada una con su matriz talla x color y sus costos */
function normalizarExtras(extras){
  if(!Array.isArray(extras)) return [];
  return extras.map(e => {
    const matriz = normalizarMatriz(e && e.matriz);
    const der = matriz.length ? derivarMatriz(matriz) : { curva:[], colores:[] };
    const groups = (Array.isArray(e && e.groups) ? e.groups : []).map(g => ({
      key: String((g && g.key) || ""), label: String((g && g.label) || ""),
      rows: (Array.isArray(g && g.rows) ? g.rows : []).map(r => ({ n:String((r && r.n) || ""), c:Number(r && r.c) || 0, p:Number(r && r.p) || 0 }))
    }));
    return { prenda:String((e && e.prenda) || "").trim(), obs:String((e && e.obs) || ""), img:(e && e.img) || null, modo:(e && e.modo === "alternativa") ? "alternativa" : "suma", matriz, curva:der.curva, colores:der.colores, groups };
  }).filter(e => e.prenda || e.matriz.length);
}

function fila(row){
  return {
    id: row.id, cliente: row.cliente, prenda: row.prenda, obs: row.obs,
    fecha: row.fecha, vigencia: row.vigencia, estado: row.estado, img: row.img,
    pedidoId: row.pedido_id, curva: row.curva, colores: row.colores, matriz: row.matriz || [], groups: row.groups, incluirIgv: row.incluir_igv !== false, extras: row.extras || [], pedidosExtra: row.pedidos_extra || [],
    muestra: Number(row.muestra), molde: Number(row.molde),
    termsProd: row.terms_prod, termsMuestra: row.terms_muestra
  };
}

router.get("/", async (req, res) => {
  const r = await pool.query("SELECT * FROM cotizaciones WHERE eliminado_en IS NULL ORDER BY fecha DESC");
  res.json(r.rows.map(fila));
});

router.post("/", async (req, res) => {
  const b = req.body || {};
  const seqRes = await pool.query("SELECT nextval('cotizacion_seq') AS n");
  const id = "COT-"+String(seqRes.rows[0].n).padStart(4,"0");
  const vigencia = b.vigencia || 15;
  const matriz = normalizarMatriz(b.matriz);
  const der = matriz.length ? derivarMatriz(matriz) : null;
  const curva = der ? der.curva : (b.curva || []), colores = der ? der.colores : (b.colores || []);
  const und = qUnidades(curva);
  const r = await pool.query(
    `INSERT INTO cotizaciones (id,cliente,prenda,obs,fecha,vigencia,estado,img,curva,colores,matriz,groups,muestra,molde,terms_prod,terms_muestra,created_by,extras,incluir_igv)
     VALUES ($1,$2,$3,$4,$5,$6,'Borrador',$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`,
    [id, b.cliente || "", b.prenda || "", b.obs || "", b.fecha || isoHoy(), vigencia, b.img || null,
     JSON.stringify(curva), JSON.stringify(colores), JSON.stringify(matriz), JSON.stringify(b.groups || []),
     Number(b.muestra || 0), Number(b.molde || 0),
     b.termsProd || TERMS_PROD_DEFAULT.replace("{{UND}}", String(und)).replace("{{VIG}}", String(vigencia)),
     b.termsMuestra || TERMS_MUESTRA_DEFAULT, req.session.userId, JSON.stringify(normalizarExtras(b.extras)), b.incluirIgv !== false]
  );
  res.status(201).json(fila(r.rows[0]));
});

router.put("/:id", async (req, res) => {
  const { id } = req.params;
  const b = req.body || {};
  const matriz = normalizarMatriz(b.matriz);
  const der = matriz.length ? derivarMatriz(matriz) : null;
  const r = await pool.query(
    `UPDATE cotizaciones SET cliente=$1, prenda=$2, obs=$3, fecha=$4, vigencia=$5, img=$6,
       curva=$7, colores=$8, matriz=$9, groups=$10, muestra=$11, molde=$12, terms_prod=$13, terms_muestra=$14, extras=$16, incluir_igv=$17, updated_at=now()
     WHERE id=$15 RETURNING *`,
    [b.cliente || "", b.prenda || "", b.obs || "", b.fecha, b.vigencia || 15, b.img || null,
     JSON.stringify(der ? der.curva : (b.curva || [])), JSON.stringify(der ? der.colores : (b.colores || [])), JSON.stringify(matriz), JSON.stringify(b.groups || []),
     Number(b.muestra || 0), Number(b.molde || 0), b.termsProd || "", b.termsMuestra || "", id, JSON.stringify(normalizarExtras(b.extras)), b.incluirIgv !== false]
  );
  if(!r.rows[0]) return res.status(404).json({ error:"Cotización no encontrada." });
  res.json(fila(r.rows[0]));
});

router.delete("/:id", requireAdmin, async (req, res) => {
  const r = await pool.query("UPDATE cotizaciones SET eliminado_en = now(), eliminado_por = $2 WHERE id = $1 AND eliminado_en IS NULL RETURNING id", [req.params.id, req.user.nombre]);
  if(!r.rows[0]) return res.status(404).json({ error:"Cotización no encontrada." });
  console.log("Cotización "+r.rows[0].id+" movida a la papelera por "+req.user.email);
  res.json({ ok:true, id:r.rows[0].id, papelera:true });
});

router.post("/:id/enviar", async (req, res) => {
  const r = await pool.query("UPDATE cotizaciones SET estado='Enviada', updated_at=now() WHERE id=$1 RETURNING *", [req.params.id]);
  if(!r.rows[0]) return res.status(404).json({ error:"Cotización no encontrada." });
  res.json(fila(r.rows[0]));
});

router.post("/:id/rechazar", async (req, res) => {
  const r = await pool.query("UPDATE cotizaciones SET estado='Rechazada', updated_at=now() WHERE id=$1 RETURNING *", [req.params.id]);
  if(!r.rows[0]) return res.status(404).json({ error:"Cotización no encontrada." });
  res.json(fila(r.rows[0]));
});

router.post("/:id/aprobar", async (req, res) => {
  const { id } = req.params;
  const client = await pool.connect();
  try{
    await client.query("BEGIN");
    const qr = await client.query("SELECT * FROM cotizaciones WHERE id = $1 FOR UPDATE", [id]);
    const q = qr.rows[0];
    if(!q){ await client.query("ROLLBACK"); return res.status(404).json({ error:"Cotización no encontrada." }); }
    if(q.estado === "Aprobada" || q.estado === "Rechazada"){
      await client.query("ROLLBACK");
      return res.status(409).json({ error:"Esta cotización ya fue cerrada." });
    }

    const registro = isoHoy();
    const compromiso = new Date(Date.now() + 42*86400000).toISOString().slice(0,10);
    const extras = Array.isArray(q.extras) ? q.extras : [];
    /* qué opciones pasan a pedido: por defecto la prenda principal y las que suman; las variantes solo si se eligen */
    const body = req.body || {};
    const inc = body.incluir || { principal:true, extras: extras.map((e, i) => i).filter(i => extras[i].modo !== "alternativa") };
    const items = [];
    if(inc.principal !== false) items.push({ producto:q.prenda, curva:q.curva, colores:q.colores, matriz:q.matriz, nota:"" });
    (inc.extras || []).forEach(i => { const e = extras[Number(i)]; if(e) items.push({ producto:e.prenda || ("Prenda "+(Number(i)+2)), curva:e.curva, colores:e.colores, matriz:e.matriz, nota:" ("+(e.modo === "alternativa" ? "variante" : "prenda")+" "+(Number(i)+2)+")" }); });
    if(!items.length){ await client.query("ROLLBACK"); return res.status(400).json({ error:"Elige al menos una opción para crear el pedido." }); }
    const ids = [];
    for(const it of items){
      const sn = await client.query("SELECT nextval('pedido_seq') AS n");
      const pid = "PD-"+String(sn.rows[0].n).padStart(4,"0");
      const und = qUnidades(it.curva) || 1;
      await client.query(
        `INSERT INTO pedidos (id,cliente,producto,cantidad,registro,solicitada,compromiso,estado,prioridad,responsable,etapa,obs,origen_cotizacion,cotiz_unidades,curva,colores,matriz,created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'Preparación','Normal','','', $8, $9, $10, $11, $12, $13, $14)`,
        [pid, q.cliente, it.producto, und, registro, compromiso, compromiso, "Generado desde cotización "+id+it.nota, id, und,
         JSON.stringify(it.curva || []), JSON.stringify(it.colores || []), JSON.stringify(it.matriz || []), req.session.userId]);
      await client.query("INSERT INTO pedido_historial (pedido_id,fecha,texto,usuario_id,usuario) VALUES ($1,$2,'Pedido registrado',$3,$4)", [pid, registro, req.user.id, req.user.nombre]);
      await sembrarChecklist(client, pid);
      await sembrarProduccion(client, pid);
      ids.push(pid);
    }
    const pedidoId = ids[0], idsExtra = ids.slice(1);
    await client.query("UPDATE cotizaciones SET estado='Aprobada', pedido_id=$1, pedidos_extra=$2, updated_at=now() WHERE id=$3", [pedidoId, JSON.stringify(idsExtra), id]);

    await client.query("COMMIT");
    const updated = await pool.query("SELECT * FROM cotizaciones WHERE id=$1", [id]);
    res.json({
      pedidosExtra: idsExtra,
      cotizacion: fila(updated.rows[0]),
      pedido: await require("./pedidos").pedidoCompleto(pool, pedidoId)
    });
  } catch(err){
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error:"No se pudo aprobar la cotización." });
  } finally {
    client.release();
  }
});

module.exports = router;
