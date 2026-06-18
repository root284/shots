import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PORT        = process.env.PORT || 3000;
const OPENAI_KEY  = process.env.OPENAI_API_KEY?.trim();
const GEMINI_KEY  = process.env.GEMINI_API_KEY?.trim();
const __dirname   = dirname(fileURLToPath(import.meta.url));
const DIST        = join(__dirname, "dist");
const PUBLIC      = join(__dirname, "public");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js":   "application/javascript",
  ".css":  "text/css",
  ".png":  "image/png",
  ".svg":  "image/svg+xml",
  ".json": "application/json",
  ".ico":  "image/x-icon",
  ".woff2": "font/woff2",
  ".woff":  "font/woff",
};

function isShots(req) {
  const host = req.headers.host || "";
  return host.includes("shots");
}

// ── 공통: body 읽기 ───────────────────────────────────────────────────────────
async function readBody(req) {
  const chunks = [];
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("body read timeout")), 25_000);
    req.on("data", c => chunks.push(c));
    req.on("end",  () => { clearTimeout(timeout); resolve(); });
    req.on("error",e => { clearTimeout(timeout); reject(e); });
    req.on("close",() => { clearTimeout(timeout); resolve(); });
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
    const lineEnd = buffer.indexOf("\r\n\r\n", afterSep);
    if (lineEnd === -1) break;
    const headerStr = buffer.slice(afterSep + 2, lineEnd).toString();
    const nextSep = buffer.indexOf(sep, lineEnd + 4);
    const bodyEnd = nextSep === -1 ? buffer.length : nextSep - 2;
    parts.push({ headers: headerStr, body: buffer.slice(lineEnd + 4, bodyEnd) });
    start = nextSep === -1 ? buffer.length : nextSep;
  }
  return parts;
}

function getDisposition(headers) {
  const m = headers.match(/Content-Disposition:[^\r\n]*/i);
  if (!m) return {};
  return {
    name:     m[0].match(/name="([^"]+)"/)?.[1],
    filename: m[0].match(/filename="([^"]+)"/)?.[1],
  };
}

// ── shots: 작업 큐 ────────────────────────────────────────────────────────────
const jobs = new Map();
let jobCounter = 0;
function newJob() {
  const jobId = `job_${Date.now()}_${++jobCounter}`;
  jobs.set(jobId, { status: "pending" });
  setTimeout(() => jobs.delete(jobId), 10 * 60 * 1000);
  return jobId;
}

