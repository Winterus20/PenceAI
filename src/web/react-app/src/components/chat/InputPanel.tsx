import React, { useRef } from 'react';
import { Send, Plus, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { AttachmentItem } from '../../store/agentStore';
import { formatFileSize } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';

export interface InputPanelProps {
  input: string;
  setInput: (value: string) => void;
  isReceiving: boolean;
  pendingAttachments: AttachmentItem[];
  onRemoveAttachment: (index: number) => void;
  onSend: (contentOverride?: string) => void;
  onFileSelection: (files: File[]) => void;
  onSent?: () => void;
}

export const InputPanel: React.FC<InputPanelProps> = ({
  input,
  setInput,
  isReceiving,
  pendingAttachments,
  onRemoveAttachment,
  onSend,
  onFileSelection,
  onSent,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSend();
      resetTextareaHeight();
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

  const resetTextareaHeight = () => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
    onSent?.();
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    onFileSelection(files);
    e.target.value = '';
  };

  const removeAttachment = (index: number) => {
    onRemoveAttachment(index);
  };

  return (
    <div className="w-full flex justify-center pb-6 pt-2 z-40 relative">
      <div className="max-w-3xl w-full flex flex-col relative bg-[#1c1c1c]/90 backdrop-blur-md rounded-[28px] border border-border/40 focus-within:border-purple-500/30 focus-within:ring-2 focus-within:ring-purple-500/10 focus-within:bg-[#1f1f1f]/95 transition-all duration-300 shadow-xl">
        
        {/* Attachments preview area */}
        <AnimatePresence>
          {pendingAttachments.length > 0 && (
            <motion.div 
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="px-4 pt-4 pb-1 flex flex-wrap gap-3 overflow-hidden origin-top"
            >
              {pendingAttachments.map((attachment, index) => (
                <motion.div 
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.8, opacity: 0 }}
                  key={`${attachment.fileName}-${index}`} 
                  className="flex flex-col relative group rounded-xl border border-white/10 bg-[#2a2a2a] p-2 w-16 h-16 justify-center items-center shadow-sm"
                >
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
                </motion.div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

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
                onClick={() => { onSend(); resetTextareaHeight(); }}
                disabled={!input.trim() && pendingAttachments.length === 0} 
                className={`h-8 w-8 rounded-full p-0 transition-all duration-300 flex items-center justify-center border-0 ${input.trim() || pendingAttachments.length ? 'bg-purple-600 text-white hover:bg-purple-500 glow-pulse hover:scale-110' : 'bg-[#2a2a2a] text-white/30'}`}
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
