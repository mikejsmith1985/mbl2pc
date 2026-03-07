## Version

**Current version:** `8e6cba1` (auto-updated from latest git commit)

## Requirements Explained

| Package           | Purpose                                                                 |
|-------------------|-------------------------------------------------------------------------|
| fastapi           | Web framework for building the backend API                               |
| uvicorn           | ASGI server to run FastAPI apps                                          |
| pydantic          | Data validation and settings management (used by FastAPI)                |
| starlette         | ASGI toolkit/framework (FastAPI is built on top of Starlette)            |
| python-multipart  | Handles file uploads (image upload support in FastAPI)                   |
| authlib           | OAuth client integration for Google login                                |
| httpx             | Async HTTP client (used by Authlib and for any HTTP requests)            |
| supabase          | Supabase Python client (database + file storage)                         |
| itsdangerous      | Secure session management (used by Starlette's SessionMiddleware)        |
| pytest            | Testing framework for Python (backend API tests)                         |

# mbl2pc

mbl2pc is a cloud-based chat app that lets you send text, images, and files from your phone to your PC (or vice versa) using a FastAPI backend, Google OAuth login, and Supabase (free PostgreSQL + file storage) for persistent, per-user chat history. The app is designed for free hosting on Render.com.

## Features
- Google OAuth login (secure, per-user chat)
- Send and receive text messages
- Upload and send images with optional captions
- Upload and send any file (PDF, doc, ZIP, etc.) — renders as a download card in chat
- Persistent chat history stored in Supabase (free PostgreSQL)
- Files and images stored in Supabase Storage (free)
- Modern responsive web UI with dark mode (works on mobile and desktop)
- Always-ready: keep-alive pinging prevents Render free-tier cold starts

## Prerequisites
- Python 3.12.3
- [Supabase](https://supabase.com) account (free, no credit card)
- Google Cloud project with OAuth 2.0 credentials
- (For deployment) Render.com account

## Supabase Setup (one-time)

1. Go to [supabase.com](https://supabase.com) → **New Project** (free tier)
2. In the **SQL Editor**, run this to create the messages table:
   ```sql
   CREATE TABLE messages (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     sender TEXT,
     text TEXT,
     image_url TEXT,
     file_url TEXT,
     file_name TEXT,
     timestamp TEXT,
     user_id TEXT
   );
   ```
3. Go to **Storage** → **New Bucket** → name it `mbl2pc-files` → set to **Public**
4. Go to **Project Settings** → **API** and copy:
   - **Project URL** → `SUPABASE_URL`
   - **service_role** secret key → `SUPABASE_SERVICE_KEY`

## Local Development
1. **Clone the repo:**
	```bash
	git clone https://github.com/mikejsmith1985/mbl2pc.git
	cd mbl2pc
	```
2. **Install dependencies:**
	```bash
	python3.12 -m venv .venv
	source .venv/bin/activate
	pip install -r requirements.txt
	```
3. **Set environment variables:**
	- `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`: from Google Cloud Console
	- `OAUTH_REDIRECT_URI`: e.g. `http://localhost:8000/auth` (for local dev)
	- `SESSION_SECRET_KEY`: any random string
	- `SUPABASE_URL`: your Supabase project URL
	- `SUPABASE_SERVICE_KEY`: your Supabase service_role key
	- `SUPABASE_STORAGE_BUCKET`: (optional, default: `mbl2pc-files`)
4. **Run the app:**
	```bash
	uvicorn main:app --reload
	```
5. **Open in browser:**
	- Go to `http://localhost:8000/send.html`

## Deployment (Render.com)
1. **Push your code to GitHub.**
2. **Create a new Web Service on Render.com:**
	- Environment: Python 3.12
	- Build Command: `pip install -r requirements.txt`
	- Start Command: `uvicorn main:app --host 0.0.0.0 --port 10000`
	- Set environment variables as above (use your Render.com URL for `OAUTH_REDIRECT_URI`)
	- Expose port 10000 (Render uses the `PORT` env var)
3. **Set environment variables on Render:**
	- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
	- `OAUTH_REDIRECT_URI`: your Render.com URL + `/auth` (e.g. `https://mbl2pc.onrender.com/auth`)
	- `SESSION_SECRET_KEY`: any long random string
	- `SUPABASE_URL`: your Supabase project URL
	- `SUPABASE_SERVICE_KEY`: your Supabase service_role key
	- `SUPABASE_STORAGE_BUCKET`: (optional, default: `mbl2pc-files`)
4. **Set up Google OAuth:**
	- In Google Cloud Console, set the authorized redirect URI to your Render.com URL (e.g. `https://your-app.onrender.com/auth`)
5. **Auto-deploy is already configured** — Render is connected to this repo and deploys automatically on every push to `main`. Just `git push` and Render handles the rest.

## Always-Ready: Keep-Alive with UptimeRobot (Free)

Render.com's free plan spins down your service after ~15 minutes of inactivity, causing 30–60 second cold starts. To prevent this, set up a free UptimeRobot monitor that pings your app every 5 minutes.

### Setup steps

1. Go to [uptimerobot.com](https://uptimerobot.com) and create a **free account**.
2. Click **+ Add New Monitor**.
3. Choose monitor type: **HTTP(s)**.
4. Set the following:
   - **Friendly Name**: `mbl2pc keep-alive`
   - **URL**: `https://your-app.onrender.com/health`  
     *(replace `your-app` with your actual Render service name)*
   - **Monitoring Interval**: **5 minutes**
5. Click **Create Monitor**.

That's it. UptimeRobot will ping `/health` every 5 minutes for free, keeping your Render service warm and eliminating cold start delays.

> **Note:** The free UptimeRobot plan includes up to 50 monitors with 5-minute intervals — more than enough for this use case.

## Usage
- Visit `/send.html` to access the chat UI.
- Log in with Google.
- Send text, image, or file messages from your phone or PC.
- Click the **device name** in the header to rename your device (saved in browser storage).
- Toggle **dark mode** with the moon/sun icon in the header.
- Messages are stored per user and persist across devices.
- The app version (git commit hash) is shown in the UI footer and at `/version`.

## API Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/send.html` | Chat UI (requires login) |
| GET | `/login` | Redirect to Google OAuth |
| GET | `/auth` | OAuth callback |
| GET | `/logout` | Clear session |
| GET | `/me` | Current user profile (name, email, picture) |
| GET | `/messages` | Retrieve last 100 messages for current user |
| POST | `/send` | Send a text message |
| POST | `/send-image` | Upload and send an image |
| POST | `/send-file` | Upload and send any file (max 25 MB) |
| GET | `/health` | Health check / keep-alive endpoint |
| GET | `/version` | App version (git commit hash) |

## Testing
- Backend: Run `pytest` to test API endpoints.
- Frontend: Playwright tests are included for public and error routes.

## File Structure
- `main.py` — FastAPI backend, OAuth, DynamoDB integration
- `static/send.html` — Chat UI (HTML/JS/CSS)
- `requirements.txt` — Python dependencies
- `render.yaml` — Render.com deployment config

## License
MIT
