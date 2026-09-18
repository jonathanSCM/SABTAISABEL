const express = require("express");
const bcrypt = require("bcryptjs");
const pool = require("../db/pool");
const requireAuth = require("../middleware/requireAuth");
const requireAdmin = require("../middleware/requireAdmin");

const router = express.Router();

router.use(requireAuth, requireAdmin);

router.get("/", async (req, res) => {
  const r = await pool.query("SELECT id, nombre, email, rol, activo, created_at FROM usuarios ORDER BY created_at ASC");
  res.json(r.rows);
});

router.post("/", async (req, res) => {
  const { nombre, email, password, rol } = req.body || {};
  if(!nombre || !email || !password) return res.status(400).json({ error:"Faltan nombre, correo o contraseña." });
  if(String(password).length < 8) return res.status(400).json({ error:"La contraseña debe tener al menos 8 caracteres." });
  const rolFinal = rol === "admin" ? "admin" : "operador";

  const existe = await pool.query("SELECT id FROM usuarios WHERE email = $1", [String(email).trim().toLowerCase()]);
  if(existe.rows[0]) return res.status(409).json({ error:"Ya existe un usuario con ese correo." });

  const hash = await bcrypt.hash(password, 10);
  const r = await pool.query(
    "INSERT INTO usuarios (nombre,email,password_hash,rol) VALUES ($1,$2,$3,$4) RETURNING id, nombre, email, rol, activo, created_at",
    [nombre.trim(), String(email).trim().toLowerCase(), hash, rolFinal]
  );
  res.status(201).json(r.rows[0]);
});

router.patch("/:id/estado", async (req, res) => {
  const id = Number(req.params.id);
  const { activo } = req.body || {};
  if(typeof activo !== "boolean") return res.status(400).json({ error:"Falta indicar el nuevo estado (activo/inactivo)." });
  if(id === req.user.id && !activo) return res.status(400).json({ error:"No podés desactivar tu propia cuenta." });

  const r = await pool.query("UPDATE usuarios SET activo = $1 WHERE id = $2 RETURNING id, nombre, email, rol, activo, created_at", [activo, id]);
  if(!r.rows[0]) return res.status(404).json({ error:"Usuario no encontrado." });
  res.json(r.rows[0]);
});

router.post("/:id/resetear-password", async (req, res) => {
  const id = Number(req.params.id);
  const { password } = req.body || {};
  if(!password || String(password).length < 8) return res.status(400).json({ error:"La contraseña debe tener al menos 8 caracteres." });
  const hash = await bcrypt.hash(password, 10);
  const r = await pool.query("UPDATE usuarios SET password_hash = $1 WHERE id = $2 RETURNING id", [hash, id]);
  if(!r.rows[0]) return res.status(404).json({ error:"Usuario no encontrado." });
  res.json({ ok:true });
});

module.exports = router;
