'use client';

import { useRef, useState } from 'react';
import type { ProductFile } from '../types';
import { useT } from '../i18n/locale-context';
import { useCaspianFirebase } from '../provider/caspian-store-provider';
import { diagnoseUploadDenial, uploadAdminFile } from '../services/storage-service';
import { Button } from '../ui/button';
import { useToast } from '../ui/toast';
import { formatBytes } from '../utils/format-bytes';

export interface AdminProductFilesFieldProps {
  /** Product document id the files belong to; uploads land under `downloads/{productId}/`. */
  productId: string;
  files: ProductFile[];
  onAdd: (file: ProductFile) => void;
  onRemove: (file: ProductFile) => void;
  /** Resolved validation message, if any. */
  error?: string;
}

interface PendingUpload {
  key: string;
  name: string;
  progress: number;
}

const newFileId = () => Math.random().toString(36).slice(2, 10);

function errorCode(error: unknown): string | null {
  return error && typeof error === 'object' && 'code' in error &&
    typeof (error as { code?: unknown }).code === 'string'
    ? (error as { code: string }).code
    : null;
}

/**
 * Upload list for a digital product's downloadable files. Objects go to the
 * private `downloads/{productId}/{fileId}` folder; `ProductFile.storagePath`
 * keeps the unprefixed path.
 */
export function AdminProductFilesField({
  productId,
  files,
  onAdd,
  onRemove,
  error,
}: AdminProductFilesFieldProps) {
  const { auth, db, storage, functions } = useCaspianFirebase();
  const { toast } = useToast();
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<PendingUpload[]>([]);

  const reportError = async (err: unknown) => {
    console.error('[caspian-store] File upload failed:', err);
    const code = errorCode(err);
    let key = 'generic';
    if (code === 'storage/unauthorized') key = (await diagnoseUploadDenial({ auth, db })).kind;
    else if (code === 'storage/unauthenticated') key = 'unauthenticated';
    else if (code === 'storage/quota-exceeded') key = 'quotaExceeded';
    else if (code === 'storage/retry-limit-exceeded' || code === 'storage/canceled') key = 'network';
    else if (code === null && err instanceof Error) {
      toast({ title: err.message, variant: 'destructive' });
      return;
    }
    toast({
      title: t(`imageUpload.errors.${key}.title`),
      description: t(`imageUpload.errors.${key}.description`),
      variant: 'destructive',
      durationMs: 8000,
    });
  };

  const uploadOne = async (file: File) => {
    const id = newFileId();
    const path = `downloads/${productId}/${id}`;
    setPending((p) => [...p, { key: id, name: file.name, progress: 0 }]);
    try {
      const meta = await uploadAdminFile({
        storage,
        auth,
        functions,
        path,
        file,
        onProgress: (fraction) =>
          setPending((p) => p.map((u) => (u.key === id ? { ...u, progress: fraction } : u))),
      });
      onAdd({ id, name: file.name, storagePath: path, size: meta.size, contentType: meta.contentType });
    } catch (err) {
      await reportError(err);
    } finally {
      setPending((p) => p.filter((u) => u.key !== id));
    }
  };

  const handleSelect = (list: FileList | null) => {
    if (!list) return;
    for (const file of Array.from(list)) void uploadOne(file);
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <div data-field="files" style={{ marginBottom: 12 }}>
      <h2 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 4px' }}>
        {t('admin.products.digital.filesTitle')}
      </h2>
      <p style={{ margin: '0 0 12px', color: '#666', fontSize: 13 }}>
        {t('admin.products.digital.filesHint')}
      </p>
      {(files.length > 0 || pending.length > 0) && (
        <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 12px', display: 'grid', gap: 6 }}>
          {files.map((f) => (
            <li key={f.id} style={rowStyle}>
              <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{f.name}</span>
              <span style={{ color: '#666', fontSize: 13 }}>{formatBytes(f.size)}</span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => onRemove(f)}
                aria-label={t('admin.products.digital.removeFile', { name: f.name })}
              >
                {t('admin.products.digital.remove')}
              </Button>
            </li>
          ))}
          {pending.map((u) => (
            <li key={u.key} style={rowStyle}>
              <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{u.name}</span>
              <progress value={u.progress} max={1} style={{ width: 120 }} />
              <span style={{ color: '#666', fontSize: 13, minWidth: 40, textAlign: 'right' }}>
                {Math.round(u.progress * 100)}%
              </span>
            </li>
          ))}
        </ul>
      )}
      <input
        ref={inputRef}
        type="file"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => handleSelect(e.target.files)}
      />
      <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
        {t('admin.products.digital.upload')}
      </Button>
      {error && (
        <p role="alert" style={{ fontSize: 12, color: '#b91c1c', margin: '4px 0 0' }}>
          {error}
        </p>
      )}
    </div>
  );
}

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '8px 12px',
  border: '1px solid #eee',
  borderRadius: 'var(--caspian-radius, 6px)',
};
