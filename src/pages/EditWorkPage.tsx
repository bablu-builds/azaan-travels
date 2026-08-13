import { useState, useEffect } from 'react';
import { useLocation, useParams } from 'wouter';
import {
  updateWorkEntry, subscribeToWorkEntries, WorkEntry, AttachedFile,
  addPaymentToEntry, addAdjustment, subscribeToAdjustments, DealAdjustment,
} from '@/lib/firestore';
import { DocumentUploadSection } from '@/components/DocumentUploadSection';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { WorkEntryForm, WorkEntryFormData } from '@/components/WorkEntryForm';
import {
  ArrowLeft, Loader2, Clock, CheckCircle2, XCircle, Plus, IndianRupee,
  CreditCard, UserCircle2, SlidersHorizontal, TrendingUp, TrendingDown,
  AlertTriangle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Timestamp } from 'firebase/firestore';
import { format, formatDistanceStrict } from 'date-fns';
import { formatCurrency } from '@/lib/format';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { PaymentModeBadge } from '@/components/PaymentModeBadge';
import { SettlementMode } from '@/lib/payments';
import { Banknote, Wifi } from 'lucide-react';

// ── helpers ──────────────────────────────────────────────────────────────────

function signedAmount(n: number) {
  if (n === 0) return '₹0';
  return (n > 0 ? '+' : '−') + formatCurrency(Math.abs(n));
}

function AdjustedAmountLabel({
  original, net, label,
}: { original: number; net: number; label: string }) {
  if (net === 0) return <>{formatCurrency(original)}</>;
  const final = original + net;
  return (
    <span className="flex flex-col items-end leading-tight">
      <span className="font-bold">{formatCurrency(final)}</span>
      <span className="text-xs font-normal text-muted-foreground whitespace-nowrap">
        {label} ₹{original.toLocaleString('en-IN')} {net > 0 ? '+' : '−'} adj ₹{Math.abs(net).toLocaleString('en-IN')}
      </span>
    </span>
  );
}

// ── main ─────────────────────────────────────────────────────────────────────

