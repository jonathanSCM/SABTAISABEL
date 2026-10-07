/* Enriquece pedidos YA existentes con datos de detalle realistas (desglose por
   talla/color, checklist con lo recibido, instrucciones por etapa, lista de compras,
   muestras y moldes), para que las fichas se vean como un taller real.
   Es idempotente: se puede correr varias veces. Solo toca los pedidos listados,
   y solo si existen. Uso: npm run db:seed:detalle */
const pool = require("./pool");

const MS = 86400000;
function sumaDias(iso, n){ const d = new Date(iso+"T00:00:00"); d.setDate(d.getDate()+n); return d.toISOString().slice(0,10); }
function fmt(d){ return typeof d === "string" ? d.slice(0,10) : new Date(d).toISOString().slice(0,10); }

const DETALLE = {
  "PD-0001": {
    obs:"Tallas 6 a 16, cinta institucional dorada en el cuello. Entregar planchado y en bolsa individual.",
    curva:[["6",8],["8",12],["10",14],["12",12],["14",8],["16",6]], colores:[["Azul marino",60]],
    compras:[["Botones nácar 4 hoyos","120 unidades","Blanco"],["Cierre invisible 18 cm","60 unidades","Azul marino"],["Cinta institucional","45 metros","Dorado"],["Hilo poliéster","8 conos","Azul marino"]],
    recibido:{ tela:["85 m gabardina azul marino","Llegó en 2 rollos, sin fallas"], avios:["Botones, cierres y cinta completos","Comprado por Guía"], colores:["Azul marino pantone 19-4024","Confirmado con el colegio"], diseno:["Molde y ficha aprobados","Ver ficha técnica"], insumos:["Hilos y entretela","Entretela 20 m"], info:["Lista de alumnos por talla","Enviada por secretaría"] },
    corte:"Cortar en tela simple, dirección del hilo vertical. Margen de costura 1.5 cm, dobladillo 3 cm. Marcar piquetes en cintura y sisa.",
    costura:"Cerrar costados con remalle y luego recta. Pegar cinta institucional antes de cerrar el cuello. Cierre invisible a 18 cm.",
    acabado:"Revisar hilos sueltos, botones firmes y simetría del cuello. Etiqueta interna en costado izquierdo.",
    muestra:[["Rechazada","6","Gabardina azul marino","El largo de falda debe bajar 3 cm. Cinta más angosta."],["Aprobada","10","Gabardina azul marino","Aprobada por la directora."]]
  },
  "PD-0002": {
    obs:"Reventa para temporada de fiestas. Etiqueta propia de la boutique en cuello.",
    matriz:[["S",[["Verde esmeralda",3],["Vino",2]]],["M",[["Verde esmeralda",5],["Vino",3]]],["L",[["Verde esmeralda",3],["Vino",2]]],["XL",[["Verde esmeralda",1],["Vino",1]]]],
    curva:[["S",5],["M",8],["L",5],["XL",2]], colores:[["Verde esmeralda",12],["Vino",8]],
    compras:[["Cierre invisible 50 cm","20 unidades","Verde y vino"],["Forro satinado","18 metros","Marfil"],["Etiqueta tejida","20 unidades","Negro"]],
    recibido:{ tela:["40 m crepé elastizado","2 colores, 24 m verde y 16 m vino"], avios:["Cierres y forro","Cierres de 50 cm"], colores:["Verde esmeralda y vino","Muestra física aprobada"], diseno:["Diseño aprobado por la boutique",""], insumos:["Etiquetas tejidas","20 und"], info:["Curva de tallas confirmada",""] },
    corte:"Tela doble con el derecho hacia adentro. Cortar forro aparte, 2 cm más corto que la tela. Cuidar que el estampado coincida en el centro.",
    costura:"Pinzas en busto primero, luego cierre invisible en costado. Forro suelto en el dobladillo.",
    acabado:"Planchar con paño húmedo, a baja temperatura (crepé).",
    muestra:[["Aprobada","M","Crepé elastizado","Aprobada sin cambios."]]
  },
  "PD-0005": {
    obs:"6 damas de honor, mismo color en distintos talles. Prueba intermedia a los 10 días.",
    curva:[["S",1],["M",2],["L",2],["XL",1]], colores:[["Palo de rosa",6]],
    compras:[["Cierre invisible 45 cm","6 unidades","Palo de rosa"],["Tul para vuelo","12 metros","Palo de rosa"],["Pedrería para cintura","6 sets","Perla"]],
    recibido:{ tela:["30 m satén palo de rosa","Mismo lote de tintura"], avios:["Cierres y pedrería","Pedrería comprada en bazar"], colores:["Palo de rosa confirmado","La clienta trajo la muestra de tela"], diseno:["Diseño aprobado en la prueba",""], insumos:["Tul y forro","12 m de tul"], info:["Medidas de las 6 damas",""] },
    corte:"Cortar cada vestido con la medida de su dama (ver hoja de medidas). Dejar 3 cm extra en costados para ajuste en prueba.",
    costura:"Armar corpiño con varillas. Falda con vuelo de tul en 2 capas. Prueba antes de cerrar costados.",
    bordado:"Aplicar pedrería en cintura siguiendo plantilla. Coser a mano, hilo nylon.",
    muestra:[["Aprobada","M","Satén palo de rosa","Se aprobó el modelo en talla M."]]
  },
  "PD-0007": {
    obs:"Vestido largo, escote en V. La clienta aún define si lleva mangas.",
    curva:[["M",1]], colores:[["Negro",1]],
    compras:[["Cierre invisible 55 cm","1 unidad","Negro"],["Encaje francés","2 metros","Negro"]],
    recibido:{ tela:["4 m crepé negro","Llegó la tela de la clienta"], avios:["Cierre y encaje",""], colores:["Negro",""], diseno:["Pendiente: mangas sí o no","Esperando respuesta"], insumos:["Entretela","1 m"], info:["Medidas tomadas el 18/09",""] },
    corte:"Cortar a la medida de la clienta. Esperar confirmación de mangas antes de cortar mangas.",
    costura:"Escote en V con vivo. Encaje en espalda, cierre invisible.",
    muestra:[["Aprobada","M","Crepé negro","Prueba de calce aprobada."]]
  },
  "PD-0010": {
    obs:"Blusa bordada a mano, un solo motivo floral en el pecho. Ver ficha de bordado.",
    matriz:[["S",[["Blanco",2],["Crudo",1]]],["M",[["Blanco",3],["Crudo",2]]],["L",[["Blanco",2],["Crudo",2]]]],
    curva:[["S",3],["M",5],["L",4]], colores:[["Blanco",7],["Crudo",5]],
    compras:[["Botones nacarados","60 unidades","Perla"],["Hilo de bordar","12 madejas","Rosa, verde, dorado"],["Entretela liviana","4 metros","Blanco"]],
    recibido:{ tela:["22 m algodón pima","Blanco 13 m, crudo 9 m"], avios:["Botones nacarados","Faltaban 20, se compraron después"], colores:["Blanco y crudo",""], diseno:["Motivo floral aprobado","Ver dibujo en ficha"], insumos:["Hilos de bordar","12 madejas"], info:["Curva y colores confirmados",""] },
    corte:"Cortar con 2 cm de margen extra en el pecho (por el bastidor del bordado). Marcar el centro con hilván.",
    bordado:"Bordado a mano en bastidor, motivo floral de 9 cm. Rosa, verde y dorado. Revisar el revés: sin nudos visibles.",
    costura:"Cerrar hombros y costados con remalle. Botonadura frontal de 6 botones.",
    acabado:"Planchar el bordado por el revés sobre toalla.",
    muestra:[["Rechazada","M","Algodón pima","Bordado más pequeño y más arriba."],["Aprobada","M","Algodón pima","Aprobada."]]
  },
  "PD-0012": {
    obs:"Dos vestidos de niña y uno de dama, mismo diseño. Ver cotización COT-0142.",
    curva:[["6",1],["Única adulto",1]], colores:[["Rojo",2]],
    compras:[["Cierre invisible","2 unidades","Rojo"],["Cinta de raso","3 metros","Dorado"]],
    recibido:{ tela:["5 m popelina roja",""], avios:["Cierres y cinta",""], colores:["Rojo",""], diseno:["Aprobado",""], insumos:["Entretela","1 m"], info:["Medidas de las clientas",""] },
    corte:"Un patrón de niña y uno de dama. Cuidar la dirección del hilo.",
    costura:"Cintura ajustable con cinta de raso. Cierre en espalda.",
    muestra:[["Aprobada","6","Popelina roja","Aprobada."]]
  },
  "PD-0013": {
    obs:"Vestido de 15 años, falda de tul en 3 capas, corpiño con aplicaciones.",
    curva:[["14",1]], colores:[["Celeste",1]],
    compras:[["Tul italiano","18 metros","Celeste"],["Varillas para corpiño","12 unidades","Blanco"],["Aplicaciones de encaje","3 metros","Plata"],["Cierre invisible 50 cm","1 unidad","Celeste"]],
    recibido:{ tela:["8 m satén + 18 m tul","Lote único de tintura"], avios:["Varillas, cierre, encaje","Todo en taller"], colores:["Celeste pastel","Confirmado con la clienta"], diseno:["Aprobado en 2da muestra",""], insumos:["Forro y entretela","3 m"], info:["Medidas y fecha de evento: 20/09",""] },
    corte:"Corpiño en satén con entretela. Falda: 3 capas de tul, cada una 10 cm más corta. Marcar bien los piquetes de las pinzas.",
    costura:"Armar corpiño con varillas, luego unir falda. Prueba final antes de aplicar encaje.",
    bordado:"Aplicaciones de encaje plateado en corpiño, cosidas a mano.",
    muestra:[["Rechazada","14","Satén celeste","Escote más bajo, 2 cm."],["Aprobada","14","Satén celeste","Aprobada."]]
  },
  "PD-0015": {
    obs:"Dos trajes de bautizo, bordado de iniciales. Familia pide entrega antes de la ceremonia.",
    curva:[["Única",2]], colores:[["Blanco",2]],
    compras:[["Hilo de bordar","4 madejas","Blanco"],["Botones de perla","8 unidades","Perla"],["Encaje de algodón","3 metros","Blanco"]],
    recibido:{ tela:["3 m batista","Blanco"], avios:["Botones y encaje",""], colores:["Blanco",""], diseno:["Iniciales: M y A","Confirmado por la familia"], insumos:["Hilo",""], info:["Fecha de bautizo: 20/09",""] },
    corte:"Dos trajes de talla única (0-6 meses). Cortar con costura francesa.",
    bordado:"Iniciales M y A en el pecho, bordado a mano.",
    acabado:"Planchar con vapor suave. Empacar en papel de seda.",
    muestra:[["Aprobada","Única","Batista blanca","Aprobada por la familia."]]
  },
  "PD-0016": {
    obs:"Pedido en preparación: falta confirmar lista de talles definitiva con el colegio.",
    curva:[["8",6],["10",9],["12",10],["14",6],["16",4]], colores:[["Granate",35]],
    compras:[["Botones metálicos dorados","70 unidades","Dorado"],["Cierre 20 cm","35 unidades","Granate"],["Escudo bordado","35 unidades","Colores institucionales"]],
    recibido:{ tela:["58 m gabardina granate","Llegó parcial: faltan 12 m"], avios:["Botones recibidos","Cierres pendientes"], colores:["Granate",""], diseno:["Molde del año anterior reutilizado","Archivado en moldes"] },
    corte:"Cortar por tallas. Contar piezas contra la hoja de pedido antes de pasar a costura.",
    costura:"Mismo proceso que el uniforme del año pasado. Escudo bordado en el pecho izquierdo.",
    muestra:[["Pendiente","10","Gabardina granate","Esperando aprobación del colegio."]]
  },
  "PD-0017": {
    obs:"Segunda tanda de reventa. Mismo molde que PD-0002, otros colores.",
    matriz:[["S",[["Mostaza",2],["Negro",2]]],["M",[["Mostaza",4],["Negro",2]]],["L",[["Mostaza",2],["Negro",3]]]],
    curva:[["S",4],["M",6],["L",5]], colores:[["Mostaza",8],["Negro",7]],
    compras:[["Cierre invisible 50 cm","15 unidades","Mostaza y negro"],["Forro satinado","12 metros","Marfil"]],
    recibido:{ tela:["30 m crepé","Mostaza 16 m, negro 14 m"], avios:["Cierres","Pendiente forro"], colores:["Mostaza y negro",""] },
    corte:"Reutilizar molde archivado de PD-0002. Cortar forro aparte.",
    costura:"Igual a PD-0002: pinzas, cierre invisible, forro suelto.",
    muestra:[["Aprobada","M","Crepé","Se reutiliza la muestra aprobada de PD-0002."]]
  },
  "PD-0020": {
    obs:"Trajes de bautizo para la parroquia, entrega para el domingo de bautizos.",
    curva:[["Única",10]], colores:[["Blanco",6],["Marfil",4]],
    compras:[["Batista","12 metros","Blanco y marfil"],["Botones de perla","40 unidades","Perla"],["Cinta de raso","10 metros","Blanco"]],
    recibido:{ tela:["12 m batista","Blanco 7 m, marfil 5 m"], avios:["Botones y cinta",""] },
    corte:"Talla única. Cortar 10 trajes, 6 blancos y 4 marfil.",
    costura:"Costura francesa en costados. Cinta de raso en la cintura."
  },
  "PD-0024": {
    obs:"Blusas bordadas, lote grande. Bordado por proveedor externo (terceriza).",
    matriz:[["S",[["Blanco",4],["Rosa",2]]],["M",[["Blanco",5],["Rosa",3]]],["L",[["Blanco",3],["Rosa",3]]]],
    curva:[["S",6],["M",8],["L",6]], colores:[["Blanco",12],["Rosa",8]],
    compras:[["Botones nacarados","120 unidades","Perla"],["Entretela liviana","8 metros","Blanco"],["Etiqueta de marca","20 unidades","Negro"]],
    recibido:{ tela:["40 m algodón pima","Blanco 24 m, rosa 16 m"], avios:["Botones recibidos",""], colores:["Blanco y rosa",""], diseno:["Motivo floral enviado al bordador",""] },
    corte:"Cortar todas las piezas delanteras con 2 cm de margen extra para bordado.",
    bordado:"Bordado tercerizado: enviar piezas cortadas, recibir en 5 días. Controlar tamaño del motivo (9 cm).",
    tercer:{ bordado:"Taller de bordado Esperanza" },
    muestra:[["Aprobada","M","Algodón pima","Aprobada."]]
  },
  "PD-0026": {
    obs:"Uniforme de gala, segunda tanda del colegio. Mismo molde del año pasado.",
    curva:[["6",8],["8",12],["10",14],["12",12],["14",8],["16",6]], colores:[["Azul marino",60]],
    compras:[["Botones nácar 4 hoyos","120 unidades","Blanco"],["Cierre invisible 18 cm","60 unidades","Azul marino"],["Cinta institucional","45 metros","Dorado"]],
    recibido:{ tela:["85 m gabardina azul marino",""], avios:["Botones recibidos","Faltan cierres"] },
    corte:"Orden de corte semanal con Lucho. Dejar moldes con la tela.",
    costura:"Igual que PD-0001.",
    muestra:[["Aprobada","10","Gabardina azul marino","Se reutiliza muestra aprobada de PD-0001."]]
  },
  "PD-0035": {
    obs:"Tercera tanda de vestidos de reventa.",
    curva:[["S",5],["M",8],["L",5]], colores:[["Azul petróleo",18]],
    compras:[["Cierre invisible 50 cm","18 unidades","Azul petróleo"],["Forro satinado","14 metros","Marfil"]],
    recibido:{ tela:["34 m crepé azul petróleo",""] },
    corte:"Reutilizar molde de PD-0002.",
    costura:"Igual a PD-0002."
  }
};

