# BITCOIN STAMPS EXPLORER AND API

[![Code Quality](https://github.com/stampchain-io/stampchain.io/actions/workflows/deploy.yml/badge.svg)](https://github.com/stampchain-io/stampchain.io/actions/workflows/deploy.yml)
[![Unit Tests](https://github.com/stampchain-io/stampchain.io/actions/workflows/unit-tests.yml/badge.svg)](https://github.com/stampchain-io/stampchain.io/actions/workflows/unit-tests.yml)
[![Integration Tests](https://github.com/stampchain-io/stampchain.io/actions/workflows/integration-tests.yml/badge.svg)](https://github.com/stampchain-io/stampchain.io/actions/workflows/integration-tests.yml)
[![TypeScript Type Checking](https://github.com/stampchain-io/stampchain.io/actions/workflows/type-check.yml/badge.svg)](https://github.com/stampchain-io/stampchain.io/actions/workflows/type-check.yml)
[![Newman API Tests](https://github.com/stampchain-io/stampchain.io/actions/workflows/newman-comprehensive-tests.yml/badge.svg)](https://github.com/stampchain-io/stampchain.io/actions/workflows/newman-comprehensive-tests.yml)
[![Docker Build Test](https://github.com/stampchain-io/stampchain.io/actions/workflows/docker-test.yml/badge.svg)](https://github.com/stampchain-io/stampchain.io/actions/workflows/docker-test.yml)
[![Actionlint](https://github.com/stampchain-io/stampchain.io/actions/workflows/actionlint.yml/badge.svg)](https://github.com/stampchain-io/stampchain.io/actions/workflows/actionlint.yml)

This is the official API and block explorer for
[Bitcoin Stamps](https://stampchain.io/). It provides a comprehensive interface
for exploring Bitcoin Stamps transactions and metadata, working in conjunction
with the [Bitcoin Stamps Indexer](https://github.com/bitcoinuniverseio/btc_stamps).

## Documentation

**Start at [`docs/README.md`](docs/README.md), the documentation map for this repository.**

| Document | Answers |
|----------|---------|
| [`docs/API.md`](docs/API.md) | How to call the API: versioning, API keys, rate limit tiers, error shapes, and which routes are public. |
| [`schema.yml`](schema.yml) | The OpenAPI 3.0.3 contract itself. Browsable at [stampchain.io/docs](https://stampchain.io/docs). |
| [`SUPPORT.md`](SUPPORT.md) | Where to take a question, including how to tell an API bug from an indexer bug. |
| [`SECURITY.md`](SECURITY.md) | Reporting vulnerabilities, and how npm development dependencies are handled in this Deno project. |

## What this is, and what it is not

This service **reads** a MySQL database that the
[Bitcoin Stamps indexer](https://github.com/bitcoinuniverseio/btc_stamps) writes. It does not
connect to a Bitcoin node, does not parse transactions, and does not decide what counts as a
stamp. Its database user is expected to be read-only.

```
Bitcoin node ──▶ btc_stamps indexer ──▶ MySQL ──▶ this service ──▶ REST API + explorer UI
                        │                                ▲
                        └── block/reorg webhook ──────────┘
                            (/api/internal/bitcoinNotifications, invalidates caches)
```

Consequences worth knowing before you file an issue:

- Questions about **why** a transaction became a stamp, which activation height applied, or why
  an SRC-20 mint was credited at a reduced amount belong to the indexer. Its
  [consensus reference](https://github.com/bitcoinuniverseio/btc_stamps/blob/main/docs/CONSENSUS.md)
  answers them.
- This service holds no consensus state. Restoring it means repointing it at a database, not
  resyncing a chain.
- `schema.yml` is enforced at runtime by `routes/api/_middleware.ts` on both the request and the
  response. Changing an endpoint without changing the schema breaks the endpoint.

## Features

- Full Bitcoin Stamps block explorer
- REST API described by an OpenAPI 3.0.3 contract, 55 paths across 13 tags
- Support for classic Stamps, SRC-20, SRC-721, and SRC-101
- Free API keys with higher rate limits, plus a partner tier

## Prerequisites

1. **Install Deno**
   > ⚠️ **Required Version**: 2.6.9
   ```sh
   curl -fsSL https://deno.land/install.sh | sh
   ```

   Add Deno to your path:
   ```sh
   echo 'export DENO_INSTALL="$HOME/.deno"' >> ~/.bashrc
   echo 'export PATH="$DENO_INSTALL/bin:$PATH"' >> ~/.bashrc
   source ~/.bashrc
   ```

2. **Required Services**
   - MySQL/MariaDB (with read-only user access)
   - Redis (for caching)
   - Bitcoin Stamps Indexer database

## Installation

1. **Clone the repository:**
   ```sh
   git clone https://github.com/bitcoinuniverseio/stampchain.io.git
   cd stampchain.io
   ```

2. **Environment Setup**
   ```sh
   cp .env.sample .env
   # Edit .env with your configuration
   ```

   ⚠️ **IMPORTANT**: Ensure DB_USER has READ-ONLY permissions for security!

## Development Commands

```sh
# Start development server with hot reload and debugging (auto-loads Chrome if available)
deno task dev

# Code quality checks (formatting, linting, type checking)
deno task check

# Update Fresh framework
deno task update

# Decode SRC-20 transactions
deno task decode
deno task decode_olga

# Validate the OpenAPI contract (redocly lint)
npm run validate:schema
```

## Production Deployment

### 1. Local or Server Deployment

```sh
# Build the project:
deno task build

# Start production server:
deno task start
```

### 2. Docker Deployment

```sh
docker build -t btc-stamps-explorer:2.6.9 .
docker run -p 8000:8000 btc-stamps-explorer:2.6.9
```

The container uses:
- Ubuntu 22.04 base image
- Deno 2.6.9
- Production environment
- Port 8000
- Required permissions for network, file system, and environment variables

For development with Docker:

```sh
# Build with development tag
docker build -t btc-stamps-explorer:dev .

# Run with mounted volumes for development
docker run -p 8000:8000 \
    --env-file .env \
    -v $(pwd):/app \
    btc-stamps-explorer:dev deno task dev
```

## API Documentation

- OpenAPI/Swagger documentation available at `/docs`
- The contract is [`schema.yml`](schema.yml) at the repository root.
  `static/swagger/openapi.yml` is a symlink to it for the bundled Swagger UI; point tooling at
  `schema.yml`.
- Validate it with `npm run validate:schema` (redocly lint against `.redocly.yaml`)
- Guide to using the API: [`docs/API.md`](docs/API.md)

## Contributing

1. Fork the repository
2. Create your feature branch
3. Run `deno task check` to ensure code quality
4. If you touched an endpoint, update [`schema.yml`](schema.yml) in the same commit and run
   `npm run validate:schema`
5. Add tests for new features
6. Submit a pull request

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the full workflow and [`SUPPORT.md`](SUPPORT.md)
for where to take questions.

## Additional Resources

- [Bitcoin Stamps Indexer](https://github.com/bitcoinuniverseio/btc_stamps)
- [Indexer consensus reference](https://github.com/bitcoinuniverseio/btc_stamps/blob/main/docs/CONSENSUS.md)
- [API Documentation](https://stampchain.io/docs)
- [Discussion Board](https://github.com/orgs/stampchain-io/discussions)

## License

This project is licensed under the [AGPL-3.0 License](LICENSE.md).
