import { useState, useCallback } from 'react';

/**
 * Dosya eki tipi
 */
export interface FileAttachment {
  fileName: string;
  mimeType: string;
  size: number;
  data: string;
  previewUrl?: string | null;
}

export interface UseFileUploadOptions {
  maxFiles?: number;
  maxSize?: number;
}

export interface UseFileUploadReturn {
  pendingAttachments: FileAttachment[];
  isDragOver: boolean;
  handleFileSelection: (files: File[]) => Promise<void>;
  handleDrop: (files: File[]) => void;
  handleDragOver: () => void;
  handleDragLeave: () => void;
  removeAttachment: (index: number) => void;
  clearAttachments: () => void;
}

/**
 * Dosya yükleme ve yönetimi için custom hook
 * Drag & drop, dosya seçimi, validation ve base64 dönüşümü
 */
export function useFileUpload({
  maxFiles = 10,
  maxSize = 25 * 1024 * 1024, // 25MB
}: UseFileUploadOptions = {}): UseFileUploadReturn {
  const [pendingAttachments, setPendingAttachments] = useState<FileAttachment[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);

  /**
   * Dosyaları işle ve base64'e dönüştür
   */
  const handleFileSelection = useCallback(
    async (files: File[]) => {
      const remainingSlots = Math.max(0, maxFiles - pendingAttachments.length);
      const selectedFiles = files.slice(0, remainingSlots);

      const loadedAttachments = await Promise.all(
        selectedFiles.map(
          (file) =>
            new Promise<FileAttachment | null>((resolve) => {
              if (file.size > maxSize) {
                resolve(null);
                return;
              }

              const reader = new FileReader();
              reader.onload = () => {
                const result = String(reader.result || '');
                resolve({
                  fileName: file.name,
                  mimeType: file.type || 'application/octet-stream',
                  size: file.size,
                  data: result.split(',')[1],
                  previewUrl: file.type.startsWith('image/') ? result : null,
                });
              };
              reader.onerror = () => resolve(null);
              reader.readAsDataURL(file);
            })
        )
      );

      const validAttachments = loadedAttachments.filter((a): a is FileAttachment => a !== null);
      setPendingAttachments((current) => [...current, ...validAttachments]);
    },
    [maxFiles, maxSize, pendingAttachments.length]
  );

  /**
   * Drag & drop ile dosya bırakma
   */
  const handleDrop = useCallback(
    (files: File[]) => {
      setIsDragOver(false);
      void handleFileSelection(files);
    },
    [handleFileSelection]
  );

  /**
   * Drag over state
   */
  const handleDragOver = useCallback(() => {
    setIsDragOver(true);
  }, []);

  /**
   * Drag leave state
   */
  const handleDragLeave = useCallback(() => {
    setIsDragOver(false);
  }, []);

  /**
   * Ek kaldır
   */
  const removeAttachment = useCallback((index: number) => {
    setPendingAttachments((current) => current.filter((_, i) => i !== index));
  }, []);

  /**
   * Tüm ekleri temizle
   */
  const clearAttachments = useCallback(() => {
    setPendingAttachments([]);
  }, []);

  return {
    pendingAttachments,
    isDragOver,
    handleFileSelection,
    handleDrop,
    handleDragOver,
    handleDragLeave,
    removeAttachment,
    clearAttachments,
  };
}
