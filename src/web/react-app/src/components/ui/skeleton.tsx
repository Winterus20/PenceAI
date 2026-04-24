import * as React from 'react';
import { cn } from '@/lib/utils';

interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * Skeleton'ın varyantı
   * - default: Genel amaçlı rectangular skeleton
   * - circular: Dairesel skeleton (avatar vb. için)
   * - text: Metin satırları için skeleton
   */
  variant?: 'default' | 'circular' | 'text';
}

/**
 * Skeleton Component
 * 
 * Yükleme durumlarında içerik yerini alan animasyonlu placeholder.
 * Tailwind'in animate-pulse sınıfını kullanır ve mevcut renk paleti ile uyumludur.
 */
const Skeleton = React.forwardRef<HTMLDivElement, SkeletonProps>(
  ({ className, variant = 'default', ...props }, ref) => {
    const baseClassName = 'animate-pulse rounded-xl bg-white/8';
    
    const variantClassNames = {
      default: 'h-11 w-full',
      circular: 'rounded-full',
      text: 'h-4 w-3/4',
    };

    return (
      <div
        ref={ref}
        className={cn(
          baseClassName,
          variantClassNames[variant],
          className
        )}
        {...props}
      />
    );
  }
);
Skeleton.displayName = 'Skeleton';

/**
 * Form alanı için skeleton grubu
 * Label ve input skeleton'larını birlikte sunar
 */
interface SkeletonFieldProps extends React.HTMLAttributes<HTMLDivElement> {
  labelWidth?: string;
  inputHeight?: string;
}

const SkeletonField = React.forwardRef<HTMLDivElement, SkeletonFieldProps>(
  ({ className, labelWidth = 'w-24', inputHeight = 'h-11', ...props }, ref) => {
    return (
      <div ref={ref} className={cn('space-y-2', className)} {...props}>
        <Skeleton className={cn('h-4', labelWidth)} />
        <Skeleton className={cn('w-full', inputHeight)} />
      </div>
    );
  }
);
SkeletonField.displayName = 'SkeletonField';

/**
 * Section başlığı için skeleton
 * Icon, başlık ve açıklama skeleton'larını içerir
 */
const SkeletonSectionHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => {
  return (
    <div
      ref={ref}
      className={cn('flex items-start gap-3 px-5 pb-4 pt-5 sm:px-6', className)}
      {...props}
    >
      <Skeleton className="h-9 w-9 rounded-2xl" />
      <div className="space-y-1.5">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-4 w-64" />
      </div>
    </div>
  );
});
SkeletonSectionHeader.displayName = 'SkeletonSectionHeader';

/**
 * LLM Settings bölümü için skeleton
 * Kimlik ve Model alanlarını temsil eder
 */
const SkeletonLLMSettings = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => {
  return (
    <div ref={ref} className={cn('space-y-6', className)} {...props}>
      {/* Kimlik ve Model Section */}
      <section className="section-surface rounded-[26px] border-white/6">
        <SkeletonSectionHeader />
        <div className="space-y-4 border-t border-white/6 px-5 py-5 sm:px-6">
          {/* İki sütunlu grid */}
          <div className="grid gap-4 md:grid-cols-2">
            <SkeletonField labelWidth="w-28" />
            <SkeletonField labelWidth="w-20" />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <SkeletonField labelWidth="w-24" />
            <SkeletonField labelWidth="w-16" />
          </div>
        </div>
      </section>

      {/* API Anahtarları Section */}
      <section className="section-surface rounded-[26px] border-white/6">
        <SkeletonSectionHeader />
        <div className="space-y-4 border-t border-white/6 px-5 py-5 sm:px-6">
          <div className="grid gap-4 md:grid-cols-2">
            <SkeletonField labelWidth="w-28" />
            <SkeletonField labelWidth="w-32" />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <SkeletonField labelWidth="w-24" />
            <SkeletonField labelWidth="w-28" />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <SkeletonField labelWidth="w-24" />
            <SkeletonField labelWidth="w-24" />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <SkeletonField labelWidth="w-20" />
            <SkeletonField labelWidth="w-28" />
          </div>
        </div>
      </section>

      {/* Gelişmiş Model Ayarları Section */}
      <section className="section-surface rounded-[26px] border-white/6">
        <SkeletonSectionHeader />
        <div className="space-y-4 border-t border-white/6 px-5 py-5 sm:px-6">
          <div className="grid gap-4 md:grid-cols-2">
            <SkeletonField labelWidth="w-28" />
            <SkeletonField labelWidth="w-24" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-[120px] w-full rounded-[24px]" />
          </div>
        </div>
      </section>
    </div>
  );
});
SkeletonLLMSettings.displayName = 'SkeletonLLMSettings';

