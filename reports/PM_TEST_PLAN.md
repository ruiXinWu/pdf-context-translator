# PM Test Plan — PDF Context Translator (Right-Side + Reflow UX)

Date: 2026-02-12  
Scope: `/Users/raywu/.openclaw/workspace/pdf-context-translator`  
Target file for validation: `/Users/raywu/Downloads/war-and-peace.pdf`

## 1) Product intent (PM framing)

Primary user promise:
- User can click an English word while reading and see Chinese translation **to the right of that word** with minimal distraction.
- If strict PDF-layer text reflow is not technically possible, product must provide a **clear Reflow Reading Mode** where text naturally reflows and translation appears inline-right in reading flow.

Non-goals for this milestone:
- Perfect linguistic disambiguation for every historical/literary phrase.
- Full document semantic segmentation quality equal to a production ebook engine.

## 2) Test principles (picky, user-centric)

- **Reading-first**: translation should help reading, not interrupt it.
- **Low cognitive load**: avoid visual clutter and excessive overlays.
- **Predictable interaction**: same gesture (click word) should do expected action in each mode.
- **Recoverability**: easy to close/remove annotations.
- **Mode clarity**: user must understand Original vs Reflow behavior quickly.

## 3) Test matrix

### A. Original PDF mode
1. Upload very large PDF (`war-and-peace.pdf`) and verify pages begin rendering.
2. Click words near middle/right edges and confirm gloss prefers right-side placement; falls below only when needed.
3. Confirm multiple glosses can exist and each can be closed.
4. Refresh/reopen same PDF and verify persisted glosses restore.

### B. Reflow Reading Mode
1. Switch modes and verify clear visual state + explanatory hint text.
2. Confirm readable reflowed text block appears.
3. Click English word and verify inline gloss appears immediately to the right in reading flow.
4. Click another word and verify old inline gloss is removed (minimal distraction) and new one appears next to selected word.
5. Validate punctuation/spacing readability (no obvious broken spacing around punctuation).

### C. Performance / stability
1. Initial load on large PDF remains responsive (no full UI lock).
2. Reflow mode can display progressively rendered pages.
3. Mode switch remains responsive after multiple translations.

### D. Error tolerance
1. Translation request failure shows understandable fallback/error text without breaking reading session.
2. Non-English tokens should not create malformed glosses.

## 4) Acceptance criteria (must pass)

1. App runs at `http://localhost:8000`.
2. War and Peace loads; page count shows expected high page number (thousands).
3. Original mode:
   - Click on English word creates compact gloss.
   - Gloss attempts right-side placement before bottom fallback.
4. Reflow Reading Mode exists and is clearly labeled.
5. Reflow mode click behavior:
   - translation appears inline-right of clicked word,
   - text naturally reflows (no absolute-position overlay behavior),
   - only one active inline gloss is visible at a time (minimal distraction).
6. Existing Original mode is preserved and usable.
7. QA log documents at least 5 independent passes with PM questions, issues, severity, decisions, fixes, and retest outcomes.

## 5) Fail criteria (release blockers)

- No Reflow mode and no true text-flow fallback when PDF layer cannot reflow.
- Translation appears detached from clicked word (e.g., random panel far away).
- Interaction creates significant clutter (stacking inline reflow glosses everywhere without easy control).
- Mode switching breaks either Original or Reflow reading path.
- War and Peace cannot be tested end-to-end on localhost.

## 6) Known technical constraints to communicate honestly

- PDF.js text extraction order may not perfectly match author-intended paragraphs for all pages.
- Reflow mode is extraction-based reconstruction, not exact typographic fidelity to original PDF artwork.
- Sentence extraction for context is heuristic and may mismatch repeated terms.

## 7) Exit decision

Ship only if all acceptance criteria are met and no blocker remains from fail criteria list.
