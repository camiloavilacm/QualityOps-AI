# Build context is a credential-free export of the exact VERIFIER revision only.
# Candidate specs are never build inputs. No installation occurs during execution.
FROM mcr.microsoft.com/playwright@sha256:766137e2d9caad4744187e53cdc89320ba6f2eb57cff097374020944b44dd0a9
WORKDIR /opt/qualityops/frontend
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY frontend/ ./
RUN npm run typecheck && npm run build
COPY harness/container/ /opt/qualityops/runner/
USER pwuser
ENV HOME=/tmp/qualityops-home CI=1
ENTRYPOINT ["node", "/opt/qualityops/runner/run-foundation.mjs"]
