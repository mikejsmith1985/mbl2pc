try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass  # Ignore if not available (e.g., in production)


# --- Google OAuth setup ---
import os
from fastapi import FastAPI, Request, UploadFile, File, Form, HTTPException, Depends, Response, BackgroundTasks
from starlette.requests import Request as StarletteRequest
from starlette.responses import RedirectResponse
from authlib.integrations.starlette_client import OAuth, OAuthError

import sys
GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID")
GOOGLE_CLIENT_SECRET = os.environ.get("GOOGLE_CLIENT_SECRET")
OAUTH_REDIRECT_URI = os.environ.get("OAUTH_REDIRECT_URI", "http://localhost:8000/auth")

missing_oauth_vars = []
if not GOOGLE_CLIENT_ID:
    missing_oauth_vars.append("GOOGLE_CLIENT_ID")
if not GOOGLE_CLIENT_SECRET:
    missing_oauth_vars.append("GOOGLE_CLIENT_SECRET")
if not OAUTH_REDIRECT_URI:
    missing_oauth_vars.append("OAUTH_REDIRECT_URI")
if missing_oauth_vars:
    print(f"[ERROR] Missing OAuth environment variables: {', '.join(missing_oauth_vars)}", file=sys.stderr)
    oauth = None
else:
    oauth = OAuth()
    oauth.register(
        name='google',
        client_id=GOOGLE_CLIENT_ID,
        client_secret=GOOGLE_CLIENT_SECRET,
        server_metadata_url='https://accounts.google.com/.well-known/openid-configuration',
        client_kwargs={
            'scope': 'openid email profile',
        }
    )


def get_current_user(request: Request):
    try:
        user = request.session.get('user')
    except Exception as e:
        import traceback
        print(f"[ERROR] Exception accessing session: {e}", file=sys.stderr)
        traceback.print_exc(file=sys.stderr)
        raise HTTPException(status_code=500, detail="Internal server error accessing session.")
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated: session missing or expired.")
    if not isinstance(user, dict) or 'sub' not in user:
        raise HTTPException(status_code=401, detail="Not authenticated: session user invalid.")
    return user


from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from datetime import datetime
import uuid

from starlette.middleware.sessions import SessionMiddleware
app = FastAPI()
app.add_middleware(SessionMiddleware, secret_key=os.environ.get("SESSION_SECRET_KEY", "change-this-key"))


# ── Auto-migration on startup ──────────────────────────────────────────────────
MIGRATIONS = [
    "ALTER TABLE messages ADD COLUMN IF NOT EXISTS starred BOOLEAN DEFAULT FALSE",
    "ALTER TABLE messages ADD COLUMN IF NOT EXISTS expires_at TEXT DEFAULT NULL",
    """CREATE TABLE IF NOT EXISTS snippets (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
    )""",
    """CREATE TABLE IF NOT EXISTS clipboard (
        user_id TEXT PRIMARY KEY,
        content TEXT NOT NULL DEFAULT '',
        updated_at TIMESTAMPTZ DEFAULT NOW()
    )""",
]

@app.on_event("startup")
def run_migrations():
    db_url = os.environ.get("DATABASE_URL", "")
    if not db_url:
        print("[INFO] DATABASE_URL not set — skipping auto-migration. Add it to run schema changes automatically.", file=sys.stderr)
        return
    try:
        import psycopg2
        # psycopg2 needs postgresql:// not postgres://
        conn_str = db_url.replace("postgres://", "postgresql://", 1)
        conn = psycopg2.connect(conn_str)
        conn.autocommit = True
        cur = conn.cursor()
        for sql in MIGRATIONS:
            try:
                cur.execute(sql)
                print(f"[MIGRATION] OK: {sql[:60]}…", file=sys.stderr)
            except Exception as e:
                print(f"[MIGRATION] Skipped ({e}): {sql[:60]}…", file=sys.stderr)
        cur.close()
        conn.close()
        print("[MIGRATION] All done.", file=sys.stderr)
    except ImportError:
        print("[WARN] psycopg2 not installed — cannot run auto-migration.", file=sys.stderr)
    except Exception as e:
        print(f"[WARN] Auto-migration failed (non-fatal): {e}", file=sys.stderr)


