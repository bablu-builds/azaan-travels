import { useState, useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useSettings } from '@/contexts/SettingsContext';
import { Timestamp } from 'firebase/firestore';
import { addCategory } from '@/lib/firestore';
import { format } from 'date-fns';

import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { CalendarIcon, Loader2, IndianRupee, XCircle, Receipt, Check, ChevronsUpDown } from 'lucide-react';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from '@/components/ui/command';
import { cn } from '@/lib/utils';
import { PaymentModeSelector } from '@/components/PaymentModeSelector';
import { PaymentMode } from '@/lib/payments';

const formSchema = z.object({
  customerName: z.string().min(1, 'Name is required'),
  mobile: z.string().length(10, 'Mobile must be exactly 10 digits').regex(/^\d+$/, 'Must be only digits'),
  category: z.string().min(1, 'Category is required'),
  otherCategory: z.string().optional(),
  workDetail: z.string().optional(),
  date: z.date(),
  totalAmount: z.coerce.number().min(0, 'Amount cannot be negative'),
  paidAmount: z.coerce.number().min(0, 'Amount cannot be negative'),
  challanAmount: z.coerce.number().min(0, 'Amount cannot be negative').optional(),
  status: z.enum(['Pending', 'Completed', 'Rejected']),
  address: z.string().optional(),
  rejectionReason: z.string().optional(),
  refundAmount: z.coerce.number().min(0, 'Amount cannot be negative').optional(),
  paymentMode: z.enum(['Cash', 'Online', 'Due', 'None']).default('Cash'),
}).refine(
  (data) => data.category !== 'Other' || (data.otherCategory ?? '').trim().length > 0,
  { message: 'Please specify the work category', path: ['otherCategory'] }
);

export type WorkEntryFormData = z.infer<typeof formSchema>;

interface WorkEntryFormProps {
  initialData?: Partial<WorkEntryFormData>;
  onSubmit: (data: Omit<WorkEntryFormData, 'date'> & { date: Timestamp }) => Promise<void>;
  isSubmitting?: boolean;
  /** When true: hides the Paid Amount input (edit mode — payments managed via Payment History section) */
  isEditing?: boolean;
  /** Current paidAmount from Firestore — used in edit mode to calculate live due amount as totalAmount changes */
  currentPaidAmount?: number;
  /**
   * Sum of all Deal Adjustments amountChange for this entry.
   * When provided, the due-amount preview in edit mode adds this to the original totalAmount.
   */
  netAdjustmentAmount?: number;
  /**
   * Sum of all Deal Adjustments challanChange for this entry.
   * When provided, shows the effective challan info line in edit mode.
   */
  netAdjustmentChallan?: number;
}

/** Shared helper: value → '' when 0 so the field shows blank (avoids leading-zero bug). */
function numericFieldProps(field: { value: number | undefined; onChange: (v: string | number) => void }) {
  return {
    value: field.value !== undefined && field.value !== 0 ? field.value : '',
    placeholder: '0',
    onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
      field.onChange(e.target.value === '' ? 0 : e.target.value),
    onFocus: (e: React.FocusEvent<HTMLInputElement>) => e.target.select(),
  };
}

