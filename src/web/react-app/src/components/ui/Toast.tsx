import React, { useEffect } from 'react';
import { CheckCircle, XCircle, Info, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ToastProps {
  message: string;
  type?: 'success' | 'error' | 'info';
  isVisible: boolean;
  onClose?: () => void;
}

const iconMap = {
  success: CheckCircle,
  error: XCircle,
  info: Info,
};

const colorMap = {
  success: 'bg-emerald-500/90 border-emerald-400',
  error: 'bg-destructive/90 border-destructive',
  info: 'bg-foreground/90 border-foreground/50',
};

export const Toast: React.FC<ToastProps> = ({
  message,
  type = 'info',
  isVisible,
  onClose,
}) => {
  useEffect(() => {
    if (isVisible && onClose) {
      const timer = setTimeout(onClose, 3000);
      return () => clearTimeout(timer);
    }
  }, [isVisible, onClose]);

  if (!isVisible) return null;

  const Icon = iconMap[type];

  return (
    <div
      className={cn(
        'fixed bottom-20 left-1/2 -translate-x-1/2 z-50',
        'flex items-center gap-3 px-4 py-3 rounded-none border',
        'text-sm font-medium text-background shadow-lg',
        'animate-in slide-in-from-bottom-4 fade-in duration-300',
        colorMap[type]
      )}
    >
      <Icon size={16} />
      <span>{message}</span>
      {onClose && (
        <button
          onClick={onClose}
          className="ml-2 text-background/70 hover:text-background transition-colors"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
};
