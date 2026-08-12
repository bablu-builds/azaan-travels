import {
  collection, doc, getDoc, getDocs, setDoc, query, orderBy, where, limit,
  onSnapshot, addDoc, updateDoc, deleteDoc, writeBatch, Timestamp, arrayUnion,
  runTransaction,
} from 'firebase/firestore';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword, signOut as firebaseSignOut } from 'firebase/auth';
import { db, firebaseConfig } from '@/lib/firebase';
import { PaymentMode, PaymentStatus, SettlementMode, deriveStatus } from '@/lib/payments';

// ─── USER PROFILES ───────────────────────────────────────────────────────────

export interface UserProfile {
  uid?: string;
  email: string;
  displayName?: string;
  role: 'owner' | 'manager' | 'staff';
  createdAt: Timestamp;
  invitedBy?: string;

  // Staff identity
  staffId?: string;   // e.g. "STAFF001" — auto-generated, unique
  phone?: string;     // optional mobile number

  // Account status
  isActive?: boolean;       // false = deactivated; undefined/missing = active
  deactivatedAt?: Timestamp;

  // Granular permissions (owner + manager always have all)
  canManageWork?: boolean;              // Add/edit CSC work entries (default true for backward compat)
  canAccessFinancialServices?: boolean; // AEPS, Recharge, Money Transfer (default false)
  canAccessQuickWork?: boolean;         // Quick Action Work (default true for backward compat)
  canViewDeletedItems?: boolean;        // View/restore recycle bin (default true for backward compat)
  canManageCategories?: boolean;        // Add/delete/reorder categories (default false)
}

/** Fetch a user's profile document. Returns null if not found. */
export const getUserProfile = async (uid: string): Promise<UserProfile | null> => {
  if (!db) return null;
  const snap = await getDoc(doc(db, 'users', uid));
  if (!snap.exists()) return null;
  return { uid: snap.id, ...snap.data() } as UserProfile;
};

/**
 * Subscribe to a user's profile document with a real-time listener.
 * Calls `callback` immediately with the current value, then on every change.
 * Calls `callback(null)` if the document does not exist.
 */
export const subscribeToUserProfile = (
  uid: string,
  callback: (profile: UserProfile | null) => void,
): () => void => {
  if (!db) {
    callback(null);
    return () => {};
  }
  return onSnapshot(
    doc(db, 'users', uid),
    (snap) => {
      if (snap.exists()) {
        callback({ uid: snap.id, ...snap.data() } as UserProfile);
      } else {
        callback(null);
      }
    },
    (err) => {
      console.error('[Firestore] User profile listener error:', err.code, err.message);
      callback(null);
    },
  );
};

/**
 * Called when a logged-in user has no `users/{uid}` document yet.
 * If no user docs exist at all → create this user as owner (first-time setup).
 * If user docs exist but this user isn't one of them → unauthorised (caller should sign out).
 */
export const bootstrapUserProfile = async (
  uid: string,
  email: string,
  displayName?: string,
): Promise<UserProfile | null> => {
  if (!db) return null;
  const usersSnap = await getDocs(query(collection(db, 'users'), limit(1)));
  if (!usersSnap.empty) return null; // Users exist — this account has no profile
  const profile: UserProfile = {
    email,
    displayName: displayName || email.split('@')[0],
    role: 'owner',
    createdAt: Timestamp.now(),
    isActive: true,
  };
  await setDoc(doc(db, 'users', uid), profile);
  return { uid, ...profile };
};

/** Subscribe to all non-owner members (role = 'staff' or 'manager'). */
export const subscribeToStaff = (callback: (staff: UserProfile[]) => void) => {
  if (!db) return () => {};
  const q = query(collection(db, 'users'), where('role', 'in', ['staff', 'manager']));
  return onSnapshot(q, (snap) => {
    const staff: UserProfile[] = [];
    snap.forEach(d => staff.push({ uid: d.id, ...d.data() } as UserProfile));
    staff.sort((a, b) => (a.createdAt?.toMillis() ?? 0) - (b.createdAt?.toMillis() ?? 0));
    callback(staff);
  }, (err) => {
    console.error('[Firestore] Staff listener error:', err.code, err.message);
    callback([]);
  });
};

/**
 * Generate the next available staff ID (e.g. "STAFF003").
 * Reads all user docs, finds the highest existing STAFF number, increments.
 */
export const generateNextStaffId = async (): Promise<string> => {
  if (!db) return 'STAFF001';
  const snap = await getDocs(collection(db, 'users'));
  let maxNum = 0;
  snap.forEach(d => {
    const data = d.data();
    if (data.staffId && typeof data.staffId === 'string') {
      const match = (data.staffId as string).match(/^STAFF(\d+)$/);
      if (match) {
        const n = parseInt(match[1], 10);
        if (n > maxNum) maxNum = n;
      }
    }
  });
  return `STAFF${String(maxNum + 1).padStart(3, '0')}`;
};

