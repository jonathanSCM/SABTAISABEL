const fs = require("fs");
const path = require("path");
const pool = require("./pool");

/* Convierte los datos que ya existen al formato de matriz talla x color.
   - Con un solo color (o ninguno) la conversión no pierde nada: cada talla pasa a llevar
     ese color con su cantidad.
   - Con varios colores no se puede adivinar cuánto de cada color hay en cada talla, así que
     esos registros se dejan como están (el editor avisa "falta repartir por color").
   Es idempotente: solo toca filas que todavía no tienen matriz. */
async function migrarMatriz(tabla){
  const r = await pool.query(
    `SELECT id, curva, colores FROM ${tabla} WHERE jsonb_array_length(matriz) = 0 AND jsonb_array_length(curva) > 0`);
  let convertidos = 0, pendientes = 0;
  for(const row of r.rows){
    const cols = (row.colores || []).filter(c => c && (c.color || Number(c.cant)));
    if(cols.length > 1){ pendientes++; continue; }
    const color = cols[0] ? String(cols[0].color || "") : "";
    const matriz = row.curva.map(t => ({
      talla: String(t.talla || ""), consumo: Number(t.consumo) || 0,
      colores: [{ color, cant: Math.max(0, Math.round(Number(t.cant) || 0)) }]
    }));
    await pool.query(`UPDATE ${tabla} SET matriz = $1 WHERE id = $2`, [JSON.stringify(matriz), row.id]);
    convertidos++;
  }
  console.log("  matriz en "+tabla+": "+convertidos+" convertidos, "+pendientes+" con varios colores (se reparten a mano)");
}

/* S1: quien todavía tiene la contraseña inicial publicada debe cambiarla en su próximo ingreso. */
async function exigirCambioDeClaveInicial(){
  const bcrypt = require("bcryptjs");
  const INICIAL = "SantaIsabel2026!";
  const r = await pool.query("SELECT id, password_hash FROM usuarios WHERE debe_cambiar_password = false");
  let marcados = 0;
  for(const u of r.rows){
    if(await bcrypt.compare(INICIAL, u.password_hash)){ await pool.query("UPDATE usuarios SET debe_cambiar_password = true WHERE id = $1", [u.id]); marcados++; }
  }
  console.log("  usuarios obligados a cambiar la contraseña inicial: "+marcados);
}

async function migrarMuestrasExistentes(){
  const { migrarMuestras } = require("./muestras-migrar");
  console.log("  muestras agrupadas en modelos: "+(await migrarMuestras(pool)));
}

async function migrate(){
  const sql = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  /* el cambio forzado de contraseña inicial se aplica solo la primera vez (cuando la columna aún no existe);
     así, quien ya decidió seguir con su contraseña no vuelve a quedar marcado en cada despliegue */
  const yaExistia = (await pool.query("SELECT 1 FROM information_schema.columns WHERE table_name='usuarios' AND column_name='debe_cambiar_password'")).rows.length > 0;
  await pool.query(sql);
  console.log("OK: esquema aplicado a la base de datos.");
  await migrarMatriz("cotizaciones");
  await migrarMatriz("pedidos");
  await migrarMuestrasExistentes();
  if(!yaExistia) await exigirCambioDeClaveInicial();
  await pool.end();
}

migrate().catch(err => { console.error(err); process.exit(1); });
