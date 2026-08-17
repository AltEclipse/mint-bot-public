import { encodeFunctionData, parseAbiItem, parseEther, isAddress, getAddress } from "viem";
import { resolveChain } from "./chains.js";

/* Turning a saved target into a transaction. Kept free of network and Telegram
 * so it can be unit-tested — this is the part where a mistake costs money. */

export class BuildError extends Error {}

// Placeholders usable in a target's args
//   $qty  -> the quantity you asked for
//   $me   -> your connected wallet address
//   $nft  -> the collection address (SeaDrop-style, where the drop contract
//            is the thing you call and the collection is an argument)
function substitute(raw, ctx) {
  if (typeof raw !== "string") return raw;
  const t = raw.trim();
  if (t === "$qty") return ctx.qty;
  if (t === "$me") return ctx.me;
  if (t === "$nft") return ctx.nft;
  if (t === "$zero") return "0x0000000000000000000000000000000000000000";
  return t;
}

// viem wants exact JS types per ABI type; a string where a bigint belongs throws
// deep inside the encoder with a message you can't act on.
function coerce(value, type, label) {
  if (type.startsWith("uint") || type.startsWith("int")) {
    try { return BigInt(value); }
    catch { throw new BuildError(`${label}: "${value}" is not a whole number`); }
  }
  if (type === "address") {
    if (!isAddress(String(value))) throw new BuildError(`${label}: "${value}" is not an address`);
    return getAddress(String(value));
  }
  if (type === "bool") {
    const s = String(value).toLowerCase();
    if (s === "true" || s === "1") return true;
    if (s === "false" || s === "0") return false;
    throw new BuildError(`${label}: "${value}" is not true/false`);
  }
  if (type.startsWith("bytes")) {
    const s = String(value);
    if (!/^0x[0-9a-fA-F]*$/.test(s)) throw new BuildError(`${label}: "${value}" is not hex`);
    return s;
  }
  return value;
}

export function parseTarget(target) {
  let item;
  try {
    item = parseAbiItem(`function ${target.fn}`);
  } catch {
    throw new BuildError(`Can't read the function signature "${target.fn}"`);
  }
  if (item.type !== "function") throw new BuildError(`"${target.fn}" isn't a function`);
  return item;
}

export function buildTx(target, { qty = 1n, me } = {}) {
  const chain = resolveChain(target.chain);
  if (!chain) throw new BuildError(`Unknown chain "${target.chain}"`);
  if (!isAddress(target.address)) throw new BuildError(`Bad contract address "${target.address}"`);

  const quantity = BigInt(qty);
  if (quantity <= 0n) throw new BuildError("Quantity has to be at least 1");

  const item = parseTarget(target);
  const templates = target.args || [];
  if (templates.length !== item.inputs.length) {
    throw new BuildError(
      `${target.fn} takes ${item.inputs.length} argument(s) but the target supplies ${templates.length}`
    );
  }

  const ctx = { qty: quantity, me, nft: target.nft };
  const args = item.inputs.map((input, i) => {
    const sub = substitute(templates[i], ctx);
    if (sub === undefined || sub === null || sub === "") {
      throw new BuildError(`Argument ${i + 1} (${input.name || input.type}) is empty`);
    }
    return coerce(sub, input.type, `argument ${i + 1} (${input.name || input.type})`);
  });

  const data = encodeFunctionData({ abi: [item], args });

  // price is per unit, so the value scales with quantity — getting this wrong
  // is the difference between one mint and an underpaid revert
  const unit = target.price ? parseEther(String(target.price)) : 0n;
  const value = unit * quantity;

  return {
    chain,
    quantity,
    request: {
      from: me,
      to: getAddress(target.address),
      data,
      value: "0x" + value.toString(16),
    },
    valueWei: value,
  };
}

export function buildRaw({ chain: chainKey, to, valueEth, data, me }) {
  const chain = resolveChain(chainKey);
  if (!chain) throw new BuildError(`Unknown chain "${chainKey}"`);
  if (!isAddress(to)) throw new BuildError(`Bad address "${to}"`);
  if (data && !/^0x[0-9a-fA-F]*$/.test(data)) throw new BuildError("Calldata must be hex starting 0x");
  let value;
  try { value = parseEther(String(valueEth || "0")); }
  catch { throw new BuildError(`"${valueEth}" is not an amount`); }
  return {
    chain,
    quantity: 1n,
    request: { from: me, to: getAddress(to), data: data || "0x", value: "0x" + value.toString(16) },
    valueWei: value,
  };
}

export function formatEth(wei) {
  if (wei === 0n) return "0";
  const s = (Number(wei) / 1e18).toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
  return s;
}
