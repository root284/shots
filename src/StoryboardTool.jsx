import React, { useState, useRef } from "react";
import { Loader2, Copy, Check, Download, Clapperboard, AlertTriangle, Upload, ImagePlus, FileImage, UserCircle2, Image, Trash2 } from "lucide-react";

const C = {
  paper: "#efe9dd", panel: "#f7f3ea", ink: "#16130f",
  inkSoft: "#5a5246", red: "#b3331f", line: "#ccc0a6", lineSoft: "#ddd4bf",
};

const SAMPLE = "비 내리는 버스 정류장. 소녀가 우산도 없이 홀로 서 있다. 버스가 그녀를 지나쳐 떠나고, 빗속에 혼자 남는다. 젖은 채로 천천히 하늘을 올려다보더니, 아주 작게 웃는다.";

const SIZE_SCALE = {
  "L.S.": 0.22, "롱샷": 0.22, "F.S.": 0.6, "풀샷": 0.6,
  "니샷": 0.78, "K.S.": 0.78, "웨스트": 0.92, "W.S.": 0.92,
  "바스트": 1.15, "B.S.": 1.15, "업": 1.6, "U.P.": 1.6, "클로즈업": 1.6,
  "익스트림업": 2.4, "E.C.U.": 2.4,
};
function framingScale(size) {
  if (!size) return 0.6;
  const key = Object.keys(SIZE_SCALE).find((k) => size.includes(k));
  return key ? SIZE_SCALE[key] : 0.6;
}

const API_HEADERS = {
  "Content-Type": "application/json",
  "x-api-key": import.meta.env.VITE_ANTHROPIC_API_KEY ?? "",
  "anthropic-version": "2023-06-01",
  "anthropic-dangerous-direct-browser-access": "true",
};

function FramingHint({ size, angle }) {
  const scale = framingScale(size);
  const figH = Math.min(scale * 56, 78);
  const figW = figH * 0.42;
  const headR = figW * 0.42;
  const low = angle && (angle.includes("앙") || angle.toLowerCase().includes("low"));
  const high = angle && (angle.includes("부") || angle.toLowerCase().includes("high"));
  const skew = low ? -7 : high ? 7 : 0;
  return (
    <svg viewBox="0 0 160 90" width="100%" height="100%" preserveAspectRatio="xMidYMid slice" style={{ display: "block", background: "#e7e0d0" }}>
      <defs>
        <pattern id="gr" width="3" height="3" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r="0.4" fill="#00000008" />
        </pattern>
      </defs>
      <rect x="0" y="0" width="160" height="90" fill="url(#gr)" />
      {[53.3, 106.6].map(x => <line key={x} x1={x} y1="0" x2={x} y2="90" stroke="#0000000f" strokeWidth="1" />)}
      {[30, 60].map(y => <line key={y} x1="0" y1={y} x2="160" y2={y} stroke="#0000000f" strokeWidth="1" />)}
      <g transform={`translate(80 ${90 - figH * 0.5}) rotate(${skew})`}>
        <circle cx="0" cy={-figH * 0.5} r={headR} fill="none" stroke="#0000005c" strokeWidth="1.6" />
        <rect x={-figW * 0.5} y={-figH * 0.5 + headR} width={figW} height={figH * 0.5} fill="none" stroke="#0000005c" strokeWidth="1.6" />
      </g>
    </svg>
  );
}

function Tag({ label, value }) {
  if (!value) return null;
  return (
    <span style={{ display: "inline-flex", gap: 4, alignItems: "baseline", fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, lineHeight: 1.2, color: C.inkSoft, border: `1px solid ${C.lineSoft}`, borderRadius: 2, padding: "2px 5px", background: "#fff8" }}>
      <b style={{ color: C.red, fontWeight: 600, letterSpacing: 0.3 }}>{label}</b>
      <span style={{ color: C.ink }}>{value}</span>
    </span>
  );
}

function StepBadge({ n, label, active, done }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, opacity: active || done ? 1 : 0.38 }}>
      <div style={{ width: 24, height: 24, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", background: done ? C.red : active ? C.ink : "transparent", border: `1.5px solid ${active || done ? "transparent" : C.line}`, flexShrink: 0 }}>
        <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, fontWeight: 700, color: C.paper }}>{done ? "✓" : n}</span>
      </div>
      <span style={{ fontFamily: "'Zilla Slab', serif", fontSize: 14, fontWeight: active ? 700 : 500, color: active ? C.ink : C.inkSoft }}>{label}</span>
    </div>
  );
}

