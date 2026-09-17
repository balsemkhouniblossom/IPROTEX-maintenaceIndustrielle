import { register } from 'tsconfig-paths';
import { join } from 'path';
import { pathToFileURL } from 'url';

register({
  baseUrl: process.cwd(),
  paths: { '@/*': ['./src/*'] },
});

const testFile = process.argv[2];
if (testFile) {
  await import(pathToFileURL(join(process.cwd(), testFile)).href);
}