# ── SSE connection manager ──────────────────────────────────────────────────────
import asyncio
import json
from typing import Dict, List
from fastapi.responses import StreamingResponse

class SSEManager:
    def __init__(self):
        self.queues: Dict[str, List[asyncio.Queue]] = {}

    def subscribe(self, user_id: str) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue()
        self.queues.setdefault(user_id, []).append(q)
        return q

    def unsubscribe(self, user_id: str, q: asyncio.Queue):
        qs = self.queues.get(user_id, [])
        if q in qs:
            qs.remove(q)

    async def push(self, user_id: str, data: dict):
        payload = json.dumps(data)
        for q in list(self.queues.get(user_id, [])):
            await q.put(payload)

sse_manager = SSEManager()


@app.get("/events")
async def sse_events(request: Request):
    user = request.session.get('user')
    if not user or not isinstance(user, dict) or 'sub' not in user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    user_id = user['sub']
    q = sse_manager.subscribe(user_id)

    async def generator():
        try:
            while True:
                try:
                    data = await asyncio.wait_for(q.get(), timeout=25.0)
                    yield f"data: {data}\n\n"
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
        except GeneratorExit:
            pass
        finally:
            sse_manager.unsubscribe(user_id, q)

    return StreamingResponse(generator(), media_type="text/event-stream", headers={
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
    })


# Expose git commit hash as version
import subprocess
def get_git_version():
    try:
        return subprocess.check_output(["git", "rev-parse", "--short", "HEAD"]).decode("utf-8").strip()
    except Exception:
        return "unknown"

APP_VERSION = get_git_version()

# Version endpoint
@app.get("/version")
def version():
    return {"version": APP_VERSION}

# Health check endpoint (used by Render and UptimeRobot keep-alive pings)
@app.get("/health")
def health():
    return {"status": "ok"}

# CORS: wildcard origin is incompatible with allow_credentials=True (Starlette raises
# ValueError on startup). The app's frontend is same-origin so credentials are not
# needed for cross-origin CORS requests.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve static files (send.html) from /static
if not os.path.exists("static"):
    os.mkdir("static")
app.mount("/static", StaticFiles(directory="static"), name="static")

# Serve the service worker at the root so its scope covers the whole origin
@app.get("/sw.js")
def serve_sw():
    from fastapi.responses import FileResponse as FR
    return FR("static/sw.js", media_type="application/javascript")

# Route for /send.html to serve the chat UI
@app.get("/send.html")
def serve_send_html(request: Request):
    # If not logged in, redirect to login
    if not request.session.get('user'):
        return RedirectResponse('/login')
    return FileResponse("static/send.html")

# Google OAuth login
@app.get('/login')
async def login(request: Request):
    if not oauth or not hasattr(oauth, 'google'):
        print("[ERROR] OAuth is not configured properly.", file=sys.stderr)
        raise HTTPException(status_code=500, detail="OAuth is not configured properly.")
    redirect_uri = OAUTH_REDIRECT_URI
    return await oauth.google.authorize_redirect(request, redirect_uri)

