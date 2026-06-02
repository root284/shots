import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PORT = process.env.PORT || 3000;
const OPENAI_KEY  = process.env.OPENAI_API_KEY?.trim();
const GEMINI_KEY  = process.env.GEMINI_API_KEY?.trim();
const __dirname   = dirname(fileURLToPath(import.meta.url));
const DIST        = join(__dirname, "dist");

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

// ── OpenAI 프록시 ─────────────────────────────────────────────────────────────
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
    method: req.method,
    headers,
    body: body.length > 0 ? body : undefined,
    signal: AbortSignal.timeout(180_000),
  });
  const ct = fetchRes.headers.get("content-type");
  res.writeHead(fetchRes.status, ct ? { "Content-Type": ct } : {});
  res.end(Buffer.from(await fetchRes.arrayBuffer()));
}

// ── Gemini 영상 분석 프록시 ───────────────────────────────────────────────────
// POST /api/gemini/analyze
//   Body  : raw video bytes
//   Header: content-type = video/* MIME type
//   Returns: { text: "글콘티 결과" }
async function analyzeVideoWithGemini(req, res) {
  if (!GEMINI_KEY) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "GEMINI_API_KEY not set on server" }));
    return;
  }

  const mimeType = req.headers["content-type"] || "video/mp4";

  // 1. 영상 데이터 수신
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const videoData = Buffer.concat(chunks);
  console.log(`Gemini upload: ${(videoData.length / 1024 / 1024).toFixed(1)} MB`);

  // 2. Gemini Files API 업로드 (multipart)
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
  const fileName = uploadJson.file?.name; // "files/xxx"

  if (!fileUri) {
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "파일 URI를 받지 못했습니다" }));
    return;
  }

  // 3. 파일 처리 완료(ACTIVE) 대기 — 최대 60초
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const stateRes  = await fetch(`https://generativelanguage.googleapis.com/v1beta/${fileName}?key=${GEMINI_KEY}`);
    const stateJson = await stateRes.json();
    const state = stateJson.state;
    console.log(`Gemini file state: ${state} (attempt ${i + 1})`);
    if (state === "ACTIVE") break;
    if (state === "FAILED") {
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Gemini 파일 처리 실패" }));
      return;
    }
  }

  // 4. 글콘티 분석 요청
  const prompt = `이 영상을 글 콘티 형식으로 묘사하세요. 각 씬/컷을 아래 형식으로 작성합니다.

출력 형식 (마크다운 헤더·설명 없이 이 형식만):
≈[타임코드] [샷사이즈/앵글] | 화면: [배경·공간·조명·색감 묘사] | 피사체: [인물 위치·복장·표정·동작] | 카메라: [카메라 무브·속도·방향] | 분위기: [감정·무드 한 줄]

예시:
≈0:00 M.F.S./eye-level | 화면: 스테인드글라스 창이 있는 고딕 성당 내부, 따뜻한 자연광 | 피사체: 금발 여성, 붉은 드레스, 측면으로 천천히 걸어감 | 카메라: Slow dolly left, 인물을 측면에서 팔로우 | 분위기: 장엄하고 고독한 존재감
≈0:03 E.C.U./eye-level | 화면: 부드럽게 흐릿한 배경, 빛 입자 | 피사체: 인물 하관 측면 클로즈업, 입술·턱선 | 카메라: 이전과 같은 속도 트래킹, 핸드헬드 미세 흔들림 | 분위기: 내면을 감추는 차가운 아름다움

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
      body: JSON.stringify({
        contents: [{ parts: [
          { fileData: { mimeType, fileUri } },
          { text: prompt },
        ]}],
      }),
      signal: AbortSignal.timeout(120_000),
    }
  );

  // 5. 파일 삭제 (best-effort)
  fetch(`https://generativelanguage.googleapis.com/v1beta/${fileName}?key=${GEMINI_KEY}`, { method: "DELETE" })
    .catch(() => {});

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

// ── 정적 파일 서빙 ────────────────────────────────────────────────────────────
async function serveStatic(req, res) {
  let filePath = join(DIST, req.url.split("?")[0]);
  try {
    if ((await stat(filePath)).isDirectory()) filePath = join(filePath, "index.html");
  } catch {
    filePath = join(DIST, "index.html");
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
    if (req.url.startsWith("/api/openai/")) {
      await proxyOpenAI(req, res);
    } else if (req.url === "/api/gemini/analyze" && req.method === "POST") {
      await analyzeVideoWithGemini(req, res);
    } else {
      await serveStatic(req, res);
    }
  } catch (e) {
    console.error("Handler error:", e.message);
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: e.message } }));
    }
  }
});

process.on("uncaughtException", (e) => console.error("Uncaught:", e.message));
process.on("unhandledRejection", (e) => console.error("Unhandled:", e));

server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
