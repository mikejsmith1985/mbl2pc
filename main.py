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
import shutil
from botocore.exceptions import NoCredentialsError

import boto3
import uuid
from botocore.exceptions import ClientError

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


DDB_TABLE = os.environ.get("MBL2PC_DDB_TABLE", "mbl2pc-messages")
DDB_REGION = os.environ.get("AWS_REGION", "us-east-1")
try:
    dynamodb = boto3.resource("dynamodb", region_name=DDB_REGION)
    table = dynamodb.Table(DDB_TABLE)
except Exception as e:
    print(f"[ERROR] Failed to initialize DynamoDB: {e}", file=sys.stderr)
    table = None

# S3 setup
S3_BUCKET = os.environ.get("S3_BUCKET", "mbl2pc-images")
s3 = boto3.client("s3", region_name=DDB_REGION)

# Ensure static/images directory exists
if not os.path.exists("static/images"):
    os.makedirs("static/images")

@app.get("/")
def read_root():
    return {"message": "Hello from mbl2pc!"}


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


# Text message endpoint (DynamoDB)
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
    message = Message(
        sender=sender,
        text=msg,
        image_url="",
        file_url="",
        file_name="",
        timestamp=datetime.now().isoformat(timespec="seconds"),
        user_id=user['sub']
    )
    item = {k: v for k, v in message.dict().items() if v != ""}
    item["id"] = str(uuid.uuid4())
    if not table:
        print("[ERROR] DynamoDB table is not initialized.", file=sys.stderr)
        raise HTTPException(status_code=500, detail="DynamoDB table is not initialized.")
    try:
        table.put_item(Item=item)
    except ClientError as e:
        print(f"[ERROR] DynamoDB error: {e}", file=sys.stderr)
        raise HTTPException(status_code=500, detail=f"DynamoDB error: {e}")
    except Exception as e:
        import traceback
        print(f"[ERROR] Unexpected error writing to DynamoDB: {e}", file=sys.stderr)
        traceback.print_exc(file=sys.stderr)
        raise HTTPException(status_code=500, detail=f"Unexpected error writing to DynamoDB: {e}")
    return {"status": "Message received"}


# Image upload endpoint with optional text (DynamoDB)
@app.post("/send-image")
async def send_image(
    request: Request,
    file: UploadFile = File(...),
    sender: str = Form(""),
    text: str = Form("")
):
    user = get_current_user(request)
    # Validate file
    if not file or not hasattr(file, "filename"):
        raise HTTPException(status_code=400, detail="No file uploaded.")
    filename = file.filename or ""
    ext = os.path.splitext(filename)[1].lower()
    if not ext:
        raise HTTPException(status_code=400, detail="File must have an extension (e.g. .jpg, .png)")
    if ext not in [".jpg", ".jpeg", ".png", ".gif", ".webp"]:
        raise HTTPException(status_code=400, detail="Unsupported file type.")
    fname = f"img_{datetime.now().strftime('%Y%m%d%H%M%S%f')}{ext}"
    # Upload to S3
    try:
        file.file.seek(0)
        s3.upload_fileobj(
            file.file,
            S3_BUCKET,
            fname,
            ExtraArgs={"ContentType": file.content_type}
        )
        image_url = f"https://{S3_BUCKET}.s3.amazonaws.com/{fname}"
    except NoCredentialsError:
        raise HTTPException(status_code=500, detail="AWS credentials not found for S3 upload.")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to upload image to S3: {e}")
    if not sender:
        sender = detect_device(request)
    message = Message(
        sender=sender,
        text=text,
        image_url=image_url,
        file_url="",
        file_name="",
        timestamp=datetime.now().isoformat(timespec="seconds"),
        user_id=user['sub']
    )
    item = {k: v for k, v in message.dict().items() if v != ""}
    item["id"] = str(uuid.uuid4())
    if not table:
        print("[ERROR] DynamoDB table is not initialized.", file=sys.stderr)
        raise HTTPException(status_code=500, detail="DynamoDB table is not initialized.")
    try:
        table.put_item(Item=item)
    except ClientError as e:
        print(f"[ERROR] DynamoDB error: {e}", file=sys.stderr)
        raise HTTPException(status_code=500, detail=f"DynamoDB error: {e}")
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
    ext = os.path.splitext(original_name)[1].lower()
    # Read file contents for size check
    contents = await file.read()
    if len(contents) > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail="File exceeds 25 MB limit.")
    safe_name = f"file_{datetime.now().strftime('%Y%m%d%H%M%S%f')}_{original_name}"
    content_type = file.content_type or "application/octet-stream"
    # Upload to S3 with Content-Disposition so browsers download rather than open
    try:
        import io
        s3.upload_fileobj(
            io.BytesIO(contents),
            S3_BUCKET,
            safe_name,
            ExtraArgs={
                "ContentType": content_type,
                "ContentDisposition": f'attachment; filename="{original_name}"'
            }
        )
        file_url = f"https://{S3_BUCKET}.s3.amazonaws.com/{safe_name}"
    except NoCredentialsError:
        raise HTTPException(status_code=500, detail="AWS credentials not found for S3 upload.")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to upload file to S3: {e}")
    if not sender:
        sender = detect_device(request)
    message = Message(
        sender=sender,
        text=text,
        image_url="",
        file_url=file_url,
        file_name=original_name,
        timestamp=datetime.now().isoformat(timespec="seconds"),
        user_id=user['sub']
    )
    item = {k: v for k, v in message.dict().items() if v != ""}
    item["id"] = str(uuid.uuid4())
    if not table:
        raise HTTPException(status_code=500, detail="DynamoDB table is not initialized.")
    try:
        table.put_item(Item=item)
    except ClientError as e:
        raise HTTPException(status_code=500, detail=f"DynamoDB error: {e}")
    return {"status": "File received", "file_url": file_url, "file_name": original_name}


# Retrieve messages for the current user from DynamoDB (sorted by timestamp descending, limit 100)
@app.get("/messages")
def get_messages(request: Request):
    user = get_current_user(request)
    if not table:
        print("[ERROR] DynamoDB table is not initialized.", file=sys.stderr)
        raise HTTPException(status_code=500, detail="DynamoDB table is not initialized.")
    try:
        resp = table.scan()
        items = resp.get("Items", [])
        # Filter by user_id
        items = [item for item in items if item.get("user_id") == user['sub']]
        # Sort by timestamp descending, then return most recent 100
        items.sort(key=lambda x: x.get("timestamp", ""), reverse=True)
        messages = [
            {k: v for k, v in item.items() if k in ["sender", "text", "image_url", "file_url", "file_name", "timestamp"]}
            for item in items[:100]
        ]
    except ClientError as e:
        print(f"[ERROR] DynamoDB error: {e}", file=sys.stderr)
        raise HTTPException(status_code=500, detail=f"DynamoDB error: {e}")
    return {"messages": messages[::-1]}  # Return in ascending order
