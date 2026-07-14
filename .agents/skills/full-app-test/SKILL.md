---
name: full-app-test
description: Test the whole application end-to-end, including build, lint, types, unit, integration, e2e, dependency, and security smoke checks.
---

# Full App Test

Use this skill when the user asks to test the whole application, validate the app before release, check if everything works, run all tests, or produce an application QA/security test report.

## Goal

Test the application like a careful release engineer. Discover the stack, run the strongest available automated checks, exercise critical user flows, perform safe security smoke checks, and return a clear pass/fail report with evidence.

## Safety rules

- Work only in the current repository unless the user explicitly allows another path.
- Do not use production credentials, production databases, real payment systems, real email/SMS sending, or destructive external services.
- Do not deploy, publish, migrate, reset, seed, wipe, or permanently modify databases unless the user explicitly asks.
- Prefer test mode, mocks, local containers, sandbox APIs, and temporary databases.
- Do not claim the app passed unless the relevant commands actually ran and their outputs support that conclusion.
- If a command is unavailable, record it as `SKIPPED` with the reason.
- If a command fails, keep testing independent checks where safe, then summarize all failures.
- Do not fix code unless the user asks. You may recommend fixes.

## Phase 1: Discover the application

Read the repo structure and identify:

- Frameworks and languages
- Package managers
- Test frameworks
- Existing scripts and CI workflows
- How the app starts locally
- Whether frontend, backend, database, worker, queue, or mobile components exist
- Whether Docker Compose or dev containers are available

Run safe discovery commands such as:

```bash
pwd
git status --short
find . -maxdepth 3 \
  \( -name package.json -o -name pnpm-lock.yaml -o -name yarn.lock -o -name package-lock.json \
  -o -name pyproject.toml -o -name requirements.txt -o -name pytest.ini \
  -o -name go.mod -o -name Cargo.toml -o -name pom.xml -o -name build.gradle \
  -o -name docker-compose.yml -o -name compose.yml -o -name Dockerfile \
  -o -name playwright.config.* -o -name cypress.config.* -o -name vitest.config.* \
  -o -name jest.config.* -o -name .github \) -print
```

If `package.json` exists, inspect scripts:

```bash
node -e "const p=require('./package.json'); console.log(JSON.stringify(p.scripts||{}, null, 2))"
```

## Phase 2: Build the test plan before running

Create a short plan with these sections:

1. Detected stack
2. Commands to run
3. Services required
4. Test data strategy
5. High-risk areas
6. Checks that may need user permission

Only ask the user a question if a safe test cannot continue without it. Otherwise make a reasonable safe choice and document the assumption.

## Phase 3: Run automated quality gates

Run every relevant existing command. Prefer project-defined scripts over guessed commands.

Common Node.js commands:

```bash
npm run lint --if-present
npm run typecheck --if-present
npm test --if-present
npm run test:unit --if-present
npm run test:integration --if-present
npm run test:e2e --if-present
npm run build --if-present
```

For pnpm:

```bash
pnpm run lint
pnpm run typecheck
pnpm test
pnpm run test:unit
pnpm run test:integration
pnpm run test:e2e
pnpm run build
```

For yarn:

```bash
yarn lint
yarn typecheck
yarn test
yarn test:unit
yarn test:integration
yarn test:e2e
yarn build
```

For Python:

```bash
python -m pytest -q
python -m ruff check .
python -m mypy .
python -m build
```

For Go:

```bash
go test ./...
go vet ./...
go test -race ./...
```

For Rust:

```bash
cargo fmt --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test --all
cargo build --all
```

For Java:

```bash
mvn test
mvn verify
./gradlew test
./gradlew check
```

Run only the commands that match the project and are available.

## Phase 4: Start the app and perform smoke testing

If the repository has a known safe local start command, start the app in development or test mode. Capture logs.

Check:

- App starts without crashing
- Health endpoint works, if present
- Home page loads, if frontend exists
- Login/logout works, if auth exists and test credentials are available
- Primary user flow works
- API returns expected status codes
- Background workers start, if applicable
- No obvious server/client console errors appear

For web apps with Playwright installed, prefer browser-based smoke checks. If no browser test framework exists, produce a manual smoke checklist and recommend adding Playwright smoke tests.

## Phase 5: Integration and data testing

Validate important boundaries:

- Frontend-to-backend calls
- Backend-to-database queries
- Authenticated vs unauthenticated behavior
- Role-based access control, if roles exist
- File upload/download, if supported
- Email/payment/third-party integrations in mock or sandbox mode only
- Error handling for invalid inputs

Do not use production systems.

## Phase 6: Security smoke checks

Run safe checks when tools are installed:

```bash
gitleaks detect --source . --no-git
osv-scanner -r .
trivy fs .
npm audit --audit-level=moderate
pnpm audit --audit-level moderate
pip-audit
cargo audit
govulncheck ./...
```

Also inspect code and config for:

- Secrets committed to files
- Unsafe CORS
- Missing authentication or authorization checks
- SQL/NoSQL/command/path/template injection risks
- SSRF or unsafe URL fetching
- Open redirects
- Insecure file upload handling
- Missing CSRF protection where relevant
- Weak session/cookie settings
- Missing rate limits on auth and sensitive endpoints
- Debug mode enabled in production config

These are smoke checks, not a full penetration test. Be clear about that.

## Phase 7: Produce the final report

Create a concise report in the chat. If useful, also create:

```text
.Codex/reports/full-app-test-report.md
```

Report format:

```md
# Full App Test Report

## Overall result
PASS / PARTIAL PASS / FAIL

## Environment
- Date:
- Branch/commit:
- Stack detected:
- Services used:

## Commands run
| Check | Command | Result | Notes |
|---|---|---|---|

## Functional test results
- App startup:
- Health check:
- Main user flows:
- API checks:
- E2E/browser checks:

## Security smoke results
- Secret scan:
- Dependency audit:
- Auth/access control observations:
- Config risks:

## Failures and evidence
For each failure:
- Command or flow
- Error summary
- Relevant file/log/test
- Likely cause
- Recommended fix

## Untested areas
List anything not tested and why.

## Recommended next steps
Prioritize fixes by risk and confidence.
```

## Pass/fail rules

- `PASS`: build, tests, critical smoke flows, and available security checks passed.
- `PARTIAL PASS`: core checks passed but some checks were skipped due to missing tools, unavailable services, or missing credentials.
- `FAIL`: any build failure, test failure, app startup failure, critical user-flow failure, or high-confidence security issue.

## Optional helper script

This skill includes `scripts/full_app_test.sh`. Use it when the user wants a broad first-pass automated sweep. Then interpret the log, fill gaps manually, and produce the final report.
