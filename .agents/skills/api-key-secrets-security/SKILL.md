---
name: api-key-secrets-security
description: Protecting per-user Bybit API keys/secrets in a multi-tenant TypeScript/Bun trading platform — secrets stored AES-256-GCM encrypted in MySQL (Bun/Node `crypto`: random 12-byte IV per record, 16-byte auth tag, 32-byte master key from env/secret), decrypted only in-memory at signing time, Bybit V5 HMAC-SHA256 request signing (X-BAPI headers, recv_window), least-privilege Bybit keys (NO withdraw, IP whitelist), never logging secrets, key rotation (versioned master keys), per-user isolation via Better-Auth session, and never returning secrets to the client. Invoke when the task mentions storing/encrypting a Bybit API key, AES-256-GCM, createCipheriv/getAuthTag, IV/auth tag, master/encryption key, HMAC-SHA256 signing, X-BAPI headers, no-withdraw/IP-whitelist key permissions, key rotation, secret redaction in logs, or per-user key isolation.
---

# API Key & Secrets Security (Bybit, AES-256-GCM in MySQL)

## When to use this skill
- Designing how the platform stores, encrypts, and serves per-user Bybit API keys (AES-256-GCM at rest in MySQL).
- Implementing encrypt/decrypt with Bun/Node `crypto` (random IV, auth tag, master key from env) and decrypting only at signing time.
- Signing Bybit V5 REST requests with HMAC-SHA256 (X-BAPI headers, recv_window) using the just-decrypted secret.
- Choosing least-privilege Bybit key permissions (Read+Trade, **no Withdraw**) and an IP whitelist.
- Adding key rotation, log redaction, per-user isolation, and never returning secrets to the client.

## Core concepts
- **Encrypted at rest in MySQL, plaintext never touches disk.** Each user's Bybit `api_secret` (and often the `api_key`) is encrypted with **AES-256-GCM** and stored in the DB alongside a **random per-record IV** and the **auth tag**. GCM is authenticated encryption: the 16-byte tag proves the ciphertext (and any associated data) was not tampered with — decryption fails loudly if a byte changed.
- **Random IV per record, never reused.** GCM needs a **unique 12-byte (96-bit) IV per encryption under the same key** — reuse is catastrophic for GCM. Generate `crypto.randomBytes(12)` for every write; store it with the ciphertext. The IV is not secret; the key is.
- **One master key, held outside the DB.** A single 32-byte (256-bit) master key comes from an env var / injected secret (or, optionally, a KMS as the master-key store — see below). It must **not** live in the same table/DB as the ciphertext. Losing separation defeats the encryption.
- **Decrypt just-in-time, in memory only.** The engine decrypts the secret only at the moment it signs a Bybit request, uses it, and drops the reference. Never log it, never write it to a temp file, never put it in an error/response body.
- **Least-privilege exchange key.** A bot needs **Read + Trade** (Bybit `ContractTrade: [Order, Position]`, and Spot if used). It must **never** have **Withdraw**. Bind the key to the container's static egress **IP whitelist**. A no-withdraw, IP-bound key cannot move funds out even if fully leaked — the single most important control.
- **Per-user isolation via Better-Auth.** App auth is Better-Auth (Google + email); every key row is owned by a user id. Every read/decrypt is scoped to the authenticated session's user — user A can never fetch or use user B's key.

## Codebase specifics (Bun / Node crypto / Bybit V5 / Drizzle)
- **Crypto library:** Bun exposes the Node `crypto` API — `createCipheriv('aes-256-gcm', key, iv)`, `cipher.update`/`final`, `cipher.getAuthTag()`; decrypt with `createDecipheriv` + `decipher.setAuthTag(tag)`. No third-party crypto lib needed; **no Fernet, no Vault as the primary store**.
- **Storage shape (Drizzle/MySQL):** a `user_exchange_keys` table with `userId`, `apiKeyEnc` (varbinary/blob), `apiSecretEnc`, `iv` (12 bytes), `authTag` (16 bytes), `keyVersion` (which master key encrypted it), `label`, `createdAt`. Schema guaranteed by idempotent `ensure-schema.ts` (`ALTER TABLE`, no migrations). Consider encrypting a combined `key||secret` payload so both share one IV/tag record.
- **Master key source:** `process.env.MASTER_KEY_B64` (32 bytes, base64) injected by Dokploy into the single container. Keep a **map of versioned keys** so rotation can decrypt old records: `{ v1: buf, v2: buf }`, encrypt with the newest, decrypt with the version stored on the row.
- **Bybit V5 signing:** build the pre-sign string per Bybit rules — `timestamp + apiKey + recvWindow + (queryString | jsonBody)` — then `crypto.createHmac('sha256', apiSecret).update(preSign).digest('hex')`. Send `X-BAPI-API-KEY`, `X-BAPI-TIMESTAMP` (ms), `X-BAPI-RECV-WINDOW` (e.g. 5000), `X-BAPI-SIGN`. Keep server clock NTP-synced; `server_time - recvWindow <= timestamp < server_time + 1000`.
- **Polling, signed REST only:** all exchange access is periodic signed `fetch` (no WS). The decrypt→sign→fetch path runs inside the engine's 10s loop; the tRPC API never signs a Bybit call on a page-load and never returns a secret.
- **Client-facing model:** the API returns only masked metadata (`label`, `apiKeyMasked` like `AB••••WXYZ`, permissions, IP list) — never the secret. A write endpoint accepts the secret (over TLS), encrypts, and stores; a read endpoint never emits it.

