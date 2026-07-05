---
name: backend-api-service
description: Building the Python FastAPI backend for a multi-bot crypto trading platform — async REST endpoints, pydantic v2 request/response models, dependency injection (Depends/Security), WebSocket streaming to the frontend, JWT/session auth, OAuth2 scopes + RBAC for multi-user, request validation, rate limiting (slowapi), background tasks vs a separate worker (Celery/ARQ), OpenAPI docs, and structured logging (structlog). Invoke when the task mentions FastAPI, uvicorn/gunicorn, "backend API", "async endpoint", "websocket endpoint", pydantic model, Depends, JWT login, RBAC/roles/scopes, rate limit, background task, worker, "OpenAPI docs", CORS, or serving live PnL/positions/orders to a dashboard.
---

# Backend API Service (FastAPI)

## When to use this skill
- Scaffolding or extending the platform backend: routers, pydantic schemas, dependency-injected services.
- Adding auth: JWT login, session cookies, OAuth2 password flow, refresh tokens, RBAC/scopes per user.
- Exposing a WebSocket endpoint that fans out live bot state (PnL, positions, orders, fills) to the UI.
- Deciding between `BackgroundTasks` (in-process) and a separate worker (Celery/ARQ) for bot execution or heavy jobs.
- Adding rate limiting, request validation, CORS, structured JSON logging, or OpenAPI/Swagger docs.
- Configuring uvicorn/gunicorn for production (workers, reload, proxy headers).

## Core concepts
- **ASGI**: FastAPI is an ASGI app served by uvicorn (dev/single-loop) or gunicorn with `uvicorn.workers.UvicornWorker` (multi-process). Each worker is one process with its own event loop and memory — in-memory WebSocket connection registries are **per-worker**, so cross-worker broadcast needs Redis pub/sub.
- **async vs sync path operations**: `async def` runs on the event loop; `def` is offloaded to a threadpool. **Never** call blocking I/O (requests, time.sleep, sync DB drivers, pybit sync calls) inside `async def` — it stalls the whole worker. Either use async libs (httpx, asyncpg, ccxt.pro) or make the handler `def`.
- **Dependency Injection**: `Depends(...)` resolves and caches values per-request (DB sessions, current user, exchange clients). `Security(dep, scopes=[...])` is `Depends` plus OAuth2 scope enforcement.
- **pydantic v2**: request/response validation & serialization. Use `model_config = ConfigDict(from_attributes=True)` (replaces v1 `orm_mode`) to return ORM objects. Separate `*Create` / `*Read` / `*Update` schemas; never expose secrets in a Read model.
- **Auth model**: authentication (who are you — JWT/session) vs authorization (what may you do — RBAC roles / OAuth2 scopes). For a trading platform, scope trade actions (`bots:write`, `orders:cancel`) separately from read (`positions:read`).
- **Background work**: `BackgroundTasks` runs after the response *in the same process* — fine for fire-and-forget (send email, write audit row), fatal for long/CPU-bound work (it blocks the worker and dies on restart). Long-running bot loops and backtests belong in a **separate worker** (Celery/ARQ + Redis broker) so they survive API restarts and scale independently.

## Python & stack specifics
- Stack: `fastapi`, `uvicorn[standard]`, `pydantic` v2, `pydantic-settings` (config from env), `python-jose[cryptography]` or `pyjwt` for JWT, `passlib[bcrypt]` for password hashing, `slowapi` for rate limiting, `structlog` for logging, `httpx`/`asyncpg`/SQLAlchemy 2.0 async for I/O.
- **OpenAPI**: auto-generated at `/openapi.json`, Swagger UI at `/docs`, ReDoc at `/redoc`. Add `summary`, `description`, `response_model`, and `tags` to routes so the generated spec is usable by the frontend codegen. Note: WebSocket routes are **not** described in OpenAPI — document their message contract manually.
- **CORS**: add `CORSMiddleware` with an explicit `allow_origins` list (the dashboard origin) — never `["*"]` together with `allow_credentials=True`.
- **Rate limiting**: `slowapi` (`Limiter(key_func=get_remote_address)`), decorate routes with `@limiter.limit("100/minute")`; back it with Redis for multi-worker correctness. Protect `/auth/login` tightly (e.g. `5/minute`) to blunt credential stuffing.
- **Config**: load all secrets (JWT signing key, DB URL, Redis URL) via `pydantic-settings` `BaseSettings` from env — never hardcode. See the `api-key-secrets-security` skill for exchange keys.
- **Production run**: `gunicorn app.main:app -k uvicorn.workers.UvicornWorker -w <2*cores+1> --bind 0.0.0.0:8000`. Behind a reverse proxy set `--proxy-headers` / `forwarded-allow-ips`. Use `--reload` only in dev.

## Implementation checklist
- [ ] App factory in `app/main.py`; mount routers with `APIRouter(prefix=..., tags=...)`.
- [ ] `pydantic-settings` `Settings` for env config; inject via `Depends(get_settings)` with `@lru_cache`.
- [ ] Define `*Create`/`*Read` schemas; set `response_model=` on every route; never return raw secrets.
- [ ] Auth: `OAuth2PasswordBearer` token URL, `/auth/login` issuing a short-lived access JWT (+ refresh), bcrypt-hashed passwords, `get_current_user` dependency validating the token and loading the user.
- [ ] RBAC: put roles/scopes in the JWT; enforce with `Security(get_current_user, scopes=["orders:cancel"])`; return 403 on missing scope, 401 on bad/expired token.
- [ ] WebSocket endpoint: authenticate on connect (token via query param or first message), register the socket in a `ConnectionManager`, push updates, handle `WebSocketDisconnect`.
- [ ] For cross-worker fan-out, publish bot events to Redis pub/sub and have each worker relay to its local sockets.
- [ ] Rate-limit auth + write endpoints; add CORS with explicit origins.
- [ ] Structured logging: JSON logs with a per-request correlation/request id via middleware; scrub secrets.
- [ ] Long-running / CPU-bound work → Celery or ARQ worker, not `BackgroundTasks`.
- [ ] Global exception handlers returning consistent error envelopes; `/health` and `/ready` probes.

