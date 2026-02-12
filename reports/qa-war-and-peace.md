# QA Report — War and Peace

Date: 2026-02-12
PDF: `/Users/raywu/Downloads/war-and-peace.pdf`
App: `pdf-context-translator`

## Scope

Priority Task 1 redesign validation:
- Click word => inline Chinese gloss bubble near clicked word
- Bubble persists on page (pinned by default), closeable
- Multiple glosses per page
- Persist glosses locally and restore after refresh/reopen of same PDF
- Preserve existing translation behavior with fallback

## Test Method

- Browser automation (OpenClaw browser tool)
- Manual visual verification on rendered pages
- Repeated checks across early and later pages in the 2882-page document

## Results Summary

✅ Implemented and verified core reading-first flow.

- Inline bubble appears near click target with Chinese contextual + word-only translation.
- Bubbles are pinned by default and remain visible while reading.
- Multiple bubbles can coexist on the same page.
- Bubble close button removes a single gloss and persists deletion.
- Glosses are persisted in `localStorage` keyed by PDF fingerprint and restored when reopening the same PDF.
- Existing `/api/translate` path remains unchanged (OpenAI-first + free Google fallback in backend).

## Detailed Test Notes

### 1) Inline bubble creation near clicked word
- Clicked words/tokens on page 3 region (`known`, `French,`, `grippe` line context).
- Bubble appears near the click with:
  - word title
  - `语境` (contextual Chinese)
  - `词义` (word-only Chinese)
  - sentence snippet
- Visual placement remains within page bounds (clamped).

Status: ✅ Pass

### 2) Multiple glosses per page
- Added multiple glosses in the same visible page region.
- Verified 6+ concurrent bubbles present in DOM and visible.

Status: ✅ Pass

### 3) Closeable bubbles
- Closed one bubble via `×` button.
- Bubble count decremented immediately.
- Refresh + reopen confirmed removed bubble did not return.

Status: ✅ Pass

### 4) Persistence after refresh/reopen of same PDF
- Created several glosses, refreshed app, re-opened same file.
- Glosses restored from local storage.
- Verified restoration while only part of document had rendered (important for huge PDFs).

Status: ✅ Pass

### 5) Word-pattern behavior checks
Checked across patterns:
- Plain token (`known`) ✅
- Token with punctuation (`French,`) ✅ -> normalized to `French`
- Multi-word text span click (`...in a battle,`) ✅ -> nearest English token selected (`a` or `spare` depending click position)
- Non-English/unsupported token path -> no gloss created (expected)

Status: ✅ Pass (with noted limitation below)

## Failures Found and Fixes Applied

### Failure 1: Restored glosses were delayed/unusable on large PDFs

**Symptom**
- On refresh/reopen, gloss restoration happened only after all pages finished rendering.
- For `war-and-peace.pdf` (2882 pages), this made restoration effectively unavailable for a long time.

**Root Cause**
- Restore rendering was executed only once after the full page-render loop completed.

**Fix**
- Load persisted gloss data before render loop.
- Render page-specific glosses as each page is rendered.
- Switch from global re-render to page-scoped re-render (`renderGlossesForPage`) for correctness + performance.

**Verification**
- Reopen test showed glosses restored quickly while only ~576 pages were rendered.

Status: ✅ Fixed

## Known Limitations (unchanged/non-blocking)

1. Full-document eager rendering is expensive for very large PDFs; initial load remains heavy.
2. Sentence extraction still uses first regex match in page text and may not map exact repeated occurrence.
3. Clicking long merged text spans may select a nearby token that is not the user’s intended exact word.

## Files Changed

- `app/static/index.html`
  - reading-first single-pane UI
  - inline gloss bubble styles
- `app/static/app.js`
  - inline gloss bubble creation/close
  - multi-gloss support
  - localStorage persistence + restore by PDF fingerprint
  - per-page restore rendering fix for large PDFs
- `reports/qa-war-and-peace.md`
  - this report
