export async function resolve(specifier, context, next) {
  if (specifier.startsWith('@/')) {
    const resolved = specifier.replace(/^@\//, './src/');
    return next(resolved, context);
  }
  return next(specifier, context);
}

export async function load(url, context, next) {
  if (url.href.endsWith('.ts') || url.href.endsWith('.tsx')) {
    return {
      format: 'module',
      shortCircuit: true,
      source: await Bun.file(url.pathname).text().catch(() => null),
    };
  }
  return next(url, context);
}
