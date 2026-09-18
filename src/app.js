require("dotenv").config();
const path = require("path");
const express = require("express");
const session = require("express-session");
const pgSession = require("connect-pg-simple")(session);
const pool = require("./db/pool");

const authRoutes = require("./routes/auth");
const pedidosRoutes = require("./routes/pedidos");
const cotizacionesRoutes = require("./routes/cotizaciones");
const usuariosRoutes = require("./routes/usuarios");

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);

app.use(express.json({ limit:"5mb" })); // 5mb: las cotizaciones pueden llevar una imagen de referencia en base64

app.use(session({
  store: new pgSession({ pool, tableName:"session" }),
  name: "santaisabel.sid",
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 1000 * 60 * 60 * 12 // 12 horas
  }
}));

app.use("/api/auth", authRoutes);
app.use("/api/pedidos", pedidosRoutes);
app.use("/api/cotizaciones", cotizacionesRoutes);
app.use("/api/usuarios", usuariosRoutes);

app.use(express.static(path.join(__dirname, "..", "public")));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error:"Error interno del servidor." });
});

module.exports = app;
