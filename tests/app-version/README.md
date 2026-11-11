# App version integration checks

Start a locally built application separately, then run:

```sh
APP_VERSION_TEST_BASE_URL=http://127.0.0.1:8000/ node --test tests/app-version/web-contract.test.mjs
```

The base URL may include a deployment prefix, such as
`http://127.0.0.1:8000/project/`. The test only permits loopback hosts and
never starts, deploys, or changes the application. It checks the real HTTP
metadata and server-rendered footer; it expects an ISO date in the label and
at least the first seven SHA characters. If the final label intentionally uses
a different date representation, adapt that assertion to its specified format.

These checks do not establish that metadata was baked into the build or remains
immutable when the remote response changes. Once the sibling implementations
are available, integration still needs executable tests of the build hook,
semver and rebuild ordering, malformed/offline responses, polling and cleanup,
user-triggered service-worker activation and bounded fallback, route-preserving
cache-busting reload, and any actual platform-specific update flow. The label
and updater must also be mounted before live integration can be claimed.
