---
name: trading-app-security
description: Application-level security for a multi-bot Bybit crypto trading platform in Python/FastAPI. Covers authentication and 2FA/TOTP, session and cookie security, the OWASP Top 10 and OWASP API Security Top 10 as they apply to fintech, OWASP ASVS verification levels, immutable audit logging of every order and config change, idempotency and replay protection (orderLinkId, Idempotency-Key), protecting the kill-switch and admin/withdrawal endpoints behind step-up auth, input validation with pydantic, secrets and API-key handling, and dependency/supply-chain hygiene (pip-audit, hash-pinning, SBOM). Invoke when the task mentions login, JWT, 2FA/MFA, session, CSRF, RBAC, audit log, idempotency, replay, kill-switch, admin endpoint, withdrawal, secrets management, API key storage, rate limiting, input validation, OWASP, ASVS, threat model, or "is this endpoint safe".
---

# Trading Application Security

## When to use this skill
- Building or reviewing auth: login, JWT/session tokens, 2FA/TOTP enrollment, password reset, API-key issuance for bots.
- Adding or hardening funds-affecting endpoints: place/cancel order, withdrawal, transfer, leverage change, kill-switch, bot start/stop, strategy config edits.
- Designing audit logging, idempotency, replay protection, or rate limiting.
- Threat-modeling the platform or mapping requirements to OWASP Top 10 / OWASP ASVS.
- Handling secrets: Bybit API keys/secrets, JWT signing keys, DB credentials, webhook tokens.
- Reviewing dependencies / CI for supply-chain risk (`pip-audit`, hash-pinned lockfiles, SBOM).

## Core concepts
A crypto trading platform is a **fintech application whose bugs move real money**. Security must treat every funds-affecting action as a transaction that is authenticated, authorized, validated, audited, idempotent, and rate-limited.

Vocabulary:
- **AuthN vs AuthZ**: authentication proves *who* you are (login, 2FA); authorization proves *what you may do* (RBAC/ownership checks per object).
- **BOLA / IDOR** (Broken Object-Level Authorization): the #1 API risk — an endpoint like `GET /bots/{id}` returns another user's bot because it never checks ownership. Every endpoint taking an ID must verify the caller owns that object.
- **Step-up auth / re-authentication**: forcing a fresh credential (password + fresh TOTP) immediately before a high-risk action (withdrawal, API-key creation, disabling the kill-switch), independent of the existing session.
- **Idempotency key**: a client-generated unique ID that lets a request be safely retried without duplicating the effect (no double orders / double withdrawals).
- **Replay attack**: a valid captured request re-sent to repeat its effect; defeated by idempotency keys, signed+timestamped requests with a nonce window, and short token lifetimes.
- **Audit log**: an append-only, tamper-evident record of *who did what, when, from where, and the before/after value* for every security- and money-relevant event.
- **Kill-switch**: a privileged control that flattens positions / halts all bots. It is the single most attractive target — an attacker who can toggle it can cause loss.

## Python & stack specifics
FastAPI + pydantic + a proper auth library. Key building blocks and quirks:

- **2FA/TOTP with `pyotp`** (RFC 6238). Store the TOTP secret **encrypted at rest** (AES-256-GCM or a KMS/vault), never plaintext. Provide `otpauth://` provisioning URI + QR for Google Authenticator/Authy. Rate-limit verification (lock/delay after ~5 failures). Issue 8-10 hashed, single-use backup codes. Log enroll / verify-success / verify-fail / backup-code-use.
- **Passwords**: hash with `argon2` (argon2-cffi) or bcrypt — never fast hashes (SHA-256) or plaintext.
- **Sessions/JWT**: short-lived access tokens (5-15 min) + rotating refresh tokens with server-side revocation. Cookies must be `HttpOnly; Secure; SameSite=Strict` (or `Lax`). Keep a server-side session/refresh store so you can revoke on logout, password change, or suspected compromise.
- **CSRF**: any cookie-authenticated state-changing route needs a CSRF token; token-in-Authorization-header APIs are less exposed but still validate `Origin`.
- **Input validation**: use pydantic models for *every* request body/query; constrain types, ranges, enums (side ∈ {Buy,Sell}, qty > 0, symbol against a whitelist). Reject unknown fields (`model_config = ConfigDict(extra="forbid")`).
- **Bybit API keys**: create keys with **least privilege** — do NOT enable *Withdraw* permission on bot keys; bind keys to an **IP allowlist**; prefer read+trade only. Store the secret encrypted; never log it; never return it after creation. Rotate on any suspicion.
- **Bybit request replay defense**: signed V5 requests carry `X-BAPI-TIMESTAMP` + `recv_window` (default 5000 ms) — Bybit rejects stale requests. Use a small `recv_window` and sync your clock (NTP) to shrink the replay window.
- **Order idempotency on Bybit**: pass a unique **`orderLinkId`** (<=36 chars) on every `create-order`. It lets you dedupe and safely retry after a timeout without double-submitting, and query the order back by `orderLinkId`.
- **Rate limiting**: apply per-user/per-IP limits at the gateway (`slowapi`/reverse proxy) to blunt credential stuffing and enumeration, independent of Bybit's own limits.
- **Secrets**: keep out of code/images; inject via env/secret manager; `.env` in `.gitignore`; scan history for leaked keys. Never commit Bybit keys.
- **Supply chain**: hash-pinned lockfile (`uv lock`/`pip-compile --generate-hashes`); run `pip-audit --require-hashes` in CI to fail on known CVEs; generate a CycloneDX SBOM; enable Dependabot/renovate; consider a cooldown before adopting brand-new package versions.

