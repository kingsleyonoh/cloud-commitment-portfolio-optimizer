# Retry-After Is the Remaining Rolling-Window Delay

- **Symptom:** An actual-HTTP rate-limit test intermittently expects `Retry-After: 60` but receives a smaller positive integer such as `58` or `59`.
- **Cause:** The protected-route limiter emits `ceil(oldest_admission + window - now)` in seconds. Time spent serving admitted requests reduces the remaining rolling-window delay, so an uncontrolled wall clock cannot deterministically produce the full configured window.
- **Solution:** Preserve the remaining-delay implementation. For exact assertions, inject a controllable limiter clock and advance it explicitly; separately cover ceiling behavior and admission at the exact expiry boundary. Never replace the remaining delay with the configured window or widen the rate limit.
- **Discovered in:** Cloud Commitment Portfolio Optimizer, batch 011, 2026-07-22.
- **Affects:** Actual-HTTP tests of local or Redis rolling-window limiters whenever request processing can cross a one-second boundary.
