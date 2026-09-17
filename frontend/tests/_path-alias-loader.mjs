import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { extname } from 'node:path';

const ALIASES = {
  '@/': new URL('./src/', import.meta.url),
};

export async function resolve(specifier, context, next) {
  for (const [alias, target] of Object.entries(ALIASES)) {
    if (specifier.startsWith(alias)) {
      const rest = specifier.slice(alias.length);
      const resolved = new URL(rest, target);
      return next(resolved.href, context);
    }
  }
  return next(specifier, context);
}

export async function load(url, context, next) {
  const urlStr = url.href || (typeof url === 'string' ? url : url.href);
  const ext = extname(urlStr);
  if (ext === '.ts' || ext === '.tsx') {
    const source = await readFile(url.pathname || new URL(urlStr).pathname, 'utf8');
    return {
      format: 'module',
      shortCircuit: true,
      source,
    };
  }
  return next(url, context);
}
