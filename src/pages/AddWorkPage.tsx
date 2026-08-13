import { useState } from 'react';
import { useLocation } from 'wouter';
import { createWorkEntry } from '@/lib/firestore';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { WorkEntryForm, WorkEntryFormData } from '@/components/WorkEntryForm';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Timestamp } from 'firebase/firestore';

export default function AddWorkPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { userProfile } = useAuth();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (data: Omit<WorkEntryFormData, 'date'> & { date: Timestamp }) => {
    setIsSubmitting(true);
    try {
      const addedBy = userProfile?.displayName || userProfile?.email || 'Unknown';
      // paymentMode is now part of WorkEntry — include it in the data object
      await createWorkEntry({ ...data, addedBy });
      toast({
        title: "Work Added Successfully",
        description: `${data.customerName} — ${data.category === 'Other' && data.otherCategory ? data.otherCategory : data.category}`,
      });
      setLocation('/dashboard');
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error saving work",
        description: error.message,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6 animate-fade-in-up">
      <div className="flex items-center gap-4">
        <Button variant="outline" size="icon" className="h-9 w-9 shrink-0 rounded-xl" onClick={() => setLocation('/dashboard')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold" style={{ fontFamily: 'var(--app-font-display)' }}>Add New Work Entry</h1>
          <p className="text-muted-foreground text-sm mt-0.5">Fill in the customer and work details below</p>
        </div>
      </div>

      <div className="bg-card border rounded-2xl p-6 shadow-card">
        <WorkEntryForm onSubmit={handleSubmit} isSubmitting={isSubmitting} />
      </div>
    </div>
  );
}
