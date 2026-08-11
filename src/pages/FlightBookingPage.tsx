import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { subscribeToFlightBookings, createFlightBooking, FlightBooking } from '@/lib/firestore';
import { PaymentMode, PAYMENT_MODE_META } from '@/lib/payments';
import { formatCurrency } from '@/lib/format';
import { format, isToday, isThisMonth } from 'date-fns';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  PlaneTakeoff, IndianRupee, TrendingUp, Hash, CalendarRange, Search,
  ShieldCheck, PlusCircle, ChevronUp, Loader2, X, ArrowRight,
} from 'lucide-react';

function AccessDenied() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center gap-4">
      <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center">
        <ShieldCheck className="h-8 w-8 text-muted-foreground" />
      </div>
      <h2 className="text-xl font-semibold">Access Restricted</h2>
      <p className="text-muted-foreground max-w-xs">
        You don't have permission to access Flight Booking. Contact the Owner to enable access.
      </p>
    </div>
  );
}

export default function FlightBookingPage() {
  const { userProfile, canAccessFinancialServices } = useAuth();
  const { toast } = useToast();

  const [entries, setEntries] = useState<FlightBooking[]>([]);
  const [loading, setLoading] = useState(true);

  // Form state
  const [showForm, setShowForm] = useState(false);
  const [flightFrom, setFlightFrom] = useState('');
  const [flightTo, setFlightTo] = useState('');
  const [boardingDate, setBoardingDate] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [actualFare, setActualFare] = useState('');
  const [amountCharged, setAmountCharged] = useState('');
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('Cash');
  const [submitting, setSubmitting] = useState(false);

  // Filters
  const [search, setSearch] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  useEffect(() => {
    if (!canAccessFinancialServices) { setLoading(false); return; }
    const unsub = subscribeToFlightBookings((data) => {
      setEntries(data);
      setLoading(false);
    });
    return () => unsub();
  }, [canAccessFinancialServices]);

  if (!canAccessFinancialServices) return <AccessDenied />;

  // Auto-calculated profit (live)
  const fareNum = Number(actualFare) || 0;
  const chargedNum = Number(amountCharged) || 0;
  const liveProfit = chargedNum - fareNum;

  // Summary stats
  const todayEntries = entries.filter(e => isToday(e.createdAt.toDate()));
  const todayCount = todayEntries.length;
  const todayProfit = todayEntries.reduce((s, e) => s + e.profitMargin, 0);
  const monthProfit = entries
    .filter(e => isThisMonth(e.createdAt.toDate()))
    .reduce((s, e) => s + e.profitMargin, 0);

  // Filtered list
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return entries.filter(e => {
      const d = e.createdAt.toDate();
      if (q && !e.customerName.toLowerCase().includes(q) &&
          !e.flightFrom.toLowerCase().includes(q) &&
          !e.flightTo.toLowerCase().includes(q)) return false;
      if (startDate && d < new Date(startDate + 'T00:00:00')) return false;
      if (endDate && d > new Date(endDate + 'T23:59:59')) return false;
      return true;
    });
  }, [entries, search, startDate, endDate]);

  const resetForm = () => {
    setFlightFrom(''); setFlightTo(''); setBoardingDate('');
    setCustomerName(''); setActualFare(''); setAmountCharged('');
    setPaymentMode('Cash');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!flightFrom.trim() || !flightTo.trim()) {
      toast({ variant: 'destructive', title: 'Missing fields', description: 'Please enter both Flight From and Flight To.' });
      return;
    }
    if (!boardingDate) {
      toast({ variant: 'destructive', title: 'Missing date', description: 'Please select a boarding date.' });
      return;
    }
    const fare = Number(actualFare);
    const charged = Number(amountCharged);
    if (!fare || fare <= 0) {
      toast({ variant: 'destructive', title: 'Invalid fare', description: 'Actual Flight Fare must be greater than 0.' });
      return;
    }
    if (!charged || charged <= 0) {
      toast({ variant: 'destructive', title: 'Invalid amount', description: 'Amount Charged to Customer must be greater than 0.' });
      return;
    }
    if (charged < fare) {
      toast({ variant: 'destructive', title: 'Invalid amounts', description: 'Amount Charged to Customer cannot be less than the Actual Flight Fare.' });
      return;
    }
    setSubmitting(true);
    try {
      const profit = charged - fare;
      await createFlightBooking({
        flightFrom: flightFrom.trim(),
        flightTo: flightTo.trim(),
        boardingDate,
        customerName: customerName.trim(),
        actualFare: fare,
        amountCharged: charged,
        profitMargin: profit,
        paymentMode,
        addedBy: userProfile?.displayName || userProfile?.email || 'Unknown',
      });
      toast({
        title: 'Flight booking recorded',
        description: `${customerName} — ${flightFrom} → ${flightTo} · Profit: ${formatCurrency(profit)}`,
      });
      resetForm();
      setShowForm(false);
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error', description: err.message });
    } finally {
      setSubmitting(false);
    }
  };

  const clearFilters = () => { setSearch(''); setStartDate(''); setEndDate(''); };
  const hasFilters = search || startDate || endDate;

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <PlaneTakeoff className="h-6 w-6 text-primary" />
            Flight Ticket Booking
          </h1>
          <p className="text-muted-foreground text-sm mt-1">Record flight ticket bookings and track profit</p>
        </div>
        <Button onClick={() => setShowForm(v => !v)} className="shrink-0">
          {showForm
            ? <><ChevronUp className="h-4 w-4 mr-2" />Hide Form</>
            : <><PlusCircle className="h-4 w-4 mr-2" />Add New</>}
        </Button>
      </div>

      {/* Summary Cards */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[0, 1, 2].map(i => (
            <Card key={i}><CardContent className="pt-6"><Skeleton className="h-8 w-32 mb-2" /><Skeleton className="h-4 w-24" /></CardContent></Card>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardTitle className="text-xs font-medium text-muted-foreground">Today's Bookings</CardTitle>
              <Hash className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{todayCount}</div>
              <p className="text-xs text-muted-foreground mt-1">Tickets booked today</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardTitle className="text-xs font-medium text-muted-foreground">Today's Total Profit</CardTitle>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-emerald-700">{formatCurrency(todayProfit)}</div>
              <p className="text-xs text-muted-foreground mt-1">Profit earned today</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardTitle className="text-xs font-medium text-muted-foreground">This Month's Profit</CardTitle>
              <IndianRupee className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-emerald-700">{formatCurrency(monthProfit)}</div>
              <p className="text-xs text-muted-foreground mt-1">Profit this month</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Add New Form */}
      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Add New Flight Booking</CardTitle>
            <CardDescription>Fields marked * are required. Profit is auto-calculated.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="flightFrom">Flight From *</Label>
                <Input
                  id="flightFrom"
                  placeholder="e.g. Mumbai (BOM)"
                  value={flightFrom}
                  onChange={e => setFlightFrom(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="flightTo">Flight To *</Label>
                <Input
                  id="flightTo"
                  placeholder="e.g. Delhi (DEL)"
                  value={flightTo}
                  onChange={e => setFlightTo(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="boardingDate">Flight Boarding Date *</Label>
                <Input
                  id="boardingDate"
                  type="date"
                  value={boardingDate}
                  onChange={e => setBoardingDate(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="customerName">Customer Name *</Label>
                <Input
                  id="customerName"
                  placeholder="e.g. Ramesh Kumar"
                  value={customerName}
                  onChange={e => setCustomerName(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="actualFare">Actual Flight Fare (₹) *</Label>
                <Input
                  id="actualFare"
                  type="number"
                  min="1"
                  step="1"
                  placeholder="e.g. 10000"
                  value={actualFare}
                  onChange={e => setActualFare(e.target.value)}
                  onFocus={e => e.target.select()}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="amountCharged">Amount Charged to Customer (₹) *</Label>
                <Input
                  id="amountCharged"
                  type="number"
                  min="1"
                  step="1"
                  placeholder="e.g. 11000"
                  value={amountCharged}
                  onChange={e => setAmountCharged(e.target.value)}
                  onFocus={e => e.target.select()}
                  required
                />
              </div>
              {/* Payment Mode */}
              <div className="sm:col-span-2 space-y-2">
                <Label>Payment Mode *</Label>
                <div className="flex gap-2 flex-wrap">
                  {(['Cash', 'Online', 'Due'] as PaymentMode[]).map(mode => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setPaymentMode(mode)}
                      className={`px-4 py-2 rounded-lg text-sm font-medium border transition-all ${
                        paymentMode === mode
                          ? PAYMENT_MODE_META[mode].activeBg + ' border-transparent'
                          : 'bg-card border-border hover:border-muted-foreground'
                      }`}
                    >
                      {PAYMENT_MODE_META[mode].label}
                    </button>
                  ))}
                </div>
                {paymentMode === 'Due' && (
                  <p className="text-xs text-amber-600">⚠ This entry will appear in Due Payments until collected.</p>
                )}
              </div>

              {/* Live profit preview */}
              <div className="sm:col-span-2">
                <div className="flex items-center gap-3 rounded-lg border bg-emerald-50 border-emerald-200 px-4 py-3">
                  <TrendingUp className="h-4 w-4 text-emerald-600 shrink-0" />
                  <div className="flex-1">
                    <span className="text-xs font-medium text-emerald-700 uppercase tracking-wide">Profit (auto-calculated)</span>
                    <div className="flex items-baseline gap-2 mt-0.5">
                      <span className="text-xl font-bold text-emerald-700">
                        {formatCurrency(liveProfit)}
                      </span>
                      {(fareNum > 0 || chargedNum > 0) && (
                        <span className="text-xs text-emerald-600">
                          = {formatCurrency(chargedNum)} − {formatCurrency(fareNum)}
                        </span>
                      )}
                    </div>
                  </div>
                  <span className="text-xs text-emerald-600 italic">Read-only</span>
                </div>
              </div>
              <div className="sm:col-span-2 flex items-center gap-2">
                <Button type="submit" disabled={submitting} className="w-full sm:w-auto">
                  {submitting
                    ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Saving…</>
                    : 'Save Booking'}
                </Button>
                <Button type="button" variant="ghost" onClick={() => { resetForm(); setShowForm(false); }} className="shrink-0">
                  Cancel
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Search & Filter + List */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Search by customer name or flight route…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
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
            <div className="space-y-3">
              {[0, 1, 2].map(i => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <PlaneTakeoff className="h-10 w-10 mx-auto mb-3 opacity-20" />
              <p>{hasFilters ? 'No entries match your search or filters.' : 'No flight bookings yet. Add the first one above.'}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="text-left py-2 pr-4 font-medium whitespace-nowrap">Date & Time</th>
                    <th className="text-left py-2 pr-4 font-medium">Flight</th>
                    <th className="text-left py-2 pr-4 font-medium whitespace-nowrap">Boarding Date</th>
                    <th className="text-left py-2 pr-4 font-medium">Customer</th>
                    <th className="text-right py-2 pr-4 font-medium whitespace-nowrap">Actual Fare</th>
                    <th className="text-right py-2 pr-4 font-medium whitespace-nowrap">Charged</th>
                    <th className="text-right py-2 pr-4 font-medium">Profit</th>
                    <th className="text-left py-2 font-medium">Added By</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filtered.map(entry => (
                    <tr key={entry.id} className="hover:bg-muted/30 transition-colors">
                      <td className="py-3 pr-4 text-muted-foreground whitespace-nowrap">
                        {format(entry.createdAt.toDate(), 'dd MMM yyyy HH:mm')}
                      </td>
                      <td className="py-3 pr-4 font-medium whitespace-nowrap">
                        <span className="flex items-center gap-1">
                          <span>{entry.flightFrom}</span>
                          <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
                          <span>{entry.flightTo}</span>
                        </span>
                      </td>
                      <td className="py-3 pr-4 text-muted-foreground whitespace-nowrap">
                        {entry.boardingDate
                          ? format(new Date(entry.boardingDate + 'T00:00:00'), 'dd MMM yyyy')
                          : '—'}
                      </td>
                      <td className="py-3 pr-4 font-medium">{entry.customerName}</td>
                      <td className="py-3 pr-4 text-right tabular-nums">{formatCurrency(entry.actualFare)}</td>
                      <td className="py-3 pr-4 text-right tabular-nums font-semibold">{formatCurrency(entry.amountCharged)}</td>
                      <td className="py-3 pr-4 text-right font-semibold text-emerald-700 tabular-nums">
                        {formatCurrency(entry.profitMargin)}
                      </td>
                      <td className="py-3 text-muted-foreground text-xs italic">{entry.addedBy}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-xs text-muted-foreground mt-3">
                Showing {filtered.length} of {entries.length} {entries.length === 1 ? 'booking' : 'bookings'}
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