## Do / Don't
**Do**
- Keep secrets and signing keys in env/secret manager; use short access-token TTLs (5–15 min) plus refresh tokens.
- Validate every inbound payload with pydantic; reject unknown fields where it matters (`model_config extra="forbid"`).
- Use async DB/HTTP clients in `async def`, or drop to `def` for blocking libraries.
- Give each bot action its own scope so a read-only dashboard token cannot place or cancel orders.
- Send heartbeats/pings on WebSockets and handle reconnect on the client.

**Don't**
- Don't run blocking calls (sync pybit, `requests`, `time.sleep`, heavy pandas) inside `async def` — it freezes the worker's event loop and every connected socket.
- Don't use `BackgroundTasks` for the live trading loop or backtests — they die with the request/worker.
- Don't rely on in-memory state (connection lists, rate counters) across multiple gunicorn workers — use Redis.
- Don't return ORM/user objects that include password hashes or API keys; use a dedicated Read model.
- Don't set `allow_origins=["*"]` with credentials, or ship `--reload` / open `/docs` to the public internet unauthenticated.

## Common pitfalls
- **Event-loop stalls**: one blocking call in an async route degrades latency for all clients on that worker — the #1 FastAPI perf killer.
- **Per-worker WebSocket registries**: broadcasts only reach clients on the same worker; users randomly "miss" updates until you add Redis pub/sub.
- **JWT `exp`/clock**: expired-token 401s and skewed server clocks; verify `exp`/`nbf` and keep servers NTP-synced.
- **Refresh-token rotation**: without rotation + revocation list, a leaked refresh token is a permanent session.
- **Rate limiter without shared store**: per-worker counters let real limits be N× higher than intended.
- **N+1 / sync DB in async**: SQLAlchemy sync sessions in async routes silently block; use the async engine.

## Code patterns
```python
# app/deps.py — auth + RBAC via OAuth2 scopes
from fastapi import Depends, HTTPException, Security, status
from fastapi.security import OAuth2PasswordBearer, SecurityScopes
from jose import JWTError, jwt

oauth2_scheme = OAuth2PasswordBearer(
    tokenUrl="auth/login",
    scopes={"positions:read": "Read positions/PnL", "orders:cancel": "Cancel orders"},
)

async def get_current_user(security_scopes: SecurityScopes, token: str = Depends(oauth2_scheme)):
    authenticate = f'Bearer scope="{security_scopes.scope_str}"'
    cred_exc = HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token",
                             headers={"WWW-Authenticate": authenticate})
    try:
        payload = jwt.decode(token, SETTINGS.jwt_key, algorithms=["HS256"])
    except JWTError:
        raise cred_exc
    token_scopes = set(payload.get("scopes", []))
    for scope in security_scopes.scopes:          # enforce RBAC
        if scope not in token_scopes:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Not enough permissions",
                                headers={"WWW-Authenticate": authenticate})
    return await load_user(payload["sub"])

@app.post("/orders/{order_id}/cancel")
async def cancel_order(order_id: str,
                       user=Security(get_current_user, scopes=["orders:cancel"])):
    ...
```

```python
# WebSocket fan-out with auth + disconnect handling
from fastapi import WebSocket, WebSocketDisconnect

class ConnectionManager:
    def __init__(self): self.active: set[WebSocket] = set()
    async def connect(self, ws): await ws.accept(); self.active.add(ws)
    def disconnect(self, ws): self.active.discard(ws)
    async def broadcast(self, msg: dict):
        for ws in list(self.active):
            try: await ws.send_json(msg)
            except Exception: self.disconnect(ws)

manager = ConnectionManager()

@app.websocket("/ws/live")
async def live(ws: WebSocket, token: str):
    user = await authenticate_ws(token)      # reject before accept if invalid
    if not user: return await ws.close(code=1008)
    await manager.connect(ws)
    try:
        while True:
            await ws.receive_text()          # keepalive / client pings
    except WebSocketDisconnect:
        manager.disconnect(ws)
```

## References
- [FastAPI documentation](https://fastapi.tiangolo.com/) — official framework docs: routing, DI, validation.
- [FastAPI — OAuth2 scopes](https://fastapi.tiangolo.com/advanced/security/oauth2-scopes/) — scope-based RBAC with `Security`/`SecurityScopes`.
- [FastAPI — WebSockets](https://fastapi.tiangolo.com/advanced/websockets/) — WebSocket endpoints, connection management, broadcasting.
- [FastAPI — Background Tasks](https://fastapi.tiangolo.com/tutorial/background-tasks/) — in-process background work and its limits.
- [Uvicorn](https://www.uvicorn.org/) — ASGI server, workers, gunicorn integration, proxy headers.
- [Pydantic documentation](https://docs.pydantic.dev/latest/) — v2 models, `ConfigDict`, validation, settings.
- [slowapi](https://github.com/laurentS/slowapi) — FastAPI/Starlette rate limiting (Redis-backed).
- [structlog](https://www.structlog.org/en/stable/) — structured/JSON logging with bound context.
- [Securing FastAPI with JWT (TestDriven.io)](https://testdriven.io/blog/fastapi-jwt-auth/) — practical JWT login/refresh walkthrough.
- [Authentication & Authorization with FastAPI (Better Stack)](https://betterstack.com/community/guides/scaling-python/authentication-fastapi/) — end-to-end auth patterns.
