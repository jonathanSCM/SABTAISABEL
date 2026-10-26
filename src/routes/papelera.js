const express = require("express");
const pool = require("../db/pool");
const requireAuth = require("../middleware/requireAuth");
const requireAdmin = require("../middleware/requireAdmin");

const router = express.Router();
router.use(requireAuth, requireAdmin);

/* Papelera: lo eliminado queda guardado (con quién y cuándo) hasta que el administrador lo restaure
   o lo borre para siempre. */
const TIPOS = {
  pedidos:      { tabla:"pedidos",      id:"id" },
  cotizaciones: { tabla:"cotizaciones", id:"id" },
  muestras:     { tabla:"muestras",     id:"id" },
  moldes:       { tabla:"moldes",       id:"id" }
};

async function borrarParaSiempre(db, tipo, id){
  if(tipo === "pedidos"){
    await db.query("UPDATE cotizaciones SET pedido_id = NULL WHERE pedido_id = $1", [id]);
    await db.query("UPDATE cotizaciones SET pedidos_extra = pedidos_extra - $1::text WHERE pedidos_extra ? $1::text", [id]);
  }
  const t = TIPOS[tipo];
  const r = await db.query("DELETE FROM "+t.tabla+" WHERE "+t.id+" = $1 AND eliminado_en IS NOT NULL RETURNING "+t.id, [id]);
  return r.rowCount;
}

router.get("/", async (req, res) => {
  const [ped, cot, mue, mol] = await Promise.all([
    pool.query("SELECT id, cliente, producto, cantidad, estado, eliminado_en, eliminado_por FROM pedidos WHERE eliminado_en IS NOT NULL ORDER BY eliminado_en DESC"),
    pool.query("SELECT id, cliente, prenda, estado, eliminado_en, eliminado_por FROM cotizaciones WHERE eliminado_en IS NOT NULL ORDER BY eliminado_en DESC"),
    pool.query("SELECT m.id, m.cliente, m.titulo, (SELECT string_agg(mp.pedido_id, ', ') FROM muestra_pedidos mp WHERE mp.muestra_id = m.id) AS pedido_id, m.eliminado_en, m.eliminado_por, (SELECT count(*)::int FROM pedido_muestras v WHERE v.muestra_id = m.id) AS versiones FROM muestras m WHERE m.eliminado_en IS NOT NULL ORDER BY m.eliminado_en DESC"),
    pool.query("SELECT id, cliente, prenda, codigo, ubicacion, eliminado_en, eliminado_por FROM moldes WHERE eliminado_en IS NOT NULL ORDER BY eliminado_en DESC")
  ]);
  const f = r => r.rows.map(x => ({ ...x, eliminadoEn: x.eliminado_en, eliminadoPor: x.eliminado_por, eliminado_en: undefined, eliminado_por: undefined }));
  res.json({ pedidos:f(ped), cotizaciones:f(cot), muestras:f(mue), moldes:f(mol) });
});

router.post("/:tipo/:id/restaurar", async (req, res) => {
  const t = TIPOS[req.params.tipo];
  if(!t) return res.status(400).json({ error:"Tipo inválido." });
  const id = req.params.tipo === "muestras" || req.params.tipo === "moldes" ? Number(req.params.id) : req.params.id;
  const r = await pool.query("UPDATE "+t.tabla+" SET eliminado_en = NULL, eliminado_por = NULL WHERE "+t.id+" = $1 AND eliminado_en IS NOT NULL RETURNING "+t.id, [id]);
  if(!r.rows[0]) return res.status(404).json({ error:"No está en la papelera." });
  console.log("Restaurado de la papelera: "+req.params.tipo+" "+id+" por "+req.user.email);
  res.json({ ok:true });
});

router.delete("/:tipo/:id", async (req, res) => {
  if(!TIPOS[req.params.tipo]) return res.status(400).json({ error:"Tipo inválido." });
  const id = req.params.tipo === "muestras" || req.params.tipo === "moldes" ? Number(req.params.id) : req.params.id;
  const client = await pool.connect();
  try{
    await client.query("BEGIN");
    const n = await borrarParaSiempre(client, req.params.tipo, id);
    await client.query("COMMIT");
    if(!n) return res.status(404).json({ error:"No está en la papelera." });
    console.log("Borrado para siempre: "+req.params.tipo+" "+id+" por "+req.user.email);
    res.json({ ok:true });
  } catch(err){ await client.query("ROLLBACK"); console.error(err); res.status(500).json({ error:"No se pudo borrar." }); }
  finally { client.release(); }
});

/* vaciar toda la papelera */
router.delete("/", async (req, res) => {
  const client = await pool.connect();
  try{
    await client.query("BEGIN");
    let total = 0;
    for(const tipo of Object.keys(TIPOS)){
      const ids = (await client.query("SELECT "+TIPOS[tipo].id+" AS id FROM "+TIPOS[tipo].tabla+" WHERE eliminado_en IS NOT NULL")).rows.map(r => r.id);
      for(const id of ids) total += await borrarParaSiempre(client, tipo, id);
    }
    await client.query("COMMIT");
    console.log("Papelera vaciada ("+total+" elementos) por "+req.user.email);
    res.json({ ok:true, total });
  } catch(err){ await client.query("ROLLBACK"); console.error(err); res.status(500).json({ error:"No se pudo vaciar la papelera." }); }
  finally { client.release(); }
});

module.exports = router;