export interface StaffPermissions {
  canManageWork?: boolean;
  canAccessFinancialServices?: boolean;
  canAccessQuickWork?: boolean;
  canViewDeletedItems?: boolean;
  canManageCategories?: boolean;
}

/**
 * Create a staff/manager Firebase Auth account + Firestore profile without interrupting the owner's session.
 * Uses a secondary (temporary) Firebase app instance so the owner stays signed in.
 */
export const createStaffAccount = async (
  name: string,
  email: string,
  password: string,
  ownerEmail: string,
  permissions: StaffPermissions = {},
  phone?: string,
  role: 'manager' | 'staff' = 'staff',
): Promise<void> => {
  if (!db) throw new Error('Firebase not configured');
  const staffId = await generateNextStaffId();
  const tempAppName = `staff-creation-${Date.now()}`;
  const secondaryApp = initializeApp(firebaseConfig, tempAppName);
  const secondaryAuth = getAuth(secondaryApp);
  try {
    const cred = await createUserWithEmailAndPassword(secondaryAuth, email, password);
    const isManager = role === 'manager';
    const profileData: Record<string, unknown> = {
      email,
      displayName: name,
      role,
      staffId,
      createdAt: Timestamp.now(),
      invitedBy: ownerEmail,
      isActive: true,
      // Permissions — managers get everything; staff use supplied values
      canManageWork: isManager ? true : (permissions.canManageWork ?? true),
      canAccessFinancialServices: isManager ? true : (permissions.canAccessFinancialServices ?? false),
      canAccessQuickWork: isManager ? true : (permissions.canAccessQuickWork ?? false),
      canViewDeletedItems: isManager ? true : (permissions.canViewDeletedItems ?? false),
      canManageCategories: isManager ? true : (permissions.canManageCategories ?? false),
    };
    if (phone && phone.trim()) profileData.phone = phone.trim();
    await setDoc(doc(db, 'users', cred.user.uid), profileData);
  } finally {
    await firebaseSignOut(secondaryAuth).catch(() => {});
    await deleteApp(secondaryApp).catch(() => {});
  }
};

/** Update editable staff fields (name, phone, permissions). */
export const updateStaffProfile = async (
  uid: string,
  data: {
    displayName?: string;
    phone?: string;
    canManageWork?: boolean;
    canAccessFinancialServices?: boolean;
    canAccessQuickWork?: boolean;
    canViewDeletedItems?: boolean;
    canManageCategories?: boolean;
  },
): Promise<void> => {
  if (!db) throw new Error('Firebase not configured');
  const updates: Record<string, unknown> = {};
  if (data.displayName !== undefined) updates.displayName = data.displayName;
  if (data.phone !== undefined) updates.phone = data.phone;
  if (data.canManageWork !== undefined) updates.canManageWork = data.canManageWork;
  if (data.canAccessFinancialServices !== undefined) updates.canAccessFinancialServices = data.canAccessFinancialServices;
  if (data.canAccessQuickWork !== undefined) updates.canAccessQuickWork = data.canAccessQuickWork;
  if (data.canViewDeletedItems !== undefined) updates.canViewDeletedItems = data.canViewDeletedItems;
  if (data.canManageCategories !== undefined) updates.canManageCategories = data.canManageCategories;
  await updateDoc(doc(db, 'users', uid), updates);
};

/** Deactivate a staff member — keeps Firestore doc + historical data intact, blocks login. */
export const deactivateStaff = async (uid: string): Promise<void> => {
  if (!db) throw new Error('Firebase not configured');
  await updateDoc(doc(db, 'users', uid), { isActive: false, deactivatedAt: Timestamp.now() });
};

/** Reactivate a previously deactivated staff member. */
export const reactivateStaff = async (uid: string): Promise<void> => {
  if (!db) throw new Error('Firebase not configured');
  await updateDoc(doc(db, 'users', uid), { isActive: true, deactivatedAt: null });
};

/**
 * One-time backfill: generate staffIds for any staff/manager docs that don't have one yet.
 * Safe to call multiple times — skips docs that already have a staffId.
 */
export const backfillStaffIds = async (): Promise<void> => {
  if (!db) return;
  const snap = await getDocs(collection(db, 'users'));
  let maxNum = 0;
  const docsNeedingId: string[] = [];

  snap.forEach(d => {
    const data = d.data();
    if (data.staffId && typeof data.staffId === 'string') {
      const match = (data.staffId as string).match(/^STAFF(\d+)$/);
      if (match) maxNum = Math.max(maxNum, parseInt(match[1], 10));
    } else if (data.role !== 'owner') {
      docsNeedingId.push(d.id);
    }
  });

  if (docsNeedingId.length === 0) return;

  const batch = writeBatch(db);
  docsNeedingId.forEach(id => {
    maxNum++;
    batch.update(doc(db!, 'users', id), {
      staffId: `STAFF${String(maxNum).padStart(3, '0')}`,
    });
  });
  await batch.commit();
};

