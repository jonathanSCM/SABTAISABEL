/* Las etapas fijas de producción de este taller (coinciden con las
   especialidades usadas en Sprint 1 para separar responsable/etapa).
   Cada una se marca Interno o Tercerizado, con su responsable o proveedor,
   estado y fechas — informativo, no bloquea transiciones de estado. */
const ETAPAS_PRODUCCION = [
  { slug:"corte",     label:"Corte" },
  { slug:"costura",   label:"Costura" },
  { slug:"bordado",   label:"Bordado/Sublimado" },
  { slug:"acabado",   label:"Acabado" },
  { slug:"planchado", label:"Planchado" }
];
const ETAPA_LABEL = Object.fromEntries(ETAPAS_PRODUCCION.map(e => [e.slug, e.label]));

async function sembrarProduccion(client, pedidoId){
  for(let i=0;i<ETAPAS_PRODUCCION.length;i++){
    await client.query(
      "INSERT INTO pedido_produccion (pedido_id,etapa,orden) VALUES ($1,$2,$3) ON CONFLICT (pedido_id,etapa) DO NOTHING",
      [pedidoId, ETAPAS_PRODUCCION[i].slug, i+1]
    );
  }
}

module.exports = { ETAPAS_PRODUCCION, ETAPA_LABEL, sembrarProduccion };
