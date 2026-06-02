import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PORT = process.env.PORT || 3000;
const OPENAI_KEY = process.env.OPENAI_API_KEY;
const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = join(__dirname, "dist");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
};

async function proxyOpenAI(req, res) {
  if (!OPENAI_KEY) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { message: "OPENAI_API_KEY not set on server" } }));
    return;
  }
  const targetUrl = `https://api.openai.com${req.url.replace(/^\/api\/openai/, "")}`;
  const headers = { Authorization: `Bearer ${OPENAI_KEY}` };
  if (req.headers["content-type"]) headers["content-type"] = req.headers["content-type"];

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks);

  try {
    const fetchRes = await fetch(targetUrl, {
      method: req.method,
      headers,
      body: body.length > 0 ? body : undefined,
    });
    const ct = fetchRes.headers.get("content-type");
    res.writeHead(fetchRes.status, ct ? { "Content-Type": ct } : {});
    res.end(Buffer.from(await fetchRes.arrayBuffer()));
  } catch (e) {
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { message: e.message } }));
  }
}

async function serveStatic(req, res) {
  let filePath = join(DIST, req.url.split("?")[0]);
  try {
    if ((await stat(filePath)).isDirectory()) filePath = join(filePath, "index.html");
  } catch {
    filePath = join(DIST, "index.html"); // SPA fallback
  }
  try {
    const data = await readFile(filePath);
    res.writeHead(200, { "Content-Type": MIME[extname(filePath)] || "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}

createServer(async (req, res) => {
  if (req.url.startsWith("/api/openai/")) {
    await proxyOpenAI(req, res);
  } else {
    await serveStatic(req, res);
  }
}).listen(PORT, () => console.log(`Server running on port ${PORT}`));
