# Mint Bot

A Telegram bot that **builds** NFT mint transactions and pushes them to your
wallet to sign. It never holds a private key — not "stores one securely",
*never has one*. There is no code path in here that could sign anything; the
only way a transaction leaves is you approving it on your phone.

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/AltEclipse/mint-bot-public)

**No computer? Use the button.** It works from a phone browser and asks you for
three values — everything after that happens in Telegram. See
[Setup without a computer](#setup-without-a-computer).

## What it does

You message the bot, it encodes the call, WalletConnect pops the transaction on
your phone, you check it and approve. The value of it is that at 3am you don't
have to find the mint page, connect, and hunt for the button — you send five
characters and check a prompt.

Save a collection once:

```
/save blankrunner base 0xABC…123 simple 0.02
→ Saved blankrunner on base
  mint(uint256)
  0.02 ETH each
```

Then, whenever it goes live:

```
/mint blankrunner 3
→ Mint blankrunner ×3
  Chain: Base
  To: 0xABC…123
  Value: 0.06 ETH
  Check it on your phone and approve.
```

Your wallet buzzes, you read the prompt, you approve. The bot replies with the
transaction hash and an explorer link.

## What it does not do

- **It will not win a gas war.** Bots that win competitive mints run against
  private mempools next to a node. This is a convenience tool, not an edge.
- **It can't mint arbitrary collections without being told how.** There is no
  universal mint API. Most collections have their own contract with their own
  function. You save each one once (`/save`), or paste calldata (`/raw`).
- **It doesn't handle allowlist proofs.** Merkle-proof mints need the proof as
  an argument — use `/raw` with calldata copied from the mint page.

## Requirements

- Node 20 or newer
- A Telegram account
- A mobile wallet that speaks WalletConnect (MetaMask, Rainbow, Trust, …)
- Somewhere to run it — see [Deploying](#deploying). A laptop is fine for
  testing, but the bot can only answer while the process is running.

No computer? Skip to [Setup without a computer](#setup-without-a-computer) —
Node and a terminal are only needed if you're running it yourself.

## Setup without a computer

Everything below works from a phone browser, and the three values you need all
come from Telegram or a web page.

1. **Get your bot token.** In Telegram, message
   [@BotFather](https://t.me/BotFather), send `/newbot`, pick a name. He replies
   with a token — copy it.
2. **Get a WalletConnect project id.** Sign in at
   [dashboard.reown.com](https://dashboard.reown.com), create a project, copy
   the Project ID.
3. **Get your Telegram id.** Message [@userinfobot](https://t.me/userinfobot).
   It replies with a number.
4. **Tap the Deploy to Render button** at the top of this page. Sign in with
   GitHub, and Render will ask you for exactly those three values. Paste each
   one in and deploy.
5. **Open Telegram and message your new bot.** Send `/link`, scan the QR with
   your wallet app, and approve the chains you want.

Done — you never touched a terminal. Note that an always-on bot isn't free:
Render background workers start at a few dollars a month, because the free tier
only covers web services that fall asleep when idle, which would take the bot
down with them.

## Setup with a computer

1. `npm install`
2. `cp .env.example .env` and fill in three values:
   - `BOT_TOKEN` — message [@BotFather](https://t.me/BotFather), send `/newbot`,
     follow the prompts, copy the token it gives you
   - `WC_PROJECT_ID` — create a free project on the
     [WalletConnect / Reown dashboard](https://dashboard.reown.com) and copy the
     Project ID
   - `OWNER_ID` — your numeric Telegram user id, from
     [@userinfobot](https://t.me/userinfobot). Messages from every other account
     are dropped.
3. `npm start`
4. In Telegram, send `/link` and scan the QR with your wallet. **Approve every
   chain you intend to mint on** — a chain you skip can't be used later without
   pairing again.

That's it. `/save` a collection and you're ready.

## Commands

| Command | What it does |
| --- | --- |
| `/link` | Pair a wallet (QR + deep link) |
| `/status` | Connected address, approved chains, session expiry |
| `/unlink` | Drop the session |
| `/save <name> <chain> <address> <preset\|signature> [price] [nft]` | Add a target |
| `/targets` / `/rm <name>` | List / delete targets |
| `/mint <name> [qty]` | Build and send for approval |
| `/raw <chain> <to> <eth> <0xdata>` | Anything the presets don't cover |

**Chains:** `eth`, `base`, `arb`, `op`, `polygon`, `zora`.

**Presets** cover the mint function shapes that actually recur:

| Preset | Function |
| --- | --- |
| `simple` | `mint(uint256)` |
| `to` | `mint(address,uint256)` |
| `seadrop` | OpenSea's `mintPublic(address,address,address,uint256)` |
| `zora` | `purchase(uint256)` |

If a collection doesn't match one, pass the signature yourself and the bot
works out which argument is the quantity and which is your address:

```
/save foo base 0xABC…123 "mintTo(address,uint256)" 0.01
```

When it *can't* tell — two number arguments, say, where either could be the
quantity — it refuses to save rather than guess. Guessing there would mint the
wrong thing at the wrong price.

`price` is **per unit**; quantity multiplies it. There's a test pinning that,
because getting it backwards either underpays and reverts or overpays and
doesn't tell you.

## How it works

```
you (Telegram) ──> bot (this repo, on any always-on host)
                     │
                     ├── targets.js   saved collections: contract, function, price
                     ├── tx.js        signature → calldata (viem), price × qty → value
                     │
                     └── wallet.js    WalletConnect → the tx pops on YOUR phone,
                                      you approve, your wallet signs and sends
```

A mint goes like this: `/mint` looks up the saved target, `tx.js` encodes the
function call with [viem](https://viem.sh) and multiplies the per-unit price by
quantity, and `wallet.js` pushes the result over the WalletConnect session to
whatever wallet you paired with `/link`. The bot's job ends there — your wallet
shows you the real transaction, and signing happens on your phone or not at all.

Because the bot only ever *builds* transactions, the worst a compromised server
can do is ask your phone annoying questions. There is no key to steal and no
code path that signs. `tx.js` is deliberately free of Telegram and network code
so the money-touching logic can be unit-tested — see `test/encode.test.js`.

Saved targets and the WalletConnect session live in `./data`, so both survive a
restart. Mount a volume there when hosting.

## Security notes, in order of how likely they are to bite you

1. **The bot token is a bearer credential.** Anyone holding it can talk to your
   bot. `OWNER_ID` means a stranger's messages are dropped, so a leaked token is
   an annoyance rather than a wallet-drain vector — but rotate it via BotFather
   if it ever leaks.
2. **Approve prompts are the last line of defence, so actually read them.** The
   bot shows you chain, destination and value before it asks; your wallet shows
   you the real thing. If those two disagree, decline.
3. **Don't bolt on an "approve automatically" option.** The entire security
   argument for this design is that a human looks at every transaction. Remove
   that and the bot needs a private key of its own — at which point a
   compromised server drains the wallet. That's a different risk model, and it
   only becomes defensible with a dedicated burner wallet and hard spending
   caps.
4. **A wrong address in a saved target is a transaction to a wrong address.**
   Targets live in `data/targets.json` and aren't secret, but `/save` refuses
   anything that doesn't encode and rejects addresses that fail their checksum,
   so typos get caught when you save rather than when you mint.

## Tests

```
npm test                  # transaction encoding — the ones that matter
node test/guess.test.js   # signature parsing, preset sanity
```

The encoding tests cover value-scales-with-quantity, placeholder substitution,
checksum rejection, and that every shipped preset actually produces calldata.
They need no network, no wallet, and no bot token.

## Deploying

The one-tap route is the Deploy to Render button at the top, driven by the
`render.yaml` in this repo. Any always-on host works too: Fly.io, Railway, a
small VPS. It's a long-poll bot, so it needs no inbound ports and no public URL
— which keeps it cheap to run and leaves it nothing to attack from outside.

Run it as a **worker**, not a web service. It never listens on a port, so
anything that sleeps idle web services will put your bot to sleep with them.

Set the three environment variables as secrets rather than shipping a `.env`,
and mount a volume at `./data` so your targets and wallet pairing survive
redeploys.

## License

[MIT](LICENSE) — use it, fork it, ship it, no warranty.
