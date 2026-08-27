# Self-hosted deployment

The production Compose file runs PostgreSQL, Redis, a one-shot migration gate, the API, and a polling worker. The API and worker share the object-storage volume. Optional Notification Hub and Workflow Engine adapters remain disabled unless their explicit environment flags and credentials are supplied. Invoice Reconciliation is always kept disabled until its endpoint contract is verified.

## Before starting

1. Copy `.env.example` to a private environment file and fill the required deployment values. Keep passwords, API keys, and JWT files outside Git.
2. Generate a matching RSA private/public JWT pair, then set `JWT_PRIVATE_KEY_PATH` and `JWT_PUBLIC_KEY_PATH` to readable host files.
3. Set `APP_PUBLIC_URL` and `ALLOWED_ORIGINS` to the exact HTTPS origin used by the browser. `DATABASE_URL` must be reachable from the Compose network.
4. Confirm Docker Compose is available and review the resource limits in `docker-compose.prod.yml`.

## Start and upgrade

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml config
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
docker compose --env-file .env.production -f docker-compose.prod.yml ps
curl -fsS https://optimizer.example.test/health
curl -fsS https://optimizer.example.test/health/ready
```

The `migrate` service must complete before the API or worker starts. An upgrade is the same command: the migration runner applies each ordered file once and verifies unchanged checksums on later runs. Do not bypass the migration gate.

## Backup

Back up the PostgreSQL database and the object-storage volume together so report, forecast, optimizer, and import references remain meaningful.

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U user -d ccpo --format=custom > ccpo-$(date -u +%Y%m%dT%H%M%SZ).dump
docker run --rm -v cloud-commitment-portfolio-optimizer_app_objects:/objects \
  -v "$PWD/backups:/backup" alpine:3.20 \
  tar -czf /backup/app-objects-$(date -u +%Y%m%dT%H%M%SZ).tar.gz -C /objects .
```

Store dumps and object archives in an access-controlled location with an agreed retention period. Never put `.env.production`, JWT files, or adapter keys in the backup directory.

## Restore

Stop writers first, restore the database into the intended database, restore the matching object archive, then run the migration gate and readiness checks.

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml stop app worker
cat ccpo-20260826T000000Z.dump | docker compose --env-file .env.production -f docker-compose.prod.yml exec -T postgres \
  pg_restore -U user -d ccpo --clean --if-exists --no-owner --no-privileges
docker run --rm -v cloud-commitment-portfolio-optimizer_app_objects:/objects \
  -v "$PWD/backups:/backup" alpine:3.20 \
  sh -c 'rm -rf /objects/* && tar -xzf /backup/app-objects-20260826T000000Z.tar.gz -C /objects'
docker compose --env-file .env.production -f docker-compose.prod.yml up -d migrate app worker
```

Validate `/health/ready`, inspect migration output, and verify a tenant-scoped report read before reopening traffic. A restore is an operator action; this project does not deploy or mutate a live environment automatically.
