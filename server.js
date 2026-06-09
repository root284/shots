// shots.qpola.net — Cinematic angle generator
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PORT          = process.env.PORT || 3000;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY?.trim();
const FAL_KEY       = process.env.FAL_KEY?.trim();
const __dirname     = dirname(fileURLToPath(import.meta.url));
const PUBLIC        = join(__dirname, "public");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js":   "application/javascript",
  ".css":  "text/css",
  ".png":  "image/png",
  ".svg":  "image/svg+xml",
  ".json": "application/json",
  ".ico":  "image/x-icon",
};

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function parseMultipart(buffer, boundary) {
  const sep = Buffer.from(`--${boundary}`);
  const parts = [];
  let start = 0;
  while (start < buffer.length) {
    const sepIdx = buffer.indexOf(sep, start);
    if (sepIdx === -1) break;
    const afterSep = sepIdx + sep.length;
    if (buffer[afterSep] === 0x2d && buffer[afterSep + 1] === 0x2d) break; // --boundary--
    const lineEnd = buffer.indexOf('\r\n\r\n', afterSep);
    if (lineEnd === -1) break;
    const headerStr = buffer.slice(afterSep + 2, lineEnd).toString();
    const nextSep = buffer.indexOf(sep, lineEnd + 4);
    const bodyEnd = nextSep === -1 ? buffer.length : nextSep - 2;
    const body = buffer.slice(lineEnd + 4, bodyEnd);
    parts.push({ headers: headerStr, body });
    start = nextSep === -1 ? buffer.length : nextSep;
  }
  return parts;
}

function getContentDisposition(headers) {
  const match = headers.match(/Content-Disposition:[^\r\n]*/i);
  if (!match) return {};
  const nameMatch = match[0].match(/name="([^"]+)"/);
  const filenameMatch = match[0].match(/filename="([^"]+)"/);
  return { name: nameMatch?.[1], filename: filenameMatch?.[1] };
}

// ── /api/generate-angles ─────────────────────────────────────────────────────
async function generateAngles(req, res) {
  if (!ANTHROPIC_KEY) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "ANTHROPIC_API_KEY not configured on server" }));
    return;
  }

  const ct = req.headers["content-type"] || "";
  const buffer = await readBody(req);

  let sceneDescription = "";
  let imageBase64 = null;
  let imageMime = null;

  if (ct.includes("multipart/form-data")) {
    const boundaryMatch = ct.match(/boundary=([^\s;]+)/);
    if (boundaryMatch) {
      const parts = parseMultipart(buffer, boundaryMatch[1]);
      for (const part of parts) {
        const { name, filename } = getContentDisposition(part.headers);
        if (name === "sceneDescription") {
          sceneDescription = part.body.toString();
        } else if (name === "image" && filename) {
          const ctMatch = part.headers.match(/Content-Type:\s*([^\r\n]+)/i);
          imageMime = ctMatch?.[1]?.trim() || "image/jpeg";
          imageBase64 = part.body.toString("base64");
        }
      }
    }
  } else {
    const body = JSON.parse(buffer.toString());
    sceneDescription = body.sceneDescription || "";
  }

  if (!sceneDescription.trim() && !imageBase64) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "장면 설명 또는 이미지를 입력해주세요." }));
    return;
  }

  const ANGLE_POOL = [
    "Establishing Shot", "Wide Shot", "Medium Shot", "Close-Up", "Extreme Close-Up",
    "Low Angle", "High Angle / Bird's Eye", "Dutch Tilt",
    "Over-the-Shoulder", "Two Shot",
    "Foreground Framing", "Mirror Reflection", "Through Glass", "Silhouette"
  ];

  const systemPrompt = `You are a professional cinematographer and storyboard artist.
Your task: given a scene (from an image, text description, or both), imagine you are directing that exact same scene and generate 9 different cinematic angle cards — each one a different way to shoot the SAME scene.

If an image is provided, analyze it carefully: identify the subjects, setting, lighting, mood, spatial relationships, and narrative context. Then propose 9 alternative camera angles that could capture this scene.

Select angles from this pool: ${ANGLE_POOL.join(", ")}.
Weight your selection based on scene emotion/tone (e.g., more Close-Ups for emotional scenes, Establishing/Wide for location/action shots).
Avoid repetition — choose a diverse, dramatically effective set of 9 angles.

For each angle, the imagePrompt must faithfully preserve the scene's subjects, environment, lighting, and mood — only the camera angle/framing changes.

Respond with a JSON array of exactly 9 objects, each with:
- "angleName": string (angle name from the pool above)
- "koreanDescription": string (2-3 lines in Korean describing the visual and directorial intent for THIS angle)
- "imagePrompt": string (English prompt for FLUX image generation describing the scene from this specific angle; always end with ", black and white storyboard sketch, rough pencil lines, cinematic composition, professional storyboard art")

Return ONLY the JSON array, no markdown, no explanation.`;

  const userContent = [];

  if (imageBase64) {
    userContent.push({
      type: "image",
      source: { type: "base64", media_type: imageMime, data: imageBase64 }
    });
    const textPart = sceneDescription.trim()
      ? `Reference image above shows the scene. Additional context: ${sceneDescription}\n\nGenerate 9 different cinematic angles for shooting this same scene.`
      : `Reference image above shows the scene. Analyze it and generate 9 different cinematic angles for shooting this same scene.`;
    userContent.push({ type: "text", text: textPart });
  } else {
    userContent.push({ type: "text", text: `Scene description: ${sceneDescription}\n\nGenerate 9 different cinematic angles for shooting this scene.` });
  }

  const apiRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: "user", content: userContent }],
    }),
    signal: AbortSignal.timeout(60_000),
  });

  const data = await apiRes.json();
  if (!apiRes.ok) {
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: data.error?.message || "Claude API error" }));
    return;
  }

  const rawText = data.content?.[0]?.text?.trim() || "";
  const jsonMatch = rawText.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Claude returned unexpected format" }));
    return;
  }

  const angles = JSON.parse(jsonMatch[0]);
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ angles, hasStyleImage: !!imageBase64 }));
}

