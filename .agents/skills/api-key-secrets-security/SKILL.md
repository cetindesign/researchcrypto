---
name: api-key-secrets-security
description: Protecting Bybit exchange API keys and platform secrets in a multi-tenant crypto trading platform — least-privilege Bybit V5 key permissions (NO Withdraw permission, mandatory IP whitelist, read vs trade/contract scopes), encryption at rest (cryptography Fernet/MultiFernet, cloud KMS, HashiCorp Vault transit), never logging secrets, env vars vs secret managers, key rotation, per-user key isolation, and unified vs sub-account keys. Invoke when the task mentions Bybit API key/secret, key permissions, IP whitelist, "withdraw permission", encrypt API key at rest, Fernet/MultiFernet, KMS, Vault, secret manager, .env secrets, key rotation, sub-account keys, "leaked key", or storing per-user exchange credentials.
---

# API Key & Secrets Security (Bybit, multi-tenant)

## When to use this skill
- Designing how the platform stores, encrypts, and serves per-user Bybit API keys.
- Choosing Bybit key permissions/scopes and IP whitelist for bots (safe least-privilege setup).
- Adding encryption at rest (Fernet/MultiFernet, KMS, or Vault transit) and key rotation.
- Auditing code/logs to ensure secrets are never printed, logged, or returned in API responses.
- Deciding env vars vs a secret manager, and unified-account vs sub-account key isolation per user/bot.

## Core concepts
- **Least privilege**: a trading bot needs **Read + Trade** (Bybit: `ContractTrade`/`Spot`/`Derivatives` Order+Position, plus read). It must **never** have **Withdraw**. A trade-only key bound to a static IP cannot move funds out even if the key is fully leaked — this is the single most important control.
- **IP whitelist**: Bybit lets you bind a key to specific IPs. Whitelisted keys **do not expire**; keys **without** an IP whitelist **expire after ~90 days** and cannot be used for withdrawals at all. Always whitelist the VPS/static egress IP in production.
- **Read vs Trade vs Withdraw**: three permission tiers. Read-only for dashboards/analytics; Trade for execution bots; Withdraw — avoid entirely on programmatic keys. Grant per-product scopes (spot/derivatives/contract) only for what the bot trades.
- **Unified vs sub-account keys**: for multi-tenant isolation, prefer creating a **sub-account (Sub UID) per user/strategy** and issuing sub-account API keys. Blast radius of a leaked key is one sub-account, not the whole master. Master keys can create/rotate sub keys programmatically.
- **Encryption at rest**: never store the API secret in plaintext. Encrypt with a symmetric scheme (Fernet = AES-128-CBC + HMAC-SHA256 authenticated) whose data key lives in a KMS/Vault or env — not next to the ciphertext. Better: envelope encryption (KMS/Vault holds the master key; DB holds encrypted secrets).
- **Secret hygiene**: secrets never appear in logs, tracebacks, error responses, git, or client-visible API models. Treat the exchange secret like a password hash — decrypt only in memory at the moment of the signed request.

## Bybit / Python specifics
- **Permissions object (V5)**: keys carry permissions like `ContractTrade: ["Order","Position"]`, `Spot: ["SpotTrade"]`, `Wallet: ["AccountTransfer"]`, `Derivatives`, `Options`, `CopyTrading`, `Exchange`, `Earn`, `NFT`. For a bot, enable only the trading product(s) it uses; leave `Wallet`/withdrawal off.
- **Programmatic key management**: `POST /v5/user/create-sub-api-key` (create sub-account key), `POST /v5/user/update-api-key` / `update-sub-api-key` (modify permissions/IP), `GET /v5/user/query-api` (`apikey-info` — inspect permissions, IP list, expiry), delete endpoints for rotation. Use these to provision and rotate per-user keys without a human touching secrets.
- **IP whitelist via API**: set `ips` when creating/modifying keys; `"*"` means no restriction (avoid). Note Bybit disallows unrestricted-IP keys from withdrawing regardless.
- **Signing**: Bybit V5 requests are signed with HMAC-SHA256 over `timestamp + api_key + recv_window + queryString/body`; `recv_window` default 5000ms and server-time sync matters. `pybit`/`ccxt` handle this — you supply key+secret at client init, so decrypt just-in-time and avoid holding plaintext longer than needed.
- **Storage**: keep the platform's own secrets (JWT key, DB URL, KMS creds) in env via `pydantic-settings`; keep per-user exchange secrets **encrypted in the DB**, with the encryption key in KMS/Vault. Don't put user exchange keys in `.env`.

## Implementation checklist
- [ ] Provision Bybit keys with Read+Trade only, **Withdraw disabled**, IP-whitelisted to the bot's egress IP.
- [ ] One sub-account (Sub UID) + sub key per user/strategy for tenant isolation.
- [ ] Store API secrets encrypted at rest (Fernet/MultiFernet or Vault transit); never plaintext.
- [ ] Keep the data-encryption key out of the DB — in a KMS/Vault or injected env var, rotated separately.
- [ ] Decrypt secrets only in memory, at request time; never write decrypted secrets to logs/temp files.
- [ ] Add log scrubbing/redaction and a secret-detection scan (e.g. gitleaks/trufflehog) in CI.
- [ ] Never expose secrets in API responses — separate `KeyCreate` (write secret) from `KeyRead` (masked, e.g. last 4 chars).
- [ ] Implement rotation: `MultiFernet` for the encryption key; API endpoints to create a new Bybit key and revoke the old.
- [ ] Enforce `.gitignore` on `.env`; different secrets per environment; least-privilege on the secret store itself.
- [ ] Alerting on key usage anomalies; schedule ~90-day Bybit key rotation reminders.

