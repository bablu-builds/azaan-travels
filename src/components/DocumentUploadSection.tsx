/**
 * DocumentUploadSection
 *
 * Renders two upload cards (Documents + Receivings) at the bottom of the
 * Edit Work Entry page. Files are uploaded to Cloudinary; metadata is stored
 * in the work entry's Firestore document.
 */

import { useRef, useState, type MouseEvent } from 'react';
import { Eye, Download, Trash2, Plus, Loader2, FileText, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Timestamp } from 'firebase/firestore';
import { format } from 'date-fns';
import {
  AttachedFile,
  addDocumentToEntry,
  addReceivingToEntry,
  removeDocumentFromEntry,
  removeReceivingFromEntry,
} from '@/lib/firestore';
import { uploadToCloudinary, isCloudinaryConfigured, MAX_FILE_SIZE } from '@/lib/cloudinary';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';

// ─── helpers ─────────────────────────────────────────────────────────────────

function formatTs(ts: Timestamp | undefined): string {
  if (!ts) return '';
  try { return format(ts.toDate(), 'd MMM yyyy, h:mm a'); } catch { return ''; }
}

// ─── single file row ─────────────────────────────────────────────────────────

function FileRow({
  file,
  onDelete,
  deleting,
}: {
  file: AttachedFile;
  onDelete: () => void;
  deleting: boolean;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [accessError, setAccessError] = useState(false);

  async function openFile(event: MouseEvent<HTMLAnchorElement>, url: string) {
    event.preventDefault();
    setAccessError(false);
    const popup = window.open('', '_blank');
    try {
      const response = await fetch(url, { method: 'HEAD' });
      if (response.status === 401 || response.status === 403) {
        popup?.close();
        setAccessError(true);
        return;
      }
    } catch {
      // A browser may block cross-origin HEAD requests; let Cloudinary handle
      // the navigation in that case.
    }
    if (popup) {
      popup.location.href = url;
    } else {
      window.location.href = url;
    }
  }

  return (
    <>
      <div className="flex items-center gap-2 py-2.5 border-b last:border-b-0">
        <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{file.name}</p>
          {file.uploadedAt && (
            <p className="text-xs text-muted-foreground">
              {formatTs(file.uploadedAt)}{file.addedBy ? ` · ${file.addedBy}` : ''}
            </p>
          )}
        </div>

        {/* actions */}
        <div className="flex items-center gap-1 shrink-0">
          <a
            href={file.fileUrl}
            onClick={event => openFile(event, file.fileUrl)}
            target="_blank"
            rel="noopener noreferrer"
            title="View"
            className="inline-flex items-center justify-center h-8 w-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <Eye className="h-4 w-4" />
          </a>
          <a
            href={file.downloadUrl}
            onClick={event => openFile(event, file.downloadUrl)}
            download
            target="_blank"
            rel="noopener noreferrer"
            title="Download"
            className="inline-flex items-center justify-center h-8 w-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <Download className="h-4 w-4" />
          </a>
          <button
            type="button"
            title="Delete"
            disabled={deleting}
            onClick={() => setDialogOpen(true)}
            className="inline-flex items-center justify-center h-8 w-8 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {deleting
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <Trash2 className="h-4 w-4" />
            }
          </button>
        </div>
      </div>
      {accessError && (
        <p role="alert" className="pb-2 text-xs text-amber-700">
          Ye file abhi accessible nahi hai — Cloudinary settings check karo.
        </p>
      )}

      {/* Confirmation dialog */}
      <AlertDialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{file.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the entry from the list. The file will remain on Cloudinary but will no longer be linked to this work entry.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { setDialogOpen(false); onDelete(); }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ─── upload card ─────────────────────────────────────────────────────────────

type CardKind = 'documents' | 'receivings';

function UploadCard({
  title,
  listLabel,
  files,
  entryId,
  kind,
  onAdded,
  onRemoved,
}: {
  title: string;
  listLabel: string;
  files: AttachedFile[];
  entryId: string;
  kind: CardKind;
  onAdded: (file: AttachedFile) => void;
  onRemoved: (index: number) => void;
}) {
  const { displayName } = useAuth();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [docName, setDocName] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [deletingIdx, setDeletingIdx] = useState<number | null>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    if (!f) return;
    if (f.size > MAX_FILE_SIZE) {
      toast({ title: 'File too large', description: `Maximum allowed size is 5 MB. This file is ${(f.size / 1024 / 1024).toFixed(1)} MB.`, variant: 'destructive' });
      e.target.value = '';
      return;
    }
    setSelectedFile(f);
  }

  async function handleAdd() {
    if (!docName.trim()) {
      toast({ title: 'Name required', description: 'Please enter a document name.', variant: 'destructive' });
      return;
    }
    if (!selectedFile) {
      toast({ title: 'File required', description: 'Please choose a file to upload.', variant: 'destructive' });
      return;
    }
    if (!isCloudinaryConfigured()) {
      toast({ title: 'Cloudinary not configured', description: 'VITE_CLOUDINARY_CLOUD_NAME and VITE_CLOUDINARY_UPLOAD_PRESET must be set.', variant: 'destructive' });
      return;
    }

    setUploading(true);
    setProgress(0);
    try {
      const result = await uploadToCloudinary(selectedFile, setProgress);
      const record: Omit<AttachedFile, 'uploadedAt'> = {
        name: docName.trim(),
        fileUrl: result.fileUrl,
        downloadUrl: result.downloadUrl,
        addedBy: displayName,
      };

      if (kind === 'documents') {
        await addDocumentToEntry(entryId, record);
      } else {
        await addReceivingToEntry(entryId, record);
      }

      const full: AttachedFile = { ...record, uploadedAt: Timestamp.now() };
      onAdded(full);

      // reset
      setDocName('');
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      toast({ title: 'Uploaded', description: `"${record.name}" added successfully.` });
    } catch (err) {
      toast({ title: 'Upload failed', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setUploading(false);
      setProgress(0);
    }
  }

  async function handleDelete(index: number) {
    setDeletingIdx(index);
    try {
      if (kind === 'documents') {
        await removeDocumentFromEntry(entryId, index, files);
      } else {
        await removeReceivingFromEntry(entryId, index, files);
      }
      onRemoved(index);
      toast({ title: 'Removed', description: 'Entry removed from list.' });
    } catch (err) {
      toast({ title: 'Error', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setDeletingIdx(null);
    }
  }

  return (
    <div className="bg-card border rounded-xl p-5 shadow-card">
      <p className="text-xs font-semibold mb-4 text-muted-foreground uppercase tracking-wide">{title}</p>

      {/* Upload form */}
      <div className="space-y-3">
        <div className="space-y-2">
          <label className="text-sm font-medium">Name of Document</label>
          <Input
            placeholder={kind === 'documents' ? 'e.g. Aadhar Card, Ankita Photo' : 'e.g. Ankita PAN Receiving'}
            value={docName}
            onChange={e => setDocName(e.target.value)}
            disabled={uploading}
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">Choose Document File</label>
          <div className="flex gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,application/pdf"
              className="hidden"
              onChange={handleFileChange}
              disabled={uploading}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="flex-1 flex items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm text-muted-foreground hover:bg-muted/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Upload className="h-4 w-4 shrink-0" />
              <span className="truncate">{selectedFile ? selectedFile.name : 'Select image or PDF…'}</span>
            </button>
          </div>
          <p className="text-xs text-muted-foreground">Images or PDF · Max 5 MB</p>
        </div>

        {/* Progress bar */}
        {uploading && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5"><Loader2 className="h-3 w-3 animate-spin" /> Uploading…</span>
              <span>{progress}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all duration-200"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        <Button
          type="button"
          onClick={handleAdd}
          disabled={uploading || !docName.trim() || !selectedFile}
          className="w-full sm:w-auto gap-1.5"
        >
          {uploading
            ? <><Loader2 className="h-4 w-4 animate-spin" /> Uploading…</>
            : <><Plus className="h-4 w-4" /> Add</>
          }
        </Button>
      </div>

      {/* File list */}
      {files.length > 0 && (
        <div className="mt-5">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">{listLabel}</p>
          <div className="divide-y rounded-lg border bg-muted/20 px-3">
            {files.map((f, i) => (
              <FileRow
                key={`${f.fileUrl}-${i}`}
                file={f}
                onDelete={() => handleDelete(i)}
                deleting={deletingIdx === i}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── main export ─────────────────────────────────────────────────────────────

export function DocumentUploadSection({
  entryId,
  documents,
  receivings,
  onDocumentsChange,
  onReceivingsChange,
}: {
  entryId: string;
  documents: AttachedFile[];
  receivings: AttachedFile[];
  onDocumentsChange: (files: AttachedFile[]) => void;
  onReceivingsChange: (files: AttachedFile[]) => void;
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm font-semibold text-foreground">Document / Receiving</p>

      <UploadCard
        title="Document"
        listLabel="Document List"
        files={documents}
        entryId={entryId}
        kind="documents"
        onAdded={(f) => onDocumentsChange([...documents, f])}
        onRemoved={(i) => onDocumentsChange(documents.filter((_, idx) => idx !== i))}
      />

      <UploadCard
        title="Receiving"
        listLabel="Receiving List"
        files={receivings}
        entryId={entryId}
        kind="receivings"
        onAdded={(f) => onReceivingsChange([...receivings, f])}
        onRemoved={(i) => onReceivingsChange(receivings.filter((_, idx) => idx !== i))}
      />
    </div>
  );
}