function CutRow({ cut, imageData, onUpload, onCopyPrompt, copied, runningTime }) {
  const fileRef = useRef(null);
  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => onUpload(cut.no, ev.target.result);
    reader.readAsDataURL(file);
  };
  const secStart = (runningTime - (Number(cut.sec) || 0)).toFixed(1);
  const secEnd = runningTime.toFixed(1);

  return (
    <tr style={{ borderBottom: `1.5px solid ${C.ink}` }}>
      {/* 컷 번호 */}
      <td style={{ width: 48, textAlign: "center", verticalAlign: "middle", borderRight: `1.5px solid ${C.ink}`, padding: "10px 6px", background: C.panel }}>
        <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700, fontSize: 13, color: C.ink }}>{cut.no}</div>
      </td>

      {/* 시간 */}
      <td style={{ width: 72, textAlign: "center", verticalAlign: "middle", borderRight: `1.5px solid ${C.ink}`, padding: "10px 6px", background: C.panel }}>
        <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: C.inkSoft, lineHeight: 1.6 }}>
          <span style={{ color: C.ink, fontWeight: 600 }}>{secStart}s</span>
          <br />~
          <br /><span style={{ color: C.ink, fontWeight: 600 }}>{secEnd}s</span>
        </div>
      </td>

      {/* 이미지 */}
      <td style={{ width: 260, borderRight: `1.5px solid ${C.ink}`, padding: 0, verticalAlign: "stretch" }}>
        <div style={{ position: "relative", width: "100%", height: "100%", cursor: "pointer", overflow: "hidden" }}
          onClick={() => fileRef.current?.click()}>
          {imageData
            ? <img src={imageData} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
            : <FramingHint size={cut.size} angle={cut.angle} />
          }
          <div style={{ position: "absolute", left: 5, top: 5, fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, color: C.inkSoft, background: "#efe9ddcc", padding: "1px 4px", borderRadius: 2 }}>
            {cut.size || "—"} · {cut.angle || "—"}
          </div>
          <div style={{ position: "absolute", right: 5, bottom: 5, display: "flex", gap: 4 }}>
            <button onClick={(e) => { e.stopPropagation(); onCopyPrompt(cut); }}
              style={{ cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 3, fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, fontWeight: 600, background: copied ? C.ink : "#ffffffcc", color: copied ? C.paper : C.red, border: `1px solid ${C.red}`, padding: "2px 6px", borderRadius: 2 }}>
              {copied ? <Check size={9} /> : <Copy size={9} />}
              {copied ? "복사" : "PROMPT"}
            </button>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 3, fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, fontWeight: 600, background: "#ffffffcc", color: C.inkSoft, border: `1px solid ${C.line}`, padding: "2px 6px", borderRadius: 2 }}>
              <ImagePlus size={9} />{imageData ? "교체" : "이미지"}
            </div>
          </div>
          <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleFileChange} />
        </div>
      </td>

      {/* 내용·연출 / 카메라·화면 */}
      <td style={{ verticalAlign: "top", padding: 0 }}>
        {/* 내용·연출 */}
        <div style={{ padding: "10px 14px", borderBottom: `1px dashed ${C.line}` }}>
          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9.5, fontWeight: 700, color: C.red, marginBottom: 6, letterSpacing: 0.5 }}>내용 · 연출</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {cut.desc && (
              <div style={{ fontSize: 12.5, lineHeight: 1.5, color: C.ink }}>
                · {cut.desc}
              </div>
            )}
            {cut.action && (
              <div style={{ fontSize: 12.5, lineHeight: 1.5, color: C.ink }}>
                · {cut.action}
              </div>
            )}
            {cut.emotion && (
              <div style={{ fontSize: 12.5, lineHeight: 1.5, color: C.inkSoft }}>
                · <span style={{ color: C.red }}>감정</span> {cut.emotion}
              </div>
            )}
            {cut.dialogue && (
              <div style={{ fontSize: 12.5, lineHeight: 1.5, color: C.ink, borderLeft: `2px solid ${C.red}`, paddingLeft: 7, fontStyle: "italic", marginTop: 2 }}>
                「{cut.dialogue}」
              </div>
            )}
          </div>
        </div>

        {/* 카메라·화면 */}
        <div style={{ padding: "10px 14px" }}>
          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 9.5, fontWeight: 700, color: C.red, marginBottom: 6, letterSpacing: 0.5 }}>카메라 · 화면</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {(cut.size || cut.angle) && (
              <div style={{ fontSize: 12.5, lineHeight: 1.5, color: C.ink }}>
                · {[cut.size, cut.angle].filter(Boolean).join(" / ")}
              </div>
            )}
            {cut.camera && (
              <div style={{ fontSize: 12.5, lineHeight: 1.5, color: C.ink }}>
                · 카메라 {cut.camera}
              </div>
            )}
            {cut.transition && (
              <div style={{ fontSize: 12.5, lineHeight: 1.5, color: C.inkSoft }}>
                · <span style={{ color: C.red }}>전환</span> {cut.transition}
              </div>
            )}
          </div>
        </div>
      </td>
    </tr>
  );
}

