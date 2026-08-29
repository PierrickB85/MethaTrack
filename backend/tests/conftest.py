import os
import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
base_url = os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")
if not base_url:
    raise RuntimeError("REACT_APP_BACKEND_URL is missing")
BASE_URL = base_url.rstrip("/")

ADMIN = {"email": "boivineaup@gmail.com", "password": "MethaTrack2026!"}
TECH = {"email": "tech@methatrack.fr", "password": "Tech2026!"}
VIEWER = {"email": "viewer@methatrack.fr", "password": "Viewer2026!"}


def _login(creds):
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{BASE_URL}/api/auth/login", json=creds, timeout=30)
    if r.status_code != 200:
        pytest.fail(f"Login failed for {creds['email']}: {r.status_code} {r.text[:300]}")
    token = r.json().get("token")
    if not token:
        pytest.fail("No token in login response")
    s.headers.update({"Authorization": f"Bearer {token}"})
    return s


@pytest.fixture(scope="session")
def api_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def admin_client():
    return _login(ADMIN)


@pytest.fixture(scope="session")
def tech_client():
    return _login(TECH)


@pytest.fixture(scope="session")
def viewer_client():
    return _login(VIEWER)


@pytest.fixture(scope="session")
def sites(admin_client):
    r = admin_client.get(f"{BASE_URL}/api/sites", timeout=30)
    assert r.status_code == 200, r.text
    return r.json()