## Implementation checklist
- [ ] `user_exchange_keys` table: `apiSecretEnc`, `iv` (12B), `authTag` (16B), `keyVersion`, `userId` — via `ensure-schema.ts`.
- [ ] Master key: 32-byte key from env (base64), validated on boot; versioned map for rotation; **not** stored in the DB.
- [ ] `encryptSecret`: `randomBytes(12)` IV → `createCipheriv('aes-256-gcm', key, iv)` → store ciphertext + IV + `getAuthTag()` + version.
- [ ] `decryptSecret`: load version's key → `createDecipheriv` → `setAuthTag(tag)` → `update`/`final`; only in the engine at signing time.
- [ ] Bybit sign helper: HMAC-SHA256 over `ts+apiKey+recvWindow+payload`; set the four `X-BAPI-*` headers.
- [ ] Provision Bybit keys Read+Trade only, **Withdraw disabled**, IP-whitelisted to the container egress IP.
- [ ] Per-user scoping: every decrypt is filtered by `ctx.user.id` (Better-Auth session); never trust an id from input.
- [ ] Redact secrets in logs (never log the decrypted secret, the master key, or full ciphertext).
- [ ] Client models: `KeyCreate` (write secret) vs `KeyRead` (masked only); never return the secret.
- [ ] Rotation path: add a new master-key version, re-encrypt records lazily/in batch, drop old version when done.
- [ ] Secret-scanning in CI (gitleaks/trufflehog); `.env` gitignored; different master key per environment.

## Do / Don't
**Do**
- Use AES-256-GCM with a fresh random 12-byte IV per record and store the auth tag; verify the tag on decrypt.
- Keep the 32-byte master key in env/secret injection (optionally a KMS as master-key store), never beside the ciphertext.
- Decrypt only in memory, at Bybit-signing time, then drop the plaintext.
- Ship no-withdraw, IP-whitelisted Bybit keys; grant only the products the bot trades.
- Scope every key access to the Better-Auth session user; mask secrets in every API response.

**Don't**
- Don't ever enable Withdraw on a programmatic Bybit key.
- Don't reuse an IV across records, hardcode the master key, or store it in the DB/repo/frontend.
- Don't store the secret in plaintext, in `.env`, or return it from any endpoint.
- Don't log/print the decrypted secret, the master key, IVs+key together, or full request bodies with signatures.
- Don't use one master Bybit key for all users — isolate per user; a leak must not be platform-wide.
- Don't skip auth-tag verification (`setAuthTag`) — without it you lose tamper detection and integrity.

## Common pitfalls
- **IV reuse / static IV:** the classic GCM mistake — same key + repeated IV breaks confidentiality. Always `randomBytes(12)` per write.
- **Auth tag dropped:** forgetting to store or `setAuthTag` on decrypt → GCM can't authenticate; either it throws or (if you use raw CBC instead) you lose integrity entirely.
- **Master key beside ciphertext:** putting the key in the same MySQL/DB or repo as the encrypted secret provides no real protection.
- **Withdraw left on "just in case":** turns a leaked key/config into direct fund theft.
- **No IP whitelist:** unrestricted-IP keys are riskier and Bybit expires them (~90 days) and blocks withdrawals regardless — whitelist the egress IP.
- **Secrets in logs/errors:** an unhandled throw or `console.log(config)` leaks the secret to log aggregation — redact and use masked models.
- **Cross-tenant leak:** decrypting by a `keyId` from request input instead of scoping to `ctx.user.id`.
- **Clock skew on signing:** `X-BAPI-TIMESTAMP` outside `recvWindow` → Bybit rejects; keep the container NTP-synced.

