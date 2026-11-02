# Keep this version aligned with the exact playwright dependency in package.json.
# The image digest below also pins Chromium, Node, and the base operating system.
FROM mcr.microsoft.com/playwright:v1.64.1-noble@sha256:7852dc5a7d72f5fe458a597d690f6c42fbc8e9e26ddfa95f8e6ef552558d9bbf

# Freeze font files and Poppler (including transitive dependencies) independently
# of when CI rebuilds the image. Only the Ubuntu archive signing key is trusted.
RUN rm -f /etc/apt/sources.list /etc/apt/sources.list.d/nodesource.list \
    && printf '%s\n' \
      'Types: deb' \
      'URIs: https://snapshot.ubuntu.com/ubuntu/20260901T000000Z/' \
      'Suites: noble noble-updates noble-security' \
      'Components: main universe' \
      'Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg' \
      'Check-Valid-Until: no' \
      > /etc/apt/sources.list.d/ubuntu.sources \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
      fonts-liberation fonts-noto-cjk poppler-utils \
    && fc-cache -f \
    && rm -rf /var/lib/apt/lists/*

ENV TZ=UTC LANG=C.UTF-8 LC_ALL=C.UTF-8 PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
WORKDIR /work
