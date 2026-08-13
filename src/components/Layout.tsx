import { Link, useLocation } from 'wouter';
import { useAuth } from '@/contexts/AuthContext';
import { useSettings } from '@/contexts/SettingsContext';
import {
  LayoutDashboard, PlusCircle, List, Clock, BarChart3, Settings,
  LogOut, Menu, X, Trash2, Zap, ArrowRightLeft, ChevronRight,
  User2, Fingerprint, Printer, PlaneTakeoff, CreditCard,
} from 'lucide-react';
import logoImg from '@/assets/logo.jpg';
import { useState } from 'react';

interface NavItem {
  href: string;
  label: string;
  icon: React.ElementType;
  isPrimary?: boolean;
  ownerOnly?: boolean;
  ownerOrManagerOnly?: boolean;
  financialOnly?: boolean;
  requireCanManageWork?: boolean;
  requireCanAccessQuickWork?: boolean;
  requireCanViewDeletedItems?: boolean;
}

const mainNavItems: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/work/new', label: 'Add Work Entry', icon: PlusCircle, isPrimary: true, requireCanManageWork: true },
  { href: '/work', label: 'All Work', icon: List },
  { href: '/pending', label: 'Pending Work', icon: Clock },
  { href: '/due-payments', label: 'Due Payments', icon: CreditCard },
  { href: '/quick-work', label: 'Quick Action Work', icon: Printer, requireCanAccessQuickWork: true },
];

const financialNavItems: NavItem[] = [
  { href: '/aeps', label: 'AEPS Withdrawal', icon: Fingerprint, financialOnly: true },
  { href: '/electric-recharge', label: 'Electric Recharge', icon: Zap, financialOnly: true },
  { href: '/money-transfer', label: 'Money Transfer', icon: ArrowRightLeft, financialOnly: true },
  { href: '/flight-booking', label: 'Flight Booking', icon: PlaneTakeoff, financialOnly: true },
];

const adminNavItems: NavItem[] = [
  { href: '/reports', label: 'Reports', icon: BarChart3, ownerOrManagerOnly: true },
  { href: '/settings', label: 'Settings', icon: Settings },
  { href: '/deleted', label: 'Deleted Items', icon: Trash2, requireCanViewDeletedItems: true },
];

function NavLink({ item, isActive, onClick }: {
  item: NavItem; isActive: boolean; onClick?: () => void;
}) {
  const Icon = item.icon;
  if (item.isPrimary) {
    return (
      <Link href={item.href} onClick={onClick}
        className="flex items-center gap-3 px-4 py-2.5 rounded-lg my-1 bg-sidebar-primary text-sidebar-primary-foreground font-semibold text-sm hover:opacity-90 transition-all shadow-sm">
        <Icon className="h-4 w-4 shrink-0" />
        <span>{item.label}</span>
      </Link>
    );
  }
  return (
    <Link href={item.href} onClick={onClick}
      className={`flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-all group
        ${isActive
          ? 'bg-sidebar-primary/15 text-white'
          : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
        }`}>
      <Icon className={`h-4 w-4 shrink-0 transition-colors ${isActive ? 'text-sidebar-primary' : 'group-hover:text-sidebar-accent-foreground'}`} />
      <span className="flex-1">{item.label}</span>
      {isActive && <div className="h-1.5 w-1.5 rounded-full bg-sidebar-primary shrink-0" />}
    </Link>
  );
}

