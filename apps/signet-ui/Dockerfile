FROM node:20-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@latest --activate
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/signet-ui/package.json ./apps/signet-ui/
COPY packages/signet-types/package.json ./packages/signet-types/
RUN pnpm install --frozen-lockfile
COPY packages/signet-types ./packages/signet-types
COPY apps/signet-ui ./apps/signet-ui
WORKDIR /app/packages/signet-types
RUN pnpm build
WORKDIR /app/apps/signet-ui
RUN pnpm build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/apps/signet-ui/dist ./dist
COPY --from=build /app/apps/signet-ui/server.mjs ./server.mjs
# Install server dependencies
RUN npm install express http-proxy-middleware

# Environment variables (can be overridden at runtime)
ENV UI_PORT=4174
ENV UI_HOST=0.0.0.0
ENV DAEMON_URL=http://signet:3000

EXPOSE 4174
CMD ["node", "server.mjs"]