## Do / Don't
**Do**
- Disable Withdraw on every programmatic key and bind an IP whitelist — belt and suspenders.
- Use envelope encryption: KMS/Vault holds the master key, DB holds ciphertext.
- Isolate tenants with sub-account keys so one leak ≠ platform-wide compromise.
- Rotate encryption keys with `MultiFernet` (new key first for encrypt, old kept for decrypt) and re-encrypt lazily/batch.
- Redact secrets in logs and scan repos/CI for leaked keys.

**Don't**
- Don't ever enable Withdraw permission on a bot/API key.
- Don't store exchange secrets in plaintext, in `.env`, in the frontend, or in git.
- Don't log, print, or return secrets — not in debug logs, tracebacks, or error payloads.
- Don't keep the encryption key in the same store/table as the ciphertext.
- Don't use one master-account key for all users (no isolation, catastrophic blast radius).
- Don't leave keys without an IP whitelist in production (they expire in ~90 days and are withdrawal-locked, and are less safe).

## Common pitfalls
- **Withdraw left on "just in case"**: turns a leaked config/repo into direct fund theft.
- **No IP whitelist**: key silently expires after ~90 days (bot dies) and is far riskier if leaked.
- **Secrets in logs/tracebacks**: an unhandled exception or `logger.info(config)` leaks the secret to log aggregation.
- **Encryption key beside ciphertext**: storing the Fernet key in the same DB/repo as the encrypted secret provides no real protection.
- **No rotation path**: single hardcoded Fernet key means you can never rotate without downtime — use `MultiFernet` from day one.
- **Shared/master key across tenants**: a single leak compromises every user's funds.
- **Returning full secret in API responses / admin UIs**: mask everything but the last few chars.

## Code patterns
```python
# Fernet encryption + rotation with MultiFernet
from cryptography.fernet import Fernet, MultiFernet

# keys pulled from KMS/Vault/env — NEVER hardcoded, NEVER stored with the ciphertext.
# First key is used to encrypt; all keys are tried on decrypt (enables rotation).
KEYS = [Fernet(k) for k in load_keys_from_secret_manager()]  # [new, old, ...]
cipher = MultiFernet(KEYS)

def encrypt_secret(api_secret: str) -> bytes:
    return cipher.encrypt(api_secret.encode())        # store this ciphertext in the DB

def decrypt_secret(token: bytes) -> str:
    return cipher.decrypt(token).decode()             # decrypt just-in-time, in memory only

# Rotate: prepend a fresh key, then re-encrypt existing tokens with .rotate()
def rotate(token: bytes) -> bytes:
    return cipher.rotate(token)                        # re-encrypts under the newest key
```

```python
# Redacting secrets from logs (structlog processor / logging filter)
import re
SECRET_RE = re.compile(r'(api[_-]?secret|api[_-]?key|authorization)"?\s*[:=]\s*"?([^\s",]+)', re.I)

def scrub_secrets(_, __, event_dict):
    for k, v in list(event_dict.items()):
        if isinstance(v, str):
            event_dict[k] = SECRET_RE.sub(r'\1=***REDACTED***', v)
        if k.lower() in {"api_secret", "api_key", "secret", "password", "authorization"}:
            event_dict[k] = "***REDACTED***"
    return event_dict
```

```python
# API models: write the secret, never read it back
from pydantic import BaseModel, SecretStr

class ExchangeKeyCreate(BaseModel):
    api_key: str
    api_secret: SecretStr          # SecretStr keeps it out of repr()/logs

class ExchangeKeyRead(BaseModel):  # what the frontend gets
    id: int
    label: str
    api_key_masked: str            # e.g. "AB••••WXYZ" — never the secret
```

```python
# Provision a least-privilege Bybit sub-account key (pybit), Withdraw OFF, IP-bound
from pybit.unified_trading import UserService  # master-account authenticated client
resp = master.create_sub_api_key(
    subuid=sub_uid,
    readOnly=0,                                  # 0 = read+write (trade), still NO withdraw perm
    ips="203.0.113.10",                          # bind to the bot's static egress IP
    permissions={"ContractTrade": ["Order", "Position"],
                 "Spot": ["SpotTrade"]},         # ONLY the products this bot trades; no Wallet/Withdraw
)
```

## References
- [Bybit V5 — Create Sub UID API Key](https://bybit-exchange.github.io/docs/v5/user/create-subuid-apikey) — programmatic per-user key provisioning with permissions/IP.
- [Bybit V5 — Modify Master API Key](https://bybit-exchange.github.io/docs/v5/user/modify-master-apikey) — permissions object & IP whitelist fields.
- [Bybit V5 — Get API Key Information](https://bybit-exchange.github.io/docs/v5/user/apikey-info) — inspect permissions, IP list, expiry.
- [Bybit V5 — Introduction / authentication](https://bybit-exchange.github.io/docs/v5/intro) — HMAC-SHA256 signing, `recv_window`, server time.
- [Bybit Help Center — How to create your API key](https://www.bybit.com/en/help-center/article/How-to-create-your-API-key) — permissions, IP whitelist, expiry rules.
- [cryptography — Fernet (symmetric encryption)](https://cryptography.io/en/stable/fernet/) — Fernet & MultiFernet key rotation API.
- [HashiCorp Vault — Transit secrets engine](https://developer.hashicorp.com/vault/docs/secrets/transit) — encryption-as-a-service / envelope encryption.
- [OWASP — Secrets Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html) — lifecycle, storage, rotation, no-logging guidance.
- [Pydantic — settings & SecretStr](https://docs.pydantic.dev/latest/concepts/pydantic_settings/) — env-based config and secret-safe types.
