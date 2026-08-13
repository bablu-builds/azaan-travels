import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Banknote, Wifi, Loader2, CheckCircle2 } from 'lucide-react';
import { SettlementMode } from '@/lib/payments';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { formatCurrency } from '@/lib/format';

interface MarkAsPaidDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customerName?: string;
  amount: number;
  /** Called when user confirms — caller handles Firestore update + toast */
  onConfirm: (mode: SettlementMode) => Promise<void>;
}

/**
 * Shared dialog for settling a "Due" entry.
 * Shows only Cash / Online (2 options — Due/None are not valid settlement modes).
 * Calls onConfirm(mode) on confirm; closes automatically on success.
 */
export function MarkAsPaidDialog({
  open,
  onOpenChange,
  customerName,
  amount,
  onConfirm,
}: MarkAsPaidDialogProps) {
  const [mode, setMode] = useState<SettlementMode>('Cash');
  const [loading, setLoading] = useState(false);

  const handleConfirm = async () => {
    setLoading(true);
    try {
      await onConfirm(mode);
      onOpenChange(false);
      setMode('Cash'); // reset for next open
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!loading) onOpenChange(o); }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            Mark as Paid
          </DialogTitle>
          <DialogDescription>
            {customerName
              ? `${customerName} — ${formatCurrency(amount)}`
              : `Settling ${formatCurrency(amount)}`}
          </DialogDescription>
        </DialogHeader>

        <div className="py-2 space-y-3">
          <p className="text-sm text-muted-foreground">How did the customer pay?</p>

          <div className="flex h-10 rounded-md border border-border overflow-hidden">
            <button
              type="button"
              onClick={() => setMode('Cash')}
              className={cn(
                'flex-1 flex items-center justify-center gap-1.5 text-sm font-medium transition-colors',
                mode === 'Cash'
                  ? 'bg-emerald-600 text-white'
                  : 'bg-background text-muted-foreground hover:bg-muted/50',
              )}
            >
              <Banknote className="h-3.5 w-3.5" /> Cash
            </button>
            <button
              type="button"
              onClick={() => setMode('Online')}
              className={cn(
                'flex-1 flex items-center justify-center gap-1.5 text-sm font-medium transition-colors border-l border-border',
                mode === 'Online'
                  ? 'bg-blue-600 text-white'
                  : 'bg-background text-muted-foreground hover:bg-muted/50',
              )}
            >
              <Wifi className="h-3.5 w-3.5" /> Online
            </button>
          </div>

          <p className="text-xs text-muted-foreground">
            This will update the entry status and record the settlement in payment history.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={loading}
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Confirm Payment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
