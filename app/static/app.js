import * as pdfjsLib from "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.5.136/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.5.136/pdf.worker.min.mjs";

const STORAGE = {
  bookshelfKey: "pdfgloss:bookshelf:v1",
  bookPrefix: "pdfgloss:",
  currentBookKey: "pdfgloss:currentBookKey:v1",
};

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

  searchInput: document.getElementById("searchInput"),
  searchBtn: document.getElementById("searchBtn"),

  bookshelfSelect: document.getElementById("bookshelfSelect"),

  panelTitle: document.getElementById("panelTitle"),
  annotationList: document.getElementById("annotationList"),
  annotationEmpty: document.getElementById("annotationEmpty"),
  clearAllBtn: document.getElementById("clearAllBtn"),
  panelToggle: document.getElementById("panelToggle"),
  annotationPanel: document.getElementById("annotationPanel"),
  jumpLastBtn: document.getElementById("jumpLastBtn"),
  exportBtn: document.getElementById("exportBtn"),
  importBtn: document.getElementById("importBtn"),
  importInput: document.getElementById("importInput"),

  tabBtns: [...document.querySelectorAll(".tab-btn")],
  tabAnnos: document.getElementById("tabAnnos"),
  tabVocab: document.getElementById("tabVocab"),
  tabSearch: document.getElementById("tabSearch"),
  tabSettings: document.getElementById("tabSettings"),

  vocabList: document.getElementById("vocabList"),
  vocabEmpty: document.getElementById("vocabEmpty"),
  vocabCount: document.getElementById("vocabCount"),
  hideKnown: document.getElementById("hideKnown"),

  searchHint: document.getElementById("searchHint"),
  searchResults: document.getElementById("searchResults"),
  searchEmpty: document.getElementById("searchEmpty"),

  fontSize: document.getElementById("fontSize"),
  fontSizeVal: document.getElementById("fontSizeVal"),
  lineHeight: document.getElementById("lineHeight"),
  lineHeightVal: document.getElementById("lineHeightVal"),
  pageWidth: document.getElementById("pageWidth"),
  pageWidthVal: document.getElementById("pageWidthVal"),
  themeSelect: document.getElementById("themeSelect"),
  autoMarkKnown: document.getElementById("autoMarkKnown"),
  autoTranslateMode: document.getElementById("autoTranslateMode"),

  toast: document.getElementById("toast"),
};

const state = {
  mode: "original",
  currentPdfKey: null,
  currentBookMeta: null,
  totalPages: 0,
  activeRenderToken: 0,
  currentPage: 1,
  pageTextStore: new Map(),
  pageGlossLayerStore: new Map(),
  glossStore: new Map(),

  // per-book extras
  knownWords: new Set(),
  settings: {
    reflowFontSize: 21,
    reflowLineHeight: 1.92,
    reflowWidth: 760,
    theme: "paper",
    autoMarkKnown: true,
    autoTranslateMode: "off", // off|underline|limit10
  },

  // UI
  currentTab: "annos",
  lastSearchQuery: "",
  undoStack: [], // { deleted: [anno], bookKey, at }
};

function nowIso() {
  return new Date().toISOString();
}

