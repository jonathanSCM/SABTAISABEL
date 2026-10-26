/* Las versiones de muestra que existían colgadas de un pedido pasan a ser un modelo (muestra)
   vinculado a ese pedido, con sus versiones dentro. Es idempotente: solo toca filas sin muestra_id. */
async function migrarMuestras(pool){
  const r = await pool.query(
    `SELECT v.id, v.pedido_id, v.titulo, p.cliente, p.producto, p.matriz
       FROM pedido_muestras v JOIN pedidos p ON p.id = v.pedido_id
      WHERE v.muestra_id IS NULL ORDER BY v.pedido_id, v.version`);
  const porPedido = {};
  r.rows.forEach(x => (porPedido[x.pedido_id] ||= []).push(x));
  let creadas = 0;
  for(const pid of Object.keys(porPedido)){
    const filas = porPedido[pid], base = filas[0];
    const titulo = (filas.find(f => f.titulo) || {}).titulo || base.producto;
    const m = await pool.query("INSERT INTO muestras (cliente,titulo,matriz) VALUES ($1,$2,$3) RETURNING id",
      [base.cliente, titulo, JSON.stringify(base.matriz || [])]);
    await pool.query("INSERT INTO muestra_pedidos (muestra_id, pedido_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [m.rows[0].id, pid]);
    await pool.query("UPDATE pedido_muestras SET muestra_id = $1, pedido_id = NULL WHERE id = ANY($2)", [m.rows[0].id, filas.map(f => f.id)]);
    creadas++;
  }
  return creadas;
}
module.exports = { migrarMuestras };