/** Get work entry counts for a staff member (by their display name and email). */
export const getStaffWorkStats = async (
  displayName: string,
  email: string,
): Promise<{ total: number; pending: number; completed: number }> => {
  if (!db) return { total: 0, pending: 0, completed: 0 };
  const identifiers = [...new Set([displayName, email].filter(Boolean))];
  const seenIds = new Set<string>();
  const entries: Array<{ id: string; status: string; isDeleted?: boolean }> = [];

  await Promise.all(identifiers.map(async (identifier) => {
    const q = query(collection(db!, 'workEntries'), where('addedBy', '==', identifier));
    const snap = await getDocs(q);
    snap.forEach(d => {
      if (!seenIds.has(d.id)) {
        seenIds.add(d.id);
        const data = d.data();
        if (!data.isDeleted) entries.push({ id: d.id, status: data.status, isDeleted: data.isDeleted });
      }
    });
  }));

  return {
    total: entries.length,
    pending: entries.filter(e => e.status === 'Pending').length,
    completed: entries.filter(e => e.status === 'Completed').length,
  };
};

/** Update a staff/manager member's role. Only owner may call this. */
export const updateStaffRole = async (uid: string, role: 'manager' | 'staff'): Promise<void> => {
  if (!db) throw new Error('Firebase not configured');
  await updateDoc(doc(db, 'users', uid), { role });
};

/** Toggle whether a staff member can access financial service modules. */
export const updateStaffPermissions = async (uid: string, canAccessFinancialServices: boolean): Promise<void> => {
  if (!db) throw new Error('Firebase not configured');
  await updateDoc(doc(db, 'users', uid), { canAccessFinancialServices });
};

/** Permanently revoke a staff member's access by removing their Firestore profile. */
export const revokeStaffAccess = async (uid: string): Promise<void> => {
  if (!db) throw new Error('Firebase not configured');
  await deleteDoc(doc(db, 'users', uid));
};

// ─── WORK ENTRIES ────────────────────────────────────────────────────────────

export interface PaymentRecord {
  amount: number;
  paidAt?: Timestamp;
  addedBy?: string;
  /** How the payment was received. Defaults to 'Cash' for backward compatibility. */
  paymentMode?: SettlementMode;
}

/** A single uploaded document or receiving slip attached to a work entry. */
export interface AttachedFile {
  name: string;
  fileUrl: string;
  downloadUrl: string;
  uploadedAt: Timestamp;
  addedBy?: string;
}

export interface WorkEntry {
  id?: string;
  /** Human-readable display number; Firestore auto-ID remains the primary key. */
  entryNumber?: string;
  customerName: string;
  mobile: string;
  category: string;
  workDetail?: string;
  date: Timestamp;
  totalAmount: number;
  paidAmount: number;
  dueAmount: number;
  challanAmount?: number;
  payments?: PaymentRecord[];
  status: 'Pending' | 'Completed' | 'Rejected';
  address?: string;
  createdAt: Timestamp;
  completedAt?: Timestamp;
  rejectedAt?: Timestamp;
  rejectionReason?: string;
  refundAmount?: number;
  isDeleted?: boolean;
  deletedAt?: Timestamp;
  addedBy?: string;
  /** When category === 'Other', stores the custom category text entered by the user. */
  otherCategory?: string;
  /** Entry-level initial payment intent. Does NOT affect paidAmount/dueAmount/payments[] logic. */
  paymentMode?: PaymentMode;
  /**
   * Denormalized running sum of all adjustment.amountChange values.
   * Updated atomically by addAdjustment(). NEVER modify directly.
   * finalTotal = totalAmount + netAdjustmentAmount
   */
  netAdjustmentAmount?: number;
  /**
   * Denormalized running sum of all adjustment.challanChange values.
   * Updated atomically by addAdjustment(). NEVER modify directly.
   */
  netAdjustmentChallan?: number;
  /** Customer documents (Aadhar, photos, etc.) uploaded via Cloudinary. */
  documents?: AttachedFile[];
  /** Receiving slips uploaded via Cloudinary. */
  receivings?: AttachedFile[];
}

// ─── DEAL ADJUSTMENTS ────────────────────────────────────────────────────────

export interface DealAdjustment {
  id?: string;
  /** Foreign key to workEntries/{id} */
  entryId: string;
  /** Change to totalAmount — positive = increase, negative = decrease */
  amountChange: number;
  /** Change to challanAmount — positive = increase, negative = decrease */
  challanChange: number;
  /** Required human-readable reason for the change */
  reason: string;
  recordedBy: string;
  createdAt: Timestamp;
}

/**
 * Record a deal adjustment and keep the parent WorkEntry's denormalized
 * fields (netAdjustmentAmount, netAdjustmentChallan, dueAmount) in sync.
 */