function normalizeText(text) {
  return (text || "").replace(/\s+/g, " ").trim();
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

// -------------------- storage --------------------

function safeJsonParse(raw, fallback) {
  try {
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function loadBookshelf() {
  const parsed = safeJsonParse(localStorage.getItem(STORAGE.bookshelfKey), { version: 1, items: [] });
  const items = Array.isArray(parsed?.items) ? parsed.items : [];
  // newest first
  items.sort((a, b) => (b.lastOpenedAt || "").localeCompare(a.lastOpenedAt || ""));
  return { version: 1, items };
}

function saveBookshelf(shelf) {
  localStorage.setItem(STORAGE.bookshelfKey, JSON.stringify({ version: 1, items: shelf.items || [] }));
}

function upsertBookshelfItem(meta) {
  const shelf = loadBookshelf();
  const idx = shelf.items.findIndex((x) => x.bookKey === meta.bookKey);
  if (idx >= 0) shelf.items[idx] = { ...shelf.items[idx], ...meta };
  else shelf.items.unshift(meta);
  // cap
  shelf.items = shelf.items.slice(0, 60);
  saveBookshelf(shelf);
  renderBookshelfSelect();
}

function renderBookshelfSelect() {
  const shelf = loadBookshelf();
  const items = shelf.items;
  el.bookshelfSelect.innerHTML = "";

  const opt0 = document.createElement("option");
  opt0.value = "";
  opt0.textContent = "📚 Bookshelf";
  el.bookshelfSelect.appendChild(opt0);

  for (const it of items) {
    const o = document.createElement("option");
    o.value = it.bookKey;
    const last = it.lastOpenedAt ? it.lastOpenedAt.slice(0, 10) : "";
    const page = it.lastReadPage ? `p${it.lastReadPage}` : "";
    o.textContent = `${it.title || it.fileName || it.bookKey.slice(-8)} · ${page} ${last ? `· ${last}` : ""}`.trim();
    el.bookshelfSelect.appendChild(o);
  }

  if (state.currentPdfKey) el.bookshelfSelect.value = state.currentPdfKey;
}

function defaultBookPayload() {
  return {
    version: 5,
    mode: state.mode,
    currentPage: state.currentPage,
    updatedAt: nowIso(),
    glosses: [],
    knownWords: [],
    settings: { ...state.settings },
    meta: state.currentBookMeta || null,
  };
}

function readBookPayload(bookKey) {
  return safeJsonParse(localStorage.getItem(bookKey), defaultBookPayload());
}

function writeBookPayload(bookKey, payload) {
  localStorage.setItem(bookKey, JSON.stringify(payload));
  localStorage.setItem(STORAGE.currentBookKey, bookKey);
}

function persistCurrentBook() {
  if (!state.currentPdfKey) return;
  const payload = {
    version: 5,
    mode: state.mode,
    currentPage: state.currentPage,
    updatedAt: nowIso(),
    glosses: Array.from(state.glossStore.values()),
    knownWords: Array.from(state.knownWords.values()),
    settings: { ...state.settings },
    meta: state.currentBookMeta || null,
  };
  writeBookPayload(state.currentPdfKey, payload);

  if (state.currentBookMeta) {
    upsertBookshelfItem({
      bookKey: state.currentPdfKey,
      fingerprint: state.currentBookMeta.fingerprint,
      title: state.currentBookMeta.title,
      fileName: state.currentBookMeta.fileName,
      totalPages: state.totalPages,
      lastOpenedAt: payload.updatedAt,
      lastReadPage: state.currentPage,
      updatedAt: payload.updatedAt,
    });
  }
}

function restoreBookIntoState(bookKey) {
  const payload = readBookPayload(bookKey);
  state.currentPdfKey = bookKey;
  const glosses = Array.isArray(payload?.glosses) ? payload.glosses : [];
  state.glossStore.clear();
  for (const a of glosses) if (a?.id && Number.isFinite(a?.pageNum)) state.glossStore.set(a.id, a);

  state.knownWords = new Set((payload?.knownWords || []).map((w) => String(w).toLowerCase()));

  state.settings = {
    ...state.settings,
    ...(payload?.settings || {}),
  };

  state.currentBookMeta = payload?.meta || state.currentBookMeta;
  if (payload?.mode === "reflow" || payload?.mode === "original") setMode(payload.mode, { persist: false });
  if (Number.isFinite(payload?.currentPage)) state.currentPage = payload.currentPage;

  applySettingsToCss();
  renderPanelTitle();
  renderPanel();
  renderVocab();
}

// -------------------- translation --------------------

async function translateWord(word, sentence) {
  const res = await fetch("/api/translate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ word, sentence }),
  });
  if (!res.ok) throw new Error(`翻译服务异常(${res.status})`);
  return res.json();
}

// -------------------- tabs --------------------

function setTab(tab) {
  state.currentTab = tab;
  for (const b of el.tabBtns) b.classList.toggle("active", b.dataset.tab === tab);
  el.tabAnnos.classList.toggle("hidden", tab !== "annos");
  el.tabVocab.classList.toggle("hidden", tab !== "vocab");
  el.tabSearch.classList.toggle("hidden", tab !== "search");
  el.tabSettings.classList.toggle("hidden", tab !== "settings");
}

// -------------------- settings --------------------

function applySettingsToCss() {
  document.documentElement.style.setProperty("--reflow-font-size", `${Number(state.settings.reflowFontSize || 21)}px`);
  document.documentElement.style.setProperty("--reflow-line-height", String(state.settings.reflowLineHeight || 1.92));
  document.documentElement.style.setProperty("--reflow-width", `${Number(state.settings.reflowWidth || 760)}px`);

  const theme = state.settings.theme || "paper";
  if (theme === "dark") {
    document.documentElement.style.setProperty("--reflow-theme-bg", "#0b1020");
    document.documentElement.style.setProperty("--reflow-theme-text", "#e5e7eb");
    document.documentElement.style.setProperty("--reflow-theme-border", "#1f2937");
    document.documentElement.style.setProperty("--reflow-theme-shadow", "rgba(0,0,0,0.36)");
  } else {
    document.documentElement.style.setProperty("--reflow-theme-bg", "#fffdf7");
    document.documentElement.style.setProperty("--reflow-theme-text", "#1f2937");
    document.documentElement.style.setProperty("--reflow-theme-border", "#ece7da");
    document.documentElement.style.setProperty("--reflow-theme-shadow", "rgba(15, 23, 42, 0.08)");
  }

  if (el.fontSize) {
    el.fontSize.value = String(state.settings.reflowFontSize || 21);
    el.fontSizeVal.textContent = `${el.fontSize.value}px`;
  }
  if (el.lineHeight) {
    el.lineHeight.value = String(state.settings.reflowLineHeight || 1.92);
    el.lineHeightVal.textContent = String(el.lineHeight.value);
  }
  if (el.pageWidth) {
    el.pageWidth.value = String(state.settings.reflowWidth || 760);
    el.pageWidthVal.textContent = `${el.pageWidth.value}px`;
  }
  if (el.themeSelect) el.themeSelect.value = theme;
  if (el.autoMarkKnown) el.autoMarkKnown.checked = Boolean(state.settings.autoMarkKnown);
  if (el.autoTranslateMode) el.autoTranslateMode.value = state.settings.autoTranslateMode || "off";

  refreshKnownMarkers();
}

function renderPanelTitle() {
  const title = state.currentBookMeta?.title || state.currentBookMeta?.fileName || (state.currentPdfKey ? "本书" : "未选择书籍");
  el.panelTitle.textContent = title;
}

// -------------------- vocab --------------------

function buildVocabIndex() {
  const map = new Map();
  for (const a of state.glossStore.values()) {
    const w = String(a.word || "").trim();
    if (!w) continue;
    const key = w.toLowerCase();
    if (!map.has(key)) {
      map.set(key, {
        key,
        word: w,
        wordZh: a.wordZh || "",
        contextZh: a.contextZh || "",
        count: 0,
        lastSeenAt: a.createdAt || "",
        lastPage: a.pageNum,
      });
    }
    const row = map.get(key);
    row.count += 1;
    if ((a.createdAt || "").localeCompare(row.lastSeenAt) > 0) {
      row.lastSeenAt = a.createdAt || row.lastSeenAt;
      row.lastPage = a.pageNum;
      if (a.wordZh) row.wordZh = a.wordZh;
      if (a.contextZh) row.contextZh = a.contextZh;
      row.word = a.word || row.word;
    }
  }
  return [...map.values()].sort((a, b) => (b.lastSeenAt || "").localeCompare(a.lastSeenAt || ""));
}

function toggleKnown(wordKey) {
  const k = String(wordKey || "").toLowerCase();
  if (!k) return;
  if (state.knownWords.has(k)) state.knownWords.delete(k);
  else state.knownWords.add(k);
  persistCurrentBook();
  renderVocab();
  refreshKnownMarkers();
}

function renderVocab() {
  const vocab = buildVocabIndex();
  const hideKnown = Boolean(el.hideKnown?.checked);
  const shown = vocab.filter((v) => !(hideKnown && state.knownWords.has(v.key)));

  el.vocabList.innerHTML = "";
  el.vocabCount.textContent = `${vocab.length} words`;
  el.vocabEmpty.style.display = vocab.length ? "none" : "block";

  for (const v of shown) {
    const known = state.knownWords.has(v.key);
    const card = document.createElement("article");
    card.className = "anno-card";
    card.innerHTML = `
      <div class="anno-top">
        <div>
          <div class="anno-word">${escapeHtml(v.word)}</div>
          <div class="anno-meta">出现 ${v.count} 次 · 最近：第 ${v.lastPage} 页</div>
        </div>
        <div class="anno-zh">${escapeHtml(v.wordZh || "-")}</div>
      </div>
      <div class="anno-ctx">${escapeHtml(v.contextZh || "")}</div>
      <div class="anno-actions">
        <button data-act="jump">定位</button>
        <button data-act="known">${known ? "取消掌握" : "标记已掌握"}</button>
      </div>
    `;
    card.querySelector("[data-act='jump']")?.addEventListener("click", () => scrollToPage(v.lastPage));
    card.querySelector("[data-act='known']")?.addEventListener("click", () => toggleKnown(v.key));
    el.vocabList.appendChild(card);
  }
}

function refreshKnownMarkers() {
  if (!state.settings.autoMarkKnown) return;

  // Original PDF mode: mark spans (best-effort) after rendering
  for (const pageEl of document.querySelectorAll(".page")) {
    const pageNum = Number(pageEl.dataset.pageNum || 0);
    if (!pageNum) continue;
    const spans = pageEl.querySelectorAll(".textLayer span");
    for (const sp of spans) {
      const raw = normalizeText(sp.textContent || "");
      const w = pickEnglishWord(raw);
      if (!w) continue;
      sp.classList.toggle("known", state.knownWords.has(w.toLowerCase()));
    }
  }

  // Reflow mode
  for (const sp of document.querySelectorAll(".word-token")) {
    const w = normalizeText(sp.textContent || "");
    if (!w) continue;
    sp.classList.toggle("known", state.knownWords.has(w.toLowerCase()));
  }
}

// -------------------- undo / toast --------------------

let toastTimer = null;

function showToast(text, actions = []) {
  if (!el.toast) return;
  el.toast.style.display = "block";
  el.toast.innerHTML = `
    <div>${escapeHtml(text)}</div>
    ${actions.length ? `<div class="actions">${actions.map((a, i) => `<button data-i="${i}">${escapeHtml(a.label)}</button>`).join("")}</div>` : ""}
  `;
  for (const btn of el.toast.querySelectorAll("button")) {
    btn.addEventListener("click", () => {
      const i = Number(btn.dataset.i);
      const act = actions[i];
      if (act?.onClick) act.onClick();
      hideToast();
    });
  }
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => hideToast(), 4800);
}

function hideToast() {
  if (!el.toast) return;
  el.toast.style.display = "none";
  el.toast.innerHTML = "";
  clearTimeout(toastTimer);
  toastTimer = null;
}

function pushUndo(deletedAnnotations) {
  state.undoStack.push({ deleted: deletedAnnotations, bookKey: state.currentPdfKey, at: Date.now() });
  state.undoStack = state.undoStack.slice(-10);
  showToast(`已删除 ${deletedAnnotations.length} 条注释`, [
    {
      label: "撤销",
      onClick: () => undoLastDelete(),
    },
  ]);
}

function undoLastDelete() {
  const item = state.undoStack.pop();
  if (!item || item.bookKey !== state.currentPdfKey) {
    status("没有可撤销的删除");
    return;
  }
  for (const a of item.deleted) state.glossStore.set(a.id, a);
  persistCurrentBook();
  renderPanel();
  renderVocab();
  for (const a of item.deleted) renderPageGlosses(a.pageNum);
  status("已撤销删除");
}

// -------------------- modes / rendering --------------------

function setMode(mode, opts = { persist: true }) {
  state.mode = mode;
  const original = mode === "original";
  el.pdfHost.classList.toggle("hidden", !original);
  el.reflowHost.classList.toggle("hidden", original);
  el.modeOriginal.classList.toggle("active", original);
  el.modeReflow.classList.toggle("active", !original);
  el.modeOriginal.setAttribute("aria-selected", String(original));
  el.modeReflow.setAttribute("aria-selected", String(!original));
  if (opts.persist) persistCurrentBook();
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
  persistCurrentBook();
  renderPanel();
  renderVocab();
  renderPageGlosses(item.pageNum);
  pushUndo([item]);
}

function removeAllByWord(wordKey) {
  const k = String(wordKey || "").toLowerCase();
  if (!k) return;
  const deleted = [];
  for (const a of state.glossStore.values()) {
    if (String(a.word || "").toLowerCase() === k) deleted.push(a);
  }
  if (!deleted.length) return;
  for (const a of deleted) state.glossStore.delete(a.id);
  persistCurrentBook();
  renderPanel();
  renderVocab();
  for (const a of deleted) renderPageGlosses(a.pageNum);
  pushUndo(deleted);
}

function retryAnnotation(id) {
  const a = state.glossStore.get(id);
  if (!a) return;
  a.status = "loading";
  a.wordZh = "翻译中…";
  a.contextZh = "翻译中…";
  state.glossStore.set(id, a);
  persistCurrentBook();
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
    persistCurrentBook();
    return;
  }
  if (retry < 12) {
    setTimeout(() => scrollToPage(pageNum, retry + 1), 180);
  }
}

