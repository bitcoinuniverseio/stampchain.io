import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const packageVersion = JSON.parse(readFileSync("package.json", "utf8")).version;
// A fourth numeric component is valid for extension manifests, but not semver.
const version = packageVersion.replace(/^(\d+\.\d+\.\d+)\.\d+$/, "$1");
if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(version)) {
  throw new Error("package.json version must be a valid display semver");
}
let sha = process.env.APP_BUILD_SHA;
if (!sha) {
  try {
    sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    sha = "";
  }
}
if (sha && !/^[0-9a-f]{7,40}$/i.test(sha)) {
  throw new Error("APP_BUILD_SHA must be a git SHA");
}
const metadata = {
  version,
  sha: sha.toLowerCase(),
  builtAt: new Date().toISOString(),
  channel: process.env.APP_BUILD_CHANNEL || "unknown",
};
const json = JSON.stringify(metadata, null, 2) + "\n";
writeFileSync("static/version.json", json);
writeFileSync(
  "version-build/app-version.js",
  `// Generated at build time. Do not edit.\nexport const appVersion = Object.freeze(${JSON.stringify(metadata)});\n`,
);
