# Price fixture format

Price tables are uploaded as a versioned draft and become eligible only after validation and activation. A table is identified by tenant, provider, instrument, effective period, version label, and checksum. Optimizer runs freeze the selected `price_table_version_ids`; later activation cannot change an existing recommendation.

Each item must identify the provider SKU, service code, region, term in months, payment option, on-demand hourly rate, commitment hourly rate, and any upfront cost in integer cents. Provider and instrument are paired explicitly:

- AWS: `compute_savings_plan` or `reserved_instance`.
- Azure: `savings_plan` or `reservation`.
- GCP: `committed_use_discount`.

Use the recorded fixtures under `tests/fixtures/pricing` as the smallest working examples. A missing SKU is excluded with an explanation. An overlapping effective period, provider mismatch, unsupported instrument, or stale active table blocks affected recommendations instead of silently falling back to another rate.