export default function EditWorkPage() {
  const { id } = useParams();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { displayName } = useAuth();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [entry, setEntry] = useState<WorkEntry | null>(null);
  const [adjustments, setAdjustments] = useState<DealAdjustment[]>([]);
  const [loading, setLoading] = useState(true);

  // Payment dialog
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMode, setPaymentMode] = useState<SettlementMode>('Cash');
  const [addingPayment, setAddingPayment] = useState(false);

  // Adjustment dialog
  const [adjOpen, setAdjOpen] = useState(false);
  const [adjAmountChange, setAdjAmountChange] = useState('');
  const [adjChallanChange, setAdjChallanChange] = useState('');
  const [adjReason, setAdjReason] = useState('');
  const [addingAdj, setAddingAdj] = useState(false);
  const [adjOverpayWarn, setAdjOverpayWarn] = useState(false);

  // Document / Receiving local state (mirrors Firestore, updated optimistically)
  const [localDocuments, setLocalDocuments] = useState<AttachedFile[]>([]);
  const [localReceivings, setLocalReceivings] = useState<AttachedFile[]>([]);

  // Sync local lists whenever the live entry updates from Firestore
  useEffect(() => {
    if (entry) {
      setLocalDocuments(entry.documents ?? []);
      setLocalReceivings(entry.receivings ?? []);
    }
  }, [entry]);

  useEffect(() => {
    if (!id) return;
    const u1 = subscribeToWorkEntries((entries) => {
      const found = entries.find(e => e.id === id);
      if (found) setEntry(found);
      setLoading(false);
    });
    const u2 = subscribeToAdjustments(id, setAdjustments);
    return () => { u1(); u2(); };
  }, [id]);

  // ── Derived finals ────────────────────────────────────────────────────────
  const netAdjAmount = entry?.netAdjustmentAmount ?? 0;
  const netAdjChallan = entry?.netAdjustmentChallan ?? 0;
  const finalTotal = (entry?.totalAmount ?? 0) + netAdjAmount;
  const finalChallan = (entry?.challanAmount ?? 0) + netAdjChallan;
  const finalDue = finalTotal - (entry?.paidAmount ?? 0);

  // ── Handlers ─────────────────────────────────────────────────────────────

  const handleSubmit = async (data: Omit<WorkEntryFormData, 'date'> & { date: Timestamp }) => {
    if (!id || !entry) return;
    setIsSubmitting(true);
    try {
      const { paidAmount: _p, paymentMode: _pm, ...updateData } = data;
      await updateWorkEntry(id, updateData, entry.paidAmount);
      toast({ title: 'Work Updated Successfully' });
      setLocation('/work');
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Error updating work', description: error.message });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAddPayment = async () => {
    if (!id || !entry || !paymentAmount) return;
    const amt = parseFloat(paymentAmount);
    if (isNaN(amt) || amt <= 0) return;
    setAddingPayment(true);
    try {
      await addPaymentToEntry(id, { amount: amt, addedBy: displayName, paymentMode }, entry.totalAmount + netAdjAmount, entry.paidAmount);
      toast({ title: 'Payment Recorded', description: `${formatCurrency(amt)} (${paymentMode}) added successfully.` });
      setPaymentOpen(false);
      setPaymentAmount('');
      setPaymentMode('Cash');
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error', description: err.message });
    } finally {
      setAddingPayment(false);
    }
  };

  const handleAdjSave = async () => {
    if (!id || !entry) return;
    const amtChange = parseFloat(adjAmountChange) || 0;
    const challanChange = parseFloat(adjChallanChange) || 0;
    if (!adjReason.trim() || (amtChange === 0 && challanChange === 0)) return;

    // warn about overpayment before first confirm
    const newFinalTotal = finalTotal + amtChange;
    const newDue = newFinalTotal - entry.paidAmount;
    if (newDue < 0 && !adjOverpayWarn) {
      setAdjOverpayWarn(true);
      return;
    }
    setAdjOverpayWarn(false);

    setAddingAdj(true);
    try {
      await addAdjustment(
        id,
        { amountChange: amtChange, challanChange: challanChange, reason: adjReason.trim(), recordedBy: displayName ?? 'Unknown' },
        { totalAmount: entry.totalAmount, paidAmount: entry.paidAmount, netAdjustmentAmount: netAdjAmount, netAdjustmentChallan: netAdjChallan },
      );
      toast({ title: 'Adjustment recorded', description: `${signedAmount(amtChange)} on total · ${signedAmount(challanChange)} on challan` });
      resetAdjDialog();
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error', description: err.message });
    } finally {
      setAddingAdj(false);
    }
  };

  const resetAdjDialog = () => {
    setAdjOpen(false);
    setAdjAmountChange('');
    setAdjChallanChange('');
    setAdjReason('');
    setAdjOverpayWarn(false);
  };

  const adjCanSave =
    adjReason.trim().length > 0 &&
    ((parseFloat(adjAmountChange) !== 0 && !isNaN(parseFloat(adjAmountChange))) ||
     (parseFloat(adjChallanChange) !== 0 && !isNaN(parseFloat(adjChallanChange))));

  // ── Merged timeline (payments + adjustments, sorted by createdAt) ──────────
  type TimelineItem =
    | { kind: 'payment'; ts: number; amount: number; mode: SettlementMode; addedBy?: string }
    | { kind: 'adjustment'; ts: number; amountChange: number; challanChange: number; reason: string; recordedBy: string }
    | { kind: 'created'; ts: number }
    | { kind: 'completed'; ts: number }
    | { kind: 'rejected'; ts: number; reason?: string; refund?: number };

  const timeline: TimelineItem[] = [];
  if (entry?.createdAt) timeline.push({ kind: 'created', ts: entry.createdAt.toMillis() });
  (entry?.payments ?? []).forEach(p => timeline.push({
    kind: 'payment', ts: p.paidAt?.toMillis() ?? entry!.createdAt.toMillis(),
    amount: p.amount, mode: p.paymentMode ?? 'Cash', addedBy: p.addedBy,
  }));
  adjustments.forEach(a => timeline.push({
    kind: 'adjustment', ts: a.createdAt.toMillis(),
    amountChange: a.amountChange, challanChange: a.challanChange,
    reason: a.reason, recordedBy: a.recordedBy,
  }));
  if (entry?.status === 'Completed' && entry.completedAt)
    timeline.push({ kind: 'completed', ts: entry.completedAt.toMillis() });
  if (entry?.status === 'Rejected' && entry.rejectedAt)
    timeline.push({ kind: 'rejected', ts: entry.rejectedAt.toMillis(), reason: entry.rejectionReason, refund: entry.refundAmount });
  timeline.sort((a, b) => a.ts - b.ts);

  // ── Loading / not-found ───────────────────────────────────────────────────

  if (loading) return (
    <div className="flex justify-center p-16">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  );
  if (!entry) return (
    <div className="text-center p-16">
      <h2 className="text-xl font-bold">Entry not found</h2>
      <Button onClick={() => setLocation('/work')} className="mt-4">Back to Work List</Button>
    </div>
  );

  const initialData: Partial<WorkEntryFormData> = {
    ...entry,
    challanAmount: entry.challanAmount ?? 0,
    date: entry.date.toDate(),
    paymentMode: entry.paymentMode ?? 'Cash',
    otherCategory: entry.otherCategory ?? '',
  };

  const payments = entry.payments ?? [];
  const hasPaymentHistory = payments.length > 0;
  const netAdjSum = adjustments.reduce((s, a) => s + a.amountChange, 0);
  const netAdjChallanSum = adjustments.reduce((s, a) => s + a.challanChange, 0);

  return (
    <div className="max-w-3xl mx-auto space-y-6 animate-fade-in-up">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="outline" size="icon" className="h-9 w-9 shrink-0" onClick={() => window.history.back()}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold" style={{ fontFamily: 'var(--app-font-display)' }}>Edit Work Entry</h1>
          <p className="text-muted-foreground text-sm mt-0.5">{entry.customerName} — {entry.category === 'Other' && entry.otherCategory ? entry.otherCategory : entry.category}</p>
        </div>
      </div>

      {/* Metadata bar */}
      <div className="bg-muted/40 border rounded-lg px-4 py-3 text-xs text-muted-foreground flex flex-wrap gap-x-6 gap-y-1.5">
        {entry.addedBy && (
          <span className="flex items-center gap-1.5">
            <UserCircle2 className="h-3.5 w-3.5" />
            Added by: <span className="font-medium text-foreground">{entry.addedBy}</span>
          </span>
        )}
        {entry.createdAt && (
          <span className="flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5" />
            Created: {format(entry.createdAt.toDate(), 'dd MMM yyyy, h:mm a')}
          </span>
        )}
      </div>

      {/* ── PAYMENT HISTORY CARD ─────────────────────────────────────────────── */}
      <div className="bg-card border rounded-xl shadow-card">
        <div className="px-6 py-4 border-b flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <CreditCard className="h-4 w-4 text-primary" />
            <span className="font-semibold text-sm">Payment History</span>
          </div>
          <div className="flex items-center gap-4 flex-wrap">
            {/* Final total with adjustment hint */}
            <div className="text-right">
              <div className="text-xs text-muted-foreground mb-0.5">Final Total</div>
              <AdjustedAmountLabel original={entry.totalAmount} net={netAdjAmount} label="Orig." />
            </div>
            {(entry.challanAmount ?? 0) > 0 && (
              <div className="text-right">
                <div className="text-xs text-muted-foreground mb-0.5">Challan</div>
                <AdjustedAmountLabel original={entry.challanAmount ?? 0} net={netAdjChallan} label="Orig." />
              </div>
            )}
            <div className="text-right">
              <div className="text-xs text-muted-foreground mb-0.5">{finalDue < 0 ? 'Credit' : 'Due'}</div>
              <span className={cn("font-bold text-sm", finalDue > 0 ? 'text-red-600' : finalDue < 0 ? 'text-blue-600' : 'text-emerald-600')}>
                {formatCurrency(Math.abs(finalDue))}
              </span>
            </div>
            {entry.status !== 'Rejected' && (
              <Button size="sm" className="gap-1.5 h-8 text-xs" onClick={() => setPaymentOpen(true)}>
                <Plus className="h-3.5 w-3.5" /> Add Payment
              </Button>
            )}
          </div>
        </div>

        <div className="divide-y">
          {!hasPaymentHistory ? (
            <div className="px-6 py-4 text-sm text-muted-foreground">
              <span className="flex items-center gap-2">
                <IndianRupee className="h-3.5 w-3.5" />
                Initial: {formatCurrency(entry.paidAmount)} on {format(entry.createdAt?.toDate() ?? new Date(), 'dd MMM yyyy')}
              </span>
            </div>
          ) : (
            payments.map((p, i) => (
              <div key={i} className="px-6 py-3 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <span className="text-sm font-medium">{formatCurrency(p.amount)}</span>
                  <PaymentModeBadge mode={p.paymentMode ?? 'Cash'} />
                  <span className="text-xs text-muted-foreground">
                    {p.paidAt ? format(p.paidAt.toDate(), 'dd MMM yyyy, h:mm a') : 'Legacy entry'}
                  </span>
                </div>
                <span className="text-xs text-muted-foreground">{p.addedBy}</span>
              </div>
            ))
          )}
        </div>

        {hasPaymentHistory && entry.paidAmount > 0 && (
          <div className="px-6 py-3 border-t bg-muted/20 flex justify-between text-sm">
            <span className="font-semibold">Total Paid</span>
            <span className="font-bold text-emerald-700">{formatCurrency(entry.paidAmount)}</span>
          </div>
        )}
      </div>

      {/* ── DEAL ADJUSTMENTS CARD ────────────────────────────────────────────── */}
      <div className="bg-card border rounded-xl shadow-card">
        <div className="px-6 py-4 border-b flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="h-4 w-4 text-primary" />
            <span className="font-semibold text-sm">Deal Adjustments</span>
          </div>
          <div className="flex items-center gap-3">
            {netAdjSum !== 0 && (
              <span className={cn(
                "text-xs font-semibold px-2 py-1 rounded-full",
                netAdjSum > 0 ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
              )}>
                Net: {signedAmount(netAdjSum)}
                {netAdjChallanSum !== 0 && ` · Challan: ${signedAmount(netAdjChallanSum)}`}
              </span>
            )}
            {entry.status !== 'Rejected' && (
              <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" onClick={() => setAdjOpen(true)}>
                <Plus className="h-3.5 w-3.5" /> Add Adjustment
              </Button>
            )}
          </div>
        </div>

        {adjustments.length === 0 ? (
          <div className="px-6 py-5 text-sm text-muted-foreground">
            No adjustments yet. Use "+ Add Adjustment" to increase or decrease the total or challan amount after creation.
          </div>
        ) : (
          <div className="divide-y">
            {adjustments.map((a, i) => (
              <div key={a.id ?? i} className="px-6 py-3 flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    {a.amountChange !== 0 && (
                      <span className={cn(
                        "inline-flex items-center gap-1 text-sm font-semibold",
                        a.amountChange > 0 ? 'text-emerald-700' : 'text-red-600'
                      )}>
                        {a.amountChange > 0
                          ? <TrendingUp className="h-3.5 w-3.5" />
                          : <TrendingDown className="h-3.5 w-3.5" />}
                        {signedAmount(a.amountChange)} on Total
                      </span>
                    )}
                    {a.challanChange !== 0 && (
                      <span className={cn(
                        "inline-flex items-center gap-1 text-sm font-semibold",
                        a.challanChange > 0 ? 'text-amber-700' : 'text-amber-500'
                      )}>
                        {signedAmount(a.challanChange)} on Challan
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 italic">"{a.reason}"</p>
                </div>
                <div className="text-right shrink-0 text-xs text-muted-foreground">
                  <div>{format(a.createdAt.toDate(), 'dd MMM yyyy, h:mm a')}</div>
                  <div className="mt-0.5">{a.recordedBy}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── STATUS TIMELINE ──────────────────────────────────────────────────── */}
      <div className="bg-card border rounded-xl shadow-card px-6 py-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">Status Timeline</p>
        <ol className="relative border-l-2 border-border ml-2 space-y-4">
          {timeline.map((item, i) => {
            const dotColor =
              item.kind === 'completed' ? 'bg-emerald-500' :
              item.kind === 'rejected' ? 'bg-red-500' :
              item.kind === 'payment' ? 'bg-blue-500' :
              item.kind === 'adjustment' ? 'bg-indigo-500' :
              'bg-muted-foreground';
            return (
              <li key={i} className="ml-5">
                <span className={`absolute -left-[9px] flex h-4 w-4 items-center justify-center rounded-full ring-2 ring-card ${dotColor}`} />
                <div className="text-xs text-muted-foreground">
                  {format(new Date(item.ts), 'dd MMM yyyy, h:mm a')}
                </div>
                {item.kind === 'created' && (
                  <div className="mt-0.5">
                    <div className="flex items-center gap-1.5 text-sm text-muted-foreground font-medium">
                      <Clock className="h-3.5 w-3.5" />
                      Entry created
                    </div>
                    <div className="text-xs text-muted-foreground ml-5 mt-0.5">
                      Total {formatCurrency(entry.totalAmount)} · Challan {formatCurrency(entry.challanAmount ?? 0)}
                    </div>
                  </div>
                )}
                {item.kind === 'payment' && (
                  <div className="flex items-center gap-1.5 text-sm mt-0.5 text-blue-700 font-medium">
                    <IndianRupee className="h-3.5 w-3.5" />
                    Payment: {formatCurrency(item.amount)} ({item.mode})
                    {item.addedBy && <span className="font-normal text-muted-foreground ml-1">by {item.addedBy}</span>}
                  </div>
                )}
                {item.kind === 'adjustment' && (
                  <div className="mt-0.5">
                    <div className={cn(
                      "flex items-center gap-1.5 text-sm font-medium",
                      item.amountChange >= 0 ? 'text-emerald-700' : 'text-red-600'
                    )}>
                      <SlidersHorizontal className="h-3.5 w-3.5" />
                      Amount Adjusted: {signedAmount(item.amountChange)}
                      {item.challanChange !== 0 && ` · Challan: ${signedAmount(item.challanChange)}`}
                    </div>
                    <div className="text-xs text-muted-foreground ml-5 mt-0.5 italic">
                      Reason: {item.reason}
                      <span className="not-italic ml-2">— {item.recordedBy}</span>
                    </div>
                  </div>
                )}
                {item.kind === 'completed' && (
                  <div className="flex items-center gap-1.5 text-sm mt-0.5 text-emerald-700 font-medium">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Marked Completed
                    {entry.createdAt && (
                      <span className="text-muted-foreground font-normal ml-1">
                        (in {formatDistanceStrict(new Date(item.ts), entry.createdAt.toDate())})
                      </span>
                    )}
                  </div>
                )}
                {item.kind === 'rejected' && (
                  <div className="mt-0.5">
                    <div className="flex items-center gap-1.5 text-sm text-red-700 font-medium">
                      <XCircle className="h-3.5 w-3.5" />
                      Rejected
                    </div>
                    {item.reason && <p className="text-xs text-muted-foreground ml-5 mt-0.5">Reason: {item.reason}</p>}
                    {item.refund ? <p className="text-xs text-red-500 ml-5">Refund: {formatCurrency(item.refund)}</p> : null}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      </div>

      {/* ── EDIT FORM ────────────────────────────────────────────────────────── */}
      <div className="bg-card border rounded-xl p-6 shadow-card">
        <p className="text-xs font-semibold mb-5 text-muted-foreground uppercase tracking-wide">Update Entry Details</p>
        <WorkEntryForm
          initialData={initialData}
          onSubmit={handleSubmit}
          isSubmitting={isSubmitting}
          isEditing={true}
          currentPaidAmount={entry.paidAmount}
          netAdjustmentAmount={netAdjAmount}
          netAdjustmentChallan={netAdjChallan}
        />
      </div>

      {/* ── DOCUMENT / RECEIVING ─────────────────────────────────────────────── */}
      {id && (
        <DocumentUploadSection
          entryId={id}
          documents={localDocuments}
          receivings={localReceivings}
          onDocumentsChange={setLocalDocuments}
          onReceivingsChange={setLocalReceivings}
        />
      )}

      {/* ── ADD PAYMENT DIALOG ───────────────────────────────────────────────── */}
      <Dialog open={paymentOpen} onOpenChange={(open) => {
        setPaymentOpen(open);
        if (!open) { setPaymentAmount(''); setPaymentMode('Cash'); }
      }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Record New Payment</DialogTitle>
          </DialogHeader>
          <div className="py-2 space-y-3">
            {finalDue > 0 ? (
              <p className="text-sm text-muted-foreground">
                Outstanding due: <span className="font-bold text-red-600">{formatCurrency(finalDue)}</span>
                {netAdjAmount !== 0 && (
                  <span className="text-xs text-muted-foreground ml-2">(after adjustments)</span>
                )}
              </p>
            ) : finalDue < 0 ? (
              <p className="text-sm text-blue-700 bg-blue-50 rounded-lg px-3 py-2 border border-blue-200">
                This entry is already overpaid by <strong>{formatCurrency(Math.abs(finalDue))}</strong>.
              </p>
            ) : (
              <p className="text-sm text-emerald-700 bg-emerald-50 rounded-lg px-3 py-2 border border-emerald-200">
                Fully paid. Recording a payment will create an overpayment/credit.
              </p>
            )}

            <div className="relative">
              <IndianRupee className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input type="number" placeholder="Enter payment amount" className="pl-9"
                value={paymentAmount} onChange={e => setPaymentAmount(e.target.value)}
                onFocus={e => e.target.select()} min={0} />
            </div>

            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">Payment Mode</p>
              <div className="flex h-9 rounded-md border border-border overflow-hidden">
                {(['Cash', 'Online'] as SettlementMode[]).map((m, idx) => (
                  <button key={m} type="button" onClick={() => setPaymentMode(m)}
                    className={cn(
                      "flex-1 flex items-center justify-center gap-1.5 text-sm font-medium transition-colors",
                      idx > 0 && "border-l border-border",
                      paymentMode === m
                        ? m === 'Cash' ? "bg-emerald-600 text-white" : "bg-blue-600 text-white"
                        : "bg-background text-muted-foreground hover:text-foreground hover:bg-muted/50"
                    )}>
                    {m === 'Cash' ? <Banknote className="h-3.5 w-3.5" /> : <Wifi className="h-3.5 w-3.5" />}
                    {m}
                  </button>
                ))}
              </div>
            </div>

            {paymentAmount && finalDue > 0 && parseFloat(paymentAmount) > finalDue && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
                ⚠ Exceeds outstanding due by{' '}
                <strong>{formatCurrency(parseFloat(paymentAmount) - finalDue)}</strong> — entry will be overpaid.
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Recorded by: <strong>{displayName}</strong> · Date/time auto-set
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPaymentOpen(false)}>Cancel</Button>
            <Button onClick={handleAddPayment} disabled={addingPayment || !paymentAmount}>
              {addingPayment && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Save Payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── ADD ADJUSTMENT DIALOG ────────────────────────────────────────────── */}
      <Dialog open={adjOpen} onOpenChange={(open) => { if (!open) resetAdjDialog(); else setAdjOpen(true); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <SlidersHorizontal className="h-4 w-4 text-primary" />
              Record Deal Adjustment
            </DialogTitle>
          </DialogHeader>

          <div className="py-1 space-y-4">
            {/* Info banner — original values */}
            <div className="rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-xs text-indigo-800 space-y-0.5">
              <div className="font-semibold mb-1 text-indigo-900">Current Values</div>
              <div className="flex gap-6 flex-wrap">
                <span>Original Total: <strong>{formatCurrency(entry.totalAmount)}</strong></span>
                <span>Original Challan: <strong>{formatCurrency(entry.challanAmount ?? 0)}</strong></span>
              </div>
              {netAdjAmount !== 0 && (
                <div className="flex gap-6 flex-wrap mt-1 text-indigo-700">
                  <span>Previous adjustments: <strong>{signedAmount(netAdjAmount)}</strong></span>
                  <span>Current Final Total: <strong>{formatCurrency(finalTotal)}</strong></span>
                </div>
              )}
            </div>

            {/* Amount change */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Additional Amount (₹)</label>
              <p className="text-xs text-muted-foreground">Positive to increase total, negative to decrease</p>
              <div className="relative">
                <IndianRupee className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  type="number"
                  placeholder="e.g. 100 or -50"
                  className="pl-9"
                  value={adjAmountChange}
                  onChange={e => { setAdjAmountChange(e.target.value); setAdjOverpayWarn(false); }}
                  onFocus={e => e.target.select()}
                />
              </div>
              {adjAmountChange && !isNaN(parseFloat(adjAmountChange)) && (
                <p className="text-xs text-muted-foreground">
                  New Final Total: <strong>{formatCurrency(finalTotal + (parseFloat(adjAmountChange) || 0))}</strong>
                </p>
              )}
            </div>

            {/* Challan change */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Additional Challan (₹)</label>
              <p className="text-xs text-muted-foreground">Positive to increase challan, negative to decrease</p>
              <div className="relative">
                <IndianRupee className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  type="number"
                  placeholder="e.g. 50 or -20"
                  className="pl-9"
                  value={adjChallanChange}
                  onChange={e => setAdjChallanChange(e.target.value)}
                  onFocus={e => e.target.select()}
                />
              </div>
            </div>

            {/* Reason — required */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium">
                Reason for Adjustment <span className="text-destructive">*</span>
              </label>
              <Textarea
                placeholder="e.g. Extra document fee added, Government fee revised, Discount applied…"
                value={adjReason}
                onChange={e => setAdjReason(e.target.value)}
                rows={2}
                className="resize-none"
              />
              {!adjReason.trim() && (adjAmountChange || adjChallanChange) && (
                <p className="text-xs text-destructive">Reason is required.</p>
              )}
            </div>

            {/* Overpayment warning */}
            {adjOverpayWarn && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                <div className="text-sm text-amber-800">
                  <strong>This adjustment will make the Due Amount negative</strong> — the customer has paid more than
                  the new final total. Click "Save Adjustment" again to confirm anyway.
                </div>
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              Recorded by: <strong>{displayName}</strong> · Date/time auto-set
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={resetAdjDialog}>Cancel</Button>
            <Button onClick={handleAdjSave} disabled={addingAdj || !adjCanSave}>
              {addingAdj && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {adjOverpayWarn ? 'Confirm Save' : 'Save Adjustment'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
