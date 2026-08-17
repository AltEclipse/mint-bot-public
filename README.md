# Mint Bot

A Telegram bot that **builds** mint transactions and pushes them to your wallet
to sign. It never holds a private key — not "stores one securely", *never has
one*. There is no code path in here that could sign anything; the only way a
transaction leaves is you approving it on your phone.

## What it does

You message the bot, it encodes the call, WalletConnect pops the transaction on
your phone, you check it and approve. The value of it is that at 3am you don't
have to find the mint page, connect, and hunt for the button — you send five
characters and check a prompt.

## What it does not do

- **It will not win a gas war.** Bots that win competitive mints run against
  private mempools next to a node. This is a convenience tool, not an edge.
- **It can't mint arbitrary collections without being told how.** There is no
  universal mint API. Most collections have their own contract with their own
  function. You save each one once (`/save`), or paste calldata (`/raw`).
- **It doesn't handle allowlist proofs.** Merkle-proof mints need the proof as
  an argument — use `/raw` with calldata copied from the mint page.

## Setup

1. `npm install`
2. `cp .env.example .env` and fill in:
   - `BOT_TOKEN` — from [@BotFather](https://t.me/BotFather), `/newbot`
   - `WC_PROJECT_ID` — create a project on the WalletConnect / Reown dashboard
   - `OWNER_ID` — your numeric Telegram id, from [@userinfobot](https://t.me/userinfobot)
3. `npm start`
4. In Telegram: `/link`, scan the QR with your wallet, **approve every chain you
   intend to mint on** — a chain you skip can't be used later without re-pairing.

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

Presets: `simple` — `mint(uint256)`, `to` — `mint(address,uint256)`,
`seadrop` — OpenSea's `mintPublic(...)`, `zora` — `purchase(uint256)`.

Chains: `eth`, `base`, `arb`, `op`, `polygon`, `zora`.

```
/save blankrunner base 0xABC…  simple 0.02
/mint blankrunner 3
```

`price` is **per unit** — quantity multiplies it. There's a test pinning that,
because getting it backwards either underpays and reverts or overpays and doesn't.

## Security notes, in order of how likely they are to bite you

1. **The bot token is a bearer credential.** Anyone with it can talk to your
   bot. `OWNER_ID` means a stranger's messages are dropped, so a leaked token is
   an annoyance rather than a wallet-drain vector — but rotate it via BotFather
   if it ever leaks.
2. **Approve prompts are the last line of defence, so actually read them.** The
   bot shows you chain, destination and value before it asks; the wallet shows
   the real thing. If those disagree, decline.
3. **Don't add a "confirm automatically" feature later.** The whole security
   model of this design is that a human looks at every transaction. The moment
   you remove that, you're back to architecture #3 and you need a burner wallet.
4. Saved targets live in `data/targets.json` — not secret, but a wrong address
   in there is a transaction to a wrong address. `/save` refuses anything that
   doesn't encode, and rejects addresses that fail their checksum.

## Tests

```
npm test           # transaction encoding
node test/guess.test.js   # signature parsing, preset sanity
```

The encoding tests are the ones that matter. They cover value-scales-with-
quantity, placeholder substitution, checksum rejection, and that every shipped
preset actually produces calldata.

## Deploying

Any always-on host: Railway, Fly.io, a small VPS. It's a long-poll bot, so it
needs no inbound ports and no public URL. Set the three env vars as secrets.
Mount a volume at `./data` if you want targets to survive redeploys.
