# Build metadata

`deno task build` and `deno task build:fast` generate `static/version.json`
(served at `/version.json`) and `version-build/app-version.js`. Import the
latter's `appVersion` for the running build; do not replace it with fetched
metadata. The placeholder permits imports before a build. The generator reads
`package.json` and the current Git SHA, or `APP_BUILD_SHA` when Git is absent.
`APP_BUILD_CHANNEL` describes this build and defaults to `unknown`; it is not
inferred from `DENO_ENV`. An absent SHA remains empty so consumers can decline
comparisons. The generated timestamp is UTC build time.

Docker builds run the generator before Fresh. Since `.git` is excluded from the
image context, callers must pass `APP_BUILD_SHA` and an appropriate
`APP_BUILD_CHANNEL` as build arguments. The production workflow supplies both
to CodeBuild; other CodeBuild callers must supply them for comparable metadata.
Static deployments under a base path must resolve `version.json` relative to
that deployed base. The UI and update checker are separate integration scopes;
they must import the baked module and mount their components before this metadata
is visible or update checks run.
