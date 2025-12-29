FROM node:20-alpine AS build

WORKDIR /app

# Install pnpm and build tools for native modules (better-sqlite3)
RUN corepack enable && corepack prepare pnpm@latest --activate
RUN apk add --no-cache python3 make g++

# Copy root workspace files
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./

# Copy package.json files for all workspaces
COPY apps/signet/package.json ./apps/signet/
COPY packages/signet-types/package.json ./packages/signet-types/

# Install dependencies
ENV CI=true
RUN pnpm install --frozen-lockfile

# Force rebuild better-sqlite3 from source for Alpine/musl compatibility
# prebuild-install downloads glibc binaries by default; we need musl
RUN BETTER_SQLITE3_DIR=$(find /app/node_modules -type d -name "better-sqlite3" -path "*/.pnpm/*" | head -1) && \
    cd "$BETTER_SQLITE3_DIR" && \
    rm -rf prebuilds build && \
    npm run build-release

# Copy source files
COPY packages/signet-types ./packages/signet-types
COPY apps/signet ./apps/signet

# Build shared types first, then daemon
WORKDIR /app/packages/signet-types
RUN pnpm build

WORKDIR /app/apps/signet
ENV DATABASE_URL="file:/app/config/signet.db"
RUN pnpm prisma generate
RUN pnpm build

# Runtime stage - copy everything from build instead of reinstalling
FROM node:20-alpine AS runtime

WORKDIR /app

# Only need runtime dependencies, not build tools
RUN apk add --no-cache openssl wget

# Copy the entire workspace with compiled node_modules from build
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./
COPY --from=build /app/pnpm-workspace.yaml ./
COPY --from=build /app/packages/signet-types ./packages/signet-types

# Copy app with its node_modules and built files
COPY --from=build /app/apps/signet/node_modules ./apps/signet/node_modules
COPY --from=build /app/apps/signet/package.json ./apps/signet/
COPY --from=build /app/apps/signet/dist ./apps/signet/dist
COPY --from=build /app/apps/signet/prisma ./apps/signet/prisma
COPY --from=build /app/apps/signet/prisma.config.ts ./apps/signet/prisma.config.ts
COPY --from=build /app/apps/signet/entrypoint.sh ./apps/signet/entrypoint.sh

RUN chmod +x ./apps/signet/entrypoint.sh

# Install pnpm for runtime commands (prisma migrate)
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app/apps/signet

# Environment variables (can be overridden at runtime)
ENV DATABASE_URL="file:/app/config/signet.db"
ENV SIGNET_PORT=3000
ENV SIGNET_HOST=0.0.0.0

EXPOSE 3000

ENTRYPOINT ["./entrypoint.sh"]
CMD ["start", "--config", "/app/config/signet.json"]