export default function StoryboardTool() {
  const [rawInput, setRawInput] = useState(SAMPLE);
  const [seconds, setSeconds] = useState(10);
  const [gkontiText, setGkontiText] = useState("");
  const [cuts, setCuts] = useState(null);
  const [metadata, setMetadata] = useState(null);
  const [panelImages, setPanelImages] = useState({});
  const [loading1, setLoading1] = useState(false);
  const [loading2, setLoading2] = useState(false);
  const [error, setError] = useState("");
  const [copiedNo, setCopiedNo] = useState(null);
  const [exporting, setExporting] = useState(false);

  // 레퍼런스 이미지 — 이름만 관리, 묘사는 프롬프트에 넣지 않음
  const [charRefs, setCharRefs] = useState([]); // [{id, name, dataURL}]
  const [bgRef, setBgRef] = useState(null);      // {dataURL}
  const charFileRef = useRef(null);
  const bgFileRef = useRef(null);

  const step = gkontiText ? (cuts ? 3 : 2) : 1;

  const addCharRef = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const id = Date.now();
      const name = file.name.replace(/\.[^.]+$/, "");
      setCharRefs(prev => [...prev, { id, name, dataURL: ev.target.result }]);
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const addBgRef = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setBgRef({ dataURL: ev.target.result });
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const buildStage1Prompt = () =>
    `당신은 애니메이션 연출가입니다. 아래 원문을 글 콘티로 다듬으세요.

핵심 규칙:
1. 원문에 "타임라인" 또는 시간 구간(예: 0.0~4.0초)이 있으면, 그 타임라인 구간만을 컷 구성의 유일한 기준으로 삼는다.
   - "포함 장면", "대사 배치" 등 다른 섹션은 타임라인을 이해하기 위한 참고 메모일 뿐, 별도의 컷으로 만들지 않는다.
   - 같은 장면을 중복 생성하거나 순서를 바꾸지 않는다.
2. 원문에 타임라인이 없으면 원문의 서술 순서대로만 컷을 구성한다.
3. 각 컷에 명시된 대사·카메라·샷 사이즈는 그대로 유지하고, 없는 정보(색감, 감정 강도, 음향 등)만 보완한다.
4. 재해석·재배열·중복 생성 금지.
5. 설명이나 메타 코멘트 없이 아래 형식만 출력.

출력 형식(한국어):

【씬 정보】
원문의 장소/시간 그대로 + 원문에 없는 조명·날씨 요소만 보완

【전체 톤】
분위기, 색감 방향, 음악 느낌

【감정선】
씬 전체 감정 흐름 한 줄

【연출 포인트】
· (원문 의도를 살린 연출 노트 3~5개. 원문에 있는 내용을 뒤집지 말 것)

【컷 구상】
(타임라인 구간 = 컷. 순서·대사·샷 변경 금지. 전체 약 ${seconds}초. 최소 6컷 이상 구성)
1. [샷 사이즈/앵글] | 화면: ... | 연기: ... | 감정: ... | ~Xs
2. ...

[원문]
${rawInput.trim()}`;

  const runStage1 = async () => {
    setLoading1(true); setError(""); setGkontiText(""); setCuts(null); setPanelImages({});
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: API_HEADERS,
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 2048,
          messages: [{ role: "user", content: buildStage1Prompt() }],
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message ?? `HTTP ${res.status}`);
      const text = (json.content || []).filter(b => b.type === "text").map(b => b.text).join("\n");
      if (!text.trim()) throw new Error("빈 응답");
      setGkontiText(text.trim());
    } catch (e) {
      setError(`1단계 실패: ${e.message}`);
    } finally {
      setLoading1(false);
    }
  };

  const buildStage2Prompt = () => {
    const charNames = charRefs.map(c => c.name).join(", ");
    const hasChars = charRefs.length > 0;
    const hasBg = !!bgRef;
    const hasRefs = hasChars || hasBg;

    const refNote = hasRefs
      ? `[등록된 레퍼런스 이미지]\n${hasChars ? `- 캐릭터 시트: ${charNames}` : ""}${hasBg ? "\n- 배경 레퍼런스: 1장" : ""}\n\n위 레퍼런스 이미지는 사용자가 이미지 생성 툴에 직접 첨부할 예정입니다. prompt에 캐릭터 외형이나 배경을 텍스트로 묘사하지 말고, 대신 아래 문구를 프롬프트 끝에 추가하세요:\n${hasChars ? `"Use attached character sheet(s) [${charNames}] as strict visual reference for character appearance — do not alter hair, clothing, or colors."` : ""}${hasBg ? '\n"Use attached background reference image for environment and setting."' : ""}\n`
      : "";

    return `당신은 애니메이션 연출/콘티 전문가입니다. 아래 글 콘티를 구조화된 JSON으로 변환하세요.

[통제 어휘]
- size: L.S. / F.S. / 니샷 / 웨스트 / 바스트 / 업 / 익스트림업
- camera: FIX / PAN / TILT / T.U. / T.B. / 이동 / 흘림
- transition: cut / O.L. / F.I. / F.O. / 화이트 / 블랙

${refNote}[컷 수 규칙 — 최우선]
- 출력 컷 수는 반드시 최소 6장, 최대 8장
- 글 콘티의 원본 컷이 6장 미만이면, 아래 방법으로 분할하여 6장을 채울 것:
  · 한 장면을 샷 사이즈 변화로 분할 (풀샷 → 미디엄 → 클로즈업 등)
  · 인물 반응 또는 감정 변화 전후를 별도 컷으로 분리
  · 동작의 시작·중간·끝을 각각 컷으로 분리
  · 공간 설정 컷(establishing shot)을 앞에 추가
- 각 분할 컷의 sec 합계는 원본 씬 총 시간과 동일하게 유지

[prompt 작성 규칙]
- 영어로 작성, 30~50단어
- 포함 필수: ① 샷 사이즈·앵글 ② 장면 상황·동작 ③ 조명·색감 ④ 아트 스타일 ⑤ aspect ratio 16:9
- 캐릭터 외형(헤어·의상·색상)은 텍스트로 묘사하지 말 것${hasRefs ? " — 레퍼런스 참조 문구로 대체" : ""}
- 아트 스타일은 글 콘티 톤 반영 (예: anime cel-shading, cinematic illustration 등)

[출력] JSON만. 마크다운·설명 금지.
{"tone":"...","emotionArc":"...","artStyle":"전체 아트 스타일 한 줄(영어)","cuts":[{"no":1,"size":"","angle":"eye-level/부감/앙각","camera":"","sec":2.0,"emotion":"감정/강도","desc":"구도·피사체 한 줄(10단어 이하)","action":"연출 지시(없으면 빈 문자열)","dialogue":"대사(없으면 빈 문자열)","transition":"","prompt":"image generation prompt, 30-50 words, no character appearance description"}]}

[글 콘티]
${gkontiText}`;
  };

  const runStage2 = async () => {
    setLoading2(true); setError(""); setCuts(null); setPanelImages({});
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: API_HEADERS,
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 4096,
          messages: [{ role: "user", content: buildStage2Prompt() }],
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message ?? `HTTP ${res.status}`);
      const text = (json.content || []).filter(b => b.type === "text").map(b => b.text).join("\n");
      const clean = text.replace(/```json|```/g, "").trim();
      const s = clean.indexOf("{"), e = clean.lastIndexOf("}");
      const parsed = JSON.parse(clean.slice(s, e + 1));
      if (!parsed.cuts || !Array.isArray(parsed.cuts)) throw new Error("컷 데이터 없음");
      setCuts(parsed.cuts);
      setMetadata({ tone: parsed.tone, emotionArc: parsed.emotionArc });
    } catch (e) {
      setError(`2단계 실패: ${e.message}`);
    } finally {
      setLoading2(false);
    }
  };

  const handleImageUpload = (no, dataURL) => {
    setPanelImages(prev => ({ ...prev, [no]: dataURL }));
  };

  const copyPrompt = (cut) => {
    navigator.clipboard?.writeText(cut.prompt || cut.desc || "");
    setCopiedNo(cut.no);
    setTimeout(() => setCopiedNo(n => n === cut.no ? null : n), 1500);
  };

  const exportAsImage = async () => {
    if (!cuts) return;
    setExporting(true);
    try {
      const COLS = 3;
      const CELL_W = 340;
      const HEADER_H = 24;
      const IMG_H = Math.round(CELL_W * 9 / 16);
      const TEXT_H = 96;
      const CELL_H = HEADER_H + IMG_H + TEXT_H;
      const GAP = 10;
      const PAD = 20;
      const rows = Math.ceil(cuts.length / COLS);
      const canvasW = PAD * 2 + COLS * CELL_W + (COLS - 1) * GAP;
      const canvasH = PAD * 2 + rows * CELL_H + (rows - 1) * GAP;

      const canvas = document.createElement("canvas");
      canvas.width = canvasW;
      canvas.height = canvasH;
      const ctx = canvas.getContext("2d");

      ctx.fillStyle = "#efe9dd";
      ctx.fillRect(0, 0, canvasW, canvasH);

      const imgs = {};
      await Promise.all(cuts.map(cut => new Promise(resolve => {
        if (!panelImages[cut.no]) return resolve();
        const img = new Image();
        img.onload = () => { imgs[cut.no] = img; resolve(); };
        img.onerror = () => resolve();
        img.src = panelImages[cut.no];
      })));

      cuts.forEach((cut, i) => {
        const col = i % COLS;
        const row = Math.floor(i / COLS);
        const x = PAD + col * (CELL_W + GAP);
        const y = PAD + row * (CELL_H + GAP);

        ctx.strokeStyle = "#16130f"; ctx.lineWidth = 1.5;
        ctx.strokeRect(x + 0.75, y + 0.75, CELL_W - 1.5, CELL_H - 1.5);

        ctx.fillStyle = "#16130f";
        ctx.fillRect(x, y, CELL_W, HEADER_H);
        ctx.fillStyle = "#efe9dd";
        ctx.font = "bold 12px 'IBM Plex Mono', monospace";
        ctx.textAlign = "left"; ctx.textBaseline = "middle";
        ctx.fillText(`CUT ${String(cut.no).padStart(2, "0")}`, x + 9, y + HEADER_H / 2);
        ctx.fillStyle = "#f0a89c";
        ctx.textAlign = "right";
        ctx.fillText(`${cut.sec}s`, x + CELL_W - 9, y + HEADER_H / 2);
        ctx.textAlign = "left";

        const imgY = y + HEADER_H;
        if (imgs[cut.no]) {
          ctx.drawImage(imgs[cut.no], x, imgY, CELL_W, IMG_H);
        } else {
          ctx.fillStyle = "#ddd5c2";
          ctx.fillRect(x, imgY, CELL_W, IMG_H);
          ctx.fillStyle = "#9a9080";
          ctx.font = "11px 'IBM Plex Mono', monospace";
          ctx.textAlign = "center"; ctx.textBaseline = "middle";
          ctx.fillText(`${cut.size || "—"} · ${cut.angle || "—"}`, x + CELL_W / 2, imgY + IMG_H / 2);
          ctx.textAlign = "left";
        }

        ctx.strokeStyle = "#16130f"; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, imgY + IMG_H); ctx.lineTo(x + CELL_W, imgY + IMG_H); ctx.stroke();

        const tY = imgY + IMG_H;
        ctx.fillStyle = "#f7f3ea";
        ctx.fillRect(x, tY, CELL_W, TEXT_H);

        ctx.fillStyle = "#16130f";
        ctx.font = "12px sans-serif"; ctx.textBaseline = "top";
        const desc = (cut.desc || "").slice(0, 52);
        const midChar = 26;
        ctx.fillText(desc.slice(0, midChar), x + 9, tY + 8);
        if (desc.length > midChar) ctx.fillText(desc.slice(midChar), x + 9, tY + 22);

        ctx.fillStyle = "#5a5246";
        ctx.font = "10px 'IBM Plex Mono', monospace";
        ctx.fillText(`${cut.size || ""} ${cut.camera || ""} ${cut.emotion || ""}`, x + 9, tY + 42);

        if (cut.dialogue) {
          ctx.fillStyle = "#b3331f";
          ctx.font = "italic 11px sans-serif";
          ctx.fillText(`「${cut.dialogue.slice(0, 28)}」`, x + 9, tY + 60);
        }
      });

      canvas.toBlob(blob => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = "storyboard.png"; a.click();
        URL.revokeObjectURL(url);
      }, "image/png");
    } finally {
      setExporting(false);
    }
  };

  const exportJSON = () => {
    if (!cuts) return;
    const blob = new Blob([JSON.stringify({ metadata, cuts }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "storyboard.json"; a.click();
    URL.revokeObjectURL(url);
  };

  const total = cuts?.reduce((s, c) => s + (Number(c.sec) || 0), 0) || 0;
  const inRange = total >= 5 && total <= 15;

  return (
    <div style={{ minHeight: "100%", background: C.paper, color: C.ink, backgroundImage: "radial-gradient(#0000000a 0.5px, transparent 0.5px)", backgroundSize: "5px 5px", padding: "26px 20px 56px" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Zilla+Slab:wght@400;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap');
        * { box-sizing: border-box; }
        textarea { font-family: inherit; }
        textarea::placeholder { color: #5a524688; }
        @keyframes fadeUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>

      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ borderBottom: `2px solid ${C.ink}`, paddingBottom: 14, marginBottom: 24 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Clapperboard size={26} color={C.red} />
            <h1 style={{ margin: 0, fontFamily: "'Zilla Slab', serif", fontWeight: 700, fontSize: 27, letterSpacing: -0.4 }}>글 → 콘티 시트</h1>
            <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: C.red, border: `1px solid ${C.red}`, padding: "2px 6px", borderRadius: 2, marginLeft: 4 }}>v1.2</span>
          </div>
        </div>

        <div style={{ display: "flex", gap: 20, marginBottom: 24, flexWrap: "wrap" }}>
          <StepBadge n="1" label="글 → 글콘티" active={step === 1} done={step > 1} />
          <span style={{ color: C.line, alignSelf: "center" }}>›</span>
          <StepBadge n="2" label="글콘티 → 콘티 시트" active={step === 2} done={step > 2} />
          <span style={{ color: C.line, alignSelf: "center" }}>›</span>
          <StepBadge n="3" label="이미지 업로드 · 저장" active={step === 3} done={false} />
        </div>

        {error && (
          <div style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "11px 14px", border: `1.5px solid ${C.red}`, background: "#b3331f10", borderRadius: 3, color: C.red, fontSize: 13, marginBottom: 18 }}>
            <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>{error}</span>
          </div>
        )}

        {/* 레퍼런스 이미지 패널 */}
        <div style={{ border: `1.5px solid ${C.line}`, background: C.panel, marginBottom: 20 }}>
          <div style={{ padding: "10px 14px", borderBottom: `1px solid ${C.lineSoft}`, display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, fontWeight: 700, color: C.inkSoft }}>REF</span>
            <span style={{ fontFamily: "'Zilla Slab', serif", fontWeight: 600, fontSize: 15 }}>캐릭터 시트 · 배경 레퍼런스</span>
            <span style={{ marginLeft: "auto", fontSize: 11, color: C.inkSoft }}>이름이 프롬프트에 참조 문구로 자동 삽입됨</span>
          </div>
          <div style={{ padding: 14, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>

            {/* 캐릭터 시트 목록 */}
            {charRefs.map(c => (
              <div key={c.id} style={{ position: "relative", width: 110, flexShrink: 0 }}>
                <div style={{ position: "relative", width: 110, height: 110, border: `1.5px solid ${C.ink}`, overflow: "hidden", background: "#ddd5c2" }}>
                  <img src={c.dataURL} alt={c.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  <button onClick={() => setCharRefs(prev => prev.filter(x => x.id !== c.id))}
                    style={{ position: "absolute", top: 3, right: 3, background: C.red, border: "none", borderRadius: 2, cursor: "pointer", display: "flex", padding: 2 }}>
                    <Trash2 size={10} color={C.paper} />
                  </button>
                </div>
                <input
                  value={c.name}
                  onChange={e => setCharRefs(prev => prev.map(x => x.id === c.id ? { ...x, name: e.target.value } : x))}
                  style={{ marginTop: 4, width: "100%", fontSize: 10.5, fontFamily: "'IBM Plex Mono', monospace", color: C.ink, background: "#fffdf8", border: `1px solid ${C.lineSoft}`, borderRadius: 2, padding: "2px 5px", outline: "none" }}
                />
              </div>
            ))}

            {/* 캐릭터 추가 버튼 */}
            <div onClick={() => charFileRef.current?.click()}
              style={{ width: 110, height: 110, border: `1.5px dashed ${C.line}`, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 5, cursor: "pointer", flexShrink: 0, background: "#fffdf8" }}>
              <UserCircle2 size={22} color={C.inkSoft} />
              <span style={{ fontSize: 10.5, fontFamily: "'IBM Plex Mono', monospace", color: C.inkSoft, textAlign: "center", lineHeight: 1.3 }}>캐릭터 시트<br/>추가</span>
            </div>
            <input ref={charFileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={addCharRef} />

            {/* 구분선 */}
            <div style={{ width: 1, background: C.lineSoft, alignSelf: "stretch", margin: "0 4px" }} />

            {/* 배경 레퍼런스 */}
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ fontSize: 10.5, fontFamily: "'IBM Plex Mono', monospace", color: C.inkSoft, fontWeight: 600 }}>배경 레퍼런스</div>
              {bgRef ? (
                <div style={{ position: "relative", width: 180 }}>
                  <div style={{ position: "relative", width: 180, height: 102, border: `1.5px solid ${C.ink}`, overflow: "hidden", background: "#ddd5c2" }}>
                    <img src={bgRef.dataURL} alt="bg" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    <button onClick={() => setBgRef(null)}
                      style={{ position: "absolute", top: 3, right: 3, background: C.red, border: "none", borderRadius: 2, cursor: "pointer", display: "flex", padding: 2 }}>
                      <Trash2 size={10} color={C.paper} />
                    </button>
                  </div>
                </div>
              ) : (
                <div onClick={() => bgFileRef.current?.click()}
                  style={{ width: 180, height: 102, border: `1.5px dashed ${C.line}`, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 5, cursor: "pointer", background: "#fffdf8" }}>
                  <Image size={22} color={C.inkSoft} />
                  <span style={{ fontSize: 10.5, fontFamily: "'IBM Plex Mono', monospace", color: C.inkSoft }}>배경 이미지 추가</span>
                </div>
              )}
              <input ref={bgFileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={addBgRef} />
            </div>

          </div>
        </div>

        {/* STEP 01 */}
        <div style={{ border: `1.5px solid ${C.ink}`, background: C.panel, marginBottom: 20, animation: "fadeUp 0.3s ease both" }}>
          <div style={{ padding: "10px 14px", borderBottom: `1.5px solid ${C.line}`, display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, fontWeight: 700, color: C.red }}>STEP 01</span>
            <span style={{ fontFamily: "'Zilla Slab', serif", fontWeight: 600, fontSize: 15 }}>글 → 상세 글콘티</span>
          </div>
          <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
            <textarea value={rawInput} onChange={e => setRawInput(e.target.value)} rows={3}
              placeholder="장면 글을 입력하세요…"
              style={{ width: "100%", resize: "vertical", padding: "10px 12px", border: `1.5px solid ${C.ink}`, background: "#fffdf8", color: C.ink, fontSize: 13.5, lineHeight: 1.6, borderRadius: 2, outline: "none" }} />
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: C.inkSoft }}>
                <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600, fontSize: 11 }}>목표</span>
                <input type="range" min={5} max={15} value={seconds} onChange={e => setSeconds(Number(e.target.value))} style={{ accentColor: C.red }} />
                <span style={{ fontFamily: "'IBM Plex Mono', monospace", color: C.red, fontWeight: 700, minWidth: 28, fontSize: 13 }}>{seconds}s</span>
              </label>
              <button onClick={runStage1} disabled={loading1 || !rawInput.trim()}
                style={{ marginLeft: "auto", cursor: loading1 ? "default" : "pointer", display: "inline-flex", alignItems: "center", gap: 7, background: C.ink, color: C.paper, border: "none", padding: "9px 16px", fontFamily: "'Zilla Slab', serif", fontWeight: 700, fontSize: 13, borderRadius: 2, opacity: loading1 || !rawInput.trim() ? 0.5 : 1 }}>
                {loading1 ? <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} /> : null}
                {loading1 ? "생성 중…" : gkontiText ? "글콘티 재생성" : "글콘티 생성 →"}
              </button>
            </div>
          </div>
        </div>

        {/* STEP 02 */}
        {gkontiText && (
          <div style={{ border: `1.5px solid ${C.ink}`, background: C.panel, marginBottom: 20, animation: "fadeUp 0.35s ease both" }}>
            <div style={{ padding: "10px 14px", borderBottom: `1.5px solid ${C.line}`, display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, fontWeight: 700, color: C.red }}>STEP 02</span>
              <span style={{ fontFamily: "'Zilla Slab', serif", fontWeight: 600, fontSize: 15 }}>글콘티 확인 · 수정 → 콘티 시트</span>
              <span style={{ marginLeft: "auto", fontSize: 11.5, color: C.inkSoft }}>직접 편집 가능</span>
            </div>
            <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
              <textarea value={gkontiText} onChange={e => setGkontiText(e.target.value)} rows={14}
                style={{ width: "100%", resize: "vertical", padding: "10px 12px", border: `1.5px solid ${C.lineSoft}`, background: "#fffdf8", color: C.ink, fontSize: 13, lineHeight: 1.75, borderRadius: 2, outline: "none" }} />
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button onClick={runStage2} disabled={loading2 || !gkontiText.trim()}
                  style={{ cursor: loading2 ? "default" : "pointer", display: "inline-flex", alignItems: "center", gap: 7, background: C.red, color: C.paper, border: "none", padding: "9px 18px", fontFamily: "'Zilla Slab', serif", fontWeight: 700, fontSize: 13, borderRadius: 2, opacity: loading2 || !gkontiText.trim() ? 0.5 : 1 }}>
                  {loading2 ? <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} /> : null}
                  {loading2 ? "생성 중…" : cuts ? "콘티 시트 재생성" : "콘티 시트 생성 →"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* STEP 03 */}
        {cuts && (
          <div style={{ animation: "fadeUp 0.4s ease both" }}>
            <div style={{ border: `1.5px solid ${C.ink}`, marginBottom: 20 }}>
              <div style={{ padding: "10px 14px", borderBottom: `1.5px solid ${C.line}`, background: C.panel, display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, fontWeight: 700, color: C.red }}>STEP 03</span>
                <span style={{ fontFamily: "'Zilla Slab', serif", fontWeight: 600, fontSize: 15 }}>콘티 시트 — 이미지 업로드 · 저장</span>
              </div>

              <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center", padding: "12px 14px", borderBottom: `1px solid ${C.lineSoft}`, background: "#f7f3ea" }}>
                <div style={{ flex: "1 1 200px" }}>
                  <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: C.red, fontWeight: 600, marginBottom: 2 }}>TONE</div>
                  <div style={{ fontSize: 13 }}>{metadata?.tone}</div>
                </div>
                <div style={{ flex: "1 1 200px" }}>
                  <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: C.red, fontWeight: 600, marginBottom: 2 }}>감정선</div>
                  <div style={{ fontSize: 13 }}>{metadata?.emotionArc}</div>
                </div>
                <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700, fontSize: 15, color: inRange ? C.ink : C.red }}>
                  {total.toFixed(1)}s · {cuts.length}컷 {!inRange && "⚠"}
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={exportJSON}
                    style={{ cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6, background: "transparent", color: C.ink, border: `1.5px solid ${C.ink}`, padding: "7px 12px", borderRadius: 2, fontSize: 12, fontWeight: 600, fontFamily: "'IBM Plex Mono', monospace" }}>
                    <Download size={12} /> JSON
                  </button>
                  <button onClick={exportAsImage} disabled={exporting}
                    style={{ cursor: exporting ? "default" : "pointer", display: "inline-flex", alignItems: "center", gap: 6, background: C.red, color: C.paper, border: "none", padding: "7px 14px", borderRadius: 2, fontSize: 12, fontWeight: 700, fontFamily: "'Zilla Slab', serif", opacity: exporting ? 0.6 : 1 }}>
                    {exporting ? <Loader2 size={12} style={{ animation: "spin 1s linear infinite" }} /> : <FileImage size={12} />}
                    {exporting ? "생성 중…" : "전체 이미지 저장"}
                  </button>
                </div>
              </div>

              {/* 스토리보드 표 */}
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
                  <colgroup>
                    <col style={{ width: 48 }} />
                    <col style={{ width: 72 }} />
                    <col style={{ width: 260 }} />
                    <col />
                  </colgroup>
                  <thead>
                    <tr style={{ borderBottom: `1.5px solid ${C.ink}`, background: C.ink }}>
                      <th style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, fontWeight: 700, color: C.paper, padding: "7px 6px", textAlign: "center", borderRight: `1.5px solid #ffffff22` }}>컷</th>
                      <th style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, fontWeight: 700, color: C.paper, padding: "7px 6px", textAlign: "center", borderRight: `1.5px solid #ffffff22` }}>시간</th>
                      <th style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, fontWeight: 700, color: C.paper, padding: "7px 6px", textAlign: "center", borderRight: `1.5px solid #ffffff22` }}>스토리보드 이미지 (16:9)</th>
                      <th style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, fontWeight: 700, color: C.paper, padding: "7px 14px", textAlign: "left" }}>내용 · 연출 / 카메라 · 화면</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cuts.map((cut, i) => {
                      const runningTime = cuts.slice(0, i + 1).reduce((s, c) => s + (Number(c.sec) || 0), 0);
                      return (
                        <CutRow key={cut.no} cut={cut} imageData={panelImages[cut.no]} onUpload={handleImageUpload} onCopyPrompt={copyPrompt} copied={copiedNo === cut.no} runningTime={runningTime} />
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <p style={{ padding: "0 14px 14px", margin: 0, fontSize: 11.5, color: C.inkSoft, lineHeight: 1.6 }}>
                <Upload size={11} style={{ verticalAlign: "middle", marginRight: 5 }} />
                각 패널 이미지 슬롯을 클릭하면 외부에서 생성한 이미지를 업로드할 수 있습니다. 업로드 후 <b>전체 이미지 저장</b>으로 스토리보드를 PNG로 내보내세요.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
