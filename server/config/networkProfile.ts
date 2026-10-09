/**
 * Bitcoin network profile for the Stampchain API and its PSBT builders.
 *
 * Mainnet is the default and keeps every existing upstream (public
 * Counterparty, mempool.space / blockstream.info) unchanged. Any other chain is
 * a separate deployment that must name its own authorities: a Signet profile
 * requires its signet challenge, its own Counterparty origin, its own Bitcoin
 * Core RPC and its own esplora origin. Nothing falls back to a Mainnet public
 * service, and the server refuses to start when Bitcoin Core or Counterparty
 * report a different chain than the one configured.
 *
 * Environment:
 *   STAMPCHAIN_NETWORK   mainnet (default) | signet
 *   SIGNET_CHALLENGE     hex signet challenge script (signet: required)
 *   XCP_API_URL          Counterparty v2 origin (signet: required)
 *   BITCOIN_RPC_URL      Bitcoin Core RPC origin (signet: required; BITCOIN_RPC_USER / BITCOIN_RPC_PASSWORD)
 *   MEMPOOL_API_URL      esplora origin (signet: required; BLOCKSTREAM_API_URL defaults to it)
 */

export type StampchainNetwork = "mainnet" | "signet";

export interface NetworkProfile {
  readonly name: StampchainNetwork;
  /** `getblockchaininfo().chain` Bitcoin Core must report. */
  readonly bitcoinCoreChain: "main" | "signet";
  /** `GET /v2/` `network` the Counterparty node must report. */
  readonly counterpartyNetwork: "mainnet" | "signet";
  readonly signetChallenge: string | null;
  /** Self-hosted authorities (null on Mainnet, where the public defaults stay). */
  readonly counterpartyUrl: string | null;
  readonly bitcoinRpcUrl: string | null;
  readonly esploraUrl: string | null;
}

export class NetworkProfileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NetworkProfileError";
  }
}

type EnvReader = (key: string) => string | undefined;

const HEX = /^(?:[0-9a-f]{2})+$/;
const PUBLIC_MAINNET_HOSTS = [
  "api.counterparty.io",
  "mempool.space",
  "blockstream.info",
  "blockcypher.com",
  "blockchain.info",
  "quiknode.pro",
];