function SidebarContent({ location, onNav, isOwner, isManager, canAccessFinancialServices, canManageWork, canAccessQuickWork, canViewDeletedItems, shopName, displayName, userEmail, logout }: {
  location: string; onNav?: () => void;
  isOwner: boolean; isManager: boolean; canAccessFinancialServices: boolean;
  canManageWork: boolean; canAccessQuickWork: boolean; canViewDeletedItems: boolean;
  shopName: string; displayName: string; userEmail: string; logout: () => void;
}) {
  const initial = (displayName[0] || 'U').toUpperCase();
  const roleBadge = isOwner ? 'Owner' : isManager ? 'Manager' : 'Staff';
  const roleBadgeClass = isOwner
    ? 'bg-sidebar-primary/30 text-sidebar-primary'
    : isManager
    ? 'bg-violet-500/20 text-violet-300'
    : 'bg-sidebar-accent text-sidebar-foreground';

  const shouldShowItem = (item: NavItem): boolean => {
    if (item.ownerOnly && !isOwner) return false;
    if (item.ownerOrManagerOnly && !isOwner && !isManager) return false;
    if (item.requireCanManageWork && !canManageWork) return false;
    if (item.requireCanAccessQuickWork && !canAccessQuickWork) return false;
    if (item.requireCanViewDeletedItems && !canViewDeletedItems) return false;
    return true;
  };

  return (
    <div className="flex flex-col h-full bg-sidebar">
      {/* Logo */}
      <div className="flex items-center gap-3 px-5 py-5 border-b border-sidebar-border">
        <div className="h-9 w-9 rounded-lg bg-white overflow-hidden flex items-center justify-center shrink-0 shadow-md">
          <img src={logoImg} alt="AZAAN" className="h-8 w-8 object-contain" />
        </div>
        <div className="min-w-0">
          <div className="text-white font-bold text-sm leading-tight truncate" style={{ fontFamily: 'var(--app-font-display)' }}>
            {shopName}
          </div>
          <div className="text-sidebar-foreground text-xs mt-0.5">CSC Management</div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {/* Main */}
        {mainNavItems.filter(shouldShowItem).map(item => (
          <NavLink key={item.href} item={item} isActive={location === item.href} onClick={onNav} />
        ))}

        {/* Financial services section */}
        {canAccessFinancialServices && (
          <>
            <div className="px-4 pt-5 pb-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-sidebar-foreground/50">
                Financial Services
              </span>
            </div>
            {financialNavItems.map(item => (
              <NavLink key={item.href} item={item} isActive={location === item.href} onClick={onNav} />
            ))}
          </>
        )}

        {/* Admin */}
        <div className="px-4 pt-5 pb-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-sidebar-foreground/50">
            Admin
          </span>
        </div>
        {adminNavItems.filter(shouldShowItem).map(item => (
          <NavLink key={item.href} item={item} isActive={location === item.href} onClick={onNav} />
        ))}
      </nav>

      {/* User Footer */}
      <div className="px-3 py-3 border-t border-sidebar-border">
        <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-sidebar-accent transition-colors cursor-default">
          <div className="h-8 w-8 rounded-full bg-sidebar-primary flex items-center justify-center text-white font-bold text-sm shrink-0">
            {initial}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-white text-sm font-semibold truncate">{displayName}</div>
            <div className="text-sidebar-foreground text-xs truncate">{userEmail}</div>
          </div>
          <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold shrink-0 ${roleBadgeClass}`}>
            {roleBadge}
          </span>
        </div>
        <button
          onClick={logout}
          className="flex w-full items-center gap-3 px-4 py-2.5 rounded-lg text-sm text-sidebar-foreground hover:bg-sidebar-accent hover:text-white transition-all mt-1"
        >
          <LogOut className="h-4 w-4 shrink-0" />
          <span>Logout</span>
        </button>
      </div>
    </div>
  );
}

export function Layout({ children }: { children: React.ReactNode }) {
  const { logout, isConfigured, isOwner, isManager, canAccessFinancialServices, canManageWork, canAccessQuickWork, canViewDeletedItems, displayName, user } = useAuth();
  const { shopSettings } = useSettings();
  const [location] = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const commonProps = {
    location,
    isOwner,
    isManager,
    canAccessFinancialServices,
    canManageWork,
    canAccessQuickWork,
    canViewDeletedItems,
    shopName: shopSettings.shopName,
    displayName,
    userEmail: user?.email || '',
    logout,
  };

  const allItems = [...mainNavItems, ...financialNavItems, ...adminNavItems];
  const currentItem = allItems.find(i => i.href === location);
  const pageTitle = currentItem?.label || 'Dashboard';

  return (
    <div className="min-h-[100dvh] flex bg-background">
      {/* ── DESKTOP SIDEBAR ──────────────────────────────────── */}
      <aside className="hidden md:flex w-64 flex-col flex-shrink-0 fixed left-0 top-0 bottom-0 z-30">
        <SidebarContent {...commonProps} />
      </aside>

      {/* ── MOBILE DRAWER OVERLAY ────────────────────────────── */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setDrawerOpen(false)}
          />
          <div className="absolute left-0 top-0 bottom-0 w-72 shadow-2xl">
            <SidebarContent {...commonProps} onNav={() => setDrawerOpen(false)} />
          </div>
          <button
            onClick={() => setDrawerOpen(false)}
            className="absolute top-4 right-4 h-9 w-9 rounded-full bg-white/10 flex items-center justify-center text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      )}

      {/* ── MAIN AREA ────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col md:ml-64">
        {/* Topbar */}
        <header className="sticky top-0 z-20 bg-white/80 backdrop-blur-md border-b border-border flex items-center h-14 px-4 md:px-6 gap-4">
          <button
            onClick={() => setDrawerOpen(true)}
            className="md:hidden h-8 w-8 flex items-center justify-center rounded-md hover:bg-muted transition-colors"
          >
            <Menu className="h-5 w-5 text-foreground" />
          </button>

          <div className="md:hidden flex items-center gap-2 flex-1 min-w-0">
            <div className="h-6 w-6 rounded bg-white overflow-hidden flex items-center justify-center shrink-0 shadow-sm">
              <img src={logoImg} alt="AZAAN" className="h-5 w-5 object-contain" />
            </div>
            <span className="font-bold text-sm truncate text-foreground">{shopSettings.shopName}</span>
          </div>

          <div className="hidden md:flex items-center gap-2 flex-1">
            <span className="text-muted-foreground text-sm">CSC Portal</span>
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-foreground text-sm font-semibold">{pageTitle}</span>
          </div>

          <div className="hidden md:flex items-center gap-2">
            <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center">
              <User2 className="h-3.5 w-3.5 text-primary" />
            </div>
            <span className="text-sm font-medium text-foreground">{displayName}</span>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
              isOwner ? 'bg-indigo-50 text-indigo-700' : isManager ? 'bg-violet-50 text-violet-700' : 'bg-slate-100 text-slate-600'
            }`}>
              {isOwner ? 'Owner' : isManager ? 'Manager' : 'Staff'}
            </span>
          </div>
        </header>

        {/* Firebase warning banner */}
        {!isConfigured && (
          <div className="bg-amber-50 border-b border-amber-200 text-amber-900 px-6 py-3 text-sm text-center">
            <strong>Firebase not configured</strong> — add Firebase secrets to connect to the database.
          </div>
        )}

        {/* Page content */}
        <main className="flex-1 px-4 md:px-8 py-6">
          {children}
        </main>
      </div>
    </div>
  );
}
