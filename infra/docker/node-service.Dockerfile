# One image recipe for every Node service: agent, workflows, webhook, mira-mcp.
# Build from the repo root:
#   docker build -f infra/docker/node-service.Dockerfile --build-arg PACKAGE=@mira/workflows \
#     --build-arg PACKAGE_DIR=apps/workflows -t mira-workflows .
FROM node:24-slim AS build
RUN corepack enable
WORKDIR /repo
COPY . .
ARG PACKAGE
ARG PACKAGE_DIR
RUN pnpm install --frozen-lockfile --filter "${PACKAGE}..." \
 && pnpm --filter "${PACKAGE}" run build \
 && pnpm --filter "${PACKAGE}" deploy --prod --legacy /out

FROM node:24-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/dist ./dist
USER node
# Cloud Run injects PORT.
CMD ["node", "--enable-source-maps", "dist/main.js"]
