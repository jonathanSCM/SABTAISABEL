#!/bin/sh
# Genera un certificado autofirmado para correr esta app directo por HTTPS
# (sin un proxy como Coolify/Traefik/nginx delante). Sirve para un VPS chico
# o para probar HTTPS en local. El navegador va a mostrar una advertencia de
# "certificado no confiable" porque no lo emitió una autoridad real — para un
# dominio público de verdad, usá Coolify (Let's Encrypt automático) en vez de esto.
set -e
mkdir -p certs
openssl req -x509 -nodes -newkey rsa:2048 -days 825 \
  -keyout certs/key.pem -out certs/cert.pem \
  -subj "/C=BO/O=Santa Isabel/CN=localhost"
echo ""
echo "Listo: certs/key.pem y certs/cert.pem"
echo "Agregá a tu .env:"
echo "  SSL_KEY_PATH=$(pwd)/certs/key.pem"
echo "  SSL_CERT_PATH=$(pwd)/certs/cert.pem"