/* puntos de control y materiales típicos por etapa: salen como casilleros y tabla
   en la hoja impresa de cada etapa */
const CONTROLES = {
  corte:["Verificar tono y fallas de la tela","Contar piezas por talla contra la hoja de pedido","Marcar piquetes y pinzas","Atar cada talla en su bolsa con etiqueta"],
  costura:["Revisar costuras sin saltos de puntada","Verificar simetría de piezas","Cierre y botones firmes","Medir contra la tabla de tallas"],
  bordado:["Motivo del tamaño y lugar indicados","Sin nudos ni hilos sueltos en el revés","Comparar con la foto de referencia"],
  acabado:["Cortar hilos sueltos","Etiquetas en el lugar correcto","Sin manchas ni huecos","Contar prendas contra la hoja de pedido"],
  planchado:["Planchar a la temperatura indicada para la tela","Doblar o colgar según pedido","Empacar en bolsa individual"]
};
const MATERIALES_ETAPA = {
  corte:[{item:"Tiza de sastre",cantidad:"2",color:"Blanca"},{item:"Etiquetas de talla",cantidad:"1 pliego",color:""}],
  costura:[{item:"Hilo poliéster",cantidad:"según pedido",color:"Del color de la tela"},{item:"Agujas",cantidad:"1 caja",color:""}],
  acabado:[{item:"Etiquetas internas",cantidad:"una por prenda",color:"Negro"}],
  planchado:[{item:"Bolsas individuales",cantidad:"una por prenda",color:"Transparente"}]
};