// ── /api/generate-image ──────────────────────────────────────────────────────
async function generateImage(req, res) {
  if (!FAL_KEY) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "FAL_KEY not configured on server" }));
    return;
  }

  const buffer = await readBody(req);
  const { prompt, styleImageBase64, styleImageMimeType } = JSON.parse(buffer.toString());

  if (!prompt) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "prompt is required" }));
    return;
  }

  const input = {
    prompt,
    image_size: "landscape_16_9",
    num_inference_steps: 4,
    num_images: 1,
    enable_safety_checker: false,
  };

  // fal.ai REST API — queue submit + poll
  const submitRes = await fetch("https://queue.fal.run/fal-ai/flux/schnell", {
    method: "POST",
    headers: {
      "Authorization": `Key ${FAL_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ input }),
    signal: AbortSignal.timeout(30_000),
  });

  const submitData = await submitRes.json();
  if (!submitRes.ok) {
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: submitData.detail || "fal.ai submit failed" }));
    return;
  }

  const requestId = submitData.request_id;
  const statusUrl = `https://queue.fal.run/fal-ai/flux/schnell/requests/${requestId}`;

  // poll until done
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const pollRes = await fetch(`${statusUrl}/status`, {
      headers: { "Authorization": `Key ${FAL_KEY}` },
    });
    const pollData = await pollRes.json();
    if (pollData.status === "COMPLETED") break;
    if (pollData.status === "FAILED") {
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "fal.ai image generation failed" }));
      return;
    }
  }

  const resultRes = await fetch(statusUrl, {
    headers: { "Authorization": `Key ${FAL_KEY}` },
  });
  const resultData = await resultRes.json();
  const imageUrl = resultData.output?.images?.[0]?.url;

  if (!imageUrl) {
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "No image returned from fal.ai" }));
    return;
  }

  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ imageUrl }));
}

// ── 정적 파일 서빙 ────────────────────────────────────────────────────────────
async function serveStatic(req, res) {
  let filePath = join(PUBLIC, req.url.split("?")[0]);
  try {
    if ((await stat(filePath)).isDirectory()) filePath = join(filePath, "index.html");
  } catch {
    filePath = join(PUBLIC, "index.html");
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

const server = createServer(async (req, res) => {
  try {
    if (req.url === "/api/generate-angles" && req.method === "POST") {
      await generateAngles(req, res);
    } else if (req.url === "/api/generate-image" && req.method === "POST") {
      await generateImage(req, res);
    } else {
      await serveStatic(req, res);
    }
  } catch (e) {
    console.error("Handler error:", e.message);
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
    }
  }
});

process.on("uncaughtException", (e) => console.error("Uncaught:", e.message));
process.on("unhandledRejection", (e) => console.error("Unhandled:", e));

server.listen(PORT, () => console.log(`shots.qpola.net server running on port ${PORT}`));
