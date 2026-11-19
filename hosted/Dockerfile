FROM node:24.15.0-bookworm-slim@sha256:4e6b70dd6cbfc88c8157ba19aa3d9f9cce6ba4703576d55459e45efcbc9c5f5d

ENV NODE_ENV=production \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    HOSTED_WORKSPACE_ROOT=/workspace

WORKDIR /opt/career-ops
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund \
    && npx playwright install --with-deps chromium \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir /workspace \
    && chown node:node /workspace

COPY *.mjs VERSION tracker-aliases.json ./
COPY lib/ ./lib/
COPY utils/ ./utils/
COPY providers/ ./providers/
COPY templates/ ./templates/
COPY modes/ ./modes/
COPY fonts/ ./fonts/
COPY config/ ./config/
COPY hosted/ ./hosted/

ARG ENGINE_REVISION
ENV HOSTED_ENGINE_REVISION=${ENGINE_REVISION}
LABEL org.opencontainers.image.revision=${ENGINE_REVISION}
RUN node -e "if (!/^[0-9a-f]{40}$/.test(process.env.HOSTED_ENGINE_REVISION || '')) process.exit(1)"

USER node
ENTRYPOINT ["node", "hosted/worker.mjs"]
