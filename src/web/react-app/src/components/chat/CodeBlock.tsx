import React from 'react';
import { Copy, Check } from 'lucide-react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';

interface CodeBlockProps {
  children?: React.ReactNode;
  className?: string;
}

// Custom theme overrides to match PenceAI dark aesthetics
const customStyle: Record<string, React.CSSProperties> = {
  ...oneDark,
  'pre[class*="language-"]': {
    ...(oneDark['pre[class*="language-"]'] as React.CSSProperties),
    background: 'transparent',
    margin: 0,
    padding: '1rem',
    fontSize: '0.875rem',
    lineHeight: '1.625',
  },
  'code[class*="language-"]': {
    ...(oneDark['code[class*="language-"]'] as React.CSSProperties),
    background: 'transparent',
  },
};

export const CodeBlock: React.FC<CodeBlockProps> = React.memo(({ children, className }) => {
  const [copied, setCopied] = React.useState(false);
  const codeText = React.useMemo(() => String(children).replace(/\n$/, ''), [children]);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(codeText);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  const language = className?.replace('language-', '') || 'text';

  return (
    <div className="border border-border/70 bg-background/40 rounded-xl overflow-hidden my-3">
      <div className="flex items-center justify-between border-b border-border/70 px-3 py-2 text-label text-muted-foreground">
        <span className="text-[11px] uppercase tracking-wider font-medium">{language}</span>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-wider font-medium text-foreground/60 hover:text-foreground transition-colors"
          onClick={handleCopy}
        >
          {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
          {copied ? 'Kopyalandı' : 'Kopyala'}
        </button>
      </div>
      <SyntaxHighlighter
        language={language}
        style={customStyle}
        customStyle={{
          background: 'transparent',
          margin: 0,
          padding: '1rem',
        }}
        codeTagProps={{
          style: {
            fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
            fontSize: '0.8125rem',
            lineHeight: '1.625',
          },
        }}
      >
        {codeText}
      </SyntaxHighlighter>
    </div>
  );
});

CodeBlock.displayName = 'CodeBlock';
