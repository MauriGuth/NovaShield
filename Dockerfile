# Backend de Nova Shield.
#
# Va un Dockerfile y no la detección automática de Railway porque esto es un
# monorepo con workspaces: hay que instalar desde la raíz y compilar
# packages/shared ANTES que el backend.
#
# Se construye desde la raíz del repo:  docker build -t novashield-api .

FROM node:22-slim AS build
WORKDIR /app

# better-sqlite3 compila binario nativo. En producción se usa PostgreSQL
# (DATABASE_URL), pero el paquete igual se instala y necesita el toolchain.
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./

# El código de packages/shared va ANTES del install, no después: su script
# `prepare` corre `tsc` al terminar de instalar, y sin los fuentes ahí falla
# con "command failed: tsc -p tsconfig.json". `--ignore-scripts` tampoco es
# salida — saltea el prepare y deja el paquete sin compilar, que es peor.
COPY packages/shared packages/shared
COPY apps/backend apps/backend

# apps/mobile solo aporta su manifiesto: el lockfile es del monorepo entero y
# npm quiere ver el workspace declarado, pero sus dependencias (Expo, React
# Native) no pintan nada en un servidor y son la mayor parte del árbol.
COPY apps/mobile/package.json apps/mobile/package.json

# Filtrar por workspace baja de ~1480 paquetes a ~780. El `prepare` de
# packages/shared corre acá y deja dist/ listo para que compile el backend.
RUN npm ci \
      --workspace packages/shared \
      --workspace apps/backend \
      --include-workspace-root

RUN npm run build --workspace apps/backend

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

# Railway inyecta PORT y su proxy apunta al 8080 por defecto; main.ts respeta
# la variable, así que el contenedor sirve en el puerto que le manden.
EXPOSE 8080
CMD ["node", "apps/backend/dist/main"]
