FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN npm ci

COPY apps/web apps/web
COPY packages/contracts packages/contracts

ARG APP_VERSION=unknown
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL

RUN npm run build --workspace packages/contracts \
  && npm run build --workspace apps/web \
  && printf '{"commit":"%s"}\n' "$APP_VERSION" > apps/web/dist/version.json

FROM nginx:1.28-alpine AS production

COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O - http://127.0.0.1/health >/dev/null || exit 1
