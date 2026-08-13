/**
 * Shared Payment Mode types, helpers, and metadata.
 * Pure TypeScript — no React imports here so it can be used anywhere.
 */

export type PaymentMode = 'Cash' | 'Online' | 'Due' | 'None';
export type SettlementMode = 'Cash' | 'Online';
export type PaymentStatus = 'paid' | 'pending' | 'free';

/** Derive the payment status from the selected mode at entry creation time. */
export function deriveStatus(mode: PaymentMode): PaymentStatus {
  if (mode === 'Due') return 'pending';
  if (mode === 'None') return 'free';
  return 'paid';
}

/** For legacy entries without paymentStatus — treat them as paid. */
export function resolveStatus(status: PaymentStatus | undefined): PaymentStatus {
  return status ?? 'paid';
}

export interface PaymentModeMeta {
  label: string;
  /** Active button bg class */
  activeBg: string;
  /** Badge background class */
  badgeBg: string;
  /** Badge text class */
  badgeText: string;
}

export const PAYMENT_MODE_META: Record<PaymentMode, PaymentModeMeta> = {
  Cash: {
    label: 'Cash',
    activeBg: 'bg-emerald-600 text-white',
    badgeBg: 'bg-emerald-100',
    badgeText: 'text-emerald-700',
  },
  Online: {
    label: 'Online',
    activeBg: 'bg-blue-600 text-white',
    badgeBg: 'bg-blue-100',
    badgeText: 'text-blue-700',
  },
  Due: {
    label: 'Due',
    activeBg: 'bg-amber-500 text-white',
    badgeBg: 'bg-amber-100',
    badgeText: 'text-amber-700',
  },
  None: {
    label: 'Free',
    activeBg: 'bg-slate-500 text-white',
    badgeBg: 'bg-slate-100',
    badgeText: 'text-slate-600',
  },
};
