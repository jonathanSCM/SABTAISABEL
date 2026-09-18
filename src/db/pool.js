require("dotenv").config();
const { Pool, types } = require("pg");

/* las columnas DATE deben viajar como "YYYY-MM-DD" planas, sin que pg las
   convierta a un objeto Date (que al serializar a JSON aplica la zona horaria
   del servidor y puede correr el día) */
types.setTypeParser(1082, val => val);

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

pool.on("error", err => {
  console.error("Error inesperado en el pool de Postgres", err);
});

module.exports = pool;
