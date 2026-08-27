# Credential-free fixture boundary

`npm run setup` does not discover or execute SQL from this directory. It runs the accepted migrations, then invokes the typed application initializer that creates the first tenant and API-key metadata transactionally.

Static SQL must never create tenants, users, API keys, plaintext credentials, credential hashes, or first-run provenance. Future deterministic product fixtures belong to a separate typed conversion/import path and must remain credential-free.
