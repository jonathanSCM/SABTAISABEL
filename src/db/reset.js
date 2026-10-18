/* Deja la base en cero: borra TODOS los datos (pedidos, cotizaciones, moldes, adjuntos, historial, sesiones)
   y conserva únicamente al usuario administrador. El esquema y las tablas se mantienen.
   Uso (PowerShell):  $env:DATABASE_URL="postgres://..."; $env:CONFIRMAR="VACIAR"; npm run db:reset
   Sin CONFIRMAR=VACIAR no hace nada, solo muestra qué haría. */
require("dotenv").config();
const { Pool } = require("pg");

const ADMIN = process.env.ADMIN_EMAIL || "admin@santaisabel.local";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

(async () => {
  const host = (process.env.DATABASE_URL || "").replace(/^[a-z]+:\/\/[^@]*@/, "");
  const tablas = (await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY 1")).rows.map(r => r.table_name);
  console.log("Base destino:", host);
  for(const t of tablas){ const n = (await pool.query('SELECT count(*)::int n FROM "' + t + '"')).rows[0].n; console.log("  " + t.padEnd(26) + n + " registros"); }
  const admin = (await pool.query("SELECT id FROM usuarios WHERE email = $1", [ADMIN])).rows[0];
  if(!admin){ console.error("No existe el usuario " + ADMIN + ". Cancelado: no se borró nada."); process.exit(1); }
  if(process.env.CONFIRMAR !== "VACIAR"){
    console.log("\nSIMULACIÓN: no se borró nada. Para ejecutar de verdad define CONFIRMAR=VACIAR.");
    process.exit(0);
  }
  const client = await pool.connect();
  try{
    await client.query("BEGIN");
    const otras = tablas.filter(t => t !== "usuarios");
    if(otras.length) await client.query("TRUNCATE " + otras.map(t => '"' + t + '"').join(", ") + " RESTART IDENTITY CASCADE");
    await client.query("DELETE FROM usuarios WHERE id <> $1", [admin.id]);
    for(const seq of ["pedido_seq", "cotizacion_seq"]){
      try{ await client.query("ALTER SEQUENCE " + seq + " RESTART WITH 1"); }catch(e){ /* no existe */ }
    }
    await client.query("COMMIT");
  } catch(e){ await client.query("ROLLBACK"); throw e; } finally { client.release(); }
  console.log("\nListo. Base en cero; queda solo el usuario " + ADMIN + ".");
  await pool.end();
})().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
