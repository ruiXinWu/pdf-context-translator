# Overnight Progress — Task 1 PDF App Build

**Timestamp:** 2026-02-12 01:30 PT (task start context)

## Completed

- Created new MVP project: `pdf-context-translator/`
- Implemented FastAPI backend (`app/main.py`)
  - `/api/translate` endpoint
  - Context-aware translation flow using local phrase window around selected word
  - Word-only translation for comparison
- Implemented frontend (`app/static/index.html`, `app/static/app.js`)
  - PDF upload/open
  - Page rendering via PDF.js
  - Clickable text layer on words
  - Sentence extraction and translation request pipeline
  - Right-side panel with word/context/result fields
- Added `README.md` with setup/run instructions and MVP limitations
- Added dependency manifest (`requirements.txt`)

## Implementation choices

- Chosen architecture: lightweight backend + thin client
  - Keeps browser code simple
  - Avoids third-party translation API key requirements
- Translation model: `Helsinki-NLP/opus-mt-en-zh` through Transformers
  - Practical for MVP
  - Supports local contextual input without external service coupling

## Known limitations (MVP)

- Sentence extraction is heuristic and first-match based on page text.
- Repeated words may not always map to the exact clicked occurrence.
- First run may be slower due to model download.

## Next steps suggested

1. Position-aware sentence extraction tied to click index.
2. Visual highlight of selected token.
3. Result cache and loading indicators per request.
4. Add simple smoke test script.