# Google OAuth callback
@app.route('/auth')
async def auth(request: Request):
    if not oauth or not hasattr(oauth, 'google'):
        print("[ERROR] OAuth is not configured properly.", file=sys.stderr)
        raise HTTPException(status_code=500, detail="OAuth is not configured properly.")
    import traceback
    try:
        token = await oauth.google.authorize_access_token(request)
        print(f"[DEBUG] OAuth token response: {token}", file=sys.stderr)
        user = token.get("userinfo")
    except Exception as e:
        print(f"[ERROR] OAuth authentication failed: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
        return RedirectResponse('/login')
    if not user:
        raise HTTPException(status_code=401, detail="Failed to authenticate user.")
    request.session['user'] = {
        'sub': user['sub'],
        'email': user.get('email'),
        'name': user.get('name'),
        'picture': user.get('picture')
    }
    print("[DEBUG] Session user set:", request.session['user'])
    return RedirectResponse('/send.html')

# Logout
@app.get('/logout')
def logout(request: Request):
    request.session.clear()
    return RedirectResponse('/login')

# Current user profile (for UI avatar/name display)
@app.get('/me')
def me(request: Request):
    user = get_current_user(request)
    return {
        'sub': user.get('sub', ''),
        'name': user.get('name', ''),
        'email': user.get('email', ''),
        'picture': user.get('picture', '')
    }


class Message(BaseModel):
    sender: str
    text: str = ""
    image_url: str = ""
    file_url: str = ""
    file_name: str = ""
    timestamp: str
    user_id: str


# ── Supabase setup ─────────────────────────────────────────────────────────────
from supabase import create_client, Client as SupabaseClient

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")
SUPABASE_STORAGE_BUCKET = os.environ.get("SUPABASE_STORAGE_BUCKET", "mbl2pc-files")

supabase: SupabaseClient | None = None
if SUPABASE_URL and SUPABASE_SERVICE_KEY:
    try:
        supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
        print("[INFO] Supabase client initialized.", file=sys.stderr)
    except Exception as e:
        print(f"[ERROR] Failed to initialize Supabase: {e}", file=sys.stderr)
else:
    print("[ERROR] Missing SUPABASE_URL or SUPABASE_SERVICE_KEY", file=sys.stderr)

# Ensure static/images directory exists
if not os.path.exists("static/images"):
    os.makedirs("static/images")

@app.get("/")
def read_root():
    return RedirectResponse('/send.html')


def detect_device(request: Request) -> str:
    """Detect device type from User-Agent string."""
    ua = request.headers.get("user-agent", "")
    if "iPad" in ua:
        return "iPad"
    if "iPhone" in ua:
        return "iPhone"
    if "Android" in ua:
        return "Android"
    if "CrOS" in ua:
        return "Chromebook"
    if "Macintosh" in ua or "Mac OS X" in ua:
        return "Mac"
    if "Windows" in ua:
        return "PC"
    if "Linux" in ua:
        return "Linux"
    return "unknown"


def _supabase_insert(item: dict):
    """Insert a message row into Supabase. Raises HTTPException on failure."""
    if not supabase:
        raise HTTPException(status_code=500, detail="Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_KEY.")
    try:
        supabase.table("messages").insert(item).execute()
    except Exception as e:
        err = str(e)
        # If insert failed due to a missing column, retry without optional columns
        optional_cols = ['expires_at', 'starred']
        if any(col in err for col in optional_cols):
            print(f"[WARN] Column missing, retrying insert without optional cols: {e}", file=sys.stderr)
            safe_item = {k: v for k, v in item.items() if k not in optional_cols}
            try:
                supabase.table("messages").insert(safe_item).execute()
                return
            except Exception as e2:
                print(f"[ERROR] Supabase insert retry error: {e2}", file=sys.stderr)
                raise HTTPException(status_code=500, detail=f"Database error: {e2}")
        print(f"[ERROR] Supabase insert error: {e}", file=sys.stderr)
        raise HTTPException(status_code=500, detail=f"Database error: {e}")


def _upload_to_supabase(contents: bytes, path: str, content_type: str) -> str:
    """Upload bytes to Supabase Storage and return the public URL."""
    if not supabase:
        raise HTTPException(status_code=500, detail="Supabase is not configured.")
    try:
        resp = supabase.storage.from_(SUPABASE_STORAGE_BUCKET).upload(
            path,
            contents,
            {"content-type": content_type, "content_type": content_type, "upsert": False}
        )
        # supabase-py v2 raises StorageException on error; check for error in response too
        if hasattr(resp, 'error') and resp.error:
            raise Exception(str(resp.error))
        url_resp = supabase.storage.from_(SUPABASE_STORAGE_BUCKET).get_public_url(path)
        # supabase-py v2+ returns PublicUrlResponse(publicUrl=...) instead of a plain string
        if hasattr(url_resp, 'public_url'):
            return url_resp.public_url
        return url_resp
    except HTTPException:
        raise
    except Exception as e:
        print(f"[ERROR] Supabase storage upload error (bucket={SUPABASE_STORAGE_BUCKET}, path={path}): {e}", file=sys.stderr)
        raise HTTPException(status_code=500, detail=f"File upload error: {e}")


# Text message endpoint
@app.post("/send")
async def send_message(request: Request, background_tasks: BackgroundTasks, msg: str = Form(""), sender: str = Form(""), expires_hours: int = Form(0)):
    try:
        user = get_current_user(request)
    except HTTPException as e:
        raise e
    except Exception as e:
        import traceback
        print(f"[ERROR] Unexpected error in get_current_user: {e}", file=sys.stderr)
        traceback.print_exc(file=sys.stderr)
        raise HTTPException(status_code=500, detail="Internal error authenticating user.")
    if not sender:
        sender = detect_device(request)
    item = {
        "id": str(uuid.uuid4()),
        "sender": sender,
        "text": msg,
        "timestamp": datetime.now().isoformat(timespec="seconds"),
        "user_id": user['sub']
    }
    if expires_hours > 0:
        from datetime import timedelta
        item["expires_at"] = (datetime.now() + timedelta(hours=expires_hours)).isoformat(timespec="seconds")
    _supabase_insert(item)

    # Forward to Forge Terminal if configured so the agent can receive replies
    if FORGE_INBOUND_URL and WEBHOOK_SECRET and msg.strip():
        background_tasks.add_task(_forward_to_forge, msg, sender)

    await sse_manager.push(user['sub'], {"type": "new_message"})
    return {"status": "Message received"}


# Image upload endpoint with optional text
@app.post("/send-image")
async def send_image(
    request: Request,
    file: UploadFile = File(...),
    sender: str = Form(""),
    text: str = Form("")
):
    user = get_current_user(request)
    if not file or not hasattr(file, "filename"):
        raise HTTPException(status_code=400, detail="No file uploaded.")
    filename = file.filename or ""
    ext = os.path.splitext(filename)[1].lower()
    if not ext:
        raise HTTPException(status_code=400, detail="File must have an extension (e.g. .jpg, .png)")
    if ext not in [".jpg", ".jpeg", ".png", ".gif", ".webp"]:
        raise HTTPException(status_code=400, detail="Unsupported file type.")
    contents = await file.read()
    fname = f"img_{datetime.now().strftime('%Y%m%d%H%M%S%f')}{ext}"
    image_url = _upload_to_supabase(contents, fname, file.content_type or "image/jpeg")
    if not sender:
        sender = detect_device(request)
    item = {
        "id": str(uuid.uuid4()),
        "sender": sender,
        "text": text,
        "image_url": image_url,
        "timestamp": datetime.now().isoformat(timespec="seconds"),
        "user_id": user['sub']
    }
    _supabase_insert(item)
    await sse_manager.push(user['sub'], {"type": "new_message"})
    return {"status": "Image received", "image_url": image_url}


# General file upload endpoint (any file type)
MAX_FILE_SIZE = 25 * 1024 * 1024  # 25 MB

@app.post("/send-file")
async def send_file(
    request: Request,
    file: UploadFile = File(...),
    sender: str = Form(""),
    text: str = Form("")
):
    user = get_current_user(request)
    if not file or not hasattr(file, "filename") or not file.filename:
        raise HTTPException(status_code=400, detail="No file uploaded.")
    original_name = file.filename
    contents = await file.read()
    if len(contents) > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail="File exceeds 25 MB limit.")
    safe_name = f"file_{datetime.now().strftime('%Y%m%d%H%M%S%f')}_{original_name}"
    content_type = file.content_type or "application/octet-stream"
    file_url = _upload_to_supabase(contents, safe_name, content_type)
    if not sender:
        sender = detect_device(request)
    item = {
        "id": str(uuid.uuid4()),
        "sender": sender,
        "text": text,
        "file_url": file_url,
        "file_name": original_name,
        "timestamp": datetime.now().isoformat(timespec="seconds"),
        "user_id": user['sub']
    }
    _supabase_insert(item)
    await sse_manager.push(user['sub'], {"type": "new_message"})
    return {"status": "File received", "file_url": file_url, "file_name": original_name}