export const addAdjustment = async (
  entryId: string,
  data: { amountChange: number; challanChange: number; reason: string; recordedBy: string },
  currentEntry: { totalAmount: number; paidAmount: number; netAdjustmentAmount?: number; netAdjustmentChallan?: number },
): Promise<void> => {
  if (!db) throw new Error('Firebase not configured');
  const parent = await getDoc(doc(db, 'workEntries', entryId));
  if (!parent.exists()) throw new Error('Cannot add adjustment: work entry does not exist');
  const now = Timestamp.now();

  await addDoc(collection(db, 'workAdjustments'), {
    entryId,
    amountChange: data.amountChange,
    challanChange: data.challanChange,
    reason: data.reason,
    recordedBy: data.recordedBy,
    createdAt: now,
  });

  const newNetAmount = (currentEntry.netAdjustmentAmount ?? 0) + data.amountChange;
  const newNetChallan = (currentEntry.netAdjustmentChallan ?? 0) + data.challanChange;
  const finalTotal = currentEntry.totalAmount + newNetAmount;
  const newDueAmount = finalTotal - currentEntry.paidAmount;

  await updateDoc(doc(db, 'workEntries', entryId), {
    netAdjustmentAmount: newNetAmount,
    netAdjustmentChallan: newNetChallan,
    dueAmount: newDueAmount,
  });
};

/** Subscribe to all adjustments for a given work entry, oldest-first. */
export const subscribeToAdjustments = (
  entryId: string,
  callback: (adjustments: DealAdjustment[]) => void,
) => {
  if (!db) return () => {};
  const q = query(
    collection(db, 'workAdjustments'),
    where('entryId', '==', entryId),
    orderBy('createdAt', 'asc'),
  );
  return onSnapshot(q, (snap) => {
    const list: DealAdjustment[] = [];
    snap.forEach(d => list.push({ id: d.id, ...d.data() } as DealAdjustment));
    callback(list);
  }, (err) => console.error('[Firestore] workAdjustments error:', err.message));
};

export interface Category {
  id: string;
  name: string;
  order?: number;
}

export interface ShopSettings {
  shopName: string;
  address: string;
  phone: string;
}

export const defaultCategories = [
  "PAN Card", "Aadhar Card", "Voter ID Card", "Driving Licence (DL)", "Ration Card",
  "Jati Praman Patra", "Aay Praman Patra", "Niwas Praman Patra",
  "Bijli Bill Payment", "Pani Bill Payment", "Bank Related Work", "Insurance",
  "Railway/Bus Ticket Booking", "Photocopy / Print / Photo", "Other"
];

/** Remove keys whose value is undefined — Firestore rejects undefined values. */
function stripUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined)
  ) as Partial<T>;
}

const TRANSACTION_PREFIX: Record<TransactionType, string> = {
  aeps: 'AEPS',
  recharge: 'RCG',
  transfer: 'TRF',
  flight: 'FLT',
  quickWork: 'QW',
};

const counterKeyFor = (kind: 'work' | TransactionType, year: number) =>
  kind === 'work' ? `workEntries_${year}` : `${kind}_${year}`;

/** Atomically reserves the next display number in config/counters. */
async function allocateEntryNumber(kind: 'work' | TransactionType): Promise<string> {
  if (!db) throw new Error('Firebase not configured');
  const year = new Date().getFullYear();
  const counterRef = doc(db, 'config', 'counters');
  const key = counterKeyFor(kind, year);
  const next = await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(counterRef);
    const current = Number(snapshot.exists() ? snapshot.data()?.[key] ?? 0 : 0);
    const value = current + 1;
    transaction.set(counterRef, { [key]: value }, { merge: true });
    return value;
  });
  const prefix = kind === 'work' ? 'WRK' : TRANSACTION_PREFIX[kind];
  return `${prefix}-${year}-${String(next).padStart(5, '0')}`;
}

export const createWorkEntry = async (
  data: Omit<WorkEntry, 'id' | 'entryNumber' | 'dueAmount' | 'createdAt' | 'completedAt' | 'rejectedAt'>,
) => {
  if (!db) throw new Error("Firebase not configured");
  const now = Timestamp.now();
  const entryNumber = await allocateEntryNumber('work');
  const dueAmount = data.status === 'Rejected' ? 0 : data.totalAmount - data.paidAmount;
  const timestamps: Partial<WorkEntry> = { createdAt: now };
  if (data.status === 'Completed') timestamps.completedAt = now;
  if (data.status === 'Rejected') timestamps.rejectedAt = now;

  const { rejectionReason, refundAmount, ...rest } = data;
  const rejectionFields = data.status === 'Rejected'
    ? stripUndefined({ rejectionReason, refundAmount } as Record<string, unknown>)
    : {};

  const mode = data.paymentMode ?? 'Cash';
  const initialPayments: PaymentRecord[] = (data.paidAmount > 0 && (mode === 'Cash' || mode === 'Online'))
    ? [{ amount: data.paidAmount, paidAt: now, addedBy: data.addedBy ?? 'Unknown', paymentMode: mode as SettlementMode }]
    : [];

  return addDoc(collection(db, 'workEntries'), {
    ...rest,
    entryNumber,
    ...timestamps,
    dueAmount,
    ...rejectionFields,
    payments: initialPayments,
  });
};

