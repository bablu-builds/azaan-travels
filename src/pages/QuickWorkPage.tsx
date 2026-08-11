import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import {
  subscribeToQuickActions, createQuickAction,
  QuickActionEntry, QuickActionCategory, QUICK_ACTION_CATEGORIES, settlePendingEntry,
} from '@/lib/firestore';
import { formatCurrency } from '@/lib/format';
import { format, isToday, isThisMonth } from 'date-fns';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Printer, IndianRupee, Hash, CalendarRange, Search,
  PlusCircle, ChevronUp, Loader2, X, Zap, AlertCircle,
} from 'lucide-react';
import { PaymentModeSelector } from '@/components/PaymentModeSelector';
import { PaymentModeBadge } from '@/components/PaymentModeBadge';
import { MarkAsPaidDialog } from '@/components/MarkAsPaidDialog';
import { PaymentMode, resolveStatus } from '@/lib/payments';
import type { SettlementMode } from '@/lib/payments';

const CATEGORY_COLORS: Record<QuickActionCategory, string> = {
  'Printout':     'bg-indigo-100 text-indigo-700',
  'Lamination':   'bg-emerald-100 text-emerald-700',
  'Xerox':        'bg-sky-100 text-sky-700',
  'PVC':          'bg-violet-100 text-violet-700',
  'Print':        'bg-amber-100 text-amber-700',
  'Photo Print':  'bg-rose-100 text-rose-700',
  'Other':        'bg-slate-100 text-slate-700',
};

function CategoryBadge({ category }: { category: QuickActionCategory }) {
  return (
    <span className={`inline-flex text-xs font-medium px-2 py-0.5 rounded ${CATEGORY_COLORS[category]}`}>
      {category}
    </span>
  );
}

