try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass  # Ignore if not available (e.g., in production)


# --- Google OAuth setup ---
import os
from fastapi import FastAPI, Request, UploadFile, File, Form, HTTPException, Depends, Response
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

# Allow all CORS for testing (so your phone can access it)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve static files (send.html) from /static
if not os.path.exists("static"):
    os.mkdir("static")
app.mount("/static", StaticFiles(directory="static"), name="static")

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
        print(f"[ERROR] Supabase insert error: {e}", file=sys.stderr)
        raise HTTPException(status_code=500, detail=f"Database error: {e}")


def _upload_to_supabase(contents: bytes, path: str, content_type: str) -> str:
    """Upload bytes to Supabase Storage and return the public URL."""
    if not supabase:
        raise HTTPException(status_code=500, detail="Supabase is not configured.")
    try:
        supabase.storage.from_(SUPABASE_STORAGE_BUCKET).upload(
            path,
            contents,
            {"content-type": content_type, "upsert": "false"}
        )
        url_resp = supabase.storage.from_(SUPABASE_STORAGE_BUCKET).get_public_url(path)
        return url_resp
    except Exception as e:
        print(f"[ERROR] Supabase storage upload error: {e}", file=sys.stderr)
        raise HTTPException(status_code=500, detail=f"File upload error: {e}")


# Text message endpoint
@app.post("/send")
async def send_message(request: Request, msg: str = Form(""), sender: str = Form("")):
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
    _supabase_insert(item)
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
    return {"status": "File received", "file_url": file_url, "file_name": original_name}


# Retrieve messages for the current user from Supabase (last 100, ascending order)
@app.get("/messages")
def get_messages(request: Request):
    user = get_current_user(request)
    if not supabase:
        raise HTTPException(status_code=500, detail="Supabase is not configured.")
    try:
        resp = (
            supabase.table("messages")
            .select("sender,text,image_url,file_url,file_name,timestamp")
            .eq("user_id", user['sub'])
            .order("timestamp", desc=False)
            .limit(100)
            .execute()
        )
        return {"messages": resp.data}
    except Exception as e:
        print(f"[ERROR] Supabase query error: {e}", file=sys.stderr)
        raise HTTPException(status_code=500, detail=f"Database error: {e}")