export const updateWorkEntry = async (
  id: string,
  data: Partial<Omit<WorkEntry, 'id' | 'entryNumber' | 'dueAmount' | 'createdAt' | 'completedAt' | 'rejectedAt'>>,
  currentPaidAmount?: number
) => {
  if (!db) throw new Error("Firebase not configured");

  const { rejectionReason, refundAmount, ...rest } = data;
  const rejectionFields = data.status === 'Rejected'
    ? stripUndefined({ rejectionReason, refundAmount } as Record<string, unknown>)
    : {};

  const updates: Record<string, unknown> = { ...stripUndefined(rest as Record<string, unknown>), ...rejectionFields };

  const effectivePaidAmount = data.paidAmount ?? currentPaidAmount;

  if (data.status === 'Rejected') {
    updates.rejectedAt = Timestamp.now();
    updates.dueAmount = 0;
  } else if (data.status === 'Completed') {
    updates.completedAt = Timestamp.now();
    if (data.totalAmount !== undefined && effectivePaidAmount !== undefined) {
      updates.dueAmount = data.totalAmount - effectivePaidAmount;
    }
  } else {
    if (data.totalAmount !== undefined && effectivePaidAmount !== undefined) {
      updates.dueAmount = data.totalAmount - effectivePaidAmount;
    }
  }

  return updateDoc(doc(db, 'workEntries', id), updates);
};

/** Soft-delete: marks the entry as deleted instead of removing it from Firestore. */
export const deleteWorkEntry = async (id: string) => {
  if (!db) throw new Error("Firebase not configured");
  return updateDoc(doc(db, 'workEntries', id), { isDeleted: true, deletedAt: Timestamp.now() });
};

/** Restore a soft-deleted entry back to the active list. */
export const restoreWorkEntry = async (id: string) => {
  if (!db) throw new Error("Firebase not configured");
  return updateDoc(doc(db, 'workEntries', id), { isDeleted: false, deletedAt: null });
};

/**
 * Record an additional payment against a work entry.
 */
export const addPaymentToEntry = async (
  id: string,
  payment: { amount: number; addedBy?: string; paymentMode?: SettlementMode },
  totalAmount: number,
  currentPaidAmount: number
): Promise<void> => {
  if (!db) throw new Error("Firebase not configured");
  const newPaidAmount = currentPaidAmount + payment.amount;
  const newDueAmount = totalAmount - newPaidAmount;
  const paymentRecord: PaymentRecord = {
    amount: payment.amount,
    paidAt: Timestamp.now(),
    addedBy: payment.addedBy,
    paymentMode: payment.paymentMode ?? 'Cash',
  };
  await updateDoc(doc(db, 'workEntries', id), {
    payments: arrayUnion(paymentRecord),
    paidAmount: newPaidAmount,
    dueAmount: newDueAmount,
  });
};

/** Active entries only — excludes any document with isDeleted === true. */
export const subscribeToWorkEntries = (callback: (entries: WorkEntry[]) => void) => {
  if (!db) { callback([]); return () => {}; }
  const q = query(collection(db, 'workEntries'), orderBy('date', 'desc'));
  return onSnapshot(q, (snapshot) => {
    const entries: WorkEntry[] = [];
    snapshot.forEach(doc => {
      const data = { id: doc.id, ...doc.data() } as WorkEntry;
      if (!data.isDeleted) entries.push(data);
    });
    callback(entries);
  }, (err) => {
    console.error('[Firestore] workEntries listener error:', err.code, err.message);
    callback([]);
  });
};

/** Deleted entries only — for the Recycle Bin page. */
export const subscribeToDeletedEntries = (callback: (entries: WorkEntry[]) => void) => {
  if (!db) { callback([]); return () => {}; }
  const q = query(collection(db, 'workEntries'), orderBy('date', 'desc'));
  return onSnapshot(q, (snapshot) => {
    const entries: WorkEntry[] = [];
    snapshot.forEach(doc => {
      const data = { id: doc.id, ...doc.data() } as WorkEntry;
      if (data.isDeleted) entries.push(data);
    });
    entries.sort((a, b) => (b.deletedAt?.toMillis() ?? 0) - (a.deletedAt?.toMillis() ?? 0));
    callback(entries);
  }, (err) => {
    console.error('[Firestore] deletedEntries listener error:', err.code, err.message);
    callback([]);
  });
};

// ─── CATEGORIES ──────────────────────────────────────────────────────────────

export const initCategoriesIfEmpty = async () => {
  if (!db) return;
  const firestoreDb = db;
  const sentinelRef = doc(firestoreDb, 'config', 'meta');
  const sentinel = await getDoc(sentinelRef);
  if (sentinel.exists()) return;

  const batch = writeBatch(firestoreDb);
  defaultCategories.forEach((name, order) => {
    const nameLower = name.trim().toLowerCase();
    const ref = doc(firestoreDb, 'categories', encodeURIComponent(nameLower));
    batch.set(ref, { name, nameLower, order });
  });
  batch.set(sentinelRef, { categoriesSeededAt: Timestamp.now() }, { merge: true });
  try {
    await batch.commit();
  } catch {
    // concurrent init already ran
  }
};

