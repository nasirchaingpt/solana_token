import { useCallback, useEffect, useMemo, useState } from "react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import {
  useAnchorWallet,
  useConnection,
  useWallet,
} from "@solana/wallet-adapter-react";
import { Program, AnchorProvider, BN, Idl } from "@coral-xyz/anchor";
import {
  ComputeBudgetProgram,
  Ed25519Program,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  Transaction,
  type Connection,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstructionWithDerivation,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import idlJson from "./idl/pre_sale_pool.json";
import {
  BLANK,
  offeredCurrencyPda,
  poolMetadataPda,
  poolsCountPda,
  refundCurrencyPda,
  rustU16,
  userByCurrencyPda,
  userClaimedPda,
  userPurchasedPda,
} from "./pda";
import { TokenPrepSection } from "./components/TokenPrepSection";
import {
  CardFeedback,
  type CardFeedbackKey,
  type CardFeedbackMap,
  formatTxError,
} from "./components/CardFeedback";

const PROGRAM_ID = new PublicKey(
  (idlJson as { metadata?: { address: string } }).metadata?.address ??
    "AuQc6ZqEoL6cBKwskUBtPZQgxvrhfuvQywJrJB8sT3pZ"
);

const LS_SIGNER = "presale_dapp_signer_secret";

/** Sale vault = ATA(mint, pool_metadata_pda[nextIndex]); token program from mint account owner. */
async function deriveSaleVaultForNextPool(
  connection: Connection,
  program: Program<Idl>,
  sellMint: PublicKey
): Promise<{
  vault: PublicKey;
  nextIndex: number;
  poolMeta: PublicKey;
  tokenProgram: PublicKey;
}> {
  const pc = poolsCountPda(PROGRAM_ID);
  const countAcc = await program.account.poolsCount.fetch(pc);
  const nextIndex = Number(countAcc.count);
  const poolMeta = poolMetadataPda(PROGRAM_ID, nextIndex);
  const info = await connection.getAccountInfo(sellMint);
  if (!info) {
    throw new Error("Mint account not found on this cluster.");
  }
  const owner = info.owner;
  let tokenProgram: PublicKey;
  if (owner.equals(TOKEN_PROGRAM_ID)) {
    tokenProgram = TOKEN_PROGRAM_ID;
  } else if (owner.equals(TOKEN_2022_PROGRAM_ID)) {
    tokenProgram = TOKEN_2022_PROGRAM_ID;
  } else {
    throw new Error(
      `Mint owner must be SPL Token (${TOKEN_PROGRAM_ID.toBase58().slice(0, 4)}…) or Token-2022 (${TOKEN_2022_PROGRAM_ID.toBase58().slice(0, 4)}…). Got: ${owner.toBase58()}`
    );
  }
  // pool_metadata is a PDA (off-curve); ATAs for PDA owners require this flag.
  const vault = getAssociatedTokenAddressSync(
    sellMint,
    poolMeta,
    true,
    tokenProgram
  );
  return { vault, nextIndex, poolMeta, tokenProgram };
}

function ed25519PresaleIx(
  poolSigner: Keypair,
  messageUtf8: string
): { ix: ReturnType<typeof Ed25519Program.createInstructionWithPrivateKey>; signature: number[] } {
  const ix = Ed25519Program.createInstructionWithPrivateKey({
    privateKey: poolSigner.secretKey,
    message: Uint8Array.from(Buffer.from(messageUtf8, "utf8")),
  });
  return { ix, signature: [...ix.data.slice(48, 112)] };
}

function toJson(obj: unknown): string {
  return JSON.stringify(
    obj,
    (_k, v) => (typeof v === "bigint" ? v.toString() : v),
    2
  );
}

export default function App() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const anchorWallet = useAnchorWallet();
  const { publicKey, sendTransaction } = wallet;

  const program = useMemo(() => {
    if (!anchorWallet) return null;
    const provider = new AnchorProvider(
      connection,
      anchorWallet,
      AnchorProvider.defaultOptions()
    );
    return new Program(idlJson as Idl, PROGRAM_ID, provider);
  }, [connection, anchorWallet]);

  const [poolSigner, setPoolSigner] = useState<Keypair | null>(() => {
    try {
      const raw = localStorage.getItem(LS_SIGNER);
      if (!raw) return null;
      const arr = JSON.parse(raw) as number[];
      return Keypair.fromSecretKey(Uint8Array.from(arr));
    } catch {
      return null;
    }
  });

  const [poolIndex, setPoolIndex] = useState(0);
  const [feedback, setFeedback] = useState<CardFeedbackMap>({});
  const [readout, setReadout] = useState("");
  /** null = still checking RPC; true = pools_count PDA exists. */
  const [poolsCountInitialized, setPoolsCountInitialized] = useState<
    boolean | null
  >(null);

  const [sellMintStr, setSellMintStr] = useState("");
  /** Read-only preview: ATA for next pool metadata PDA + current mint. */
  const [derivedSaleVault, setDerivedSaleVault] = useState("");
  const [derivedVaultHint, setDerivedVaultHint] = useState("");
  const [durationSec, setDurationSec] = useState("86400");
  const [openTime, setOpenTime] = useState(() =>
    String(Math.floor(Date.now() / 1000) - 60)
  );

  const [fundWalletStr, setFundWalletStr] = useState("");
  const [lamportRate, setLamportRate] = useState("1000000000");
  const [lamportDecimals, setLamportDecimals] = useState("9");

  const [payMintStr, setPayMintStr] = useState("");
  const [poolPayVaultStr, setPoolPayVaultStr] = useState("");
  const [tokenRate, setTokenRate] = useState("1000000000");
  const [tokenDecimals, setTokenDecimals] = useState("9");

  const [buyMax, setBuyMax] = useState("10000000000000");
  const [buyMin, setBuyMin] = useState("1");
  const [lamportsBuy, setLamportsBuy] = useState("1000000");
  const [tokenPayAmount, setTokenPayAmount] = useState("1000000");

  const [closeTime, setCloseTime] = useState(() =>
    String(Math.floor(Date.now() / 1000) + 3600)
  );
  const [claimAmount, setClaimAmount] = useState("");
  const [refundDeadline, setRefundDeadline] = useState(() =>
    String(Math.floor(Date.now() / 1000) + 7200)
  );

  const payMintPk = useMemo((): PublicKey | null => {
    try {
      const t = payMintStr.trim();
      if (!t) return null;
      return new PublicKey(t);
    } catch {
      return null;
    }
  }, [payMintStr]);

  useEffect(() => {
    if (!program || !sellMintStr.trim()) {
      setDerivedSaleVault("");
      setDerivedVaultHint("");
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const sellMint = new PublicKey(sellMintStr.trim());
        const { vault, nextIndex, poolMeta, tokenProgram } =
          await deriveSaleVaultForNextPool(connection, program, sellMint);
        if (cancelled) return;
        setDerivedSaleVault(vault.toBase58());
        const progLabel = tokenProgram.equals(TOKEN_2022_PROGRAM_ID)
          ? "Token-2022"
          : "SPL Token";
        setDerivedVaultHint(
          `Next pool index ${nextIndex}; pool_metadata ${poolMeta.toBase58()}; ${progLabel} ATA`
        );
      } catch (e) {
        if (cancelled) return;
        setDerivedSaleVault("");
        setDerivedVaultHint(formatTxError(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [connection, program, sellMintStr]);

  const refreshInitStatus = useCallback(async () => {
    try {
      const pc = poolsCountPda(PROGRAM_ID);
      const info = await connection.getAccountInfo(pc);
      setPoolsCountInitialized(!!info);
    } catch {
      setPoolsCountInitialized(false);
    }
  }, [connection]);

  useEffect(() => {
    void refreshInitStatus();
  }, [refreshInitStatus]);

  const setCard = useCallback(
    (id: CardFeedbackKey, ok: boolean, msg: string) => {
      setFeedback((prev) => ({ ...prev, [id]: { ok, msg } }));
    },
    []
  );

  const sendTx = useCallback(
    async (tx: Transaction, partialSigners?: Keypair[]) => {
      if (!publicKey || !sendTransaction) throw new Error("Wallet not connected");
      tx.feePayer = publicKey;
      const { blockhash, lastValidBlockHeight } =
        await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      for (const k of partialSigners ?? []) {
        tx.partialSign(k);
      }
      // Legacy `Transaction` overload: 2nd arg must be `Signer[] | undefined`, never a config object.
      // Do not pass `partialSigners` here: web3 then calls `transaction.sign(...signers)` and requires
      // `transaction.signature` (fee-payer slot). Wallet has not signed yet → `!signature`.
      // `partialSign` above already applied; simulate with undefined uses copied sigs + sigVerify off.
      const sim = await connection.simulateTransaction(tx, undefined, false);
      if (sim.value.err) {
        const logs = sim.value.logs?.join("\n") ?? "(no logs)";
        throw new Error(
          `Simulation failed: ${JSON.stringify(sim.value.err)}\n${logs}`
        );
      }
      const sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction(
        { signature: sig, blockhash, lastValidBlockHeight },
        "confirmed"
      );
      return sig;
    },
    [connection, publicKey, sendTransaction]
  );

  const generateSigner = () => {
    const kp = Keypair.generate();
    setPoolSigner(kp);
    localStorage.setItem(LS_SIGNER, JSON.stringify([...kp.secretKey]));
    setCard(
      "signer",
      true,
      "New presale signer generated and saved in this browser (localStorage)."
    );
  };

  const clearSigner = () => {
    setPoolSigner(null);
    localStorage.removeItem(LS_SIGNER);
    setCard("signer", true, "Presale signer cleared.");
  };

  /** On-chain accounts (matches `lib.rs` / IDL). */
  const refreshRead = useCallback(async () => {
    if (!program) {
      setCard("poolRead", false, "Connect wallet first.");
      return;
    }
    try {
      const pc = poolsCountPda(PROGRAM_ID);
      const pcAcc = await connection.getAccountInfo(pc);
      setPoolsCountInitialized(!!pcAcc);
      let poolsCount: unknown = null;
      if (pcAcc && program.account.poolsCount) {
        try {
          poolsCount = await program.account.poolsCount.fetch(pc);
        } catch {
          poolsCount = "(decode failed)";
        }
      } else {
        poolsCount = "(not initialized — run Initialize)";
      }

      const metaPk = poolMetadataPda(PROGRAM_ID, poolIndex);
      let poolMetadata: unknown = null;
      const metaAcc = await connection.getAccountInfo(metaPk);
      if (metaAcc && program.account.poolMetadata) {
        try {
          poolMetadata = await program.account.poolMetadata.fetch(metaPk);
        } catch {
          poolMetadata = "(decode failed)";
        }
      } else {
        poolMetadata = "(missing)";
      }

      let userPurchased: unknown = "—";
      let userByCurrencySol: unknown = "—";
      let userByCurrencyToken: unknown = "—";
      let userClaimed: unknown = "—";
      let offeredSol: unknown = "—";
      let offeredPay: unknown = "—";
      let refundSol: unknown = "—";
      let refundPay: unknown = "—";

      if (publicKey) {
        const up = userPurchasedPda(PROGRAM_ID, poolIndex, publicKey);
        if (await connection.getAccountInfo(up)) {
          userPurchased = await program.account.userPurchased.fetch(up);
        }
        const ubcSol = userByCurrencyPda(
          PROGRAM_ID,
          poolIndex,
          publicKey,
          BLANK
        );
        if (await connection.getAccountInfo(ubcSol)) {
          userByCurrencySol = await program.account.userByCurrency.fetch(
            ubcSol
          );
        }
        if (payMintPk) {
          const ocPay = offeredCurrencyPda(PROGRAM_ID, poolIndex, payMintPk);
          if (await connection.getAccountInfo(ocPay)) {
            offeredPay = await program.account.offeredCurrency.fetch(ocPay);
            const ubcPay = userByCurrencyPda(
              PROGRAM_ID,
              poolIndex,
              publicKey,
              payMintPk
            );
            if (await connection.getAccountInfo(ubcPay)) {
              userByCurrencyToken = await program.account.userByCurrency.fetch(
                ubcPay
              );
            }
          }
          const rcPay = refundCurrencyPda(PROGRAM_ID, poolIndex, payMintPk);
          if (await connection.getAccountInfo(rcPay)) {
            refundPay = await program.account.refundCurrency.fetch(rcPay);
          }
        }
        const uc = userClaimedPda(PROGRAM_ID, poolIndex, publicKey);
        if (await connection.getAccountInfo(uc)) {
          userClaimed = await program.account.userClaimed.fetch(uc);
        }
        const ocBlank = offeredCurrencyPda(PROGRAM_ID, poolIndex, BLANK);
        if (await connection.getAccountInfo(ocBlank)) {
          offeredSol = await program.account.offeredCurrency.fetch(ocBlank);
        }
        const rcBlank = refundCurrencyPda(PROGRAM_ID, poolIndex, BLANK);
        if (await connection.getAccountInfo(rcBlank)) {
          refundSol = await program.account.refundCurrency.fetch(rcBlank);
        }
      }

      setReadout(
        toJson({
          programId: PROGRAM_ID.toBase58(),
          poolIndex,
          poolsCountPda: pc.toBase58(),
          poolsCount,
          poolMetadataPda: metaPk.toBase58(),
          poolMetadata,
          offeredCurrencySol_blank: offeredSol,
          offeredCurrency_paymentMint: offeredPay,
          refundCurrency_blank: refundSol,
          refundCurrency_paymentMint: refundPay,
          connectedWallet: publicKey?.toBase58(),
          userPurchased,
          userByCurrency_blank_SOL: userByCurrencySol,
          userByCurrency_paymentMint: userByCurrencyToken,
          userClaimed,
        })
      );
      setCard("poolRead", true, "Refreshed on-chain data.");
    } catch (e) {
      setCard("poolRead", false, formatTxError(e));
    }
  }, [connection, payMintPk, poolIndex, program, publicKey, setCard]);

  const initialize = async () => {
    if (!program || !publicKey) {
      setCard("init", false, "Connect wallet.");
      return;
    }
    try {
      const tx = await program.methods
        .initialize()
        .accounts({
          poolsCount: poolsCountPda(PROGRAM_ID),
          user: publicKey,
          systemProgram: SystemProgram.programId,
        })
        .transaction();
      const sig = await sendTx(tx);
      setPoolsCountInitialized(true);
      setCard("init", true, `initialize ok: ${sig}`);
      refreshRead();
    } catch (e) {
      setCard("init", false, formatTxError(e));
    }
  };

  const registerPool = async () => {
    if (!program || !publicKey) {
      setCard("register", false, "Connect wallet.");
      return;
    }
    if (!poolSigner) {
      setCard(
        "register",
        false,
        "Generate or load a presale signer keypair."
      );
      return;
    }
    try {
      const sellMint = new PublicKey(sellMintStr.trim());
      const { vault: sellVault, nextIndex, poolMeta, tokenProgram } =
        await deriveSaleVaultForNextPool(connection, program, sellMint);
      const pc = poolsCountPda(PROGRAM_ID);

      const tx = new Transaction();
      const vaultInfo = await connection.getAccountInfo(sellVault);
      if (!vaultInfo) {
        tx.add(
          createAssociatedTokenAccountIdempotentInstructionWithDerivation(
            publicKey,
            poolMeta,
            sellMint,
            true,
            tokenProgram
          )
        );
      }
      const registerIx = await program.methods
        .registerPool(
          sellMint,
          sellVault,
          new BN(durationSec),
          new BN(openTime),
          poolSigner.publicKey
        )
        .accounts({
          poolsCount: pc,
          poolMetadata: poolMeta,
          sellTokenMint: sellMint,
          sellTokenAccount: sellVault,
          user: publicKey,
          systemProgram: SystemProgram.programId,
        })
        .instruction();
      tx.add(registerIx);

      const sig = await sendTx(tx);
      setPoolIndex(nextIndex);
      setCard(
        "register",
        true,
        `registerPool ok — pool index ${nextIndex}. Sig: ${sig}`
      );
      refreshRead();
    } catch (e) {
      setCard("register", false, formatTxError(e));
    }
  };

  const setOfferedLamports = async () => {
    if (!program || !publicKey) {
      setCard("lamports", false, "Connect wallet.");
      return;
    }
    try {
      const fund = new PublicKey(fundWalletStr.trim());
      const tx = await program.methods
        .setOfferedLamportsData(
          poolIndex,
          new BN(lamportRate),
          Number(lamportDecimals),
          fund
        )
        .accounts({
          poolMetadata: poolMetadataPda(PROGRAM_ID, poolIndex),
          offeredCurrency: offeredCurrencyPda(PROGRAM_ID, poolIndex, BLANK),
          user: publicKey,
          systemProgram: SystemProgram.programId,
        })
        .transaction();
      const sig = await sendTx(tx);
      setCard("lamports", true, `setOfferedLamportsData ok: ${sig}`);
      refreshRead();
    } catch (e) {
      setCard("lamports", false, formatTxError(e));
    }
  };

  const setOfferedToken = async () => {
    if (!program || !publicKey) {
      setCard("tokenSetup", false, "Connect wallet.");
      return;
    }
    try {
      const mint = new PublicKey(payMintStr.trim());
      const vault = new PublicKey(poolPayVaultStr.trim());
      const tx = await program.methods
        .setOfferedTokenData(
          poolIndex,
          mint,
          new BN(tokenRate),
          Number(tokenDecimals),
          vault,
          vault
        )
        .accounts({
          poolMetadata: poolMetadataPda(PROGRAM_ID, poolIndex),
          offeredCurrency: offeredCurrencyPda(PROGRAM_ID, poolIndex, mint),
          offeredTokenMint: mint,
          offeredTokenAccount: vault,
          fundingTokenAccount: vault,
          user: publicKey,
          systemProgram: SystemProgram.programId,
        })
        .transaction();
      const sig = await sendTx(tx);
      setCard("tokenSetup", true, `setOfferedTokenData ok: ${sig}`);
      refreshRead();
    } catch (e) {
      setCard("tokenSetup", false, formatTxError(e));
    }
  };

  const buySol = async () => {
    if (!program || !publicKey || !poolSigner) {
      setCard(
        "buySol",
        false,
        "Wallet + presale signer required."
      );
      return;
    }
    try {
      const meta = await program.account.poolMetadata.fetch(
        poolMetadataPda(PROGRAM_ID, poolIndex)
      );
      const msg = `${publicKey.toBase58()}::${buyMax}::${buyMin}::${rustU16(poolIndex)}`;
      const { ix: edIx, signature } = ed25519PresaleIx(poolSigner, msg);

      const ix = await program.methods
        .buyTokenBySolWithPermission(
          poolIndex,
          publicKey,
          new BN(buyMax),
          new BN(buyMin),
          signature,
          new BN(lamportsBuy)
        )
        .accounts({
          poolMetadata: poolMetadataPda(PROGRAM_ID, poolIndex),
          offeredCurrency: offeredCurrencyPda(PROGRAM_ID, poolIndex, BLANK),
          userPurchased: userPurchasedPda(PROGRAM_ID, poolIndex, publicKey),
          userByCurrency: userByCurrencyPda(
            PROGRAM_ID,
            poolIndex,
            publicKey,
            BLANK
          ),
          user: publicKey,
          systemProgram: SystemProgram.programId,
          fundingWallet: new PublicKey(fundWalletStr.trim()),
          tokenAccount: meta.tokenAccount,
          tokenMint: meta.tokenMint,
          ixSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
        })
        .instruction();

      const tx = new Transaction();
      tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 500_000 }));
      tx.add(edIx);
      tx.add(ix);
      const sig = await sendTx(tx);
      setCard("buySol", true, `buyTokenBySolWithPermission ok: ${sig}`);
      refreshRead();
    } catch (e) {
      setCard("buySol", false, formatTxError(e));
    }
  };

  const buyToken = async () => {
    if (!program || !publicKey || !poolSigner) {
      setCard(
        "buyToken",
        false,
        "Wallet + presale signer required."
      );
      return;
    }
    if (!payMintPk) {
      setCard("buyToken", false, "Enter a valid payment mint.");
      return;
    }
    try {
      const payMint = payMintPk;
      const fromAta = getAssociatedTokenAddressSync(payMint, publicKey);
      const poolPayVault = new PublicKey(poolPayVaultStr.trim());
      const meta = await program.account.poolMetadata.fetch(
        poolMetadataPda(PROGRAM_ID, poolIndex)
      );

      const msg = `${publicKey.toBase58()}::${buyMax}::${buyMin}::${rustU16(poolIndex)}`;
      const { ix: edIx, signature } = ed25519PresaleIx(poolSigner, msg);

      const ix = await program.methods
        .buyTokenByTokenWithPermission(
          poolIndex,
          publicKey,
          new BN(buyMax),
          new BN(buyMin),
          signature,
          payMint,
          new BN(tokenPayAmount),
          fromAta
        )
        .accounts({
          user: publicKey,
          systemProgram: SystemProgram.programId,
          poolMetadata: poolMetadataPda(PROGRAM_ID, poolIndex),
          offeredCurrency: offeredCurrencyPda(PROGRAM_ID, poolIndex, payMint),
          userPurchased: userPurchasedPda(PROGRAM_ID, poolIndex, publicKey),
          userByCurrency: userByCurrencyPda(
            PROGRAM_ID,
            poolIndex,
            publicKey,
            payMint
          ),
          sellTokenAccount: meta.tokenAccount,
          ixSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
          tokenFromAccount: fromAta,
          tokenToAccount: poolPayVault,
          buyTokenMint: payMint,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .instruction();

      const tx = new Transaction();
      tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 500_000 }));
      tx.add(edIx);
      tx.add(ix);
      const sig = await sendTx(tx);
      setCard("buyToken", true, `buyTokenByTokenWithPermission ok: ${sig}`);
      refreshRead();
    } catch (e) {
      setCard("buyToken", false, formatTxError(e));
    }
  };

  const setClose = async () => {
    if (!program || !publicKey) {
      setCard("closeTime", false, "Connect wallet.");
      return;
    }
    try {
      const tx = await program.methods
        .setCloseTime(poolIndex, new BN(closeTime))
        .accounts({
          poolMetadata: poolMetadataPda(PROGRAM_ID, poolIndex),
          user: publicKey,
        })
        .transaction();
      const sig = await sendTx(tx);
      setCard("closeTime", true, `setCloseTime ok: ${sig}`);
      refreshRead();
    } catch (e) {
      setCard("closeTime", false, formatTxError(e));
    }
  };

  const claimTokens = async () => {
    if (!program || !publicKey || !poolSigner) {
      setCard("claim", false, "Wallet + presale signer required.");
      return;
    }
    try {
      const meta = await program.account.poolMetadata.fetch(
        poolMetadataPda(PROGRAM_ID, poolIndex)
      );
      const mint = meta.tokenMint as PublicKey;
      const dest = getAssociatedTokenAddressSync(mint, publicKey);
      const amtStr =
        claimAmount.trim() ||
        (await program.account.userPurchased.fetch(
          userPurchasedPda(PROGRAM_ID, poolIndex, publicKey)
        )).amount.toString();
      const amount = new BN(amtStr);

      const idxOnChain = Number(meta.index);
      const msg = `${publicKey.toBase58()}::${amount.toString()}::${rustU16(idxOnChain)}`;
      const { ix: edIx, signature } = ed25519PresaleIx(poolSigner, msg);

      const ix = await program.methods
        .claimTokens(poolIndex, publicKey, dest, amount, signature)
        .accounts({
          user: publicKey,
          poolMetadata: poolMetadataPda(PROGRAM_ID, poolIndex),
          userClaimed: userClaimedPda(PROGRAM_ID, poolIndex, publicKey),
          userPurchased: userPurchasedPda(PROGRAM_ID, poolIndex, publicKey),
          sellTokenAccount: meta.tokenAccount,
          sellTokenMint: mint,
          candidateTokenAccount: dest,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          ixSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
        })
        .instruction();

      const tx = new Transaction();
      tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 500_000 }));
      tx.add(edIx);
      tx.add(ix);
      const sig = await sendTx(tx);
      setCard("claim", true, `claimTokens ok: ${sig}`);
      refreshRead();
    } catch (e) {
      setCard("claim", false, formatTxError(e));
    }
  };

  const refundTokens = async () => {
    if (!program || !publicKey || !poolSigner) {
      setCard("refund", false, "Wallet + presale signer required.");
      return;
    }
    try {
      const meta = await program.account.poolMetadata.fetch(
        poolMetadataPda(PROGRAM_ID, poolIndex)
      );
      const currency = payMintStr.trim()
        ? new PublicKey(payMintStr.trim())
        : BLANK;
      const idxOnChain = Number(meta.index);
      const msg = `${publicKey.toBase58()}::${currency.toBase58()}::${refundDeadline}::${rustU16(idxOnChain)}`;
      const { ix: edIx, signature } = ed25519PresaleIx(poolSigner, msg);

      const ix = await program.methods
        .refundTokens(
          poolIndex,
          publicKey,
          currency,
          new BN(refundDeadline),
          signature
        )
        .accounts({
          user: publicKey,
          poolMetadata: poolMetadataPda(PROGRAM_ID, poolIndex),
          userClaimed: userClaimedPda(PROGRAM_ID, poolIndex, publicKey),
          userByCurrency: userByCurrencyPda(
            PROGRAM_ID,
            poolIndex,
            publicKey,
            currency
          ),
          userPurchased: userPurchasedPda(PROGRAM_ID, poolIndex, publicKey),
          refundCurrency: refundCurrencyPda(PROGRAM_ID, poolIndex, currency),
          offeredCurrency: offeredCurrencyPda(
            PROGRAM_ID,
            poolIndex,
            currency
          ),
          systemProgram: SystemProgram.programId,
          ixSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
        })
        .instruction();

      const tx = new Transaction();
      tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 500_000 }));
      tx.add(edIx);
      tx.add(ix);
      const sig = await sendTx(tx);
      setCard("refund", true, `refundTokens ok: ${sig}`);
      refreshRead();
    } catch (e) {
      setCard("refund", false, formatTxError(e));
    }
  };

  const claimRefundTokens = async () => {
    if (!program || !publicKey || !poolSigner) {
      setCard("claimRefundToken", false, "Wallet + presale signer required.");
      return;
    }
    if (!payMintPk) {
      setCard(
        "claimRefundToken",
        false,
        "Enter payment mint + pool vault."
      );
      return;
    }
    try {
      const meta = await program.account.poolMetadata.fetch(
        poolMetadataPda(PROGRAM_ID, poolIndex)
      );
      const currency = payMintPk;
      const poolPayVault = new PublicKey(poolPayVaultStr.trim());
      const dest = getAssociatedTokenAddressSync(currency, publicKey);

      const idxOnChain = Number(meta.index);
      const msg = `${publicKey.toBase58()}::${currency.toBase58()}::${rustU16(idxOnChain)}`;
      const { ix: edIx, signature } = ed25519PresaleIx(poolSigner, msg);

      const ix = await program.methods
        .claimRefundTokens(
          poolIndex,
          publicKey,
          dest,
          currency,
          signature
        )
        .accounts({
          user: publicKey,
          poolMetadata: poolMetadataPda(PROGRAM_ID, poolIndex),
          userByCurrency: userByCurrencyPda(
            PROGRAM_ID,
            poolIndex,
            publicKey,
            currency
          ),
          refundCurrency: refundCurrencyPda(PROGRAM_ID, poolIndex, currency),
          offeredCurrency: offeredCurrencyPda(
            PROGRAM_ID,
            poolIndex,
            currency
          ),
          offeredCurrencyAccount: poolPayVault,
          offeredCurrencyMint: currency,
          candidateTokenAccount: dest,
          tokenProgram: TOKEN_PROGRAM_ID,
          ixSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
        })
        .instruction();

      const tx = new Transaction();
      tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 500_000 }));
      tx.add(edIx);
      tx.add(ix);
      const sig = await sendTx(tx);
      setCard("claimRefundToken", true, `claimRefundTokens ok: ${sig}`);
      refreshRead();
    } catch (e) {
      setCard("claimRefundToken", false, formatTxError(e));
    }
  };

  const claimRefundNative = async () => {
    if (!program || !publicKey || !poolSigner) {
      setCard("claimRefundNative", false, "Wallet + presale signer required.");
      return;
    }
    try {
      const meta = await program.account.poolMetadata.fetch(
        poolMetadataPda(PROGRAM_ID, poolIndex)
      );
      const idxOnChain = Number(meta.index);
      const msg = `${publicKey.toBase58()}::11111111111111111111111111111111::${rustU16(idxOnChain)}`;
      const { ix: edIx, signature } = ed25519PresaleIx(poolSigner, msg);

      const ix = await program.methods
        .claimRefundNative(poolIndex, publicKey, signature)
        .accounts({
          user: publicKey,
          poolMetadata: poolMetadataPda(PROGRAM_ID, poolIndex),
          userByCurrency: userByCurrencyPda(
            PROGRAM_ID,
            poolIndex,
            publicKey,
            BLANK
          ),
          refundCurrency: refundCurrencyPda(PROGRAM_ID, poolIndex, BLANK),
          offeredCurrency: offeredCurrencyPda(PROGRAM_ID, poolIndex, BLANK),
          ixSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
          systemProgram: SystemProgram.programId,
        })
        .instruction();

      const tx = new Transaction();
      tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 500_000 }));
      tx.add(edIx);
      tx.add(ix);
      const sig = await sendTx(tx);
      setCard("claimRefundNative", true, `claimRefundNative ok: ${sig}`);
      refreshRead();
    } catch (e) {
      setCard("claimRefundNative", false, formatTxError(e));
    }
  };

  const currentPoolMetaPda = useMemo(
    () => poolMetadataPda(PROGRAM_ID, poolIndex),
    [poolIndex]
  );

  return (
    <>
      <header className="header">
        <div>
          <h1>Pre-sale pool dApp</h1>
          <p className="sub">
            Matches <code>programs/pre-sale-pool/src/lib.rs</code> — Phantom +
            Anchor on {import.meta.env.VITE_RPC_URL || "devnet (default)"}
          </p>
        </div>
        <WalletMultiButton />
      </header>

      <div className="grid">
        {/* <div className="card">
          <h2>Presale Ed25519 signer (off-chain)</h2>
          <p className="hint">
            Buy / claim / refund instructions require an Ed25519 verify ix
            signed by the pubkey you passed to <code>register_pool</code>.
            Stored only in this browser.
          </p>
          <div className="row">
            <button type="button" onClick={generateSigner}>
              Generate & save signer
            </button>
            <button type="button" className="secondary" onClick={clearSigner}>
              Clear
            </button>
          </div>
          <label>Signer pubkey</label>
          <input
            readOnly
            value={poolSigner?.publicKey.toBase58() ?? "(none)"}
          />
          <CardFeedback cardId="signer" feedback={feedback} />
        </div> */}

        {/* <div className="card card-span-full">
          <h2>Pool index & read</h2>
          <label>Active pool index (u16)</label>
          <input
            type="number"
            min={0}
            value={poolIndex}
            onChange={(e) => setPoolIndex(Number(e.target.value) || 0)}
          />
          <button
            type="button"
            disabled={!program}
            onClick={() => void refreshRead()}
          >
            Refresh on-chain data
          </button>
          <p className="hint">
            Next <code>pool_metadata</code> PDA for a new pool uses current{" "}
            <code>pools_count.count</code> before <code>register_pool</code>.
          </p>
          <CardFeedback cardId="poolRead" feedback={feedback} />
          <h3 className="card-subtitle">Decoded on-chain data</h3>
          <p className="hint">
            <code>poolsCount</code>, <code>poolMetadata</code>,{" "}
            <code>offeredCurrency</code>, <code>refundCurrency</code>,{" "}
            <code>userPurchased</code>, <code>userByCurrency</code>,{" "}
            <code>userClaimed</code> for the connected wallet and this pool index.
          </p>
          {readout ? (
            <pre className="readout readout-in-card">{readout}</pre>
          ) : (
            <p className="hint">Click “Refresh on-chain data” to load JSON here.</p>
          )}
        </div> */}

        <TokenPrepSection
          connection={connection}
          publicKey={publicKey}
          sendTx={sendTx}
          feedback={feedback}
          setCard={setCard}
          fillSellMint={setSellMintStr}
          fillPayMint={setPayMintStr}
        />

        <div className="section-title">Setup</div>
{/* 
        <div className="card">
          <h2>initialize</h2>
          {poolsCountInitialized === null ? (
            <p className="hint">
              Checking whether <code>pools_count</code> exists on this cluster…
            </p>
          ) : poolsCountInitialized ? (
            <p className="hint">
              Already initialized — the <code>POOLS::COUNT</code> PDA exists. You
              can register pools; do not run initialize again.
            </p>
          ) : (
            <p className="hint">
              Once per program: creates <code>POOLS::COUNT</code> PDA.
            </p>
          )}
          <button
            type="button"
            disabled={!program || poolsCountInitialized !== false}
            onClick={() => void initialize()}
          >
            Run initialize
          </button>
          <CardFeedback cardId="init" feedback={feedback} />
        </div> */}

        {/* <div className="card">
          <h2>register_pool</h2>
          <p className="hint">
            Sale vault is derived automatically: ATA of <code>sell_mint</code> with
            authority = next <code>pool_metadata</code> PDA (from current{" "}
            <code>pools_count </code>). Fund that address with sale tokens before buys.
          </p>
          <label>Sell token mint</label>
          <input
            value={sellMintStr}
            onChange={(e) => setSellMintStr(e.target.value)}
            placeholder="mint pubkey"
          />
          <label>Sell token account (vault, derived)</label>
          <input readOnly value={derivedSaleVault} placeholder="Enter mint above" />
          {derivedVaultHint ? (
            <p className="hint">{derivedVaultHint}</p>
          ) : null}
          <label>Duration (seconds)</label>
          <input
            value={durationSec}
            onChange={(e) => setDurationSec(e.target.value)}
          />
          <label>Open time (unix sec)</label>
          <input value={openTime} onChange={(e) => setOpenTime(e.target.value)} />
          <button
            type="button"
            disabled={!program || !poolSigner}
            onClick={() => void registerPool()}
          >
            register_pool
          </button>
          <CardFeedback cardId="register" feedback={feedback} />
        </div>

        <div className="card">
          <h2>set_offered_lamports_data (SOL buys)</h2>
          <label>Funding wallet (receives SOL)</label>
          <input
            value={fundWalletStr}
            onChange={(e) => setFundWalletStr(e.target.value)}
          />
          <label>Rate (u64)</label>
          <input value={lamportRate} onChange={(e) => setLamportRate(e.target.value)} />
          <label>Decimals (u8)</label>
          <input
            value={lamportDecimals}
            onChange={(e) => setLamportDecimals(e.target.value)}
          />
          <button type="button" disabled={!program} onClick={() => void setOfferedLamports()}>
            setOfferedLamportsData
          </button>
          <CardFeedback cardId="lamports" feedback={feedback} />
        </div>

        <div className="card">
          <h2>set_offered_token_data (SPL buys)</h2>
          <label>Payment mint</label>
          <input
            value={payMintStr}
            onChange={(e) => setPayMintStr(e.target.value)}
          />
          <label>Pool payment vault (ATA, authority = pool metadata PDA)</label>
          <input
            value={poolPayVaultStr}
            onChange={(e) => setPoolPayVaultStr(e.target.value)}
          />
          <label>Rate / decimals</label>
          <div className="row">
            <input value={tokenRate} onChange={(e) => setTokenRate(e.target.value)} />
            <input
              style={{ width: "4rem" }}
              value={tokenDecimals}
              onChange={(e) => setTokenDecimals(e.target.value)}
            />
          </div>
          <button type="button" disabled={!program} onClick={() => void setOfferedToken()}>
            setOfferedTokenData
          </button>
          <CardFeedback cardId="tokenSetup" feedback={feedback} />
        </div>

        <div className="section-title">Purchases</div>

        <div className="card">
          <h2>buy_token_by_sol_with_permission</h2>
          <p className="hint">
            Needs lamports data set + Ed25519 presale signature (auto-prefixed).
          </p>
          <label>Max / min purchase (raw token units, u64 strings)</label>
          <div className="row">
            <input value={buyMax} onChange={(e) => setBuyMax(e.target.value)} />
            <input value={buyMin} onChange={(e) => setBuyMin(e.target.value)} />
          </div>
          <label>Lamports to pay</label>
          <input
            value={lamportsBuy}
            onChange={(e) => setLamportsBuy(e.target.value)}
          />
          <button type="button" disabled={!program} onClick={() => void buySol()}>
            Buy with SOL
          </button>
          <CardFeedback cardId="buySol" feedback={feedback} />
        </div> */}

        {/* <div className="card">
          <h2>buy_token_by_token_with_permission</h2>
          <p className="hint">
            Uses your ATA for payment mint (standard associated token account).
          </p>
          <label>Token amount to pay (payment mint base units)</label>
          <input
            value={tokenPayAmount}
            onChange={(e) => setTokenPayAmount(e.target.value)}
          />
          <button type="button" disabled={!program} onClick={() => void buyToken()}>
            Buy with SPL
          </button>
          <CardFeedback cardId="buyToken" feedback={feedback} />
        </div> */}

        {/* <div className="section-title">After sale window</div> */}

        {/* <div className="card">
          <h2>set_close_time (owner)</h2>
          <label>Close time (unix sec, ≥ now)</label>
          <input value={closeTime} onChange={(e) => setCloseTime(e.target.value)} />
          <button type="button" disabled={!program} onClick={() => void setClose()}>
            setCloseTime
          </button>
          <CardFeedback cardId="closeTime" feedback={feedback} />
        </div>

        <div className="card">
          <h2>claim_tokens</h2>
          <label>Claim amount (blank = full purchased)</label>
          <input
            value={claimAmount}
            onChange={(e) => setClaimAmount(e.target.value)}
            placeholder="optional"
          />
          <button type="button" disabled={!program} onClick={() => void claimTokens()}>
            claim_tokens
          </button>
          <CardFeedback cardId="claim" feedback={feedback} />
        </div>

        <div className="card">
          <h2>refund_tokens</h2>
          <label>Refund deadline (unix sec, must be ≥ now when tx runs)</label>
          <input
            value={refundDeadline}
            onChange={(e) => setRefundDeadline(e.target.value)}
          />
          <p className="hint">
            Currency = payment mint for SPL path, or system program id for SOL
            refunds.
          </p>
          <button type="button" disabled={!program} onClick={() => void refundTokens()}>
            refund_tokens
          </button>
          <CardFeedback cardId="refund" feedback={feedback} />
        </div>

        <div className="card">
          <h2>claim_refund_tokens</h2>
          <p className="hint">After <code>refund_tokens</code> with SPL payment.</p>
          <button
            type="button"
            disabled={!program}
            onClick={() => void claimRefundTokens()}
          >
            claim_refund_tokens
          </button>
          <CardFeedback cardId="claimRefundToken" feedback={feedback} />
        </div>

        <div className="card">
          <h2>claim_refund_native</h2>
          <p className="hint">After <code>refund_tokens</code> with SOL (blank currency).</p>
          <button
            type="button"
            disabled={!program}
            onClick={() => void claimRefundNative()}
          >
            claim_refund_native
          </button>
          <CardFeedback cardId="claimRefundNative" feedback={feedback} />
        </div> */}

      </div>

      <p className="hint" style={{ marginTop: "1rem" }}>
        Pool metadata PDA (current index): {currentPoolMetaPda.toBase58()}
      </p>
    </>
  );
}
