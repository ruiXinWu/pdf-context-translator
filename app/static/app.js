import * as pdfjsLib from "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.5.136/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.5.136/pdf.worker.min.mjs";

const el = {
  pdfInput: document.getElementById("pdfInput"),
  pdfHost: document.getElementById("pdfHost"),
  reflowHost: document.getElementById("reflowHost"),
  pageCount: document.getElementById("pageCount"),
  statusHint: document.getElementById("statusHint"),
  modeOriginal: document.getElementById("modeOriginal"),
  modeReflow: document.getElementById("modeReflow"),
  gotoPageInput: document.getElementById("gotoPageInput"),
  pageJumpBtn: document.getElementById("pageJumpBtn"),
  prevPageBtn: document.getElementById("prevPageBtn"),
  nextPageBtn: document.getElementById("nextPageBtn"),
  annotationList: document.getElementById("annotationList"),
  annotationEmpty: document.getElementById("annotationEmpty"),
  clearAllBtn: document.getElementById("clearAllBtn"),
  panelToggle: document.getElementById("panelToggle"),
  annotationPanel: document.getElementById("annotationPanel"),
};

const state = {
  mode: "original",
  currentPdfKey: null,
  totalPages: 0,
  activeRenderToken: 0,
  currentPage: 1,
  pageTextStore: new Map(),
  pageGlossLayerStore: new Map(),
  glossStore: new Map(),
  reflowGlossStore: new Map(),
};

function normalizeText(text) {
  return (text || "").replace(/\s+/g, " ").trim();
}

function extractSentence(text, word) {
  if (!text || !word) return "";
  const safeWord = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp(`\\b${safeWord}\\b`, "i").exec(text);
  if (!m) return "";
  const i = m.index;
  const left = text.slice(0, i);
  const right = text.slice(i + m[0].length);
  const leftBoundary = Math.max(left.lastIndexOf("."), left.lastIndexOf("?"), left.lastIndexOf("!"));
  const rightCandidates = [right.indexOf("."), right.indexOf("?"), right.indexOf("!")].filter((n) => n >= 0);
  const rightBoundary = rightCandidates.length ? Math.min(...rightCandidates) : right.length;
  return normalizeText(text.slice(leftBoundary + 1, i + m[0].length + rightBoundary + 1));
}