function sortCategories(cats: Category[]): Category[] {
  return cats.sort((a, b) => {
    const ao = a.order ?? Number.MAX_SAFE_INTEGER;
    const bo = b.order ?? Number.MAX_SAFE_INTEGER;
    if (ao !== bo) return ao - bo;
    return a.name.localeCompare(b.name);
  });
}

export const getCategories = async (): Promise<Category[]> => {
  if (!db) return [];
  const snap = await getDocs(collection(db, 'categories'));
  const cats: Category[] = [];
  snap.forEach(d => cats.push({ id: d.id, ...d.data() } as Category));
  return sortCategories(cats);
};

export const subscribeToCategories = (callback: (categories: Category[]) => void) => {
  if (!db) return () => {};
  return onSnapshot(collection(db, 'categories'), (snap) => {
    const cats: Category[] = [];
    snap.forEach(d => cats.push({ id: d.id, ...d.data() } as Category));
    callback(sortCategories(cats));
  }, (err) => {
    console.error('[Firestore] Categories listener error:', err.code, err.message);
  });
};

export const addCategory = async (name: string, order?: number) => {
  if (!db) throw new Error("Firebase not configured");
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Category name is required');
  const nameLower = trimmed.toLowerCase();
  const data: { name: string; nameLower: string; order?: number } = { name: trimmed, nameLower };
  if (order !== undefined) data.order = order;
  const categoryRef = doc(db, 'categories', encodeURIComponent(nameLower));
  const existing = await getDoc(categoryRef);
  if (existing.exists()) throw new Error(`Category "${trimmed}" already exists`);
  return setDoc(categoryRef, data);
};

/** Batch-update the `order` field on each category document to persist a new sort order. */
export const reorderCategories = async (updates: { id: string; order: number }[]) => {
  if (!db) throw new Error("Firebase not configured");
  const batch = writeBatch(db);
  updates.forEach(({ id, order }) => {
    batch.update(doc(db!, 'categories', id), { order });
  });
  await batch.commit();
};

export const deleteCategory = async (id: string) => {
  if (!db) throw new Error("Firebase not configured");
  return deleteDoc(doc(db, 'categories', id));
};

// ─── SETTINGS ────────────────────────────────────────────────────────────────

export const getShopSettings = async (): Promise<ShopSettings> => {
  if (!db) return { shopName: "AZAAN COMMUNICATION TOUR AND TRAVEL", address: "", phone: "" };
  const d = await getDoc(doc(db, 'config', 'shop'));
  if (d.exists()) return d.data() as ShopSettings;
  const def = { shopName: "AZAAN COMMUNICATION TOUR AND TRAVEL", address: "", phone: "" };
  await setDoc(doc(db, 'config', 'shop'), def);
  return def;
};

export const updateShopSettings = async (data: ShopSettings) => {
  if (!db) throw new Error("Firebase not configured");
  return setDoc(doc(db, 'config', 'shop'), data);
};

// ─── UNIFIED TRANSACTIONS ─────────────────────────────────────────────────────

export type TransactionType = 'aeps' | 'recharge' | 'transfer' | 'flight' | 'quickWork';

export interface TransactionRecord {
  id?: string;
  entryNumber: string;
  type: TransactionType;
  customerName?: string;
  amount: number;
  profitMargin: number;
  paymentStatus: PaymentStatus;
  paymentMode?: PaymentMode;
  settledVia?: SettlementMode;
  settledBy?: string;
  settledAt?: Timestamp;
  createdAt: Timestamp;
  addedBy: string;
  isDeleted?: boolean;
  details: Record<string, unknown>;
}

export interface AepsWithdrawal extends Omit<TransactionRecord, 'type' | 'details'> {
  bankName: string;
  mobile?: string;
}

export interface ElectricRecharge extends Omit<TransactionRecord, 'type' | 'details' | 'amount'> {
  consumerNumber: string;
  mobile?: string;
  rechargeAmount: number;
}

export interface MoneyTransfer extends Omit<TransactionRecord, 'type' | 'details' | 'customerName'> {
  name: string;
  mobileOrAccount: string;
}

export type QuickActionCategory =
  | 'Printout' | 'Lamination' | 'Xerox' | 'PVC' | 'Print' | 'Photo Print' | 'Other';

export const QUICK_ACTION_CATEGORIES: QuickActionCategory[] = [
  'Printout', 'Lamination', 'Xerox', 'PVC', 'Print', 'Photo Print', 'Other',
];

export interface QuickActionEntry extends Omit<TransactionRecord, 'type' | 'details'> {
  category: QuickActionCategory;
}

export interface FlightBooking extends Omit<TransactionRecord, 'type' | 'details'> {
  flightFrom: string;
  flightTo: string;
  boardingDate: string;
  actualFare: number;
  amountCharged: number;
}

