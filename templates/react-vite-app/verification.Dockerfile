FROM node:22-bookworm
COPY package.json package-lock.json /deps/
RUN cd /deps && npm ci --no-audit --no-fund --loglevel=error && chmod -R a+rX /deps