## Code patterns
```ts
// crypto.ts — AES-256-GCM encrypt/decrypt with random IV + auth tag (Bun/Node crypto)
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// versioned master keys (32 bytes each) from env/secret injection — NEVER in the DB
const KEYS: Record<string, Buffer> = {
  v2: Buffer.from(process.env.MASTER_KEY_V2_B64!, 'base64'), // current (encrypt with this)
  v1: Buffer.from(process.env.MASTER_KEY_V1_B64!, 'base64'), // kept only to decrypt old rows
};
const CURRENT = 'v2';

export interface EncPayload { ciphertext: Buffer; iv: Buffer; authTag: Buffer; keyVersion: string; }

export function encryptSecret(plaintext: string): EncPayload {
  const iv = randomBytes(12);                                  // unique 96-bit IV per record
  const cipher = createCipheriv('aes-256-gcm', KEYS[CURRENT], iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return { ciphertext, iv, authTag: cipher.getAuthTag(), keyVersion: CURRENT };
}

export function decryptSecret(p: EncPayload): string {         // call only at signing time
  const key = KEYS[p.keyVersion];
  if (!key) throw new Error('unknown key version');
  const decipher = createDecipheriv('aes-256-gcm', key, p.iv);
  decipher.setAuthTag(p.authTag);                              // verifies integrity — throws if tampered
  return Buffer.concat([decipher.update(p.ciphertext), decipher.final()]).toString('utf8');
}
```

```ts
// bybit-sign.ts — HMAC-SHA256 signed Bybit V5 request; secret decrypted just-in-time
import { createHmac } from 'node:crypto';

export async function bybitSignedFetch(
  method: 'GET' | 'POST', path: string, params: Record<string, unknown>,
  enc: EncPayload, apiKey: string, recvWindow = 5000,
) {
  const secret = decryptSecret(enc);           // in memory only; drops out of scope after this call
  const ts = Date.now().toString();
  const payload = method === 'GET'
    ? new URLSearchParams(params as Record<string, string>).toString()
    : JSON.stringify(params);
  const preSign = ts + apiKey + recvWindow + payload;
  const sign = createHmac('sha256', secret).update(preSign).digest('hex');

  const url = 'https://api.bybit.com' + path + (method === 'GET' && payload ? `?${payload}` : '');
  return fetch(url, {
    method,
    headers: {
      'X-BAPI-API-KEY': apiKey,
      'X-BAPI-TIMESTAMP': ts,
      'X-BAPI-RECV-WINDOW': String(recvWindow),
      'X-BAPI-SIGN': sign,
      ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
    },
    body: method === 'POST' ? payload : undefined,
  });
  // never console.log(secret / sign / preSign)
}
```

```ts
// api models — write the secret, never read it back; redact in logs
export const KeyCreate = z.object({ label: z.string(), apiKey: z.string(), apiSecret: z.string() });
export interface KeyRead { id: string; label: string; apiKeyMasked: string; } // e.g. "AB••••WXYZ"

const SECRET_KEYS = new Set(['apiSecret', 'api_secret', 'secret', 'password', 'authorization', 'x-bapi-sign']);
export function redact<T extends Record<string, unknown>>(o: T): T {
  const out: any = Array.isArray(o) ? [] : {};
  for (const [k, v] of Object.entries(o)) {
    out[k] = SECRET_KEYS.has(k.toLowerCase()) ? '***REDACTED***'
      : v && typeof v === 'object' ? redact(v as any) : v;
  }
  return out;
}
```

## References
- [Node.js crypto — Cipher / createCipheriv](https://nodejs.org/api/crypto.html#cryptocreatecipherivalgorithm-key-iv-options) — AES-256-GCM, `getAuthTag`, GCM notes (Bun implements this API).
- [Bun — Node crypto.createCipheriv reference](https://bun.com/reference/node/crypto/createCipheriv) — confirms Bun support for the Node crypto cipher API.
- [Node.js crypto — Decipher / setAuthTag](https://nodejs.org/api/crypto.html#deciphersetauthtagbuffer-encoding) — verifying the GCM auth tag on decrypt.
- [AES-GCM example (Node crypto, gist)](https://gist.github.com/rjz/15baffeab434b8125ca4d783f4116d81) — random IV + auth tag encrypt/decrypt reference.
- [Bybit V5 — Authentication / signing](https://bybit-exchange.github.io/docs/v5/guide) — HMAC-SHA256 pre-sign string, X-BAPI headers, recv_window.
- [Bybit V5 — Introduction](https://bybit-exchange.github.io/docs/v5/intro) — request signing rules, server-time/recv_window validation.
- [Bybit V5 — Create Sub UID API Key](https://bybit-exchange.github.io/docs/v5/user/create-subuid-apikey) — per-user key provisioning, permissions, IP.
- [Bybit V5 — Get API Key Information](https://bybit-exchange.github.io/docs/v5/user/apikey-info) — inspect permissions, IP list, expiry.
- [Bybit Help — How to create your API key](https://www.bybit.com/en/help-center/article/How-to-create-your-API-key) — no-withdraw, IP whitelist, expiry rules.
- [Better Auth — Session management](https://better-auth.com/docs/concepts/session-management) — app auth / per-user isolation via session.
- [Drizzle ORM — MySQL column types](https://orm.drizzle.team/docs/column-types/mysql) — binary/varbinary columns for ciphertext, IV, auth tag.
- [OWASP — Secrets Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html) — storage, rotation, no-logging guidance.
- [OWASP — Cryptographic Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html) — authenticated encryption (GCM), IV/key management.