export default function QuickWorkPage() {
  const { userProfile } = useAuth();
  const { toast } = useToast();

  const [entries, setEntries] = useState<QuickActionEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [firestoreError, setFirestoreError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [category, setCategory] = useState<QuickActionCategory>('Printout');
  const [customerName, setCustomerName] = useState('');
  const [amount, setAmount] = useState('');
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('Cash');
  const [submitting, setSubmitting] = useState(false);

  const [settleEntry, setSettleEntry] = useState<QuickActionEntry | null>(null);

  const [search, setSearch] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  useEffect(() => {
    const unsub = subscribeToQuickActions(
      (data) => { setEntries(data); setLoading(false); },
      (err) => { setLoading(false); setFirestoreError(err.message); },
    );
    return () => unsub();
  }, []);

  // Summary stats (paid + legacy entries only)
  const todayPaid = entries.filter(e => isToday(e.createdAt.toDate()) && resolveStatus(e.paymentStatus) === 'paid');
  const monthPaid = entries.filter(e => isThisMonth(e.createdAt.toDate()) && resolveStatus(e.paymentStatus) === 'paid');
  const todayTotal = todayPaid.reduce((s, e) => s + e.amount, 0);
  const todayCount = entries.filter(e => isToday(e.createdAt.toDate())).length;
  const monthTotal = monthPaid.reduce((s, e) => s + e.amount, 0);
  const monthCount = entries.filter(e => isThisMonth(e.createdAt.toDate())).length;
  const pendingCount = entries.filter(e => resolveStatus(e.paymentStatus) === 'pending').length;

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return entries.filter(e => {
      const d = e.createdAt.toDate();
      if (q) {
        const matchesCustomer = (e.customerName ?? '').toLowerCase().includes(q);
        const matchesCategory = e.category.toLowerCase().includes(q);
        if (!matchesCustomer && !matchesCategory) return false;
      }
      if (startDate && d < new Date(startDate + 'T00:00:00')) return false;
      if (endDate && d > new Date(endDate + 'T23:59:59')) return false;
      return true;
    });
  }, [entries, search, startDate, endDate]);

  const resetForm = () => {
    setCategory('Printout');
    setCustomerName('');
    setAmount('');
    setPaymentMode('Cash');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const amt = Number(amount);
    if (!amt || amt <= 0) {
      toast({ variant: 'destructive', title: 'Invalid amount', description: 'Enter an amount greater than 0.' });
      return;
    }
    setSubmitting(true);
    try {
      await createQuickAction({
        category,
        customerName: customerName.trim() || undefined,
        amount: amt,
        paymentMode,
        addedBy: userProfile?.displayName || userProfile?.email || 'Unknown',
      });
      toast({ title: 'Quick entry added', description: `${category} — ${formatCurrency(amt)}` });
      resetForm();
      // Keep form open for fast repeat entries
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error', description: err.message });
    } finally {
      setSubmitting(false);
    }
  };

  const handleSettle = async (mode: SettlementMode) => {
    if (!settleEntry?.id) return;
    const by = userProfile?.displayName || userProfile?.email || 'Unknown';
    await settlePendingEntry('quickWork', settleEntry.id, mode, by, {
      amount: settleEntry.amount,
      customerName: settleEntry.customerName,
      category: settleEntry.category,
    });
    toast({ title: 'Payment recorded', description: `${settleEntry.category} — ${formatCurrency(settleEntry.amount)} via ${mode}` });
  };

  const clearFilters = () => { setSearch(''); setStartDate(''); setEndDate(''); };
  const hasFilters = search || startDate || endDate;

  return (
    <div className="space-y-6 max-w-5xl" data-testid="quick-work-page">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Zap className="h-6 w-6 text-primary" />
            Quick Action Work
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Fast, one-tap logging for small jobs like Printout, Lamination, Xerox, PVC & more.
          </p>
        </div>
        <Button onClick={() => setShowForm(v => !v)} className="shrink-0" data-testid="quick-work-toggle-form-btn">
          {showForm ? <><ChevronUp className="h-4 w-4 mr-2" />Hide Form</> : <><PlusCircle className="h-4 w-4 mr-2" />Add Quick Entry</>}
        </Button>
      </div>

      {firestoreError && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span><strong>Could not load entries:</strong> {firestoreError}. Check Firestore rules.</span>
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
          {[0,1,2,3,4].map(i => <Card key={i}><CardContent className="pt-6"><Skeleton className="h-8 w-32 mb-2" /><Skeleton className="h-4 w-24" /></CardContent></Card>)}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
          <Card data-testid="quick-work-today-earning-card">
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardTitle className="text-xs font-medium text-muted-foreground">Today's Earning</CardTitle>
              <IndianRupee className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{formatCurrency(todayTotal)}</div>
              <p className="text-xs text-muted-foreground mt-1">Paid entries today</p>
            </CardContent>
          </Card>
          <Card data-testid="quick-work-today-count-card">
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardTitle className="text-xs font-medium text-muted-foreground">Today's Entries</CardTitle>
              <Hash className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{todayCount}</div>
              <p className="text-xs text-muted-foreground mt-1">Logged today</p>
            </CardContent>
          </Card>
          <Card data-testid="quick-work-month-earning-card">
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardTitle className="text-xs font-medium text-muted-foreground">This Month</CardTitle>
              <IndianRupee className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{formatCurrency(monthTotal)}</div>
              <p className="text-xs text-muted-foreground mt-1">Paid this month</p>
            </CardContent>
          </Card>
          <Card data-testid="quick-work-month-count-card">
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardTitle className="text-xs font-medium text-muted-foreground">Month Entries</CardTitle>
              <Hash className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{monthCount}</div>
              <p className="text-xs text-muted-foreground mt-1">Total this month</p>
            </CardContent>
          </Card>
          <Card className={pendingCount > 0 ? 'border-amber-300 bg-amber-50/40' : ''}>
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardTitle className="text-xs font-medium text-muted-foreground">Pending Dues</CardTitle>
              <IndianRupee className="h-4 w-4 text-amber-500" />
            </CardHeader>
            <CardContent>
              <div className={`text-2xl font-bold ${pendingCount > 0 ? 'text-amber-600' : ''}`}>{pendingCount}</div>
              <p className="text-xs text-muted-foreground mt-1">Due entries</p>
            </CardContent>
          </Card>
        </div>
      )}

      {showForm && (
        <Card data-testid="quick-work-form-card">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Printer className="h-4 w-4 text-primary" />
              New Quick Entry
            </CardTitle>
            <CardDescription>
              Category and Amount are required. Customer name is optional.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-4" data-testid="quick-work-form">
              <div className="space-y-2">
                <Label htmlFor="qw-category">Category *</Label>
                <Select value={category} onValueChange={(v) => setCategory(v as QuickActionCategory)}>
                  <SelectTrigger id="qw-category" data-testid="quick-work-category-select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {QUICK_ACTION_CATEGORIES.map(c => (
                      <SelectItem key={c} value={c} data-testid={`quick-work-category-option-${c.replace(/\s+/g, '-').toLowerCase()}`}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="qw-name">Customer Name</Label>
                <Input
                  id="qw-name"
                  placeholder="Optional"
                  value={customerName}
                  onChange={e => setCustomerName(e.target.value)}
                  data-testid="quick-work-customer-name-input"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="qw-amount">Amount (₹) *</Label>
                <Input
                  id="qw-amount"
                  type="number"
                  min="1"
                  step="1"
                  placeholder="e.g. 20"
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                  onFocus={e => e.target.select()}
                  required
                  data-testid="quick-work-amount-input"
                />
              </div>
              <div className="space-y-2">
                <Label>Payment Mode</Label>
                <PaymentModeSelector value={paymentMode} onChange={setPaymentMode} showHints />
              </div>
              <div className="sm:col-span-2 flex items-center gap-2">
                <Button type="submit" disabled={submitting} className="w-full sm:w-auto" data-testid="quick-work-submit-btn">
                  {submitting ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Saving…</> : 'Save Entry'}
                </Button>
                <Button type="button" variant="ghost" onClick={() => { resetForm(); setShowForm(false); }} className="shrink-0" data-testid="quick-work-cancel-btn">
                  Cancel
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input className="pl-9" placeholder="Search by customer or category…"
                value={search} onChange={e => setSearch(e.target.value)} data-testid="quick-work-search-input" />
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <CalendarRange className="h-4 w-4 text-muted-foreground shrink-0" />
              <Input type="date" className="w-36" value={startDate} onChange={e => setStartDate(e.target.value)} data-testid="quick-work-start-date-input" />
              <span className="text-muted-foreground text-sm">–</span>
              <Input type="date" className="w-36" value={endDate} onChange={e => setEndDate(e.target.value)} data-testid="quick-work-end-date-input" />
              {hasFilters && (
                <Button variant="ghost" size="icon" onClick={clearFilters} title="Clear filters" data-testid="quick-work-clear-filters-btn">
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          {loading ? (
            <div className="space-y-3">{[0,1,2].map(i => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground" data-testid="quick-work-empty-state">
              <Printer className="h-10 w-10 mx-auto mb-3 opacity-20" />
              <p>{hasFilters ? 'No entries match your search or filters.' : 'No quick entries yet. Add the first one above.'}</p>
            </div>
          ) : (
            <div className="overflow-x-auto" data-testid="quick-work-list">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="text-left py-2 pr-4 font-medium whitespace-nowrap">Date & Time</th>
                    <th className="text-left py-2 pr-4 font-medium">Category</th>
                    <th className="text-left py-2 pr-4 font-medium">Customer</th>
                    <th className="text-right py-2 pr-4 font-medium">Amount</th>
                    <th className="text-left py-2 pr-4 font-medium">Mode</th>
                    <th className="text-left py-2 pr-4 font-medium">Added By</th>
                    <th className="text-left py-2 font-medium">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filtered.map(entry => {
                    const st = resolveStatus(entry.paymentStatus);
                    return (
                      <tr key={entry.id} className="hover:bg-muted/30 transition-colors" data-testid={`quick-work-row-${entry.id}`}>
                        <td className="py-3 pr-4 text-muted-foreground whitespace-nowrap">
                          {format(entry.createdAt.toDate(), 'dd MMM yyyy HH:mm')}
                        </td>
                        <td className="py-3 pr-4"><CategoryBadge category={entry.category} /></td>
                        <td className="py-3 pr-4 font-medium">
                          {entry.customerName || <span className="text-muted-foreground italic">—</span>}
                        </td>
                        <td className="py-3 pr-4 text-right font-semibold tabular-nums">
                          {formatCurrency(entry.amount)}
                        </td>
                        <td className="py-3 pr-4">
                          <PaymentModeBadge mode={entry.paymentMode} status={entry.paymentStatus} settledVia={entry.settledVia} />
                        </td>
                        <td className="py-3 pr-4 text-muted-foreground text-xs italic">{entry.addedBy}</td>
                        <td className="py-3">
                          {st === 'pending' && (
                            <Button size="sm" variant="outline"
                              className="h-7 text-xs border-amber-300 text-amber-700 hover:bg-amber-50 whitespace-nowrap"
                              onClick={() => setSettleEntry(entry)}>
                              Mark Paid
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="text-xs text-muted-foreground mt-3">
                Showing {filtered.length} of {entries.length} {entries.length === 1 ? 'entry' : 'entries'}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <MarkAsPaidDialog
        open={!!settleEntry}
        onOpenChange={(o) => { if (!o) setSettleEntry(null); }}
        customerName={settleEntry?.customerName}
        amount={settleEntry?.amount ?? 0}
        onConfirm={handleSettle}
      />
    </div>
  );
}