type TransactionView<T extends TransactionType> =
  T extends 'aeps' ? AepsWithdrawal :
  T extends 'recharge' ? ElectricRecharge :
  T extends 'transfer' ? MoneyTransfer :
  T extends 'flight' ? FlightBooking :
  QuickActionEntry;

function viewTransaction<T extends TransactionType>(id: string, data: Record<string, unknown>): TransactionView<T> {
  const details = (data.details ?? {}) as Record<string, unknown>;
  const base = { id, ...data };
  if (data.type === 'aeps') return { ...base, bankName: details.bankName, mobile: details.mobile } as TransactionView<T>;
  if (data.type === 'recharge') return { ...base, amount: data.amount, rechargeAmount: data.amount, consumerNumber: details.consumerNumber, mobile: details.mobile } as TransactionView<T>;
  if (data.type === 'transfer') return { ...base, name: data.customerName, mobileOrAccount: details.mobileOrAccount } as TransactionView<T>;
  if (data.type === 'flight') return { ...base, actualFare: details.actualFare, amountCharged: data.amount, flightFrom: details.flightFrom, flightTo: details.flightTo, boardingDate: details.boardingDate } as TransactionView<T>;
  return { ...base, category: details.category } as TransactionView<T>;
}

export interface CreateTransactionInput {
  customerName?: string;
  amount: number;
  profitMargin: number;
  paymentMode?: PaymentMode;
  addedBy: string;
  details: Record<string, unknown>;
}

export const createTransaction = async (
  type: TransactionType,
  data: CreateTransactionInput,
): Promise<void> => {
  if (!db) throw new Error('Firebase not configured');
  const now = Timestamp.now();
  const entryNumber = await allocateEntryNumber(type);
  const paymentStatus = deriveStatus(data.paymentMode ?? 'Cash');
  await addDoc(collection(db, 'transactions'), stripUndefined({
    entryNumber,
    type,
    customerName: data.customerName,
    amount: data.amount,
    profitMargin: data.profitMargin,
    paymentStatus,
    paymentMode: data.paymentMode ?? 'Cash',
    createdAt: now,
    addedBy: data.addedBy,
    isDeleted: false,
    details: data.details,
  } as Record<string, unknown>));
};

export const subscribeTransactions = <T extends TransactionType>(
  type: T,
  callback: (entries: Array<TransactionView<T>>) => void,
  onError?: (err: Error) => void,
) => {
  if (!db) { callback([]); return () => {}; }
  const q = query(
    collection(db, 'transactions'),
    where('type', '==', type),
    where('isDeleted', '==', false),
    orderBy('createdAt', 'desc'),
  );
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map(d => viewTransaction<T>(d.id, d.data() as Record<string, unknown>)));
  }, (err) => {
    console.error(`[Firestore] transactions/${type} error:`, err.message);
    onError?.(err);
    callback([]);
  });
};

export const settleTransaction = async (
  type: TransactionType,
  transactionId: string,
  mode: SettlementMode,
  settledBy: string,
): Promise<void> => {
  if (!db) throw new Error('Firebase not configured');
  const ref = doc(db, 'transactions', transactionId);
  const existing = await getDoc(ref);
  if (!existing.exists()) throw new Error('Cannot settle transaction: entry does not exist');
  const data = existing.data() as Record<string, unknown>;
  if (data.type !== type) throw new Error('Cannot settle transaction: type mismatch');
  await updateDoc(ref, {
    paymentStatus: 'paid' as PaymentStatus,
    settledVia: mode,
    settledAt: Timestamp.now(),
    settledBy,
  });
};

export const deleteTransaction = async (type: TransactionType, transactionId: string): Promise<void> => {
  if (!db) throw new Error('Firebase not configured');
  const ref = doc(db, 'transactions', transactionId);
  const existing = await getDoc(ref);
  if (!existing.exists()) throw new Error('Cannot delete transaction: entry does not exist');
  if ((existing.data() as Record<string, unknown>).type !== type) throw new Error('Cannot delete transaction: type mismatch');
  await updateDoc(ref, { isDeleted: true });
};

// Compatibility-shaped adapters keep the existing screens unchanged while all
// reads and writes use the single transactions collection above.
export const createAepsWithdrawal = async (
  data: Omit<AepsWithdrawal, 'id' | 'createdAt' | 'entryNumber' | 'type' | 'details'>,
) => createTransaction('aeps', {
  customerName: data.customerName,
  amount: data.amount,
  profitMargin: data.profitMargin,
  paymentMode: data.paymentMode,
  addedBy: data.addedBy,
  details: { bankName: data.bankName, mobile: data.mobile },
});

export const subscribeToAepsWithdrawals = (callback: (entries: AepsWithdrawal[]) => void) =>
  subscribeTransactions('aeps', callback as (entries: Array<TransactionView<'aeps'>>) => void);

