import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { ShopSettings, getShopSettings, initCategoriesIfEmpty, getCategories, Category, subscribeToCategories, updateShopSettings, addCategory, deleteCategory, deleteCategoriesByName, reorderCategories as firestoreReorderCategories } from '@/lib/firestore';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';

interface SettingsContextType {
  shopSettings: ShopSettings;
  categories: Category[];
  loading: boolean;
  saveShopSettings: (settings: ShopSettings) => Promise<void>;
  createCategory: (name: string) => Promise<void>;
  removeCategory: (id: string) => Promise<void>;
  reorderCategories: (orderedIds: string[]) => Promise<void>;
}

const defaultSettings = { shopName: "AZAAN COMMUNICATION TOUR AND TRAVEL", address: "", phone: "" };

const SettingsContext = createContext<SettingsContextType>({
  shopSettings: defaultSettings,
  categories: [],
  loading: true,
  saveShopSettings: async () => {},
  createCategory: async () => {},
  removeCategory: async () => {},
  reorderCategories: async () => {},
});

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [shopSettings, setShopSettings] = useState<ShopSettings>(defaultSettings);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const { user, isConfigured } = useAuth();
  const { toast } = useToast();

  useEffect(() => {
    if (!isConfigured || !user) {
      setLoading(false);
      return;
    }

    const loadData = async () => {
      try {
        await initCategoriesIfEmpty();
        const [s, cats] = await Promise.all([getShopSettings(), getCategories()]);
        setShopSettings(s);
        // Seed the state immediately via getDocs so categories show even if
        // the real-time onSnapshot listener fails (e.g. transient network error).
        setCategories(cats);
      } catch (err: any) {
        console.error("Error loading settings:", err);
      } finally {
        setLoading(false);
      }
    };

    loadData();

    const unsubscribe = subscribeToCategories(setCategories);
    return () => unsubscribe();
  }, [user, isConfigured]);

  const saveShopSettings = async (settings: ShopSettings) => {
    try {
      await updateShopSettings(settings);
      setShopSettings(settings);
      toast({ title: "Settings Saved" });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Error", description: err.message });
      throw err;
    }
  };

  const createCategory = async (name: string) => {
    // Case-insensitive duplicate guard — prevent adding the same name twice.
    const normalised = name.trim().toLowerCase();
    if (categories.some(c => c.name.toLowerCase() === normalised)) {
      toast({
        variant: "destructive",
        title: "Already exists",
        description: `"${name}" is already in the list.`,
      });
      return;
    }
    try {
      // Place new categories at the end of the current list.
      const maxOrder = categories.reduce((m, c) => Math.max(m, c.order ?? 0), -1);
      await addCategory(name, maxOrder + 1);
      // Do NOT optimistically update local state here.
      // The onSnapshot listener (subscribeToCategories) is the single source of
      // truth — it fires immediately when Firestore's local cache is updated
      // (before the server round-trip even completes), so the UI updates fast
      // enough without a manual push.
      toast({ title: "Category Added" });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Error", description: err.message });
      throw err;
    }
  };

  const reorderCategories = async (orderedIds: string[]) => {
    try {
      const updates = orderedIds.map((id, order) => ({ id, order }));
      await firestoreReorderCategories(updates);
    } catch (err: any) {
      toast({ variant: "destructive", title: "Error", description: err.message });
      throw err;
    }
  };

  const removeCategory = async (id: string) => {
    // Resolve the name for this category so we can delete ALL Firestore docs
    // that share the same name.  This cleans up any hidden duplicates that
    // were created by the previous optimistic-update race condition, which is
    // what made delete appear to fail (deleting the visible doc exposed the
    // hidden duplicate, which then re-appeared in the UI).
    const cat = categories.find(c => c.id === id);
    try {
      if (cat) {
        await deleteCategoriesByName(cat.name);
      } else {
        // Fallback: delete just the specific document by id.
        await deleteCategory(id);
      }
      // Do NOT optimistically update local state — the onSnapshot listener
      // will remove the deleted item(s) immediately.
      toast({ title: "Category Deleted" });
    } catch (err: any) {
      toast({ variant: "destructive", title: "Error", description: err.message });
      throw err;
    }
  };

  return (
    <SettingsContext.Provider value={{ shopSettings, categories, loading, saveShopSettings, createCategory, removeCategory, reorderCategories }}>
      {children}
    </SettingsContext.Provider>
  );
}

export const useSettings = () => useContext(SettingsContext);
