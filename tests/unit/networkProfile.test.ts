import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import {
  assertBitcoinCoreChain,
  assertCounterpartyNetwork,
  bitcoinJsNetwork,
  NetworkProfileError,
  resolveNetworkProfile,
  verifyNetworkIdentity,
} from "$server/config/networkProfile.ts";

const CHALLENGE = "512103" + "11".repeat(32) + "51ae";
const SIGNET: Record<string, string> = {
  STAMPCHAIN_NETWORK: "signet",
  SIGNET_CHALLENGE: CHALLENGE,
  XCP_API_URL: "http://127.0.0.1:38356/v2",
  BITCOIN_RPC_URL: "http://127.0.0.1:38332",
  MEMPOOL_API_URL: "http://127.0.0.1:38385/api",
};
const reader = (env: Record<string, string>) => (key: string) => env[key];
const networks = { bitcoin: "bitcoin", testnet: "testnet" };

Deno.test("network profile: Mainnet is the default and keeps the public upstreams", () => {
  const profile = resolveNetworkProfile(reader({}));
  assertEquals(profile.name, "mainnet");
  assertEquals(profile.bitcoinCoreChain, "main");
  assertEquals(profile.counterpartyUrl, null);
  assertEquals(bitcoinJsNetwork(networks, profile), "bitcoin");
  assertThrows(
    () => resolveNetworkProfile(reader({ SIGNET_CHALLENGE: CHALLENGE })),
    NetworkProfileError,
  );
});

Deno.test("network profile: Signet requires its own authorities", () => {
  const profile = resolveNetworkProfile(reader(SIGNET));
  assertEquals(profile.name, "signet");
  assertEquals(profile.signetChallenge, CHALLENGE);
  assertEquals(profile.counterpartyUrl, "http://127.0.0.1:38356/v2");
  assertEquals(profile.esploraUrl, "http://127.0.0.1:38385/api");
  assertEquals(bitcoinJsNetwork(networks, profile), "testnet");
  for (const key of ["SIGNET_CHALLENGE", "XCP_API_URL", "BITCOIN_RPC_URL", "MEMPOOL_API_URL"]) {
    const env = { ...SIGNET };
    delete env[key];
    assertThrows(() => resolveNetworkProfile(reader(env)), NetworkProfileError, key === "SIGNET_CHALLENGE" ? "SIGNET_CHALLENGE" : key);
  }
});

Deno.test("network profile: Signet refuses public Mainnet services and unknown networks", () => {
  const bad: Record<string, string>[] = [
    { XCP_API_URL: "https://api.counterparty.io:4000/v2" },
    { MEMPOOL_API_URL: "https://mempool.space/api" },
    { BLOCKSTREAM_API_URL: "https://blockstream.info/api" },
    { QUICKNODE_ENDPOINT: "https://x.quiknode.pro/" },
    { SIGNET_CHALLENGE: "not-hex" },
    { STAMPCHAIN_NETWORK: "testnet4" },
  ];
  for (const change of bad) {
    assertThrows(() => resolveNetworkProfile(reader({ ...SIGNET, ...change })), NetworkProfileError);
  }
});

Deno.test("network profile: chain identity mismatches fail closed", () => {
  const signet = resolveNetworkProfile(reader(SIGNET));
  assertBitcoinCoreChain(signet, { chain: "signet", signet_challenge: CHALLENGE.toUpperCase() });
  assertThrows(() => assertBitcoinCoreChain(signet, { chain: "signet", signet_challenge: "51" }), NetworkProfileError);
  assertThrows(() => assertBitcoinCoreChain(signet, { chain: "main" }), NetworkProfileError);
  assertCounterpartyNetwork(signet, { result: { network: "signet" } });
  assertThrows(() => assertCounterpartyNetwork(signet, { result: { network: "mainnet" } }), NetworkProfileError);
  assertThrows(() => assertCounterpartyNetwork(signet, {}), NetworkProfileError);
  const mainnet = resolveNetworkProfile(reader({}));
  assertBitcoinCoreChain(mainnet, { chain: "main" });
  assertThrows(() => assertBitcoinCoreChain(mainnet, { chain: "signet" }), NetworkProfileError);
});

Deno.test("network profile: startup identity check probes Bitcoin Core and Counterparty", async () => {
  const signet = resolveNetworkProfile(reader(SIGNET));
  const calls: string[] = [];
  const fakeFetch = (chain: string, network: string) =>
    ((input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      const body = url.startsWith("http://127.0.0.1:38332")
        ? { result: { chain, signet_challenge: CHALLENGE } }
        : { result: { network } };
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
    }) as typeof fetch;
  await verifyNetworkIdentity(signet, fakeFetch("signet", "signet"), reader({}));
  assertEquals(calls, ["http://127.0.0.1:38332", "http://127.0.0.1:38356/v2/"]);
  await assertRejects(() => verifyNetworkIdentity(signet, fakeFetch("main", "signet"), reader({})), NetworkProfileError);
  await assertRejects(() => verifyNetworkIdentity(signet, fakeFetch("signet", "mainnet"), reader({})), NetworkProfileError);
});
