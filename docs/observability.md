# Observability and operating thresholds

The API emits JSON logs with event names, request IDs, trace IDs, span IDs, route templates, status codes, and bounded business identifiers. Incoming W3C `traceparent` values are accepted only when structurally valid; a new span is returned in the response and logged. Sensitive headers, credentials, URLs, hashes, raw rows, and client IP values continue to be redacted by the shared logger.

The worker emits `worker.ready`, `worker.cycle.completed`, `worker.cycle.failed`, and `queue.lag`. `queue.lag` measures the depth and oldest age of queued or running import, forecast, optimizer, backtest, report, and ecosystem work from PostgreSQL. It is a bounded operational signal, not a tenant-facing API value.

## Alerts

The thresholds in `docs/observability/alerts.yml` are intentionally conservative defaults. Connect them to the host's log/metric collector and page only after confirming the service's normal load profile.

- Readiness unavailable for five minutes: remove the instance from traffic and inspect PostgreSQL, Redis, object storage, or migration state.
- Queue lag above 120 seconds for five minutes: inspect worker health, database locks, and failed adapter attempts.
- Worker cycle failures or HTTP 5xx above the stated threshold: preserve the event correlation IDs and investigate without copying request bodies into tickets.

There is no live OTLP exporter in the local build and no analytics SDK in the browser. `OTEL_EXPORTER_OTLP_ENDPOINT`, Sentry, and product analytics variables remain opt-in configuration boundaries; enabling them requires the operator's own approved collector and privacy review.
