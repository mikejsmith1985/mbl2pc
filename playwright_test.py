"""Playwright test — runs against local test server on port 8765."""
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    # iPhone-size viewport
    page = browser.new_page(viewport={"width": 390, "height": 844})

    errors = []
    page.on("console", lambda m: errors.append(f"[{m.type}] {m.text}") if m.type in ("error", "warning") else None)

    print("Loading page...")
    page.goto("http://localhost:8765/send.html")
    page.wait_for_timeout(2500)  # let WS connect and all fetches resolve

    # --- Chat state ---
    bubble_count = page.evaluate("document.querySelectorAll('#chat .bubble').length")
    print(f"Chat bubbles rendered: {bubble_count}")

    scroll_info = page.evaluate("""() => {
        const c = document.getElementById('chat');
        return {
            scrollTop: Math.round(c.scrollTop),
            scrollHeight: c.scrollHeight,
            clientHeight: c.clientHeight,
            atBottom: Math.abs(c.scrollTop + c.clientHeight - c.scrollHeight) < 10
        }
    }""")
    print(f"Scroll: {scroll_info}")

    last_bubble = page.evaluate("""() => {
        const bubbles = document.querySelectorAll('#chat .bubble');
        if (!bubbles.length) return null;
        const last = bubbles[bubbles.length - 1];
        const r = last.getBoundingClientRect();
        return {
            top: Math.round(r.top),
            bottom: Math.round(r.bottom),
            text: (last.dataset.text || '').slice(0, 50)
        }
    }""")
    print(f"Last bubble rect: {last_bubble}")
    if last_bubble:
        viewport_h = 844
        print(f"Last bubble fully in viewport: {last_bubble['bottom'] <= viewport_h}")

    # --- Send a message ---
    print("\nSending a message...")
    page.fill("#msgInput", "Hello from Playwright test!")
    page.click("#sendBtn")
    page.wait_for_timeout(2000)

    new_count = page.evaluate("document.querySelectorAll('#chat .bubble').length")
    print(f"Bubbles after send: {new_count} (was {bubble_count})")

    scroll_after = page.evaluate("""() => {
        const c = document.getElementById('chat');
        return {
            scrollTop: Math.round(c.scrollTop),
            scrollHeight: c.scrollHeight,
            atBottom: Math.abs(c.scrollTop + c.clientHeight - c.scrollHeight) < 10
        }
    }""")
    print(f"Scroll after send: {scroll_after}")

    last_after = page.evaluate("""() => {
        const bubbles = document.querySelectorAll('#chat .bubble');
        if (!bubbles.length) return null;
        const last = bubbles[bubbles.length - 1];
        return (last.dataset.text || '').slice(0, 60)
    }""")
    print(f"Last bubble text after send: {last_after!r}")

    # --- Send another message to check the count-guard ---
    print("\nSending second message (tests lastMsgCount guard)...")
    page.fill("#msgInput", "Second message!")
    page.click("#sendBtn")
    page.wait_for_timeout(2000)

    final_count = page.evaluate("document.querySelectorAll('#chat .bubble').length")
    print(f"Bubbles after second send: {final_count} (expected {new_count + 1})")

    # --- Console errors ---
    print(f"\nConsole errors/warnings: {errors if errors else 'none'}")

    browser.close()
    print("\nDone.")
