# The account server (sign-in, cloud worlds, parental controls, Kart Circuit's /mp relay) as a container, for hosts that
# run Docker images (Back4app Containers, Hugging Face Spaces, ...). Build from this folder:  docker build -t mimi-hub .
# Settings are environment variables: HASH_PEPPER (keep the one the accounts were made with), UPSTASH_REDIS_REST_URL and
# UPSTASH_REDIS_REST_TOKEN (where accounts are kept), and optionally PORT.
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server.js ./
ENV HUB_API_ONLY=1 PORT=8080
EXPOSE 8080
CMD ["node", "server.js"]
