/* Uso único: siembra las etapas de producción para pedidos que ya existían
   antes de este subsistema. Idempotente. */
const pool = require("./pool");
const { sembrarProduccion } = require("./produccion");

async function backfill(){
  const client = await pool.connect();
  try{
    const pedidos = await client.query("SELECT id, estado, registro, compromiso, responsable FROM pedidos");
    let tocados = 0;
    for(const p of pedidos.rows){
      const existe = await client.query("SELECT 1 FROM pedido_produccion WHERE pedido_id=$1 LIMIT 1", [p.id]);
      if(existe.rows[0]) continue;
      await client.query("BEGIN");
      await sembrarProduccion(client, p.id);
      if(p.estado === "Terminado" || p.estado === "Entregado"){
        await client.query(
          "UPDATE pedido_produccion SET estado='Completado', fecha_real=$1, responsable=$2 WHERE pedido_id=$3",
          [p.compromiso, p.responsable || "Equipo", p.id]
        );
      } else if(p.estado === "En producción"){
        await client.query(
          "UPDATE pedido_produccion SET estado='En proceso', responsable=$1 WHERE pedido_id=$2",
          [p.responsable || "Equipo", p.id]
        );
      }
      await client.query("COMMIT");
      tocados += 1;
    }
    console.log("OK: producción sembrada para", tocados, "pedido(s) existentes.");
  } catch(err){
    await client.query("ROLLBACK").catch(()=>{});
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

backfill().catch(err => { console.error(err); process.exit(1); });
