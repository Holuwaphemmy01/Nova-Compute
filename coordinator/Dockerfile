# Nova coordinator: static musl binary in an empty image.
# Build from the REPO ROOT (the coordinator embeds contracts/artifacts and uses kernel/):
#   docker build -f coordinator/Dockerfile -t nova-coordinator .

# ---- build ----
FROM rust:1.94-alpine AS build
# musl-dev: C toolchain for the bundled SQLite and ring.
RUN apk add --no-cache musl-dev
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY kernel ./kernel
COPY coordinator ./coordinator
COPY worker ./worker
COPY contracts/artifacts ./contracts/artifacts
RUN cargo build --release --locked -p nova-coordinator --bin nova-coordinator \
 && strip target/release/nova-coordinator \
 && mkdir -p /out/data

# ---- run ----
FROM scratch
COPY --from=build /src/target/release/nova-coordinator /nova-coordinator
# Empty /data so SQLite can create its file when no volume is mounted (e.g. Render free plan).
COPY --from=build /out/data /data
# TLS roots for Fulcrum are compiled in (webpki-roots), so no CA bundle is needed.
ENV PORT=8080 \
    DATABASE_URL=sqlite:///data/nova.db \
    RUST_LOG=info,sqlx=warn
# SQLite lives on a mounted volume.
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 CMD ["/nova-coordinator", "--healthcheck"]
ENTRYPOINT ["/nova-coordinator"]
