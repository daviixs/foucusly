FROM node:22-alpine AS build

WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN npm ci

COPY apps/api apps/api
COPY packages/contracts packages/contracts

RUN npm run build --workspace packages/contracts \
  && npm run build --workspace apps/api \
  && npm prune --omit=dev

FROM node:22-alpine AS production

WORKDIR /app

ENV NODE_ENV=production
ARG APP_VERSION=unknown
ENV APP_VERSION=$APP_VERSION

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api/package.json apps/api/package.json
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/packages/contracts/package.json packages/contracts/package.json
COPY --from=build /app/packages/contracts/dist packages/contracts/dist

RUN mkdir -p /app/data && chown -R node:node /app/data

USER node

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -q -O - http://127.0.0.1:3001/api/health >/dev/null || exit 1

CMD ["node", "apps/api/dist/index.js"]
