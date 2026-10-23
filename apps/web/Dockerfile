# Builds the React app, then serves the static files with nginx, which also
# forwards /api and /socket.io to the API. One origin for the browser means
# the session cookie just works and no CORS is needed.

FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/tsconfig.json packages/shared/
COPY packages/shared/src packages/shared/src
# Every workspace manifest is needed for `npm ci` to match the lockfile.
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
# Skip lifecycle scripts: the root postinstall would generate the Prisma
# client, which the web app doesn't need. Build only what the web app uses.
RUN npm ci --ignore-scripts
COPY apps/web apps/web
RUN npm run build -w @sliqdesk/shared && npm run build -w @sliqdesk/web

FROM nginx:1.27-alpine
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
