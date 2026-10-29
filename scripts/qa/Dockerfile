# syntax=docker/dockerfile:1
#
# QA target image: a disposable Linux box that behaves like a remote SSH host.
# It carries Node (22 or 24) and an ordinary global `@deepseek-ai/dsh`, plus the
# official Messages mock server used only as a QA model fixture.
#
# Build through scripts/qa/start.sh; do not hand-roll flags:
#   docker build --build-arg NODE_MAJOR=22 --build-arg DSH_VERSION=0.2.1-rc.3 \
#     -t dsh-qa-server:node22-0.2.1-rc.3 scripts/qa
ARG NODE_MAJOR=22
FROM node:${NODE_MAJOR}-bookworm-slim

ARG NODE_MAJOR
ARG DSH_VERSION=0.2.1-rc.3

LABEL org.opencontainers.image.title="dsh-remote-window QA server target"
LABEL org.opencontainers.image.description="Disposable Linux SSH target with Node and global DSH for remote-window QA"

ENV DEBIAN_FRONTEND=noninteractive \
    LANG=C.UTF-8

# openssh-server: the only ingress. procps: pgrep/pkill for cleanup evidence.
# curl: local health checks. ca-certificates: apt/npm over HTTPS.
#
# The slim Node image ships no system CA bundle and this network blocks the
# Debian mirror on port 80, so bootstrap a CA file from Node's own root
# certificates, use it for the first HTTPS apt run, then install ca-certificates.
RUN set -eux; \
    node -e "require('fs').writeFileSync('/tmp/qa-ca.pem', require('tls').rootCertificates.join(String.fromCharCode(10)))"; \
    for f in /etc/apt/sources.list /etc/apt/sources.list.d/*.sources /etc/apt/sources.list.d/*.list; do \
      [ -f "$f" ] || continue; \
      sed -i 's|http://deb.debian.org|https://deb.debian.org|g; s|http://security.debian.org|https://security.debian.org|g' "$f"; \
    done; \
    apt-get update \
      -o Acquire::https::CaInfo=/tmp/qa-ca.pem \
      -o Acquire::Retries=5 \
      -o Acquire::http::Timeout=30 \
      -o Acquire::https::Timeout=60; \
    apt-get install -y --no-install-recommends ca-certificates \
      -o Acquire::https::CaInfo=/tmp/qa-ca.pem; \
    apt-get install -y --no-install-recommends \
      openssh-server \
      procps \
      curl; \
    rm -rf /var/lib/apt/lists/* /tmp/qa-ca.pem

# An ordinary global DSH install, exactly what a server operator would have.
# No credentials are baked in; the QA mock model key is a fixture string only.
RUN npm install -g "@deepseek-ai/dsh@${DSH_VERSION}" --no-audit --no-fund \
 && dsh --version \
 && npm ls -g --depth=0

# zstd for reading DSH session logs (session.v4.jsonl.zstd) in QA evidence.
# Kept after the global install so changing it does not re-run npm install.
RUN apt-get update -o Acquire::Retries=3 -o Acquire::https::Timeout=60 \
 && apt-get install -y --no-install-recommends zstd \
 && rm -rf /var/lib/apt/lists/*

# Unprivileged remote user. The QA harness never needs root over SSH.
RUN useradd --create-home --shell /bin/bash --password '*' tester \
 && mkdir -p /home/tester/.dsh /home/tester/.ssh /home/tester/work \
              /home/tester/qa-run /home/tester/qa-mock \
 && chown -R tester:tester /home/tester \
 && chmod 700 /home/tester/.ssh

# Official Messages-compatible mock model server. QA fixture only: it replaces
# the model endpoint, never the agent loop or the session log.
COPY mock-llm-package.json /opt/dsh-qa/package.json
COPY mock-llm.mjs /opt/dsh-qa/mock-llm.mjs
RUN cd /opt/dsh-qa \
 && npm install --omit=dev --no-audit --no-fund \
 && chmod -R a+rX /opt/dsh-qa

# Loopback-only sshd, key auth only, no root login.
COPY sshd-qa.conf /etc/ssh/sshd_config.d/10-dsh-qa.conf
RUN ssh-keygen -A

COPY entrypoint.sh /usr/local/bin/dsh-qa-entrypoint
RUN chmod +x /usr/local/bin/dsh-qa-entrypoint

EXPOSE 22
ENTRYPOINT ["/usr/local/bin/dsh-qa-entrypoint"]