## Implementation checklist
- [ ] Enforce TLS everywhere; HSTS on the web tier.
- [ ] Password hashing = argon2/bcrypt; enforce a password policy + breach-check.
- [ ] TOTP 2FA mandatory for any account that can trade or withdraw; encrypted secret; hashed backup codes; rate-limited verify.
- [ ] Short access tokens + revocable refresh tokens; `HttpOnly/Secure/SameSite` cookies; server-side session revocation.
- [ ] Ownership/RBAC check on *every* endpoint that takes an object ID (defeat BOLA/IDOR).
- [ ] Step-up re-auth (password + fresh TOTP) on: withdrawals, transfers, API-key creation, disabling kill-switch, changing withdrawal whitelist.
- [ ] pydantic validation with `extra="forbid"` on all inputs; symbol/side/qty whitelists and bounds.
- [ ] Idempotency-Key header on money-moving POSTs; store key+response, reject same-key-different-payload with 409; set unique `orderLinkId` on Bybit orders.
- [ ] Append-only audit log for every order, config change, auth event, and admin action (who/what/when/ip/before/after); ship to write-once storage.
- [ ] Per-user + per-IP rate limiting on auth and order endpoints; account lockout/backoff.
- [ ] Bybit bot keys: no withdraw permission, IP-bound, least privilege, encrypted at rest, never logged.
- [ ] Kill-switch and admin endpoints: separate RBAC role, step-up auth, alert on every toggle.
- [ ] CI: `pip-audit`, hash-pinned deps, secret scanning, SAST; block deploy on findings.
- [ ] Map controls to OWASP ASVS Level 2 (min) for the fintech surface; document gaps.

## Do / Don't
**Do**
- Treat every order/withdrawal as an idempotent, audited, authorized transaction.
- Fail closed: if auth, validation, or the audit write fails, reject the action.
- Give bots their own least-privilege, IP-bound Bybit keys — one per bot for blast-radius isolation.
- Re-authenticate for high-value actions even inside a valid session.
- Validate ownership server-side; never trust a client-supplied user_id/bot_id.

**Don't**
- Don't enable *Withdraw* on trading-bot API keys, and never store keys unencrypted or in logs.
- Don't log secrets, full tokens, TOTP secrets, or raw API responses containing keys.
- Don't rely solely on the client for validation, rate limiting, or authorization.
- Don't expose the kill-switch or admin routes on the same trust level as normal user routes.
- Don't reuse a single privileged Bybit key across all bots and the UI.
- Don't retry a failed order without an idempotency key / `orderLinkId` — you can double-fill.

## Common pitfalls
- **BOLA everywhere**: adding an `/{id}` route and forgetting the ownership check — the most common and most damaging API bug.
- **Silent double orders**: a network timeout after Bybit accepted the order; a naive retry without `orderLinkId` opens a second position.
- **Clock skew**: unsynced server clock → Bybit rejects signed requests (timestamp/recv_window) or widens the replay window.
- **Audit gaps**: logging the request but not the *outcome* and *before/after*, so you can't reconstruct an incident.
- **Refresh-token immortality**: no revocation store, so a stolen refresh token is valid forever.
- **Leaked keys in git history / images / CI logs** — rotate immediately if found; git history is forever.
- **Verbose errors** leaking stack traces, internal IDs, or which field failed auth (enables enumeration).
- **Unpinned deps**: a compromised transitive package ships to prod because the lockfile wasn't hash-pinned.

