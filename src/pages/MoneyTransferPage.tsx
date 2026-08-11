import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import {
  subscribeToMoneyTransfers, createMoneyTransfer, MoneyTransfer, settlePendingEntry,
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
  ArrowLeftRight, IndianRupee, TrendingUp, CalendarRange, Search,
  ShieldCheck, PlusCircle, ChevronUp, Loader2, X,
} from 'lucide-react';
import { PaymentModeSelector } from '@/components/PaymentModeSelector';
import { PaymentModeBadge } from '@/components/PaymentModeBadge';
import { MarkAsPaidDialog } from '@/components/MarkAsPaidDialog';
import { PaymentMode, resolveStatus } from '@/lib/payments';
import type { SettlementMode } from '@/lib/payments';

function AccessDenied() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center gap-4">
      <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center">
        <ShieldCheck className="h-8 w-8 text-muted-foreground" />
      </div>
      <h2 className="text-xl font-semibold">Access Restricted</h2>
      <p className="text-muted-foreground max-w-xs">
        You don't have permission to access Money Transfer. Contact the Owner to enable access.
      </p>
    </div>
  );
}

export default function MoneyTransferPage() {
  const { userProfile, canAccessFinancialServices } = useAuth();
  const { toast } = useToast();

  const [entries, setEntries] = useState<MoneyTransfer[]>([]);
  const [loading, setLoading] = useState(true);

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [mobileOrAccount, setMobileOrAccount] = useState('');
  const [amount, setAmount] = useState('');
  const [profitMargin, setProfitMargin] = useState('');
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('Cash');
  const [submitting, setSubmitting] = useState(false);

  const [settleEntry, setSettleEntry] = useState<MoneyTransfer | null>(null);

  const [search, setSearch] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  useEffect(() => {
    if (!canAccessFinancialServices) { setLoading(false); return; }
    const unsub = subscribeToMoneyTransfers((data) => {
      setEntries(data);
      setLoading(false);
    });
    return () => unsub();
  }, [canAccessFinancialServices]);

  if (!canAccessFinancialServices) return <AccessDenied />;

  const todayPaid = entries.filter(e => isToday(e.createdAt.toDate()) && resolveStatus(e.paymentStatus) === 'paid');
  const todayAmountTotal = todayPaid.reduce((s, e) => s + e.amount, 0);
  const todayProfitTotal = todayPaid.reduce((s, e) => s + e.profitMargin, 0);
  const monthProfitTotal = entries
    .filter(e => isThisMonth(e.createdAt.toDate()) && resolveStatus(e.paymentStatus) === 'paid')
    .reduce((s, e) => s + e.profitMargin, 0);
  const pendingCount = entries.filter(e => resolveStatus(e.paymentStatus) === 'pending').length;

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return entries.filter(e => {
      const d = e.createdAt.toDate();
      if (q &&
        !e.name.toLowerCase().includes(q) &&
        !e.mobileOrAccount.toLowerCase().includes(q)) return false;
      if (startDate && d < new Date(startDate + 'T00:00:00')) return false;
      if (endDate && d > new Date(endDate + 'T23:59:59')) return false;
      return true;
    });
  }, [entries, search, startDate, endDate]);

  const resetForm = () => { setName(''); setMobileOrAccount(''); setAmount(''); setProfitMargin(''); setPaymentMode('Cash'); };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await createMoneyTransfer({
        name: name.trim(),
        mobileOrAccount: mobileOrAccount.trim(),
        amount: Number(amount),
        profitMargin: Number(profitMargin),
        paymentMode,
        addedBy: userProfile?.displayName || userProfile?.email || 'Unknown',
      });
      toast({ title: 'Transfer recorded', description: `${name} — ${formatCurrency(Number(amount))}` });
      resetForm();
      setShowForm(false);
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error', description: err.message });
    } finally {
      setSubmitting(false);
    }
  };

  const handleSettle = async (mode: SettlementMode) => {
    if (!settleEntry?.id) return;
    const by = userProfile?.displayName || userProfile?.email || 'Unknown';
    await settlePendingEntry('transfer', settleEntry.id, mode, by, {
      amount: settleEntry.amount,
      customerName: settleEntry.name,
    });
    toast({ title: 'Payment recorded', description: `${settleEntry.name} — ${formatCurrency(settleEntry.amount)} via ${mode}` });
  };

  const clearFilters = () => { setSearch(''); setStartDate(''); setEndDate(''); };
  const hasFilters = search || startDate || endDate;

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <ArrowLeftRight className="h-6 w-6 text-primary" />
            Money Transfer
          </h1>
          <p className="text-muted-foreground text-sm mt-1">Record customer money transfers and profit earned</p>
        </div>
        <Button onClick={() => setShowForm(v => !v)} className="shrink-0">
          {showForm ? <><ChevronUp className="h-4 w-4 mr-2" />Hide Form</> : <><PlusCircle className="h-4 w-4 mr-2" />Add New</>}
        </Button>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          {[0,1,2,3].map(i => <Card key={i}><CardContent className="pt-6"><Skeleton className="h-8 w-32 mb-2" /><Skeleton className="h-4 w-24" /></CardContent></Card>)}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardTitle className="text-xs font-medium text-muted-foreground">Today's Transfer</CardTitle>
              <IndianRupee className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{formatCurrency(todayAmountTotal)}</div>
              <p className="text-xs text-muted-foreground mt-1">Paid entries today</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardTitle className="text-xs font-medium text-muted-foreground">Today's Profit</CardTitle>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{formatCurrency(todayProfitTotal)}</div>
              <p className="text-xs text-muted-foreground mt-1">Profit today</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardTitle className="text-xs font-medium text-muted-foreground">Month's Profit</CardTitle>
              <IndianRupee className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{formatCurrency(monthProfitTotal)}</div>
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
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Add New Transfer</CardTitle>
            <CardDescription>All fields are required.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="name">Name *</Label>
                <Input id="name" placeholder="Customer name"
                  value={name} onChange={e => setName(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="mobileOrAccount">Mobile / Account Number *</Label>
                <Input id="mobileOrAccount" placeholder="Mobile or account number"
                  value={mobileOrAccount} onChange={e => setMobileOrAccount(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="amount">Amount (₹) *</Label>
                <Input id="amount" type="number" min="1" step="1" placeholder="Amount transferred"
                  value={amount} onChange={e => setAmount(e.target.value)}
                  onFocus={e => e.target.select()} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="profitMargin">Profit Margin (₹) *</Label>
                <Input id="profitMargin" type="number" min="0" step="1" placeholder="Commission/profit earned"
                  value={profitMargin} onChange={e => setProfitMargin(e.target.value)}
                  onFocus={e => e.target.select()} required />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label>Payment Mode</Label>
                <PaymentModeSelector value={paymentMode} onChange={setPaymentMode} showHints />
              </div>
              <div className="sm:col-span-2 flex gap-2 pt-2">
                <Button type="submit" disabled={submitting}>
                  {submitting ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Saving…</> : 'Save Transfer'}
                </Button>
                <Button type="button" variant="ghost" onClick={() => { resetForm(); setShowForm(false); }}>
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
              <Input className="pl-9" placeholder="Search by name or mobile/account number…"
                value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <CalendarRange className="h-4 w-4 text-muted-foreground shrink-0" />
              <Input type="date" className="w-36" value={startDate} onChange={e => setStartDate(e.target.value)} />
              <span className="text-muted-foreground text-sm">–</span>
              <Input type="date" className="w-36" value={endDate} onChange={e => setEndDate(e.target.value)} />
              {hasFilters && (
                <Button variant="ghost" size="icon" onClick={clearFilters} title="Clear filters">
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
            <div className="text-center py-12 text-muted-foreground">
              <ArrowLeftRight className="h-10 w-10 mx-auto mb-3 opacity-20" />
              <p>{hasFilters ? 'No entries match your search or filters.' : 'No transfer entries yet. Add the first one above.'}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="text-left py-2 pr-4 font-medium whitespace-nowrap">Date & Time</th>
                    <th className="text-left py-2 pr-4 font-medium">Name</th>
                    <th className="text-left py-2 pr-4 font-medium">Mobile / Account</th>
                    <th className="text-right py-2 pr-4 font-medium">Amount</th>
                    <th className="text-right py-2 pr-4 font-medium">Profit</th>
                    <th className="text-left py-2 pr-4 font-medium">Mode</th>
                    <th className="text-left py-2 pr-4 font-medium">Added By</th>
                    <th className="text-left py-2 font-medium">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filtered.map(entry => {
                    const st = resolveStatus(entry.paymentStatus);
                    return (
                      <tr key={entry.id} className="hover:bg-muted/30 transition-colors">
                        <td className="py-3 pr-4 text-muted-foreground whitespace-nowrap">
                          {format(entry.createdAt.toDate(), 'dd MMM yyyy HH:mm')}
                        </td>
                        <td className="py-3 pr-4 font-medium">{entry.name}</td>
                        <td className="py-3 pr-4 text-muted-foreground font-mono text-xs">{entry.mobileOrAccount}</td>
                        <td className="py-3 pr-4 text-right font-semibold tabular-nums">{formatCurrency(entry.amount)}</td>
                        <td className="py-3 pr-4 text-right font-medium text-green-700 tabular-nums">{formatCurrency(entry.profitMargin)}</td>
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
        customerName={settleEntry?.name}
        amount={settleEntry?.amount ?? 0}
        onConfirm={handleSettle}
      />
    </div>
  );
}
