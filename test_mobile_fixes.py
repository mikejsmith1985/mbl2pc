"""Backend tests for the mobile/PWA fixes: SSE heartbeats, uncached HTML shell,
and Supabase-safe storage keys for awkward filenames."""

import base64
import json
import os
import re

import itsdangerous
from fastapi.testclient import TestClient

from main import app, _build_storage_key

client = TestClient(app)


def _build_session_cookie(user_id: str = "test-user-id") -> str:
    """Mint the Starlette session cookie the protected endpoints expect.

    Starlette signs a base64 JSON payload with a TimestampSigner, so the cookie
    has to be built the same way for the request to count as authenticated.
    """
    session_payload = {"user": {
        "sub": user_id,
        "email": "test@example.com",
        "name": "Test User",
        "picture": "",
    }}
    secret_key = os.environ.get("SESSION_SECRET_KEY", "change-this-key")
    signer = itsdangerous.TimestampSigner(secret_key)
    encoded_payload = base64.b64encode(json.dumps(session_payload).encode("utf-8"))
    return signer.sign(encoded_payload).decode("utf-8")


# ── SSE heartbeat ─────────────────────────────────────────────────────────────

def test_sse_keepalive_is_a_data_frame_not_a_comment():
    """EventSource hides ": comment" lines from the page, so a comment keepalive
    gives a resumed mobile app no way to tell a live stream from a dead one."""
    source = open("main.py", encoding="utf-8").read()
    generator_body = source.split("async def generator():")[1].split("return StreamingResponse")[0]

    assert '"type": "heartbeat"' in generator_body
    assert ": keepalive" not in generator_body


# ── HTML shell caching ────────────────────────────────────────────────────────

def test_send_html_is_served_with_no_store():
    """A cached HTML shell pins an iOS home-screen app to a stale JS bundle."""
    client.cookies.set("session", _build_session_cookie())
    response = client.get("/send.html")

    assert response.status_code == 200
    assert "no-store" in response.headers.get("cache-control", "")


def test_send_html_still_redirects_anonymous_visitors():
    """The caching change must not weaken the auth gate."""
    client.cookies.clear()
    response = client.get("/send.html", follow_redirects=False)

    assert response.status_code in (302, 307)
    assert "/login" in response.headers.get("location", "")


# ── Storage key sanitising ────────────────────────────────────────────────────

SAFE_KEY_PATTERN = re.compile(r"^[A-Za-z0-9._-]+$")


def test_storage_key_strips_spaces_and_parentheses():
    """iOS and Windows screenshots routinely carry both, and Supabase rejects them."""
    storage_key = _build_storage_key("file", "Screenshot 2026-08-28 at 14.02.11 (1).png")

    assert SAFE_KEY_PATTERN.match(storage_key)
    assert storage_key.endswith(".png")


def test_storage_key_strips_non_ascii_characters():
    storage_key = _build_storage_key("file", "reunião café 📎.pdf")

    assert SAFE_KEY_PATTERN.match(storage_key)
    assert storage_key.endswith(".pdf")


def test_storage_key_survives_a_filename_that_is_entirely_unsafe():
    storage_key = _build_storage_key("file", "🎬🎬🎬.mov")

    assert SAFE_KEY_PATTERN.match(storage_key)
    assert storage_key.endswith(".mov")


def test_storage_key_keeps_an_already_safe_name_recognisable():
    storage_key = _build_storage_key("file", "quarterly-report_v2.pdf")

    assert "quarterly-report_v2" in storage_key
    assert storage_key.startswith("file_")


def test_storage_key_truncates_an_absurdly_long_filename():
    storage_key = _build_storage_key("file", "a" * 500 + ".txt")

    assert len(storage_key) < 150
    assert storage_key.endswith(".txt")


def test_storage_keys_are_unique_across_identical_filenames():
    first_key  = _build_storage_key("file", "notes.txt")
    second_key = _build_storage_key("file", "notes.txt")

    assert first_key != second_key


def test_version_endpoint_is_not_cacheable():
    """The resume check polls /version; a cached copy would hide every deploy."""
    response = client.get("/version")

    assert response.status_code == 200
    assert "no-store" in response.headers.get("cache-control", "")
    assert "version" in response.json()