function isEnglishWord(text) {
  return /^[A-Za-z][A-Za-z'-]*$/.test(text || "");
}

function pickEnglishWord(text, clickRatio = null) {
  const raw = (text || "").trim();
  if (!raw) return "";
  if (isEnglishWord(raw)) return raw;
  const re = /[A-Za-z][A-Za-z'-]*/g;
  const tokens = [];
  let m;
  while ((m = re.exec(raw)) !== null) tokens.push({ word: m[0], start: m.index, end: m.index + m[0].length });
  if (!tokens.length) return "";
  if (clickRatio == null || Number.isNaN(clickRatio)) return tokens[0].word;
  const clickChar = Math.max(0, Math.min(raw.length - 1, Math.round(clickRatio * raw.length)));
  return tokens.reduce((best, t) => {
    const center = (t.start + t.end) / 2;
    const bCenter = (best.start + best.end) / 2;
    return Math.abs(center - clickChar) < Math.abs(bCenter - clickChar) ? t : best;
  }, tokens[0]).word;
}

function makeId() {
  return `anno_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

function escapeHtml(s) {
  return (s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function status(msg) {
  if (el.statusHint) el.statusHint.textContent = msg;
}

function persist() {
  if (!state.currentPdfKey) return;
  const payload = {
    version: 4,
    mode: state.mode,
    currentPage: state.currentPage,
    updatedAt: new Date().toISOString(),
    glosses: Array.from(state.glossStore.values()),
  };
  localStorage.setItem(state.currentPdfKey, JSON.stringify(payload));
}

function restore(pdfKey) {
  try {
    const raw = localStorage.getItem(pdfKey);
    if (!raw) return { glosses: [] };
    const parsed = JSON.parse(raw);
    return { glosses: Array.isArray(parsed?.glosses) ? parsed.glosses : [], mode: parsed?.mode, currentPage: parsed?.currentPage || 1 };
  } catch {
    return { glosses: [] };
  }
}

async function translateWord(word, sentence) {
  const res = await fetch("/api/translate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ word, sentence }),
  });
  if (!res.ok) throw new Error(`翻译服务异常(${res.status})`);
  return res.json();
}

function setMode(mode) {
  state.mode = mode;
  const original = mode === "original";
  el.pdfHost.classList.toggle("hidden", !original);
  el.reflowHost.classList.toggle("hidden", original);
  el.modeOriginal.classList.toggle("active", original);
  el.modeReflow.classList.toggle("active", !original);
  el.modeOriginal.setAttribute("aria-selected", String(original));
  el.modeReflow.setAttribute("aria-selected", String(!original));
  persist();
}

function annotationByPage(pageNum) {
  const out = [];
  for (const a of state.glossStore.values()) if (a.pageNum === pageNum) out.push(a);
  return out;
}

function placeGloss(pageNum, gloss, noteEl = null) {
  const layer = state.pageGlossLayerStore.get(pageNum);
  if (!layer) return { x: gloss.x || 10, y: gloss.y || 10, mode: "right" };
  const rect = layer.getBoundingClientRect();
  const pad = 4;
  const width = noteEl?.offsetWidth || 180;
  const height = noteEl?.offsetHeight || 36;

  const ax = Number.isFinite(gloss.anchorX) ? gloss.anchorX : 8;
  const ay = Number.isFinite(gloss.anchorY) ? gloss.anchorY : 8;
  const aw = Math.max(8, Number.isFinite(gloss.anchorW) ? gloss.anchorW : 14);
  const ah = Math.max(10, Number.isFinite(gloss.anchorH) ? gloss.anchorH : 12);

  const right = { x: ax + aw + 4, y: ay + Math.max(-2, (ah - height) / 2), mode: "right" };
  const below = { x: ax, y: ay + ah + 3, mode: "below" };
  const pick = right.x + width + pad <= rect.width ? right : below;
  return {
    mode: pick.mode,
    x: Math.max(pad, Math.min(pick.x, rect.width - width - pad)),
    y: Math.max(pad, Math.min(pick.y, rect.height - height - pad)),
  };
}

function removeAnnotation(id) {
  const item = state.glossStore.get(id);
  if (!item) return;
  state.glossStore.delete(id);
  persist();
  renderPanel();
  renderPageGlosses(item.pageNum);
}

function retryAnnotation(id) {
  const a = state.glossStore.get(id);
  if (!a) return;
  a.status = "loading";
  a.wordZh = "翻译中…";
  a.contextZh = "翻译中…";
  state.glossStore.set(id, a);
  persist();
  renderPanel();
  renderPageGlosses(a.pageNum);
  finishTranslate(a);
}

function scrollToPage(pageNum, retry = 0) {
  const selector = state.mode === "reflow" ? `.reflow-page[data-page-num='${pageNum}']` : `.page[data-page-num='${pageNum}']`;
  const host = state.mode === "reflow" ? el.reflowHost : el.pdfHost;
  const target = host.querySelector(selector);
  if (target) {
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    state.currentPage = pageNum;
    persist();
    return;
  }
  if (retry < 12) {
    setTimeout(() => scrollToPage(pageNum, retry + 1), 180);
  }
}

function renderPanel() {
  const list = Array.from(state.glossStore.values()).sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  el.annotationList.innerHTML = "";
  el.annotationEmpty.style.display = list.length ? "none" : "block";

  for (const a of list) {
    const card = document.createElement("article");
    card.className = "anno-card";
    const statusClass = a.status === "error" ? "status-err" : "status-ok";
    card.innerHTML = `
      <div class="anno-top">
        <div>
          <div class="anno-word">${escapeHtml(a.word)}</div>
          <div class="anno-meta">第 ${a.pageNum} 页 · <span class="${statusClass}">${a.status === "error" ? "失败" : a.status === "loading" ? "翻译中" : "已完成"}</span></div>
        </div>
        <div class="anno-zh">${escapeHtml(a.wordZh || "-")}</div>
      </div>
      <div class="anno-ctx">${escapeHtml(a.contextZh || "")}</div>
      <div class="anno-actions">
        <button data-act="jump">定位</button>
        ${a.status === "error" ? '<button data-act="retry">重试</button>' : ""}
        <button class="danger" data-act="del">删除</button>
      </div>
    `;
    card.querySelector("[data-act='jump']")?.addEventListener("click", () => scrollToPage(a.pageNum));
    card.querySelector("[data-act='retry']")?.addEventListener("click", () => retryAnnotation(a.id));
    card.querySelector("[data-act='del']")?.addEventListener("click", () => removeAnnotation(a.id));
    el.annotationList.appendChild(card);
  }
}

function renderPageGlosses(pageNum) {
  const layer = state.pageGlossLayerStore.get(pageNum);
  if (!layer) return;
  layer.innerHTML = "";
  for (const a of annotationByPage(pageNum)) {
    const note = document.createElement("div");
    note.className = `gloss-inline ${a.status === "error" ? "error" : ""}`;
    note.dataset.id = a.id;
    note.innerHTML = `
      <div class="head">
        <span class="word">${escapeHtml(a.word)}</span>
        <span class="zh">${escapeHtml(a.wordZh || "-")}</span>
        <button class="close" aria-label="删除">×</button>
      </div>
      <div class="ctx">${escapeHtml(a.contextZh || "")}</div>
    `;
    note.querySelector(".close")?.addEventListener("click", (e) => {
      e.stopPropagation();
      removeAnnotation(a.id);
    });
    layer.appendChild(note);

    const placed = placeGloss(pageNum, a, note);
    note.style.left = `${placed.x}px`;
    note.style.top = `${placed.y}px`;

    if (a.x !== placed.x || a.y !== placed.y || a.placement !== placed.mode) {
      state.glossStore.set(a.id, { ...a, x: placed.x, y: placed.y, placement: placed.mode });
      persist();
    }
  }
}

async function finishTranslate(annotation) {
  try {
    const out = await translateWord(annotation.word, annotation.sentence || annotation.word);
    const next = {
      ...annotation,
      status: "done",
      word: out.word || annotation.word,
      wordZh: out.word_only_translation || "(空)",
      contextZh: out.contextual_translation || "(空)",
      sentence: out.sentence || annotation.sentence,
    };
    state.glossStore.set(annotation.id, next);
  } catch (e) {
    state.glossStore.set(annotation.id, {
      ...annotation,
      status: "error",
      wordZh: "—",
      contextZh: `Error: ${e.message}`,
    });
  }
  persist();
  renderPanel();
  renderPageGlosses(annotation.pageNum);
}

function createAnnotation({ word, pageNum, anchor }) {
  const pageText = state.pageTextStore.get(pageNum) || "";
  const sentence = extractSentence(pageText, word) || pageText.slice(0, 240);
  const id = makeId();
  const a = {
    id,
    pageNum,
    word,
    sentence,
    status: "loading",
    wordZh: "翻译中…",
    contextZh: "翻译中…",
    createdAt: new Date().toISOString(),
    anchorX: anchor?.x ?? 10,
    anchorY: anchor?.y ?? 10,
    anchorW: anchor?.w ?? 12,
    anchorH: anchor?.h ?? 12,
    x: anchor?.x ?? 10,
    y: anchor?.y ?? 10,
    placement: "right",
    version: 4,
  };
  state.glossStore.set(id, a);
  persist();
  renderPanel();
  renderPageGlosses(pageNum);
  finishTranslate(a);
}

function tokenizeText(text) {
  return text.match(/[A-Za-z][A-Za-z'-]*|\s+|[^A-Za-z\s]+/g) || [];
}

function buildReflowLines(items) {
  const sorted = [...items].sort((a, b) => {
    const ay = Math.round(a.transform?.[5] || 0);
    const by = Math.round(b.transform?.[5] || 0);
    if (Math.abs(ay - by) > 3) return by - ay;
    return (a.transform?.[4] || 0) - (b.transform?.[4] || 0);
  });
  const lines = [];
  for (const item of sorted) {
    const y = item.transform?.[5] || 0;
    const text = normalizeText(item.str || "");
    if (!text) continue;
    if (/^\d+\s+of\s+\d+$/i.test(text)) continue;
    let line = lines.find((ln) => Math.abs(ln.y - y) <= 4);
    if (!line) { line = { y, chunks: [] }; lines.push(line); }
    line.chunks.push(item);
  }
  lines.sort((a, b) => b.y - a.y);
  return lines.map((ln) => ln.chunks.sort((a, b) => (a.transform?.[4] || 0) - (b.transform?.[4] || 0)));
}

function renderReflowPage(pageNum, items) {
  const page = document.createElement("article");
  page.className = "reflow-page";
  page.dataset.pageNum = String(pageNum);

  for (const line of buildReflowLines(items)) {
    const p = document.createElement("p");
    for (const chunk of line) {
      for (const tk of tokenizeText(chunk.str || "")) {
        if (/^\s+$/.test(tk)) { p.appendChild(document.createTextNode(tk)); continue; }
        if (isEnglishWord(tk)) {
          const sp = document.createElement("span");
          sp.className = "word-token";
          sp.textContent = tk;
          sp.addEventListener("click", async () => {
            sp.classList.add("active");
            const anchor = { x: 10, y: 10, w: 10, h: 10 };
            createAnnotation({ word: tk, pageNum, anchor });

            let badge = sp.nextElementSibling;
            if (!badge || !badge.classList.contains("reflow-gloss")) {
              badge = document.createElement("span");
              badge.className = "reflow-gloss";
              sp.insertAdjacentElement("afterend", badge);
            }
            badge.textContent = "翻译中…";

            try {
              const pageText = state.pageTextStore.get(pageNum) || "";
              const sentence = extractSentence(pageText, tk) || pageText.slice(0, 220);
              const out = await translateWord(tk, sentence);
              const wordZh = out.word_only_translation || out.contextual_translation || "(无结果)";
              badge.textContent = wordZh;
            } catch {
              badge.textContent = "翻译失败";
            }
          });
          p.appendChild(sp);
        } else {
          const plain = document.createElement("span");
          plain.textContent = tk;
          p.appendChild(plain);
        }
      }
    }
    page.appendChild(p);
  }
  el.reflowHost.appendChild(page);
}

async function renderPage(pdf, pageNum, scale = 1.35) {
  const page = await pdf.getPage(pageNum);
  const viewport = page.getViewport({ scale });

  const wrap = document.createElement("div");
  wrap.className = "page";
  wrap.dataset.pageNum = String(pageNum);
  wrap.style.width = `${viewport.width}px`;
  wrap.style.height = `${viewport.height}px`;

  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  wrap.appendChild(canvas);

  const textLayer = document.createElement("div");
  textLayer.className = "textLayer";
  wrap.appendChild(textLayer);

  const glossLayer = document.createElement("div");
  glossLayer.className = "gloss-layer";
  wrap.appendChild(glossLayer);
  state.pageGlossLayerStore.set(pageNum, glossLayer);

  const ctx = canvas.getContext("2d", { alpha: false });
  await page.render({ canvasContext: ctx, viewport }).promise;

  const textContent = await page.getTextContent();
  const pageText = normalizeText(textContent.items.map((i) => i.str).join(" "));
  state.pageTextStore.set(pageNum, pageText);
  renderReflowPage(pageNum, textContent.items);

  for (const item of textContent.items) {
    const span = document.createElement("span");
    span.textContent = item.str;

    const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
    const fontHeight = Math.hypot(tx[2], tx[3]);
    const estWidth = Math.max(4, (item.width || item.str.length * 0.5) * scale);
    span.style.left = `${tx[4]}px`;
    span.style.top = `${tx[5] - fontHeight}px`;
    span.style.fontSize = `${fontHeight}px`;
    span.style.width = `${estWidth}px`;
    span.style.height = `${fontHeight}px`;
    span.style.transform = `rotate(${Math.atan2(tx[1], tx[0])}rad)`;

    span.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const raw = normalizeText(item.str);
      const word = pickEnglishWord(raw, span.getBoundingClientRect().width > 0 ? (ev.clientX - span.getBoundingClientRect().left) / span.getBoundingClientRect().width : null);
      if (!word) return;
      span.classList.add("annotated");
      const rect = span.getBoundingClientRect();
      const pageRect = wrap.getBoundingClientRect();
      createAnnotation({
        word,
        pageNum,
        anchor: {
          x: ev.clientX - pageRect.left,
          y: ev.clientY - pageRect.top,
          w: Math.max(6, rect.width * 0.25),
          h: Math.max(8, rect.height),
        },
      });
    });

    textLayer.appendChild(span);
  }

  el.pdfHost.appendChild(wrap);
  renderPageGlosses(pageNum);
}

async function renderAll(pdf, token) {
  for (let i = 1; i <= pdf.numPages; i++) {
    if (token !== state.activeRenderToken) return;
    await renderPage(pdf, i);
    if (i % 3 === 0) await new Promise((r) => setTimeout(r, 0));
  }
}

function clearCurrentBook() {
  if (!state.currentPdfKey) return;
  state.glossStore.clear();
  localStorage.removeItem(state.currentPdfKey);
  renderPanel();
  for (let i = 1; i <= state.totalPages; i++) renderPageGlosses(i);
  status("已清空本书注释");
}

async function loadPdf(file) {
  status("加载 PDF…");
  const bytes = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;

  state.activeRenderToken += 1;
  const token = state.activeRenderToken;
  state.totalPages = pdf.numPages;
  el.pageCount.textContent = `Pages: ${pdf.numPages}`;

  el.pdfHost.innerHTML = "";
  el.reflowHost.innerHTML = "";
  state.pageTextStore.clear();
  state.pageGlossLayerStore.clear();
  state.glossStore.clear();
  state.reflowGlossStore.clear();

  const fp = pdf.fingerprints?.[0] || `${file.name}:${file.size}:${file.lastModified}`;
  state.currentPdfKey = `pdfgloss:${fp}`;

  const restored = restore(state.currentPdfKey);
  for (const a of restored.glosses || []) if (a?.id && Number.isFinite(a?.pageNum)) state.glossStore.set(a.id, a);
  if (restored.mode === "reflow" || restored.mode === "original") setMode(restored.mode);
  if (Number.isFinite(restored.currentPage)) state.currentPage = restored.currentPage;

  renderPanel();
  await renderAll(pdf, token);
  status("加载完成");
  setTimeout(() => scrollToPage(Math.min(Math.max(1, state.currentPage), state.totalPages)), 80);
}

function goPageByInput() {
  const n = Number(el.gotoPageInput.value);
  if (!Number.isFinite(n) || n < 1 || n > state.totalPages) {
    status(`请输入 1-${state.totalPages} 的页码`);
    return;
  }
  scrollToPage(n);
}

function updateCurrentPageFromScroll() {
  const host = state.mode === "reflow" ? el.reflowHost : el.pdfHost;
  const pages = [...host.querySelectorAll(state.mode === "reflow" ? ".reflow-page" : ".page")];
  if (!pages.length) return;
  const top = window.innerHeight * 0.22;
  let best = pages[0];
  let bestDist = Infinity;
  for (const p of pages) {
    const r = p.getBoundingClientRect();
    const dist = Math.abs(r.top - top);
    if (dist < bestDist) { bestDist = dist; best = p; }
  }
  state.currentPage = Number(best.dataset.pageNum || 1);
  persist();
}

el.pdfInput?.addEventListener("change", async (e) => {
  const f = e.target.files?.[0];
  if (!f) return;
  await loadPdf(f);
});
el.modeOriginal?.addEventListener("click", () => setMode("original"));
el.modeReflow?.addEventListener("click", () => setMode("reflow"));
el.pageJumpBtn?.addEventListener("click", goPageByInput);
el.gotoPageInput?.addEventListener("keydown", (e) => e.key === "Enter" && goPageByInput());
el.prevPageBtn?.addEventListener("click", () => scrollToPage(Math.max(1, state.currentPage - 1)));
el.nextPageBtn?.addEventListener("click", () => scrollToPage(Math.min(state.totalPages, state.currentPage + 1)));
el.clearAllBtn?.addEventListener("click", clearCurrentBook);
el.panelToggle?.addEventListener("click", () => el.annotationPanel?.classList.toggle("open"));
document.getElementById("readerWrap")?.addEventListener("scroll", () => requestAnimationFrame(updateCurrentPageFromScroll), { passive: true });

setMode("original");
status("就绪：上传 PDF 开始");