import { useState, useEffect, useCallback } from 'react';
import { useSettings } from '@/contexts/SettingsContext';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Loader2, Plus, Trash2, Users, ShieldCheck, UserX, UserPlus, Eye, EyeOff,
  Database, Phone, ChevronDown, ChevronUp, Pencil, CheckCircle2, XCircle,
  RotateCcw, Lock, GripVertical,
} from 'lucide-react';
import {
  DndContext, closestCenter, PointerSensor, TouchSensor,
  useSensor, useSensors, DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove, SortableContext, useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Category } from '@/lib/firestore';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import {
  UserProfile, subscribeToStaff, createStaffAccount, StaffPermissions,
  revokeStaffAccess, updateStaffProfile, updateStaffRole,
  deactivateStaff, reactivateStaff, backfillStaffIds, getStaffWorkStats,
} from '@/lib/firestore';
import { auth } from '@/lib/firebase';
import { format } from 'date-fns';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import FirebaseControlTab from '@/components/FirebaseControlTab';

// ─── Sortable category row ────────────────────────────────────────────────────

function SortableCategoryRow({ cat, onRemove }: { cat: Category; onRemove: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: cat.id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}
      className="px-3 py-2.5 flex justify-between items-center hover:bg-muted/20 transition-colors bg-background"
    >
      <div className="flex items-center gap-2 min-w-0">
        <button
          type="button"
          className="cursor-grab active:cursor-grabbing touch-none p-1 text-muted-foreground hover:text-foreground shrink-0 rounded"
          {...attributes}
          {...listeners}
          aria-label="Drag to reorder"
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <span className="font-medium text-sm truncate">{cat.name}</span>
      </div>
      <Button
        variant="ghost" size="icon"
        className="h-8 w-8 rounded-lg text-destructive hover:text-destructive hover:bg-destructive/10 shrink-0"
        onClick={onRemove}
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
}

// ─── Permission toggles helper ───────────────────────────────────────────────

interface PermToggles {
  canManageWork: boolean;
  canAccessFinancialServices: boolean;
  canAccessQuickWork: boolean;
  canViewDeletedItems: boolean;
  canManageCategories: boolean;
}

function PermissionToggle({
  id, label, description, checked, onChange, disabled,
}: {
  id: string; label: string; description: string;
  checked: boolean; onChange: (v: boolean) => void; disabled?: boolean;
}) {
  return (
    <div className="flex items-start gap-3 p-3 rounded-lg border bg-muted/30">
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onChange}
        disabled={disabled}
        className="mt-0.5 shrink-0"
      />
      <div className="flex-1 min-w-0">
        <label htmlFor={id} className="text-sm font-medium cursor-pointer leading-tight">{label}</label>
        <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
      </div>
    </div>
  );
}

// ─── Staff work stats ─────────────────────────────────────────────────────────

