/**
 * Dialog bileşenleri için ortak className sabitleri
 * DRY prensibi gereği tekrarlanan stiller burada merkezi olarak tanımlanmıştır.
 *
 * Tailwind Theme Kullanımı:
 * - border-surface: rgba(255, 255, 255, 0.06)
 * - bg-surface-{xs,sm,DEFAULT,md,lg,xl}: surface arka plan renkleri
 * - text-surface-{muted,subtle,DEFAULT,strong,emphasis}: metin renkleri
 */

/**
 * Meta badge için ortak stil
 * Kullanım: SettingsDialog, MemoryDialog
 */
export const metaBadgeClassName = 'rounded-full border border-surface bg-surface-md px-3 py-1 text-[11px] tracking-[0.02em] text-surface-subtle';

/**
 * Form alanları için ortak stiller
 * Kullanım: MemoryDialog
 */
export const fieldClassName = 'field-surface h-11 rounded-2xl border-surface bg-surface text-sm text-surface-emphasis shadow-none placeholder:text-surface-muted focus:border-white/12 focus:bg-surface-lg';

export const selectClassName = 'field-surface flex h-11 w-full rounded-2xl border-surface bg-surface px-3.5 text-sm capitalize text-surface-emphasis shadow-none outline-none transition focus:border-white/12 focus:bg-surface-lg focus:ring-2 focus:ring-white/10 [&>option]:bg-[hsl(0,0%,10%)] [&>option]:text-white';

export const textareaClassName = 'field-surface min-h-[220px] rounded-[24px] border-surface bg-surface text-sm leading-7 text-surface-emphasis shadow-none placeholder:text-surface-muted focus:border-white/12 focus:bg-surface-lg';

/**
 * Badge için ortak stil (MemoryDialog)
 */
export const badgeClassName = 'rounded-full border border-surface bg-surface-md px-3 py-1 text-[11px] tracking-[0.02em] text-surface-subtle';

/**
 * Surface label için ortak stil
 * Kullanım: MemoryDialog
 */
export const surfaceLabelClassName = 'mb-4 flex items-center gap-2 text-[11px] tracking-[0.08em] text-surface';
