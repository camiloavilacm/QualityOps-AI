# Build context is a credential-free export of the exact VERIFIER revision only.
# Candidate specs are never build inputs. No installation occurs during execution.
FROM mcr.microsoft.com/playwright@sha256:766137e2d9caad4744187e53cdc89320ba6f2eb57cff097374020944b44dd0a9
WORKDIR /opt/qualityops/frontend
ARG QUALITYOPS_STAGE=1
ARG PW_VERIFIER_REVISION
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY frontend/ ./
RUN npm run typecheck && npm run build
COPY frontend/tests/ /opt/qualityops/verifier-tests/
RUN if [ "$QUALITYOPS_STAGE" -ge 2 ]; then PW_VERIFIER_REVISION="$PW_VERIFIER_REVISION" node scripts/prepare_canary_bundles.mjs /opt/qualityops/canary-variants; fi
COPY harness/container/ /opt/qualityops/runner/
COPY harness/pr-verification-policy.json /opt/qualityops/harness/pr-verification-policy.json
COPY harness/verify_red_team_matrix.mjs harness/red_team_cases.mjs harness/check_ci_workflow.mjs harness/check_healer_scope.py /opt/qualityops/harness/
COPY harness/test_red_team_matrix.mjs harness/test_ci_workflow.mjs /opt/qualityops/harness/
COPY .github/workflows/ci.yml /opt/qualityops/.github/workflows/ci.yml
COPY .github/dependabot.yml /opt/qualityops/.github/dependabot.yml
USER pwuser
ENV HOME=/tmp/qualityops-home CI=1
ENTRYPOINT ["node", "/opt/qualityops/runner/run-foundation.mjs"]
