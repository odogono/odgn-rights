/* eslint-disable no-console */
const result = await Bun.build({
  entrypoints: ['./playground/src/main.tsx'],
  external: [],
  minify: true,
  sourcemap: 'none',
  target: 'browser'
});

if (!result.success) {
  console.error('Build failed:', result.logs);
  process.exit(1);
}

const js = await result.outputs[0]?.text();
if (js === undefined) {
  throw new Error('No output from build');
}
const css = await Bun.file('./playground/src/styles.css').text();
const htmlTemplate = await Bun.file('./playground/index.html').text();

// Inline JS and CSS into a single HTML file
const html = htmlTemplate
  .replace(
    '<link rel="stylesheet" href="./src/styles.css" />',
    `<style>${css}</style>`
  )
  .replace(
    '<script type="module" src="./src/main.tsx"></script>',
    `<script type="module">${js}</script>`
  );

await Bun.write('./dist/playground.html', html);
console.log('Built: dist/playground.html');