# Storage diagnostics endpoint — returns detailed Supabase storage status
@app.get("/storage-test")
def storage_test(request: Request):
    get_current_user(request)  # require login
    if not supabase:
        return {"ok": False, "error": "Supabase client not initialised (check SUPABASE_URL and SUPABASE_SERVICE_KEY env vars)"}
    results = {}
    # 1. List buckets
    try:
        buckets = supabase.storage.list_buckets()
        results["buckets"] = [getattr(b, "name", str(b)) for b in (buckets or [])]
    except Exception as e:
        results["buckets_error"] = str(e)
    # 2. Try a tiny upload
    test_path = f"_test_{datetime.now().strftime('%Y%m%d%H%M%S%f')}.txt"
    try:
        resp = supabase.storage.from_(SUPABASE_STORAGE_BUCKET).upload(
            test_path, b"ok", {"content-type": "text/plain", "upsert": False}
        )
        results["upload"] = "ok"
        # clean up
        try:
            supabase.storage.from_(SUPABASE_STORAGE_BUCKET).remove([test_path])
        except Exception:
            pass
    except Exception as e:
        results["upload_error"] = str(e)
    results["bucket_name"] = SUPABASE_STORAGE_BUCKET
    results["supabase_url"] = SUPABASE_URL[:40] + "…" if len(SUPABASE_URL) > 40 else SUPABASE_URL
    results["service_key_prefix"] = SUPABASE_SERVICE_KEY[:20] + "…" if SUPABASE_SERVICE_KEY else "NOT SET"
    return results


