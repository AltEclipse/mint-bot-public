import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";

const FILE = process.env.TARGETS_FILE || "./data/targets.json";

function load() {
  try { return JSON.parse(readFileSync(FILE, "utf8")); } catch { return {}; }
}
function persist(all) {
  mkdirSync(dirname(FILE), { recursive: true });
  writeFileSync(FILE, JSON.stringify(all, null, 2));
}

export const list = () => Object.values(load()).sort((a, b) => a.name.localeCompare(b.name));
export const get  = (name) => load()[String(name).toLowerCase()] || null;

export function save(target) {
  const all = load();
  const name = String(target.name).toLowerCase();
  all[name] = { ...target, name };
  persist(all);
  return all[name];
}

export function remove(name) {
  const all = load();
  const key = String(name).toLowerCase();
  if (!all[key]) return false;
  delete all[key];
  persist(all);
  return true;
}

/* Guess which argument is the quantity and which is you, from a signature alone.
 *
 * Deliberately refuses when it isn't sure. Two uints — say mint(uint256 tokenId,
 * uint256 quantity) — could map either way, and picking wrong builds a
 * transaction that mints the wrong thing at the wrong price. Better to make the
 * user spell it out than to guess money. */
export function guessArgs(fn) {
  const m = String(fn).match(/\(([^)]*)\)/);
  if (!m) return { error: `Can't read the arguments of "${fn}"` };
  const raw = m[1].trim();
  if (!raw) return { args: [] };

  const types = raw.split(",").map((s) => s.trim().split(/\s+/)[0]);
  const uints = types.filter((t) => t.startsWith("uint")).length;
  const addrs = types.filter((t) => t === "address").length;

  if (uints > 1) return { error: `${fn} has ${uints} number arguments — I can't tell which is the quantity. Save it, then set "args" by hand in data/targets.json.` };
  if (addrs > 1) return { error: `${fn} has ${addrs} address arguments — set "args" by hand in data/targets.json.` };

  const args = types.map((t) =>
    t.startsWith("uint") ? "$qty" : t === "address" ? "$me" : null
  );
  if (args.some((a) => a === null)) {
    return { error: `${fn} takes an argument I can't fill in automatically. Set "args" by hand in data/targets.json.` };
  }
  return { args };
}

/* Presets for the shapes that actually recur. Everything else is /save with an
 * explicit signature, or /raw with calldata copied out of the mint page. */
export const PRESETS = {
  // the overwhelmingly common ERC-721 public mint
  simple:  { fn: "mint(uint256)",                                        args: ["$qty"] },
  // mint(to, quantity)
  to:      { fn: "mint(address,uint256)",                                args: ["$me", "$qty"] },
  // OpenSea SeaDrop: you call the drop contract, collection is an argument
  seadrop: { fn: "mintPublic(address,address,address,uint256)",           args: ["$nft", "$me", "$zero", "$qty"] },
  // Zora-style fixed price
  zora:    { fn: "purchase(uint256)",                                     args: ["$qty"] },
};
