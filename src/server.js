const fs = require("fs");
const http = require("http");
const https = require("https");
const app = require("./app");
const pool = require("./db/pool");

const PORT = process.env.PORT || 4000;

/* HTTPS nativo: opcional. En producción real, lo normal es que un proxy
   (Coolify/Traefik/nginx) termine TLS con un certificado real (Let's Encrypt)
   y le hable a esta app por HTTP dentro de la red interna — ver Dockerfile.
   Estas variables son para cuando este proceso corre solo, sin ese proxy
   delante (por ejemplo un VPS chico), usando un certificado propio. */
let server;
if(process.env.SSL_KEY_PATH && process.env.SSL_CERT_PATH){
  const options = {
    key: fs.readFileSync(process.env.SSL_KEY_PATH),
    cert: fs.readFileSync(process.env.SSL_CERT_PATH)
  };
  server = https.createServer(options, app);
} else {
  server = http.createServer(app);
}

server.listen(PORT, () => {
  const proto = server instanceof https.Server ? "https" : "http";
  console.log(`Santa Isabel corriendo en ${proto}://localhost:${PORT}`);
});

/* apagado ordenado: para que PM2/Docker puedan reiniciar el proceso sin dejar
   conexiones de Postgres colgadas ni cortar una request a la mitad */
function apagar(señal){
  console.log(`\n${señal} recibido, cerrando...`);
  server.close(async () => {
    try{ await pool.end(); } catch(e){ /* ya cerrado */ }
    console.log("Servidor y pool de Postgres cerrados.");
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on("SIGTERM", () => apagar("SIGTERM"));
process.on("SIGINT", () => apagar("SIGINT"));
