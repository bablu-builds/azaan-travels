import { useState, useEffect, useMemo } from 'react';
import { useSearch } from 'wouter';
import { useAuth } from '@/contexts/AuthContext';
import {
  WorkEntry, subscribeToWorkEntries, addPaymentToEntry,
  AepsWithdrawal, subscribeToAepsWithdrawals,
  ElectricRecharge, subscribeToElectricRecharges,
  MoneyTransfer, subscribeToMoneyTransfers,
  QuickActionEntry, subscribeToQuickActions,
  FlightBooking, subscribeToFlightBookings,
  settlePendingEntry, UserProfile, subscribeToStaff,
} from '@/lib/firestore';
import { SettlementMode, resolveStatus } from '@/lib/payments';
import { formatCurrency } from '@/lib/format';
import {
  startOfDay, endOfDay, startOfWeek, endOfWeek,
  startOfMonth, endOfMonth, isWithinInterval, format, differenceInDays,
} from 'date-fns';
import { MarkAsPaidDialog } from '@/components/MarkAsPaidDialog';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Search, CalendarIcon, IndianRupee, CheckCircle2, Users,
} from 'lucide-react';
import type { DateRange } from 'react-day-picker';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type DueSource = 'Work' | 'AEPS' | 'Recharge' | 'Transfer' | 'Quick' | 'Flight';
type PresetKey = 'all' | 'today' | 'thisWeek' | 'thisMonth' | 'custom';

interface DateState { preset: PresetKey; from?: Date; to?: Date; }