const MOLDES = {
  "Colegio Santa Ana": [["Uniforme de gala escolar","Molde base por tallas 6 a 16. Dobladillo 3 cm. Cinta institucional en cuello.","Cati"]],
  "Boutique Flor de Lis": [["Vestido de dama (reventa)","Molde corte A con pinzas en busto, cierre invisible lateral. Escalado S a XL.","Cati"],["Blusa bordada a mano","Molde de blusa recta, hombros caídos. Margen extra en pecho para bastidor.","Cati"]],
  "Colegio Juan XXIII": [["Uniforme de gala escolar","Molde por tallas 8 a 16, pretina elástica atrás.","Cati"]],
  "Familia Rojas": [["Vestidos de dama de honor","Corpiño con varillas y falda con vuelo. Medidas individuales por dama.","Cati"],["Traje de bautizo","Molde talla única 0-6 meses, costura francesa.","Cati"]],
  "Parroquia San José": [["Traje de bautizo","Talla única con botonadura trasera. Reutilizable por temporada.","Cati"]],
  "Sra. Renata Villegas": [["Vestido de quinceañera","Corpiño ajustado, falda de 3 capas de tul.","Cati"]]
};

async function main(){
  const ids = Object.keys(DETALLE);
  const ex = await pool.query("SELECT id, estado, registro, compromiso, cliente FROM pedidos WHERE id = ANY($1)", [ids]);
  const orden = ["Preparación","En producción","Terminado","Entregado"];
  let n = 0;
  for(const p of ex.rows){
    const d = DETALLE[p.id]; const reg = fmt(p.registro);
    const idxEstado = orden.indexOf(p.estado);
    const listo = idxEstado >= 1; // ya entró a producción: checklist completo

    // con matriz talla x color, la curva (por talla) y los colores (por color) se derivan de ella
    let curva = d.curva.map(([talla,cant])=>({talla,consumo:1,cant}));
    let colores = d.colores.map(([color,cant])=>({color,cant}));
    let matriz = [];
    if(d.matriz){
      matriz = d.matriz.map(([talla,cols])=>({ talla, consumo:1, colores:cols.map(([color,cant])=>({color,cant})) }));
      curva = matriz.map(r => ({ talla:r.talla, consumo:1, cant:r.colores.reduce((a,c)=>a+c.cant,0) }));
      const por = {}; matriz.forEach(r => r.colores.forEach(c => { por[c.color] = (por[c.color]||0) + c.cant; }));
      colores = Object.entries(por).map(([color,cant])=>({color,cant}));
    }
    await pool.query("UPDATE pedidos SET obs=$1, curva=$2, colores=$3, matriz=$4, compras=$5 WHERE id=$6",
      [d.obs, JSON.stringify(curva), JSON.stringify(colores), JSON.stringify(matriz),
       JSON.stringify(d.compras.map(([item,cantidad,color])=>({item,cantidad,color}))), p.id]);

    // checklist: lo recibido por ítem; completo si ya está en producción o más allá
    const quien = "Guía";
    let k = 0;
    for(const slug of ["tela","avios","colores","diseno","insumos","info"]){
      const rec = d.recibido[slug];
      k++;
      if(rec && (listo || k <= 4)){
        await pool.query("UPDATE pedido_checklist SET hecho=true, fecha=$1, responsable=$2, cantidad=$3, notas=$4 WHERE pedido_id=$5 AND item=$6",
          [sumaDias(reg, 2+k), quien, rec[0], rec[1]||"", p.id, slug]);
      } else if(listo){
        await pool.query("UPDATE pedido_checklist SET hecho=true, fecha=$1, responsable=$2 WHERE pedido_id=$3 AND item=$4",
          [sumaDias(reg, 2+k), quien, p.id, slug]);
      }
    }

    // producción: instrucciones y avance según el estado del pedido
    const etapas = [["corte","corte",1],["costura","costura",2],["bordado","bordado",3],["acabado","acabado",4],["planchado",null,5]];
    for(const [slug, key, ord] of etapas){
      const notas = key && d[key] ? d[key] : (slug === "planchado" ? "Planchar por el revés, empaquetar en bolsa individual." : "");
      const resp = slug === "corte" ? "Lucho" : slug === "costura" ? "Tania / Miley" : slug === "bordado" ? "Rosa" : slug === "acabado" ? "Meche" : "Meche";
      let estado = "Pendiente", real = null;
      if(idxEstado >= 2){ estado = "Completado"; real = sumaDias(reg, 8+ord*2); }
      else if(idxEstado === 1){ estado = ord <= 2 ? "Completado" : ord === 3 ? "En proceso" : "Pendiente"; if(estado === "Completado") real = sumaDias(reg, 8+ord*2); }
      const tipo = slug === "bordado" && d.tercer ? "Tercerizado" : "Interno";
      const respFinal = tipo === "Tercerizado" ? d.tercer.bordado : resp;
      await pool.query("UPDATE pedido_produccion SET notas=$1, responsable=$2, tipo=$3, estado=$4, fecha_prevista=$5, fecha_real=$6, controles=$7, materiales=$8 WHERE pedido_id=$9 AND etapa=$10",
        [notas, respFinal, tipo, estado, sumaDias(reg, 9+ord*2), real,
         JSON.stringify(CONTROLES[slug] || []), JSON.stringify(MATERIALES_ETAPA[slug] || []), p.id, slug]);
    }

    // muestras: se rehacen para ser idempotente
    await pool.query("DELETE FROM pedido_muestras WHERE pedido_id=$1", [p.id]);
    if(d.muestra){
      for(let v=0; v<d.muestra.length; v++){
        const [estadoM, talla, mat, coment] = d.muestra[v];
        await pool.query(
          `INSERT INTO pedido_muestras (pedido_id,version,estado,fecha,responsable,cambios_solicitados,comentarios_cliente,fotos,talla_aprobada,materiales,aprobado_por,aprobado_en)
           VALUES ($1,$2,$3,$4,'Priscila',$5,$6,'[]',$7,$8,$9,$10)`,
          [p.id, v+1, estadoM, sumaDias(reg, 3+v*3), estadoM==="Rechazada" ? coment : "", estadoM==="Rechazada" ? "" : coment,
           talla, mat, estadoM==="Aprobada" ? "María Paz" : null, estadoM==="Aprobada" ? sumaDias(reg, 4+v*3)+"T15:00:00Z" : null]);
      }
    }
    n++;
  }

  // moldes por cliente (se rehacen)
  await pool.query("DELETE FROM moldes WHERE notas <> '' AND responsable = 'Cati'");
  for(const [cliente, lista] of Object.entries(MOLDES)){
    const ped = await pool.query("SELECT id FROM pedidos WHERE cliente=$1 ORDER BY id LIMIT 1", [cliente]);
    for(const [prenda, notas, resp] of lista){
      await pool.query("INSERT INTO moldes (cliente,prenda,pedido_id,notas,fotos,responsable) VALUES ($1,$2,$3,$4,'[]',$5)",
        [cliente, prenda, ped.rows[0] ? ped.rows[0].id : null, notas, resp]);
    }
  }
  console.log("OK: detalle cargado en "+n+" pedidos y moldes de "+Object.keys(MOLDES).length+" clientes.");
  await pool.end();
}
main().catch(e => { console.error(e); process.exit(1); });
