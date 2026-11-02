# mira-web: Next.js standalone server. Build from the repo root:
#   docker build -f infra/docker/web.Dockerfile -t mira-web .
FROM node:24-slim AS build
RUN corepack enable
WORKDIR /repo
COPY . .
# Pages without request data are rendered at build time, so the build must know the mode the
# server will run in (the banner says whether results are real). Cloud Run: live. One VM: mock
# state with real YouCam (infra/vm).
ARG MIRA_MODE=live
ARG MIRA_YOUCAM=fake
ENV NEXT_TELEMETRY_DISABLED=1 MIRA_MODE=${MIRA_MODE} MIRA_YOUCAM=${MIRA_YOUCAM} \
    NEXT_PUBLIC_MIRA_MODE=${MIRA_MODE}
RUN pnpm install --frozen-lockfile --filter "@mira/web..." \
 && pnpm --filter @mira/web run build

FROM node:24-slim
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /repo/apps/web/public ./apps/web/public
USER node
# Cloud Run injects PORT; Next's standalone server reads it.
CMD ["node", "apps/web/server.js"]