# Retrieve messages for the current user from Supabase
@app.get("/messages")
def get_messages(request: Request, q: str = "", date: str = "", last: int = 0):
    user = get_current_user(request)
    if not supabase:
        raise HTTPException(status_code=500, detail="Supabase is not configured.")

    def _run_query(include_optional: bool):
        cols = "id,sender,text,image_url,file_url,file_name,timestamp"
        if include_optional:
            cols += ",starred,expires_at"
        # `last` path: fetch N most-recent rows (separate from default logic)
        if last > 0:
            return (
                supabase.table("messages")
                .select(cols)
                .eq("user_id", user['sub'])
                .order("timestamp", desc=True)
                .limit(last)
                .execute()
            )
        # Fetch newest 100 DESC then reverse — so users with >100 messages
        # always see the most recent ones, not the oldest ones.
        query = (
            supabase.table("messages")
            .select(cols)
            .eq("user_id", user['sub'])
            .order("timestamp", desc=True)
        )
        if q:
            query = query.ilike("text", f"%{q}%")
        elif date:
            # Filter to a specific calendar date (YYYY-MM-DD)
            query = query.gte("timestamp", f"{date}T00:00:00").lt("timestamp", f"{date}T23:59:59")
        else:
            query = query.limit(100)
        result = query.execute()
        result.data.reverse()
        return result

    try:
        resp = _run_query(include_optional=True)
    except Exception as e:
        err = str(e)
        if 'starred' in err or 'expires_at' in err:
            print(f"[WARN] Optional columns missing, falling back: {e}", file=sys.stderr)
            try:
                resp = _run_query(include_optional=False)
            except Exception as e2:
                print(f"[ERROR] Supabase query error: {e2}", file=sys.stderr)
                raise HTTPException(status_code=500, detail=f"Database error: {e2}")
        else:
            print(f"[ERROR] Supabase query error: {e}", file=sys.stderr)
            raise HTTPException(status_code=500, detail=f"Database error: {e}")

    now = datetime.now().isoformat()
    messages = []
    for m in resp.data:
        ea = m.get('expires_at')
        if ea and ea <= now:
            continue  # skip expired
        messages.append({
            'id': m.get('id', ''),
            'sender': m.get('sender', ''),
            'text': m.get('text') or '',
            'image_url': m.get('image_url') or '',
            'file_url': m.get('file_url') or '',
            'file_name': m.get('file_name') or '',
            'timestamp': m.get('timestamp', ''),
            'starred': bool(m.get('starred', False)),
        })
    # Results were fetched DESC when using `last`; restore chronological order
    if last > 0:
        messages.reverse()
    has_more = last > 0 and len(messages) >= last
    from fastapi.responses import JSONResponse
    return JSONResponse(
        content={"messages": messages, "has_more": has_more},
        headers={"Cache-Control": "no-store"},
    )


