import { build, context } from 'esbuild';
import { mkdir } from 'node:fs/promises';

await mkdir('artifacts', { recursive: true });
const extension = {
  entryPoints: ['src/extension.ts'], bundle: true, platform: 'node',
  target: 'node20', format: 'cjs', external: ['vscode'], outfile: 'dist/extension.js',
  sourcemap: false, minify: false, legalComments: 'eof',
};
if (process.argv.includes('--watch')) {
  await (await context(extension)).watch();
} else if (process.argv.includes('--tests')) {
  await Promise.all([
    build(extension),
    build({ entryPoints: ['test/unit.ts'], bundle: true, platform: 'node', target: 'node20',
      format: 'cjs', outfile: 'dist/test/unit.cjs', alias: { vscode: './test/vscode-shim.ts' } }),
    build({ entryPoints: ['test/host.ts'], bundle: true, platform: 'node', target: 'node20',
      format: 'cjs', outfile: 'dist/test/host.cjs', external: ['vscode', 'mocha'] }),
  ]);
} else {
  await build(extension);
}
