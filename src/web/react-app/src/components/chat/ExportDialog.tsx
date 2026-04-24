import React, { useState } from 'react';
import { Download, FileText, FileJson } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface ExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversationTitle: string;
  messages: any[];
}

type ExportFormat = 'md' | 'json';

export const ExportDialog: React.FC<ExportDialogProps> = ({
  open,
  onOpenChange,
  conversationTitle,
  messages,
}) => {
  const [selectedFormat, setSelectedFormat] = useState<ExportFormat>('md');
  const [isExporting, setIsExporting] = useState(false);

  const formatDate = (date: Date): string => {
    return date.toISOString().slice(0, 10);
  };

  const formatDateTime = (date: Date): string => {
    return date.toLocaleString('tr-TR', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const generateMarkdown = (): string => {
    const title = conversationTitle || 'Sohbet';
    const now = new Date();
    
    let markdown = `# Sohbet: ${title}\n\n`;
    markdown += `**Tarih:** ${formatDateTime(now)}\n\n`;
    markdown += `---\n\n`;

    messages.forEach((message) => {
      const role = message.role === 'user' ? 'Kullanıcı' : 'Asistan';
      const content = message.content || '';
      
      markdown += `## ${role}\n\n${content}\n\n`;
      
      // Düşünce süreci varsa ekle
      if (message.thinking && Array.isArray(message.thinking) && message.thinking.length > 0) {
        markdown += `### Düşünce Süreci\n\n`;
        message.thinking.forEach((think: string) => {
          markdown += `> ${think}\n\n`;
        });
      }
      
      // Araç çağrıları varsa ekle
      if (message.toolCalls && Array.isArray(message.toolCalls) && message.toolCalls.length > 0) {
        markdown += `### Kullanılan Araçlar\n\n`;
        message.toolCalls.forEach((tool: any) => {
          markdown += `- **${tool.name}**: ${tool.result || 'Sonuç yok'}\n`;
        });
        markdown += '\n';
      }
    });

    markdown += `---\n\n*PenceAI ile dışa aktarıldı.*\n`;
    
    return markdown;
  };

  const generateJSON = (): string => {
    const title = conversationTitle || 'Sohbet';
    const now = new Date();

    const exportData = {
      title,
      exportedAt: now.toISOString(),
      messageCount: messages.length,
      messages: messages.map((message) => ({
        role: message.role,
        content: message.content || '',
        timestamp: message.timestamp,
        thinking: message.thinking || undefined,
        toolCalls: message.toolCalls || undefined,
      })),
    };

    return JSON.stringify(exportData, null, 2);
  };

  const handleExport = async () => {
    if (!messages.length) return;

    setIsExporting(true);

    try {
      const content = selectedFormat === 'md' ? generateMarkdown() : generateJSON();
      const mimeType = selectedFormat === 'md' ? 'text/markdown' : 'application/json';
      const extension = selectedFormat === 'md' ? 'md' : 'json';

      const blob = new Blob([content], { type: mimeType });
      const url = URL.createObjectURL(blob);
      
      const fileName = `${(conversationTitle || 'sohbet').replace(/[^\w\-. ]/g, '_')}-${formatDate(new Date())}.${extension}`;
      
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);

      onOpenChange(false);
    } catch (error) {
      console.error('Dışa aktarma hatası:', error);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download className="h-5 w-5" />
            Sohbeti Dışa Aktar
          </DialogTitle>
          <DialogDescription>
            Aktif sohbeti seçtiğiniz formatta indirin.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-2 gap-4">
            {/* Markdown Seçeneği */}
            <button
              type="button"
              onClick={() => setSelectedFormat('md')}
              className={`flex flex-col items-center gap-3 p-4 rounded-xl border transition-all ${
                selectedFormat === 'md'
                  ? 'border-violet-500/50 bg-violet-500/10 text-violet-400'
                  : 'border-border/60 bg-card/40 hover:bg-card/60 text-foreground/80'
              }`}
            >
              <FileText className="h-8 w-8" />
              <div className="text-center">
                <div className="font-medium">Markdown</div>
                <div className="text-xs text-muted-foreground">.md dosyası</div>
              </div>
            </button>

            {/* JSON Seçeneği */}
            <button
              type="button"
              onClick={() => setSelectedFormat('json')}
              className={`flex flex-col items-center gap-3 p-4 rounded-xl border transition-all ${
                selectedFormat === 'json'
                  ? 'border-violet-500/50 bg-violet-500/10 text-violet-400'
                  : 'border-border/60 bg-card/40 hover:bg-card/60 text-foreground/80'
              }`}
            >
              <FileJson className="h-8 w-8" />
              <div className="text-center">
                <div className="font-medium">JSON</div>
                <div className="text-xs text-muted-foreground">.json dosyası</div>
              </div>
            </button>
          </div>

          {/* Önizleme Bilgisi */}
          <div className="text-sm text-muted-foreground bg-card/30 rounded-lg p-3">
            <div className="flex justify-between mb-1">
              <span>Sohbet:</span>
              <span className="text-foreground">{conversationTitle || 'Yeni Sohbet'}</span>
            </div>
            <div className="flex justify-between">
              <span>Mesaj sayısı:</span>
              <span className="text-foreground">{messages.length}</span>
            </div>
          </div>
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            className="w-full sm:w-auto"
          >
            İptal
          </Button>
          <Button
            onClick={handleExport}
            disabled={isExporting || !messages.length}
            className="w-full sm:w-auto bg-violet-600 hover:bg-violet-700"
          >
            {isExporting ? (
              <>
                <span className="animate-spin mr-2">⏳</span>
                İndiriliyor...
              </>
            ) : (
              <>
                <Download className="h-4 w-4 mr-2" />
                İndir
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
