/* Uso único: llena el checklist de preparación de pedidos que ya existían
   antes de que este subsistema existiera. Idempotente (ON CONFLICT DO NOTHING
   dentro de sembrarChecklist), así que es seguro correrlo más de una vez.
   Los pedidos que ya avanzaron más allá de "Preparación" quedan con el
   checklist completo (para no mostrar "faltan requisitos" en algo que el
   taller ya entregó hace semanas); los que siguen en preparación quedan
   con el checklist vacío, para completarlo de verdad. */
const pool = require("./pool");
const { sembrarChecklist } = require("./checklist");

async function backfill(){
  const client = await pool.connect();
  try{
    const pedidos = await client.query("SELECT id, estado, registro, responsable FROM pedidos");
    let tocados = 0;
    for(const p of pedidos.rows){
      const existe = await client.query("SELECT 1 FROM pedido_checklist WHERE pedido_id=$1 LIMIT 1", [p.id]);
      if(existe.rows[0]) continue;
      await client.query("BEGIN");
      await sembrarChecklist(client, p.id);
      if(p.estado !== "Preparación"){
        await client.query(
          "UPDATE pedido_checklist SET hecho=true, fecha=$1, responsable=$2 WHERE pedido_id=$3",
          [p.registro, p.responsable || "Equipo", p.id]
        );
      }
      await client.query("COMMIT");
      tocados += 1;
    }
    console.log("OK: checklist sembrado para", tocados, "pedido(s) existentes.");
  } catch(err){
    await client.query("ROLLBACK").catch(()=>{});
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

backfill().catch(err => { console.error(err); process.exit(1); });
