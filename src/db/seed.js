const bcrypt = require("bcryptjs");
const pool = require("./pool");
const { sembrarChecklist } = require("./checklist");
const { sembrarProduccion } = require("./produccion");

const MS = 86400000;
function hoy(){ const d = new Date(); d.setHours(0,0,0,0); return d; }
function iso(d){ return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"); }
function addDays(d,n){ const x = new Date(d.getTime()); x.setDate(x.getDate()+n); return x; }
function isoOff(n){ return iso(addDays(hoy(), n)); }

const RESP_ETAPA_SEED = {
  "Marta – corte": { responsable:"Marta", etapa:"Corte" },
  "Luis – costura": { responsable:"Luis", etapa:"Costura" },
  "Rosa – acabados": { responsable:"Rosa", etapa:"Acabado" },
  "Diego – bordado": { responsable:"Diego", etapa:"Bordado/Sublimado" },
  "Henry – planchado": { responsable:"Henry", etapa:"Planchado" },
  "": { responsable:"", etapa:"" }
};

/* cliente, prenda, cantidad, offset entrega, offset registro, estado, prioridad, responsable, obs */
const SEED_PEDIDOS = [
  ["Colegio Santa Ana","Uniforme de gala escolar",60,-9,-34,"Entregado","Alta","Marta – corte","Tallas 6 a 16, cinta institucional"],
  ["Boutique Flor de Lis","Vestido de dama (reventa)",20,-8,-30,"Entregado","Normal","Luis – costura",""],
  ["Sra. Valentina Prado","Vestido de quinceañera",1,-7,-26,"Entregado","Alta","Diego – bordado","Bordado en pedrería, falda de tul"],
  ["Parroquia San José","Traje de bautizo",1,-7,-22,"Entregado","Baja","Rosa – acabados",""],
  ["Familia Rojas","Vestidos de dama de honor",6,-6,-27,"En producción","Alta","Diego – bordado","6 damas, mismo color distinto talle"],
  ["Colegio Juan XXIII","Uniforme de gala escolar",40,-6,-25,"Entregado","Normal","Luis – costura",""],
  ["Sra. Marisol Duarte","Vestido de gala",1,-5,-20,"Preparación","Normal","","El cliente aún no aprueba el color"],
  ["Sra. Camila Ibáñez","Vestido de primera comunión",1,-4,-18,"Entregado","Normal","Rosa – acabados",""],
  ["Sra. Daniela Suárez","Traje sastre a medida",1,-3,-21,"Terminado","Normal","Marta – corte","Listo en taller, esperando recojo"],
  ["Boutique Flor de Lis","Blusa bordada a mano",12,-2,-19,"En producción","Alta","Marta – corte","Falta avío: botones nacarados"],
  ["Colegio Santa Ana","Conjunto madre e hija",8,-1,-14,"Terminado","Normal","Diego – bordado","Bordado terminado"],
  ["Sra. Celia","Vestidos de niña y vestido de dama",2,0,-16,"En producción","Alta","Luis – costura","Curva de tallas, ver cotización COT-0142"],
  ["Sra. Renata Villegas","Vestido de quinceañera",1,0,-15,"En producción","Normal","Marta – corte",""],
  ["Sra. Valentina Prado","Vestido de gala",1,0,-11,"Terminado","Baja","Rosa – acabados","Listo para despacho"],
  ["Familia Rojas","Trajes de bautizo (niño y niña)",2,1,-13,"En producción","Alta","Diego – bordado","Bordado con iniciales"],
  ["Colegio Juan XXIII","Uniforme de gala escolar",35,1,-12,"Preparación","Normal","Rosa – acabados",""],
  ["Boutique Flor de Lis","Vestido de dama (reventa)",15,2,-17,"Preparación","Normal","Diego – bordado","Bordado frontal"],
  ["Sra. Camila Ibáñez","Vestido de quinceañera",1,3,-10,"En producción","Alta","Marta – corte","Versión con capa, segunda prueba"],
  ["Colegio Santa Ana","Conjunto madre e hija",6,3,-9,"Preparación","Normal","Luis – costura",""],
  ["Parroquia San José","Trajes de bautizo",10,3,-8,"Preparación","Normal","","Pedido recurrente, primer sábado de mes"],
  ["Sra. Marisol Duarte","Vestido de gala",1,3,-6,"Preparación","Baja","","Pendiente confirmar tela"],
  ["Familia Rojas","Vestido de primera comunión",1,5,-7,"Preparación","Alta","Luis – costura",""],
  ["Colegio Juan XXIII","Uniforme de gala escolar",50,5,-5,"Preparación","Normal","",""],
  ["Boutique Flor de Lis","Blusa bordada a mano",20,6,-9,"Preparación","Normal","Marta – corte",""],
  ["Sra. Celia","Vestido de dama de honor",1,8,-6,"Preparación","Alta","","Entrega para boda de octubre"],
  ["Colegio Santa Ana","Uniforme de gala escolar",60,8,-5,"Preparación","Normal","Marta – corte","Nombre bordado en cada prenda"],
  ["Sra. Daniela Suárez","Vestido de quinceañera",1,8,-4,"Preparación","Normal","","Presupuesto con pedrería"],
  ["Boutique Flor de Lis","Vestido de dama (reventa)",25,8,-4,"Preparación","Normal","Rosa – acabados",""],
  ["Sra. Renata Villegas","Vestido de gala",1,8,-3,"Preparación","Alta","","Requiere tela importada"],
  ["Sra. Marisol Duarte","Blusa bordada a mano",1,8,-2,"Preparación","Baja","",""],
  ["Parroquia San José","Trajes de bautizo",8,10,-4,"Preparación","Normal","",""],
  ["Sra. Camila Ibáñez","Vestido de gala",1,12,-3,"Preparación","Normal","",""],
  ["Familia Rojas","Conjunto madre e hija",4,12,-2,"Preparación","Normal","",""],
  ["Colegio Juan XXIII","Uniforme de gala escolar",45,15,-1,"Preparación","Baja","",""],
  ["Boutique Flor de Lis","Vestido de dama (reventa)",18,19,-1,"Preparación","Normal","",""],
  ["Sra. Valentina Prado","Traje sastre a medida",1,23,0,"Preparación","Baja","","Cotización aprobada por WhatsApp"]
];

const ESTADOS = ["Preparación","En producción","Terminado","Entregado"];

const TERMS_PROD_DEFAULT = `Los precios no incluyen IGV. La presente cotización se ha realizado en base a {{UND}} unidades y tiene una vigencia de {{VIG}} días.
Al realizar el pago se deberá previamente solicitar la factura, la cual se emite a nombre del cliente, incluyendo el IGV.
La muestra y el molde aprobados son necesarios para programar el inicio de producción y se deben cancelar al 100%.
Para iniciar la producción se debe abonar el 50% del total de la misma.
Si durante el proceso se modifica la muestra y/o el molde, se detiene la producción y se sujeta a una nueva cotización.
El tiempo de entrega a partir de la aprobación de la muestra y el 100% de insumos entregados es de 30 días hábiles.
Luego de la fecha de entrega, el cliente tiene 5 días hábiles para hacer control de calidad a las prendas.`;
const TERMS_MUESTRA_DEFAULT = `El cliente realiza su solicitud y se elabora una ficha técnica con especificaciones en el plano. Se abona el 100% para dar inicio al proceso.
El costo de la muestra no incluye la tela; el cliente provee los materiales de referencia.
El costo de la muestra es referente a una sola talla e incluye 1 contramuestra.
Una vez aprobada la muestra no se aceptan modificaciones al modelo y especificaciones.`;

const SEED_COTIZACIONES = [
  {
    id:"COT-0142", cliente:"Sra. Celia", prenda:"Vestidos de niña y vestido de dama",
    obs:"Curva de tallas para 40 unidades. Variantes en rojo y blanco, escote corazón, falda de tres capas.",
    fecha:isoOff(-16), vigencia:15, estado:"Aprobada", pedidoId:null,
    curva:[ {talla:"4-6",consumo:1.05,cant:5},{talla:"8-10",consumo:1.05,cant:6},{talla:"12-14",consumo:1.05,cant:5},
             {talla:"16-S",consumo:1.25,cant:4},{talla:"S-M",consumo:1.85,cant:12},{talla:"L",consumo:1.95,cant:8} ],
    colores:[ {color:"Rojo",cant:65},{color:"Blanco",cant:36} ],
    groups:[
      { key:"tela", label:"Tela", rows:[ {n:"Tela base", c:4, p:0} ] },
      { key:"avios", label:"Avíos", rows:[ {n:"Reguladores", c:1, p:1.00},{n:"Elástico", c:1, p:1.50},{n:"Multiaguja", c:2, p:3.80},{n:"Hilo", c:89,p:0.05} ] },
      { key:"empaque", label:"Empaque", rows:[ {n:"Tag", c:1, p:0.20},{n:"Bolsa", c:1, p:0.20} ] },
      { key:"produccion", label:"Producción", rows:[ {n:"Limpieza", c:1, p:1.80},{n:"Plancha", c:1, p:2.00},{n:"Confección", c:1, p:45.00},{n:"Corte", c:1, p:3.00} ] }
    ],
    muestra:350, molde:250
  },
  {
    id:"COT-0143", cliente:"Sra. Valentina Prado", prenda:"Vestido de quinceañera",
    obs:"Tul bordado en pedrería, falda con tres capas y capa desmontable.",
    fecha:isoOff(-4), vigencia:15, estado:"Enviada", pedidoId:null,
    curva:[ {talla:"10", consumo:8, cant:1} ],
    colores:[ {color:"Rosa palo", cant:1} ],
    groups:[
      { key:"tela", label:"Tela", rows:[ {n:"Tul bordado", c:8, p:45.00},{n:"Forro", c:6, p:12.00} ] },
      { key:"avios", label:"Avíos", rows:[ {n:"Pedrería aplicada", c:1, p:200.00},{n:"Cierre invisible", c:1, p:8.00} ] },
      { key:"empaque", label:"Empaque", rows:[ {n:"Caja regalo", c:1, p:25.00} ] },
      { key:"produccion", label:"Producción", rows:[ {n:"Confección", c:1, p:280.00},{n:"Corte", c:1, p:40.00},{n:"Planchado", c:1, p:15.00} ] }
    ],
    muestra:180, molde:0
  },
  {
    id:"COT-0144", cliente:"Familia Rojas", prenda:"Trajes de bautizo (niño y niña)",
    obs:"Conjunto para bautizo: traje de niño y vestido de niña a juego, ambos en blanco.",
    fecha:isoOff(-1), vigencia:10, estado:"Borrador", pedidoId:null,
    curva:[ {talla:"Niño 3-6m", consumo:1.4, cant:1},{talla:"Niña 3-6m", consumo:1.6, cant:1} ],
    colores:[ {color:"Blanco", cant:2} ],
    groups:[
      { key:"tela", label:"Tela", rows:[ {n:"Piqué de algodón", c:3, p:22.00} ] },
      { key:"avios", label:"Avíos", rows:[ {n:"Botones nacarados", c:6, p:0.80},{n:"Cintas", c:2, p:3.50} ] },
      { key:"empaque", label:"Empaque", rows:[ {n:"Caja + papel seda", c:1, p:15.00} ] },
      { key:"produccion", label:"Producción", rows:[ {n:"Confección", c:1, p:120.00},{n:"Bordado iniciales", c:1, p:35.00} ] }
    ],
    muestra:90, molde:0
  },
  {
    id:"COT-0145", cliente:"Boutique Flor de Lis", prenda:"Vestidos de dama de honor",
    obs:"6 vestidos en verde salvia para el cortejo, mismo diseño en distintas tallas.",
    fecha:isoOff(-6), vigencia:15, estado:"Rechazada", pedidoId:null,
    curva:[ {talla:"S", consumo:2.6, cant:2},{talla:"M", consumo:2.8, cant:3},{talla:"L", consumo:3.0, cant:1} ],
    colores:[ {color:"Verde salvia", cant:6} ],
    groups:[
      { key:"tela", label:"Tela", rows:[ {n:"Chiffon", c:3, p:28.00} ] },
      { key:"avios", label:"Avíos", rows:[ {n:"Cierres invisibles", c:6, p:6.00},{n:"Forro", c:6, p:9.00} ] },
      { key:"empaque", label:"Empaque", rows:[ {n:"Bolsa portatrajes", c:6, p:5.00} ] },
      { key:"produccion", label:"Producción", rows:[ {n:"Confección", c:6, p:95.00},{n:"Corte", c:6, p:12.00} ] }
    ],
    muestra:150, molde:100
  }
];

function qUnidades(q){ return q.curva.reduce((s,r)=>s+r.cant,0); }

async function seed(){
  const client = await pool.connect();
  try{
    await client.query("BEGIN");

    const already = await client.query("SELECT count(*)::int AS n FROM usuarios");
    if(already.rows[0].n > 0){
      console.log("La base ya tiene usuarios — se omite el seed para no duplicar datos.");
      await client.query("ROLLBACK");
      return;
    }

    const DEFAULT_PASSWORD = "SantaIsabel2026!";
    const hash = await bcrypt.hash(DEFAULT_PASSWORD, 10);
    const usuarios = [
      ["Administración","admin@santaisabel.local","admin"],
      ["Marta","marta@santaisabel.local","operador"],
      ["Luis","luis@santaisabel.local","operador"],
      ["Rosa","rosa@santaisabel.local","operador"],
      ["Diego","diego@santaisabel.local","operador"],
      ["Henry","henry@santaisabel.local","operador"]
    ];
    let adminId = null, adminNombre = "Administración";
    for(const [nombre,email,rol] of usuarios){
      const r = await client.query(
        "INSERT INTO usuarios (nombre,email,password_hash,rol) VALUES ($1,$2,$3,$4) RETURNING id",
        [nombre,email,hash,rol]
      );
      if(rol === "admin"){ adminId = r.rows[0].id; adminNombre = nombre; }
    }

    for(const q of SEED_COTIZACIONES){
      await client.query(
        `INSERT INTO cotizaciones (id,cliente,prenda,obs,fecha,vigencia,estado,pedido_id,curva,colores,groups,muestra,molde,terms_prod,terms_muestra,created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [q.id,q.cliente,q.prenda,q.obs,q.fecha,q.vigencia,q.estado,q.pedidoId,
         JSON.stringify(q.curva),JSON.stringify(q.colores),JSON.stringify(q.groups),
         q.muestra,q.molde,
         TERMS_PROD_DEFAULT.replace("{{UND}}",String(qUnidades(q))).replace("{{VIG}}",String(q.vigencia)),
         TERMS_MUESTRA_DEFAULT, adminId]
      );
    }
    await client.query("SELECT setval('cotizacion_seq', 145, true)");

    let seq = 0;
    for(const r of SEED_PEDIDOS){
      seq += 1;
      const id = "PD-"+String(seq).padStart(4,"0");
      const re = RESP_ETAPA_SEED[r[7]] || { responsable:r[7], etapa:"" };
      const compromiso = isoOff(r[3]);
      const solicitada = isoOff(r[3]-2);
      const registro = isoOff(r[4]);
      const estado = r[5];
      await client.query(
        `INSERT INTO pedidos (id,cliente,producto,cantidad,registro,solicitada,compromiso,estado,prioridad,responsable,etapa,obs,created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [id, r[0], r[1], r[2], registro, solicitada, compromiso, estado, r[6], re.responsable, re.etapa, r[8], adminId]
      );

      const hasta = ESTADOS.indexOf(estado);
      const ini = new Date(registro), fin = new Date(compromiso) < hoy() ? new Date(compromiso) : hoy();
      const pasos = Math.max(hasta,1);
      await client.query("INSERT INTO pedido_historial (pedido_id,fecha,texto) VALUES ($1,$2,$3)", [id, registro, "Pedido registrado"]);
      for(let i=1;i<=hasta;i++){
        const t = ini.getTime() + (fin-ini)*(i/(pasos+1));
        await client.query("INSERT INTO pedido_historial (pedido_id,fecha,texto) VALUES ($1,$2,$3)", [id, iso(new Date(t)), "Estado → "+ESTADOS[i]]);
      }

      /* checklist y producción: para pedidos que ya avanzaron más allá de Preparación
         se dejan completos/en curso, para que la data sembrada sea consistente con
         las reglas reales (nada de "En producción" sin una muestra aprobada) */
      await sembrarChecklist(client, id);
      await sembrarProduccion(client, id);
      if(estado !== "Preparación"){
        await client.query(
          "UPDATE pedido_checklist SET hecho=true, fecha=$1, responsable=$2 WHERE pedido_id=$3",
          [registro, re.responsable || "Equipo", id]
        );
        await client.query(
          "INSERT INTO pedido_muestras (pedido_id,version,estado,fecha,responsable,aprobado_por,aprobado_en) VALUES ($1,1,'Aprobada',$2,$3,$4,$5)",
          [id, registro, re.responsable || "Equipo", adminNombre, registro]
        );
        await client.query("INSERT INTO pedido_historial (pedido_id,fecha,texto) VALUES ($1,$2,'Muestra 1 registrada')", [id, registro]);
        await client.query("INSERT INTO pedido_historial (pedido_id,fecha,texto) VALUES ($1,$2,'Muestra 1 → Aprobada (muestra final)')", [id, registro]);
      }
      if(estado === "Terminado" || estado === "Entregado"){
        await client.query(
          "UPDATE pedido_produccion SET estado='Completado', fecha_real=$1, responsable=$2 WHERE pedido_id=$3",
          [compromiso, re.responsable || "Equipo", id]
        );
      } else if(estado === "En producción"){
        await client.query(
          "UPDATE pedido_produccion SET estado='En proceso', responsable=$1 WHERE pedido_id=$2",
          [re.responsable || "Equipo", id]
        );
      }
      if(estado === "Entregado"){
        await client.query("UPDATE pedidos SET guia_generada_en = now() WHERE id = $1", [id]);
        await client.query("INSERT INTO pedido_historial (pedido_id,fecha,texto) VALUES ($1,$2,'Guía de entrega generada')", [id, compromiso]);
      }
    }
    await client.query("SELECT setval('pedido_seq', $1, true)", [seq]);

    await client.query("COMMIT");
    console.log("OK: seed cargado —", usuarios.length, "usuarios,", SEED_COTIZACIONES.length, "cotizaciones,", SEED_PEDIDOS.length, "pedidos.");
    console.log("Credenciales de todos los usuarios sembrados (cambiar luego):");
    usuarios.forEach(([,email]) => console.log("  "+email+" / "+DEFAULT_PASSWORD));
  } catch(err){
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch(err => { console.error(err); process.exit(1); });
