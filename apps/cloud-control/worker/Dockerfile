FROM node:24-bookworm@sha256:5a750d3be5e5c80275f8c9a5367c3aed99c2875656590c8d0701c7ee687f5f0a
RUN node --version && git --version && mkdir -p /workspace && chown node:node /workspace
USER node
WORKDIR /workspace
