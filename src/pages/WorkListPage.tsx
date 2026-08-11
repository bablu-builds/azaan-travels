import { useState, useEffect, useMemo } from 'react';
import { subscribeToWorkEntries, deleteWorkEntry, WorkEntry, subscribeToStaff, UserProfile } from '@/lib/firestore';
import { useAuth } from '@/contexts/AuthContext';
import { useSettings } from '@/contexts/SettingsContext';
import {
  format, formatDistanceStrict,
  startOfDay, endOfDay,
  startOfWeek, endOfWeek,
  startOfMonth, endOfMonth,
  isWithinInterval,
} from 'date-fns';
import { Link } from 'wouter';
import {
  Search, MoreHorizontal, Edit, Trash2, History, Clock, CheckCircle2, XCircle,
  ArrowUpDown, ArrowUp, ArrowDown, PlusCircle, CalendarRange, UserCircle2, X,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { formatCurrency } from '@/lib/format';

type SortField = 'date' | 'totalAmount' | 'dueAmount' | 'status' | 'customerName';
type SortDir = 'asc' | 'desc';
type DateFilter = 'all' | 'today' | 'week' | 'month' | 'custom';

function StatusBadge({ status }: { status: WorkEntry['status'] }) {
  if (status === 'Completed') return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700 border border-emerald-200">
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />Completed
    </span>
  );
  if (status === 'Rejected') return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700 border border-red-200">
      <span className="h-1.5 w-1.5 rounded-full bg-red-500" />Rejected
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-700 border border-amber-200">
      <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />Pending
    </span>
  );
}

function SortIcon({ field, current, dir }: { field: SortField; current: SortField; dir: SortDir }) {
  if (field !== current) return <ArrowUpDown className="h-3.5 w-3.5 ml-1 opacity-30" />;
  return dir === 'asc'
    ? <ArrowUp className="h-3.5 w-3.5 ml-1 text-primary" />
    : <ArrowDown className="h-3.5 w-3.5 ml-1 text-primary" />;
}

function TableSkeleton() {
  return (
    <>
      {Array.from({ length: 6 }).map((_, i) => (
        <tr key={i} className="border-b">
          <td className="px-4 py-3"><Skeleton className="h-4 w-20" /></td>
          <td className="px-4 py-3"><Skeleton className="h-4 w-32 mb-1" /><Skeleton className="h-3 w-24" /></td>
          <td className="px-4 py-3"><Skeleton className="h-5 w-24 rounded-full" /></td>
          <td className="px-4 py-3"><Skeleton className="h-4 w-20" /></td>
          <td className="px-4 py-3 text-right"><Skeleton className="h-4 w-16 ml-auto" /></td>
          <td className="px-4 py-3 text-right"><Skeleton className="h-4 w-12 ml-auto" /></td>
          <td className="px-4 py-3 text-center"><Skeleton className="h-5 w-20 mx-auto rounded-full" /></td>
          <td className="px-4 py-3 text-right"><Skeleton className="h-7 w-7 ml-auto rounded" /></td>
        </tr>
      ))}
    </>
  );
}

/** Returns the interval for the chosen quick filter, or null for 'all' / when custom dates are incomplete. */
function getDateInterval(filter: DateFilter, customFrom: string, customTo: string): { start: Date; end: Date } | null {
  const now = new Date();
  if (filter === 'today') return { start: startOfDay(now), end: endOfDay(now) };
  if (filter === 'week')  return { start: startOfWeek(now, { weekStartsOn: 1 }), end: endOfWeek(now, { weekStartsOn: 1 }) };
  if (filter === 'month') return { start: startOfMonth(now), end: endOfMonth(now) };
  if (filter === 'custom' && customFrom && customTo) {
    const s = startOfDay(new Date(customFrom));
    const e = endOfDay(new Date(customTo));
    if (!isNaN(s.getTime()) && !isNaN(e.getTime()) && s <= e) return { start: s, end: e };
  }
  return null;
}

