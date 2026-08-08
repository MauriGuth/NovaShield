# Backend de Nova Shield.
#
# Va un Dockerfile y no la detección automática de Railway porque esto es un
# monorepo con workspaces: hay que instalar desde la raíz y compilar
# packages/shared ANTES que el backend, o el build falla por tipos que todavía
# no existen.
#
# Se construye desde la raíz del repo:  docker build -t novashield-api .

FROM node:22-slim AS build
WORKDIR /app

# better-sqlite3 compila binario nativo. En producción se usa PostgreSQL
# (DATABASE_URL), pero el paquete igual se instala y necesita el toolchain.
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Primero solo los manifiestos: si no cambian, Docker reusa la capa de npm ci.
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/backend/package.json apps/backend/
COPY apps/mobile/package.json apps/mobile/

# --ignore-scripts evita que el `prepare` de packages/shared corra antes de que
# su código esté copiado. Se compila explícitamente más abajo.
RUN npm ci --ignore-scripts

COPY packages/shared packages/shared
COPY apps/backend apps/backend

RUN npm run build --workspace @novashield/shared \
    && npm run build --workspace apps/backend

# — Imagen final —
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --shell /bin/bash nova

COPY --from=build /app/node_modules node_modules
COPY --from=build /app/package.json package.json
COPY --from=build /app/packages/shared packages/shared
COPY --from=build /app/apps/backend/dist apps/backend/dist
COPY --from=build /app/apps/backend/package.json apps/backend/package.json

USER nova

# Railway inyecta PORT; main.ts ya lo respeta.
EXPOSE 3000
CMD ["node", "apps/backend/dist/main"]