export const createElectricRecharge = async (
  data: Omit<ElectricRecharge, 'id' | 'createdAt' | 'entryNumber' | 'type' | 'details' | 'amount'>,
) => createTransaction('recharge', {
  customerName: data.customerName,
  amount: data.rechargeAmount,
  profitMargin: data.profitMargin,
  paymentMode: data.paymentMode,
  addedBy: data.addedBy,
  details: { consumerNumber: data.consumerNumber, mobile: data.mobile },
});

export const subscribeToElectricRecharges = (callback: (entries: ElectricRecharge[]) => void) =>
  subscribeTransactions('recharge', callback as (entries: Array<TransactionView<'recharge'>>) => void);

export const createMoneyTransfer = async (
  data: Omit<MoneyTransfer, 'id' | 'createdAt' | 'entryNumber' | 'type' | 'details'>,
) => createTransaction('transfer', {
  customerName: data.name,
  amount: data.amount,
  profitMargin: data.profitMargin,
  paymentMode: data.paymentMode,
  addedBy: data.addedBy,
  details: { mobileOrAccount: data.mobileOrAccount },
});

export const subscribeToMoneyTransfers = (callback: (entries: MoneyTransfer[]) => void) =>
  subscribeTransactions('transfer', callback as (entries: Array<TransactionView<'transfer'>>) => void);

export const createQuickAction = async (
  data: Omit<QuickActionEntry, 'id' | 'createdAt' | 'entryNumber' | 'type' | 'details'>,
) => createTransaction('quickWork', {
  customerName: data.customerName,
  amount: data.amount,
  profitMargin: data.amount,
  paymentMode: data.paymentMode,
  addedBy: data.addedBy,
  details: { category: data.category },
});

export const subscribeToQuickActions = (
  callback: (entries: QuickActionEntry[]) => void,
  onError?: (err: Error) => void,
) => subscribeTransactions('quickWork', callback as (entries: Array<TransactionView<'quickWork'>>) => void, onError);

export const createFlightBooking = async (
  data: Omit<FlightBooking, 'id' | 'createdAt' | 'entryNumber' | 'type' | 'details'>,
) => createTransaction('flight', {
  customerName: data.customerName,
  amount: data.amountCharged,
  profitMargin: data.profitMargin,
  paymentMode: data.paymentMode,
  addedBy: data.addedBy,
  details: {
    flightFrom: data.flightFrom,
    flightTo: data.flightTo,
    boardingDate: data.boardingDate,
    actualFare: data.actualFare,
  },
});

export const subscribeToFlightBookings = (callback: (entries: FlightBooking[]) => void) =>
  subscribeTransactions('flight', callback as (entries: Array<TransactionView<'flight'>>) => void);

export type PaymentHistoryEntryType = TransactionType | 'work';

export const settlePendingEntry = async (
  entryType: PaymentHistoryEntryType,
  entryId: string,
  mode: SettlementMode,
  settledBy: string,
  _meta?: {
    amount?: number;
    customerName?: string;
    category?: string;
  },
): Promise<void> => {
  if (entryType === 'work') {
    throw new Error('Work entries use payment records for settlement');
  }
  await settleTransaction(entryType, entryId, mode, settledBy);
};

// ─── DOCUMENT / RECEIVING ATTACHMENTS ────────────────────────────────────────

/**
 * Append a document entry to the `documents` array of a work entry.
 */
export const addDocumentToEntry = async (
  entryId: string,
  file: Omit<AttachedFile, 'uploadedAt'>,
): Promise<void> => {
  if (!db) throw new Error('Firebase not configured');
  const record: AttachedFile = { ...file, uploadedAt: Timestamp.now() };
  await updateDoc(doc(db, 'workEntries', entryId), {
    documents: arrayUnion(record),
  });
};

/**
 * Append a receiving entry to the `receivings` array of a work entry.
 */
export const addReceivingToEntry = async (
  entryId: string,
  file: Omit<AttachedFile, 'uploadedAt'>,
): Promise<void> => {
  if (!db) throw new Error('Firebase not configured');
  const record: AttachedFile = { ...file, uploadedAt: Timestamp.now() };
  await updateDoc(doc(db, 'workEntries', entryId), {
    receivings: arrayUnion(record),
  });
};

/**
 * Remove a document entry from the `documents` array by index.
 * Reads the current array, splices the item, and writes back the full array.
 */
export const removeDocumentFromEntry = async (
  entryId: string,
  index: number,
  currentDocuments: AttachedFile[],
): Promise<void> => {
  if (!db) throw new Error('Firebase not configured');
  const updated = currentDocuments.filter((_, i) => i !== index);
  await updateDoc(doc(db, 'workEntries', entryId), { documents: updated });
};

/**
 * Remove a receiving entry from the `receivings` array by index.
 */
export const removeReceivingFromEntry = async (
  entryId: string,
  index: number,
  currentReceivings: AttachedFile[],
): Promise<void> => {
  if (!db) throw new Error('Firebase not configured');
  const updated = currentReceivings.filter((_, i) => i !== index);
  await updateDoc(doc(db, 'workEntries', entryId), { receivings: updated });
};