/**
 * Security Settings bölümü için skeleton
 */
const SkeletonSecuritySettings = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => {
  return (
    <div ref={ref} className={cn('space-y-6', className)} {...props}>
      {/* Embedding ve Runtime Section */}
      <section className="section-surface rounded-[26px] border-white/6">
        <SkeletonSectionHeader />
        <div className="space-y-4 border-t border-white/6 px-5 py-5 sm:px-6">
          <SkeletonField labelWidth="w-32" />
          <SkeletonField labelWidth="w-28" />
          <SkeletonField labelWidth="w-24" />
          {/* Checkbox skeleton */}
          <div className="section-surface flex items-start gap-3 rounded-[22px] border-white/6 px-4 py-4">
            <Skeleton className="h-4 w-4 rounded" />
            <div className="space-y-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-4 w-64" />
            </div>
          </div>
        </div>
      </section>

      {/* Hassas Dizinler Section */}
      <section className="section-surface rounded-[26px] border-white/6">
        <SkeletonSectionHeader />
        <div className="space-y-4 border-t border-white/6 px-5 py-5 sm:px-6">
          <div className="flex gap-2">
            <Skeleton className="h-11 flex-1" />
            <Skeleton className="h-11 w-11 rounded-2xl" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-10 w-full rounded-[18px]" />
            <Skeleton className="h-10 w-full rounded-[18px]" />
          </div>
        </div>
      </section>
    </div>
  );
});
SkeletonSecuritySettings.displayName = 'SkeletonSecuritySettings';

/**
 * Memory Settings bölümü için skeleton
 */
const SkeletonMemorySettings = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => {
  return (
    <section ref={ref} className={cn('section-surface rounded-[26px] border-white/6', className)} {...props}>
      <SkeletonSectionHeader />
      <div className="border-t border-white/6 px-5 py-5 sm:px-6">
        <div className="grid gap-4 sm:grid-cols-3">
          <SkeletonField labelWidth="w-32" />
          <SkeletonField labelWidth="w-36" />
          <SkeletonField labelWidth="w-36" />
        </div>
      </div>
    </section>
  );
});
SkeletonMemorySettings.displayName = 'SkeletonMemorySettings';

/**
 * Settings Dialog için tam skeleton layout
 */
const SkeletonSettingsDialog = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => {
  return (
    <div
      ref={ref}
      className={cn(
        'glass-panel flex h-full w-full flex-col overflow-hidden text-foreground',
        className
      )}
      {...props}
    >
      {/* Header */}
      <div className="border-b border-white/6 bg-white/[0.015] px-6 py-5 sm:px-7 sm:py-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <Skeleton className="h-11 w-11 rounded-2xl" />
              <Skeleton className="h-8 w-32" />
            </div>
            <Skeleton className="h-4 w-96" />
          </div>
          <div className="flex flex-wrap gap-2 lg:max-w-md lg:justify-end">
            <Skeleton className="h-6 w-20 rounded-full" />
            <Skeleton className="h-6 w-24 rounded-full" />
            <Skeleton className="h-6 w-28 rounded-full" />
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="subtle-scrollbar min-h-0 flex-1 overflow-y-auto bg-gradient-to-b from-white/[0.01] to-transparent">
        <div className="grid gap-5 px-6 py-6 sm:px-7 xl:grid-cols-[1.12fr_0.88fr]">
          <SkeletonLLMSettings />
          <div className="space-y-6">
            <SkeletonSecuritySettings />
            <SkeletonMemorySettings />
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="flex flex-col gap-4 border-t border-white/6 bg-white/[0.02] px-6 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-7">
        <Skeleton className="h-4 w-80" />
        <Skeleton className="h-11 w-48 rounded-2xl" />
      </div>
    </div>
  );
});
SkeletonSettingsDialog.displayName = 'SkeletonSettingsDialog';

export {
  Skeleton,
  SkeletonField,
  SkeletonSectionHeader,
  SkeletonLLMSettings,
  SkeletonSecuritySettings,
  SkeletonMemorySettings,
  SkeletonSettingsDialog,
};
