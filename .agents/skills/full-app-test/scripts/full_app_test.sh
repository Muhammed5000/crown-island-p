#!/usr/bin/env bash
set -uo pipefail

ROOT="$(pwd)"
REPORT_DIR="$ROOT/.claude/reports/full-app-test"
STAMP="$(date +%Y%m%d-%H%M%S)"
LOG="$REPORT_DIR/full-app-test-$STAMP.log"
mkdir -p "$REPORT_DIR"

exec > >(tee -a "$LOG") 2>&1

echo "# Full App Test Sweep"
echo "Date: $(date -Is 2>/dev/null || date)"
echo "Directory: $ROOT"
echo "Log: $LOG"
echo

run() {
  local label="$1"
  shift
  echo
  echo "## $label"
  echo "+ $*"
  if "$@"; then
    echo "RESULT: PASS - $label"
  else
    local code=$?
    echo "RESULT: FAIL - $label (exit $code)"
  fi
}

run_shell() {
  local label="$1"
  local cmd="$2"
  echo
  echo "## $label"
  echo "+ $cmd"
  if bash -lc "$cmd"; then
    echo "RESULT: PASS - $label"
  else
    local code=$?
    echo "RESULT: FAIL - $label (exit $code)"
  fi
}

has_cmd() { command -v "$1" >/dev/null 2>&1; }

has_script() {
  local script="$1"
  [ -f package.json ] || return 1
  node -e "const p=require('./package.json'); process.exit(p.scripts && p.scripts['$script'] ? 0 : 1)" >/dev/null 2>&1
}

node_runner=""
if [ -f pnpm-lock.yaml ] && has_cmd pnpm; then
  node_runner="pnpm"
elif [ -f yarn.lock ] && has_cmd yarn; then
  node_runner="yarn"
elif [ -f package.json ] && has_cmd npm; then
  node_runner="npm"
fi

run "Git status" git status --short
run_shell "Project markers" "find . -maxdepth 3 \( -name package.json -o -name pnpm-lock.yaml -o -name yarn.lock -o -name package-lock.json -o -name pyproject.toml -o -name requirements.txt -o -name pytest.ini -o -name go.mod -o -name Cargo.toml -o -name pom.xml -o -name build.gradle -o -name docker-compose.yml -o -name compose.yml -o -name Dockerfile -o -name playwright.config.* -o -name cypress.config.* -o -name vitest.config.* -o -name jest.config.* -o -name .github \) -print"

if [ -f package.json ] && has_cmd node; then
  run_shell "package.json scripts" "node -e \"const p=require('./package.json'); console.log(JSON.stringify(p.scripts||{}, null, 2))\""
fi

if [ -n "$node_runner" ]; then
  echo
  echo "Detected Node runner: $node_runner"
  for script in lint typecheck check test test:unit test:integration test:e2e e2e build; do
    if has_script "$script"; then
      if [ "$node_runner" = "npm" ]; then
        run_shell "Node script: $script" "npm run $script"
      else
        run_shell "Node script: $script" "$node_runner run $script"
      fi
    else
      echo "SKIPPED: Node script '$script' not found"
    fi
  done

  if [ "$node_runner" = "npm" ]; then
    run_shell "npm audit" "npm audit --audit-level=moderate"
  elif [ "$node_runner" = "pnpm" ]; then
    run_shell "pnpm audit" "pnpm audit --audit-level moderate"
  fi
fi

if [ -f pyproject.toml ] || [ -f requirements.txt ] || [ -f pytest.ini ]; then
  if has_cmd python; then
    run_shell "Python pytest" "python -m pytest -q"
    run_shell "Python ruff" "python -m ruff check ."
    run_shell "Python mypy" "python -m mypy ."
    run_shell "Python pip-audit" "python -m pip_audit"
  else
    echo "SKIPPED: Python project markers found but python command not available"
  fi
fi

if [ -f go.mod ] && has_cmd go; then
  run "Go test" go test ./...
  run "Go vet" go vet ./...
  run "Go race tests" go test -race ./...
  if has_cmd govulncheck; then
    run "govulncheck" govulncheck ./...
  else
    echo "SKIPPED: govulncheck not installed"
  fi
fi

if [ -f Cargo.toml ] && has_cmd cargo; then
  run "Cargo fmt check" cargo fmt --check
  run_shell "Cargo clippy" "cargo clippy --all-targets --all-features -- -D warnings"
  run "Cargo test" cargo test --all
  run "Cargo build" cargo build --all
  if has_cmd cargo-audit; then
    run "Cargo audit" cargo audit
  else
    echo "SKIPPED: cargo-audit not installed"
  fi
fi

if [ -f pom.xml ] && has_cmd mvn; then
  run "Maven test" mvn test
  run "Maven verify" mvn verify
fi

if [ -f gradlew ]; then
  run "Gradle test" ./gradlew test
  run "Gradle check" ./gradlew check
elif [ -f build.gradle ] && has_cmd gradle; then
  run "Gradle test" gradle test
  run "Gradle check" gradle check
fi

if has_cmd gitleaks; then
  run "Gitleaks no-git secret scan" gitleaks detect --source . --no-git
else
  echo "SKIPPED: gitleaks not installed"
fi

if has_cmd osv-scanner; then
  run "OSV Scanner recursive" osv-scanner -r .
else
  echo "SKIPPED: osv-scanner not installed"
fi

if has_cmd trivy; then
  run "Trivy filesystem scan" trivy fs .
else
  echo "SKIPPED: trivy not installed"
fi

echo
echo "# Sweep complete"
echo "Log saved to: $LOG"
echo "Review failed and skipped checks before declaring PASS."
