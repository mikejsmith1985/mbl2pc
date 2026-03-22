"""
Local test server — no Supabase or Google auth needed.
Serves the real send.html with a fake /messages, /send, /me, /version, /ws, etc.
Uses in-memory message store so you can test send/receive live.

Run:  python test_local.py
Open: http://localhost:8765/send.html
"""
import uuid, json, asyncio
from datetime import datetime
from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect, Form
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.sessions import SessionMiddleware

app = FastAPI()
app.add_middleware(SessionMiddleware, secret_key="test-secret")

# ── In-memory message store ────────────────────────────────────────────────────
messages: list[dict] = []

# Pre-populate with messages spread across time so we can test scroll
for i in range(12):
    messages.append({
        "id": str(uuid.uuid4()),
        "sender": "TestDevice" if i % 3 != 0 else "OtherPC",
        "text": f"Test message #{i+1} — {'hello ' * ((i % 4) + 1)}",
        "image_url": "",
        "file_url": "",
        "file_name": "",
        "timestamp": f"2026-03-{16 + i//4:02d}T{10 + i:02d}:00:00",
        "starred": False,
    })

# Active WebSocket clients
ws_clients: list[WebSocket] = []

# ── Auto-login: inject a fake session ─────────────────────────────────────────
@app.middleware("http")
async def auto_login(request: Request, call_next):
    response = await call_next(request)
    return response

# Override get_current_user to always return a test user by monkey-patching at route level
FAKE_USER = {"sub": "test-user-123", "email": "test@local.dev", "name": "Test User"}

# ── API endpoints ──────────────────────────────────────────────────────────────
@app.get("/me")
def me(request: Request):
    return {"email": "test@local.dev", "name": "Test User"}

@app.get("/version")
def version():
    return {"version": "local-test"}

@app.get("/health")
def health():
    return {"status": "ok"}

@app.get("/messages")
def get_messages(q: str = "", date: str = "", last: int = 0):
    msgs = list(messages)
    if q:
        msgs = [m for m in msgs if q.lower() in (m.get("text") or "").lower()]
    elif date:
        msgs = [m for m in msgs if m["timestamp"].startswith(date)]
    elif last > 0:
        msgs = msgs[-last:]
        return {"messages": msgs, "has_more": len(messages) > last}
    else:
        msgs = msgs[-100:]
    return {"messages": msgs, "has_more": False}

@app.post("/send")
async def send_message(request: Request, msg: str = Form(""), sender: str = Form("TestDevice")):
    m = {
        "id": str(uuid.uuid4()),
        "sender": sender or "TestDevice",
        "text": msg,
        "image_url": "",
        "file_url": "",
        "file_name": "",
        "timestamp": datetime.now().strftime("%Y-%m-%dT%H:%M:%S"),
        "starred": False,
    }
    messages.append(m)
    # Broadcast to all WS clients
    dead = []
    for ws in ws_clients:
        try:
            await ws.send_text(json.dumps({"type": "new_message"}))
        except Exception:
            dead.append(ws)
    for ws in dead:
        ws_clients.remove(ws)
    return {"status": "Message received"}

@app.patch("/messages/{msg_id}/star")
def star(msg_id: str):
    for m in messages:
        if m["id"] == msg_id:
            m["starred"] = not m["starred"]
            return {"starred": m["starred"]}
    return JSONResponse({"error": "not found"}, 404)

@app.delete("/messages/{msg_id}")
def delete(msg_id: str):
    global messages
    messages = [m for m in messages if m["id"] != msg_id]
    return {"status": "deleted"}

@app.get("/snippets")
def get_snippets():
    return {"snippets": []}

@app.get("/clipboard")
def get_clipboard():
    return {"content": "", "updated_at": None}

@app.post("/clipboard")
def set_clipboard():
    return {"status": "ok"}

@app.get("/push/vapid-public-key")
def vapid():
    return {"key": ""}

@app.websocket("/ws")
async def ws_endpoint(websocket: WebSocket):
    await websocket.accept()
    ws_clients.append(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        ws_clients.remove(websocket)

# Serve static files
app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/send.html")
def send_html():
    with open("static/send.html", encoding="utf-8") as f:
        return HTMLResponse(f.read())

# ── Run ────────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    print("\n✅  Test server running at http://localhost:8765/send.html\n")
    uvicorn.run(app, host="127.0.0.1", port=8765)
