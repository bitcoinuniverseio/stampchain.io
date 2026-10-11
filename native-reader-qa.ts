// Run with the original application config and explicit frozen deno.lock.
// A root entry avoids the repository's unit-test discovery exclusions without
// replacing its import map, installed dependency versions, or source modules.
import "./tests/unit/workDrain.test.ts";
import "./tests/unit/applicationLifecycle.test.ts";
import "./tests/unit/nativeReaderLease.test.ts";
import "./tests/unit/nativeReaderProfile.test.ts";
