const express = require("express");
const pool = require("../db/pool");
const requireAuth = require("../middleware/requireAuth");

const router = express.Router();
router.use(requireAuth);

/* sirve una foto por id; el navegador la cachea (las fotos no cambian: si se
   reemplaza una, es un id nuevo) */
router.get("/:id", async (req, res) => {
  const r = await pool.query("SELECT mime, bytes, nombre, categoria FROM pedido_adjuntos WHERE id=$1", [req.params.id]);
  if(!r.rows[0]) return res.status(404).end();
  res.set("Content-Type", r.rows[0].mime);
  if(r.rows[0].categoria === "documento"){
    res.set("Content-Disposition", "inline; filename*=UTF-8''" + encodeURIComponent(r.rows[0].nombre || "documento"));
    res.set("X-Content-Type-Options", "nosniff");
  }
  res.set("Cache-Control", "private, max-age=31536000, immutable");
  res.send(r.rows[0].bytes);
});

module.exports = router;
