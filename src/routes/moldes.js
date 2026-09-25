const express = require("express");
const pool = require("../db/pool");
const requireAuth = require("../middleware/requireAuth");

const router = express.Router();
router.use(requireAuth);

/* archivo de moldes por cliente/marca: para buscar "¿ya le hice esto antes?"
   sin depender del pedido de origen (el molde se reusa entre pedidos) */
router.get("/", async (req, res) => {
  const q = (req.query.cliente || "").trim();
  const r = await pool.query(
    q
      ? "SELECT id, cliente, prenda, pedido_id, notas, fotos, responsable, created_at FROM moldes WHERE cliente ILIKE $1 ORDER BY created_at DESC"
      : "SELECT id, cliente, prenda, pedido_id, notas, fotos, responsable, created_at FROM moldes ORDER BY created_at DESC LIMIT 100",
    q ? ["%"+q+"%"] : []
  );
  res.json(r.rows.map(m => ({
    id:m.id, cliente:m.cliente, prenda:m.prenda, pedidoId:m.pedido_id, notas:m.notas,
    fotos:m.fotos, responsable:m.responsable, creadoEn:m.created_at
  })));
});

module.exports = router;
