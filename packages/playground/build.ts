/* eslint-disable no-console */
const outdir = './.playground-build';

const result = await Bun.build({
  entrypoints: ['./index.html'],
  outdir,
  minify: true,
  sourcemap: 'none',
  splitting: false,
  target: 'browser'
});

if (!result.success) {
  console.error('Build failed:', result.logs);
  process.exit(1);
}

const htmlOutput = result.outputs.find((output) => output.path.endsWith('.html'));
if (!htmlOutput) {
  throw new Error('No HTML output from build');
}

const cssOutput = result.outputs.find((output) => output.path.endsWith('.css'));
const jsOutput = result.outputs.find((output) => output.path.endsWith('.js'));

let html = await htmlOutput.text();

if (cssOutput) {
  html = html.replace(
    /<link[^>]+rel="stylesheet"[^>]+href="[^"]+\.css"[^>]*>/,
    `<style>${await cssOutput.text()}</style>`
  );
}

if (!jsOutput) {
  throw new Error('No JavaScript output from build');
}

html = html.replace(
  /<script[^>]+src="[^"]+\.js"[^>]*><\/script>/,
  `<script type="module">${await jsOutput.text()}</script>`
);

await Bun.write('../../dist/playground.html', html);
await Bun.$`rm -rf ${outdir}`;
console.log('Built: dist/playground.html');
