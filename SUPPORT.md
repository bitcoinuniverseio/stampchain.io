# Support

Where to take a question, by what kind of question it is.

## Before asking

- [`docs/README.md`](docs/README.md) is the documentation map.
- [`docs/API.md`](docs/API.md) covers versioning, API keys, rate limits, and error shapes.
- [`schema.yml`](schema.yml) is the interface itself. Browse it at
  [stampchain.io/docs](https://stampchain.io/docs).

## Where to go

| Situation | Where |
| --- | --- |
| Security vulnerability | **Do not open a public issue.** Follow [`SECURITY.md`](SECURITY.md). |
| Bug in the explorer or the API | [Open an issue](https://github.com/bitcoinuniverseio/stampchain.io/issues) in this repository. |
| An endpoint returns data you believe is wrong for a stamp or token | Very likely an indexing question, not an API question. See "Is this an API bug or an indexer bug?" below. |
| Rate limited and you need higher limits | Get a free key with `POST /api/v2/keys`. For partner-tier limits, ask through the channels below. |
| Protocol design question or a proposal | The protocol lives in the indexer repository. Open a Stamps Improvement Proposal there. |
| General discussion, ecosystem questions | [Bitcoin Stamps Telegram](https://t.me/BitcoinStamps) |
| Protocol reference site | [bitcoinstamps.xyz](https://bitcoinstamps.xyz) |

## Is this an API bug or an indexer bug?

This service does not index the blockchain. It reads a database that the
[Bitcoin Stamps indexer](https://github.com/bitcoinuniverseio/btc_stamps) writes, over a
read-only connection.

| Symptom | Repository |
| --- | --- |
| Wrong HTTP status, wrong response shape, pagination is off, CORS, rate limits, a 500 | This repository. |
| An endpoint is missing or undocumented | This repository. |
| A stamp is missing, numbered oddly, or marked cursed | Indexer. |
| An SRC-20 balance disagrees with another explorer | Indexer. Include the block height. |
| A mint you expected to be rejected was credited at a lower amount | Indexer, and it is probably correct: over-limit mints are reduced, not rejected. See the indexer's [consensus reference](https://github.com/bitcoinuniverseio/btc_stamps/blob/main/docs/CONSENSUS.md#the-clamping-rule). |
| Data is stale by a few blocks | Either. Check `GET /api/v2/health` and `GET /api/v2/block/block_count/{number}` first. |

## Filing a good API issue

Include:

- the **full request URL** including query string, and the HTTP method;
- the **response status**, the response body, and the `X-RateLimit-*` headers if present;
- whether you sent an `X-API-Key`, and which tier it is (do not paste the key itself);
- what you expected instead;
- whether it reproduces against `https://stampchain.io` or only locally.

If the endpoint is not in [`schema.yml`](schema.yml), say so. Roughly 17 routes under
`/api/v2/` are not in the contract and are not covered by the runtime validator, so their
behaviour can change without a version bump.

## What is not supported here

- The `/api/internal/` routes. They exist for this site's own front end, are guarded, and are
  deliberately absent from the contract. Building against them is not supported and they can
  change at any time.
- Investment, trading, or price questions.
- Help recovering funds or reversing a transaction.

## Response expectations

This is community-maintained software provided without warranty under
[AGPL-3.0](LICENSE.md). Issues are triaged on a best effort basis. Security reports follow the
timeline in [`SECURITY.md`](SECURITY.md).
