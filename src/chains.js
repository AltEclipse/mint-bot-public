import { mainnet, base, arbitrum, optimism, polygon, zora } from "viem/chains";

/* Chains the bot will build transactions for. Adding one is a line here plus
 * making sure your wallet actually has that network — WalletConnect will
 * happily agree to a namespace your wallet can't route. */
export const CHAINS = {
  eth:      { ...mainnet,  key: "eth",      label: "Ethereum" },
  base:     { ...base,     key: "base",     label: "Base" },
  arb:      { ...arbitrum, key: "arb",      label: "Arbitrum" },
  op:       { ...optimism, key: "op",       label: "Optimism" },
  polygon:  { ...polygon,  key: "polygon",  label: "Polygon" },
  zora:     { ...zora,     key: "zora",     label: "Zora" },
};

// a few names people actually type
const ALIASES = {
  ethereum: "eth", mainnet: "eth", l1: "eth",
  arbitrum: "arb", optimism: "op", matic: "polygon", pol: "polygon",
};

export function resolveChain(input) {
  if (!input) return null;
  const k = String(input).trim().toLowerCase();
  return CHAINS[k] || CHAINS[ALIASES[k]] || null;
}

export const caip = (chain) => `eip155:${chain.id}`;

export function chainByCaip(caipId) {
  const id = Number(String(caipId).split(":")[1]);
  return Object.values(CHAINS).find((c) => c.id === id) || null;
}

export const allCaip = () => Object.values(CHAINS).map(caip);

export function explorerTx(chain, hash) {
  const base = chain.blockExplorers?.default?.url;
  return base ? `${base}/tx/${hash}` : hash;
}
