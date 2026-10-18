const pool = require("../db/pool");

/* Verifica la sesión contra la base en cada request (no solo la cookie): si un
   admin desactiva a alguien, ese usuario queda afuera de inmediato, no recién
   quan vuelva a iniciar sesión. Deja el usuario en req.user para el resto de la cadena. */
async function requireAuth(req, res, next){
  if(!req.session || !req.session.userId) return res.status(401).json({ error:"No autenticado" });
  try{
    const r = await pool.query("SELECT id, nombre, email, rol, activo, debe_cambiar_password FROM usuarios WHERE id = $1", [req.session.userId]);
    const u = r.rows[0];
    if(!u || !u.activo) return res.status(401).json({ error:"No autenticado" });
    req.user = u;
    /* mientras no cambie la contraseña inicial, solo puede usar /api/auth/* */
    if(u.debe_cambiar_password && !String(req.originalUrl || "").startsWith("/api/auth/")){
      return res.status(403).json({ error:"Debes cambiar tu contraseña para continuar.", code:"CAMBIAR_PASSWORD" });
    }
    next();
  } catch(err){ next(err); }
}

module.exports = requireAuth;
