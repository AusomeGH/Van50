#!/usr/bin/env python3
"""
Van50 Curator Authentication & Cryptographic Session Security Engine
Provides PBKDF2-HMAC-SHA256 password verification, HMAC session tokens,
and in-memory brute-force rate-limiting.
"""

import os
import hmac
import hashlib
import time
import json
import base64
from typing import Tuple, Dict, Any

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENV_PATH = os.path.join(BASE_DIR, ".env")
SECRET_JSON_PATH = os.path.join(BASE_DIR, "data", ".curator_secret.json")

# In-memory brute force tracker: { ip_address: { "failures": count, "lockedUntil": timestamp } }
LOGIN_ATTEMPTS: Dict[str, Dict[str, Any]] = {}
MAX_FAILED_ATTEMPTS = 5
LOCKOUT_DURATION_SECONDS = 900  # 15 minutes
TOKEN_LIFETIME_SECONDS = 86400  # 24 hours


def load_configured_secret() -> str:
    """Reads configured password from environment or .env file."""
    env_secret = os.environ.get("VAN50_CURATOR_SECRET")
    if env_secret:
        return env_secret.strip()

    if os.path.exists(ENV_PATH):
        try:
            with open(ENV_PATH, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line.startswith("VAN50_CURATOR_SECRET="):
                        val = line.split("=", 1)[1].strip().strip('"').strip("'")
                        if val:
                            return val
        except Exception:
            pass

    # Default fallback
    return "Professor-Urban-Freebase9"


def get_or_create_key_material() -> Tuple[bytes, bytes]:
    """Retrieves or derives salt and server signing key material."""
    if os.path.exists(SECRET_JSON_PATH):
        try:
            with open(SECRET_JSON_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
                salt = base64.b64decode(data["salt"])
                signing_key = base64.b64decode(data["signingKey"])
                return salt, signing_key
        except Exception:
            pass

    salt = os.urandom(16)
    signing_key = os.urandom(32)

    os.makedirs(os.path.dirname(SECRET_JSON_PATH), exist_ok=True)
    try:
        with open(SECRET_JSON_PATH, "w", encoding="utf-8") as f:
            json.dump({
                "salt": base64.b64encode(salt).decode("utf-8"),
                "signingKey": base64.b64encode(signing_key).decode("utf-8"),
                "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ")
            }, f, indent=2)
    except Exception:
        pass

    return salt, signing_key


SALT, SIGNING_KEY = get_or_create_key_material()


def hash_password(password: str, salt: bytes = SALT) -> bytes:
    """Derives a cryptographic key from password and salt using PBKDF2-HMAC-SHA256."""
    return hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations=100000)


def check_rate_limit(ip: str) -> Tuple[bool, int]:
    """Checks whether the requesting IP address is locked out due to repeated failures."""
    record = LOGIN_ATTEMPTS.get(ip)
    if not record:
        return True, 0

    now = time.time()
    locked_until = record.get("lockedUntil", 0)
    if now < locked_until:
        return False, int(locked_until - now)

    # Cooldown expired, reset
    if locked_until > 0 and now >= locked_until:
        LOGIN_ATTEMPTS[ip] = {"failures": 0, "lockedUntil": 0}

    return True, 0


def record_failed_attempt(ip: str) -> Tuple[int, int]:
    """Increments failed attempt counter; triggers lockout if threshold is exceeded."""
    now = time.time()
    record = LOGIN_ATTEMPTS.get(ip, {"failures": 0, "lockedUntil": 0})
    record["failures"] = record.get("failures", 0) + 1

    remaining_attempts = max(0, MAX_FAILED_ATTEMPTS - record["failures"])
    lockout_remaining = 0

    if record["failures"] >= MAX_FAILED_ATTEMPTS:
        record["lockedUntil"] = now + LOCKOUT_DURATION_SECONDS
        lockout_remaining = LOCKOUT_DURATION_SECONDS

    LOGIN_ATTEMPTS[ip] = record
    return remaining_attempts, lockout_remaining


def record_successful_login(ip: str):
    """Resets failed attempt counters for IP upon successful authentication."""
    LOGIN_ATTEMPTS.pop(ip, None)


def verify_curator_password(candidate: str, client_ip: str = "127.0.0.1") -> Tuple[bool, str, int]:
    """
    Verifies candidate passphrase against configured secret with constant-time equality.
    Returns: (is_valid, message, lockout_or_remaining_attempts)
    """
    is_allowed, cooldown = check_rate_limit(client_ip)
    if not is_allowed:
        return False, f"Too many failed login attempts. Locked out for {cooldown}s.", cooldown

    target_secret = load_configured_secret()

    target_hash = hash_password(target_secret, SALT)
    candidate_hash = hash_password(candidate, SALT)

    if hmac.compare_digest(target_hash, candidate_hash):
        record_successful_login(client_ip)
        return True, "Authentication successful", 0
    else:
        remaining, lockout = record_failed_attempt(client_ip)
        if lockout > 0:
            return False, f"Too many failed attempts. Account locked for {lockout} seconds.", lockout
        return False, f"Invalid passphrase. {remaining} attempt(s) remaining.", remaining


def generate_session_token() -> str:
    """Generates a cryptographically signed, timestamped session bearer token."""
    now = int(time.time())
    payload = {
        "role": "curator",
        "issuedAt": now,
        "expiresAt": now + TOKEN_LIFETIME_SECONDS,
        "nonce": os.urandom(8).hex()
    }
    payload_json = json.dumps(payload, separators=(',', ':')).encode('utf-8')
    payload_b64 = base64.urlsafe_b64encode(payload_json).decode('utf-8').rstrip('=')

    sig = hmac.new(SIGNING_KEY, payload_b64.encode('utf-8'), hashlib.sha256).digest()
    sig_b64 = base64.urlsafe_b64encode(sig).decode('utf-8').rstrip('=')

    return f"{payload_b64}.{sig_b64}"


def verify_session_token(token: str) -> Tuple[bool, str]:
    """Verifies HMAC signature and expiration timestamp on an incoming session token."""
    if not token or "." not in token:
        return False, "Malformed token structure"

    parts = token.split(".")
    if len(parts) != 2:
        return False, "Invalid token parts"

    payload_b64, sig_b64 = parts

    # Recompute expected signature
    expected_sig = hmac.new(SIGNING_KEY, payload_b64.encode('utf-8'), hashlib.sha256).digest()
    expected_sig_b64 = base64.urlsafe_b64encode(expected_sig).decode('utf-8').rstrip('=')

    if not hmac.compare_digest(sig_b64, expected_sig_b64):
        return False, "Invalid cryptographic token signature"

    # Decode and inspect expiration
    try:
        # Pad base64 if needed
        pad_len = 4 - (len(payload_b64) % 4)
        padded = payload_b64 + ("=" * (pad_len % 4))
        payload_data = json.loads(base64.urlsafe_b64decode(padded.encode('utf-8')).decode('utf-8'))
    except Exception as e:
        return False, f"Failed to parse token payload: {e}"

    now = int(time.time())
    expires_at = payload_data.get("expiresAt", 0)
    if now > expires_at:
        return False, "Session token has expired. Please re-authenticate."

    return True, "Token valid"
