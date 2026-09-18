/* Debe montarse después de requireAuth (usa req.user que ese middleware deja puesto). */
function requireAdmin(req, res, next){
  if(!req.user || req.user.rol !== "admin"){
    return res.status(403).json({ error:"Necesitás permisos de administración para esto." });
  }
  next();
}

module.exports = requireAdmin;
