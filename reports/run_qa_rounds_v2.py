import json
import time
from playwright.sync_api import sync_playwright

APP = "http://127.0.0.1:8010"
PDF = "/Users/raywu/.openclaw/workspace/pdf-context-translator/testdata/war-and-peace.pdf"


def one_round(idx: int, viewport):
    out = {"round": idx, "viewport": viewport, "checks": {}, "issues": []}
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(viewport=viewport)
        page = ctx.new_page()

        t0 = time.time()
        page.goto(APP)
        page.set_input_files("#pdfInput", PDF)
        page.wait_for_selector(".page", timeout=180000)
        out["checks"]["first_page_seconds"] = round(time.time() - t0, 2)

        page.wait_for_function("() => document.querySelectorAll('.textLayer span').length > 10", timeout=180000)

        picked = page.evaluate(
            r"""
            () => {
              const spans = [...document.querySelectorAll('.textLayer span')];
              for (const s of spans) {
                const t = (s.textContent || '').trim();
                const r = s.getBoundingClientRect();
                if (/^[A-Za-z][A-Za-z'\-]{3,}$/.test(t) && r.width > 16 && r.height > 6) {
                  s.setAttribute('data-pick', '1');
                  return t;
                }
              }
              return null;
            }
            """
        )
        if not picked:
            out["issues"].append("无法找到可点击英文词")
            browser.close()
            return out

        page.click("[data-pick='1']", position={"x": 8, "y": 3})
        page.wait_for_selector(".gloss-inline", timeout=60000)

        cards = page.locator(".anno-card").count()
        out["checks"]["annotation_card_after_click"] = cards
        if cards < 1:
            out["issues"].append("点击后侧栏未新增注释")

        page.fill("#gotoPageInput", "10")
        page.click("#pageJumpBtn")
        page.wait_for_timeout(1800)
        on_page = page.evaluate(
            """() => {
              const p = document.querySelector('.page[data-page-num="10"]');
              if (!p) return false;
              const r = p.getBoundingClientRect();
              return r.top < window.innerHeight * 0.9;
            }"""
        )
        out["checks"]["goto_page_10_visible"] = bool(on_page)
        if not on_page:
            out["issues"].append("跳转第10页失败")

        page.click("#modeReflow")
        page.wait_for_selector(".reflow-page", timeout=60000)
        page.click("#modeOriginal")
        page.wait_for_selector(".page", timeout=60000)
        out["checks"]["mode_switch"] = True

        before = page.locator(".anno-card").count()
        page.reload()
        page.set_input_files("#pdfInput", PDF)
        page.wait_for_selector(".page", timeout=180000)
        page.wait_for_timeout(1300)
        after = page.locator(".anno-card").count()
        out["checks"]["persist_before"] = before
        out["checks"]["persist_after_reload"] = after
        if after < before:
            out["issues"].append("刷新后注释丢失")

        page.route("**/api/translate", lambda route: route.fulfill(status=500, body="fail", content_type="text/plain"))
        page.evaluate(
            r"""
            () => {
              const old = document.querySelector('[data-pick="1"]');
              if (old) old.removeAttribute('data-pick');
              for (const s of document.querySelectorAll('.textLayer span')) {
                const t = (s.textContent || '').trim();
                const r = s.getBoundingClientRect();
                if (/^[A-Za-z][A-Za-z'\-]{4,}$/.test(t) && r.width > 16 && r.height > 6) {
                  s.setAttribute('data-pick', '2');
                  return;
                }
              }
            }
            """
        )
        page.click("[data-pick='2']", position={"x": 6, "y": 3})
        page.wait_for_timeout(1400)
        has_error = page.evaluate("""() => [...document.querySelectorAll('.anno-card,.gloss-inline')].some(el => /Error:/.test(el.textContent || ''))""")
        out["checks"]["error_state_visible"] = bool(has_error)
        if not has_error:
            out["issues"].append("失败态文案未显示")

        browser.close()
    return out


if __name__ == "__main__":
    rounds = [
        one_round(1, {"width": 1440, "height": 980}),
        one_round(2, {"width": 1200, "height": 820}),
        one_round(3, {"width": 390, "height": 844}),
    ]
    print(json.dumps(rounds, ensure_ascii=False, indent=2))
