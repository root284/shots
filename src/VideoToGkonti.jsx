import React, { useState, useRef } from "react";
import { Loader2, Film, Image, Copy, Check, AlertTriangle, Square, UploadCloud } from "lucide-react";

const C = {
  paper: "#efe9dd", panel: "#f7f3ea", ink: "#16130f",
  inkSoft: "#5a5246", red: "#b3331f", line: "#ccc0a6", lineSoft: "#ddd4bf",
};

const isAbort = (e) => e?.name === "AbortError" || e?.message === "Aborted";

const readFileAsDataURL = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = (e) => resolve(e.target.result);
  reader.onerror = reject;
  reader.readAsDataURL(file);
});

async function analyzeImages(files, signal) {
  const images = await Promise.all(files.map(async (f) => {
    const dataURL = await readFileAsDataURL(f);
    return { data: dataURL.split(",")[1], mimeType: f.type || "image/jpeg" };
  }));

  const res = await fetch("/api/gemini/analyze-image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ images }),
    signal,
  });

  const json = await res.json();
  if (!res.ok || json.error) throw new Error(json.error ?? "Gemini 이미지 분석 실패");
  return json.text ?? "";
}

export default function VideoToGkonti() {
  const [analyzing, setAnalyzing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [fileName, setFileName] = useState("");
  const [fileType, setFileType] = useState(""); // "video" | "image"
  // image preview thumbnails
  const [previews, setPreviews] = useState([]); // [{ name, dataURL }]
  const fileRef = useRef(null);
  const abortRef = useRef(null);

  const reset = () => { setResult(""); setFileName(""); setFileType(""); setError(""); setPreviews([]); };

  const handleUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    e.target.value = "";

    const isImage = files[0].type.startsWith("image/");
    const isVideo = files[0].type.startsWith("video/");
    if (!isImage && !isVideo) { setError("영상(mp4·mov·webm) 또는 이미지(jpg·png·webp) 파일만 지원합니다."); return; }

    setFileName(files.length === 1 ? files[0].name : `이미지 ${files.length}장`);
    setFileType(isImage ? "image" : "video");
    setResult("");
    setError("");
    setPreviews([]);
    setAnalyzing(true);
    setProgress(0);
    abortRef.current = new AbortController();
    const { signal } = abortRef.current;

    try {
      if (isImage) {
        // 썸네일 미리보기 생성
        const thumbs = await Promise.all(files.map(async f => ({ name: f.name, dataURL: await readFileAsDataURL(f) })));
        setPreviews(thumbs);
        setProgress(30);
        const text = await analyzeImages(files, signal);
        setProgress(100);
        setResult(text.trim());
      } else {
        const timer = setInterval(() => setProgress(p => p < 88 ? p + 1 : p), 800);
        const res = await fetch("/api/gemini/analyze", {
          method: "POST",
          headers: { "Content-Type": files[0].type || "video/mp4" },
          body: files[0],
          signal,
        });
        clearInterval(timer);
        setProgress(95);
        const json = await res.json();
        if (!res.ok || json.error) throw new Error(json.error ?? "분석 실패");
        setResult(json.text.trim());
      }
    } catch (err) {
      if (!isAbort(err)) setError(err.message);
      if (isAbort(err)) reset();
    } finally {
      setAnalyzing(false);
      setProgress(0);
    }
  };

  const copy = () => {
    navigator.clipboard?.writeText(result);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const badgeLabel = "by Gemini";

  return (
    <div style={{ minHeight: "100vh", background: C.paper, color: C.ink, backgroundImage: "radial-gradient(#0000000a 0.5px, transparent 0.5px)", backgroundSize: "5px 5px", padding: "36px 20px 64px", fontFamily: "sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Zilla+Slab:wght@400;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap');
        * { box-sizing: border-box; }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
      `}</style>

      <div style={{ maxWidth: 780, margin: "0 auto" }}>

        {/* 헤더 */}
        <div style={{ borderBottom: `2px solid ${C.ink}`, paddingBottom: 14, marginBottom: 28, display: "flex", alignItems: "center", gap: 10 }}>
          <Film size={24} color={C.red} />
          <h1 style={{ margin: 0, fontFamily: "'Zilla Slab', serif", fontWeight: 700, fontSize: 24, letterSpacing: -0.3 }}>영상·이미지 → 글콘티</h1>
          {result && (
            <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, color: C.red, border: `1px solid ${C.red}`, padding: "2px 6px", borderRadius: 2 }}>{badgeLabel}</span>
          )}
          <a href="/" style={{ marginLeft: "auto", fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, color: C.inkSoft, textDecoration: "none", border: `1px solid ${C.line}`, padding: "3px 8px", borderRadius: 2 }}>← 콘티 시트 툴</a>
        </div>

        <p style={{ fontSize: 13.5, color: C.inkSoft, lineHeight: 1.7, marginBottom: 28 }}>
          영상·이미지를 올리면 <strong>Gemini</strong>가 씬별 카메라 워킹·샷 사이즈·분위기를 분석해
          글콘티 형식으로 변환합니다.<br />
          이미지는 여러 장을 동시에 올리면 순서대로 컷으로 처리합니다.
        </p>

        {/* 업로드 영역 */}
        {!analyzing && !result && (
          <div onClick={() => fileRef.current?.click()}
            style={{ border: `2px dashed ${C.line}`, borderRadius: 4, padding: "48px 24px", display: "flex", flexDirection: "column", alignItems: "center", gap: 14, cursor: "pointer", background: C.panel, animation: "fadeUp 0.3s ease both" }}>
            <UploadCloud size={36} color={C.inkSoft} />
            <div style={{ fontFamily: "'Zilla Slab', serif", fontSize: 17, fontWeight: 600 }}>파일을 클릭해서 업로드</div>
            <div style={{ display: "flex", gap: 10 }}>
              <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: C.inkSoft, background: C.lineSoft, padding: "3px 8px", borderRadius: 2 }}>🎬 mp4 · mov · webm</span>
              <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: C.inkSoft, background: C.lineSoft, padding: "3px 8px", borderRadius: 2 }}>🖼 jpg · png · webp (여러 장 가능)</span>
            </div>
          </div>
        )}
        <input ref={fileRef} type="file" accept="video/*,image/*" multiple style={{ display: "none" }} onChange={handleUpload} />

        {/* 분석 중 */}
        {analyzing && (
          <div style={{ border: `1.5px solid ${C.line}`, borderRadius: 4, padding: "36px 24px", background: C.panel, display: "flex", flexDirection: "column", alignItems: "center", gap: 14, animation: "fadeUp 0.3s ease both" }}>
            {/* 이미지 미리보기 */}
            {previews.length > 0 && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
                {previews.map((p, i) => (
                  <img key={i} src={p.dataURL} alt={p.name}
                    style={{ width: 72, height: 72, objectFit: "cover", border: `1.5px solid ${C.line}`, borderRadius: 3 }} />
                ))}
              </div>
            )}
            <Loader2 size={28} color={C.red} style={{ animation: "spin 1s linear infinite" }} />
            <div style={{ fontFamily: "'Zilla Slab', serif", fontSize: 15, fontWeight: 600 }}>{fileName} 분석 중…</div>
            {fileType === "video" && (
              <>
                <div style={{ width: 260, height: 4, background: C.lineSoft, borderRadius: 2 }}>
                  <div style={{ width: `${progress}%`, height: "100%", background: C.red, borderRadius: 2, transition: "width 0.6s ease" }} />
                </div>
                <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: C.inkSoft }}>{progress}% — 업로드 · 처리 중</div>
              </>
            )}
            <button onClick={() => abortRef.current?.abort()}
              style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "transparent", color: C.red, border: `1.5px solid ${C.red}`, padding: "6px 14px", borderRadius: 2, fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
              <Square size={10} fill={C.red} /> 중단
            </button>
          </div>
        )}

        {/* 에러 */}
        {error && (
          <div style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "12px 14px", border: `1.5px solid ${C.red}`, background: "#b3331f10", borderRadius: 3, color: C.red, fontSize: 13, marginTop: 16, animation: "fadeUp 0.3s ease both" }}>
            <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>{error}</span>
          </div>
        )}

        {/* 결과 */}
        {result && !analyzing && (
          <div style={{ animation: "fadeUp 0.35s ease both" }}>
            {/* 이미지 미리보기 (결과 화면에서도 표시) */}
            {previews.length > 0 && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
                {previews.map((p, i) => (
                  <img key={i} src={p.dataURL} alt={p.name}
                    style={{ width: 72, height: 72, objectFit: "cover", border: `1.5px solid ${C.line}`, borderRadius: 3 }} />
                ))}
              </div>
            )}

            <div style={{ border: `1.5px solid ${C.ink}`, borderRadius: 4, overflow: "hidden" }}>
              <div style={{ background: C.ink, padding: "10px 14px", display: "flex", alignItems: "center", gap: 8 }}>
                {fileType === "image" ? <Image size={13} color={C.paper} /> : <Film size={13} color={C.paper} />}
                <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, fontWeight: 700, color: C.paper, flex: 1 }}>{fileName}</span>
                <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9.5, color: "#ffffff88", marginRight: 8 }}>{badgeLabel}</span>
                <button onClick={copy}
                  style={{ display: "inline-flex", alignItems: "center", gap: 5, fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, fontWeight: 600, background: copied ? "#4caf50" : "transparent", color: C.paper, border: `1px solid ${copied ? "#4caf50" : "#ffffff44"}`, padding: "3px 10px", borderRadius: 2, cursor: "pointer" }}>
                  {copied ? <Check size={11} /> : <Copy size={11} />}
                  {copied ? "복사됨" : "전체 복사"}
                </button>
              </div>
              <div style={{ padding: "16px 18px", background: "#fffdf8" }}>
                <pre style={{ margin: 0, fontSize: 13, lineHeight: 1.85, color: C.ink, whiteSpace: "pre-wrap", fontFamily: "'IBM Plex Mono', monospace" }}>{result}</pre>
              </div>
            </div>

            <div style={{ marginTop: 14, display: "flex", gap: 10 }}>
              <button onClick={reset}
                style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: C.inkSoft, background: "none", border: `1px solid ${C.line}`, borderRadius: 2, padding: "6px 12px", cursor: "pointer" }}>
                새로 분석하기
              </button>
              <button onClick={() => {
                try {
                  const prev = JSON.parse(localStorage.getItem("sb_save") || "{}");
                  localStorage.setItem("sb_save", JSON.stringify({ ...prev, videoAnalysis: result, videoName: fileName }));
                } catch {}
                window.location.href = "/";
              }}
                style={{ fontFamily: "'Zilla Slab', serif", fontSize: 13, fontWeight: 700, color: C.paper, background: C.red, border: "none", borderRadius: 2, padding: "6px 16px", cursor: "pointer" }}>
                이 결과로 콘티 시트 만들기 →
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
