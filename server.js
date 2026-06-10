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
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("body read timeout")), 25_000);
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => { clearTimeout(timeout); resolve(); });
    req.on("error", (e) => { clearTimeout(timeout); reject(e); });
    req.on("aborted", () => { clearTimeout(timeout); reject(new Error("request aborted")); });
    req.on("close", () => { clearTimeout(timeout); resolve(); });
  });
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

// ── 작업 큐 (각도 + 이미지 공통) ─────────────────────────────────────────────
const jobs = new Map(); // jobId → { status, result?, error? }
let jobCounter = 0;
function newJob() {
  const jobId = `job_${Date.now()}_${++jobCounter}`;
  jobs.set(jobId, { status: "pending" });
  setTimeout(() => jobs.delete(jobId), 10 * 60 * 1000); // 10분 후 정리
  return jobId;
}

// ── /api/generate-angles  (즉시 jobId 반환 → 백그라운드 Gemini) ───────────────
async function generateAngles(req, res) {
  if (!GEMINI_KEY) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "GEMINI_API_KEY not configured on server" }));
    return;
  }

  // body 읽기
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

  // 즉시 jobId 반환
  const jobId = newJob();
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ jobId }));
  console.log(`[${jobId}] Angles job started`);

  // 백그라운드에서 Gemini 호출
  (async () => {
    try {
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

      const geminiParts = [];
      if (imageBase64) {
        geminiParts.push({ inlineData: { mimeType: imageMime, data: imageBase64 } });
        geminiParts.push({ text: "SCENE REFERENCE IMAGE (above)" });
      }
      const contextParts = [
        imageBase64 ? "scene reference image provided" : null,
        characterDesc.trim() ? `characters: ${characterDesc.slice(0, 100)}` : null,
        sceneDescription.trim() ? `scene: ${sceneDescription}` : null,
      ].filter(Boolean);
      geminiParts.push({ text: `${contextParts.join("; ")}.\n\nGenerate ${count} cinematic angles.${existingAngles.length ? ` Do NOT use: ${existingAngles.join(", ")}.` : ""}` });

      const apiRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: systemPrompt }] },
            contents: [{ parts: geminiParts }],
            generationConfig: { maxOutputTokens: 4096, temperature: 1.0, thinkingConfig: { thinkingBudget: 0 } },
          }),
          signal: AbortSignal.timeout(90_000),
        }
      );

      const geminiText = await apiRes.text();
      if (!apiRes.ok) {
        console.error(`[${jobId}] Gemini error:`, geminiText.slice(0, 500));
        let errMsg = "Gemini API error";
        try { errMsg = JSON.parse(geminiText).error?.message || errMsg; } catch {}
        jobs.set(jobId, { status: "error", error: errMsg });
        return;
      }

      const data = JSON.parse(geminiText);
      const finishReason = data.candidates?.[0]?.finishReason;
      if (finishReason && finishReason !== "STOP") {
        jobs.set(jobId, { status: "error", error: `Gemini 응답 오류: ${finishReason}` });
        return;
      }

      const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
      console.log(`[${jobId}] Gemini raw (first 200):`, rawText.slice(0, 200));
      const jsonMatch = rawText.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        jobs.set(jobId, { status: "error", error: "Gemini가 예상하지 못한 형식을 반환했습니다" });
        return;
      }

      const angles = JSON.parse(jsonMatch[0]);
      jobs.set(jobId, { status: "done", result: { angles } });
      console.log(`[${jobId}] Done: ${angles.length} angles`);
    } catch (e) {
      console.error(`[${jobId}] Angles error:`, e.message);
      jobs.set(jobId, { status: "error", error: e.message });
    }
  })();
}

// ── /api/job-result  (공통 폴링 엔드포인트) ────────────────────────────────────
async function jobResult(req, res) {
  const url = new URL(req.url, "http://localhost");
  const jobId = url.searchParams.get("jobId");
  if (!jobId || !jobs.has(jobId)) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Job not found" }));
    return;
  }
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(jobs.get(jobId)));
}

