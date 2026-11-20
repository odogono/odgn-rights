// Cloudflare Worker for the Go import paths under odgn.net/rights. The go
// command fetches https://odgn.net/rights/...?go-get=1 and reads the go-import
// tag, which points it at the module's directory in the repository (the
// subdirectory field needs Go 1.25+ when fetching directly; the module proxy
// handles it for older toolchains). Browsers are sent to the package
// documentation.

const REPO = 'https://github.com/odogono/odgn-rights';

// Each Go module in the repository: its import path and directory. A nested
// module gets its own go-import tag, so the go command looks in its own
// directory and reads its own `<dir>/vX.Y.Z` tags; the most specific prefix
// wins.
const MODULES = [
  { module: 'odgn.net/rights/postgres', subdir: 'go/postgres' },
  { module: 'odgn.net/rights', subdir: 'go' }
];

const page = ({ module, subdir }: (typeof MODULES)[number]) => `<!doctype html>
<html>
<head>
<meta name="go-import" content="${module} git ${REPO} ${subdir}">
<meta name="go-source" content="${module} ${REPO} ${REPO}/tree/main/${subdir}{/dir} ${REPO}/blob/main/${subdir}{/dir}/{file}#L{line}">
<meta http-equiv="refresh" content="0; url=https://pkg.go.dev/${module}">
</head>
<body><a href="https://pkg.go.dev/${module}">${module}</a></body>
</html>
`;

const moduleFor = (pathname: string) =>
  MODULES.find(({ module }) => {
    const path = `/${module.slice('odgn.net/'.length)}`;
    return pathname === path || pathname.startsWith(`${path}/`);
  })!;

export default {
  fetch(request: Request): Response | Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== '/rights' && !url.pathname.startsWith('/rights/')) {
      // Not ours: let the zone's origin handle it.
      return fetch(request);
    }
    if (url.searchParams.get('go-get') === '1') {
      return new Response(page(moduleFor(url.pathname)), {
        headers: {
          'cache-control': 'public, max-age=3600',
          'content-type': 'text/html; charset=utf-8'
        }
      });
    }
    const docs = `https://pkg.go.dev/odgn.net${url.pathname}`;
    return Response.redirect(docs, 302);
  }
};
