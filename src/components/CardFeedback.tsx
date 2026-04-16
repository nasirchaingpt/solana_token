import type { ReactNode } from "react";

export type CardFeedbackKey =
  | "signer"
  | "poolRead"
  | "init"
  | "register"
  | "lamports"
  | "tokenSetup"
  | "buySol"
  | "buyToken"
  | "closeTime"
  | "claim"
  | "refund"
  | "claimRefundToken"
  | "claimRefundNative"
  | "tokenClassic"
  | "token2022"
  | "tokenMintTo";

export type CardFeedbackMap = Partial<
  Record<CardFeedbackKey, { ok: boolean; msg: string }>
>;

function collectLogs(obj: unknown): string[] {
  const out: string[] = [];
  let cur: unknown = obj;
  const seen = new Set<unknown>();
  for (let i = 0; i < 10 && cur != null && !seen.has(cur); i++) {
    seen.add(cur);
    if (typeof cur === "object") {
      const logs = (cur as { logs?: unknown }).logs;
      if (Array.isArray(logs) && logs.length) {
        out.push(logs.map((l) => String(l)).join("\n"));
      }
    }
    const next =
      cur instanceof Error
        ? (cur as Error & { cause?: unknown }).cause
        : typeof cur === "object" && cur !== null && "cause" in cur
          ? (cur as { cause: unknown }).cause
          : undefined;
    cur = next;
  }
  return out;
}

/** Wallet / RPC / Anchor errors: message chain, simulation logs, stack. */
export function formatTxError(e: unknown): string {
  const parts: string[] = [];
  let cur: unknown = e;
  const seen = new Set<unknown>();
  for (let i = 0; i < 10 && cur != null && !seen.has(cur); i++) {
    seen.add(cur);
    if (cur instanceof Error) {
      if (cur.message) parts.push(cur.message);
      cur = (cur as Error & { cause?: unknown }).cause;
    } else if (typeof cur === "object" && cur !== null && "message" in cur) {
      const m = (cur as { message: unknown }).message;
      if (m != null && String(m)) parts.push(String(m));
      cur =
        "cause" in cur ? (cur as { cause: unknown }).cause : undefined;
    } else {
      parts.push(String(cur));
      break;
    }
  }
  const logs = collectLogs(e);
  if (logs.length) {
    parts.push("", "Program logs:", ...logs);
  }
  if (e instanceof Error && e.stack) parts.push("", e.stack);
  return parts.join("\n");
}

export function CardFeedback({
  cardId,
  feedback,
}: {
  cardId: CardFeedbackKey;
  feedback: CardFeedbackMap;
}): ReactNode {
  const f = feedback[cardId];
  if (!f) return null;
  return (
    <div className={`card-feedback ${f.ok ? "ok" : "err"}`} role="status">
      <div className="card-feedback-label">{f.ok ? "Result" : "Error"}</div>
      <pre className="card-feedback-msg">{f.msg}</pre>
    </div>
  );
}
