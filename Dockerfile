FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY src ./src
COPY public ./public
COPY ecosystem.config.js docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

ENV NODE_ENV=production
EXPOSE 4000

# corre con PM2 dentro del contenedor: si el proceso Node se cae, PM2 lo reinicia
# solo, en vez de dejar el contenedor entero fallando hasta que Coolify lo note.
# el entrypoint aplica el esquema (create-if-not-exists) antes de arrancar.
RUN npm install -g pm2
CMD ["./docker-entrypoint.sh"]
