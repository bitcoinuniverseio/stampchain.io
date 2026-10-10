/* ===== API BASE URL CONSTANTS ===== */

/**
 * External API base URLs used throughout the application
 */

/** BlockCypher API for Bitcoin blockchain data */
export const BLOCKCYPHER_API_BASE_URL = "https://api.blockcypher.com";

/** Blockchain.info API for Bitcoin data */
export const BLOCKCHAIN_API_BASE_URL = "https://blockchain.info";

/** Mempool.space API for Bitcoin mempool and transaction data */
const _mempoolUrl = typeof Deno !== "undefined"
  ? Deno.env.get("MEMPOOL_API_URL")
  : undefined;
export const MEMPOOL_API_BASE_URL = _mempoolUrl || "https://mempool.space/api";

/** Blockstream API for Bitcoin blockchain explorer data */
const _blockstreamUrl = typeof Deno !== "undefined"
  ? Deno.env.get("BLOCKSTREAM_API_URL")
  : undefined;
const _stampchainNetwork = typeof Deno !== "undefined"
  ? (Deno.env.get("STAMPCHAIN_NETWORK") || "mainnet").trim().toLowerCase()
  : "mainnet";
// Off Mainnet the esplora fallback is the deployment's own esplora (MEMPOOL_API_URL),
// never the public Mainnet blockstream.info.
export const BLOCKSTREAM_API_BASE_URL = _blockstreamUrl ||
  (_stampchainNetwork === "mainnet"
    ? "https://blockstream.info/api"
    : _mempoolUrl || "");

/** CoinGecko API for cryptocurrency price data */
export const COINGECKO_API_BASE_URL = "https://api.coingecko.com/api/v3";
