import { useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useLocation } from 'wouter';
import { Loader2, ShieldOff } from 'lucide-react';
import { UserRole } from '@/lib/users';

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading, isConfigured } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!isConfigured) return;
    if (!loading && !user) {
      setLocation('/login');
    }
  }, [user, loading, setLocation, isConfigured]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isConfigured) return <>{children}</>;
  if (!user) return null;

  return <>{children}</>;
}

/** Wraps a page that only a specific role (or roles) may view. */
export function RoleRoute({
  children,
  allow,
}: {
  children: React.ReactNode;
  allow: UserRole | UserRole[];
}) {
  const { role, profileLoading, isConfigured } = useAuth();

  if (!isConfigured) return <>{children}</>;

  if (profileLoading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <Loader2 className="h-7 w-7 animate-spin text-primary" />
      </div>
    );
  }

  const allowed = Array.isArray(allow) ? allow : [allow];
  if (role && !allowed.includes(role)) {
    return <AccessDenied />;
  }

  return <>{children}</>;
}

/**
 * Wraps a page behind a boolean permission check.
 * Pass `allowed={true}` to grant access, `false` to show the denied screen.
 */
export function PermissionRoute({
  children,
  allowed,
  message,
}: {
  children: React.ReactNode;
  allowed: boolean;
  message?: string;
}) {
  const { profileLoading, isConfigured } = useAuth();

  if (!isConfigured) return <>{children}</>;

  if (profileLoading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <Loader2 className="h-7 w-7 animate-spin text-primary" />
      </div>
    );
  }

  if (!allowed) {
    return <AccessDenied message={message} />;
  }

  return <>{children}</>;
}

function AccessDenied({ message }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
      <div className="h-16 w-16 rounded-2xl bg-muted flex items-center justify-center mb-5">
        <ShieldOff className="h-8 w-8 text-muted-foreground" />
      </div>
      <h2 className="text-xl font-bold mb-2">Access Restricted</h2>
      <p className="text-muted-foreground text-sm max-w-xs">
        {message ?? "You don't have permission to view this page. Please contact the shop owner if you need access."}
      </p>
    </div>
  );
}
