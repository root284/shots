// shots.qpola.net — Cinematic angle generator
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PORT        = process.env.PORT || 3000;
const GEMINI_KEY  = process.env.GEMINI_API_KEY?.trim();
const OPENAI_KEY  = process.env.OPENAI_API_KEY?.trim();
const __dirname   = dirname(fileURLToPath(import.meta.url));
const PUBLIC      = join(__dirname, "public");

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
    if (buffer[afterSep] === 0x2d && buffer[afterSep + 1] === 0x2d) break;
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
  if (!GEMINI_KEY) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "GEMINI_API_KEY not configured on server" }));
    return;
  }

  const ct = req.headers["content-type"] || "";
  const buffer = await readBody(req);

  let sceneDescription = "";
  let characterDesc = "";
  let imageBase64 = null, imageMime = null;
  let count = 9;
  let existingAngles = [];

  if (ct.includes("multipart/form-data")) {
    const boundaryMatch = ct.match(/boundary=(?:"([^"]+)"|([^\s;]+))/);
    if (boundaryMatch) {
      const parts = parseMultipart(buffer, boundaryMatch[1] || boundaryMatch[2]);
      for (const part of parts) {
        const { name, filename } = getContentDisposition(part.headers);
        const mime = () => (part.headers.match(/Content-Type:\s*([^\r\n]+)/i)?.[1]?.trim() || "image/jpeg");
        if (name === "sceneDescription") {
          sceneDescription = part.body.toString();
        } else if (name === "characterDesc") {
          characterDesc = part.body.toString();
        } else if (name === "image" && filename) {
          imageMime = mime(); imageBase64 = part.body.toString("base64");
        } else if (name === "count") {
          count = parseInt(part.body.toString()) || 9;
        } else if (name === "existingAngles") {
          try { existingAngles = JSON.parse(part.body.toString()); } catch {}
        }
      }
    }
  } else {
    const body = JSON.parse(buffer.toString());
    sceneDescription = body.sceneDescription || "";
    characterDesc = body.characterDesc || "";
  }

  if (!sceneDescription.trim() && !imageBase64 && !characterDesc.trim()) {
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

  const excludeNote = existingAngles.length
    ? `\nALREADY USED ANGLES (do NOT repeat these): ${existingAngles.join(", ")}.`
    : "";

  const systemPrompt = `You are a professional cinematographer and storyboard artist.
Your task: given a scene, generate ${count} different cinematic angle cards — each a different way to shoot the SAME scene.

${characterDesc.trim() ? `CHARACTER INFO: ${characterDesc.trim()}
Reference these characters by name in every koreanDescription and imagePrompt. Include their appearance details in every imagePrompt for consistency.` : ""}
${imageBase64 ? `A SCENE REFERENCE IMAGE is provided. Analyze the spatial layout, characters, mood, and narrative context.` : ""}

Select angles from this pool: ${ANGLE_POOL.join(", ")}.${excludeNote}
Weight your selection based on scene emotion/tone. Choose a diverse, dramatically effective set of ${count}.
Always include at least one shot with foreground framing or environmental obstruction (shooting through/past objects).

For each imagePrompt:
- Describe characters and their positions in detail
- Include environment and lighting
- Change ONLY the camera angle/framing between cards
- Write in rich cinematic detail — this prompt will be used in professional image generation tools

Respond with a JSON array of exactly ${count} objects:
- "angleName": string (from the pool)
- "koreanDescription": string (2-3 lines in Korean, directorial intent)
- "imagePrompt": string — MUST start with the camera angle/framing description (e.g. "Dutch tilt, camera angled 20 degrees, ..."), then scene and character details.

Return ONLY the JSON array, no markdown, no explanation.`;

  const parts = [];
  if (imageBase64) {
    parts.push({ inlineData: { mimeType: imageMime, data: imageBase64 } });
    parts.push({ text: "SCENE REFERENCE IMAGE (above)" });
  }

  const contextParts = [
    imageBase64 ? "scene reference image provided" : null,
    characterDesc.trim() ? `characters: ${characterDesc.slice(0, 100)}` : null,
    sceneDescription.trim() ? `scene: ${sceneDescription}` : null,
  ].filter(Boolean);

  parts.push({ text: `${contextParts.join("; ")}.\n\nGenerate ${count} cinematic angles.${existingAngles.length ? ` Do NOT use: ${existingAngles.join(", ")}.` : ""}` });

  const apiRes = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [{ parts }],
        generationConfig: { maxOutputTokens: 4096, temperature: 1.0, thinkingConfig: { thinkingBudget: 0 } },
      }),
      signal: AbortSignal.timeout(60_000),
    }
  );

  const geminiText = await apiRes.text();
  if (!apiRes.ok) {
    console.error("Gemini error:", geminiText.slice(0, 500));
    let errMsg = "Gemini API error";
    try { errMsg = JSON.parse(geminiText).error?.message || errMsg; } catch {}
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: errMsg }));
    return;
  }

  const data = JSON.parse(geminiText);
  const finishReason = data.candidates?.[0]?.finishReason;
  if (finishReason && finishReason !== "STOP") {
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: `Gemini 응답 오류: ${finishReason}` }));
    return;
  }

  const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
  console.log("Gemini raw (first 200):", rawText.slice(0, 200));
  const jsonMatch = rawText.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Gemini가 예상하지 못한 형식을 반환했습니다" }));
    return;
  }

  const angles = JSON.parse(jsonMatch[0]);
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ angles }));
}

