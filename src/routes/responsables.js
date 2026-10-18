const express = require("express");
const pool = require("../db/pool");
const requireAuth = require("../middleware/requireAuth");
const requireAdmin = require("../middleware/requireAdmin");

const router = express.Router();
router.use(requireAuth);

/* catálogo de responsables: todos lo leen (sugerencias en los formularios); solo el admin lo edita */
router.get("/", async (req, res) => {
  const r = await pool.query("SELECT id, nombre FROM responsables ORDER BY nombre");
  res.json(r.rows);
});

router.post("/", requireAdmin, async (req, res) => {
  const nombre = String((req.body && req.body.nombre) || "").trim();
  if(!nombre) return res.status(400).json({ error:"Escribe el nombre del responsable." });
  const ya = await pool.query("SELECT 1 FROM responsables WHERE lower(nombre) = lower($1)", [nombre]);
  if(ya.rows[0]) return res.status(409).json({ error:"Ese responsable ya está en la lista." });
  const r = await pool.query("INSERT INTO responsables (nombre) VALUES ($1) RETURNING id, nombre", [nombre]);
  res.status(201).json(r.rows[0]);
});

router.patch("/:id", requireAdmin, async (req, res) => {
  const nombre = String((req.body && req.body.nombre) || "").trim();
  if(!nombre) return res.status(400).json({ error:"El nombre no puede quedar vacío." });
  const ya = await pool.query("SELECT 1 FROM responsables WHERE lower(nombre) = lower($1) AND id <> $2", [nombre, Number(req.params.id)]);
  if(ya.rows[0]) return res.status(409).json({ error:"Ya existe un responsable con ese nombre." });
  const r = await pool.query("UPDATE responsables SET nombre = $1 WHERE id = $2 RETURNING id, nombre", [nombre, Number(req.params.id)]);
  if(!r.rows[0]) return res.status(404).json({ error:"Responsable no encontrado." });
  res.json(r.rows[0]);
});

router.delete("/:id", requireAdmin, async (req, res) => {
  const r = await pool.query("DELETE FROM responsables WHERE id = $1 RETURNING id", [Number(req.params.id)]);
  if(!r.rows[0]) return res.status(404).json({ error:"Responsable no encontrado." });
  res.json({ ok:true });
});

module.exports = router;