function httpUrl(env: EnvReader, key: string): string {
  const raw = (env(key) ?? "").trim().replace(/\/+$/, "");
  if (!raw) {
    throw new NetworkProfileError(`STAMPCHAIN_NETWORK=signet requires ${key}`);
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new NetworkProfileError(`${key} is not a valid URL`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new NetworkProfileError(`${key} must be an http(s) URL`);
  }
  if (PUBLIC_MAINNET_HOSTS.some((host) => parsed.hostname.endsWith(host))) {
    throw new NetworkProfileError(
      `${key} points at a public Mainnet service (${parsed.hostname})`,
    );
  }
  return raw;
}

export function resolveNetworkProfile(env: EnvReader): NetworkProfile {
  const name = (env("STAMPCHAIN_NETWORK") ?? "mainnet").trim().toLowerCase() ||
    "mainnet";
  const challenge = (env("SIGNET_CHALLENGE") ?? "").trim().toLowerCase();
  if (name === "mainnet") {
    if (challenge) {
      throw new NetworkProfileError(
        "SIGNET_CHALLENGE is only valid with STAMPCHAIN_NETWORK=signet",
      );
    }
    return {
      name: "mainnet",
      bitcoinCoreChain: "main",
      counterpartyNetwork: "mainnet",
      signetChallenge: null,
      counterpartyUrl: null,
      bitcoinRpcUrl: null,
      esploraUrl: null,
    };
  }
  if (name === "signet") {
    if (!HEX.test(challenge)) {
      throw new NetworkProfileError(
        "STAMPCHAIN_NETWORK=signet requires SIGNET_CHALLENGE (hex challenge script)",
      );
    }
    if ((env("QUICKNODE_ENDPOINT") ?? "").trim() || (env("QUICKNODE_API_KEY") ?? "").trim()) {
      throw new NetworkProfileError(
        "QuickNode serves Mainnet only; unset QUICKNODE_* with STAMPCHAIN_NETWORK=signet",
      );
    }
    const esploraUrl = httpUrl(env, "MEMPOOL_API_URL");
    if ((env("BLOCKSTREAM_API_URL") ?? "").trim()) {
      httpUrl(env, "BLOCKSTREAM_API_URL");
    }
    return {
      name: "signet",
      bitcoinCoreChain: "signet",
      counterpartyNetwork: "signet",
      signetChallenge: challenge,
      counterpartyUrl: httpUrl(env, "XCP_API_URL"),
      bitcoinRpcUrl: httpUrl(env, "BITCOIN_RPC_URL"),
      esploraUrl,
    };
  }
  throw new NetworkProfileError(
    `Unsupported STAMPCHAIN_NETWORK "${name}" (mainnet or signet)`,
  );
}

const denoEnv: EnvReader = (key) =>
  typeof Deno !== "undefined" ? Deno.env.get(key) : undefined;

let cached: NetworkProfile | null = null;

/** The profile of this process (resolved once; throws on an invalid configuration). */
export function getNetworkProfile(): NetworkProfile {
  if (!cached) cached = resolveNetworkProfile(denoEnv);
  return cached;
}

/** Test hook. */
export function resetNetworkProfileForTests(): void {
  cached = null;
}

export function isMainnetProfile(): boolean {
  return getNetworkProfile().name === "mainnet";
}

interface BitcoinJsNetworks<N> {
  bitcoin: N;
  testnet: N;
}

/**
 * bitcoinjs-lib network parameters for address encoding. Signet uses the test
 * chain encoding (tb1 / m,n / 2), which bitcoinjs-lib exposes as `testnet`.
 */
export function bitcoinJsNetwork<N>(
  networks: BitcoinJsNetworks<N>,
  profile: NetworkProfile = getNetworkProfile(),
): N {
  return profile.name === "mainnet" ? networks.bitcoin : networks.testnet;
}

/** Network name the OLGA/CIP-33 P2WSH data-address encoder takes ("bitcoin" | "testnet"). */
export function olgaNetworkName(
  profile: NetworkProfile = getNetworkProfile(),
): "bitcoin" | "testnet" {
  return profile.name === "mainnet" ? "bitcoin" : "testnet";
}

/** Fail closed unless Bitcoin Core serves exactly the configured chain. */
export function assertBitcoinCoreChain(
  profile: NetworkProfile,
  info: { chain?: unknown; signet_challenge?: unknown } | null | undefined,
): void {
  const chain = String(info?.chain ?? "");
  if (chain !== profile.bitcoinCoreChain) {
    throw new NetworkProfileError(
      `Bitcoin Core serves chain "${chain}", but this Stampchain is configured for ${profile.name}`,
    );
  }
  if (profile.signetChallenge !== null) {
    const observed = String(info?.signet_challenge ?? "").trim().toLowerCase();
    if (observed !== profile.signetChallenge) {
      throw new NetworkProfileError(
        "Bitcoin Core Signet challenge does not match SIGNET_CHALLENGE",
      );
    }
  }
}

/** Fail closed unless the Counterparty node reports the configured network. */
export function assertCounterpartyNetwork(
  profile: NetworkProfile,
  root: unknown,
): void {
  const value = root && typeof root === "object"
    ? ((root as { result?: unknown }).result ?? root) as { network?: unknown }
    : {};
  const network = String(value?.network ?? "");
  if (network !== profile.counterpartyNetwork) {
    throw new NetworkProfileError(
      `Counterparty serves network "${network}", but this Stampchain is configured for ${profile.name}`,
    );
  }
}

/**
 * Startup identity check for a non-Mainnet deployment: Bitcoin Core (chain +
 * signet challenge) and Counterparty (network) must both match the profile.
 * Mainnet keeps its public upstreams and is not probed here.
 */
export async function verifyNetworkIdentity(
  profile: NetworkProfile = getNetworkProfile(),
  fetchFn: typeof fetch = fetch,
  env: EnvReader = denoEnv,
): Promise<void> {
  if (profile.name === "mainnet") return;
  const user = env("BITCOIN_RPC_USER") ?? "";
  const password = env("BITCOIN_RPC_PASSWORD") ?? "";
  const rpc = await fetchFn(profile.bitcoinRpcUrl!, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(user ? { authorization: `Basic ${btoa(`${user}:${password}`)}` } : {}),
    },
    body: JSON.stringify({
      jsonrpc: "1.0",
      id: "stampchain-network",
      method: "getblockchaininfo",
      params: [],
    }),
  });
  if (!rpc.ok) {
    throw new NetworkProfileError(
      `Bitcoin Core identity check failed with HTTP ${rpc.status}`,
    );
  }
  assertBitcoinCoreChain(profile, (await rpc.json())?.result);
  const cp = await fetchFn(`${profile.counterpartyUrl}/`);
  if (!cp.ok) {
    throw new NetworkProfileError(
      `Counterparty identity check failed with HTTP ${cp.status}`,
    );
  }
  assertCounterpartyNetwork(profile, await cp.json());
}
