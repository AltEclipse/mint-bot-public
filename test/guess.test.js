import assert from "node:assert/strict";
import { guessArgs, PRESETS } from "../src/targets.js";
import { buildTx } from "../src/tx.js";

let pass = 0, fail = 0;
const t = (n, f) => { try { f(); console.log("ok   " + n); pass++; }
  catch (e) { console.log("FAIL " + n + "\n     " + e.message); fail++; } };

t("mint(uint256) -> quantity", () => assert.deepEqual(guessArgs("mint(uint256)").args, ["$qty"]));
t("mint(address,uint256) -> me + quantity", () =>
  assert.deepEqual(guessArgs("mint(address,uint256)").args, ["$me", "$qty"]));
t("named params are tolerated", () =>
  assert.deepEqual(guessArgs("mint(address to, uint256 quantity)").args, ["$me", "$qty"]));
t("no-arg function", () => assert.deepEqual(guessArgs("mint()").args, []));

t("REFUSES two uints instead of guessing", () => {
  const g = guessArgs("mint(uint256 tokenId, uint256 quantity)");
  assert.ok(g.error, "should refuse");
  assert.match(g.error, /can't tell which is the quantity/);
});
t("REFUSES two addresses", () => assert.ok(guessArgs("mint(address,address)").error));
t("REFUSES a type it can't fill", () => assert.ok(guessArgs("mint(bytes32,uint256)").error));

// every shipped preset must actually encode
t("all presets build a real transaction", () => {
  const ME = "0x1111111111111111111111111111111111111111";
  const NFT = "0x3333333333333333333333333333333333333333";
  for (const [name, p] of Object.entries(PRESETS)) {
    const b = buildTx(
      { chain: "base", address: "0x2222222222222222222222222222222222222222", nft: NFT, price: "0.01", ...p },
      { qty: 2n, me: ME }
    );
    assert.match(b.request.data, /^0x[0-9a-f]{8,}$/i, name + " produced no calldata");
  }
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
