import assert from "node:assert/strict";
import { buildTx, buildRaw, BuildError, formatEth } from "../src/tx.js";

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log("ok   " + name); pass++; }
  catch (e) { console.log("FAIL " + name + "\n     " + e.message); fail++; }
}
const ME = "0x1111111111111111111111111111111111111111";
const C  = "0x2222222222222222222222222222222222222222";

t("mint(uint256) encodes selector + quantity", () => {
  const b = buildTx({ chain: "base", address: C, fn: "mint(uint256)", args: ["$qty"], price: "0.02" },
                    { qty: 3n, me: ME });
  // mint(uint256) selector is 0xa0712d68
  assert.equal(b.request.data.slice(0, 10), "0xa0712d68");
  assert.equal(BigInt("0x" + b.request.data.slice(10)), 3n);
  assert.equal(b.chain.key, "base");
});

t("value scales with quantity, not flat", () => {
  const one = buildTx({ chain: "base", address: C, fn: "mint(uint256)", args: ["$qty"], price: "0.02" }, { qty: 1n, me: ME });
  const ten = buildTx({ chain: "base", address: C, fn: "mint(uint256)", args: ["$qty"], price: "0.02" }, { qty: 10n, me: ME });
  assert.equal(formatEth(one.valueWei), "0.02");
  assert.equal(formatEth(ten.valueWei), "0.2");
  assert.equal(ten.valueWei, one.valueWei * 10n);
});

t("free mint sends zero value", () => {
  const b = buildTx({ chain: "zora", address: C, fn: "mint(uint256)", args: ["$qty"] }, { qty: 2n, me: ME });
  assert.equal(b.valueWei, 0n);
  assert.equal(b.request.value, "0x0");
});

t("$me substitutes the connected address", () => {
  const b = buildTx({ chain: "eth", address: C, fn: "mint(address,uint256)", args: ["$me", "$qty"] }, { qty: 1n, me: ME });
  assert.ok(b.request.data.toLowerCase().includes(ME.slice(2).toLowerCase()));
});

t("SeaDrop-shaped call with $nft and $zero", () => {
  const nft = "0x3333333333333333333333333333333333333333";
  const b = buildTx({
    chain: "base", address: C, nft,
    fn: "mintPublic(address,address,address,uint256)",
    args: ["$nft", "$me", "$zero", "$qty"], price: "0.01",
  }, { qty: 2n, me: ME });
  const d = b.request.data.toLowerCase();
  assert.ok(d.includes(nft.slice(2).toLowerCase()));
  assert.ok(d.includes(ME.slice(2).toLowerCase()));
  assert.equal(formatEth(b.valueWei), "0.02");
});

t("arg count mismatch is caught before encoding", () => {
  assert.throws(() => buildTx({ chain: "base", address: C, fn: "mint(uint256)", args: [] }, { qty: 1n, me: ME }),
    (e) => e instanceof BuildError && /takes 1 argument/.test(e.message));
});

t("bad chain rejected", () => {
  assert.throws(() => buildTx({ chain: "solana", address: C, fn: "mint(uint256)", args: ["$qty"] }, { qty: 1n, me: ME }),
    (e) => e instanceof BuildError && /Unknown chain/.test(e.message));
});

t("bad contract address rejected", () => {
  assert.throws(() => buildTx({ chain: "base", address: "0xnope", fn: "mint(uint256)", args: ["$qty"] }, { qty: 1n, me: ME }),
    (e) => e instanceof BuildError && /Bad contract address/.test(e.message));
});

t("quantity of zero rejected", () => {
  assert.throws(() => buildTx({ chain: "base", address: C, fn: "mint(uint256)", args: ["$qty"] }, { qty: 0n, me: ME }),
    (e) => e instanceof BuildError && /at least 1/.test(e.message));
});

t("non-numeric arg rejected with a readable message", () => {
  assert.throws(() => buildTx({ chain: "base", address: C, fn: "mint(uint256)", args: ["banana"] }, { qty: 1n, me: ME }),
    (e) => e instanceof BuildError && /not a whole number/.test(e.message));
});

t("unparseable signature rejected", () => {
  assert.throws(() => buildTx({ chain: "base", address: C, fn: "not a function!!", args: [] }, { qty: 1n, me: ME }),
    (e) => e instanceof BuildError);
});

t("raw calldata passthrough", () => {
  const b = buildRaw({ chain: "op", to: C, valueEth: "0.5", data: "0xdeadbeef", me: ME });
  assert.equal(b.request.data, "0xdeadbeef");
  assert.equal(formatEth(b.valueWei), "0.5");
  assert.equal(b.chain.key, "op");
});

t("raw rejects non-hex calldata", () => {
  assert.throws(() => buildRaw({ chain: "op", to: C, valueEth: "0", data: "hello", me: ME }),
    (e) => e instanceof BuildError && /hex/.test(e.message));
});

t("checksums a lowercase contract address", () => {
  // needs hex letters in it — an all-digits address checksums to itself
  const lower = "0xb47e3cd837ddf8e4c57f05d70ab865de6e193bbb";
  const b = buildTx({ chain: "base", address: lower, fn: "mint(uint256)", args: ["$qty"] }, { qty: 1n, me: ME });
  assert.notEqual(b.request.to, lower, "should have been re-cased");
  assert.equal(b.request.to.toLowerCase(), lower);
  assert.match(b.request.to, /[A-F]/, "checksum should introduce capitals");
});

t("rejects an address whose checksum is wrong (typo guard)", () => {
  assert.throws(() => buildTx(
    { chain: "base", address: "0xB47e3cD837dDF8e4c57F05d70Ab865de6e193BBB", fn: "mint(uint256)", args: ["$qty"] },
    { qty: 1n, me: ME }),
    (e) => e instanceof BuildError);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
