import { SignClient } from "@walletconnect/sign-client";
import { allCaip, caip } from "./chains.js";

/* WalletConnect session handling.
 *
 * The bot is the dApp; your phone wallet is the signer. Nothing here ever sees
 * a private key — the strongest version of that claim is that there is no code
 * path that could use one, because we only ever ask the wallet to sign.
 */

const METADATA = {
  name: "Mint Bot",
  description: "Prepares mint transactions for you to approve",
  url: "https://github.com/",
  icons: ["https://avatars.githubusercontent.com/u/37784886"],
};

let client = null;
let session = null;

export async function init(projectId) {
  // Keep the session store next to targets.json. The default is ./walletconnect.db
  // in the working directory, which on Fly is wiped every deploy — putting it on
  // the mounted volume means /link survives a redeploy.
  const dataDir = process.env.DATA_DIR || "./data";
  client = await SignClient.init({
    projectId,
    metadata: METADATA,
    storageOptions: { database: `${dataDir}/walletconnect.db` },
  });

  // restore whatever survived the last restart
  const existing = client.session.getAll();
  if (existing.length) session = existing[existing.length - 1];

  client.on("session_delete", () => { session = null; });
  client.on("session_expire", () => { session = null; });
  return client;
}

/* Only eip155:1 is *required*, so a wallet missing one of the L2s can still
 * pair. The rest go in optional — asking for all of them as required is the
 * usual reason a pairing silently fails to appear in the wallet. */
export async function startPairing() {
  if (!client) throw new Error("Not initialised");
  const { uri, approval } = await client.connect({
    requiredNamespaces: {
      eip155: {
        methods: ["eth_sendTransaction", "personal_sign"],
        chains: ["eip155:1"],
        events: ["chainChanged", "accountsChanged"],
      },
    },
    optionalNamespaces: {
      eip155: {
        methods: ["eth_sendTransaction", "personal_sign", "eth_signTypedData_v4"],
        chains: allCaip(),
        events: ["chainChanged", "accountsChanged"],
      },
    },
  });
  return {
    uri,
    wait: async () => { session = await approval(); return summary(); },
  };
}

export function summary() {
  if (!session) return null;
  const ns = session.namespaces?.eip155;
  const accounts = ns?.accounts || [];
  const address = accounts[0]?.split(":")[2] || null;
  const chains = [...new Set(accounts.map((a) => a.split(":").slice(0, 2).join(":")))];
  return { address, chains, expiry: session.expiry, topic: session.topic };
}

export const isLinked = () => !!session;

export function supports(chain) {
  const s = summary();
  return !!s && s.chains.includes(caip(chain));
}

export async function unlink() {
  if (!client || !session) return false;
  try {
    await client.disconnect({ topic: session.topic, reason: { code: 6000, message: "User disconnected" } });
  } catch { /* already gone on the wallet side */ }
  session = null;
  return true;
}

/* Push a transaction to the wallet for approval. Resolves with the hash once
 * you approve on your phone; rejects if you decline or let it time out. */
export async function requestSignature(chain, request) {
  if (!client || !session) throw new Error("No wallet linked — run /link first");
  return client.request({
    topic: session.topic,
    chainId: caip(chain),
    request: { method: "eth_sendTransaction", params: [request] },
  });
}
