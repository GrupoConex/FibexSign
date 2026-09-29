FROM node:22-bookworm-slim AS base

RUN apt-get update \
  && apt-get install -y --no-install-recommends libreoffice \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY apps/OpenSignServer/package*.json ./
RUN npm ci --omit=dev

COPY apps/OpenSignServer/ .

RUN mkdir -p files logs exports \
  && groupadd --system opensign \
  && useradd --system --gid opensign --home-dir /app --no-create-home opensign \
  && chown -R opensign:opensign /app

USER opensign

ENV NODE_ENV=production
EXPOSE 8080

CMD ["node", "index.js"]
