import { runIndexManager } from '../src/database/index-manager';

async function main() {
  const args = new Set(process.argv.slice(2));
  const apply = args.has('--apply');
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    throw new Error(
      'MONGODB_URI is required. Refusing to guess a production or local database.',
    );
  }

  await runIndexManager({ uri, apply });
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[mongodb-index-manager] ${message}`);
  process.exitCode = 1;
});
