import "dotenv/config";
import { Telegraf } from "telegraf";
import QRCode from "qrcode";
import { CHAINS, resolveChain, explorerTx } from "./chains.js";
import { buildTx, buildRaw, BuildError, formatEth } from "./tx.js";
import * as targets from "./targets.js";
import * as wallet from "./wallet.js";

const { BOT_TOKEN, WC_PROJECT_ID, OWNER_ID } = process.env;

for (const [k, v] of Object.entries({ BOT_TOKEN, WC_PROJECT_ID, OWNER_ID })) {
  if (!v) { console.error(`Missing ${k} — copy .env.example to .env and fill it in.`); process.exit(1); }
}

const bot = new Telegraf(BOT_TOKEN);

/* Gate everything to one Telegram account.
 *
 * A bot token is a bearer credential: anyone holding it can talk to this bot.
 * Without this check, a leaked token means a stranger can make your wallet pop
 * approval prompts all day. It won't move funds without you tapping approve,
 * but it's the difference between an annoyance and a phishing surface. */
bot.use(async (ctx, next) => {
  if (String(ctx.from?.id) !== String(OWNER_ID)) {
    console.warn(`blocked update from ${ctx.from?.id} (@${ctx.from?.username})`);
    return;
  }
  return next();
});

const code = (s) => "`" + String(s).replace(/`/g, "'") + "`";

bot.catch((err, ctx) => {
  console.error("handler error", err);
  ctx.reply("Something broke: " + (err?.message || err)).catch(() => {});
});

bot.command(["start", "help"], (ctx) =>
  ctx.replyWithMarkdown(
    [
      "*Mint Bot* — builds transactions, your wallet signs them.",
      "I never hold a key.",
      "",
      "*Wallet*",
      "/link — pair your wallet (QR + deep link)",
      "/status — what's connected",
      "/unlink — drop the session",
      "",
      "*Minting*",
      "/mint <name> [qty] — fire a saved target",
      "/raw <chain> <to> <eth> <0xcalldata> — anything else",
      "",
      "*Targets*",
      "/save <name> <chain> <address> <preset|signature> [price] — add one",
      "/targets — list them",
      "/rm <name> — delete one",
      "",
      "*Presets:* " + Object.keys(targets.PRESETS).join(", "),
      "*Chains:* " + Object.keys(CHAINS).join(", "),
    ].join("\n")
  )
);

bot.command("link", async (ctx) => {
  try {
    const { uri, wait } = await wallet.startPairing();
    const png = await QRCode.toBuffer(uri, { width: 512, margin: 2 });
    await ctx.replyWithPhoto(
      { source: png },
      { caption: "Scan in your wallet, or tap the link below. Approve *all* the chains you want to mint on.", parse_mode: "Markdown" }
    );
    await ctx.replyWithMarkdown("Deep link:\n" + code(uri));
    const s = await wait();
    await ctx.replyWithMarkdown(`Linked ✓\nAddress: ${code(s.address)}\nChains: ${s.chains.length}`);
  } catch (e) {
    ctx.reply("Pairing failed or timed out: " + (e?.message || e));
  }
});

bot.command("status", (ctx) => {
  const s = wallet.summary();
  if (!s) return ctx.reply("Nothing linked. /link to pair a wallet.");
  const names = s.chains
    .map((c) => Object.values(CHAINS).find((x) => `eip155:${x.id}` === c)?.label || c)
    .join(", ");
  return ctx.replyWithMarkdown(
    `Linked ✓\nAddress: ${code(s.address)}\nApproved chains: ${names}\nExpires: ${new Date(s.expiry * 1000).toUTCString()}`
  );
});

bot.command("unlink", async (ctx) => ctx.reply((await wallet.unlink()) ? "Session dropped." : "Nothing was linked."));

bot.command("targets", (ctx) => {
  const all = targets.list();
  if (!all.length) return ctx.reply("No targets saved. /save to add one.");
  return ctx.replyWithMarkdown(
    all.map((t) =>
      `*${t.name}* — ${t.chain}\n${code(t.address)}\n${t.fn}${t.price ? `  ·  ${t.price} ETH each` : "  ·  free"}`
    ).join("\n\n")
  );
});

bot.command("rm", (ctx) => {
  const [, name] = ctx.message.text.trim().split(/\s+/);
  if (!name) return ctx.reply("Usage: /rm <name>");
  return ctx.reply(targets.remove(name) ? `Removed ${name}.` : `No target called ${name}.`);
});

// /save <name> <chain> <address> <preset|signature> [price] [nftAddress]
bot.command("save", (ctx) => {
  const parts = ctx.message.text.trim().split(/\s+/).slice(1);
  if (parts.length < 4) {
    return ctx.replyWithMarkdown(
      "Usage:\n" + code("/save blankrunner base 0xabc… simple 0.02") +
      "\n\nOr with an explicit signature:\n" + code('/save foo base 0xabc… "mintTo(address,uint256)" 0.01') +
      "\n\nSeaDrop needs the collection too:\n" + code("/save foo base 0xDROP… seadrop 0.01 0xNFT…")
    );
  }
  const [name, chainKey, address, sigOrPreset, price, nft] = parts;
  if (!resolveChain(chainKey)) return ctx.reply(`Unknown chain "${chainKey}". Try: ${Object.keys(CHAINS).join(", ")}`);

  const preset = targets.PRESETS[sigOrPreset.toLowerCase()];
  let shape = preset;
  if (!preset) {
    const fn = sigOrPreset.replace(/^["']|["']$/g, "");
    const guess = targets.guessArgs(fn);
    if (guess.error) return ctx.reply(guess.error);
    shape = { fn, args: guess.args };
  }

  const target = { name, chain: chainKey, address, price: price || null, nft: nft || null, ...shape };
  try {
    buildTx(target, { qty: 1n, me: "0x0000000000000000000000000000000000000001" }); // fail now, not at mint time
  } catch (e) {
    return ctx.reply("Won't save — it doesn't build: " + e.message);
  }
  targets.save(target);
  return ctx.replyWithMarkdown(`Saved *${name}* on ${chainKey}\n${target.fn}${price ? `\n${price} ETH each` : "\nfree"}`);
});

async function send(ctx, built, label) {
  if (!wallet.isLinked()) return ctx.reply("No wallet linked. /link first.");
  if (!wallet.supports(built.chain)) {
    return ctx.reply(`Your session didn't approve ${built.chain.label}. Run /unlink then /link and approve it.`);
  }
  await ctx.replyWithMarkdown(
    [
      `*${label}*`,
      `Chain: ${built.chain.label}`,
      `To: ${code(built.request.to)}`,
      `Value: ${formatEth(built.valueWei)} ETH`,
      "",
      "Check it on your phone and approve.",
    ].join("\n")
  );
  try {
    const hash = await wallet.requestSignature(built.chain, built.request);
    await ctx.replyWithMarkdown(`Sent ✓\n${explorerTx(built.chain, hash)}`);
  } catch (e) {
    await ctx.reply("Not sent: " + (e?.message || e));
  }
}

bot.command("mint", async (ctx) => {
  const [, name, qtyRaw] = ctx.message.text.trim().split(/\s+/);
  if (!name) return ctx.reply("Usage: /mint <name> [qty]");
  const target = targets.get(name);
  if (!target) return ctx.reply(`No target called ${name}. /targets to see them.`);
  const me = wallet.summary()?.address;
  if (!me) return ctx.reply("No wallet linked. /link first.");
  try {
    const built = buildTx(target, { qty: BigInt(qtyRaw || 1), me });
    await send(ctx, built, `Mint ${target.name} ×${built.quantity}`);
  } catch (e) {
    ctx.reply(e instanceof BuildError ? e.message : "Couldn't build it: " + e.message);
  }
});

bot.command("raw", async (ctx) => {
  const [, chain, to, eth, data] = ctx.message.text.trim().split(/\s+/);
  if (!to) return ctx.replyWithMarkdown("Usage:\n" + code("/raw base 0xcontract 0.02 0xa0712d68...0001"));
  const me = wallet.summary()?.address;
  if (!me) return ctx.reply("No wallet linked. /link first.");
  try {
    await send(ctx, buildRaw({ chain, to, valueEth: eth, data, me }), "Raw transaction");
  } catch (e) {
    ctx.reply(e instanceof BuildError ? e.message : "Couldn't build it: " + e.message);
  }
});

(async () => {
  await wallet.init(WC_PROJECT_ID);
  // bot.launch() resolves only when the bot *stops*, so log before it, once
  // the token has been verified against Telegram.
  const me = await bot.telegram.getMe();
  console.log(`Mint Bot running as @${me.username}. Owner: ${OWNER_ID}`);
  await bot.launch();
})();

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
