const express = require("express");
const pool = require("../db/pool");
const requireAuth = require("../middleware/requireAuth");
const { sembrarChecklist, CHECKLIST_LABEL } = require("../db/checklist");
const { sembrarProduccion, ETAPA_LABEL } = require("../db/produccion");

const router = express.Router();

router.use(requireAuth);

function isoHoy(){ const d = new Date(); return d.toISOString().slice(0,10); }
function qUnidades(curva){ return (curva || []).reduce((s,r) => s + Number(r.cant || 0), 0); }

const TERMS_PROD_DEFAULT = `Los precios no incluyen IGV. La presente cotización se ha realizado en base a {{UND}} unidades y tiene una vigencia de {{VIG}} días.
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

function fila(row){
  return {
    id: row.id, cliente: row.cliente, prenda: row.prenda, obs: row.obs,
    fecha: row.fecha, vigencia: row.vigencia, estado: row.estado, img: row.img,
    pedidoId: row.pedido_id, curva: row.curva, colores: row.colores, groups: row.groups,
    muestra: Number(row.muestra), molde: Number(row.molde),
    termsProd: row.terms_prod, termsMuestra: row.terms_muestra
  };
}

router.get("/", async (req, res) => {
  const r = await pool.query("SELECT * FROM cotizaciones ORDER BY fecha DESC");
  res.json(r.rows.map(fila));
});

router.post("/", async (req, res) => {
  const b = req.body || {};
  const seqRes = await pool.query("SELECT nextval('cotizacion_seq') AS n");
  const id = "COT-"+String(seqRes.rows[0].n).padStart(4,"0");
  const vigencia = b.vigencia || 15;
  const und = qUnidades(b.curva);
  const r = await pool.query(
    `INSERT INTO cotizaciones (id,cliente,prenda,obs,fecha,vigencia,estado,img,curva,colores,groups,muestra,molde,terms_prod,terms_muestra,created_by)
     VALUES ($1,$2,$3,$4,$5,$6,'Borrador',$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
    [id, b.cliente || "", b.prenda || "", b.obs || "", b.fecha || isoHoy(), vigencia, b.img || null,
     JSON.stringify(b.curva || []), JSON.stringify(b.colores || []), JSON.stringify(b.groups || []),
     Number(b.muestra || 0), Number(b.molde || 0),
     b.termsProd || TERMS_PROD_DEFAULT.replace("{{UND}}", String(und)).replace("{{VIG}}", String(vigencia)),
     b.termsMuestra || TERMS_MUESTRA_DEFAULT, req.session.userId]
  );
  res.status(201).json(fila(r.rows[0]));
});

router.put("/:id", async (req, res) => {
  const { id } = req.params;
  const b = req.body || {};
  const r = await pool.query(
    `UPDATE cotizaciones SET cliente=$1, prenda=$2, obs=$3, fecha=$4, vigencia=$5, img=$6,
       curva=$7, colores=$8, groups=$9, muestra=$10, molde=$11, terms_prod=$12, terms_muestra=$13, updated_at=now()
     WHERE id=$14 RETURNING *`,
    [b.cliente || "", b.prenda || "", b.obs || "", b.fecha, b.vigencia || 15, b.img || null,
     JSON.stringify(b.curva || []), JSON.stringify(b.colores || []), JSON.stringify(b.groups || []),
     Number(b.muestra || 0), Number(b.molde || 0), b.termsProd || "", b.termsMuestra || "", id]
  );
  if(!r.rows[0]) return res.status(404).json({ error:"Cotización no encontrada." });
  res.json(fila(r.rows[0]));
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

    const seqRes = await client.query("SELECT nextval('pedido_seq') AS n");
    const pedidoId = "PD-"+String(seqRes.rows[0].n).padStart(4,"0");
    const unidades = qUnidades(q.curva) || 1;
    const registro = isoHoy();
    const compromiso = new Date(Date.now() + 42*86400000).toISOString().slice(0,10);

    await client.query(
      `INSERT INTO pedidos (id,cliente,producto,cantidad,registro,solicitada,compromiso,estado,prioridad,responsable,etapa,obs,origen_cotizacion,cotiz_unidades,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'Preparación','Normal','','', $8, $9, $10, $11)`,
      [pedidoId, q.cliente, q.prenda, unidades, registro, compromiso, compromiso,
       "Generado desde cotización "+id, id, unidades, req.session.userId]
    );
    await client.query("INSERT INTO pedido_historial (pedido_id,fecha,texto) VALUES ($1,$2,'Pedido registrado')", [pedidoId, registro]);
    await sembrarChecklist(client, pedidoId);
    await sembrarProduccion(client, pedidoId);
    await client.query("UPDATE cotizaciones SET estado='Aprobada', pedido_id=$1, updated_at=now() WHERE id=$2", [pedidoId, id]);

    await client.query("COMMIT");
    const updated = await pool.query("SELECT * FROM cotizaciones WHERE id=$1", [id]);
    const pedidoRow = await pool.query("SELECT * FROM pedidos WHERE id=$1", [pedidoId]);
    const checklistRow = await pool.query("SELECT item, orden, hecho, fecha, responsable FROM pedido_checklist WHERE pedido_id=$1 ORDER BY orden", [pedidoId]);
    const produccionRow = await pool.query("SELECT etapa, orden, tipo, responsable, estado, fecha_prevista, fecha_real FROM pedido_produccion WHERE pedido_id=$1 ORDER BY orden", [pedidoId]);
    const pr = pedidoRow.rows[0];
    res.json({
      cotizacion: fila(updated.rows[0]),
      pedido: {
        id: pr.id, cliente: pr.cliente, producto: pr.producto, cantidad: pr.cantidad,
        registro: pr.registro, solicitada: pr.solicitada, compromiso: pr.compromiso,
        estado: pr.estado, prioridad: pr.prioridad, responsable: pr.responsable, etapa: pr.etapa,
        obs: pr.obs, origenCotizacion: pr.origen_cotizacion,
        cotizUnidades: pr.cotiz_unidades != null ? Number(pr.cotiz_unidades) : null,
        guiaGeneradaEn: null,
        hist: [{ fecha: registro, texto:"Pedido registrado" }],
        checklist: checklistRow.rows.map(c => ({ item:c.item, label:CHECKLIST_LABEL[c.item] || c.item, orden:c.orden, hecho:c.hecho, fecha:c.fecha, responsable:c.responsable })),
        muestras: [],
        produccion: produccionRow.rows.map(t => ({ etapa:t.etapa, label:ETAPA_LABEL[t.etapa] || t.etapa, orden:t.orden, tipo:t.tipo, responsable:t.responsable, estado:t.estado, fechaPrevista:t.fecha_prevista, fechaReal:t.fecha_real }))
      }
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
