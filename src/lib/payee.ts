// Where customers pay EliteFlow (packages, coin top-ups). Until the company account is open, payments go to the
// owner's PromptPay (KBank make e-wallet). Environment variables override it once the company account exists:
// NEXT_PUBLIC_TOPUP_PROMPTPAY_ID (or TOPUP_PROMPTPAY_ID on the server), NEXT_PUBLIC_TOPUP_ACCOUNT_NAME,
// NEXT_PUBLIC_TOPUP_BANK_NAME, NEXT_PUBLIC_TOPUP_BANK_ACCOUNT, and BILLING_RECEIVER for the slip check.
export type Payee = { promptPay: string; bank: string; account: string; name: string };

const fallback: Payee = { promptPay: "004666018608434", bank: "", account: "", name: "น.ส. ศิริกัลยา ปั้นทองสุข" };

export function billingPayee(): Payee {
  const promptPay = process.env.NEXT_PUBLIC_TOPUP_PROMPTPAY_ID || process.env.TOPUP_PROMPTPAY_ID || "";
  const account = process.env.NEXT_PUBLIC_TOPUP_BANK_ACCOUNT || "";
  // Nothing configured: the account above.
  if (!promptPay && !account) return fallback;
  return {
    promptPay,
    bank: process.env.NEXT_PUBLIC_TOPUP_BANK_NAME || "",
    account,
    name: process.env.NEXT_PUBLIC_TOPUP_ACCOUNT_NAME || "",
  };
}
/** Names a slip's receiver must contain (comma separated). With the built-in account, its owner's first name. */
export function billingReceivers(): string[] {
  const set = process.env.BILLING_RECEIVER;
  if (set) return set.split(",").map((x) => x.trim()).filter(Boolean);
  return billingPayee() === fallback || billingPayee().promptPay === fallback.promptPay ? ["ศิริกัลยา"] : [];
}
