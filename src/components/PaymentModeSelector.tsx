import { cn } from '@/lib/utils';
import { Banknote, Wifi, Clock, Gift } from 'lucide-react';
import { PaymentMode } from '@/lib/payments';

interface PaymentModeSelectorProps {
  value: PaymentMode;
  onChange: (mode: PaymentMode) => void;
  disabled?: boolean;
  /** When true, show tooltip/hint text below buttons */
  showHints?: boolean;
}

const OPTIONS: {
  mode: PaymentMode;
  label: string;
  Icon: React.ElementType;
  activeClass: string;
  hint: string;
}[] = [
  {
    mode: 'Cash',
    label: 'Cash',
    Icon: Banknote,
    activeClass: 'bg-emerald-600 text-white',
    hint: 'Customer paid cash now',
  },
  {
    mode: 'Online',
    label: 'Online',
    Icon: Wifi,
    activeClass: 'bg-blue-600 text-white',
    hint: 'Paid via UPI / transfer',
  },
  {
    mode: 'Due',
    label: 'Due',
    Icon: Clock,
    activeClass: 'bg-amber-500 text-white',
    hint: 'Payment pending / credit',
  },
  {
    mode: 'None',
    label: 'Free',
    Icon: Gift,
    activeClass: 'bg-slate-500 text-white',
    hint: 'No charge (free service)',
  },
];

/**
 * 4-option Payment Mode selector (Cash / Online / Due / None).
 * Reused in WorkEntryForm, AepsWithdrawalPage, ElectricRechargePage,
 * MoneyTransferPage, and QuickWorkPage.
 */
export function PaymentModeSelector({ value, onChange, disabled, showHints }: PaymentModeSelectorProps) {
  return (
    <div className="space-y-1.5">
      <div className="flex h-10 rounded-md border border-border overflow-hidden">
        {OPTIONS.map((opt, i) => (
          <button
            key={opt.mode}
            type="button"
            disabled={disabled}
            onClick={() => onChange(opt.mode)}
            className={cn(
              'flex-1 flex items-center justify-center gap-1 text-xs font-medium transition-colors',
              i > 0 && 'border-l border-border',
              value === opt.mode
                ? opt.activeClass
                : 'bg-background text-muted-foreground hover:text-foreground hover:bg-muted/50',
              disabled && 'opacity-50 cursor-not-allowed',
            )}
          >
            <opt.Icon className="h-3 w-3 shrink-0" />
            <span className="hidden xs:inline sm:inline">{opt.label}</span>
            <span className="xs:hidden sm:hidden">{opt.label}</span>
          </button>
        ))}
      </div>
      {showHints && (
        <p className="text-xs text-muted-foreground">
          {OPTIONS.find(o => o.mode === value)?.hint}
        </p>
      )}
    </div>
  );
}
