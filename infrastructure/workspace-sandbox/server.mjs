import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Findex workspace verification</title><link rel="stylesheet" href="/workspace.css"></head><body><div id="root"></div><script type="module" src="/workspace.js"></script></body></html>`;
const types = { ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };

const port = Number(process.env.WORKSPACE_PREVIEW_PORT ?? 4173);

createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    if (pathname === "/") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      response.end(html);
      return;
    }
    const cleanPath = pathname.replace(/^\/+/, "");
    if (cleanPath !== "workspace.js" && cleanPath !== "workspace.css") throw new Error("Not found");
    const body = await readFile(join(process.cwd(), "dist", cleanPath));
    response.writeHead(200, { "content-type": types[extname(cleanPath)] ?? "application/octet-stream" });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
}).listen(port, "127.0.0.1");