// ── shots: 앵글 생성 ──────────────────────────────────────────────────────────
async function generateAngles(req, res) {
  if (!GEMINI_KEY) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "GEMINI_API_KEY not configured" }));
    return;
  }

  const ct = req.headers["content-type"] || "";
  const buffer = await readBody(req);

  let sceneDescription = "", characterDesc = "", imageBase64 = null, imageMime = null;
  let count = 10, existingAngles = [];

  if (ct.includes("multipart/form-data")) {
    const bm = ct.match(/boundary=(?:"([^"]+)"|([^\s;]+))/);
    if (bm) {
      for (const part of parseMultipart(buffer, bm[1] || bm[2])) {
        const { name, filename } = getDisposition(part.headers);
        const mime = () => part.headers.match(/Content-Type:\s*([^\r\n]+)/i)?.[1]?.trim() || "image/jpeg";
        if (name === "sceneDescription")  sceneDescription = part.body.toString();
        else if (name === "characterDesc") characterDesc    = part.body.toString();
        else if (name === "image" && filename) { imageMime = mime(); imageBase64 = part.body.toString("base64"); }
        else if (name === "count")         count = parseInt(part.body.toString()) || 10;
        else if (name === "existingAngles") { try { existingAngles = JSON.parse(part.body.toString()); } catch {} }
      }
    }
  } else {
    const body = JSON.parse(buffer.toString());
    sceneDescription = body.sceneDescription || "";
    characterDesc    = body.characterDesc    || "";
  }

  if (!sceneDescription.trim() && !imageBase64 && !characterDesc.trim()) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "장면 설명 또는 이미지를 입력해주세요." }));
    return;
  }

  const jobId = newJob();
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ jobId }));

  (async () => {
    try {
      const ANGLE_POOL = [
        "Establishing Shot","Wide Shot","Medium Shot","Close-Up","Extreme Close-Up",
        "Low Angle","High Angle / Bird's Eye","Dutch Tilt",
        "Over-the-Shoulder","Two Shot",
        "Foreground Framing","Mirror Reflection","Through Glass","Silhouette",
      ];
      const excludeNote = existingAngles.length
        ? `\nALREADY USED ANGLES (do NOT repeat): ${existingAngles.join(", ")}.` : "";

      const systemPrompt = `You are a professional cinematographer and storyboard artist.
Your task: given a scene, generate ${count} different cinematic angle cards — each a different way to shoot the SAME scene.

${characterDesc.trim() ? `CHARACTER INFO: ${characterDesc.trim()}\nReference these characters by name in every koreanDescription and imagePrompt. Include their appearance details in every imagePrompt for consistency.` : ""}
${imageBase64 ? `A SCENE REFERENCE IMAGE is provided. Analyze the spatial layout, characters, mood, and narrative context.` : ""}

Select angles from this pool: ${ANGLE_POOL.join(", ")}.${excludeNote}
Weight your selection based on scene emotion/tone. Choose a diverse, dramatically effective set of ${count}.
Always include at least one shot with foreground framing or environmental obstruction.

For each imagePrompt:
- Describe characters and their positions in detail
- Include environment and lighting
- Change ONLY the camera angle/framing between cards
- Write in rich cinematic detail — this prompt will be used in professional image generation tools
- For "Extreme Close-Up": choose the most dramatically relevant body part based on scene context (eyes for gazing/emotion, mouth/lips for dialogue, hands for gestures, feet for walking/running). Specify exactly which part and why it matters narratively.

Respond with a JSON array of exactly ${count} objects:
- "angleName": string (from the pool)
- "koreanDescription": string (2-3 lines in Korean, directorial intent)
- "imagePrompt": string — MUST start with "Black and white storyboard sketch, rough pencil lines, cinematic composition, professional storyboard art. " then camera angle description, then scene and character details.

Return ONLY the JSON array, no markdown, no explanation.`;

      const geminiParts = [];
      if (imageBase64) {
        geminiParts.push({ inlineData: { mimeType: imageMime, data: imageBase64 } });
        geminiParts.push({ text: "SCENE REFERENCE IMAGE (above)" });
      }
      const ctx = [
        imageBase64 ? "scene reference image provided" : null,
        characterDesc.trim() ? `characters: ${characterDesc.slice(0, 100)}` : null,
        sceneDescription.trim() ? `scene: ${sceneDescription}` : null,
      ].filter(Boolean);
      geminiParts.push({ text: `${ctx.join("; ")}.\n\nGenerate ${count} cinematic angles.${existingAngles.length ? ` Do NOT use: ${existingAngles.join(", ")}.` : ""}` });

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
        let errMsg = "Gemini API error";
        try { errMsg = JSON.parse(geminiText).error?.message || errMsg; } catch {}
        jobs.set(jobId, { status: "error", error: errMsg });
        return;
      }

      const data = JSON.parse(geminiText);
      if (data.candidates?.[0]?.finishReason && data.candidates[0].finishReason !== "STOP") {
        jobs.set(jobId, { status: "error", error: `Gemini 오류: ${data.candidates[0].finishReason}` });
        return;
      }

      const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
      const jsonMatch = rawText.match(/\[[\s\S]*\]/);
      if (!jsonMatch) { jobs.set(jobId, { status: "error", error: "Gemini 응답 형식 오류" }); return; }

      const angles = JSON.parse(jsonMatch[0]);
      jobs.set(jobId, { status: "done", result: { angles } });
    } catch (e) {
      jobs.set(jobId, { status: "error", error: e.message });
    }
  })();
}

