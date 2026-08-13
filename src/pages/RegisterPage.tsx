import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Link, useLocation } from 'wouter';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Store, Loader2 } from 'lucide-react';
import { useSettings } from '@/contexts/SettingsContext';

export default function RegisterPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const { isConfigured, user } = useAuth();
  const { shopSettings } = useSettings();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  if (user) {
    setLocation('/dashboard');
    return null;
  }

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth) return;
    
    setLoading(true);
    try {
      await createUserWithEmailAndPassword(auth, email, password);
      toast({ title: "Account created successfully" });
      setLocation('/dashboard');
    } catch (err: any) {
      toast({ variant: "destructive", title: "Registration Failed", description: err.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[100dvh] flex flex-col items-center justify-center p-4 bg-background">
      <div className="max-w-md w-full bg-card border rounded-xl shadow-sm overflow-hidden">
        <div className="bg-primary p-8 text-center text-primary-foreground">
          <Store className="h-12 w-12 mx-auto mb-4" />
          <h1 className="text-xl font-bold">{shopSettings?.shopName || "AZAAN COMMUNICATION"}</h1>
          <p className="text-primary-foreground/80 mt-2">Register New Staff Account</p>
        </div>
        
        <form onSubmit={handleRegister} className="p-8 space-y-6">
          <div className="space-y-2">
            <Label htmlFor="email">Email Address</Label>
            <Input 
              id="email" 
              type="email" 
              placeholder="staff@example.com" 
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={!isConfigured || loading}
            />
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="password">Password (min 6 chars)</Label>
            <Input 
              id="password" 
              type="password" 
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              disabled={!isConfigured || loading}
            />
          </div>

          <Button type="submit" className="w-full" disabled={!isConfigured || loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Create Account
          </Button>

          <div className="text-center text-sm text-muted-foreground pt-4">
            Already have an account? <Link href="/login" className="text-primary hover:underline">Login</Link>
          </div>
        </form>
      </div>
    </div>
  );
}
