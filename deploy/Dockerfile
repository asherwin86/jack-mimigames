FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server ./server
ENV PVP=1 PORT=7443 DATA_FILE=/data/world.json
VOLUME /data
EXPOSE 7443
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1:7443/health || exit 1
CMD ["node", "server/blockcraft-server.mjs"]
