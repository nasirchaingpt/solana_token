# Presale dApp

A browser UI for the **pre-sale pool** Anchor program, plus a **token lab** to create SPL tokens and send supply to any wallet. It is aimed at developers and operators testing on **devnet**, **testnet**, or a **local validator**.

---

## What you can do here

### 1. Token prep (mint tokens to any address)

Use these flows when you need a **mint address** (the token’s identity on-chain) and want **tokens** delivered to a **recipient’s token account** (usually their **ATA**).

| Flow | Program | What it does |
|------|---------|----------------|
| **SPL Token (classic) — create mint & mint** | `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` | Creates a **new** classic mint, creates the recipient’s **ATA** if needed, and **mints** your chosen UI amount. **Mint authority** = your connected wallet. |
| **Token-2022 — create mint & mint** | `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb` | Same idea for a **Token-2022** mint (no extra extensions in this lab flow). |
| **Mint to recipient (existing mint)** | Auto-detected from the mint account | You paste an **existing** mint, an **amount** (decimals are read from the mint), and a **recipient** wallet. If you are the **mint authority**, it creates the recipient’s ATA if missing and **mints** to it. |

**Recipient**

- Leave **Recipient wallet** empty to use your **connected wallet**.
- Or paste any valid Solana **wallet address** (base58). Tokens are minted to that wallet’s **associated token account (ATA)** for the given mint.

**Addresses you care about**

- **Mint address** — the token type; one mint, many token accounts holding balances.
- **Token account / ATA address** — where the balance actually lives; the UI shows this after a successful mint (e.g. “minted to …”).

After creating a new classic or Token-2022 mint, you can click **Use as sell mint** or **Use as payment mint** to copy the mint into the presale setup cards.

### 2. Presale pool operations

The rest of the app talks to the **deployed pre-sale pool program** (program id comes from the bundled IDL). Typical steps:

1. Connect a wallet (Phantom is wired by default in `src/main.tsx`).
2. **Initialize** the program once per deployment (creates the global pools counter), if not already done.
3. **Register pool** with a **sell mint**; the **sale vault** (token account) is **derived** for you (ATA of the sell mint whose authority is the next pool metadata PDA). Fund that vault before users buy.
4. Configure offered amounts, buys, claims, refunds, etc., as provided by the on-chain program and the UI cards.

---

## Requirements

- **Node.js** 18+ recommended  
- A Solana wallet with enough **SOL** on your chosen cluster for fees and (for “create mint”) rent  
- **RPC URL** (optional; defaults to public **devnet** if unset)

---

## Configuration

1. Copy the example env file:

   ```bash
   cp .env.example .env
   ```

2. Edit `.env` if you want a custom RPC:

   ```bash
   # Optional — defaults to Solana devnet cluster URL
   VITE_RPC_URL=https://api.devnet.solana.com
   ```

Use **mainnet** RPCs only if you understand the risks; never commit real keys or secrets (see `.gitignore`).

---

## Install and run locally

```bash
cd presale-dapp
npm install
npm run dev
```

Open the URL Vite prints (usually `http://localhost:5173`). Connect your wallet and pick the same cluster your RPC points to.

---

## Production build

```bash
npm run build
```

Static files are written to `dist/`. Host that folder on any static host (Netlify, Vercel, Cloudflare Pages, S3, etc.).

Preview locally:

```bash
npm run preview
```

---

## Program ID and IDL

The Anchor **program id** and instruction layout come from `src/idl/pre_sale_pool.json`. If you deploy your **own** build of the program, replace that IDL (and matching program id) so the UI matches your deployment.

---

## Wallet adapters

`src/main.tsx` registers **Phantom** only. To support more wallets, add adapters from `@solana/wallet-adapter-wallets` and pass them into `WalletProvider`.

---

## Troubleshooting (short)

- **“Mint authority must be your wallet”** — for “Mint to recipient (existing mint)”, only the wallet that is the mint’s **single** mint authority can mint. Multisig mint authorities are not handled in that card.
- **Wrong cluster** — your wallet network must match `VITE_RPC_URL` / default devnet.
- **Simulation / transaction errors** — read the error panel text; it often includes program logs from a preflight simulation.

---

## License

Follow the license of the parent repository unless this folder specifies otherwise.
