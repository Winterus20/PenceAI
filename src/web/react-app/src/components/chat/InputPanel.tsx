import React, { useRef } from 'react';
import { Send, Paperclip, Plus, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { AttachmentItem } from '../../store/agentStore';
import { formatFileSize } from '@/lib/utils';

export interface InputPanelProps {
  input: string;
  setInput: (value: string) => void;
  isReceiving: boolean;
  pendingAttachments: AttachmentItem[];
  setPendingAttachments: React.Dispatch<React.SetStateAction<AttachmentItem[]>>;
  onSend: (contentOverride?: string) => void;
  onNewChat: () => void;
  onFileSelection: (files: File[]) => void;
}

export const InputPanel: React.FC<InputPanelProps> = ({
  input,
  setInput,
  isReceiving,
  pendingAttachments,
  setPendingAttachments,
  onSend,
  onNewChat,
  onFileSelection,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
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

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    e.currentTarget.style.height = 'auto';
    e.currentTarget.style.height = `${Math.min(e.currentTarget.scrollHeight, 160)}px`;
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    onFileSelection(files);
    e.target.value = '';
  };

  const removeAttachment = (index: number) => {
    setPendingAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index));
  };

  return (
    <div className="w-full flex justify-center pb-6 pt-4 px-4 bg-gradient-to-t from-background via-background/95 to-transparent z-40 relative">
      <div
        className={`max-w-3xl w-full flex flex-col relative group border border-border/60 bg-card/20 p-4 transition-colors`}
      >
        {pendingAttachments.length ? (
          <div className="mb-3 flex flex-wrap gap-2">
            {pendingAttachments.map((attachment, index) => (
              <div key={`${attachment.fileName}-${index}`} className="flex items-center gap-2 border border-border/60 bg-background/40 px-3 py-2 text-sm">
                <span className="max-w-48 truncate">{attachment.fileName}</span>
                <span className="text-xs text-muted-foreground">{formatFileSize(attachment.size)}</span>
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => removeAttachment(index)}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        ) : null}

        <Textarea
          ref={textareaRef}
          value={input}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder="Mesajınızı yazın veya dosya bırakın..."
          className="min-h-[44px] w-full resize-none bg-transparent border-0 focus-visible:ring-0 rounded-none px-0 py-3 text-base font-light placeholder:text-foreground/20 transition-all duration-500"
          rows={1}
        />

        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          multiple
          onChange={handleFileInputChange}
        />

        <div className="mt-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Button variant="outline" className="rounded-none" onClick={() => fileInputRef.current?.click()}>
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
              <Button onClick={() => onSend()} disabled={!input.trim() && pendingAttachments.length === 0} className="rounded-none">
                <Send className="h-4 w-4" />
                Gönder
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
