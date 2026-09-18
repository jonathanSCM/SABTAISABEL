/* Los 6 ítems fijos del checklist de preparación. El slug es lo que se guarda
   en la base y lo que viaja en la URL de la API; la etiqueta es lo que ve el
   usuario. Es informativo: no bloquea el paso a producción (a diferencia de
   la muestra, que sí lo bloquea). */
const CHECKLIST_ITEMS = [
  { slug:"tela",    label:"Tela recibida" },
  { slug:"avios",   label:"Avíos disponibles" },
  { slug:"colores", label:"Colores confirmados" },
  { slug:"diseno",  label:"Diseño aprobado" },
  { slug:"insumos", label:"Insumos comprados" },
  { slug:"info",    label:"Información completa" }
];
const CHECKLIST_LABEL = Object.fromEntries(CHECKLIST_ITEMS.map(i => [i.slug, i.label]));

async function sembrarChecklist(client, pedidoId){
  for(let i=0;i<CHECKLIST_ITEMS.length;i++){
    await client.query(
      "INSERT INTO pedido_checklist (pedido_id,item,orden) VALUES ($1,$2,$3) ON CONFLICT (pedido_id,item) DO NOTHING",
      [pedidoId, CHECKLIST_ITEMS[i].slug, i+1]
    );
  }
}

module.exports = { CHECKLIST_ITEMS, CHECKLIST_LABEL, sembrarChecklist };