// ── /api/generate-image  (즉시 jobId 반환 → 백그라운드에서 OpenAI 호출) ────────
async function generateImage(req, res) {
  if (!OPENAI_KEY) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "OPENAI_API_KEY not configured on server" }));
    return;
  }

  const body = JSON.parse((await readBody(req)).toString());
  const { prompt, imageBase64, imageMime } = body;
  if (!prompt?.trim()) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "prompt required" }));
    return;
  }

  // 즉시 jobId 반환
  const jobId = newJob();
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ jobId }));

  const fullPrompt = imageBase64
    // 레퍼런스 있을 때: 스타일은 이미지에서 자동으로 읽힘 → 구도 무시 지시만 추가
    ? `IMPORTANT: Use the attached image ONLY as a reference for character design and art style. Do NOT copy its composition, camera angle, or spatial layout — ignore the arrangement entirely. Draw a completely new scene with this composition: ${prompt}`
    // 레퍼런스 없을 때: 스타일 지시어 포함
    : `Black and white storyboard sketch, rough pencil lines, cinematic composition, professional storyboard art. ${prompt}`;
  console.log(`[${jobId}] OpenAI prompt (first 150):`, fullPrompt.slice(0, 150));
  console.log(`[${jobId}] Reference image:`, imageBase64 ? "provided" : "none");

  (async () => {
    try {
      let openaiRes;

      if (imageBase64) {
        // 레퍼런스 이미지 있을 때 → /v1/images/edits
        // 구도 복사 방지: 프롬프트에 명시적으로 "스타일·캐릭터만 참고, 구도는 무시" 지시
        const imgBuffer = Buffer.from(imageBase64, "base64");
        const boundary = `----FormBoundary${Date.now()}`;
        const mime = imageMime || "image/jpeg";
        const ext = mime.split("/")[1] || "jpg";

        const field = (name, value) =>
          `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`;
        const fileField = Buffer.concat([
          Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="image[]"; filename="ref.${ext}"\r\nContent-Type: ${mime}\r\n\r\n`),
          imgBuffer,
          Buffer.from("\r\n"),
        ]);
        const formBody = Buffer.concat([
          Buffer.from(field("model", "gpt-image-1")),
          Buffer.from(field("prompt", fullPrompt)),
          Buffer.from(field("n", "1")),
          Buffer.from(field("size", "1536x1024")),
          Buffer.from(field("quality", "high")),
          fileField,
          Buffer.from(`--${boundary}--\r\n`),
        ]);

        openaiRes = await fetch("https://api.openai.com/v1/images/edits", {
          method: "POST",
          headers: { "Authorization": `Bearer ${OPENAI_KEY}`, "Content-Type": `multipart/form-data; boundary=${boundary}` },
          body: formBody,
          signal: AbortSignal.timeout(120_000),
        });
      } else {
        // 레퍼런스 없을 때 → /v1/images/generations (JSON)
        openaiRes = await fetch("https://api.openai.com/v1/images/generations", {
          method: "POST",
          headers: { "Authorization": `Bearer ${OPENAI_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model: "gpt-image-1", prompt: fullPrompt, n: 1, size: "1536x1024", quality: "high" }),
          signal: AbortSignal.timeout(120_000),
        });
      }

      const openaiText = await openaiRes.text();
      console.log(`[${jobId}] OpenAI response: status=${openaiRes.status}, body=${openaiText.slice(0, 200)}`);

      if (!openaiRes.ok) {
        let errMsg = `OpenAI ${openaiRes.status}`;
        try { errMsg = JSON.parse(openaiText).error?.message || errMsg; } catch {}
        jobs.set(jobId, { status: "error", error: errMsg });
        return;
      }

      const b64 = JSON.parse(openaiText).data?.[0]?.b64_json;
      if (!b64) { jobs.set(jobId, { status: "error", error: "No image returned from OpenAI" }); return; }

      jobs.set(jobId, { status: "done", result: { imageData: `data:image/png;base64,${b64}` } });
      console.log(`[${jobId}] Image done.`);
    } catch (e) {
      console.error(`[${jobId}] OpenAI error:`, e.message);
      jobs.set(jobId, { status: "error", error: e.message });
    }
  })();
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
    } else if (req.url.startsWith("/api/job-result") && req.method === "GET") {
      await jobResult(req, res);
    } else {
      await serveStatic(req, res);
    }
  } catch (e) {
    console.error(`Handler error [${req.method} ${req.url}]:`, e.message);
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
