import { defineConfig } from "$fresh/server.ts";
import tailwind from "$fresh/plugins/tailwind.ts";

const configuredPort = Deno.env.get("STAMPCHAIN_PORT");
if (
  configuredPort !== undefined &&
  (!/^\d+$/.test(configuredPort) || Number(configuredPort) < 1 ||
    Number(configuredPort) > 65535)
) {
  throw new Error("STAMPCHAIN_PORT must be an integer from 1 to 65535");
}

export default defineConfig({
  ...(configuredPort === undefined ? {} : { port: Number(configuredPort) }),
  plugins: [tailwind()],
});
