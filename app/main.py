from __future__ import annotations

import os
import re
from pathlib import Path

import requests
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"

app = FastAPI(title="PDF Context Translator MVP")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class TranslateRequest(BaseModel):
    word: str = Field(..., min_length=1)
    sentence: str = Field(default="")


class TranslateResponse(BaseModel):
    word: str
    sentence: str
    contextual_translation: str
    word_only_translation: str


def normalize_text(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def openai_translate(word: str, sentence: str) -> tuple[str, str]:
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("Missing OPENAI_API_KEY")

    prompt = (
        "You are an English-to-Chinese translator. Return strict JSON only with keys "
        "contextual_translation and word_only_translation.\n"
        f"Word: {word}\n"
        f"Sentence: {sentence or '(none)'}\n"
        "Rules:\n"
        "- contextual_translation: translate the word according to sentence meaning.\n"
        "- word_only_translation: translate the standalone word (dictionary-style).\n"
        "- Keep each value concise (1-6 Chinese characters where possible)."
    )

    resp = requests.post(
        "https://api.openai.com/v1/chat/completions",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json={
            "model": "gpt-4o-mini",
            "temperature": 0,
            "response_format": {"type": "json_object"},
            "messages": [{"role": "user", "content": prompt}],
        },
        timeout=30,
    )
    if resp.status_code >= 300:
        raise RuntimeError(f"OpenAI error: {resp.text[:200]}")

    data = resp.json()
    content = data["choices"][0]["message"]["content"]
    parsed = __import__("json").loads(content)
    return (
        normalize_text(parsed.get("contextual_translation", "")),
        normalize_text(parsed.get("word_only_translation", "")),
    )


def free_translate(text: str) -> str:
    url = "https://translate.googleapis.com/translate_a/single"
    params = {
        "client": "gtx",
        "sl": "en",
        "tl": "zh-CN",
        "dt": "t",
        "q": text,
    }
    r = requests.get(url, params=params, timeout=20)
    r.raise_for_status()
    data = r.json()
    return normalize_text("".join(part[0] for part in data[0] if part and part[0]))


@app.post("/api/translate", response_model=TranslateResponse)
def translate(req: TranslateRequest):
    word = normalize_text(req.word)
    sentence = normalize_text(req.sentence)

    try:
        contextual_translation, word_only_translation = openai_translate(word, sentence)
    except Exception:
        # Fallback when API key/quota is unavailable.
        contextual_translation = free_translate(sentence or word)
        word_only_translation = free_translate(word)

    return TranslateResponse(
        word=word,
        sentence=sentence,
        contextual_translation=contextual_translation,
        word_only_translation=word_only_translation,
    )


@app.get("/")
def index():
    return FileResponse(STATIC_DIR / "index.html")


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
