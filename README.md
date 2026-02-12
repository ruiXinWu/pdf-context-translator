# PDF Context Translator (UX V2)

A redesigned PDF reading and context-translation web app focused on reading flow, annotation management, and robust failure handling.

## What it does

- Upload/open a local PDF file in browser
- Render pages with clickable text layer
- Click an English word in the PDF to create an inline gloss bubble near the click
- Keep multiple pinned gloss bubbles open per page
- Close any gloss bubble individually
- Persist glosses locally (by PDF fingerprint) and restore on reopen/refresh of the same PDF
- Detect sentence context on that page and show:
  - Contextual Chinese translation
  - Word-only Chinese translation

## Tech

- Frontend: Vanilla JS + PDF.js
- Backend: FastAPI
- Translation model: `Helsinki-NLP/opus-mt-en-zh` via Hugging Face Transformers

## Project structure

```text
pdf-context-translator/
  app/
    main.py
    static/
      index.html
      app.js
  reports/
    overnight-progress.md
  requirements.txt
  README.md
```

## Run locally

> First run downloads model weights, so it can take a while.

1. Create and activate venv:

```bash
cd pdf-context-translator
python3 -m venv .venv
source .venv/bin/activate
```

2. Install dependencies:

```bash
pip install -r requirements.txt
```

3. Start server:

```bash
uvicorn app.main:app --reload --port 8000
```

4. Open app:

- http://127.0.0.1:8000

## Usage

1. Click file input and select a PDF.
2. Wait for pages to render.
3. Click an English word directly on the PDF text.
4. See selected word, detected sentence context, contextual Chinese, and word-only Chinese in the right panel.

## Notes / MVP limitations

- Context is approximated from page text and punctuation boundaries.
- For repeated words on a page, sentence matching may pick an earlier occurrence.
- Translation quality is model-dependent and not dictionary-grade for all domains.
- No auth, persistence, or annotation storage yet.

## Next improvements

- Better sentence alignment by position mapping, not first-match lookup.
- Highlight selected word in rendered text layer.
- Cache translation results per `(word, sentence)`.
- Add fallback translation provider when model unavailable.
