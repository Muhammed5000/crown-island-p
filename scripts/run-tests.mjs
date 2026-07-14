import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const integrationTests = new Set([
  'src/server/sync/apply-core.test.ts',
  'src/server/sync/outbox.test.ts',
  'src/server/sync/pull.test.ts',
  'src/server/sync/push.test.ts',
]);

function collectTests(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectTests(path));
    else if (entry.isFile() && entry.name.endsWith('.test.ts')) {
      out.push(relative(root, path).replaceAll('\\', '/'));
    }
  }
  return out.sort();
}

const mode = process.argv[2] ?? 'unit';
if (mode !== 'unit' && mode !== 'integration') {
  console.error('Usage: node scripts/run-tests.mjs <unit|integration>');
  process.exit(2);
}

const allTests = collectTests(join(root, 'src'));
const files =
  mode === 'integration'
    ? allTests.filter((file) => integrationTests.has(file))
    : allTests.filter((file) => !integrationTests.has(file));

const env = { ...process.env };
if (mode === 'integration') {
  const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
  if (!testDatabaseUrl) {
    console.error(
      'Refusing to run DB-mutating integration tests without TEST_DATABASE_URL. ' +
        'Point it at a disposable, migrated and catalog-seeded PostgreSQL database.',
    );
    process.exit(2);
  }
  env.DATABASE_URL = testDatabaseUrl;
  env.DIRECT_URL = testDatabaseUrl;
}

const tsxCli = join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const args = [tsxCli, '--test'];
if (mode === 'integration') args.push('--test-concurrency=1');
else {
  // Compiling every TS test file in parallel can exhaust Windows/CI virtual
  // memory as the suite grows. Keep a bounded default while allowing an
  // explicitly tuned override for larger runners.
  const requested = Number.parseInt(process.env.TEST_CONCURRENCY ?? '4', 10);
  const concurrency = Number.isFinite(requested) && requested > 0 ? requested : 4;
  args.push(`--test-concurrency=${concurrency}`);
}
args.push(...files);

console.log(`Running ${files.length} ${mode} test files`);
const result = spawnSync(process.execPath, args, {
  cwd: root,
  env,
  stdio: 'inherit',
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
