import React, { useRef } from 'react';
import { Send, Plus, Loader2, X } from 'lucide-react';
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
  onFileSelection: (files: File[]) => void;
}

export const InputPanel: React.FC<InputPanelProps> = ({
  input,
  setInput,
  isReceiving,
  pendingAttachments,
  setPendingAttachments,
  onSend,
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
    <div className="w-full flex justify-center pb-6 pt-2 z-40 relative">
      <div className="max-w-3xl w-full flex flex-col relative bg-[#2f2f2f] rounded-[26px] border border-transparent focus-within:border-white/10 transition-colors shadow-sm">
        
        {/* Attachments preview area */}
        {pendingAttachments.length ? (
          <div className="px-4 pt-4 pb-1 flex flex-wrap gap-3">
            {pendingAttachments.map((attachment, index) => (
              <div key={`${attachment.fileName}-${index}`} className="flex flex-col relative group rounded-xl border border-white/10 bg-[#212121] p-2 w-16 h-16 justify-center items-center shadow-sm">
                <span className="text-[10px] font-medium truncate w-full text-center text-foreground/80 px-1" title={attachment.fileName}>
                  {attachment.fileName.length > 8 ? attachment.fileName.substring(0, 8) + '...' : attachment.fileName}
                </span>
                <span className="text-[9px] text-muted-foreground mt-1">{formatFileSize(attachment.size)}</span>
                <button
                  type="button"
                  className="absolute -top-2 -right-2 bg-foreground text-background hover:bg-foreground/80 rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity shadow-md"
                  onClick={() => removeAttachment(index)}
                >
                  <X size={12} strokeWidth={3} />
                </button>
              </div>
            ))}
          </div>
        ) : null}

        <div className="flex items-end gap-2 px-3 py-3">
          {/* File Attachment Button */}
          <Button 
            variant="ghost" 
            size="icon" 
            className="flex-shrink-0 h-8 w-8 rounded-full bg-white/5 hover:bg-white/10 text-foreground" 
            onClick={() => fileInputRef.current?.click()}
            title="Dosya Ekle"
          >
            <Plus size={18} strokeWidth={2.5} />
          </Button>

          {/* Text Area */}
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder="Ne üzerinde çalışıyorsun? (Sohbet veya dosya bırak...)"
            className="flex-1 min-h-[32px] max-h-[200px] resize-none bg-transparent border-0 focus-visible:ring-0 rounded-none px-1 py-1 text-[15px] font-normal placeholder:text-muted-foreground/80 transition-all subtle-scrollbar"
            rows={1}
            style={{ lineHeight: '32px' }}
          />

          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            multiple
            onChange={handleFileInputChange}
          />

          {/* Action Buttons (Send) */}
          <div className="flex-shrink-0 flex items-center justify-center h-8 w-8 mb-0.5">
            {isReceiving ? (
              <Loader2 className="animate-spin w-5 h-5 text-foreground/50" />
            ) : (
              <Button 
                onClick={() => onSend()} 
                disabled={!input.trim() && pendingAttachments.length === 0} 
                className={`h-8 w-8 rounded-full p-0 transition-all flex items-center justify-center border-0 ${input.trim() || pendingAttachments.length ? 'bg-white text-black hover:bg-gray-200' : 'bg-[#1e1e1e] text-white/30'}`}
              >
                 <Send className="h-4 w-4 relative right-[1px]" strokeWidth={2} />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
