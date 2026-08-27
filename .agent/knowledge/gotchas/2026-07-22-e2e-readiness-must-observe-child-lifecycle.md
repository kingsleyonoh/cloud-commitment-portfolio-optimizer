# E2E Readiness Must Observe the Child Lifecycle

- **Symptom:** A real-HTTP E2E server intermittently reports a generic readiness timeout after a loaded suite, or waits until timeout when the child process could not spawn.
- **Cause:** A short readiness budget can expire during legitimate CPU-intensive cold start, while polling only a port and watching only the child close event hides the distinct spawn-error and HTTP-not-ready states.
- **Solution:** Use one configurable monotonic startup deadline across the readiness signal and bounded `/health` polling. Race readiness against both child close and child error, include bounded captured output (or state that none was captured), and always reap the exact child on every failed-start path. Size the finite default for measured loaded-suite cold start rather than adding sleeps.
- **Discovered in:** Cloud Commitment Portfolio Optimizer, batch 012, 2026-07-22.
- **Affects:** Playwright or other local E2E harnesses that spawn a real application process, especially when startup performs CPU- or memory-hard initialization after large test suites.
