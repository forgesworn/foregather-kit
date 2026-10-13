# Build the Linux binary using the checkout's own target/ first. No second Rust cache.
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/foregather
COPY target/release/foregather-server /opt/foregather/foregather-server
COPY LICENSE THIRD_PARTY_LICENSES.txt SECURITY.md /opt/foregather/
RUN groupadd --gid 10001 foregather && useradd --uid 10001 --gid 10001 --no-create-home foregather && install -d -m 0700 -o 10001 -g 10001 /data
USER 10001:10001
ENV FOREGATHER_BIND=0.0.0.0:8787 FOREGATHER_DB=/data/foregather.sqlite FOREGATHER_ENABLE_LIVE=0
EXPOSE 8787
ENTRYPOINT ["/opt/foregather/foregather-server"]
