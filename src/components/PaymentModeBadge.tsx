import { cn } from '@/lib/utils';
import { Banknote, Wifi, Clock, Gift } from 'lucide-react';
import { PaymentMode, PaymentStatus, SettlementMode } from '@/lib/payments';

interface PaymentModeBadgeProps {
  mode?: PaymentMode;
  status?: PaymentStatus;
  /** When a 'Due' entry has been settled, this is the final payment method used. */
  settledVia?: SettlementMode;
  className?: string;
}

/**
 * Shared badge that renders all 4 payment modes + settlement indicator.
 * Replaces the 4 local duplicates across AEPS, Recharge, MoneyTransfer, EditWorkPage.
 *
 * Display logic:
 *  - status='pending'  → amber Due badge (clock icon)
 *  - status='free'     → slate Free badge (gift icon)
 *  - status='paid' + settledVia → show settledVia (✓ settled from Due)
 *  - status='paid' + no settledVia → show mode (Cash/Online)
 *  - legacy (no status) → treat paymentMode='Cash'|'Online' as paid
 */
export function PaymentModeBadge({ mode, status, settledVia, className }: PaymentModeBadgeProps) {
  // Resolve effective display status
  const effectiveStatus: PaymentStatus =
    status ??
    (mode === 'Due' ? 'pending' : mode === 'None' ? 'free' : 'paid');

  if (effectiveStatus === 'pending') {
    return (
      <span className={cn(
        'inline-flex items-center gap-1 text-xs font-medium px-1.5 py-0.5 rounded',
        'bg-amber-100 text-amber-700',
        className,
      )}>
        <Clock className="h-3 w-3" />
        Due
      </span>
    );
  }

  if (effectiveStatus === 'free') {
    return (
      <span className={cn(
        'inline-flex items-center gap-1 text-xs font-medium px-1.5 py-0.5 rounded',
        'bg-slate-100 text-slate-600',
        className,
      )}>
        <Gift className="h-3 w-3" />
        Free
      </span>
    );
  }

  // paid — determine the effective payment method
  const displayMode: SettlementMode =
    settledVia ?? ((mode === 'Online') ? 'Online' : 'Cash');
  const isOnline = displayMode === 'Online';

  return (
    <span className={cn(
      'inline-flex items-center gap-1 text-xs font-medium px-1.5 py-0.5 rounded',
      isOnline ? 'bg-blue-100 text-blue-700' : 'bg-emerald-100 text-emerald-700',
      className,
    )}>
      {isOnline ? <Wifi className="h-3 w-3" /> : <Banknote className="h-3 w-3" />}
      {displayMode}
      {settledVia && <span className="opacity-60 text-[10px]">✓</span>}
    </span>
  );
}