// ── /api/generate-image  (OpenAI gpt-image-1, SSE keepalive) ─────────────────
async function generateImage(req, res) {
  if (!OPENAI_KEY) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "OPENAI_API_KEY not configured on server" }));
    return;
  }

  const { prompt } = JSON.parse((await readBody(req)).toString());
  if (!prompt?.trim()) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "prompt required" }));
    return;
  }

  const fullPrompt = `black and white storyboard sketch, rough pencil lines, cinematic composition, professional storyboard art, no color — ${prompt}`;
  console.log("OpenAI image prompt (first 150):", fullPrompt.slice(0, 150));

  // SSE로 응답 — Railway 연결 끊김 방지용 keepalive 전송
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "X-Accel-Buffering": "no",
  });

  // 10초마다 keepalive 전송
  const keepalive = setInterval(() => {
    try { res.write(": keepalive\n\n"); } catch {}
  }, 10_000);

  try {
    const openaiRes = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { "Authorization": `Bearer ${OPENAI_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-image-1", prompt: fullPrompt, n: 1, size: "1536x1024", quality: "low" }),
      signal: AbortSignal.timeout(120_000),
    });

    const openaiText = await openaiRes.text();
    console.log(`OpenAI response: status=${openaiRes.status}, body=${openaiText.slice(0, 200)}`);

    if (!openaiRes.ok) {
      let errMsg = `OpenAI ${openaiRes.status}`;
      try { errMsg = JSON.parse(openaiText).error?.message || errMsg; } catch {}
      res.end(`data: ${JSON.stringify({ error: errMsg })}\n\n`);
      return;
    }

    const b64 = JSON.parse(openaiText).data?.[0]?.b64_json;
    if (!b64) {
      res.end(`data: ${JSON.stringify({ error: "No image returned from OpenAI" })}\n\n`);
      return;
    }

    res.end(`data: ${JSON.stringify({ imageData: `data:image/png;base64,${b64}` })}\n\n`);
  } catch (e) {
    console.error("OpenAI error:", e.message);
    res.end(`data: ${JSON.stringify({ error: e.message })}\n\n`);
  } finally {
    clearInterval(keepalive);
  }
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

server.listen(PORT, () => {
  console.log(`shots.qpola.net server running on port ${PORT}`);
  console.log(`GEMINI_KEY:  ${GEMINI_KEY  ? '✓ set' : '✗ MISSING'}`);
  console.log(`OPENAI_KEY:  ${OPENAI_KEY  ? '✓ set' : '✗ MISSING'}`);
});