# Toggle star on a message
@app.patch("/messages/{msg_id}/star")
def star_message(msg_id: str, request: Request):
    user = get_current_user(request)
    if not supabase:
        raise HTTPException(status_code=500, detail="Supabase is not configured.")
    try:
        resp = supabase.table("messages").select("starred").eq("id", msg_id).eq("user_id", user['sub']).execute()
        if not resp.data:
            raise HTTPException(status_code=404, detail="Message not found.")
        current = bool(resp.data[0].get('starred', False))
        supabase.table("messages").update({"starred": not current}).eq("id", msg_id).eq("user_id", user['sub']).execute()
        return {"starred": not current}
    except HTTPException:
        raise
    except Exception as e:
        if 'starred' in str(e):
            raise HTTPException(status_code=503, detail="Run the Supabase migration to enable starring (see supabase_migration.sql)")
        raise HTTPException(status_code=500, detail=f"Database error: {e}")


# Delete a message
@app.delete("/messages/{msg_id}")
def delete_message(msg_id: str, request: Request):
    user = get_current_user(request)
    if not supabase:
        raise HTTPException(status_code=500, detail="Supabase is not configured.")
    try:
        supabase.table("messages").delete().eq("id", msg_id).eq("user_id", user['sub']).execute()
        return {"status": "deleted"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {e}")


# Snippets: list
@app.get("/snippets")
def get_snippets(request: Request):
    user = get_current_user(request)
    if not supabase:
        raise HTTPException(status_code=500, detail="Supabase is not configured.")
    try:
        resp = supabase.table("snippets").select("id,name,content,created_at").eq("user_id", user['sub']).order("created_at").execute()
        return {"snippets": resp.data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {e}")


# Snippets: create
@app.post("/snippets")
async def add_snippet(request: Request, name: str = Form(""), content: str = Form("")):
    user = get_current_user(request)
    if not supabase:
        raise HTTPException(status_code=500, detail="Supabase is not configured.")
    if not name.strip() or not content.strip():
        raise HTTPException(status_code=400, detail="Name and content are required.")
    try:
        resp = supabase.table("snippets").insert({"user_id": user['sub'], "name": name.strip(), "content": content.strip()}).execute()
        return {"snippet": resp.data[0] if resp.data else {}}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {e}")


# Snippets: delete
@app.delete("/snippets/{snippet_id}")
def delete_snippet(snippet_id: str, request: Request):
    user = get_current_user(request)
    if not supabase:
        raise HTTPException(status_code=500, detail="Supabase is not configured.")
    try:
        supabase.table("snippets").delete().eq("id", snippet_id).eq("user_id", user['sub']).execute()
        return {"status": "deleted"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {e}")


# ── Clipboard Sync ──────────────────────────────────────────────────────────────

@app.get("/clipboard")
def get_clipboard(request: Request):
    """Return the latest synced clipboard content for the current user."""
    user = get_current_user(request)
    if not supabase:
        raise HTTPException(status_code=500, detail="Supabase is not configured.")
    try:
        resp = supabase.table("clipboard").select("content,updated_at").eq("user_id", user['sub']).execute()
        if not resp.data:
            return {"content": "", "updated_at": None}
        row = resp.data[0]
        return {"content": row.get("content", ""), "updated_at": row.get("updated_at")}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {e}")


@app.post("/clipboard")
async def set_clipboard(request: Request, content: str = Form("")):
    """Upsert clipboard content for the current user."""
    user = get_current_user(request)
    if not supabase:
        raise HTTPException(status_code=500, detail="Supabase is not configured.")
    try:
        supabase.table("clipboard").upsert({
            "user_id": user['sub'],
            "content": content,
            "updated_at": datetime.now().isoformat(timespec="seconds"),
        }, on_conflict="user_id").execute()
        await sse_manager.push(user['sub'], {"type": "clipboard_update"})
        return {"status": "ok"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {e}")


def _forward_to_forge(msg: str, sender: str):
    """Send a copy of the user's message to Forge Terminal (background task)."""
    try:
        import httpx
        httpx.post(
            f"{FORGE_INBOUND_URL}/api/notify/inbound",
            json={"text": msg, "sender": sender, "token": WEBHOOK_SECRET},
            timeout=4,
        )
    except Exception as e:
        print(f"[WARN] Could not forward message to Forge: {e}", file=sys.stderr)


# ── Server-to-server Webhook (no OAuth required) ────────────────────────────────
# Used by external tools (e.g. Forge Terminal) to deliver notifications.
# Set WEBHOOK_SECRET and WEBHOOK_USER_ID environment variables on Render.

WEBHOOK_SECRET = os.environ.get("WEBHOOK_SECRET", "")
WEBHOOK_USER_ID = os.environ.get("WEBHOOK_USER_ID", "")  # Google 'sub' of the target user

# When set, every message the user sends via the UI is forwarded to this URL so
# Forge Terminal can receive replies without polling MBL2PC.
# Example: FORGE_INBOUND_URL=http://192.168.1.100:8080
FORGE_INBOUND_URL = os.environ.get("FORGE_INBOUND_URL", "").rstrip("/")


class WebhookPayload(BaseModel):
    text: str
    token: str
    sender: str = "Forge Terminal"


@app.post("/webhook")
async def webhook_notify(payload: WebhookPayload):
    """
    Receive a notification from a trusted server-side caller (e.g. Forge Terminal).
    Inserts a message into Supabase and sends a Web Push to all registered devices
    for WEBHOOK_USER_ID.

    Requires:
      - WEBHOOK_SECRET env var set (token must match)
      - WEBHOOK_USER_ID env var set (target user's Google sub)
      - Supabase configured
    """
    if not WEBHOOK_SECRET:
        raise HTTPException(status_code=503, detail="Webhook not configured on server (missing WEBHOOK_SECRET).")
    if not WEBHOOK_USER_ID:
        raise HTTPException(status_code=503, detail="Webhook not configured on server (missing WEBHOOK_USER_ID).")
    if payload.token != WEBHOOK_SECRET:
        raise HTTPException(status_code=401, detail="Unauthorized: invalid token.")
    if not supabase:
        raise HTTPException(status_code=503, detail="Supabase is not configured.")

    text = (payload.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="text is required.")

    # Insert message into Supabase as the target user
    try:
        supabase.table("messages").insert({
            "id": str(uuid.uuid4()),
            "sender": payload.sender,
            "text": text,
            "timestamp": datetime.utcnow().isoformat(),
            "user_id": WEBHOOK_USER_ID,
        }).execute()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {e}")

    # Notify connected clients via SSE
    await sse_manager.push(WEBHOOK_USER_ID, {"type": "new_message"})

    return {"status": "delivered"}


# ── Polling fallback: Forge Terminal reads recent user messages ──────────────
# Forge calls this when FORGE_INBOUND_URL is not set (or as a fallback).
# Protected by the same WEBHOOK_SECRET so no OAuth is needed.

@app.get("/messages/recent")
def messages_recent(token: str = "", since: str = ""):
    """
    Return messages sent by the user (not by Forge Terminal) since `since` (ISO timestamp).
    Requires `token` query param equal to WEBHOOK_SECRET.
    Used by Forge Terminal to poll for replies without needing OAuth.
    """
    if not WEBHOOK_SECRET or token != WEBHOOK_SECRET:
        raise HTTPException(status_code=401, detail="Unauthorized.")
    if not WEBHOOK_USER_ID:
        raise HTTPException(status_code=503, detail="WEBHOOK_USER_ID not configured.")
    if not supabase:
        raise HTTPException(status_code=503, detail="Supabase not configured.")

    since_ts = since or "1970-01-01T00:00:00"
    try:
        resp = (
            supabase.table("messages")
            .select("id,sender,text,timestamp")
            .eq("user_id", WEBHOOK_USER_ID)
            .neq("sender", "Forge Terminal")
            .gt("timestamp", since_ts)
            .order("timestamp", desc=False)
            .limit(20)
            .execute()
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {e}")

    return {"messages": resp.data or []}
