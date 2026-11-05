ARG BASE_IMAGE=qdev-dashboard-profile:20261030
FROM node:24.22.1-bookworm@sha256:d862bb5d082c5ae0210ac07e8c0344cb8cf7bef6d78e9b8c50c179da923108ea AS patched_node
FROM ${BASE_IMAGE}
ARG POLICY_SHA
COPY --from=patched_node /usr/local/bin/node /usr/local/bin/node
LABEL factory.owner.codex="0.163.0" factory.owner.node="24.22.1" factory.owner.undici="7.30.1" factory.owner.policy="${POLICY_SHA}"
RUN node -e 'if(process.version!=="v24.22.1"||process.versions.undici!=="7.30.1")process.exit(1)'
RUN npm install --global --ignore-scripts --no-audit --no-fund @openai/codex@0.163.0 \
    && npm cache clean --force
COPY worker-init.mjs broker.mjs /opt/factory-owner/
RUN chmod 0555 /opt/factory-owner/*.mjs && codex --version
ENTRYPOINT ["node", "/opt/factory-owner/worker-init.mjs"]
