---
name: event-bus-messaging
description: Design inter-component messaging for a distributed multi-bot Bybit platform — choosing among Redis Pub/Sub, Redis Streams, Kafka, and NATS JetStream (or RabbitMQ) by delivery guarantee; decoupling data-feed → strategy → execution stages; at-least-once vs exactly-once, consumer groups, per-key ordering, idempotent consumers, dedup on order/fill events, and backpressure. Invoke when the user mentions event bus, message queue, pub/sub, Redis Streams, XADD/XREADGROUP/XACK, Kafka, consumer groups, partitions/offsets, NATS/JetStream, RabbitMQ, at-least-once, exactly-once, idempotent consumer, message ordering, backpressure, decoupling services, or fanning market data out to multiple bots.
---

# Event Bus & Messaging

## When to use this skill
- Wiring a data-feed → strategy → execution pipeline as decoupled services/processes.
- Fanning one Bybit market-data stream out to many bot/strategy consumers.
- Choosing a broker by delivery guarantee (fire-and-forget vs durable at-least-once).
- Implementing consumer groups so N workers share a queue and survive restarts.
- Guaranteeing per-symbol ordering and idempotent handling of order/fill events.
- Handling backpressure when strategies are slower than the market feed.

## Core concepts
- **Delivery guarantees**: *at-most-once* (may drop, never redeliver — Redis Pub/Sub), *at-least-once* (never drop, may redeliver → consumers must be idempotent), *exactly-once* (no loss, no dup — only within specific systems/boundaries, e.g. Kafka transactions).
- **Consumer group**: multiple consumers cooperatively split a stream/topic; each message goes to one member; the broker tracks progress so a crashed consumer's work is reassigned.
- **Ordering**: total ordering is expensive; you almost always want **per-key ordering** (all events for one `symbol` in order). Kafka orders within a partition; Redis Streams orders within a stream; route a key to a fixed partition/stream to preserve it.
- **Idempotent consumer**: processing the same message twice yields the same result — mandatory under at-least-once. Dedup on a stable business key (Bybit `orderId`/`execId`) or an event UUID.
- **Backpressure**: slow consumers must throttle producers or bound buffers, not OOM. Streams/queues give natural backpressure (pending grows, consumer pulls at its own rate); Pub/Sub does not (messages drop).
- **Acknowledgment / offsets**: at-least-once requires explicit ack (`XACK`, JetStream ack) or manual offset commit — never auto-ack before the work is durably done.

## Broker choice (by guarantee & need)
- **Redis Pub/Sub**: at-most-once, no persistence, no replay. Fine for ephemeral fan-out (live price ticks to dashboards) where a dropped message is harmless. Never for orders.
- **Redis Streams**: at-least-once with `XREADGROUP` consumer groups + `XACK` + a Pending Entries List (PEL); `XAUTOCLAIM`/`XCLAIM` recover messages from dead consumers. Lightweight, low-latency, already in your Redis. Great default for data-feed→strategy→execution when you don't need Kafka-scale retention.
- **Kafka**: at-least-once by default, **exactly-once** via idempotent producer + transactions + committing consumer offsets in the same transaction. Partitioned for horizontal scale, long retention, replay. Ordering guaranteed **per partition only**. Choose for high throughput, durable audit log, or replaying history.
- **NATS JetStream**: at-least-once with durable consumers, `AckExplicit`, `MaxDeliver`, and consumption-aware retention (WorkQueue deletes on ack; Interest keeps until all consumers ack). Single small binary, very low latency; `MaxAckPending` (default 1000) provides built-in backpressure.
- **RabbitMQ**: mature broker with flexible routing (exchanges), per-message ack, DLQ; at-least-once. Good for complex routing/work-queue topologies where throughput is modest.

Guideline for this platform: **Redis Streams** for the internal feed→strategy→execution bus (already have Redis, need at-least-once + groups); **Kafka** if you need a durable replayable event log / audit trail across many bots; **NATS** if you want the lightest low-latency option with durable consumers.

## Bybit / Python specifics
- Bybit WS delivers market data (`publicTrade`, `kline`, `orderbook`) and private events (`order`, `execution`, `position`). Put a single **data-feed service** on the WS, normalize, and publish onto the bus so N strategies consume without each opening its own WS (avoids duplicate connections / rate limits).
- Idempotency keys: private `execution` events carry `execId`; `order` events carry `orderId` + `orderLinkId`. Dedup fills on `execId`, order-state on `(orderId, updatedTime)`.
- Bybit private WS can redeliver on reconnect — treat all order/fill consumption as at-least-once and dedup.
- Preserve per-symbol order: use `symbol` as the Kafka partition key or a per-symbol Redis stream / NATS subject so a strategy sees ticks and fills in sequence.
- Python clients: `redis-py` (async) for Streams; `aiokafka`/`confluent-kafka` for Kafka; `nats-py` for JetStream. Use `orderLinkId` you generate as an idempotency token when *producing* orders so a retried execution command doesn't double-submit.

## Implementation checklist
- [ ] Draw stages: data-feed (producer) → strategy workers (consumer group) → execution service (consumer). One responsibility each.
- [ ] Pick the broker by the strictest guarantee any stage needs (orders/fills ⇒ at-least-once minimum).
- [ ] Use a consumer group per stage so workers scale horizontally and recover on crash.
- [ ] Key/partition by `symbol` to keep per-symbol ordering.
- [ ] Ack only **after** the work is durably done (DB write / order placed); never before.
- [ ] Make every consumer idempotent: dedup on `execId`/`orderId`/event UUID via a seen-set or unique DB constraint.
- [ ] Recover stuck messages: `XAUTOCLAIM` (Redis) / redelivery + `MaxDeliver` (NATS) / rebalance (Kafka); route repeated failures to a dead-letter stream/topic.
- [ ] Bound backpressure: cap in-flight (`MaxAckPending`, prefetch, PEL size) and alert when consumer lag grows.
- [ ] Add a monotonically increasing seq / event id so consumers can detect gaps.