async function jobResult(req, res) {
  const jobId = new URL(req.url, "http://localhost").searchParams.get("jobId");
  if (!jobId || !jobs.has(jobId)) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Job not found" }));
    return;
  }
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(jobs.get(jobId)));
}

// ── storyboard: OpenAI 프록시 ─────────────────────────────────────────────────
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

  const fetchRes = await fetch(targetUrl, {
    method: req.method, headers,
    body: body.length > 0 ? body : undefined,
    signal: AbortSignal.timeout(180_000),
  });
  const ct = fetchRes.headers.get("content-type");
  res.writeHead(fetchRes.status, ct ? { "Content-Type": ct } : {});
  res.end(Buffer.from(await fetchRes.arrayBuffer()));
}

// ── storyboard: Gemini 영상 분석 ──────────────────────────────────────────────
async function analyzeVideoWithGemini(req, res) {
  if (!GEMINI_KEY) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "GEMINI_API_KEY not set on server" }));
    return;
  }

  const mimeType = req.headers["content-type"] || "video/mp4";
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const videoData = Buffer.concat(chunks);

  const boundary = `BOUNDARY_${Date.now()}`;
  const metaPart = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
    `{"file":{"displayName":"storyboard_ref"}}\r\n` +
    `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`
  );
  const endPart = Buffer.from(`\r\n--${boundary}--`);
  const uploadBody = Buffer.concat([metaPart, videoData, endPart]);

  const uploadRes = await fetch(
    `https://generativelanguage.googleapis.com/upload/v1beta/files?uploadType=multipart&key=${GEMINI_KEY}`,
    {
      method: "POST",
      headers: {
        "Content-Type": `multipart/related; boundary=${boundary}`,
        "Content-Length": String(uploadBody.length),
      },
      body: uploadBody,
      signal: AbortSignal.timeout(180_000),
    }
  );

  if (!uploadRes.ok) {
    const err = await uploadRes.json().catch(() => ({}));
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err?.error?.message ?? "Gemini upload failed" }));
    return;
  }

  const uploadJson = await uploadRes.json();
  const fileUri  = uploadJson.file?.uri;
  const fileName = uploadJson.file?.name;

  if (!fileUri) {
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "파일 URI를 받지 못했습니다" }));
    return;
  }

  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const stateJson = await fetch(`https://generativelanguage.googleapis.com/v1beta/${fileName}?key=${GEMINI_KEY}`)
      .then(r => r.json());
    if (stateJson.state === "ACTIVE") break;
    if (stateJson.state === "FAILED") {
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Gemini 파일 처리 실패" }));
      return;
    }
  }

  const prompt = `이 영상을 글 콘티 형식으로 묘사하세요. 각 씬/컷을 아래 형식으로 작성합니다.

출력 형식 (마크다운 헤더·설명 없이 이 형식만):
≈[타임코드] [샷사이즈/앵글] | 화면: [배경·공간·조명·색감 묘사] | 피사체: [인물 위치·복장·표정·동작] | 카메라: [카메라 무브·속도·방향] | 분위기: [감정·무드 한 줄]

예시:
≈0:00 M.F.S./eye-level | 화면: 스테인드글라스 창이 있는 고딕 성당 내부, 따뜻한 자연광 | 피사체: 금발 여성, 붉은 드레스, 측면으로 천천히 걸어감 | 카메라: Slow dolly left, 인물을 측면에서 팔로우 | 분위기: 장엄하고 고독한 존재감

주의사항:
- 타임코드는 해당 씬이 실제로 시작되는 시각
- 카메라 무브는 구체적으로 (FIX / PAN left·right / TILT up·down / 달리 in·out / 트래킹 / 핸드헬드 / 줌 in·out + 속도)
- 씬 전환이 없는 연속 장면도 카메라 앵글·피사체가 크게 바뀌면 별도 컷으로 분리
- 모든 컷 빠짐없이 작성`;

  const genRes = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [
        { fileData: { mimeType, fileUri } },
        { text: prompt },
      ]}] }),
      signal: AbortSignal.timeout(120_000),
    }
  );

  fetch(`https://generativelanguage.googleapis.com/v1beta/${fileName}?key=${GEMINI_KEY}`, { method: "DELETE" }).catch(() => {});

  const genJson = await genRes.json();
  if (!genRes.ok) {
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: genJson.error?.message ?? "Gemini 생성 실패" }));
    return;
  }

  const text = genJson.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ text }));
}

