/**
 * The world's `github.com`: Cota's latest release as GitHub serves it, holding
 * the working tree's build under the tree's version. `releases/latest` is sent
 * on to the version's page, and its downloads are the files of `/release/files`.
 * Anything else is a 404.
 */
const version = process.env.COTA_VERSION;
if (version === undefined || version === "")
  throw new Error("COTA_VERSION names the release's version");

const repository = "/limineol/cota/releases";
const downloads = `${repository}/download/v${version}/`;

Bun.serve({
  hostname: "0.0.0.0",
  port: 443,
  tls: {
    cert: Bun.file("/release/release.crt"),
    key: Bun.file("/release/release.key"),
  },
  async fetch(request) {
    const { pathname } = new URL(request.url);
    if (pathname === `${repository}/latest`)
      return Response.redirect(
        `https://github.com${repository}/tag/v${version}`,
        302,
      );
    if (pathname === `${repository}/tag/v${version}`)
      return new Response(`Cota ${version}, the install eval's release\n`);
    if (pathname.startsWith(downloads)) {
      const name = pathname.slice(downloads.length);
      const file = Bun.file(`/release/files/${name}`);
      if (/^[\w.-]+$/.test(name) && (await file.exists()))
        return new Response(file, {
          headers: { "content-type": "application/octet-stream" },
        });
    }
    return new Response("Not Found", { status: 404 });
  },
});
