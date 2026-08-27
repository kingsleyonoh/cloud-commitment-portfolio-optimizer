# Import mappings

Every accepted provider file is normalized into tenant-scoped canonical usage rows. The importer validates the account, provider, service, region, usage window, quantity, and cost control totals before a batch becomes `completed`. A failed control-total check or schema drift becomes `quarantined` with bounded diagnostics.

| Source | Accepted format | Canonical mapping | Control total |
|---|---|---|---|
| AWS Cost & Usage Report | CSV, Parquet, JSON snapshot, native CUR boundary | `lineItem/UsageStartDate`, `lineItem/ProductCode`, `product/region`, `lineItem/UsageAmount`, `lineItem/UnblendedCost` | Unblended cost by account/service/region/month |
| Azure Cost Management Export | CSV, Parquet, JSON snapshot | provider subscription, service name, resource location, usage quantity, pretax cost | Pretax cost by account/service/region/month |
| GCP Billing Export | CSV, Parquet, JSON snapshot | billing account, service description, location, usage amount, cost | Cost by account/service/region/month |
| Synthetic Scenario Generator | CSV, Parquet, JSON snapshot, small manual override | canonical fixture fields | Generated cost by account/service/region/month |

The API stores object references and summaries; rendered pages do not expose raw files, raw rows, credentials, or object URIs. Use the fixtures and `POST /api/imports` integration tests as the executable mapping contract.