// ── storyboard: Gemini 이미지 분석 ───────────────────────────────────────────
async function analyzeImagesWithGemini(req, res) {
  if (!GEMINI_KEY) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "GEMINI_API_KEY not set on server" }));
    return;
  }

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const { images } = JSON.parse(Buffer.concat(chunks).toString());

  if (!images?.length) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "images 배열이 비어있습니다" }));
    return;
  }

  const prompt = `이 이미지(들)를 글콘티 형식으로 묘사하세요. 각 이미지를 하나의 컷으로 보고 아래 형식으로 작성합니다.

출력 형식 (마크다운 헤더·설명 없이 이 형식만):
≈[컷번호] [샷사이즈/앵글] | 화면: [배경·공간·조명·색감 묘사] | 피사체: [인물 위치·복장·표정·동작] | 카메라: [카메라 무브 추정·고정 여부] | 분위기: [감정·무드 한 줄]

주의사항:
- 샷사이즈: EWS / WS / MWS / MFS / MS / MCU / CU / ECU 중 선택
- 앵글: eye-level / low-angle / high-angle / bird's-eye / dutch-angle 중 선택
- 카메라는 정지 이미지에서 추정 가능한 범위로만 묘사
- 피사체가 없으면 "피사체: 없음"으로 표기
- 이미지 순서대로 컷번호 부여`;

  const parts = [
    ...images.map(img => ({ inlineData: { mimeType: img.mimeType, data: img.data } })),
    { text: prompt },
  ];

  const genRes = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts }] }),
      signal: AbortSignal.timeout(60_000),
    }
  );

  const genJson = await genRes.json();
  if (!genRes.ok) {
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: genJson.error?.message ?? "Gemini 이미지 분석 실패" }));
    return;
  }

  const text = genJson.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ text }));
}

// ── 정적 파일 서빙 ────────────────────────────────────────────────────────────
async function serveStatic(req, res, root) {
  let filePath = join(root, req.url.split("?")[0]);
  try {
    if ((await stat(filePath)).isDirectory()) filePath = join(filePath, "index.html");
  } catch {
    filePath = join(root, "index.html");
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

// ── 라우터 ────────────────────────────────────────────────────────────────────
const server = createServer(async (req, res) => {
  try {
    if (isShots(req)) {
      // shots.qpola.net → shots 앵글 생성기
      if (req.url === "/api/generate-angles" && req.method === "POST") {
        await generateAngles(req, res);
      } else if (req.url.startsWith("/api/job-result") && req.method === "GET") {
        await jobResult(req, res);
      } else {
        await serveStatic(req, res, PUBLIC);
      }
    } else {
      // storyboard.qpola.net → 스토리보드 + 영상분석기
      if (req.url.startsWith("/api/openai/")) {
        await proxyOpenAI(req, res);
      } else if (req.url === "/api/gemini/analyze" && req.method === "POST") {
        await analyzeVideoWithGemini(req, res);
      } else if (req.url === "/api/gemini/analyze-image" && req.method === "POST") {
        await analyzeImagesWithGemini(req, res);
      } else {
        await serveStatic(req, res, DIST);
      }
    }
  } catch (e) {
    console.error("Handler error:", e.message);
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: e.message } }));
    }
  }
});

process.on("uncaughtException",  e => console.error("Uncaught:", e.message));
process.on("unhandledRejection", e => console.error("Unhandled:", e));

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`GEMINI_KEY: ${GEMINI_KEY ? "✓" : "✗ MISSING"}`);
  console.log(`OPENAI_KEY: ${OPENAI_KEY ? "✓" : "✗ MISSING"}`);
});
