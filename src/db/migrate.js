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

async function migrate(){
  const sql = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  await pool.query(sql);
  console.log("OK: esquema aplicado a la base de datos.");
  await migrarMatriz("cotizaciones");
  await migrarMatriz("pedidos");
  await pool.end();
}

migrate().catch(err => { console.error(err); process.exit(1); });
