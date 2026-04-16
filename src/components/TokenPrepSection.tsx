import { useState } from "react";
import type { Connection } from "@solana/web3.js";
import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  MINT_SIZE,
  createInitializeMint2Instruction,
  getMinimumBalanceForRentExemptMint,
  createAssociatedTokenAccountIdempotentInstruction,
  createMintToCheckedInstruction,
  getAssociatedTokenAddressSync,
  getMint,
} from "@solana/spl-token";
import {
  CardFeedback,
  type CardFeedbackKey,
  type CardFeedbackMap,
  formatTxError,
} from "./CardFeedback";

type SendTxFn = (tx: Transaction, partialSigners?: Keypair[]) => Promise<string>;

/** SPL mint amounts are encoded as u64 on-chain. */
const U64_MAX = 18446744073709551615n;

function parseTokenAmountUi(s: string, decimals: number): bigint {
  const t = s.trim();
  if (!t) throw new Error("Enter an amount.");
  if (!/^\d+(\.\d+)?$/.test(t)) throw new Error("Amount must be a decimal number.");
  const [intPart, frac = ""] = t.split(".");
  const fracPadded = (frac + "0".repeat(decimals)).slice(0, decimals);
  const scaled =
    BigInt(intPart || "0") * 10n ** BigInt(decimals) +
    BigInt(fracPadded.padEnd(decimals, "0"));
  if (scaled <= 0n) throw new Error("Amount must be positive.");
  return scaled;
}

type Props = {
  connection: Connection;
  publicKey: PublicKey | null;
  sendTx: SendTxFn;
  feedback: CardFeedbackMap;
  setCard: (id: CardFeedbackKey, ok: boolean, msg: string) => void;
  fillSellMint: (mint: string) => void;
  fillPayMint: (mint: string) => void;
};

