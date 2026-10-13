# @pragmatic-tech-ai/todl-platform-aws

AWS-backed platform adapters for `pragmatic-server` running in `DeploymentMode.Cloud`:

- **S3ObjectStore** — an `IStorage` over Amazon S3 (behind an injectable `IS3Bucket` seam).
- **AwsSecretsManagerSecretStore** — an identity `ISecretStore` over AWS Secrets Manager (Stage B).
- **RdsPoolFactory** — a managed-Postgres `pg.Pool` over Amazon RDS/Aurora (Stage C).

Each adapter is constructed over an injectable client seam so it is unit-testable without a network;
the `Real*` wrappers own the `@aws-sdk/*` client construction. The package mirrors the
`todl-platform-gcp` sibling one-for-one.

## Build & test

```
npm install
npx tsc -p tsconfig.build.json --noEmit
npx tsx --test "src/**/*.test.ts"
```

Emulator/live tests are opt-in and skip cleanly when their env var is unset — the default run needs no
Docker or AWS account. See `docker-compose.emulators.yml` for launching LocalStack/MinIO and the
`PRAGMATIC_TEST_S3_*` variables the gated tests read.

LOCAL repository (no remote).