## Code patterns
```python
# TOTP enrollment + verification (pyotp) — secret stored ENCRYPTED at rest.
import pyotp
secret = pyotp.random_base32()                      # persist encrypted (KMS/AES-GCM)
uri = pyotp.totp.TOTP(secret).provisioning_uri(
    name=user.email, issuer_name="MyTradingPlatform")   # render as QR
def verify_totp(secret: str, code: str) -> bool:
    return pyotp.TOTP(secret).verify(code, valid_window=1)  # ±1 step for clock drift
```

```python
# Idempotent order endpoint + step-up auth (FastAPI, illustrative).
from fastapi import Header, HTTPException, Depends
from pydantic import BaseModel, ConfigDict, field_validator

class OrderReq(BaseModel):
    model_config = ConfigDict(extra="forbid")       # reject unknown fields
    symbol: str; side: str; qty: float
    @field_validator("side")
    @classmethod
    def _side(cls, v):
        if v not in ("Buy", "Sell"): raise ValueError("bad side")
        return v

async def place_order(req: OrderReq,
                      idem: str = Header(alias="Idempotency-Key"),
                      user=Depends(current_user)):
    if (prev := await idem_store.get(user.id, idem)):
        if prev.payload_hash != hash_payload(req): raise HTTPException(409)
        return prev.response                        # replay -> cached result
    await audit.log("order.create.attempt", user.id, req.model_dump())
    resp = bybit.place_order(category="linear", symbol=req.symbol, side=req.side,
                             orderType="Market", qty=str(req.qty),
                             orderLinkId=idem)       # <=36 chars, unique -> dedupe/retry-safe
    await idem_store.put(user.id, idem, hash_payload(req), resp)
    await audit.log("order.create.result", user.id, resp)
    return resp
```

```python
# Append-only audit event shape — who / what / when / where / before-after.
audit_event = {
  "ts": "2026-07-05T12:00:00Z", "actor_id": user.id, "actor_ip": ip,
  "action": "config.update", "object": "bot:42",
  "before": {"max_leverage": 5}, "after": {"max_leverage": 10},
  "request_id": req_id, "result": "ok",
}   # write append-only (WORM bucket / hash-chained), never UPDATE/DELETE
```

## References
- [OWASP Top 10:2021](https://owasp.org/Top10/2021/) — canonical web-app risk list (Broken Access Control, Crypto Failures, etc.).
- [OWASP API Security Top 10](https://owasp.org/API-Security/) — API-specific risks; BOLA, broken auth, unrestricted resource consumption — most relevant to a trading API.
- [OWASP API Security Project](https://owasp.org/www-project-api-security/) — project hub with detailed per-risk guidance.
- [OWASP ASVS Project](https://owasp.org/www-project-application-security-verification-standard/) — verifiable security requirements; target Level 2 for fintech.
- [OWASP ASVS on GitHub](https://github.com/OWASP/ASVS) — latest 5.0 source, CSV/PDF of every requirement.
- [PyOTP (GitHub)](https://github.com/pyauth/pyotp) — TOTP/HOTP library for 2FA (RFC 4226/6238).
- [PyOTP docs](https://pyauth.github.io/pyotp/) — usage, provisioning URIs, verification windows.
- [Bybit V5 — Place Order](https://bybit-exchange.github.io/docs/v5/order/create-order) — `orderLinkId` idempotency field and order params.
- [Bybit V5 — Integration Guidance](https://bybit-exchange.github.io/docs/v5/guide) — request signing, `recv_window`, timestamp/replay handling, API-key permissions.
- [pip-audit (GitHub)](https://github.com/pypa/pip-audit) — audit deps for known CVEs; `--require-hashes` mode in CI.
- [pip-audit (PyPI)](https://pypi.org/project/pip-audit/) — install/usage.
- [Defense in Depth: Securing the Python Supply Chain](https://bernat.tech/posts/securing-python-supply-chain/) — hash-pinning, lockfiles, SBOM, SLSA provenance.
- [Google Cloud: What is idempotency?](https://cloud.google.com/discover/idempotency) — idempotency-key pattern for reliable APIs.