function StaffWorkStats({ staff }: { staff: UserProfile }) {
  const [stats, setStats] = useState<{ total: number; pending: number; completed: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const load = async () => {
    if (stats) { setExpanded(e => !e); return; }
    setExpanded(true);
    setLoading(true);
    try {
      const s = await getStaffWorkStats(
        staff.displayName || '',
        staff.email,
      );
      setStats(s);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <button
        onClick={load}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        Work Summary
      </button>
      {expanded && (
        <div className="mt-2 grid grid-cols-3 gap-2">
          {loading ? (
            <div className="col-span-3 flex items-center gap-2 text-xs text-muted-foreground py-1">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading stats…
            </div>
          ) : stats ? (
            <>
              <div className="rounded-lg bg-muted/50 border p-2 text-center">
                <div className="text-lg font-bold text-foreground">{stats.total}</div>
                <div className="text-[10px] text-muted-foreground">Total</div>
              </div>
              <div className="rounded-lg bg-amber-50 border border-amber-200 p-2 text-center">
                <div className="text-lg font-bold text-amber-700">{stats.pending}</div>
                <div className="text-[10px] text-amber-600">Pending</div>
              </div>
              <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-2 text-center">
                <div className="text-lg font-bold text-emerald-700">{stats.completed}</div>
                <div className="text-[10px] text-emerald-600">Completed</div>
              </div>
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}

// ─── Edit staff dialog ────────────────────────────────────────────────────────

function EditStaffDialog({
  staff,
  open,
  onClose,
}: {
  staff: UserProfile;
  open: boolean;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [name, setName] = useState(staff.displayName || '');
  const [phone, setPhone] = useState(staff.phone || '');
  const [perms, setPerms] = useState<PermToggles>({
    canManageWork: staff.canManageWork !== false,
    canAccessFinancialServices: staff.canAccessFinancialServices === true,
    canAccessQuickWork: staff.canAccessQuickWork !== false,
    canViewDeletedItems: staff.canViewDeletedItems !== false,
    canManageCategories: staff.canManageCategories === true,
  });
  const [role, setRole] = useState<'manager' | 'staff'>(staff.role === 'manager' ? 'manager' : 'staff');
  const [saving, setSaving] = useState(false);
  const isManager = role === 'manager';

  useEffect(() => {
    setName(staff.displayName || '');
    setPhone(staff.phone || '');
    setRole(staff.role === 'manager' ? 'manager' : 'staff');
    setPerms({
      canManageWork: staff.canManageWork !== false,
      canAccessFinancialServices: staff.canAccessFinancialServices === true,
      canAccessQuickWork: staff.canAccessQuickWork !== false,
      canViewDeletedItems: staff.canViewDeletedItems !== false,
      canManageCategories: staff.canManageCategories === true,
    });
  }, [staff]);

  const handleSave = async () => {
    if (!staff.uid || !name.trim()) return;
    setSaving(true);
    try {
      await updateStaffProfile(staff.uid, {
        displayName: name.trim(),
        phone: phone.trim(),
        ...(role === 'staff' ? perms : {}),
      });
      if (role !== staff.role) {
        await updateStaffRole(staff.uid, role);
      }
      toast({ title: 'Profile updated', description: `${name.trim()}'s details have been saved.` });
      onClose();
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error saving', description: err.message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={open => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Staff Member</DialogTitle>
          <DialogDescription>
            Update {staff.displayName || staff.email}'s details and permissions.
            Email cannot be changed after account creation.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Full Name <span className="text-destructive">*</span></Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Full name" required />
          </div>
          <div className="space-y-2">
            <Label>Phone <span className="text-muted-foreground text-xs">(optional)</span></Label>
            <Input value={phone} onChange={e => setPhone(e.target.value)} placeholder="Mobile number" type="tel" />
          </div>
          <div className="space-y-2">
            <Label className="text-sm font-medium">Email (read-only)</Label>
            <div className="h-10 px-3 flex items-center rounded-md border bg-muted text-sm text-muted-foreground">{staff.email}</div>
          </div>

          <div className="space-y-2">
            <Label>Role</Label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setRole('staff')}
                className={`p-3 rounded-lg border-2 text-left transition-colors ${
                  role === 'staff' ? 'border-primary bg-primary/5' : 'border-border hover:border-muted-foreground/40'
                }`}
              >
                <div className="font-semibold text-sm">Staff</div>
                <p className="text-xs text-muted-foreground mt-0.5">Set individual permissions below.</p>
              </button>
              <button
                type="button"
                onClick={() => setRole('manager')}
                className={`p-3 rounded-lg border-2 text-left transition-colors ${
                  role === 'manager' ? 'border-violet-500 bg-violet-50' : 'border-border hover:border-muted-foreground/40'
                }`}
              >
                <div className="font-semibold text-sm text-violet-700">Manager</div>
                <p className="text-xs text-muted-foreground mt-0.5">Full access to all features.</p>
              </button>
            </div>
          </div>

          {isManager ? (
            <div className="p-3 rounded-lg border bg-violet-50 border-violet-200 text-sm text-violet-800">
              Managers automatically have full permissions — no individual toggles needed.
            </div>
          ) : (
            <div className="space-y-2">
              <Label className="text-sm font-medium">Permissions</Label>
              <div className="space-y-2">
                <PermissionToggle id={`edit-manage-work-${staff.uid}`}
                  label="Manage Work Entries"
                  description="Add and edit CSC service entries (Aadhar, PAN, etc.)"
                  checked={perms.canManageWork}
                  onChange={v => setPerms(p => ({ ...p, canManageWork: v }))}
                />
                <PermissionToggle id={`edit-financial-${staff.uid}`}
                  label="AEPS, Recharge &amp; Money Transfer"
                  description="Access financial service modules"
                  checked={perms.canAccessFinancialServices}
                  onChange={v => setPerms(p => ({ ...p, canAccessFinancialServices: v }))}
                />
                <PermissionToggle id={`edit-quick-${staff.uid}`}
                  label="Quick Action Work"
                  description="Printout, Lamination, Xerox, and other quick services"
                  checked={perms.canAccessQuickWork}
                  onChange={v => setPerms(p => ({ ...p, canAccessQuickWork: v }))}
                />
                <PermissionToggle id={`edit-deleted-${staff.uid}`}
                  label="View Deleted Items"
                  description="Access the recycle bin and restore deleted entries"
                  checked={perms.canViewDeletedItems}
                  onChange={v => setPerms(p => ({ ...p, canViewDeletedItems: v }))}
                />
                <PermissionToggle id={`edit-manage-categories-${staff.uid}`}
                  label="Manage Categories"
                  description="Add, delete, and reorder work categories"
                  checked={perms.canManageCategories}
                  onChange={v => setPerms(p => ({ ...p, canManageCategories: v }))}
                />
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !name.trim()}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Reset password dialog ────────────────────────────────────────────────────

function ResetPasswordDialog({
  staff,
  open,
  onClose,
}: {
  staff: UserProfile;
  open: boolean;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [resetting, setResetting] = useState(false);

  const handleReset = async () => {
    if (newPassword !== confirm) {
      toast({ variant: 'destructive', title: 'Passwords do not match' });
      return;
    }
    if (newPassword.length < 6) {
      toast({ variant: 'destructive', title: 'Password too short', description: 'Must be at least 6 characters.' });
      return;
    }
    setResetting(true);
    try {
      const idToken = await auth?.currentUser?.getIdToken();
      if (!idToken) throw new Error('Not authenticated.');

      const res = await fetch('/api/admin/reset-staff-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`,
        },
        body: JSON.stringify({ uid: staff.uid, newPassword }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (res.status === 503) {
          toast({
            variant: 'destructive',
            title: 'Admin credentials not set up',
            description: 'Add FIREBASE_SERVICE_ACCOUNT_KEY to Secrets to enable direct password reset.',
          });
        } else {
          throw new Error(body.message ?? 'Password reset failed.');
        }
        return;
      }

      toast({ title: 'Password reset', description: `${staff.displayName || staff.email} can now log in with the new password.` });
      setNewPassword('');
      setConfirm('');
      onClose();
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error', description: err.message });
    } finally {
      setResetting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={open => { if (!open) { setNewPassword(''); setConfirm(''); onClose(); } }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Reset Password</DialogTitle>
          <DialogDescription>
            Set a new password for {staff.displayName || staff.email}. Share it with them securely.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>New Password</Label>
            <div className="relative">
              <Input
                type={showPw ? 'text' : 'password'}
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                placeholder="Min 6 characters"
                className="pr-10"
              />
              <button
                type="button"
                className="absolute right-3 top-2.5 text-muted-foreground hover:text-foreground"
                onClick={() => setShowPw(s => !s)}
              >
                {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Confirm Password</Label>
            <Input
              type={showPw ? 'text' : 'password'}
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              placeholder="Repeat the password"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={resetting}>Cancel</Button>
          <Button onClick={handleReset} disabled={resetting || !newPassword || !confirm}>
            {resetting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Reset Password
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Staff card ───────────────────────────────────────────────────────────────

function StaffCard({
  staff,
  onDeactivate,
  onReactivate,
  onRevoke,
  actionLoadingUid,
}: {
  staff: UserProfile;
  onDeactivate: (s: UserProfile) => void;
  onReactivate: (s: UserProfile) => void;
  onRevoke: (s: UserProfile) => void;
  actionLoadingUid: string | null;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const isActive = staff.isActive !== false;
  const isManager = staff.role === 'manager';

  const permBadges: { label: string; active: boolean }[] = isManager ? [] : [
    { label: 'Work', active: staff.canManageWork !== false },
    { label: 'Financial', active: staff.canAccessFinancialServices === true },
    { label: 'Quick Work', active: staff.canAccessQuickWork !== false },
    { label: 'Deleted Items', active: staff.canViewDeletedItems !== false },
    { label: 'Categories', active: staff.canManageCategories === true },
  ];

  return (
    <>
      <div className={`rounded-xl border p-4 transition-colors ${isActive ? 'bg-card' : 'bg-muted/30'}`}>
        {/* Header row */}
        <div className="flex items-start gap-3">
          <div className={`h-10 w-10 rounded-full flex items-center justify-center text-white font-bold text-sm shrink-0 ${isActive ? 'bg-primary' : 'bg-muted-foreground/40'}`}>
            {(staff.displayName || staff.email || 'S')[0].toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-sm">{staff.displayName || '(no name)'}</span>
              {staff.staffId && (
                <span className="text-[10px] font-mono bg-primary/10 text-primary px-2 py-0.5 rounded-full font-semibold">
                  {staff.staffId}
                </span>
              )}
              {isManager ? (
                <Badge variant="outline" className="text-xs border-violet-300 text-violet-700 bg-violet-50">Manager</Badge>
              ) : (
                <Badge variant="outline" className="text-xs">Staff</Badge>
              )}
              {isActive ? (
                <span className="flex items-center gap-1 text-[10px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded-full">
                  <CheckCircle2 className="h-3 w-3" /> Active
                </span>
              ) : (
                <span className="flex items-center gap-1 text-[10px] font-semibold text-rose-700 bg-rose-50 border border-rose-200 px-1.5 py-0.5 rounded-full">
                  <XCircle className="h-3 w-3" /> Deactivated
                </span>
              )}
            </div>
            <div className="mt-1 space-y-0.5">
              <p className="text-xs text-muted-foreground">{staff.email}</p>
              {staff.phone && (
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <Phone className="h-3 w-3" /> {staff.phone}
                </p>
              )}
              {staff.createdAt && (
                <p className="text-xs text-muted-foreground">
                  Added {format(staff.createdAt.toDate(), 'dd MMM yyyy')}
                  {!isActive && staff.deactivatedAt && (
                    <span className="ml-2 text-rose-500">
                      · Deactivated {format(staff.deactivatedAt.toDate(), 'dd MMM yyyy')}
                    </span>
                  )}
                </p>
              )}
            </div>

            {/* Permission badges */}
            {!isManager && (
              <div className="flex flex-wrap gap-1 mt-2">
                {permBadges.map(b => (
                  <span
                    key={b.label}
                    className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${
                      b.active
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        : 'bg-muted text-muted-foreground border-transparent'
                    }`}
                  >
                    {b.active ? '✓' : '✗'} {b.label}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Action row */}
        <div className="flex flex-wrap items-center gap-2 mt-3 pt-3 border-t border-border/50">
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs gap-1"
            onClick={() => setEditOpen(true)}
          >
            <Pencil className="h-3.5 w-3.5" /> Edit
          </Button>

          {isActive ? (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1 text-amber-700 border-amber-300 hover:bg-amber-50"
              onClick={() => onDeactivate(staff)}
              disabled={actionLoadingUid === staff.uid}
            >
              {actionLoadingUid === staff.uid
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <UserX className="h-3.5 w-3.5" />}
              Deactivate
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1 text-emerald-700 border-emerald-300 hover:bg-emerald-50"
              onClick={() => onReactivate(staff)}
              disabled={actionLoadingUid === staff.uid}
            >
              {actionLoadingUid === staff.uid
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <RotateCcw className="h-3.5 w-3.5" />}
              Reactivate
            </Button>
          )}

          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs gap-1"
            onClick={() => setResetOpen(true)}
          >
            <Lock className="h-3.5 w-3.5" /> Reset Password
          </Button>

          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-destructive hover:text-destructive hover:bg-destructive/10 gap-1 ml-auto"
            onClick={() => onRevoke(staff)}
          >
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </Button>

          {/* Work stats (owner-only feature) */}
          <div className="w-full mt-1">
            <StaffWorkStats staff={staff} />
          </div>
        </div>
      </div>

      {editOpen && (
        <EditStaffDialog staff={staff} open={editOpen} onClose={() => setEditOpen(false)} />
      )}
      {resetOpen && (
        <ResetPasswordDialog staff={staff} open={resetOpen} onClose={() => setResetOpen(false)} />
      )}
    </>
  );
}

// ─── Main Settings Page ───────────────────────────────────────────────────────

export default function SettingsPage() {
  const { shopSettings, saveShopSettings, categories, createCategory, removeCategory, reorderCategories } = useSettings();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } }),
  );

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = categories.findIndex(c => c.id === active.id);
    const newIndex = categories.findIndex(c => c.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const reordered = arrayMove(categories, oldIndex, newIndex);
    await reorderCategories(reordered.map(c => c.id));
  };
  const { role, userProfile, canManageCategories } = useAuth();
  const isOwner = role === 'owner';

  const [isSavingInfo, setIsSavingInfo] = useState(false);
  const [shopName, setShopName] = useState(shopSettings.shopName);
  const [address, setAddress] = useState(shopSettings.address);
  const [phone, setPhone] = useState(shopSettings.phone);
  const [newCat, setNewCat] = useState('');
  const [isAddingCat, setIsAddingCat] = useState(false);
  const { toast } = useToast();

  // Staff state
  const [staffList, setStaffList] = useState<UserProfile[]>([]);
  const [staffLoading, setStaffLoading] = useState(true);
  const [actionLoadingUid, setActionLoadingUid] = useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<UserProfile | null>(null);
  const [isRevoking, setIsRevoking] = useState(false);
  const [lastCreated, setLastCreated] = useState<{ email: string; name: string; staffId?: string } | null>(null);

  // New staff form state
  const [staffName, setStaffName] = useState('');
  const [staffEmail, setStaffEmail] = useState('');
  const [staffPhone, setStaffPhone] = useState('');
  const [staffPassword, setStaffPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isCreatingStaff, setIsCreatingStaff] = useState(false);
  const [newStaffRole, setNewStaffRole] = useState<'manager' | 'staff'>('staff');
  const [newStaffPerms, setNewStaffPerms] = useState<PermToggles>({
    canManageWork: true,
    canAccessFinancialServices: false,
    canAccessQuickWork: false,
    canViewDeletedItems: false,
    canManageCategories: false,
  });

  useEffect(() => {
    if (!isOwner) { setStaffLoading(false); return; }
    // Run backfill once on load — no-op if all staff already have staffIds
    backfillStaffIds().catch(console.error);
    const unsub = subscribeToStaff(list => {
      setStaffList(list);
      setStaffLoading(false);
    });
    return () => unsub();
  }, [isOwner]);

  const handleSaveInfo = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingInfo(true);
    try {
      await saveShopSettings({ shopName, address, phone });
      toast({ title: 'Settings saved' });
    } finally {
      setIsSavingInfo(false);
    }
  };

  const handleAddCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCat.trim()) return;
    setIsAddingCat(true);
    try {
      await createCategory(newCat.trim());
      setNewCat('');
      toast({ title: 'Category added' });
    } finally {
      setIsAddingCat(false);
    }
  };

  const handleCreateStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!staffName.trim() || !staffEmail.trim() || !staffPassword.trim()) return;
    setIsCreatingStaff(true);
    try {
      // Build permissions object for staff role
      const perms: StaffPermissions = newStaffRole === 'staff' ? {
        canManageWork: newStaffPerms.canManageWork,
        canAccessFinancialServices: newStaffPerms.canAccessFinancialServices,
        canAccessQuickWork: newStaffPerms.canAccessQuickWork,
        canViewDeletedItems: newStaffPerms.canViewDeletedItems,
        canManageCategories: newStaffPerms.canManageCategories,
      } : {};

      await createStaffAccount(
        staffName.trim(),
        staffEmail.trim(),
        staffPassword,
        userProfile?.email ?? '',
        perms,
        staffPhone.trim() || undefined,
        newStaffRole,
      );

      // Find the newly created member to show their staffId
      // (subscriberToStaff will update the list; we grab it from there shortly)
      setLastCreated({ email: staffEmail.trim(), name: staffName.trim() });
      setStaffName('');
      setStaffEmail('');
      setStaffPhone('');
      setStaffPassword('');
      setNewStaffRole('staff');
      setNewStaffPerms({ canManageWork: true, canAccessFinancialServices: false, canAccessQuickWork: false, canViewDeletedItems: false, canManageCategories: false });
      toast({ title: `${newStaffRole === 'manager' ? 'Manager' : 'Staff'} account created`, description: `${staffName.trim()} can now log in.` });
    } catch (err: any) {
      const msg = err.code === 'auth/email-already-in-use'
        ? 'That email already has a Firebase account.'
        : err.message;
      toast({ variant: 'destructive', title: 'Error creating account', description: msg });
    } finally {
      setIsCreatingStaff(false);
    }
  };

  const handleDeactivate = useCallback(async (staff: UserProfile) => {
    if (!staff.uid) return;
    setActionLoadingUid(staff.uid);
    try {
      await deactivateStaff(staff.uid);
      toast({ title: 'Account deactivated', description: `${staff.displayName || staff.email} can no longer log in.` });
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error', description: err.message });
    } finally {
      setActionLoadingUid(null);
    }
  }, [toast]);

  const handleReactivate = useCallback(async (staff: UserProfile) => {
    if (!staff.uid) return;
    setActionLoadingUid(staff.uid);
    try {
      await reactivateStaff(staff.uid);
      toast({ title: 'Account reactivated', description: `${staff.displayName || staff.email} can log in again.` });
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error', description: err.message });
    } finally {
      setActionLoadingUid(null);
    }
  }, [toast]);

  const handleRevokeConfirm = async () => {
    if (!revokeTarget?.uid) return;
    setIsRevoking(true);
    try {
      await revokeStaffAccess(revokeTarget.uid);
      toast({ title: 'Account deleted', description: `${revokeTarget.displayName || revokeTarget.email}'s profile has been permanently removed.` });
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error', description: err.message });
    } finally {
      setIsRevoking(false);
      setRevokeTarget(null);
    }
  };

  const inp = "h-10 bg-background border-border";

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-muted-foreground text-sm mt-1">Manage shop information, categories, staff and system</p>
      </div>

      <Tabs defaultValue="shop" className="w-full">
        <TabsList className={`w-full sm:w-auto grid ${isOwner ? 'grid-cols-4' : 'grid-cols-3'} sm:flex`}>
          <TabsTrigger value="shop">Shop Info</TabsTrigger>
          <TabsTrigger value="categories">Categories</TabsTrigger>
          <TabsTrigger value="staff" className="flex items-center gap-1.5">
            <Users className="h-3.5 w-3.5" /> Staff
          </TabsTrigger>
          {isOwner && (
            <TabsTrigger value="firebase" className="flex items-center gap-1.5">
              <Database className="h-3.5 w-3.5" /> Firebase
            </TabsTrigger>
          )}
        </TabsList>

        {/* Shop Info */}
        <TabsContent value="shop" className="mt-5">
          <Card>
            <CardHeader className="pb-4">
              <CardTitle className="text-base">Shop Information</CardTitle>
              <CardDescription>This name appears on the portal and sidebar.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSaveInfo} className="space-y-4">
                <div className="space-y-2">
                  <Label>Shop Name</Label>
                  <Input className={inp} value={shopName} onChange={e => setShopName(e.target.value)} required />
                </div>
                <div className="space-y-2">
                  <Label>Address</Label>
                  <Input className={inp} value={address} onChange={e => setAddress(e.target.value)} placeholder="Optional" />
                </div>
                <div className="space-y-2">
                  <Label>Contact Phone</Label>
                  <Input className={inp} value={phone} onChange={e => setPhone(e.target.value)} placeholder="Optional" />
                </div>
                <Button type="submit" disabled={isSavingInfo} className="mt-2">
                  {isSavingInfo && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Save Changes
                </Button>
              </form>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Categories */}
        <TabsContent value="categories" className="mt-5">
          <Card>
            <CardHeader className="pb-4">
              <CardTitle className="text-base">Work Categories</CardTitle>
              <CardDescription>Manage the options in the "Work Category" dropdown.</CardDescription>
            </CardHeader>
            <CardContent>
              {canManageCategories ? (
                <>
                  <form onSubmit={handleAddCategory} className="flex gap-2 mb-5">
                    <Input className={`${inp} flex-1 max-w-sm`} placeholder="New category name..."
                      value={newCat} onChange={e => setNewCat(e.target.value)} />
                    <Button type="submit" disabled={isAddingCat || !newCat.trim()} className="gap-1.5">
                      {isAddingCat ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                      Add
                    </Button>
                  </form>
                  <div className="border rounded-xl overflow-hidden divide-y">
                    {categories.length === 0 ? (
                      <div className="p-6 text-center text-muted-foreground text-sm">No categories found</div>
                    ) : (
                      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                        <SortableContext items={categories.map(c => c.id)} strategy={verticalListSortingStrategy}>
                          {categories.map(cat => (
                            <SortableCategoryRow key={cat.id} cat={cat} onRemove={() => removeCategory(cat.id)} />
                          ))}
                        </SortableContext>
                      </DndContext>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-3">{categories.length} categories · drag to reorder</p>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-3 text-muted-foreground mb-5">
                    <ShieldCheck className="h-5 w-5 shrink-0" />
                    <p className="text-sm">You can view categories but don't have permission to add, delete, or reorder them. Ask the Owner to grant you "Manage Categories" access.</p>
                  </div>
                  <div className="border rounded-xl overflow-hidden divide-y">
                    {categories.length === 0 ? (
                      <div className="p-6 text-center text-muted-foreground text-sm">No categories found</div>
                    ) : categories.map(cat => (
                      <div key={cat.id} className="flex items-center px-4 py-3 text-sm">{cat.name}</div>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground mt-3">{categories.length} categories</p>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Staff */}
        <TabsContent value="staff" className="mt-5 space-y-5">
          {!isOwner ? (
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3 text-muted-foreground">
                  <ShieldCheck className="h-5 w-5 shrink-0" />
                  <p className="text-sm">Staff management is only accessible to the Owner.</p>
                </div>
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Add new staff form */}
              <Card>
                <CardHeader className="pb-4">
                  <CardTitle className="text-base flex items-center gap-2">
                    <UserPlus className="h-4 w-4" /> Add Team Member
                  </CardTitle>
                  <CardDescription>
                    Create a new staff or manager account. A unique Staff ID is generated automatically.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleCreateStaff} className="space-y-4">
                    <div className="grid sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Full Name <span className="text-destructive">*</span></Label>
                        <Input className={inp} placeholder="Member's name"
                          value={staffName} onChange={e => setStaffName(e.target.value)} required />
                      </div>
                      <div className="space-y-2">
                        <Label>Email Address <span className="text-destructive">*</span></Label>
                        <Input className={inp} type="email" placeholder="user@example.com"
                          value={staffEmail} onChange={e => setStaffEmail(e.target.value)} required />
                      </div>
                    </div>

                    <div className="grid sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Phone <span className="text-muted-foreground text-xs">(optional)</span></Label>
                        <Input className={inp} type="tel" placeholder="Mobile number"
                          value={staffPhone} onChange={e => setStaffPhone(e.target.value)} />
                      </div>
                      <div className="space-y-2">
                        <Label>Password <span className="text-destructive">*</span></Label>
                        <div className="relative">
                          <Input
                            className={`${inp} pr-10`}
                            type={showPassword ? 'text' : 'password'}
                            placeholder="Create a password (min 6 chars)"
                            value={staffPassword}
                            onChange={e => setStaffPassword(e.target.value)}
                            required minLength={6}
                          />
                          <button
                            type="button"
                            className="absolute right-3 top-2.5 text-muted-foreground hover:text-foreground"
                            onClick={() => setShowPassword(s => !s)}
                            tabIndex={-1}
                          >
                            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </button>
                        </div>
                        <p className="text-xs text-muted-foreground">Share this password with them verbally.</p>
                      </div>
                    </div>

                    {/* Role selection */}
                    <div className="space-y-2">
                      <Label>Role</Label>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => setNewStaffRole('staff')}
                          className={`p-3 rounded-lg border-2 text-left transition-colors ${
                            newStaffRole === 'staff' ? 'border-primary bg-primary/5' : 'border-border hover:border-muted-foreground/40'
                          }`}
                        >
                          <div className="font-semibold text-sm">Staff</div>
                          <p className="text-xs text-muted-foreground mt-0.5">Set individual permissions below.</p>
                        </button>
                        <button
                          type="button"
                          onClick={() => setNewStaffRole('manager')}
                          className={`p-3 rounded-lg border-2 text-left transition-colors ${
                            newStaffRole === 'manager' ? 'border-violet-500 bg-violet-50' : 'border-border hover:border-muted-foreground/40'
                          }`}
                        >
                          <div className="font-semibold text-sm text-violet-700">Manager</div>
                          <p className="text-xs text-muted-foreground mt-0.5">Full access to all features.</p>
                        </button>
                      </div>
                    </div>

                    {/* Granular permissions (staff only) */}
                    {newStaffRole === 'staff' && (
                      <div className="space-y-2">
                        <Label>Permissions</Label>
                        <div className="space-y-2">
                          <PermissionToggle
                            id="new-manage-work"
                            label="Manage Work Entries"
                            description="Add and edit CSC service entries (Aadhar, PAN, certificates, etc.)"
                            checked={newStaffPerms.canManageWork}
                            onChange={v => setNewStaffPerms(p => ({ ...p, canManageWork: v }))}
                          />
                          <PermissionToggle
                            id="new-financial"
                            label="AEPS, Recharge &amp; Money Transfer"
                            description="Access financial service modules"
                            checked={newStaffPerms.canAccessFinancialServices}
                            onChange={v => setNewStaffPerms(p => ({ ...p, canAccessFinancialServices: v }))}
                          />
                          <PermissionToggle
                            id="new-quick-work"
                            label="Quick Action Work"
                            description="Printout, Lamination, Xerox, and other quick services"
                            checked={newStaffPerms.canAccessQuickWork}
                            onChange={v => setNewStaffPerms(p => ({ ...p, canAccessQuickWork: v }))}
                          />
                          <PermissionToggle
                            id="new-deleted"
                            label="View Deleted Items"
                            description="Access the recycle bin and restore deleted entries"
                            checked={newStaffPerms.canViewDeletedItems}
                            onChange={v => setNewStaffPerms(p => ({ ...p, canViewDeletedItems: v }))}
                          />
                          <PermissionToggle
                            id="new-manage-categories"
                            label="Manage Categories"
                            description="Add, delete, and reorder work categories"
                            checked={newStaffPerms.canManageCategories}
                            onChange={v => setNewStaffPerms(p => ({ ...p, canManageCategories: v }))}
                          />
                        </div>
                      </div>
                    )}

                    {newStaffRole === 'manager' && (
                      <div className="p-3 rounded-lg border bg-violet-50 border-violet-200 text-sm text-violet-800">
                        Managers automatically have full access to all features including reports, financial services, and quick work.
                      </div>
                    )}

                    <Button
                      type="submit"
                      disabled={isCreatingStaff || !staffName.trim() || !staffEmail.trim() || !staffPassword.trim()}
                    >
                      {isCreatingStaff
                        ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Creating…</>
                        : <><UserPlus className="mr-2 h-4 w-4" />Create {newStaffRole === 'manager' ? 'Manager' : 'Staff'} Account</>}
                    </Button>
                  </form>

                  {lastCreated && (
                    <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-lg text-green-800 text-sm">
                      <p className="font-semibold mb-1">✓ Account created for {lastCreated.name}</p>
                      <p>Login email: <span className="font-mono">{lastCreated.email}</span></p>
                      <p className="mt-1 text-green-700 text-xs">A Staff ID has been generated automatically. Remember to share the password securely.</p>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Staff list */}
              <Card>
                <CardHeader className="pb-4">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Users className="h-4 w-4" /> Team Members
                    {staffList.length > 0 && (
                      <Badge variant="secondary" className="ml-auto">{staffList.length}</Badge>
                    )}
                  </CardTitle>
                  <CardDescription>
                    Active and deactivated staff members. Deactivated accounts keep their history but cannot log in.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {staffLoading ? (
                    <div className="flex items-center gap-2 text-muted-foreground text-sm py-4">
                      <Loader2 className="h-4 w-4 animate-spin" /> Loading team…
                    </div>
                  ) : staffList.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <Users className="h-8 w-8 mx-auto mb-2 opacity-20" />
                      <p className="text-sm">No team members yet. Add your first staff member above.</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {staffList.map(staff => (
                        <StaffCard
                          key={staff.uid}
                          staff={staff}
                          onDeactivate={handleDeactivate}
                          onReactivate={handleReactivate}
                          onRevoke={setRevokeTarget}
                          actionLoadingUid={actionLoadingUid}
                        />
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        {/* Firebase Control — owner only */}
        {isOwner && (
          <TabsContent value="firebase" className="mt-5">
            <FirebaseControlTab />
          </TabsContent>
        )}
      </Tabs>

      {/* Delete confirmation dialog */}
      <AlertDialog open={!!revokeTarget} onOpenChange={open => !open && setRevokeTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Permanently delete {revokeTarget?.displayName || revokeTarget?.email}?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes their Firestore profile. They will be immediately signed out and cannot log in again.
              Their past work entries (added by them) will remain in the system.
              <br /><br />
              <strong>Tip:</strong> Consider <em>Deactivating</em> instead — it blocks login while preserving the full account record.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isRevoking}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRevokeConfirm}
              disabled={isRevoking}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isRevoking ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Delete Account
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