## Do / Don't
**Do**
- Treat at-least-once as the default and make consumers idempotent.
- Ack/commit offsets only after successful, durable processing.
- Partition/route by `symbol` to preserve ordering that matters.
- Use consumer groups so a restarted worker resumes from the PEL/offset, not the beginning.
- Send a self-generated `orderLinkId` as an idempotency key when placing Bybit orders.

**Don't**
- Don't use Redis Pub/Sub for orders/fills — a disconnected subscriber silently loses messages.
- Don't auto-commit offsets / auto-ack before the handler finishes — that turns at-least-once into at-most-once.
- Don't assume global ordering across partitions/streams; it doesn't exist.
- Don't let a poison message loop forever — cap retries (`MaxDeliver`) and dead-letter it.
- Don't share one consumer name across processes in a Redis group — each consumer needs a stable unique name for its PEL.

## Common pitfalls
- **"Exactly-once" myths**: Kafka EOS holds only within its transaction boundary and a single producer session; a side effect to Bybit (placing an order) is external — you still need an idempotency key. Design for at-least-once + dedup.
- **Sequence gaps**: after a reconnect you may skip or replay; carry a seq id and reconcile against REST (`GET /v5/order/realtime`, `execution/list`) on gaps.
- **PEL leak (Redis)**: messages delivered but never `XACK`ed pile up in the pending list; run `XAUTOCLAIM` and monitor `XPENDING`.
- **Retention vs unacked (NATS)**: keep `MaxAge` far larger than `AckWait`×`MaxDeliver`, or a message expires while still being retried.
- **Unbounded fan-out**: one slow consumer in a fan-out can stall or blow memory if the broker buffers per-consumer — bound it and shed/alert.
- **Rebalance storms (Kafka)**: long processing without heartbeats triggers rebalances; tune `max.poll.interval.ms` / process async.

## Code patterns
```python
# Redis Streams: at-least-once producer + consumer group (redis-py asyncio)
import redis.asyncio as redis
r = redis.Redis()

# producer (data-feed): one stream per symbol preserves ordering
await r.xadd(f"ticks:{symbol}", {"px": str(price), "ts": ts, "id": event_id}, maxlen=100_000, approximate=True)

# create group once (idempotent)
try:
    await r.xgroup_create(f"ticks:{symbol}", "strategy", id="0", mkstream=True)
except redis.ResponseError:
    pass  # BUSYGROUP: already exists

# consumer worker
seen: set[str] = set()
while True:
    resp = await r.xreadgroup("strategy", consumer_name, {f"ticks:{symbol}": ">"}, count=64, block=5000)
    for _stream, msgs in resp or []:
        for msg_id, fields in msgs:
            eid = fields[b"id"].decode()
            if eid not in seen:            # idempotent: skip duplicates
                handle(fields)             # do the work first...
                seen.add(eid)
            await r.xack(f"ticks:{symbol}", "strategy", msg_id)   # ...then ack

# recover messages from a dead consumer (min-idle 60s)
await r.xautoclaim(f"ticks:{symbol}", "strategy", consumer_name, min_idle_time=60_000, start_id="0-0")
```
```python
# Kafka: manual commit AFTER processing = real at-least-once (aiokafka)
consumer = AIOKafkaConsumer("fills", group_id="exec", enable_auto_commit=False,
                            auto_offset_reset="earliest")
async for msg in consumer:          # msg.key = symbol -> per-partition ordering
    exec_id = json.loads(msg.value)["execId"]
    if not already_processed(exec_id):   # dedup on Bybit execId
        record_fill(msg.value)
    await consumer.commit()              # commit only after durable write
```

## References
- [Redis Streams — Redis Docs](https://redis.io/docs/latest/develop/data-types/streams/) — consumer groups, PEL, `XADD`/`XREADGROUP`/`XACK`, at-least-once semantics.
- [XREADGROUP — Redis Docs](https://redis.io/docs/latest/commands/xreadgroup/) — reading as a group, `>` vs history, Pending Entries List behavior.
- [XACK — Redis Docs](https://redis.io/docs/latest/commands/xack/) — acknowledging and removing messages from the PEL.
- [XPENDING — Redis Docs](https://redis.io/docs/latest/commands/xpending/) — inspecting undelivered/unacked messages for recovery and lag.
- [Apache Kafka Documentation](https://kafka.apache.org/documentation/) — partitions, consumer groups, offsets, idempotent producer, transactions.
- [Exactly-Once Semantics in Apache Kafka — Confluent](https://www.confluent.io/blog/exactly-once-semantics-are-possible-heres-how-apache-kafka-does-it/) — how idempotent producer + transactions achieve EOS and its boundaries.
- [JetStream Consumers — NATS Docs](https://docs.nats.io/nats-concepts/jetstream/consumers) — durable consumers, `AckExplicit`, `MaxDeliver`, `MaxAckPending` backpressure.
- [Compare NATS — NATS Docs](https://docs.nats.io/nats-concepts/overview/compare-nats) — NATS/JetStream vs Kafka/Redis/RabbitMQ tradeoffs and guarantees.