export default function WorkListPage() {
  const { userProfile } = useAuth();
  const [entries, setEntries] = useState<WorkEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [dateFilter, setDateFilter] = useState<DateFilter>('all');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [staffFilter, setStaffFilter] = useState('');   // '' = All Staff
  const [staffList, setStaffList] = useState<UserProfile[]>([]);
  const [sortField, setSortField] = useState<SortField>('date');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const { categories } = useSettings();
  const { toast } = useToast();
  const [entryToDelete, setEntryToDelete] = useState<string | null>(null);
  const [selectedMobile, setSelectedMobile] = useState<string | null>(null);

  useEffect(() => {
    const unsub = subscribeToWorkEntries((data) => {
      setEntries(data);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  // Subscribe to all staff/manager accounts for the dropdown
  useEffect(() => {
    const unsub = subscribeToStaff(setStaffList);
    return () => unsub();
  }, []);

  const handleDelete = async () => {
    if (!entryToDelete) return;
    try {
      await deleteWorkEntry(entryToDelete);
      toast({ title: 'Entry moved to trash', description: 'Restore it from Deleted Items if needed.' });
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error', description: err.message });
    } finally {
      setEntryToDelete(null);
    }
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('desc'); }
  };

  const dateInterval = useMemo(
    () => getDateInterval(dateFilter, customFrom, customTo),
    [dateFilter, customFrom, customTo],
  );

  const filteredAndSorted = useMemo(() => {
    const filtered = entries.filter(e => {
      const q = searchTerm.toLowerCase();
      const matchSearch = !q || e.customerName.toLowerCase().includes(q) || e.mobile.includes(q) || e.category.toLowerCase().includes(q);
      const matchStatus = statusFilter === 'All' || e.status === statusFilter;
      const matchCat = categoryFilter === 'All' || e.category === categoryFilter;
      const matchDate = !dateInterval || isWithinInterval(e.date.toDate(), dateInterval);
      const matchStaff = !staffFilter || (e.addedBy ?? '') === staffFilter;
      return matchSearch && matchStatus && matchCat && matchDate && matchStaff;
    });
    return [...filtered].sort((a, b) => {
      let cmp = 0;
      if (sortField === 'date') cmp = a.date.toMillis() - b.date.toMillis();
      else if (sortField === 'totalAmount') cmp = a.totalAmount - b.totalAmount;
      else if (sortField === 'dueAmount') cmp = a.dueAmount - b.dueAmount;
      else if (sortField === 'status') cmp = a.status.localeCompare(b.status);
      else if (sortField === 'customerName') cmp = a.customerName.localeCompare(b.customerName);
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [entries, searchTerm, statusFilter, categoryFilter, dateInterval, staffFilter, sortField, sortDir]);

  const mobileHistoryEntries = selectedMobile ? entries.filter(e => e.mobile === selectedMobile) : [];

  const hasActiveFilters = searchTerm || statusFilter !== 'All' || categoryFilter !== 'All' || dateFilter !== 'all' || staffFilter !== '';

  const clearAllFilters = () => {
    setSearchTerm('');
    setStatusFilter('All');
    setCategoryFilter('All');
    setDateFilter('all');
    setCustomFrom('');
    setCustomTo('');
    setStaffFilter('');
  };

  // Build staff dropdown list: owner first, then all staff/managers sorted by name
  const ownerName = userProfile?.displayName || userProfile?.email || '';
  const staffOptions = useMemo(() => {
    const options: { value: string; label: string }[] = [];
    if (ownerName) options.push({ value: ownerName, label: `${ownerName} (Owner)` });
    staffList.forEach(s => {
      const name = s.displayName || s.email || '';
      if (name && name !== ownerName) {
        const roleLabel = s.role === 'manager' ? 'Manager' : 'Staff';
        options.push({ value: name, label: `${name} (${roleLabel})` });
      }
    });
    return options;
  }, [ownerName, staffList]);

  const ThHeader = ({ field, label, className = '' }: { field: SortField; label: string; className?: string }) => (
    <th className={`px-4 py-3 font-medium text-muted-foreground text-xs uppercase tracking-wide cursor-pointer select-none hover:text-foreground transition-colors ${className}`}
      onClick={() => handleSort(field)}>
      <span className="inline-flex items-center">
        {label}
        <SortIcon field={field} current={sortField} dir={sortDir} />
      </span>
    </th>
  );

  return (
    <div className="space-y-6 animate-fade-in-up">
      <div className="flex flex-col md:flex-row justify-between md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold" style={{ fontFamily: 'var(--app-font-display)' }}>All Work</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {loading ? 'Loading...' : `${filteredAndSorted.length} of ${entries.length} entries`}
          </p>
        </div>
        <Link href="/work/new">
          <Button className="gap-2 shadow-sm"><PlusCircle className="h-4 w-4" />Add New Entry</Button>
        </Link>
      </div>

      <div className="bg-card border rounded-xl shadow-card">
        {/* Filters */}
        <div className="p-4 border-b space-y-3 bg-muted/10">
          {/* Row 1: Search + Status + Category */}
          <div className="flex flex-col md:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search name, mobile, or category..."
                value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 h-10 bg-background" />
            </div>
            <div className="flex gap-3 flex-wrap">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[140px] h-10 bg-background">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All Status</SelectItem>
                  <SelectItem value="Pending">🟡 Pending</SelectItem>
                  <SelectItem value="Completed">🟢 Completed</SelectItem>
                  <SelectItem value="Rejected">🔴 Rejected</SelectItem>
                </SelectContent>
              </Select>
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger className="w-[180px] h-10 bg-background">
                  <SelectValue placeholder="Category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="All">All Categories</SelectItem>
                  {categories.map(c => (
                    <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={staffFilter} onValueChange={setStaffFilter}>
                <SelectTrigger className="w-[180px] h-10 bg-background">
                  <SelectValue placeholder="All Staff" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">All Staff</SelectItem>
                  {staffOptions.map(o => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Row 2: Date filter */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground shrink-0">
              <CalendarRange className="h-4 w-4" />
              <span className="font-medium uppercase tracking-wide">Date</span>
            </div>
            <Select value={dateFilter} onValueChange={(v) => { setDateFilter(v as DateFilter); setCustomFrom(''); setCustomTo(''); }}>
              <SelectTrigger className="w-[160px] h-9 bg-background text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Time</SelectItem>
                <SelectItem value="today">Today</SelectItem>
                <SelectItem value="week">This Week</SelectItem>
                <SelectItem value="month">This Month</SelectItem>
                <SelectItem value="custom">Custom Range</SelectItem>
              </SelectContent>
            </Select>

            {dateFilter === 'custom' && (
              <div className="flex items-center gap-2 flex-wrap">
                <Input
                  type="date"
                  className="w-36 h-9 bg-background text-sm"
                  value={customFrom}
                  onChange={e => setCustomFrom(e.target.value)}
                  placeholder="From"
                />
                <span className="text-muted-foreground text-sm">–</span>
                <Input
                  type="date"
                  className="w-36 h-9 bg-background text-sm"
                  value={customTo}
                  min={customFrom}
                  onChange={e => setCustomTo(e.target.value)}
                  placeholder="To"
                />
              </div>
            )}

            {hasActiveFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearAllFilters}
                className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground gap-1 ml-auto"
              >
                <X className="h-3.5 w-3.5" /> Clear filters
              </Button>
            )}
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-muted/30 border-b">
              <tr>
                <ThHeader field="date" label="Date" />
                <ThHeader field="customerName" label="Customer" />
                <th className="px-4 py-3 font-medium text-muted-foreground text-xs uppercase tracking-wide">Category</th>
                <th className="px-4 py-3 font-medium text-muted-foreground text-xs uppercase tracking-wide">Added By</th>
                <ThHeader field="totalAmount" label="Net Profit" className="text-right" />
                <ThHeader field="dueAmount" label="Due" className="text-right" />
                <ThHeader field="status" label="Status" className="text-center" />
                <th className="px-4 py-3 font-medium text-muted-foreground text-xs uppercase tracking-wide text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <TableSkeleton />
              ) : filteredAndSorted.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-16 text-center">
                    <div className="flex flex-col items-center text-muted-foreground">
                      <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mb-3">
                        <Search className="h-5 w-5 opacity-40" />
                      </div>
                      <p className="font-medium">No entries found</p>
                      <p className="text-xs mt-1">
                        {entries.length === 0 ? 'Add your first work entry to get started' : 'Try adjusting your search or filters'}
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredAndSorted.map((entry, idx) => (
                  <tr key={entry.id}
                    className={`border-b last:border-0 hover:bg-muted/20 transition-colors
                      ${entry.status === 'Rejected' ? 'opacity-60' : ''}
                      ${idx % 2 === 1 ? 'bg-muted/10' : ''}`}>
                    <td className="px-4 py-3 whitespace-nowrap text-muted-foreground text-xs">
                      {format(entry.date.toDate(), 'dd MMM yyyy')}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-foreground">{entry.customerName}</div>
                      <button onClick={() => setSelectedMobile(entry.mobile)}
                        className="text-xs text-primary hover:underline flex items-center gap-1 mt-0.5">
                        <History className="h-3 w-3" />{entry.mobile}
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant="secondary" className="font-normal text-xs">
                        {entry.category === 'Other' && entry.otherCategory ? entry.otherCategory : entry.category}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <UserCircle2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
                        <span className="font-medium text-foreground truncate max-w-[100px]">
                          {entry.addedBy || '—'}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {(() => {
                        const net = entry.netAdjustmentAmount ?? 0;
                        const final = entry.totalAmount + net;
                        const challan = (entry.challanAmount ?? 0) + (entry.netAdjustmentChallan ?? 0);
                        const netProfit = final - challan;
                        return (
                          <>
                            <span className="font-semibold">{formatCurrency(netProfit)}</span>
                            {net !== 0 && (
                              <span className="block text-xs text-indigo-600 font-normal">
                                adj {net > 0 ? '+' : '−'}₹{Math.abs(net).toLocaleString('en-IN')}
                              </span>
                            )}
                          </>
                        );
                      })()}
                      {((entry.challanAmount ?? 0) + (entry.netAdjustmentChallan ?? 0)) !== 0 ? (
                        <span className="block text-xs text-amber-600 font-normal">
                          Challan: {formatCurrency((entry.challanAmount ?? 0) + (entry.netAdjustmentChallan ?? 0))}
                        </span>
                      ) : null}
                      {entry.status === 'Rejected' && entry.refundAmount ? (
                        <span className="block text-xs text-red-500 font-normal">Refund: {formatCurrency(entry.refundAmount)}</span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {entry.dueAmount > 0 ? (
                        <span className="font-bold text-red-600 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full text-xs">
                          {formatCurrency(entry.dueAmount)}
                        </span>
                      ) : entry.dueAmount < 0 ? (
                        <span className="font-bold text-blue-600 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-full text-xs">
                          +{formatCurrency(Math.abs(entry.dueAmount))} credit
                        </span>
                      ) : (
                        <span className="text-emerald-600 text-xs font-medium">Paid ✓</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <StatusBadge status={entry.status} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="rounded-xl shadow-card-hover">
                          <Link href={`/work/${entry.id}/edit`}>
                            <DropdownMenuItem className="cursor-pointer rounded-lg">
                              <Edit className="h-4 w-4 mr-2" /> Update / Add Payment
                            </DropdownMenuItem>
                          </Link>
                          <DropdownMenuItem
                            className="cursor-pointer text-destructive focus:text-destructive rounded-lg"
                            onClick={() => setEntryToDelete(entry.id!)}>
                            <Trash2 className="h-4 w-4 mr-2" /> Move to Trash
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Delete Dialog */}
      <AlertDialog open={!!entryToDelete} onOpenChange={(open) => !open && setEntryToDelete(null)}>
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Move to trash?</AlertDialogTitle>
            <AlertDialogDescription>
              This entry will be soft-deleted and moved to Deleted Items. You can restore it anytime from there.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-xl">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90 rounded-xl">
              Move to Trash
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Customer History Modal */}
      <Dialog open={!!selectedMobile} onOpenChange={(open) => !open && setSelectedMobile(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <History className="h-4 w-4 text-primary" />
              Customer History — <span className="font-mono text-primary">{selectedMobile}</span>
            </DialogTitle>
          </DialogHeader>
          <div className="mt-4 space-y-3">
            {mobileHistoryEntries.map(entry => {
              const resolvedAt = entry.status === 'Completed' ? entry.completedAt : entry.status === 'Rejected' ? entry.rejectedAt : null;
              const duration = resolvedAt && entry.createdAt
                ? formatDistanceStrict(resolvedAt.toDate(), entry.createdAt.toDate()) : null;
              return (
                <div key={entry.id} className={`border rounded-xl p-4 space-y-3 ${entry.status === 'Rejected' ? 'border-red-200 bg-red-50/30' : ''}`}>
                  <div className="flex flex-col sm:flex-row justify-between gap-3">
                    <div>
                      <div className="font-semibold">{entry.customerName}</div>
                      <div className="text-sm text-muted-foreground mt-0.5">{format(entry.date.toDate(), 'dd MMM yyyy')}</div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Badge variant="secondary" className="text-xs">
                          {entry.category === 'Other' && entry.otherCategory ? entry.otherCategory : entry.category}
                        </Badge>
                        <StatusBadge status={entry.status} />
                      </div>
                      {entry.addedBy && (
                        <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                          <UserCircle2 className="h-3.5 w-3.5" />
                          Added by: <span className="font-medium text-foreground">{entry.addedBy}</span>
                        </div>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-sm font-semibold">
                        Total: {formatCurrency(entry.totalAmount + (entry.netAdjustmentAmount ?? 0))}
                        {(entry.netAdjustmentAmount ?? 0) !== 0 && (
                          <span className="text-xs font-normal text-indigo-600 ml-1">
                            ({(entry.netAdjustmentAmount ?? 0) > 0 ? '+' : '−'}₹{Math.abs(entry.netAdjustmentAmount ?? 0).toLocaleString('en-IN')})
                          </span>
                        )}
                      </div>
                      {entry.dueAmount > 0 && <div className="text-sm text-red-600 mt-0.5">Due: {formatCurrency(entry.dueAmount)}</div>}
                      {entry.dueAmount < 0 && <div className="text-sm text-blue-600 mt-0.5">Credit: {formatCurrency(Math.abs(entry.dueAmount))}</div>}
                      {entry.challanAmount ? <div className="text-xs text-amber-600 mt-0.5">Challan: {formatCurrency((entry.challanAmount ?? 0) + (entry.netAdjustmentChallan ?? 0))}</div> : null}
                      {entry.status === 'Rejected' && entry.refundAmount
                        ? <div className="text-sm text-red-500 mt-0.5">Refund: {formatCurrency(entry.refundAmount)}</div> : null}
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground space-y-1 pt-2 border-t">
                    {entry.createdAt && (
                      <div className="flex items-center gap-1.5">
                        <Clock className="h-3 w-3" />
                        Created: {format(entry.createdAt.toDate(), 'dd MMM yyyy, h:mm a')}
                      </div>
                    )}
                    {entry.status === 'Completed' && entry.completedAt ? (
                      <div className="flex items-center gap-1.5 text-emerald-700">
                        <CheckCircle2 className="h-3 w-3" />
                        Completed: {format(entry.completedAt.toDate(), 'dd MMM yyyy, h:mm a')}
                        {duration && <span className="ml-1 text-muted-foreground">(in {duration})</span>}
                      </div>
                    ) : entry.status === 'Rejected' && entry.rejectedAt ? (
                      <div className="flex items-center gap-1.5 text-red-700">
                        <XCircle className="h-3 w-3" />
                        Rejected: {format(entry.rejectedAt.toDate(), 'dd MMM yyyy, h:mm a')}
                        {duration && <span className="ml-1 text-muted-foreground">(after {duration})</span>}
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 text-amber-600">
                        <Clock className="h-3 w-3" /> Still pending
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
