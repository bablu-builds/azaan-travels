import { useState, useEffect, useRef, createContext, useContext, ReactNode } from 'react';
import { User, onAuthStateChanged, signOut as firebaseSignOut } from 'firebase/auth';
import { App } from '@capacitor/app';
import {
  auth,
  clearRememberedAuthSession,
  isAuthSessionRemembered,
  isNativePlatform,
  isConfigured,
} from '@/lib/firebase';
import { useToast } from '@/hooks/use-toast';
import { UserProfile, subscribeToUserProfile, bootstrapUserProfile } from '@/lib/firestore';

export type UserRole = 'owner' | 'manager' | 'staff';

interface AuthContextType {
  user: User | null;
  userProfile: UserProfile | null;
  role: UserRole | null;
  isOwner: boolean;
  isManager: boolean;
  // Permissions — always true for owner/manager; staff-specific flags below
  canAccessFinancialServices: boolean;
  canManageWork: boolean;
  canAccessQuickWork: boolean;
  canViewDeletedItems: boolean;
  canManageCategories: boolean;
  displayName: string;
  loading: boolean;
  profileLoading: boolean;
  logout: () => Promise<void>;
  isConfigured: boolean;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  userProfile: null,
  role: null,
  isOwner: false,
  isManager: false,
  canAccessFinancialServices: false,
  canManageWork: true,
  canAccessQuickWork: true,
  canViewDeletedItems: true,
  canManageCategories: false,
  displayName: '',
  loading: true,
  profileLoading: true,
  logout: async () => {},
  isConfigured,
});

/** SessionStorage key set before sign-out so LoginPage can show a deactivation message. */
const DEACTIVATED_KEY = 'azaan_account_deactivated';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(true);
  const { toast } = useToast();

  const bootstrapAttemptedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!auth) {
      setLoading(false);
      setProfileLoading(false);
      return;
    }

    let unsubscribeProfile: (() => void) | null = null;
    let resumeListener: { remove: () => Promise<void> } | null = null;
    let effectActive = true;

    if (isNativePlatform) {
      void App.addListener('appStateChange', async ({ isActive }) => {
        if (!isActive || !effectActive || !auth) return;

        try {
          if (await isAuthSessionRemembered()) {
            await auth.authStateReady();
          }
        } catch (err) {
          console.warn('[AuthContext] Could not restore auth on app resume:', err);
        }
      }).then(listener => {
        resumeListener = listener;
        if (!effectActive) void listener.remove();
      });
    }

    const unsubscribeAuth = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);

      if (unsubscribeProfile) {
        unsubscribeProfile();
        unsubscribeProfile = null;
      }

      if (!u) {
        setUserProfile(null);
        setProfileLoading(false);
        bootstrapAttemptedRef.current = null;
        return;
      }

      setProfileLoading(true);
      bootstrapAttemptedRef.current = null;

      unsubscribeProfile = subscribeToUserProfile(u.uid, async (profile) => {
        if (profile) {
          // Deactivated account — sign out immediately with a flag for LoginPage
          if (profile.isActive === false) {
            sessionStorage.setItem(DEACTIVATED_KEY, '1');
            await firebaseSignOut(auth!).catch(() => {});
            await clearRememberedAuthSession();
            setUserProfile(null);
            setProfileLoading(false);
            return;
          }
          setUserProfile(profile);
          setProfileLoading(false);
        } else {
          if (bootstrapAttemptedRef.current !== u.uid) {
            bootstrapAttemptedRef.current = u.uid;
            try {
              const bootstrapped = await bootstrapUserProfile(
                u.uid,
                u.email ?? '',
                u.displayName || u.email?.split('@')[0] || 'Owner',
              );
              if (!bootstrapped) {
                setUserProfile(null);
                setProfileLoading(false);
              }
            } catch (err) {
              console.error('[AuthContext] Error bootstrapping user profile:', err);
              setUserProfile(null);
              setProfileLoading(false);
            }
          } else {
            setUserProfile(null);
            setProfileLoading(false);
          }
        }
      });
    });

    return () => {
      unsubscribeAuth();
      if (unsubscribeProfile) unsubscribeProfile();
      effectActive = false;
      if (resumeListener) void resumeListener.remove();
    };
  }, []);

  const logout = async () => {
    try {
      if (auth) await firebaseSignOut(auth);
      await clearRememberedAuthSession();
      setUserProfile(null);
      toast({ title: 'Logged out', description: 'You have been successfully logged out.' });
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Error logging out', description: error.message });
    }
  };

  const role = userProfile?.role ?? null;
  const isOwner = role === 'owner';
  const isManager = role === 'manager';

  // Permissions — owner and manager always have everything
  // Staff: fall back to true for canManageWork / canAccessQuickWork / canViewDeletedItems
  // (backward compat — existing staff without the field retain their previous access)
  const canAccessFinancialServices = isOwner || isManager || (userProfile?.canAccessFinancialServices === true);
  const canManageWork = isOwner || isManager || (userProfile?.canManageWork !== false);
  const canAccessQuickWork = isOwner || isManager || (userProfile?.canAccessQuickWork !== false);
  const canViewDeletedItems = isOwner || isManager || (userProfile?.canViewDeletedItems !== false);
  const canManageCategories = isOwner || isManager || (userProfile?.canManageCategories === true);

  const displayName = userProfile?.displayName || user?.displayName || user?.email?.split('@')[0] || 'Staff';

  return (
    <AuthContext.Provider value={{
      user, userProfile, role, isOwner, isManager,
      canAccessFinancialServices, canManageWork, canAccessQuickWork, canViewDeletedItems, canManageCategories,
      displayName, loading, profileLoading, logout, isConfigured,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);

/** Read and clear the deactivated flag from sessionStorage. */
export const consumeDeactivatedFlag = (): boolean => {
  if (typeof sessionStorage === 'undefined') return false;
  const val = sessionStorage.getItem('azaan_account_deactivated');
  if (val) {
    sessionStorage.removeItem('azaan_account_deactivated');
    return true;
  }
  return false;
};
