import { runIndexManager } from '../src/database/index-manager';

async function main() {
  const args = new Set(process.argv.slice(2));
  const apply = args.has('--apply');
  const check = args.has('--check');
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    throw new Error(
      'MONGODB_URI is required. Refusing to guess a production or local database.',
    );
  }

  if (check && apply) {
    throw new Error(
      '--check and --apply are mutually exclusive: --check is a read-only verification mode.',
    );
  }

  const plan = await runIndexManager({ uri, apply });

  if (check) {
    const missing = plan.filter((entry) => entry.status === 'missing');
    if (missing.length > 0) {
      console.error(
        `[mongodb-index-manager] ${missing.length} index(es) missing: ` +
          missing.map((entry) => `${entry.spec.collection}.${entry.spec.name}`).join(', '),
      );
      process.exitCode = 1;
    } else {
      console.log('[mongodb-index-manager] all indexes present.');
    }
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[mongodb-index-manager] ${message}`);
  process.exitCode = 1;
});
