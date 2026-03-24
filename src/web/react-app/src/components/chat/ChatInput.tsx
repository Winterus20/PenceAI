import React, { useRef, useMemo } from 'react';
import { Send, Paperclip, Plus, Loader2, X, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { formatFileSize } from '@/lib/utils';

export interface Attachment {
  fileName: string;
  mimeType: string;
  size: number;
  data: string;
  previewUrl?: string | null;
}

interface ChatInputProps {
  input: string;
  isReceiving: boolean;
  pendingAttachments: Attachment[];
  isDragOver: boolean;
  isEditing?: boolean;
  onInputChange: (value: string) => void;
  onSend: () => void;
  onNewChat: () => void;
  onFileSelection: (files: File[]) => void;
  onRemoveAttachment: (index: number) => void;
  onDragOver: () => void;
  onDragLeave: () => void;
  onDrop: (files: File[]) => void;
  onCancelEdit?: () => void;
}

export const ChatInput: React.FC<ChatInputProps> = ({
  input,
  isReceiving,
  pendingAttachments,
  isDragOver,
  isEditing = false,
  onInputChange,
  onSend,
  onNewChat,
  onFileSelection,
  onRemoveAttachment,
  onDragOver,
  onDragLeave,
  onDrop,
  onCancelEdit,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Karakter sayacı logic
  const charCount = input.length;
  const getCharCountColor = useMemo(() => {
    if (charCount >= 3000) return 'text-red-500';
    if (charCount >= 2000) return 'text-amber-500';
    return 'text-muted-foreground';
  }, [charCount]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  };

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onInputChange(e.target.value);
    e.currentTarget.style.height = 'auto';
    e.currentTarget.style.height = `${Math.min(e.currentTarget.scrollHeight, 160)}px`;
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const fileItems = Array.from(e.clipboardData.items)
      .filter((item) => item.kind === 'file')
      .map((item) => item.getAsFile())
      .filter(Boolean) as File[];

    if (fileItems.length) {
      e.preventDefault();
      onFileSelection(fileItems);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    onDragLeave();
    const files = Array.from(e.dataTransfer.files || []);
    onDrop(files);
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    onFileSelection(files);
    e.target.value = '';
  };

  return (
    <div className="w-full flex justify-center pb-6 pt-4 px-4 bg-gradient-to-t from-background via-background/95 to-transparent z-40 relative">
      <div
        className={`max-w-3xl w-full flex flex-col relative group border ${
  isEditing
  ? 'border-amber-500/50 bg-amber-500/5'
  : isDragOver
  ? 'border-foreground/50 bg-card/50'
  : 'border-border/60 bg-card/20'
        } p-4 transition-colors duration-200`}
        onDragOver={(e) => {
          e.preventDefault();
          onDragOver();
        }}
        onDragLeave={onDragLeave}
        onDrop={handleDrop}
      >
      {/* Düzenleme Modu Badge */}
      {isEditing && (
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2 text-label-sm uppercase text-amber-500">
            <Pencil className="h-3 w-3" />
            <span>Düzenleme Modu</span>
          </div>
          <button
            type="button"
            onClick={onCancelEdit}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-3 w-3" />
            <span>İptal</span>
          </button>
        </div>
      )}
        {pendingAttachments.length ? (
          <div className="mb-3 flex flex-wrap gap-2">
            {pendingAttachments.map((attachment, index) => (
              <div
                key={`${attachment.fileName}-${index}`}
                className="flex items-center gap-2 border border-border/60 bg-background/40 px-3 py-2 text-sm"
              >
                <span className="max-w-48 truncate">{attachment.fileName}</span>
                <span className="text-xs text-muted-foreground">
                  {formatFileSize(attachment.size)}
                </span>
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => onRemoveAttachment(index)}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        ) : null}

        <div className="relative">
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={handleTextareaChange}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder="Mesajınızı yazın veya dosya bırakın..."
            className="min-h-[44px] w-full resize-none bg-transparent border-0 focus-visible:ring-2 focus-visible:ring-purple-500/50 focus-visible:ring-offset-1 focus-visible:ring-offset-background rounded-none px-0 py-3 text-base font-light placeholder:text-foreground/20 transition-all duration-500"
            rows={1}
            aria-label="Mesajınızı yazın"
          />
          {/* Karakter Sayacı */}
          <div className={`absolute bottom-1 right-0 text-xs ${getCharCountColor} transition-colors`}>
            {charCount}
          </div>
        </div>
  
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          multiple
          onChange={handleFileInputChange}
          aria-label="Dosya ekle"
        />

        <div className="mt-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              className="rounded-none"
              onClick={() => fileInputRef.current?.click()}
            >
              <Paperclip className="h-4 w-4" />
              Dosya Ekle
            </Button>
            <Button variant="outline" className="rounded-none" onClick={onNewChat}>
              <Plus className="h-4 w-4" />
              Yeni Sohbet
            </Button>
          </div>

          <div className="flex items-center z-50">
            {isReceiving ? (
              <Loader2 className="animate-spin w-4 h-4 text-foreground/40" />
            ) : (
              <Button
                onClick={onSend}
                disabled={!input.trim() && pendingAttachments.length === 0}
                className={`rounded-none ${isEditing ? 'bg-amber-500 hover:bg-amber-600 text-white' : ''}`}
              >
                {isEditing ? (
                  <>
                    <Send className="h-4 w-4" />
                    Yeniden Gönder
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4" />
                    Gönder
                  </>
                )}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
