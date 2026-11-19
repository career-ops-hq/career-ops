FROM node:24.15.0-bookworm-slim

ARG ENGINE_REVISION
ENV NODE_ENV=production \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    HOSTED_ENGINE_REVISION=${ENGINE_REVISION} \
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

USER node
ENTRYPOINT ["node", "hosted/worker.mjs"]
