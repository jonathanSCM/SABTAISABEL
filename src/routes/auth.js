const express = require("express");
const bcrypt = require("bcryptjs");
const rateLimit = require("express-rate-limit");
const pool = require("../db/pool");
const requireAuth = require("../middleware/requireAuth");

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error:"Demasiados intentos de inicio de sesión. Probá de nuevo en unos minutos." }
});

router.post("/login", loginLimiter, async (req, res) => {
  const { email, password } = req.body || {};
  if(!email || !password) return res.status(400).json({ error:"Faltan credenciales." });

  const r = await pool.query(
    "SELECT id, nombre, email, password_hash, rol, activo FROM usuarios WHERE email = $1",
    [String(email).trim().toLowerCase()]
  );
  const u = r.rows[0];
  if(!u || !u.activo) return res.status(401).json({ error:"Usuario o contraseña incorrectos." });

  const ok = await bcrypt.compare(password, u.password_hash);
  if(!ok) return res.status(401).json({ error:"Usuario o contraseña incorrectos." });

  req.session.regenerate(err => {
    if(err) return res.status(500).json({ error:"No se pudo iniciar sesión." });
    req.session.userId = u.id;
    req.session.save(() => {
      res.json({ id:u.id, nombre:u.nombre, email:u.email, rol:u.rol });
    });
  });
});

router.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("connect.sid");
    res.json({ ok:true });
  });
});

router.get("/me", requireAuth, async (req, res) => {
  res.json({ id:req.user.id, nombre:req.user.nombre, email:req.user.email, rol:req.user.rol });
});

const pwLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false,
  message: { error:"Demasiados intentos. Probá de nuevo en unos minutos." }
});

router.post("/change-password", requireAuth, pwLimiter, async (req, res) => {
  const { actual, nueva } = req.body || {};
  if(!actual || !nueva) return res.status(400).json({ error:"Completá la contraseña actual y la nueva." });
  if(String(nueva).length < 8) return res.status(400).json({ error:"La nueva contraseña debe tener al menos 8 caracteres." });

  const r = await pool.query("SELECT password_hash FROM usuarios WHERE id = $1", [req.user.id]);
  const ok = await bcrypt.compare(actual, r.rows[0].password_hash);
  if(!ok) return res.status(401).json({ error:"La contraseña actual no es correcta." });

  const hash = await bcrypt.hash(nueva, 10);
  await pool.query("UPDATE usuarios SET password_hash = $1 WHERE id = $2", [hash, req.user.id]);
  res.json({ ok:true });
});

module.exports = router;
