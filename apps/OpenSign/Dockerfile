FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY apps/OpenSign/package*.json ./
RUN npm ci

COPY apps/OpenSign/ .

ENV NODE_ENV=production
ENV GENERATE_SOURCEMAP=false

RUN npm run build \
  && sed -i '/<head>/a\<script src="/env.js"></script>' build/index.html

FROM node:22-bookworm-slim AS runtime

WORKDIR /app

COPY --from=build /app/build ./build
COPY --from=build /app/server.cjs ./
COPY --from=build /app/entrypoint.sh ./

RUN chmod +x entrypoint.sh \
  && groupadd --system opensign \
  && useradd --system --gid opensign --home-dir /app --no-create-home opensign \
  && chown -R opensign:opensign /app

USER opensign

ENV NODE_ENV=production
EXPOSE 3000

ENTRYPOINT ["./entrypoint.sh"]
CMD ["node", "server.cjs"]
