---
name: strategy-config-management
description: Manage per-bot and per-strategy configuration for a multi-bot Bybit trading platform using pydantic v2 and pydantic-settings — schema validation, JSON/YAML/TOML config files, layered environment overrides, secrets-vs-config separation (Bybit API key/secret, testnet vs mainnet), SecretStr, config versioning and migration, hot-reload safety, and validating parameters before a bot goes live. Invoke when the user mentions bot config, strategy parameters, config schema, pydantic Settings, BaseSettings, .env, secrets management, environment overrides, config validation, parameter sets, config hot-reload, config migration, "validate params before live", testnet/mainnet toggle, or leverage/risk limits per bot.
---

# Strategy & Config Management

## When to use this skill
- Designing the config schema for a bot/strategy (symbols, timeframe, leverage, risk limits, indicator params).
- Loading config from `.env`, YAML/TOML/JSON with environment-specific overrides (dev/testnet/prod).
- Separating **secrets** (Bybit API key/secret) from **parameters** and keeping keys out of git/logs.
- Adding a config `version` field plus migration logic when the schema changes.
- Validating a parameter set (fail-fast) **before** a bot is allowed to trade real money.
- Safely hot-reloading config for a running bot without corrupting open positions.

## Core concepts
- **Config vs secrets.** Config = behavioral parameters (safe to commit as templates, review in PRs). Secrets = credentials (API key/secret, DB password, webhook tokens) that must never hit git or logs. Load them from separate sources with different lifecycles.
- **Layered precedence.** Effective value = highest-priority source wins. pydantic-settings order (highest→lowest): init kwargs → environment variables → dotenv (`.env`) → secrets directory → model field defaults. Use this to let ops override a single param via env var without editing files.
- **Schema-first validation.** Every parameter is a typed pydantic field with bounds/validators. Invalid config must raise at startup, not at the first order.
- **Parameter set.** A named, versioned bundle of parameters for one bot instance (e.g. `btc_scalper_v3`). Multiple bots reuse one strategy class with different parameter sets.
- **Config version + migration.** Store `config_version` in each file; a migration function upgrades old files to the current schema so old parameter sets keep loading.
- **Hot-reload safety.** Some fields are reloadable live (e.g. `take_profit_pct`); some are **immutable while running** (e.g. `symbol`, `leverage`, `category`). Classify every field and reject unsafe live changes.

## Python & stack specifics
- Use **pydantic v2** + **pydantic-settings** (`BaseSettings` moved to the separate `pydantic-settings` package in v2). Install `pydantic pydantic-settings`.
- `SettingsConfigDict(env_file=".env", env_nested_delimiter="__", env_prefix="BOT_", extra="forbid")`. `extra="forbid"` catches typo'd keys instead of silently ignoring them.
- **SecretStr / SecretBytes** wrap credentials so `repr()`, logs, and tracebacks print `**********`; call `.get_secret_value()` only at the Bybit client boundary.
- `settings_customise_sources()` classmethod adds/reorders sources — use it to plug in a YAML/TOML loader (via `YamlConfigSettingsSource` / `TomlConfigSettingsSource`) or a secrets manager.
- `@field_validator` and `@model_validator` (v2) replace v1 `@validator`/`@root_validator`; use `@model_validator(mode="after")` for cross-field rules (e.g. `stop_loss < entry < take_profit`).
- Bybit specifics to validate: `category` ∈ {linear, inverse, spot, option}; `leverage` within the symbol's max; order/qty must respect `lotSizeFilter` (`qtyStep`, `minOrderQty`) and `priceFilter` (`tickSize`) from `GET /v5/market/instruments-info`; a `testnet: bool` that must map to the right base URL so a "dev" bot can never hit mainnet by mistake.
- For a live platform, load secrets from environment / a secrets manager (Vault, AWS/GCP Secrets Manager) — **not** from a committed file. `.env` is for local dev only; add it to `.gitignore`.

## Implementation checklist
- [ ] Define a `StrategyParams(BaseModel)` with typed, bounded fields and validators; no bare `dict`/`Any`.
- [ ] Define a `Secrets(BaseSettings)` holding only credentials as `SecretStr`, loaded from env/secrets dir.
- [ ] Add `config_version: int` to the params model and a `migrate(raw: dict) -> dict` upgrade chain.
- [ ] Choose file format (TOML for human-edited config; JSON for machine-generated) and wire a settings source.
- [ ] Set `extra="forbid"` so unknown keys fail loudly; document every field with `Field(..., description=...)`.
- [ ] Write a `validate_for_live(params, instrument_info)` gate: checks tick/lot filters, leverage cap, risk-per-trade, and that `testnet` matches the target account before enabling trading.
- [ ] Mark each field reloadable vs immutable; implement reload that rejects changes to immutable fields on a running bot.
- [ ] Add a startup log of the resolved (redacted) config so ops can confirm what actually loaded.

