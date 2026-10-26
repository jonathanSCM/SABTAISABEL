const express = require("express");
const pool = require("../db/pool");
const requireAuth = require("../middleware/requireAuth");
const requireAdmin = require("../middleware/requireAdmin");

const router = express.Router();
router.use(requireAuth);

/* archivo de moldes por cliente/marca: para buscar "¿ya le hice esto antes?"
   sin depender del pedido de origen (el molde se reusa entre pedidos) */
router.get("/", async (req, res) => {
  const q = (req.query.cliente || "").trim();
  const r = await pool.query(
    q
      ? "SELECT id, cliente, prenda, pedido_id, notas, fotos, responsable, codigo, ubicacion, created_at FROM moldes WHERE eliminado_en IS NULL AND cliente ILIKE $1 ORDER BY created_at DESC"
      : "SELECT id, cliente, prenda, pedido_id, notas, fotos, responsable, codigo, ubicacion, created_at FROM moldes WHERE eliminado_en IS NULL ORDER BY created_at DESC LIMIT 100",
    q ? ["%"+q+"%"] : []
  );
  res.json(r.rows.map(m => ({
    id:m.id, cliente:m.cliente, prenda:m.prenda, pedidoId:m.pedido_id, notas:m.notas,
    fotos:m.fotos, responsable:m.responsable, codigo:m.codigo, ubicacion:m.ubicacion, creadoEn:m.created_at
  })));
});

router.delete("/:id", requireAdmin, async (req, res) => {
  const r = await pool.query("UPDATE moldes SET eliminado_en = now(), eliminado_por = $2 WHERE id = $1 AND eliminado_en IS NULL RETURNING id", [Number(req.params.id), req.user.nombre]);
  if(!r.rows[0]) return res.status(404).json({ error:"Molde no encontrado." });
  res.json({ ok:true, id:r.rows[0].id, papelera:true });
});

module.exports = router;
