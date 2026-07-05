---
name: testing-paper-trading
description: Safely testing crypto trading code for a multi-bot Bybit platform in Python, before any real capital is at risk. Covers Bybit testnet (api-testnet.bybit.com) and demo trading (api-demo.bybit.com) environments and their limits, paper/dry-run mode (Freqtrade-style simulated wallet), deterministic and reproducible backtests (fixed seeds, static pairlists, no look-ahead/next-bar fills), mocking the Bybit REST/WebSocket API with pytest fixtures and responses/respx, replaying recorded market data, property-based tests for order/position/PnL logic with Hypothesis, pytest patterns (fixtures, parametrize, freezegun, pytest-asyncio), CI for trading code, and gating live deployment behind green tests and a testnet smoke run. Invoke when the task mentions testnet, demo trading, paper trading, dry-run, backtest, look-ahead bias, mock exchange, replay market data, pytest, fixture, parametrize, Hypothesis/property-based, freezegun, deterministic, reproducible, CI gate, or "test before going live".
---

# Testing & Paper Trading

## When to use this skill
- Writing tests for order construction, position sizing, PnL, risk limits, or strategy signals.
- Wiring the bot to Bybit **testnet** or **demo trading** instead of mainnet.
- Building a **dry-run/paper** mode with a simulated wallet.
- Writing or reviewing a **backtest** and worrying about look-ahead bias / reproducibility.
- Mocking the Bybit REST/WS API so tests run offline and deterministically.
- Setting up CI and a deploy gate so live trading only starts after tests pass.

## Core concepts
Defense-in-depth for correctness, ordered from cheapest/fastest to most realistic:
1. **Unit tests** — pure logic (sizing, PnL, rounding) with mocked I/O. Millisecond feedback.
2. **Property-based tests** — invariants over generated inputs (Hypothesis).
3. **Backtest** — strategy over historical bars; fast but assumes fills; prone to bias.
4. **Dry-run / paper** — live market data, **simulated** orders/wallet, nothing hits the exchange.
5. **Testnet / demo** — real API + matching engine with fake money; validates auth, signing, rate limits, WS.
6. **Mainnet canary** — tiny size, tight risk caps, heavy monitoring.

