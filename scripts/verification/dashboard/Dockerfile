ARG NODE_IMAGE
FROM ${NODE_IMAGE}
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/qdev-dashboard/browsers
ENV UV_THREADPOOL_SIZE=1 NODE_OPTIONS=--v8-pool-size=1
WORKDIR /
COPY package.json package-lock.json /opt/qdev-dashboard/dependencies/
RUN cp /opt/qdev-dashboard/dependencies/package*.json / \
    && npm ci --ignore-scripts --no-audit --no-fund --registry=https://registry.npmjs.org \
    && /node_modules/.bin/playwright install --with-deps chromium \
    && npm cache clean --force \
    && rm -rf /var/lib/apt/lists/* \
    && chmod -R a+rX /node_modules /opt/qdev-dashboard
COPY check.mjs playwright.config.mjs /opt/qdev-dashboard/
ENV PATH=/node_modules/.bin:$PATH
WORKDIR /src
