# QA Log — War and Peace (5 PM Passes)

Date: 2026-02-12  
App: `pdf-context-translator`  
Runtime target: `http://localhost:8000`  
PDF under test: `/Users/raywu/Downloads/war-and-peace.pdf`

---

## Pass 1 — Baseline product-fit check (pre-fix)

**PM questions**
- Is there a clear path to “translation to the right of clicked word” today?
- Is reading minimally interrupted?
- Does product support true reflow fallback?

**Observed issues**
1. No explicit reflow reading mode; app only overlays on fixed PDF canvas.  
   - Severity: **High** (core user requirement gap)
2. Mode intent not explicit to user (no Original vs Reflow distinction).  
   - Severity: **Medium**

**Fix decision**
- Implement dual-mode UX:
  - Keep existing **Original PDF mode**.
  - Add **Reflow Reading Mode** with inline-right translation in natural text flow.

**Implementation**
- Added mode switch tabs: Original PDF / Reflow Reading Mode.
- Added mode-specific hint text.
- Added dedicated `#reflowHost` rendering pipeline and styles.

**Re-test result**
- Pass: mode switch present and functional; Reflow mode now exists.

---

## Pass 2 — Reflow interaction behavior (first implementation)

**PM questions**
- In Reflow mode, does translation appear immediately to the right of clicked word?
- Does layout reflow naturally (not floating overlay)?

**Observed issues**
1. Inline translation appears, but repeated clicks can leave multiple inline badges in different lines/areas, creating clutter.  
   - Severity: **High** (violates minimal-distraction goal)

**Fix decision**
- Enforce single active inline gloss in Reflow mode.

**Implementation**
- Updated `updateReflowGloss()` to remove all prior `.reflow-gloss` instances before inserting new one.
- Updated active-state handling to clear old `.word-token.active` markers globally.

**Re-test result**
- Pass: only one inline gloss visible at a time; significantly cleaner reading experience.

---

## Pass 3 — Typography/readability QA (reflow text quality)

**PM questions**
- Does reflow text look natural enough for long-form reading?
- Are punctuation and spacing readable?

**Observed issues**
1. Earlier token rendering inserted blanket spaces after every token, causing occasional awkward punctuation spacing.  
   - Severity: **Medium**

**Fix decision**
- Preserve whitespace tokens from extraction and render them directly (instead of unconditional spacing).

**Implementation**
- Changed tokenizer to include whitespace tokens: `/[A-Za-z][A-Za-z'-]*|\s+|[^A-Za-z\s]+/g`.
- Rendering loop now appends whitespace tokens as-is and stops forcing extra spaces.

**Re-test result**
- Pass: punctuation spacing visibly improved; reading flow more natural.

---

## Pass 4 — Original mode regression + right-side behavior

**PM questions**
- Did reflow work break Original mode?
- In Original mode, does gloss prioritize right-side placement and fallback safely?

**Observed issues**
- No regressions found in Original mode interactions.
- Right-side placement behavior remains in place via anchor-based positioning; bottom fallback used when constrained.

**Severity**
- N/A (no actionable defect found in this pass)

**Fix decision**
- No code change required.

**Implementation**
- N/A

**Re-test result**
- Pass: Original mode preserved and operating as expected.

---

## Pass 5 — End-to-end with War and Peace on localhost (final)

**PM questions**
- Can user run the product on localhost with War and Peace and complete key flow?
- Does Reflow mode satisfy “inline right-side + reflow” intent in real use?
- Is behavior stable under large-document conditions?

**Execution evidence (browser automation, real UI flow)**
- Loaded app at `http://127.0.0.1:8000`.
- Uploaded `/Users/raywu/Downloads/war-and-peace.pdf`.
- Observed page label: `Pages: 2882`.
- Switched to Reflow mode.
- Reflow pages rendered progressively (sample run observed `ReflowPages=169` during active rendering window).
- Clicked first token `War`; inline gloss shown next to token with Chinese output (`战争 ...`).

**Observed issues**
- No blocker defects found in final flow.

**Severity**
- None

**Fix decision**
- Ready to ship this milestone with known limitations documented.

**Implementation**
- No additional code change in this final pass.

**Re-test result**
- Pass.

---

## Final PM verdict

**Status: ACCEPTED for milestone intent.**

Delivered against request:
- Added explicit **Reflow Reading Mode** (true text flow + inline-right translation).
- Preserved **Original PDF mode** with right-preferred placement and fallback.
- Reduced distraction in Reflow mode by enforcing single active gloss.
- Validated on War and Peace at localhost.

## Candid limitations

1. Reflow text is reconstructed from PDF text extraction order; exact visual fidelity to original page design is not guaranteed.
2. Sentence context extraction remains heuristic and can be imperfect for repeated words.
3. Very large PDFs render progressively; early moments may show partial page set in reflow view before complete render.