## Do / Don't
**Do**
- Fail fast: required fields have no default, so a missing value raises at startup.
- Keep secrets in `SecretStr` and call `.get_secret_value()` only where the Bybit client needs it.
- Validate params against live Bybit `instruments-info` filters before going live.
- Version every config file and keep migrations so old parameter sets still load.
- Commit a `config.example.toml` template with dummy values; gitignore the real `.env`.

**Don't**
- Don't commit API keys or print raw config/secrets to logs or exceptions.
- Don't hot-reload `symbol`, `category`, `leverage`, or `testnet` on a bot with an open position.
- Don't use `extra="allow"` (or the default ignore) — typos silently become no-ops and change behavior.
- Don't parse config with raw `os.getenv` scattered across the codebase; centralize in one Settings object.
- Don't share one API key across bots if you need per-bot rate-limit isolation or independent revocation.

## Common pitfalls
- **Loading secrets at import time** makes modules untestable and can crash CI; load lazily inside a factory.
- **Precedence surprises**: a stray env var silently overrides your file. Log the resolved source per field when debugging.
- **Float params for prices/qty**: use `Decimal` (or `condecimal`) so rounded tick/lot values stay exact; JSON floats lose precision.
- **Testnet/mainnet mixups**: a single boolean must drive both the base URL and the credentials, validated together, or a "paper" bot trades real funds.
- **Schema drift**: adding a required field breaks every existing config file; add it with a default + migration, not a bare required field.
- **`env_nested_delimiter` collisions** with keys that contain the delimiter — pick a delimiter (`__`) that never appears in field names.

## Code patterns
```python
from decimal import Decimal
from pydantic import BaseModel, Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

class StrategyParams(BaseModel):
    config_version: int = 3
    symbol: str
    category: str = Field("linear", pattern="^(linear|inverse|spot|option)$")
    leverage: int = Field(ge=1, le=100)
    risk_per_trade_pct: Decimal = Field(gt=0, le=Decimal("5"))
    take_profit_pct: Decimal = Field(gt=0)
    stop_loss_pct: Decimal = Field(gt=0)
    model_config = {"extra": "forbid"}   # reject unknown keys

    @model_validator(mode="after")
    def _sane(self):
        if self.stop_loss_pct >= self.take_profit_pct:
            raise ValueError("stop_loss_pct must be < take_profit_pct")
        return self

class Secrets(BaseSettings):
    # loaded from env (BYBIT_API_KEY / BYBIT_API_SECRET) or a secrets dir; never committed
    bybit_api_key: SecretStr
    bybit_api_secret: SecretStr
    testnet: bool = True
    model_config = SettingsConfigDict(env_prefix="BYBIT_", env_file=".env", extra="ignore")

# --- config migration chain ---
def migrate(raw: dict) -> dict:
    v = raw.get("config_version", 1)
    if v < 2:                       # v1 -> v2: renamed field
        raw["stop_loss_pct"] = raw.pop("sl_pct")
        v = raw["config_version"] = 2
    if v < 3:                       # v2 -> v3: added leverage cap
        raw.setdefault("leverage", 1)
        raw["config_version"] = 3
    return raw

# --- go-live gate ---
IMMUTABLE_WHILE_RUNNING = {"symbol", "category", "leverage", "testnet"}

def validate_for_live(p: StrategyParams, instrument: dict) -> None:
    step = Decimal(instrument["lotSizeFilter"]["qtyStep"])
    if p.leverage > int(float(instrument["leverageFilter"]["maxLeverage"])):
        raise ValueError("leverage exceeds symbol max")
    # ... assert qty respects qtyStep/minOrderQty, price respects tickSize ...
```

## References
- [Settings Management — Pydantic Docs](https://docs.pydantic.dev/latest/concepts/pydantic_settings/) — dotenv, secrets dir, priority order, `settings_customise_sources`, `SecretStr`.
- [Pydantic Migration Guide](https://docs.pydantic.dev/latest/migration/) — v1→v2 changes: `BaseSettings` moved to pydantic-settings, `@field_validator`/`@model_validator`.
- [Validators — Pydantic Docs](https://docs.pydantic.dev/latest/concepts/validators/) — field and cross-field (`mode="after"`) validation for parameter bounds.
- [Pydantic Documentation Home](https://docs.pydantic.dev/latest/) — models, `Field`, constrained types (`condecimal`), `Decimal` handling.
- [Bybit V5 API — Introduction](https://bybit-exchange.github.io/docs/v5/intro) — testnet vs mainnet base URLs, auth, `category` semantics.
- [Bybit V5 — Instruments Info](https://bybit-exchange.github.io/docs/v5/market/instrument) — `lotSizeFilter`, `priceFilter`, `leverageFilter` used to validate params before going live.
