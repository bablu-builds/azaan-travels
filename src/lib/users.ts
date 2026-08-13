import {
  collection, doc, getDoc, getDocs, setDoc, deleteDoc,
  query, where, onSnapshot, Timestamp,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';

export type UserRole = 'owner' | 'manager' | 'staff';

export interface UserProfile {
  email: string;
  role: UserRole;
  createdAt: Timestamp;
  invitedBy?: string;
}

export interface PendingInvite {
  id?: string;
  email: string;
  invitedBy: string;
  createdAt: Timestamp;
}

// ── User Profile ──────────────────────────────────────────────────────────────

export const getUserProfile = async (uid: string): Promise<UserProfile | null> => {
  if (!db) return null;
  const snap = await getDoc(doc(db, 'users', uid));
  return snap.exists() ? (snap.data() as UserProfile) : null;
};

export const createUserProfile = async (uid: string, data: UserProfile): Promise<void> => {
  if (!db) return;
  await setDoc(doc(db, 'users', uid), data);
};

export const subscribeToUserProfile = (
  uid: string,
  callback: (profile: UserProfile | null) => void,
) => {
  if (!db) { callback(null); return () => {}; }
  return onSnapshot(doc(db, 'users', uid), (snap) => {
    callback(snap.exists() ? (snap.data() as UserProfile) : null);
  });
};

export const hasAnyOwner = async (): Promise<boolean> => {
  if (!db) return false;
  const snap = await getDocs(query(collection(db, 'users'), where('role', '==', 'owner')));
  return !snap.empty;
};

export const removeStaffProfile = async (uid: string): Promise<void> => {
  if (!db) throw new Error('Firebase not configured');
  await deleteDoc(doc(db, 'users', uid));
};

// ── Active users list (for Staff Management) ──────────────────────────────────

export const subscribeToAllUsers = (
  callback: (users: Array<{ uid: string } & UserProfile>) => void,
) => {
  if (!db) { callback([]); return () => {}; }
  return onSnapshot(collection(db, 'users'), (snap) => {
    callback(snap.docs.map(d => ({ uid: d.id, ...(d.data() as UserProfile) })));
  });
};

// ── Pending Invites ───────────────────────────────────────────────────────────

export const createPendingInvite = async (invite: PendingInvite): Promise<void> => {
  if (!db) throw new Error('Firebase not configured');
  // Use email as doc ID so duplicates overwrite
  const safeId = invite.email.replace(/[.#$[\]]/g, '_');
  await setDoc(doc(db, 'pendingInvites', safeId), invite);
};

export const getPendingInviteByEmail = async (email: string): Promise<PendingInvite | null> => {
  if (!db) return null;
  const safeId = email.replace(/[.#$[\]]/g, '_');
  const snap = await getDoc(doc(db, 'pendingInvites', safeId));
  return snap.exists() ? ({ id: snap.id, ...(snap.data() as PendingInvite) }) : null;
};

export const deletePendingInvite = async (email: string): Promise<void> => {
  if (!db) return;
  const safeId = email.replace(/[.#$[\]]/g, '_');
  await deleteDoc(doc(db, 'pendingInvites', safeId));
};

export const subscribeToPendingInvites = (
  callback: (invites: PendingInvite[]) => void,
) => {
  if (!db) { callback([]); return () => {}; }
  return onSnapshot(collection(db, 'pendingInvites'), (snap) => {
    callback(snap.docs.map(d => ({ id: d.id, ...(d.data() as PendingInvite) })));
  });
};
