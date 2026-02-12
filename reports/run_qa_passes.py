import json
import re
import time
from pathlib import Path
from playwright.sync_api import sync_playwright

APP = "http://127.0.0.1:8000"
PDF = "/Users/raywu/Downloads/war-and-peace.pdf"


def run_pass(pass_no: int):
    out = {
        "pass": pass_no,
        "questions": [
            "Does click land on intended word and place gloss adjacent/underword?",
            "Does compact gloss avoid heavy overlap and keep reading flow?",
            "Do glosses persist after reload and same-file reopen?",
            "Is first-page interaction responsive on long PDF?",
            "Does API failure show compact non-blocking error fallback?",
        ],
        "metrics": {},
        "issues": [],
    }

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 1500, "height": 1100})
        page = context.new_page()

        t0 = time.time()
        page.goto(APP)
        page.set_input_files("#pdfInput", PDF)
        page.wait_for_selector(".page", timeout=180000)
        t_first_page = time.time() - t0
        out["metrics"]["first_page_seconds"] = round(t_first_page, 2)

        page.wait_for_selector(".textLayer span", timeout=90000)

        found = page.evaluate(
            """
            () => {
              const spans = [...document.querySelectorAll('.textLayer span')];
              for (const s of spans) {
                const t = (s.textContent || '').trim();
                if (!t) continue;
                if (!/[A-Za-z]/.test(t)) continue;
                const r = s.getBoundingClientRect();
                if (r.width < 20 || r.height < 6) continue;
                s.setAttribute('data-pick', '1');
                return { text: t, width: r.width, height: r.height };
              }
              return null;
            }
            """
        )
        if not found:
            out["issues"].append("No clickable English span found")
            browser.close()
            return out

        page.click("[data-pick='1']", position={"x": 14, "y": 4})
        page.wait_for_selector(".gloss-inline", timeout=60000)

        check = page.evaluate(
            """
            () => {
              const s = document.querySelector("[data-pick='1']");
              const g = document.querySelector('.gloss-inline');
              const pageEl = document.querySelector('.page');
              if (!s || !g || !pageEl) return null;
              const sr = s.getBoundingClientRect();
              const gr = g.getBoundingClientRect();
              const pr = pageEl.getBoundingClientRect();
              const dx = Math.max(0, Math.max(sr.left - gr.right, gr.left - sr.right));
              const dy = Math.max(0, Math.max(sr.top - gr.bottom, gr.top - sr.bottom));
              const areaRatio = (gr.width * gr.height) / (pr.width * pr.height);
              return {
                glossW: gr.width,
                glossH: gr.height,
                distanceX: dx,
                distanceY: dy,
                areaRatio,
                text: g.innerText,
              };
            }
            """
        )

        if check:
            out["metrics"].update({
                "gloss_width": round(check["glossW"], 1),
                "gloss_height": round(check["glossH"], 1),
                "gap_x": round(check["distanceX"], 1),
                "gap_y": round(check["distanceY"], 1),
                "area_ratio": round(check["areaRatio"], 4),
            })
            if check["glossW"] > 240 or check["glossH"] > 60:
                out["issues"].append("Gloss footprint too large")
            if check["distanceX"] > 50 and check["distanceY"] > 28:
                out["issues"].append("Gloss not adjacent to source word")
            if check["areaRatio"] > 0.035:
                out["issues"].append("Gloss overlaps too much page area")

        # persistence restore
        before = page.locator(".gloss-inline").count()
        page.reload()
        page.set_input_files("#pdfInput", PDF)
        page.wait_for_selector(".page", timeout=180000)
        page.wait_for_timeout(1200)
        after = page.locator(".gloss-inline").count()
        out["metrics"]["persist_before"] = before
        out["metrics"]["persist_after_reload"] = after
        if after < before:
            out["issues"].append("Persistence restore dropped gloss entries")

        # error fallback
        def fail_translate(route):
            route.fulfill(status=503, body="service unavailable", content_type="text/plain")

        page.route("**/api/translate", fail_translate)
        page.evaluate(
            """
            () => {
              const old = document.querySelector('[data-pick="1"]');
              if (old) old.removeAttribute('data-pick');
              const spans = [...document.querySelectorAll('.textLayer span')];
              for (const s of spans) {
                const t = (s.textContent || '').trim();
                if (/^[A-Za-z][A-Za-z'\\-]{3,}$/.test(t)) {
                  s.setAttribute('data-pick','2');
                  return;
                }
              }
            }
            """
        )
        page.click("[data-pick='2']", position={"x": 8, "y": 4})
        page.wait_for_timeout(1000)
        has_error = page.evaluate(
            """
            () => [...document.querySelectorAll('.gloss-context')].some(el => /Error:/.test(el.textContent || ''))
            """
        )
        out["metrics"]["error_fallback_visible"] = bool(has_error)
        if not has_error:
            out["issues"].append("Error fallback not rendered in compact gloss")

        browser.close()

    return out


if __name__ == "__main__":
    results = [run_pass(i) for i in range(1, 6)]
    print(json.dumps(results, indent=2))