export function WorkEntryForm({
  initialData,
  onSubmit,
  isSubmitting = false,
  isEditing = false,
  currentPaidAmount = 0,
  netAdjustmentAmount = 0,
  netAdjustmentChallan = 0,
}: WorkEntryFormProps) {
  const { categories } = useSettings();
  const [catOpen, setCatOpen] = useState(false);
  const [catSearch, setCatSearch] = useState('');

  const form = useForm<WorkEntryFormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      customerName: initialData?.customerName || '',
      mobile: initialData?.mobile || '',
      category: initialData?.category || '',
      otherCategory: initialData?.otherCategory || '',
      workDetail: initialData?.workDetail || '',
      date: initialData?.date || new Date(),
      totalAmount: initialData?.totalAmount || 0,
      paidAmount: initialData?.paidAmount || 0,
      challanAmount: initialData?.challanAmount ?? 0,
      status: initialData?.status || 'Pending',
      address: initialData?.address || '',
      rejectionReason: initialData?.rejectionReason || '',
      refundAmount: initialData?.refundAmount ?? undefined,
      paymentMode: initialData?.paymentMode || 'Cash',
    },
  });

  // Re-sync form when Firestore entry updates
  useEffect(() => {
    if (!initialData) return;
    form.reset({
      customerName: initialData.customerName ?? '',
      mobile: initialData.mobile ?? '',
      category: initialData.category ?? '',
      otherCategory: initialData.otherCategory ?? '',
      workDetail: initialData.workDetail ?? '',
      date: initialData.date ?? new Date(),
      totalAmount: initialData.totalAmount ?? 0,
      paidAmount: initialData.paidAmount ?? 0,
      challanAmount: initialData.challanAmount ?? 0,
      status: initialData.status ?? 'Pending',
      address: initialData.address ?? '',
      rejectionReason: initialData.rejectionReason ?? '',
      refundAmount: initialData.refundAmount ?? undefined,
      paymentMode: initialData.paymentMode ?? 'Cash',
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialData?.totalAmount, initialData?.challanAmount, initialData?.status, initialData?.customerName, initialData?.mobile]);

  const total = form.watch('totalAmount');
  const paid = form.watch('paidAmount');
  const status = form.watch('status');
  const paymentMode = form.watch('paymentMode');
  const category = form.watch('category');
  const isOtherCategory = category === 'Other';

  // ── Payment mode side-effects ────────────────────────────────────────────
  useEffect(() => {
    if (isEditing) return;
    if (paymentMode === 'Due') {
      form.setValue('paidAmount', 0);
    } else if (paymentMode === 'None') {
      form.setValue('totalAmount', 0);
      form.setValue('paidAmount', 0);
      form.setValue('challanAmount', 0);
      form.setValue('status', 'Completed');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paymentMode, isEditing]);

  // In edit mode: due = (original totalAmount + netAdjustmentAmount) − current Firestore paidAmount
  // In add mode:  due = totalAmount − paidAmount from form
  const effectiveDue = isEditing
    ? (total || 0) + netAdjustmentAmount - currentPaidAmount
    : (total || 0) - (paid || 0);

  const showPaidAmount = !isEditing && paymentMode !== 'Due' && paymentMode !== 'None';
  const showPaymentFields = paymentMode !== 'None' || isEditing;
  const isTotalLocked = !isEditing && paymentMode === 'None';

  const filteredCats = useMemo(() => {
    if (!catSearch.trim()) return categories;
    const q = catSearch.toLowerCase();
    return categories.filter(c => c.name.toLowerCase().includes(q));
  }, [categories, catSearch]);

  const handleSubmit = async (values: WorkEntryFormData) => {
    let finalCategory = values.category;
    const finalOtherCategory = values.otherCategory;

    if (values.category === 'Other' && values.otherCategory?.trim()) {
      const typedName = values.otherCategory.trim();
      // Use existing category (case-insensitive) or create a new one
      const existing = categories.find(c => c.name.toLowerCase() === typedName.toLowerCase());
      if (existing) {
        finalCategory = existing.name;
      } else {
        const maxOrder = categories.reduce((m, c) => Math.max(m, c.order ?? 0), -1);
        await addCategory(typedName, maxOrder + 1);
        finalCategory = typedName;
      }
    }

    await onSubmit({
      ...values,
      category: finalCategory,
      otherCategory: finalOtherCategory,
      date: Timestamp.fromDate(values.date),
    });
  };

  const inputClass = "h-10 bg-background border-border focus:ring-2 focus:ring-primary/20 transition-all";

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-6">
        {/* Customer info */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <FormField control={form.control} name="customerName" render={({ field }) => (
            <FormItem>
              <FormLabel className="text-sm font-medium">Customer Name <span className="text-destructive">*</span></FormLabel>
              <FormControl>
                <Input placeholder="Enter full name" className={inputClass} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )} />

          <FormField control={form.control} name="mobile" render={({ field }) => (
            <FormItem>
              <FormLabel className="text-sm font-medium">Mobile Number <span className="text-destructive">*</span></FormLabel>
              <FormControl>
                <Input placeholder="10-digit mobile" maxLength={10} className={inputClass} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )} />

          <div className="space-y-3">
            <FormField control={form.control} name="category" render={({ field }) => (
              <FormItem>
                <FormLabel className="text-sm font-medium">Work Category <span className="text-destructive">*</span></FormLabel>
                <Popover open={catOpen} onOpenChange={(open) => { setCatOpen(open); if (!open) setCatSearch(''); }}>
                  <PopoverTrigger asChild>
                    <FormControl>
                      <Button
                        variant="outline"
                        role="combobox"
                        className={cn(inputClass, "w-full justify-between font-normal px-3", !field.value && "text-muted-foreground")}
                      >
                        <span className="truncate">{field.value || "Select category"}</span>
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </FormControl>
                  </PopoverTrigger>
                  <PopoverContent className="p-0 w-72" align="start">
                    <Command shouldFilter={false}>
                      <CommandInput
                        placeholder="Search category…"
                        value={catSearch}
                        onValueChange={setCatSearch}
                      />
                      <CommandList>
                        <CommandEmpty>No category found.</CommandEmpty>
                        <CommandGroup>
                          {filteredCats.map(cat => (
                            <CommandItem
                              key={cat.id}
                              value={cat.id}
                              onSelect={() => {
                                field.onChange(cat.name);
                                if (cat.name !== 'Other') form.setValue('otherCategory', '');
                                setCatOpen(false);
                                setCatSearch('');
                              }}
                            >
                              <Check className={cn("mr-2 h-4 w-4 shrink-0", field.value === cat.name ? "opacity-100" : "opacity-0")} />
                              {cat.name}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
                <FormMessage />
              </FormItem>
            )} />

            {/* Animated "Specify Work Category" field — only when Other is selected */}
            <div
              className={cn(
                "overflow-hidden transition-all duration-300 ease-in-out",
                isOtherCategory ? "max-h-24 opacity-100 translate-y-0" : "max-h-0 opacity-0 -translate-y-1 pointer-events-none"
              )}
            >
              <FormField control={form.control} name="otherCategory" render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-sm font-medium">
                    Specify Work Category <span className="text-destructive">*</span>
                  </FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Enter the type of work..."
                      className={inputClass}
                      {...field}
                      tabIndex={isOtherCategory ? 0 : -1}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
          </div>

          <FormField control={form.control} name="date" render={({ field }) => (
            <FormItem className="flex flex-col">
              <FormLabel className="text-sm font-medium">Date <span className="text-destructive">*</span></FormLabel>
              <Popover>
                <PopoverTrigger asChild>
                  <FormControl>
                    <Button variant="outline"
                      className={cn("h-10 pl-3 text-left font-normal border-border bg-background", !field.value && "text-muted-foreground")}>
                      {field.value ? format(field.value, "PPP") : <span>Pick a date</span>}
                      <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                    </Button>
                  </FormControl>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={field.value} onSelect={field.onChange}
                    disabled={(d) => d > new Date() || d < new Date("1900-01-01")} initialFocus />
                </PopoverContent>
              </Popover>
              <FormMessage />
            </FormItem>
          )} />
        </div>

        {/* Work detail */}
        <FormField control={form.control} name="workDetail" render={({ field }) => (
          <FormItem>
            <FormLabel className="text-sm font-medium">Work Detail / Notes</FormLabel>
            <FormControl>
              <Textarea placeholder="Describe the work, document type, or any notes..." className="bg-background border-border resize-none" rows={3} {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )} />

        {/* Amount + Payment section */}
        <div className="p-5 bg-muted/30 rounded-xl border space-y-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Payment Details</p>

          {!isEditing && (
            <FormField control={form.control} name="paymentMode" render={({ field }) => (
              <FormItem>
                <FormLabel className="text-sm font-medium">Payment Mode</FormLabel>
                <FormControl>
                  <PaymentModeSelector
                    value={field.value as PaymentMode}
                    onChange={field.onChange}
                    showHints
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />
          )}

          <div className={cn("grid gap-4", isEditing ? "grid-cols-1 md:grid-cols-3" : "grid-cols-1 md:grid-cols-2 lg:grid-cols-3")}>
            {/* Total Amount */}
            <FormField control={form.control} name="totalAmount" render={({ field }) => (
              <FormItem>
                <FormLabel className="text-sm font-medium">
                  {isEditing ? 'Original Total Amount (₹)' : 'Total Amount (₹)'}
                </FormLabel>
                <FormControl>
                  <div className="relative">
                    <IndianRupee className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input type="number" min={0} className={cn(inputClass, "pl-9")}
                      disabled={isTotalLocked}
                      {...numericFieldProps(field)} />
                  </div>
                </FormControl>
                {isEditing && (
                  netAdjustmentAmount !== 0 ? (
                    <p className="text-xs text-muted-foreground mt-1">
                      Current Effective Total:{' '}
                      <span className="font-semibold text-foreground">
                        ₹{((field.value as number || 0) + netAdjustmentAmount).toLocaleString('en-IN')}
                      </span>
                      <span className="ml-1">
                        (Orig ₹{(field.value as number || 0).toLocaleString('en-IN')}{' '}
                        {netAdjustmentAmount >= 0 ? '+' : '−'} Adj ₹{Math.abs(netAdjustmentAmount).toLocaleString('en-IN')})
                      </span>
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground mt-1">
                      Original value — use Deal Adjustments to change the effective total
                    </p>
                  )
                )}
                <FormMessage />
              </FormItem>
            )} />

            {/* Paid Amount — only shown when mode is Cash or Online (not Due/None, not editing) */}
            {showPaidAmount && (
              <FormField control={form.control} name="paidAmount" render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-sm font-medium">Paid Amount (₹)</FormLabel>
                  <FormControl>
                    <div className="relative">
                      <IndianRupee className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                      <Input type="number" min={0} className={cn(inputClass, "pl-9")}
                        {...numericFieldProps(field)} />
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            )}

            {/* Challan */}
            {showPaymentFields && (
              <FormField control={form.control} name="challanAmount" render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-sm font-medium flex items-center gap-1.5">
                    <Receipt className="h-3.5 w-3.5 text-muted-foreground" />
                    {isEditing ? 'Original Challan (₹)' : 'Challan (₹)'}
                  </FormLabel>
                  <FormControl>
                    <div className="relative">
                      <IndianRupee className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                      <Input type="number" min={0} className={cn(inputClass, "pl-9")}
                        {...numericFieldProps(field as { value: number | undefined; onChange: (v: string | number) => void })} />
                    </div>
                  </FormControl>
                  <FormMessage />
                  {isEditing && netAdjustmentChallan !== 0 && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Current Effective Challan:{' '}
                      <span className="font-semibold text-foreground">
                        ₹{((field.value as number || 0) + netAdjustmentChallan).toLocaleString('en-IN')}
                      </span>
                      <span className="ml-1">
                        (Orig ₹{(field.value as number || 0).toLocaleString('en-IN')}{' '}
                        {netAdjustmentChallan >= 0 ? '+' : '−'} Adj ₹{Math.abs(netAdjustmentChallan).toLocaleString('en-IN')})
                      </span>
                    </p>
                  )}
                </FormItem>
              )} />
            )}

            {/* Due Amount — read-only calculated display */}
            {showPaymentFields && (
              <div className="space-y-2">
                <label className="block text-sm font-medium leading-none">
                  {effectiveDue < 0 ? 'Overpaid' : 'Due Amount'} (₹)
                  {isEditing && netAdjustmentAmount !== 0 && (
                    <span className="ml-1.5 text-xs text-primary font-normal">(adjusted)</span>
                  )}
                </label>
                <div className={cn(
                  "h-10 px-3 rounded-md border font-semibold flex items-center gap-2 text-sm",
                  paymentMode === 'Due' && !isEditing
                    ? "bg-amber-50 border-amber-200 text-amber-700"
                    : effectiveDue > 0
                    ? "bg-red-50 border-red-200 text-red-700"
                    : effectiveDue < 0
                    ? "bg-blue-50 border-blue-200 text-blue-700"
                    : "bg-emerald-50 border-emerald-200 text-emerald-700"
                )}>
                  <IndianRupee className="h-4 w-4" />
                  {Math.abs(effectiveDue).toLocaleString('en-IN')}
                  {effectiveDue < 0 && <span className="text-xs font-normal ml-1">(credit)</span>}
                  {paymentMode === 'Due' && !isEditing && (
                    <span className="text-xs font-normal ml-1">(collect later)</span>
                  )}
                </div>
                {isEditing && (
                  <p className="text-xs text-muted-foreground">Paid via Payment History · Adjusted via Deal Adjustments</p>
                )}
              </div>
            )}
          </div>

          {paymentMode === 'None' && !isEditing && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
              Free service — ₹0 charged. Entry will be marked Completed automatically.
            </div>
          )}
        </div>

        {/* Status & Address */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <FormField control={form.control} name="status" render={({ field }) => (
            <FormItem>
              <FormLabel className="text-sm font-medium">Status</FormLabel>
              <Select onValueChange={field.onChange} value={field.value}
                disabled={paymentMode === 'None' && !isEditing}>
                <FormControl>
                  <SelectTrigger className={inputClass}>
                    <SelectValue placeholder="Select status" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="Pending">🟡 Pending</SelectItem>
                  <SelectItem value="Completed">🟢 Completed</SelectItem>
                  <SelectItem value="Rejected">🔴 Rejected</SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )} />

          <FormField control={form.control} name="address" render={({ field }) => (
            <FormItem>
              <FormLabel className="text-sm font-medium">Customer Address</FormLabel>
              <FormControl>
                <Input placeholder="Optional address" className={inputClass} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )} />
        </div>

        {/* Rejection fields */}
        {status === 'Rejected' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 p-5 bg-red-50/80 rounded-xl border border-red-200">
            <div className="col-span-full flex items-center gap-2 text-red-700 font-semibold text-sm">
              <XCircle className="h-4 w-4" /> Rejection Details
            </div>
            <FormField control={form.control} name="rejectionReason" render={({ field }) => (
              <FormItem>
                <FormLabel className="text-sm font-medium">Rejection Reason</FormLabel>
                <FormControl>
                  <Input placeholder="e.g. Wrong documents, Customer cancelled" className={inputClass} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="refundAmount" render={({ field }) => (
              <FormItem>
                <FormLabel className="text-sm font-medium">Refund Amount (₹)</FormLabel>
                <FormControl>
                  <div className="relative">
                    <IndianRupee className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input type="number" min={0} className={cn(inputClass, "pl-9")} placeholder="0"
                      value={field.value ?? ''}
                      onChange={e => field.onChange(e.target.value === '' ? undefined : e.target.value)}
                      onFocus={e => e.target.select()} />
                  </div>
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />
          </div>
        )}

        <div className="flex justify-end pt-2">
          <Button type="submit" size="lg" disabled={isSubmitting} className="min-w-[160px] h-11 font-semibold shadow-sm">
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save Work Entry
          </Button>
        </div>
      </form>
    </Form>
  );
}
