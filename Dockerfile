# Runs the ACCOUNT SERVER (hub-server/) from the repository root, for hosts that build the root of the repo with Docker
# (Back4app Containers builds it this way by default). The website is a separate, static thing (see render.yaml); this
# image does not contain it. Settings are environment variables: HASH_PEPPER (the one the accounts were made with),
# UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN (where accounts are kept), optionally PORT.
FROM node:22-alpine
WORKDIR /app
COPY hub-server/package.json hub-server/package-lock.json ./
RUN npm ci --omit=dev
COPY hub-server/server.js ./
ENV HUB_API_ONLY=1 PORT=8080
EXPOSE 8080
CMD ["node", "server.js"]