Key hazards:
- **Look-ahead bias**: using data (a bar's close, a future value) not yet available at decision time. The classic fix: decide on bar *t*'s close, **fill at bar t+1's open**.
- **Reproducibility**: same inputs → same result. Requires fixed RNG seeds, frozen time, static (not dynamic) instrument lists, and pinned data snapshots.
- **Backtest ≠ live**: backtests assume every order fills instantly at a known price; live has partial fills, slippage, latency, fees, funding, and rejects. Dry-run narrows this gap but still won't reproduce fills that depend on your own liquidity impact.

## Bybit / Python specifics
Two separate simulated environments — don't confuse them:
- **Testnet**: REST base `https://api-testnet.bybit.com`, full public + private WS. Separate site/accounts from mainnet; request test coins from the testnet faucet. Good for end-to-end API/signing/WS validation. Testnet liquidity and prices are unrealistic.
- **Demo trading**: REST base `https://api-demo.bybit.com`, WS `wss://stream-demo.bybit.com` (**private streams only**; historically **no WebSocket API / no public WS**). It runs on **mainnet market data** in UTA mode and seeds ~50,000 USDT / 50,000 USDC / 1 BTC / 1 ETH simulated. Create the demo key from the **mainnet** site, not testnet. More realistic prices than testnet, but not a real matching engine for fills.
- **Switching**: with `pybit`, `HTTP(testnet=True, ...)` or `demo=True`; with CCXT, `exchange.set_sandbox_mode(True)` points to Bybit testnet. Keep the environment in config, never hard-code mainnet.
- **Dry-run pattern (Freqtrade-style)**: in dry-run only read-only calls hit the exchange; the wallet is simulated from `dry_run_wallet` and orders are filled against live prices without being posted. Reproduce this in-house with an `ExchangeClient` interface and a `PaperExchange` implementation.
- **pytest stack**: `pytest`, `pytest-asyncio` (async bot loops), `responses`/`respx` (mock `requests`/`httpx` REST calls), `freezegun` (freeze `datetime.now`), `hypothesis` (property tests), `pytest-cov`. Mock the exchange at the client boundary, not deep in library internals.
- **Recorded-data replay**: capture real WS frames / kline responses to fixtures (JSON) and replay them through the same parsing/strategy code path for deterministic integration tests and regression pinning.
- **Backtesting engines**: `backtesting.py`, `vectorbt`, `Freqtrade`, or `Jesse` — verify each's fill assumption; prefer next-bar-open fills and explicit fee/slippage models.

## Implementation checklist
- [ ] Put the exchange behind an interface; provide `LiveExchange`, `PaperExchange`, and a `MockExchange` for tests.
- [ ] Env/config selects mainnet vs testnet vs demo vs paper — never hard-code; default to the safest.
- [ ] Unit-test order construction, rounding to Bybit tick/step size, position sizing, PnL, fees, and every risk limit.
- [ ] Property-test invariants with Hypothesis (see patterns) with a modest `max_examples` in PR CI, larger nightly.
- [ ] Backtest with **next-bar fills**, explicit fees + slippage + funding; assert no future data is read.
- [ ] Make backtests reproducible: fixed seed, frozen time (`freezegun`), pinned historical dataset, static instrument list.
- [ ] Mock REST with `responses`/`respx`; replay recorded WS frames for integration tests — no network in unit/integration tiers.
- [ ] Run a **testnet smoke test**: authenticate, place+cancel an order, receive a private WS update — proves signing/WS/rate-limit handling.
- [ ] Run a **demo/dry-run soak** on live prices before mainnet, watching the same metrics/alerts as prod.
- [ ] CI runs lint + type-check + unit + property + integration on every PR; gate merge on green.
- [ ] Deploy gate: block live-trading rollout unless tests pass AND a testnet smoke run succeeded; start mainnet as a tiny canary.

## Do / Don't
**Do**
- Fill backtests at the **next bar's open**, not the signal bar's close, to avoid look-ahead.
- Seed all RNG and freeze time so a failing test/backtest reproduces exactly.
- Mock at the exchange-client boundary so tests are offline, fast, and deterministic.
- Run testnet/demo/dry-run before mainnet and diff behavior; expect fills to differ.
- Model fees, slippage, funding, and partial fills — omitting them inflates backtest PnL.

**Don't**
- Don't create a demo key from the testnet site (demo lives on mainnet) — and don't expect demo public WS / WS API.
- Don't test against mainnet with real funds "just to check".
- Don't let a test hit the real network — flaky, slow, and can place real orders if misconfigured.
- Don't trust a backtest that assumes instant, full, zero-slippage fills.
- Don't compare a static-pairlist backtest to a dynamic-pairlist live run and expect matching results.
- Don't ship to live on green unit tests alone — require a testnet/demo smoke run in the gate.

## Common pitfalls
- **Look-ahead bias**: indicators computed on a bar you then trade *within*; shifting signals by one bar changes results dramatically.
- **Survivorship / static-vs-dynamic pairlists**: dynamic pairlists make backtests non-reproducible and optimistic.
- **Overfitting** to a single historical window; validate out-of-sample / walk-forward.
- **Fees & funding ignored**: perpetual funding and taker fees can flip a "profitable" strategy negative.
- **Fill fantasy**: limit orders that "always fill" in backtest but sit unfilled live due to volume/queue position.
- **Non-deterministic tests**: unseeded RNG, real `datetime.now()`, or network calls → flaky CI.
- **Testnet price divergence**: thin testnet books produce unrealistic prices; use demo (mainnet data) for price realism.
- **Time zones / bar timestamps**: off-by-one on candle open vs close time silently introduces look-ahead.

## Code patterns
```python
# Exchange behind an interface -> swap Live/Paper/Mock; keeps live orders out of tests.
from typing import Protocol
class ExchangeClient(Protocol):
    def place_order(self, **kw) -> dict: ...
    def cancel_order(self, **kw) -> dict: ...

class PaperExchange:                       # dry-run: simulated wallet, live prices
    def __init__(self, balance=50_000.0): self.balance = balance; self.fills = []
    def place_order(self, symbol, side, qty, price, **kw):
        self.fills.append((symbol, side, qty, price))   # never hits Bybit
        return {"retCode": 0, "result": {"orderId": f"paper-{len(self.fills)}"}}
```

```python
# Property-based tests for order/PnL invariants (Hypothesis).
from hypothesis import given, strategies as st

@given(entry=st.floats(1, 1e6), exit=st.floats(1, 1e6),
       qty=st.floats(0.0001, 100), side=st.sampled_from(["Buy", "Sell"]))
def test_pnl_sign_matches_direction(entry, exit, qty, side):
    pnl = realized_pnl(side, entry, exit, qty)
    if side == "Buy":
        assert (pnl > 0) == (exit > entry)          # long profits when price rises
    else:
        assert (pnl > 0) == (exit < entry)          # short profits when price falls

@given(qty=st.floats(0.0001, 100), tick=st.sampled_from([0.1, 0.5, 1.0]))
def test_round_to_tick_is_idempotent(qty, tick):
    once = round_to_tick(qty, tick)
    assert round_to_tick(once, tick) == once        # rounding twice == once
```

```python
# Deterministic backtest fill: decide on close of t, FILL at open of t+1 (no look-ahead).
import pandas as pd
def backtest(df: pd.DataFrame, signal_fn, fee=0.00055, slippage=0.0005):
    df = df.copy(); df["signal"] = signal_fn(df).shift(1)   # shift => act next bar
    df["ret"] = df["open"].pct_change().shift(-1)           # fill at next open
    df["strat"] = df["signal"] * df["ret"] - df["signal"].diff().abs() * (fee + slippage)
    return df["strat"].fillna(0).add(1).cumprod()           # equity curve
```

```python
# Offline REST mock + frozen time -> reproducible unit test (responses + freezegun).
import responses, freezegun
@responses.activate
@freezegun.freeze_time("2026-07-05T00:00:00Z")
def test_place_order_signs_and_parses():
    responses.add(responses.POST,
        "https://api-testnet.bybit.com/v5/order/create",
        json={"retCode": 0, "result": {"orderId": "abc"}}, status=200)
    assert client.place_order(symbol="BTCUSDT", side="Buy", qty="0.001")["orderId"] == "abc"
```

## References
- [Bybit V5 — Demo Trading Service](https://bybit-exchange.github.io/docs/v5/demo) — demo endpoints, seeded balances, UTA, private-WS-only limitation.
- [Bybit V5 — Introduction](https://bybit-exchange.github.io/docs/v5/intro) — mainnet/testnet base URLs and environment overview.
- [Bybit V5 — Integration Guidance](https://bybit-exchange.github.io/docs/v5/guide) — signing, `recv_window`, rate limits to exercise on testnet.
- [Bybit Help — Request Test Coins on Testnet](https://www.bybit.com/en/help-center/article/How-to-Request-Test-Coins-on-Testnet) — funding a testnet account.
- [pytest documentation](https://docs.pytest.org/en/stable/) — fixtures, parametrize, markers, config.
- [pytest-asyncio](https://pytest-asyncio.readthedocs.io/en/latest/) — testing asyncio bot loops.
- [Hypothesis documentation](https://hypothesis.readthedocs.io/en/latest/) — property-based testing, strategies, `@given`, shrinking.
- [responses (GitHub)](https://github.com/getsentry/responses) — mock `requests` HTTP for offline REST tests.
- [respx](https://lundberg.github.io/respx/) — mock `httpx`/async HTTP calls.
- [freezegun (GitHub)](https://github.com/spulec/freezegun) — freeze time for deterministic tests/backtests.
- [Freqtrade — Backtesting](https://www.freqtrade.io/en/stable/backtesting/) — fill assumptions, biases, reproducibility caveats.
- [Freqtrade — Bot basics (dry-run vs live)](https://www.freqtrade.io/en/stable/bot-basics/) — dry-run simulated wallet, differences from backtest and live.
- [backtesting.py docs](https://kernc.github.io/backtesting.py/) — lightweight event-driven backtester with explicit fills.
