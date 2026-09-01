# Documentation map

Everything written down about this service, grouped by what you are trying to do. Paths are
relative to the repository root.

## Start here

| I want to | Read |
| --- | --- |
| Understand what this is and run it locally | [`README.md`](../README.md) |
| Call the public API | [`docs/API.md`](./API.md), then [`schema.yml`](../schema.yml) |
| Contribute a change | [`CONTRIBUTING.md`](../CONTRIBUTING.md) |
| Report a security issue | [`SECURITY.md`](../SECURITY.md) |
| Get help | [`SUPPORT.md`](../SUPPORT.md) |
| Understand how a transaction became a stamp | The indexer, not this repository. See [btc_stamps consensus reference](https://github.com/bitcoinuniverseio/btc_stamps/blob/main/docs/CONSENSUS.md). |

## API

| Document | Covers |
| --- | --- |
| [`docs/API.md`](./API.md) | Versioning, authentication, rate limit tiers, error shapes, what is public and what is internal, and how the contract is enforced at runtime. |
| [`schema.yml`](../schema.yml) | The OpenAPI 3.0.3 contract. 55 paths across 13 tags. This is the interface, not a description of it. |
| [`docs/API_ENDPOINT_AUDIT.md`](./API_ENDPOINT_AUDIT.md) | Endpoint-by-endpoint audit notes. |
| [`docs/internal-endpoints-migration-plan.md`](./internal-endpoints-migration-plan.md) | Plan for the `/api/internal/` split. |
| [`documentation/internal-endpoints-inventory.json`](../documentation/internal-endpoints-inventory.json) | Machine-readable inventory of the internal endpoints. |

## Subsystems

| Document | Covers |
| --- | --- |
| [`docs/fee_system_architecture.md`](./fee_system_architecture.md) | Fee estimation architecture. |
| [`docs/floor-price-cache-system.md`](./floor-price-cache-system.md) | Floor price caching. |
| [`docs/stamp_utxo_fetching.md`](./stamp_utxo_fetching.md) | UTXO fetching for stamps. |
| [`docs/task_25_btc_price_optimization.md`](./task_25_btc_price_optimization.md) | BTC price lookup optimization. |
| [`docs/task_24_implementation_guide.md`](./task_24_implementation_guide.md) | Implementation notes for the related task. |
| [`CACHE-MIGRATION-NOTES.md`](../CACHE-MIGRATION-NOTES.md) | Cache migration history. |

## Testing

| Document | Covers |
| --- | --- |
| [`docs/TESTING.md`](./TESTING.md) | The test strategy overall. |
| [`docs/TEST_DATA_STRATEGY.md`](./TEST_DATA_STRATEGY.md) | How test data is chosen and kept stable. |
| [`docs/NEWMAN_TESTING.md`](./NEWMAN_TESTING.md) | Newman API testing basics. |
| [`docs/NEWMAN_COMPREHENSIVE_TESTING.md`](./NEWMAN_COMPREHENSIVE_TESTING.md) | The comprehensive Newman suite. |
| [`docs/POSTMAN_COLLECTION_GUIDE.md`](./POSTMAN_COLLECTION_GUIDE.md) | Working with the Postman collections in `tests/postman/`. |
| [`docs/DAILY_REGRESSION_TESTING.md`](./DAILY_REGRESSION_TESTING.md) | The daily dev-versus-prod regression run. |

## Operations and troubleshooting

| Document | Covers |
| --- | --- |
| [`env-templates/database-connection-variables.md`](../env-templates/database-connection-variables.md) | Database connection variables. |
| [`env-templates/database-pool-configuration.md`](../env-templates/database-pool-configuration.md) | Connection pool tuning. |
| [`env-templates/security-configuration.md`](../env-templates/security-configuration.md) | Security-related configuration. |
| [`docs/redis_troubleshooting_log.md`](./redis_troubleshooting_log.md) | Redis incidents and what fixed them. |
| [`docs/secp256k1_build_issue.md`](./secp256k1_build_issue.md) | A build issue and its workaround. |
| [`.github/workflows/README.md`](../.github/workflows/README.md) | What each CI workflow does. |

## Known gaps

| Document | Covers |
| --- | --- |
| [`docs/TECHNICAL_DEBT.md`](./TECHNICAL_DEBT.md) | Recorded technical debt. |

## Contributing to these docs

Keep documentation next to the code it describes. If you change an endpoint, change
[`schema.yml`](../schema.yml) in the same commit: the contract is validated against live
requests and responses at runtime, so a stale schema is a broken API rather than a stale
document.
