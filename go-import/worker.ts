// Cloudflare Worker for the Go import path odgn.net/rights. The go command
// fetches https://odgn.net/rights/...?go-get=1 and reads the go-import tag,
// which points it at the go/ directory of the repository (the subdirectory
// field needs Go 1.25+ when fetching directly; the module proxy handles it
// for older toolchains). Browsers are sent to the package documentation.

const MODULE = 'odgn.net/rights';
const REPO = 'https://tangled.org/alex.veenenda.al/odgn-rights';
const SUBDIR = 'go';

const page = `<!doctype html>
<html>
<head>
<meta name="go-import" content="${MODULE} git ${REPO} ${SUBDIR}">
<meta name="go-source" content="${MODULE} ${REPO} ${REPO}/tree/main/${SUBDIR}{/dir} ${REPO}/blob/main/${SUBDIR}{/dir}/{file}#L{line}">
<meta http-equiv="refresh" content="0; url=https://pkg.go.dev/${MODULE}">
</head>
<body><a href="https://pkg.go.dev/${MODULE}">${MODULE}</a></body>
</html>
`;

export default {
  fetch(request: Request): Response {
    const url = new URL(request.url);
    if (url.searchParams.get('go-get') === '1') {
      return new Response(page, {
        headers: {
          'cache-control': 'public, max-age=3600',
          'content-type': 'text/html; charset=utf-8'
        }
      });
    }
    const docs = `https://pkg.go.dev/${MODULE}${url.pathname.slice('/rights'.length)}`;
    return Response.redirect(docs, 302);
  }
};
