"""Tests for the keepalive heartbeat that keeps BOTH free-tier hosting
dependencies alive: Render's web service and the Supabase database project."""

from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

import main
from main import app, KEEPALIVE_PATH, KEEPALIVE_INTERVAL_SECONDS, RENDER_SPIN_DOWN_SECONDS

# Render's own liveness probe, declared as `healthCheckPath` in render.yaml.
RENDER_HEALTH_CHECK_PATH = "/health"

client = TestClient(app)


@pytest.fixture
def mock_supabase_client(monkeypatch):
    """Swaps in a fake Supabase client so these tests never reach a live database."""
    fake_client = MagicMock()
    monkeypatch.setattr(main, "supabase", fake_client)
    return fake_client


def test_keepalive_issues_a_database_query(mock_supabase_client):
    """The whole point of this endpoint: prove it generates real database activity.

    Supabase pauses a free project after 7 days without database queries, so a
    heartbeat that does not query the database is worthless for that purpose.
    """
    response = client.get(KEEPALIVE_PATH)

    assert response.status_code == 200
    assert response.json()["database"] == "reachable"
    mock_supabase_client.table.assert_called_once_with("messages")


def test_health_check_does_not_touch_the_database(mock_supabase_client):
    """Regression guard for the original outage.

    Render polls /health constantly. If that probe ever started depending on the
    database, a database blip would make Render believe the web service itself
    had died and restart it. /health must stay dependency-free — which is exactly
    why it could not double as the Supabase heartbeat.
    """
    response = client.get(RENDER_HEALTH_CHECK_PATH)

    assert response.status_code == 200
    mock_supabase_client.table.assert_not_called()


def test_keepalive_stays_healthy_when_database_is_unreachable(mock_supabase_client):
    """A database outage must not be reported as the web service being down."""
    mock_supabase_client.table.side_effect = RuntimeError("connection refused")

    response = client.get(KEEPALIVE_PATH)

    assert response.status_code == 200
    assert response.json()["database"] == "unreachable"


def test_keepalive_stays_healthy_when_database_is_not_configured(monkeypatch):
    """Local development runs without Supabase credentials and must not error."""
    monkeypatch.setattr(main, "supabase", None)

    response = client.get(KEEPALIVE_PATH)

    assert response.status_code == 200
    assert response.json()["database"] == "not-configured"


def test_keepalive_requires_no_authentication(mock_supabase_client):
    """The self-ping arrives over plain HTTP with no session cookie to present."""
    unauthenticated_client = TestClient(app)

    response = unauthenticated_client.get(KEEPALIVE_PATH)

    assert response.status_code == 200


def test_keepalive_path_is_separate_from_the_render_health_check():
    """The two probes serve different masters and must not be collapsed into one."""
    assert KEEPALIVE_PATH != RENDER_HEALTH_CHECK_PATH


def test_keepalive_interval_stays_under_render_spin_down_window():
    """Pinging less often than Render's idle window would let the service sleep."""
    assert KEEPALIVE_INTERVAL_SECONDS < RENDER_SPIN_DOWN_SECONDS
