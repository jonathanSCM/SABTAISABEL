#!/bin/sh
set -e
echo "Aplicando esquema de base de datos (idempotente)..."
node src/db/migrate.js
echo "Arrancando la app con PM2..."
exec pm2-runtime ecosystem.config.js
