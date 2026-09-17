import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';

// Register path alias resolver
register(
  new URL('./_alias-resolver.js', import.meta.url).href,
  pathToFileURL(process.cwd())
);

async function loadWithTsSupport(url) {
  const ext = extname(url.pathname);
  if (ext === '.ts' || ext === '.tsx') {
    const source = await readFile(url.pathname, 'utf8');
    // Let --experimental-strip-types handle the stripping
    return { format: 'module', shortCircuit: false, source };
  }
  return null;
}
