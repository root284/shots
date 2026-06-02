import express from "express";
import { fileURLToPath } from "url";
import path from "path";

const app = express();
const PORT = process.env.PORT || 3000;
const OPENAI_KEY = process.env.OPENAI_API_KEY;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Proxy OpenAI requests — keeps the API key server-side
app.use(
  "/api/openai",
  express.raw({ type: "*/*", limit: "50mb" }),
  async (req, res) => {
    if (!OPENAI_KEY) {
      return res.status(500).json({ error: { message: "OPENAI_API_KEY not set on server" } });
    }
    try {
      const targetUrl = `https://api.openai.com${req.url}`;
      const headers = { Authorization: `Bearer ${OPENAI_KEY}` };
      if (req.headers["content-type"]) {
        headers["content-type"] = req.headers["content-type"];
      }
      const fetchRes = await fetch(targetUrl, {
        method: req.method,
        headers,
        body: req.body?.length ? req.body : undefined,
      });
      res.status(fetchRes.status);
      const ct = fetchRes.headers.get("content-type");
      if (ct) res.setHeader("content-type", ct);
      const data = await fetchRes.arrayBuffer();
      res.send(Buffer.from(data));
    } catch (e) {
      res.status(502).json({ error: { message: e.message } });
    }
  }
);

// Serve built frontend
app.use(express.static(path.join(__dirname, "dist")));
app.get("*", (_req, res) =>
  res.sendFile(path.join(__dirname, "dist", "index.html"))
);

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