function jumpToLastTranslation() {
  const list = Array.from(state.glossStore.values()).sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  if (!list.length) {
    status("还没有翻译注释");
    return;
  }
  const a = list[0];
  scrollToPage(a.pageNum);
  setTab("annos");
  status(`最近：${a.word} · 第 ${a.pageNum} 页`);
}

function renderPanel() {
  const list = Array.from(state.glossStore.values()).sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  el.annotationList.innerHTML = "";
  el.annotationEmpty.style.display = list.length ? "none" : "block";

  for (const a of list) {
    const card = document.createElement("article");
    card.className = "anno-card";
    const statusClass = a.status === "error" ? "status-err" : "status-ok";
    const known = state.knownWords.has(String(a.word || "").toLowerCase());
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
        <button data-act="known">${known ? "取消掌握" : "标记已掌握"}</button>
        <button class="danger" data-act="del">删除</button>
      </div>
    `;
    card.querySelector("[data-act='jump']")?.addEventListener("click", () => scrollToPage(a.pageNum));
    card.querySelector("[data-act='retry']")?.addEventListener("click", () => retryAnnotation(a.id));
    card.querySelector("[data-act='known']")?.addEventListener("click", () => toggleKnown(String(a.word || "").toLowerCase()));
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
      persistCurrentBook();
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
  persistCurrentBook();
  renderPanel();
  renderVocab();
  renderPageGlosses(annotation.pageNum);
}

function createAnnotation({ word, pageNum, anchor, pretranslated = null, sentenceOverride = null }) {
  const pageText = state.pageTextStore.get(pageNum) || "";
  const sentence = sentenceOverride || extractSentence(pageText, word) || pageText.slice(0, 240);
  const id = makeId();
  const a = {
    id,
    pageNum,
    word,
    sentence,
    status: pretranslated ? "done" : "loading",
    wordZh: pretranslated ? (pretranslated.word_only_translation || pretranslated.contextual_translation || "(空)") : "翻译中…",
    contextZh: pretranslated ? (pretranslated.contextual_translation || "(空)") : "翻译中…",
    createdAt: nowIso(),
    anchorX: anchor?.x ?? 10,
    anchorY: anchor?.y ?? 10,
    anchorW: anchor?.w ?? 12,
    anchorH: anchor?.h ?? 12,
    x: anchor?.x ?? 10,
    y: anchor?.y ?? 10,
    placement: "right",
    version: 5,
  };
  state.glossStore.set(id, a);
  persistCurrentBook();
  renderPanel();
  renderVocab();
  renderPageGlosses(pageNum);
  status(`已添加：${word}`);

  if (window.matchMedia && window.matchMedia("(max-width: 1040px)").matches) {
    el.annotationPanel?.classList.add("open");
  }

  if (!pretranslated) finishTranslate(a);
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
    if (/^war and peace$/i.test(text)) continue;
    if (/^free ebooks at/i.test(text)) continue;
    if (/^planet ebook/i.test(text)) continue;
    if (/^chapter\s+[ivxlcdm0-9]+/i.test(text)) continue;
    let line = lines.find((ln) => Math.abs(ln.y - y) <= 4);
    if (!line) {
      line = { y, chunks: [] };
      lines.push(line);
    }
    line.chunks.push(item);
  }
  lines.sort((a, b) => b.y - a.y);
  for (const ln of lines) ln.chunks.sort((a, b) => (a.transform?.[4] || 0) - (b.transform?.[4] || 0));
  return lines;
}

function lineToText(line) {
  const raw = line.chunks.map((c) => c.str || "").join(" ");
  return normalizeText(raw).replace(/\s+([,.;:!?])/g, "$1");
}

function buildReflowParagraphs(lines) {
  const paras = [];
  let current = [];
  let prevY = null;

  const pushCurrent = () => {
    if (!current.length) return;
    const text = current.join(" ").replace(/\s+([,.;:!?])/g, "$1").trim();
    if (text.length > 2) paras.push(text);
    current = [];
  };

  for (const line of lines) {
    const text = lineToText(line);
    if (!text) continue;

    const gap = prevY == null ? 0 : Math.abs(prevY - line.y);
    const paragraphBreak = gap > 22 || /^[-\d\s]*chapter\b/i.test(text);

    if (paragraphBreak) pushCurrent();

    if (current.length) {
      const last = current[current.length - 1];
      if (/[-‑]$/.test(last) && /^[A-Za-z]/.test(text)) {
        current[current.length - 1] = last.replace(/[-‑]$/, "") + text;
      } else {
        current.push(text);
      }
    } else {
      current.push(text);
    }

    prevY = line.y;
  }

  pushCurrent();
  return paras;
}

async function maybeAutoTranslateOnReflow(pageNum, root) {
  const mode = state.settings.autoTranslateMode || "off";
  if (mode === "off") return;

  const words = [...root.querySelectorAll(".word-token")];
  if (!words.length) return;

  if (mode === "underline") {
    for (const sp of words) {
      const w = normalizeText(sp.textContent || "");
      if (!w) continue;
      const known = state.knownWords.has(w.toLowerCase());
      sp.classList.toggle("autoMark", !known);
    }
    return;
  }

  if (mode === "limit10") {
    // translate up to 10 unknown words on the page (visual only: show badge but do NOT save annotation)
    const targets = words
      .map((sp) => ({ sp, w: normalizeText(sp.textContent || "") }))
      .filter((x) => x.w && !state.knownWords.has(x.w.toLowerCase()));

    for (const x of targets.slice(0, 10)) {
      x.sp.classList.add("autoMark");
      let badge = x.sp.nextElementSibling;
      if (!badge || !badge.classList.contains("reflow-gloss")) {
        badge = document.createElement("span");
        badge.className = "reflow-gloss";
        x.sp.insertAdjacentElement("afterend", badge);
      }
      badge.textContent = "…";

      try {
        const pageText = state.pageTextStore.get(pageNum) || "";
        const sentence = extractSentence(pageText, x.w) || pageText.slice(0, 200);
        const out = await translateWord(x.w, sentence);
        badge.textContent = out.word_only_translation || out.contextual_translation || "(无)";
      } catch {
        badge.textContent = "×";
      }
    }
  }
}

function renderParagraphWithClickableWords(p, text, pageNum) {
  for (const tk of tokenizeText(text)) {
    if (/^\s+$/.test(tk)) {
      p.appendChild(document.createTextNode(tk));
      continue;
    }
    if (isEnglishWord(tk)) {
      const sp = document.createElement("span");
      sp.className = "word-token";
      sp.textContent = tk;
      sp.addEventListener("click", async () => {
        sp.classList.add("active");
        const anchor = { x: 10, y: 10, w: 10, h: 10 };

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
          badge.classList.toggle("known", state.knownWords.has(String(tk).toLowerCase()));
          createAnnotation({ word: tk, pageNum, anchor, pretranslated: out, sentenceOverride: sentence });
        } catch {
          badge.textContent = "翻译失败";
          createAnnotation({ word: tk, pageNum, anchor });
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

function renderReflowPage(pageNum, items) {
  const page = document.createElement("article");
  page.className = "reflow-page";
  page.dataset.pageNum = String(pageNum);

  const lines = buildReflowLines(items);
  const paragraphs = buildReflowParagraphs(lines);

  paragraphs.forEach((paraText, idx) => {
    const p = document.createElement("p");
    if (idx > 0 && !/^['"“‘(\[]/.test(paraText)) p.classList.add("indent");
    renderParagraphWithClickableWords(p, paraText, pageNum);
    page.appendChild(p);
  });

  el.reflowHost.appendChild(page);
  requestAnimationFrame(() => {
    refreshKnownMarkers();
    maybeAutoTranslateOnReflow(pageNum, page);
  });
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
      const rect0 = span.getBoundingClientRect();
      const word = pickEnglishWord(raw, rect0.width > 0 ? (ev.clientX - rect0.left) / rect0.width : null);
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
  refreshKnownMarkers();
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

  const deleted = Array.from(state.glossStore.values());
  state.glossStore.clear();
  state.knownWords.clear();

  const payload = readBookPayload(state.currentPdfKey);
  payload.glosses = [];
  payload.knownWords = [];
  payload.currentPage = 1;
  payload.updatedAt = nowIso();
  writeBookPayload(state.currentPdfKey, payload);

  renderPanel();
  renderVocab();
  for (let i = 1; i <= state.totalPages; i++) renderPageGlosses(i);
  status("已清空本书注释");
  if (deleted.length) pushUndo(deleted);
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

  const fp = pdf.fingerprints?.[0] || `${file.name}:${file.size}:${file.lastModified}`;
  state.currentPdfKey = `${STORAGE.bookPrefix}${fp}`;
  state.currentBookMeta = {
    fingerprint: fp,
    title: file.name.replace(/\.pdf$/i, ""),
    fileName: file.name,
    size: file.size,
    lastModified: file.lastModified,
  };

  // Restore saved data BEFORE rendering (so UI is ready)
  restoreBookIntoState(state.currentPdfKey);

  renderBookshelfSelect();

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
    if (dist < bestDist) {
      bestDist = dist;
      best = p;
    }
  }
  state.currentPage = Number(best.dataset.pageNum || 1);
  persistCurrentBook();
}

// -------------------- search --------------------

function runSearch() {
  const q = normalizeText(el.searchInput.value || "");
  state.lastSearchQuery = q;
  el.searchResults.innerHTML = "";
  el.searchEmpty.style.display = "none";

  if (!q) {
    el.searchHint.textContent = "请输入搜索词(英文)，点击上方“搜索”。";
    return;
  }

  const needle = q.toLowerCase();
  const results = [];
  for (const [pageNum, text] of state.pageTextStore.entries()) {
    const t = String(text || "");
    const idx = t.toLowerCase().indexOf(needle);
    if (idx < 0) continue;
    const start = Math.max(0, idx - 45);
    const end = Math.min(t.length, idx + needle.length + 55);
    const snippet = normalizeText(t.slice(start, end));
    results.push({ pageNum, snippet });
  }

  el.searchHint.textContent = `找到 ${results.length} 页包含 “${q}”`;
  if (!results.length) {
    el.searchEmpty.style.display = "block";
    return;
  }

  for (const r of results.slice(0, 120)) {
    const card = document.createElement("article");
    card.className = "anno-card";
    card.innerHTML = `
      <div class="anno-top">
        <div>
          <div class="anno-word">第 ${r.pageNum} 页</div>
          <div class="anno-meta">点击定位</div>
        </div>
        <div class="anno-zh">🔎</div>
      </div>
      <div class="anno-ctx">${escapeHtml(r.snippet)}</div>
      <div class="anno-actions">
        <button data-act="jump">定位</button>
      </div>
    `;
    card.querySelector("[data-act='jump']")?.addEventListener("click", () => {
      setTab("search");
      scrollToPage(r.pageNum);
    });
    el.searchResults.appendChild(card);
  }

  setTab("search");
}

// -------------------- import/export --------------------

function downloadJson(filename, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function exportCurrentBook() {
  if (!state.currentPdfKey) {
    status("请先选择/上传一本书");
    return;
  }
  const payload = readBookPayload(state.currentPdfKey);
  const out = {
    kind: "pdf-context-translator-export",
    version: 1,
    exportedAt: nowIso(),
    bookKey: state.currentPdfKey,
    meta: payload.meta || state.currentBookMeta,
    data: {
      glosses: payload.glosses || [],
      knownWords: payload.knownWords || [],
      settings: payload.settings || {},
      mode: payload.mode,
      currentPage: payload.currentPage,
    },
  };
  const base = (out.meta?.title || out.meta?.fileName || "book").replace(/[^A-Za-z0-9._-]+/g, "-");
  downloadJson(`${base}-vocab-annotations.json`, out);
  status("已导出 JSON");
}

async function importIntoCurrentBook(file) {
  if (!state.currentPdfKey) {
    status("请先上传一本 PDF（用于确定导入到哪一本书）");
    return;
  }
  const raw = await file.text();
  const parsed = safeJsonParse(raw, null);
  if (!parsed || parsed.kind !== "pdf-context-translator-export") {
    status("导入失败：文件格式不正确");
    return;
  }
  const incoming = parsed.data || {};
  const payload = readBookPayload(state.currentPdfKey);

  // Merge glosses by id
  const existingIds = new Set((payload.glosses || []).map((g) => g.id));
  const mergedGlosses = [...(payload.glosses || [])];
  for (const g of incoming.glosses || []) {
    if (g?.id && !existingIds.has(g.id)) mergedGlosses.push(g);
  }

  // Merge knownWords
  const known = new Set([...(payload.knownWords || []).map((w) => String(w).toLowerCase())]);
  for (const w of incoming.knownWords || []) known.add(String(w).toLowerCase());

  payload.glosses = mergedGlosses;
  payload.knownWords = [...known.values()];
  payload.settings = { ...(payload.settings || {}), ...(incoming.settings || {}) };
  payload.updatedAt = nowIso();
  writeBookPayload(state.currentPdfKey, payload);

  restoreBookIntoState(state.currentPdfKey);
  for (let i = 1; i <= state.totalPages; i++) renderPageGlosses(i);
  status(`已导入：新增注释 ${Math.max(0, (incoming.glosses || []).length - (incoming.glosses || []).filter((g) => existingIds.has(g?.id)).length)} 条`);
}

// -------------------- init / events --------------------

function switchBookshelfEntry(bookKey) {
  if (!bookKey) return;
  restoreBookIntoState(bookKey);
  el.bookshelfSelect.value = bookKey;
  el.pageCount.textContent = `Pages: ${state.totalPages || state.currentBookMeta?.totalPages || 0}`;

  // No PDF bytes, so clear rendered pages and show hint
  el.pdfHost.innerHTML = "";
  el.reflowHost.innerHTML = "";
  state.pageTextStore.clear();
  state.pageGlossLayerStore.clear();
  status("已切换书籍（重新上传该 PDF 才能继续阅读/搜索）");
}

function bindEvents() {
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

  document.getElementById("readerWrap")?.addEventListener(
    "scroll",
    () => requestAnimationFrame(updateCurrentPageFromScroll),
    { passive: true },
  );

  // Tabs
  for (const b of el.tabBtns) b.addEventListener("click", () => setTab(b.dataset.tab));

  // Vocab UI
  el.hideKnown?.addEventListener("change", renderVocab);

  // Search
  el.searchBtn?.addEventListener("click", runSearch);
  el.searchInput?.addEventListener("keydown", (e) => e.key === "Enter" && runSearch());

  // Jump last
  el.jumpLastBtn?.addEventListener("click", jumpToLastTranslation);

  // Export/import
  el.exportBtn?.addEventListener("click", exportCurrentBook);
  el.importBtn?.addEventListener("click", () => el.importInput?.click());
  el.importInput?.addEventListener("change", async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    await importIntoCurrentBook(f);
    e.target.value = "";
  });

  // Settings
  el.fontSize?.addEventListener("input", () => {
    state.settings.reflowFontSize = Number(el.fontSize.value);
    applySettingsToCss();
    persistCurrentBook();
  });
  el.lineHeight?.addEventListener("input", () => {
    state.settings.reflowLineHeight = Number(el.lineHeight.value);
    applySettingsToCss();
    persistCurrentBook();
  });
  el.pageWidth?.addEventListener("input", () => {
    state.settings.reflowWidth = Number(el.pageWidth.value);
    applySettingsToCss();
    persistCurrentBook();
  });
  el.themeSelect?.addEventListener("change", () => {
    state.settings.theme = el.themeSelect.value;
    applySettingsToCss();
    persistCurrentBook();
  });
  el.autoMarkKnown?.addEventListener("change", () => {
    state.settings.autoMarkKnown = Boolean(el.autoMarkKnown.checked);
    applySettingsToCss();
    persistCurrentBook();
  });
  el.autoTranslateMode?.addEventListener("change", () => {
    state.settings.autoTranslateMode = el.autoTranslateMode.value;
    persistCurrentBook();
    status("已更新自动翻译设置（重排页面将逐页生效）");
  });

  // Bookshelf
  el.bookshelfSelect?.addEventListener("change", () => switchBookshelfEntry(el.bookshelfSelect.value));
}

function bootstrapBookshelfSelect() {
  renderBookshelfSelect();
  if (!el.bookshelfSelect) return;

  // If there's a last-opened book, restore its sidebar immediately
  const lastKey = localStorage.getItem(STORAGE.currentBookKey);
  if (lastKey && localStorage.getItem(lastKey)) {
    restoreBookIntoState(lastKey);
    el.bookshelfSelect.value = lastKey;
    status("已从书架恢复上次书籍（上传 PDF 可继续阅读）");
  }
}

// Init
bindEvents();
setMode("original");
setTab("annos");
applySettingsToCss();
renderPanelTitle();
renderPanel();
renderVocab();
bootstrapBookshelfSelect();
status("就绪：上传 PDF 开始");