interface DueItem {
  id: string;
  source: DueSource;
  customerName: string;
  mobile?: string;
  workType: string;
  dueAmount: number;
  entryDate: Date;
  addedBy: string;
  settle: (mode: SettlementMode, settledBy: string) => Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const SOURCE_STYLE: Record<DueSource, string> = {
  Work:     'bg-indigo-100 text-indigo-700 border-indigo-200',
  AEPS:     'bg-emerald-100 text-emerald-700 border-emerald-200',
  Recharge: 'bg-amber-100 text-amber-700 border-amber-200',
  Transfer: 'bg-purple-100 text-purple-700 border-purple-200',
  Quick:    'bg-cyan-100 text-cyan-700 border-cyan-200',
  Flight:   'bg-rose-100 text-rose-700 border-rose-200',
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function buildPresetRange(key: 'today' | 'thisWeek' | 'thisMonth'): { from: Date; to: Date } {
  const now = new Date();
  switch (key) {
    case 'today':     return { from: startOfDay(now), to: endOfDay(now) };
    case 'thisWeek':  return { from: startOfWeek(now, { weekStartsOn: 1 }), to: endOfWeek(now, { weekStartsOn: 1 }) };
    case 'thisMonth': return { from: startOfMonth(now), to: endOfMonth(now) };
  }
}

function inRange(d: Date, from?: Date, to?: Date): boolean {
  if (!from || !to) return true;
  return isWithinInterval(d, { start: from, end: to });
}

function pendingLabel(date: Date): string {
  const d = differenceInDays(new Date(), date);
  if (d === 0) return 'today';
  if (d === 1) return '1d pending';
  return `${d}d pending`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

export default function DuePaymentsPage() {
  const { user, isOwner } = useAuth();
  const { toast } = useToast();
  const searchStr = useSearch();

  // ── Raw data ────────────────────────────────────────────────────────────────
  const [loading,          setLoading]          = useState(true);
  const [workEntries,      setWorkEntries]      = useState<WorkEntry[]>([]);
  const [aepsEntries,      setAepsEntries]      = useState<AepsWithdrawal[]>([]);
  const [rechargeEntries,  setRechargeEntries]  = useState<ElectricRecharge[]>([]);
  const [transferEntries,  setTransferEntries]  = useState<MoneyTransfer[]>([]);
  const [quickEntries,     setQuickEntries]     = useState<QuickActionEntry[]>([]);
  const [flightEntries,    setFlightEntries]    = useState<FlightBooking[]>([]);
  const [staffList,        setStaffList]        = useState<UserProfile[]>([]);

  // ── UI state — initialise date preset from URL ?preset= param ────────────────
  const [dateState,    setDateState]    = useState<DateState>(() => {
    const p = new URLSearchParams(searchStr).get('preset') as PresetKey | null;
    if (p === 'today' || p === 'thisWeek' || p === 'thisMonth') {
      return { preset: p, ...buildPresetRange(p) };
    }
    if (p === 'all') return { preset: 'all' };
    return { preset: 'thisMonth', ...buildPresetRange('thisMonth') };
  });
  const [calOpen,      setCalOpen]      = useState(false);
  const [calPending,   setCalPending]   = useState<DateRange | undefined>();
  const [staffFilter,  setStaffFilter]  = useState<string>('all');
  const [search,       setSearch]       = useState('');
  const [dialogEntry,  setDialogEntry]  = useState<DueItem | null>(null);

  // ── Subscriptions ────────────────────────────────────────────────────────────
  useEffect(() => {
    let resolved = 0;
    const done = () => { if (++resolved === 6) setLoading(false); };
    const u1 = subscribeToWorkEntries(d => { setWorkEntries(d); done(); });
    const u2 = subscribeToAepsWithdrawals(d => { setAepsEntries(d); done(); });
    const u3 = subscribeToElectricRecharges(d => { setRechargeEntries(d); done(); });
    const u4 = subscribeToMoneyTransfers(d => { setTransferEntries(d); done(); });
    const u5 = subscribeToQuickActions(d => { setQuickEntries(d); done(); }, () => done());
    const u6 = subscribeToFlightBookings(d => { setFlightEntries(d); done(); });
    const u7 = subscribeToStaff(setStaffList);
    return () => { u1(); u2(); u3(); u4(); u5(); u6(); u7(); };
  }, []);

  // ── Build unified due list ───────────────────────────────────────────────────
  const allDues = useMemo<DueItem[]>(() => {
    const items: DueItem[] = [];

    // Work entries: any entry with outstanding dueAmount > 0 (matches Dashboard logic)
    workEntries.forEach(e => {
      if ((e.dueAmount ?? 0) <= 0 || e.status === 'Rejected') return;
      items.push({
        id: e.id!,
        source: 'Work',
        customerName: e.customerName,
        mobile: e.mobile,
        workType: e.category === 'Other' && e.otherCategory ? e.otherCategory : e.category,
        dueAmount: e.dueAmount,
        entryDate: e.date.toDate(),
        addedBy: e.addedBy || '',
        settle: async (mode, settledBy) => {
          await addPaymentToEntry(
            e.id!,
            { amount: e.dueAmount, addedBy: settledBy, paymentMode: mode },
            e.totalAmount,
            e.paidAmount,
          );
        },
      });
    });

    // AEPS
    aepsEntries.forEach(e => {
      if (resolveStatus(e.paymentStatus) !== 'pending') return;
      items.push({
        id: e.id!,
        source: 'AEPS',
        customerName: e.customerName,
        workType: `AEPS – ${e.bankName}`,
        dueAmount: e.amount,
        entryDate: e.createdAt.toDate(),
        addedBy: e.addedBy || '',
        settle: async (mode, settledBy) =>
          settlePendingEntry('aeps', e.id!, mode, settledBy, { amount: e.amount, customerName: e.customerName, category: 'AEPS Withdrawal' }),
      });
    });

    // Recharge
    rechargeEntries.forEach(e => {
      if (resolveStatus(e.paymentStatus) !== 'pending') return;
      items.push({
        id: e.id!,
        source: 'Recharge',
        customerName: e.customerName,
        workType: `Recharge – ${e.consumerNumber}`,
        dueAmount: e.rechargeAmount,
        entryDate: e.createdAt.toDate(),
        addedBy: e.addedBy || '',
        settle: async (mode, settledBy) =>
          settlePendingEntry('recharge', e.id!, mode, settledBy, { amount: e.rechargeAmount, customerName: e.customerName, category: 'Electric Recharge' }),
      });
    });

    // Money Transfer
    transferEntries.forEach(e => {
      if (resolveStatus(e.paymentStatus) !== 'pending') return;
      items.push({
        id: e.id!,
        source: 'Transfer',
        customerName: e.name,
        mobile: e.mobileOrAccount,
        workType: 'Money Transfer',
        dueAmount: e.amount,
        entryDate: e.createdAt.toDate(),
        addedBy: e.addedBy || '',
        settle: async (mode, settledBy) =>
          settlePendingEntry('transfer', e.id!, mode, settledBy, { amount: e.amount, customerName: e.name, category: 'Money Transfer' }),
      });
    });

    // Quick Work
    quickEntries.forEach(e => {
      if (resolveStatus(e.paymentStatus) !== 'pending') return;
      items.push({
        id: e.id!,
        source: 'Quick',
        customerName: e.customerName || 'Customer',
        workType: e.category,
        dueAmount: e.amount,
        entryDate: e.createdAt.toDate(),
        addedBy: e.addedBy || '',
        settle: async (mode, settledBy) =>
          settlePendingEntry('quickWork', e.id!, mode, settledBy, { amount: e.amount, customerName: e.customerName, category: e.category }),
      });
    });

    // Flight Booking
    flightEntries.forEach(e => {
      if (resolveStatus(e.paymentStatus) !== 'pending') return;
      items.push({
        id: e.id!,
        source: 'Flight',
        customerName: e.customerName,
        workType: `Flight – ${e.flightFrom} → ${e.flightTo}`,
        dueAmount: e.amountCharged,
        entryDate: e.createdAt.toDate(),
        addedBy: e.addedBy || '',
        settle: async (mode, settledBy) =>
          settlePendingEntry('flight', e.id!, mode, settledBy, { amount: e.amountCharged, customerName: e.customerName, category: 'Flight Booking' }),
      });
    });

    // Access control: non-owners see only their own
    if (!isOwner) {
      const me = [user?.displayName, user?.email].filter(Boolean) as string[];
      return items.filter(i => me.includes(i.addedBy));
    }
    return items;
  }, [workEntries, aepsEntries, rechargeEntries, transferEntries, quickEntries, flightEntries, user, isOwner]);

  // ── Apply filters ────────────────────────────────────────────────────────────
  const filteredDues = useMemo(() => {
    let list = allDues;
    if (dateState.preset !== 'all' && dateState.from && dateState.to) {
      list = list.filter(i => inRange(i.entryDate, dateState.from, dateState.to));
    }
    if (staffFilter !== 'all') {
      list = list.filter(i => i.addedBy === staffFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(i =>
        i.customerName.toLowerCase().includes(q) ||
        (i.mobile ?? '').includes(q),
      );
    }
    return list.sort((a, b) => b.entryDate.getTime() - a.entryDate.getTime());
  }, [allDues, dateState, staffFilter, search]);

  const totalDue = filteredDues.reduce((s, i) => s + i.dueAmount, 0);

  // ── Staff breakdown (owner only) ─────────────────────────────────────────────
  const staffBreakdown = useMemo(() => {
    if (!isOwner) return [];
    const map: Record<string, { count: number; total: number }> = {};
    filteredDues.forEach(i => {
      const k = i.addedBy || 'Unknown';
      if (!map[k]) map[k] = { count: 0, total: 0 };
      map[k].count++; map[k].total += i.dueAmount;
    });
    return Object.entries(map).sort((a, b) => b[1].total - a[1].total);
  }, [filteredDues, isOwner]);

  // Staff dropdown: built from the actual users collection, not from due entries.
  // This ensures every account (including those with zero dues) is shown.
  const staffOptions = useMemo(() => {
    const names = new Set<string>();
    if (user?.displayName) names.add(user.displayName);
    staffList.forEach(s => { if (s.displayName) names.add(s.displayName); });
    return [...names].sort();
  }, [staffList, user]);

  // ── Date helpers ─────────────────────────────────────────────────────────────
  const applyPreset = (key: 'all' | 'today' | 'thisWeek' | 'thisMonth') => {
    if (key === 'all') { setDateState({ preset: 'all' }); return; }
    setDateState({ preset: key, ...buildPresetRange(key) });
  };

  const applyCustom = () => {
    if (!calPending?.from || !calPending?.to) return;
    setDateState({ preset: 'custom', from: startOfDay(calPending.from), to: endOfDay(calPending.to) });
    setCalOpen(false);
  };

  const customLabel = dateState.preset === 'custom' && dateState.from && dateState.to
    ? `${format(dateState.from, 'dd MMM')} – ${format(dateState.to, 'dd MMM yyyy')}`
    : 'Custom';

  // ── Settlement ───────────────────────────────────────────────────────────────
  const handleSettle = async (mode: SettlementMode) => {
    if (!dialogEntry) return;
    const settledBy = user?.displayName || user?.email || 'Unknown';
    await dialogEntry.settle(mode, settledBy);
    toast({ title: 'Payment settled', description: `${formatCurrency(dialogEntry.dueAmount)} marked as paid via ${mode}.` });
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="space-y-4 max-w-4xl">
        <Skeleton className="h-8 w-48" />
        <div className="flex gap-2">{[0,1,2,3,4].map(i => <Skeleton key={i} className="h-8 w-24 rounded-lg" />)}</div>
        <Skeleton className="h-20 rounded-xl" />
        {[0,1,2,3].map(i => <Skeleton key={i} className="h-20 rounded-xl" />)}
      </div>
    );
  }

  return (
    <div className="space-y-5 max-w-4xl">

      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Due Payments</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Outstanding dues across all services</p>
        </div>
        <div className={`inline-flex items-center gap-2.5 px-4 py-2.5 rounded-xl border ${totalDue > 0 ? 'bg-red-50 border-red-200' : 'bg-emerald-50 border-emerald-200'}`}>
          <IndianRupee className={`h-4 w-4 shrink-0 ${totalDue > 0 ? 'text-red-600' : 'text-emerald-600'}`} />
          <div>
            <p className={`text-xl font-bold leading-tight ${totalDue > 0 ? 'text-red-700' : 'text-emerald-700'}`}>{formatCurrency(totalDue)}</p>
            <p className="text-xs text-muted-foreground">{filteredDues.length} {filteredDues.length === 1 ? 'entry' : 'entries'}</p>
          </div>
        </div>
      </div>

      {/* ── Date presets ── */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {(['all', 'today', 'thisWeek', 'thisMonth'] as const).map(key => (
          <Button key={key} size="sm" variant={dateState.preset === key ? 'default' : 'outline'}
            className="h-8 text-xs rounded-lg"
            onClick={() => applyPreset(key)}>
            {key === 'all' ? 'All Time' : key === 'today' ? 'Today' : key === 'thisWeek' ? 'This Week' : 'This Month'}
          </Button>
        ))}
        <Popover open={calOpen} onOpenChange={setCalOpen}>
          <PopoverTrigger asChild>
            <Button size="sm" variant={dateState.preset === 'custom' ? 'default' : 'outline'}
              className="h-8 text-xs rounded-lg gap-1.5">
              <CalendarIcon className="h-3.5 w-3.5" />{customLabel}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-4" align="end">
            <Calendar mode="range" selected={calPending} onSelect={setCalPending}
              numberOfMonths={2} disabled={(d: Date) => d > new Date()} />
            <div className="flex justify-end mt-3">
              <Button size="sm" onClick={applyCustom} disabled={!calPending?.from || !calPending?.to}>Apply</Button>
            </div>
          </PopoverContent>
        </Popover>
      </div>

      {/* ── Search + Staff filter ── */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search customer, mobile…" value={search} onChange={e => setSearch(e.target.value)} className="pl-8 h-9" />
        </div>
        {isOwner && (
          <Select value={staffFilter} onValueChange={setStaffFilter}>
            <SelectTrigger className="h-9 w-44 shrink-0">
              <SelectValue placeholder="All Staff" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Staff</SelectItem>
              {staffOptions.map(name => <SelectItem key={name} value={name}>{name}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* ── Staff breakdown (owner only, ≥2 contributors) ── */}
      {isOwner && staffBreakdown.length > 1 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
          {staffBreakdown.map(([name, { count, total }]) => (
            <button
              key={name}
              type="button"
              onClick={() => setStaffFilter(staffFilter === name ? 'all' : name)}
              className={`text-left px-3 py-2.5 rounded-xl border text-sm transition-colors ${
                staffFilter === name ? 'border-primary bg-primary/5 ring-1 ring-primary/20' : 'border-border bg-card hover:bg-muted/30'
              }`}
            >
              <div className="flex items-center gap-1.5 mb-1">
                <Users className="h-3 w-3 text-muted-foreground shrink-0" />
                <span className="text-xs font-medium truncate">{name || 'Unknown'}</span>
              </div>
              <p className="font-bold text-red-700 text-base">{formatCurrency(total)}</p>
              <p className="text-xs text-muted-foreground">{count} {count === 1 ? 'due' : 'dues'}</p>
            </button>
          ))}
        </div>
      )}

      {/* ── Due entries list ── */}
      {filteredDues.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <CheckCircle2 className="h-14 w-14 text-emerald-400 mb-3 opacity-70" />
          <p className="font-semibold text-lg">All clear!</p>
          <p className="text-sm text-muted-foreground mt-1">
            No outstanding dues{dateState.preset !== 'all' ? ' in this period' : ''}.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredDues.map(item => {
            const daysOld = differenceInDays(new Date(), item.entryDate);
            const isOld = daysOld > 7;
            return (
              <Card key={`${item.source}-${item.id}`} className={`hover:shadow-sm transition-shadow ${isOld ? 'border-red-200' : ''}`}>
                <CardContent className="p-4">
                  <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border shrink-0 ${SOURCE_STYLE[item.source]}`}>
                          {item.source}
                        </span>
                        <span className="font-semibold text-sm truncate">{item.customerName}</span>
                        {item.mobile && (
                          <span className="text-xs text-muted-foreground font-mono">{item.mobile}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
                        <span className="truncate max-w-[180px]">{item.workType}</span>
                        <span>·</span>
                        <span className={isOld ? 'text-red-500 font-medium' : ''}>
                          {pendingLabel(item.entryDate)}
                        </span>
                        <span>·</span>
                        <span>{format(item.entryDate, 'dd MMM yyyy')}</span>
                        {isOwner && item.addedBy && (
                          <><span>·</span><span>by {item.addedBy}</span></>
                        )}
                      </div>
                    </div>
                    {/* Amount + action */}
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-lg font-bold text-red-700">{formatCurrency(item.dueAmount)}</span>
                      <Button
                        size="sm"
                        className="bg-emerald-600 hover:bg-emerald-700 text-white h-8 text-xs px-3"
                        onClick={() => setDialogEntry(item)}
                      >
                        Mark as Paid
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* ── Settlement dialog ── */}
      <MarkAsPaidDialog
        open={!!dialogEntry}
        onOpenChange={o => { if (!o) setDialogEntry(null); }}
        customerName={dialogEntry?.customerName}
        amount={dialogEntry?.dueAmount ?? 0}
        onConfirm={handleSettle}
      />
    </div>
  );
}
