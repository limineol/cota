# The hub image (ADR-0024, docs/specs/deployment/spec.md): Bun, the hub's
# source without its tests, its production dependencies, and the dashboard
# built in the build stage. Both build stages run on the builder's platform and
# the final stage only copies, so every platform gets the same files.
#
#   docker build -t "cota-hub:$(git rev-parse --short=12 HEAD)" .

FROM --platform=$BUILDPLATFORM oven/bun:1.4.2@sha256:9114c058aeae42162ee16dd5084b95fe9473970bb6bcb5b232ab1630f0546895 AS manifests
WORKDIR /src
COPY package.json bun.lock ./
COPY apps/hub/package.json apps/hub/
COPY apps/web/package.json apps/web/
COPY apps/cli/package.json apps/cli/
COPY packages/ui/package.json packages/ui/
COPY proofs/package.json proofs/

FROM manifests AS dashboard
RUN bun install --frozen-lockfile --filter @cota/web
COPY . .
RUN bun run web:build

FROM manifests AS dependencies
RUN bun install --frozen-lockfile --production --filter @cota/hub

FROM oven/bun:1.4.2-slim@sha256:cb3bbbb08e13a4a2ff400f24c7a2a1d5efa83f6ef8544d52d95a519631e2fc61
ARG COTA_REVISION=unknown
ARG COTA_VERSION=0.1.0
# Bun's image labels itself as Bun; these say the image is Cota's hub.
LABEL org.opencontainers.image.title="cota-hub" \
      org.opencontainers.image.description="Cota's hub" \
      org.opencontainers.image.url="https://github.com/limineol/cota" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.source="https://github.com/limineol/cota" \
      org.opencontainers.image.revision="${COTA_REVISION}" \
      org.opencontainers.image.version="${COTA_VERSION}"
WORKDIR /app
COPY --from=dependencies /src/package.json /src/bun.lock ./
COPY --from=dependencies /src/node_modules ./node_modules
COPY --from=dependencies /src/apps/hub/node_modules ./apps/hub/node_modules
COPY apps/hub/package.json apps/hub/
COPY apps/hub/src apps/hub/src
COPY --from=dashboard /src/apps/web/dist apps/web/dist
ENV COTA_CONFIG=/etc/cota/cota.toml
EXPOSE 8080
USER bun
# The image's own user is not root, and the Compose file runs it as the
# owner's; this refuses the one user it must never run as, whoever names it.
ENTRYPOINT ["/bin/sh", "-c", "if [ \"$(id -u)\" = 0 ]; then echo 'the hub never runs as root: name your own user and group in .env as COTA_UID and COTA_GID (id -u, id -g)' >&2; exit 1; fi; exec \"$@\"", "cota-hub"]
CMD ["bun", "run", "hub"]