export function TokenPrepSection({
  connection,
  publicKey,
  sendTx,
  feedback,
  setCard,
  fillSellMint,
  fillPayMint,
}: Props) {
  const [decimalsClassic, setDecimalsClassic] = useState("9");
  const [amountClassic, setAmountClassic] = useState("1000");
  const [recipientClassic, setRecipientClassic] = useState("");
  const [lastClassicMint, setLastClassicMint] = useState("");

  const [decimals2022, setDecimals2022] = useState("9");
  const [amount2022, setAmount2022] = useState("1000");
  const [recipient2022, setRecipient2022] = useState("");
  const [last2022Mint, setLast2022Mint] = useState("");

  const [existingMintStr, setExistingMintStr] = useState("");
  const [mintToAmount, setMintToAmount] = useState("1000");
  const [mintToRecipient, setMintToRecipient] = useState("");

  const recipientPk = (raw: string, fallback: PublicKey): PublicKey => {
    const t = raw.trim();
    if (!t) return fallback;
    return new PublicKey(t);
  };

  const deployClassicAndMint = async () => {
    if (!publicKey) {
      setCard("tokenClassic", false, "Connect wallet first.");
      return;
    }
    try {
      const dec = Number(decimalsClassic);
      if (!Number.isInteger(dec) || dec < 0 || dec > 255)
        throw new Error("Decimals must be an integer 0–255 (mint u8).");

      const owner = recipientPk(recipientClassic, publicKey);
      const amount = parseTokenAmountUi(amountClassic, dec);
      if (amount > U64_MAX) {
        throw new Error(
          "Amount exceeds SPL token u64 max (18,446,744,073,709,551,615 base units)."
        );
      }

      const mint = Keypair.generate();
      const lamports = await getMinimumBalanceForRentExemptMint(connection);

      const ata = getAssociatedTokenAddressSync(
        mint.publicKey,
        owner,
        false,
        TOKEN_PROGRAM_ID
      );

      const tx = new Transaction();
      tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }));
      tx.add(
        SystemProgram.createAccount({
          fromPubkey: publicKey,
          newAccountPubkey: mint.publicKey,
          space: MINT_SIZE,
          lamports,
          programId: TOKEN_PROGRAM_ID,
        })
      );
      tx.add(
        createInitializeMint2Instruction(
          mint.publicKey,
          dec,
          publicKey,
          null,
          TOKEN_PROGRAM_ID
        )
      );
      tx.add(
        createAssociatedTokenAccountIdempotentInstruction(
          publicKey,
          ata,
          owner,
          mint.publicKey,
          TOKEN_PROGRAM_ID
        )
      );
      tx.add(
        createMintToCheckedInstruction(
          mint.publicKey,
          ata,
          publicKey,
          amount,
          dec,
          [],
          TOKEN_PROGRAM_ID
        )
      );

      const sig = await sendTx(tx, [mint]);
      setLastClassicMint(mint.publicKey.toBase58());
      setCard(
        "tokenClassic",
        true,
        `SPL classic mint ${mint.publicKey.toBase58()} — minted to ${ata.toBase58()}. Sig: ${sig}`
      );
    } catch (e) {
      setCard("tokenClassic", false, formatTxError(e));
    }
  };

  const deploy2022AndMint = async () => {
    if (!publicKey) {
      setCard("token2022", false, "Connect wallet first.");
      return;
    }
    try {
      const dec = Number(decimals2022);
      if (!Number.isInteger(dec) || dec < 0 || dec > 255)
        throw new Error("Decimals must be an integer 0–255 (mint u8).");

      const owner = recipientPk(recipient2022, publicKey);
      const amount = parseTokenAmountUi(amount2022, dec);
      if (amount > U64_MAX) {
        throw new Error(
          "Amount exceeds SPL token u64 max (18,446,744,073,709,551,615 base units)."
        );
      }

      const mint = Keypair.generate();
      const lamports = await getMinimumBalanceForRentExemptMint(connection);

      const ata = getAssociatedTokenAddressSync(
        mint.publicKey,
        owner,
        false,
        TOKEN_2022_PROGRAM_ID
      );

      const tx = new Transaction();
      tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 500_000 }));
      tx.add(
        SystemProgram.createAccount({
          fromPubkey: publicKey,
          newAccountPubkey: mint.publicKey,
          space: MINT_SIZE,
          lamports,
          programId: TOKEN_2022_PROGRAM_ID,
        })
      );
      tx.add(
        createInitializeMint2Instruction(
          mint.publicKey,
          dec,
          publicKey,
          null,
          TOKEN_2022_PROGRAM_ID
        )
      );
      tx.add(
        createAssociatedTokenAccountIdempotentInstruction(
          publicKey,
          ata,
          owner,
          mint.publicKey,
          TOKEN_2022_PROGRAM_ID
        )
      );
      tx.add(
        createMintToCheckedInstruction(
          mint.publicKey,
          ata,
          publicKey,
          amount,
          dec,
          [],
          TOKEN_2022_PROGRAM_ID
        )
      );

      const sig = await sendTx(tx, [mint]);
      setLast2022Mint(mint.publicKey.toBase58());
      setCard(
        "token2022",
        true,
        `Token-2022 mint ${mint.publicKey.toBase58()} — minted to ${ata.toBase58()}. Sig: ${sig}`
      );
    } catch (e) {
      setCard("token2022", false, formatTxError(e));
    }
  };

  /** ATA for `owner`; `allowOwnerOffCurve` if owner is a PDA. */
  const associatedTokenDest = (
    mint: PublicKey,
    owner: PublicKey,
    tokenProgram: PublicKey
  ): PublicKey => {
    try {
      return getAssociatedTokenAddressSync(mint, owner, false, tokenProgram);
    } catch {
      return getAssociatedTokenAddressSync(mint, owner, true, tokenProgram);
    }
  };

  const mintToExisting = async () => {
    if (!publicKey) {
      setCard("tokenMintTo", false, "Connect wallet first.");
      return;
    }
    try {
      const mintPk = new PublicKey(existingMintStr.trim());
      const mintAcc = await connection.getAccountInfo(mintPk);
      if (!mintAcc) throw new Error("Mint account not found on this cluster.");

      const tokenProgram = mintAcc.owner.equals(TOKEN_2022_PROGRAM_ID)
        ? TOKEN_2022_PROGRAM_ID
        : mintAcc.owner.equals(TOKEN_PROGRAM_ID)
          ? TOKEN_PROGRAM_ID
          : null;
      if (!tokenProgram) {
        throw new Error(
          "Mint must be owned by SPL Token (Tokenkeg…) or Token-2022 (TokenzQd…)."
        );
      }

      const mint = await getMint(connection, mintPk, undefined, tokenProgram);
      if (!mint.mintAuthority) {
        throw new Error("This mint has no mint authority (minting is disabled).");
      }
      if (!mint.mintAuthority.equals(publicKey)) {
        throw new Error(
          "Connected wallet must be the mint authority. Multisig authorities are not supported here."
        );
      }

      const dec = mint.decimals;
      const amount = parseTokenAmountUi(mintToAmount, dec);
      if (amount > U64_MAX) {
        throw new Error(
          "Amount exceeds SPL token u64 max (18,446,744,073,709,551,615 base units)."
        );
      }

      const owner = recipientPk(mintToRecipient, publicKey);
      const dest = associatedTokenDest(mintPk, owner, tokenProgram);

      const tx = new Transaction();
      tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }));
      const destInfo = await connection.getAccountInfo(dest);
      if (!destInfo) {
        tx.add(
          createAssociatedTokenAccountIdempotentInstruction(
            publicKey,
            dest,
            owner,
            mintPk,
            tokenProgram
          )
        );
      }
      tx.add(
        createMintToCheckedInstruction(
          mintPk,
          dest,
          publicKey,
          amount,
          dec,
          [],
          tokenProgram
        )
      );

      const sig = await sendTx(tx);
      setCard(
        "tokenMintTo",
        true,
        `Minted to ${dest.toBase58()} (owner ${owner.toBase58()}). Sig: ${sig}`
      );
    } catch (e) {
      setCard("tokenMintTo", false, formatTxError(e));
    }
  };

  return (
    <>
      <div className="section-title">
        Token prep — SPL classic & Token-2022 (local lab)
      </div>

      <div className="card">
        <h2>Mint to recipient (existing mint)</h2>
        <p className="hint">
          Uses your wallet as <strong>mint authority</strong>. Creates the recipient’s
          ATA if missing, then <code>mint_to_checked</code>. Works for classic SPL and
          Token-2022 mints (detected from the mint account owner).
        </p>
        <label>Token mint address</label>
        <input
          value={existingMintStr}
          onChange={(e) => setExistingMintStr(e.target.value)}
          placeholder="mint pubkey"
        />
        <label>Amount (UI, uses on-chain mint decimals)</label>
        <input
          value={mintToAmount}
          onChange={(e) => setMintToAmount(e.target.value)}
          placeholder="e.g. 1000.5"
        />
        <label>Recipient wallet (blank = connected wallet)</label>
        <input
          value={mintToRecipient}
          onChange={(e) => setMintToRecipient(e.target.value)}
          placeholder="defaults to connected wallet"
        />
        <div className="row">
          <button
            type="button"
            disabled={!publicKey || !existingMintStr.trim()}
            onClick={() => void mintToExisting()}
          >
            Mint to recipient
          </button>
        </div>
        <CardFeedback cardId="tokenMintTo" feedback={feedback} />
      </div>

      <div className="card">
        <h2>SPL Token (classic) — create mint & mint</h2>
        <p className="hint">
          Creates a new mint under <code>Tokenkeg…</code>, idempotent ATA for the
          recipient, and mints the amount. Mint authority = your wallet. Use for
          sale or payment mints in <code>register_pool</code> /{" "}
          <code>set_offered_token_data</code>.
        </p>
        <label>Decimals (0–255)</label>
        <input
          value={decimalsClassic}
          onChange={(e) => setDecimalsClassic(e.target.value)}
        />
        <label>Amount (UI, e.g. 1000.5)</label>
        <input
          value={amountClassic}
          onChange={(e) => setAmountClassic(e.target.value)}
        />
        <label>Recipient wallet (blank = connected wallet)</label>
        <input
          value={recipientClassic}
          onChange={(e) => setRecipientClassic(e.target.value)}
          placeholder="defaults to connected wallet"
        />
        <div className="row">
          <button
            type="button"
            disabled={!publicKey}
            onClick={() => void deployClassicAndMint()}
          >
            Create classic mint & mint
          </button>
        </div>
        {lastClassicMint && (
          <>
            <label>Last mint</label>
            <input readOnly value={lastClassicMint} />
            <div className="row">
              <button
                type="button"
                className="secondary"
                onClick={() => fillSellMint(lastClassicMint)}
              >
                Use as sell mint
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => fillPayMint(lastClassicMint)}
              >
                Use as payment mint
              </button>
            </div>
          </>
        )}
        <CardFeedback cardId="tokenClassic" feedback={feedback} />
      </div>

      <div className="card">
        <h2>Token-2022 — create mint & mint</h2>
        <p className="hint">
          Same flow using <code>TokenzQd…</code> (no extra extensions). For
          transfer-fee or other extensions, use CLI/tooling; the presale program
          validates mints on specific paths.
        </p>
        <label>Decimals (0–255)</label>
        <input
          value={decimals2022}
          onChange={(e) => setDecimals2022(e.target.value)}
        />
        <label>Amount (UI)</label>
        <input
          value={amount2022}
          onChange={(e) => setAmount2022(e.target.value)}
        />
        <label>Recipient wallet (blank = connected wallet)</label>
        <input
          value={recipient2022}
          onChange={(e) => setRecipient2022(e.target.value)}
          placeholder="defaults to connected wallet"
        />
        <div className="row">
          <button
            type="button"
            disabled={!publicKey}
            onClick={() => void deploy2022AndMint()}
          >
            Create Token-2022 mint & mint
          </button>
        </div>
        {last2022Mint && (
          <>
            <label>Last mint</label>
            <input readOnly value={last2022Mint} />
            <div className="row">
              <button
                type="button"
                className="secondary"
                onClick={() => fillSellMint(last2022Mint)}
              >
                Use as sell mint
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => fillPayMint(last2022Mint)}
              >
                Use as payment mint
              </button>
            </div>
          </>
        )}
        <CardFeedback cardId="token2022" feedback={feedback} />
      </div>
    </>
  );
}
