import React, { useState, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Copy,
  Check,
  Maximize2,
  Minimize2,
  FileCode2,
  FileText,
  Download,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { CodeBlock } from '../chat/CodeBlock';

/* ─── Types ─── */

export interface CanvasArtifact {
  id: string;
  title: string;
  content: string;
  language?: string;
  type: 'code' | 'markdown' | 'text' | 'mermaid';
  createdAt: string;
}

export interface CanvasPanelProps {
  artifact: CanvasArtifact | null;
  onClose: () => void;
  className?: string;
}

/* ─── Language Detection ─── */

function detectLanguage(content: string, language?: string): string {
  if (language) return language;

  // Simple heuristics
  if (content.includes('import ') && (content.includes('from ') || content.includes('require('))) return 'typescript';
  if (content.includes('def ') && content.includes(':')) return 'python';
  if (content.includes('func ') && content.includes('{')) return 'go';
  if (content.includes('fn ') && content.includes('->')) return 'rust';
  if (content.includes('<html>') || content.includes('<!DOCTYPE')) return 'html';
  if (content.includes('{') && content.includes('"')) {
    try { JSON.parse(content); return 'json'; } catch { /* noop */ }
  }
  if (content.startsWith('---') || content.includes('# ')) return 'markdown';

  return 'text';
}

function getLanguageIcon(lang: string): React.ReactNode {
  switch (lang) {
    case 'markdown':
    case 'text':
      return <FileText size={14} />;
    default:
      return <FileCode2 size={14} />;
  }
}

const LANG_DISPLAY: Record<string, string> = {
  typescript: 'TypeScript',
  javascript: 'JavaScript',
  python: 'Python',
  go: 'Go',
  rust: 'Rust',
  html: 'HTML',
  css: 'CSS',
  json: 'JSON',
  markdown: 'Markdown',
  text: 'Text',
  mermaid: 'Mermaid',
  sql: 'SQL',
  bash: 'Bash',
  yaml: 'YAML',
};

/* ─── Main Component ─── */

export const CanvasPanel: React.FC<CanvasPanelProps> = ({ artifact, onClose, className }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const lang = useMemo(
    () => (artifact ? detectLanguage(artifact.content, artifact.language) : 'text'),
    [artifact],
  );

  const handleCopy = useCallback(() => {
    if (!artifact) return;
    navigator.clipboard.writeText(artifact.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [artifact]);

  const handleDownload = useCallback(() => {
    if (!artifact) return;
    const ext =
      lang === 'typescript' ? '.ts'
      : lang === 'javascript' ? '.js'
      : lang === 'python' ? '.py'
      : lang === 'markdown' ? '.md'
      : lang === 'json' ? '.json'
      : lang === 'html' ? '.html'
      : lang === 'css' ? '.css'
      : '.txt';
    const blob = new Blob([artifact.content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${artifact.title.replace(/\s+/g, '_').toLowerCase()}${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  }, [artifact, lang]);

  const lineCount = useMemo(
    () => (artifact?.content || '').split('\n').length,
    [artifact],
  );

  return (
    <AnimatePresence>
      {artifact && (
        <motion.div
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: isExpanded ? '60%' : '42%', opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
          className={cn(
            'flex-shrink-0 h-full border-l border-white/[0.06] bg-[#0d0d0d] flex flex-col overflow-hidden',
            className,
          )}
        >
          {/* Header */}
          <header className="flex items-center justify-between px-4 py-2.5 border-b border-white/[0.06] bg-[#111]/80 backdrop-blur-sm">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="flex-shrink-0 p-1 rounded bg-purple-500/15 text-purple-300">
                {getLanguageIcon(lang)}
              </span>
              <div className="min-w-0">
                <h3 className="text-[13px] font-semibold text-foreground/90 truncate">
                  {artifact.title}
                </h3>
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground/50">
                  <span>{LANG_DISPLAY[lang] || lang}</span>
                  <span>•</span>
                  <span>{lineCount} satır</span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 rounded-lg hover:bg-white/8 text-muted-foreground hover:text-foreground transition-colors"
                onClick={handleCopy}
                title="Kopyala"
              >
                {copied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 rounded-lg hover:bg-white/8 text-muted-foreground hover:text-foreground transition-colors"
                onClick={handleDownload}
                title="İndir"
              >
                <Download size={13} />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 rounded-lg hover:bg-white/8 text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => setIsExpanded((v) => !v)}
                title={isExpanded ? 'Küçült' : 'Genişlet'}
              >
                {isExpanded ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 rounded-lg hover:bg-white/8 text-muted-foreground hover:text-foreground transition-colors"
                onClick={onClose}
                title="Kapat"
              >
                <X size={13} />
              </Button>
            </div>
          </header>

          {/* Content */}
          <div className="flex-1 overflow-auto subtle-scrollbar">
            {artifact.type === 'markdown' ? (
              <div className="px-6 py-5 prose dark:prose-invert max-w-none prose-pre:bg-black/40 prose-pre:border prose-pre:border-white/5 prose-pre:rounded-xl prose-pre:p-4">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    code(props: React.ClassAttributes<HTMLElement> & React.HTMLAttributes<HTMLElement> & { inline?: boolean; className?: string }) {
                      const { inline, className, children } = props;
                      if (inline) {
                        return <code className="bg-card/70 px-1.5 py-0.5 text-sm rounded">{children}</code>;
                      }
                      return <CodeBlock className={className}>{children}</CodeBlock>;
                    },
                  }}
                >
                  {artifact.content}
                </ReactMarkdown>
              </div>
            ) : (
              <div className="relative">
                {/* Line numbers + content */}
                <div className="flex">
                  {/* Line numbers gutter */}
                  <div className="flex-shrink-0 py-4 pr-3 pl-4 text-right select-none border-r border-white/[0.04] bg-[#0a0a0a]">
                    {artifact.content.split('\n').map((_, i) => (
                      <div
                        key={i}
                        className="text-[11px] leading-[1.7] font-mono text-muted-foreground/25"
                      >
                        {i + 1}
                      </div>
                    ))}
                  </div>

                  {/* Code content */}
                  <pre className="flex-1 py-4 px-4 overflow-x-auto text-[13px] leading-[1.7] font-mono text-foreground/85">
                    <code>{artifact.content}</code>
                  </pre>
                </div>
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

CanvasPanel.displayName = 'CanvasPanel';
