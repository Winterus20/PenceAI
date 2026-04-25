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
export const metaBadgeClassName = 'rounded-full border border-border/30 bg-muted/30 px-3 py-1 text-[11px] tracking-wide text-muted-foreground';

export const fieldClassName = 'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 transition-colors';

export const selectClassName = 'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm capitalize ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 transition-colors [&>option]:bg-background [&>option]:text-foreground';

export const textareaClassName = 'flex min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 transition-colors';

/**
 * Badge için ortak stil (MemoryDialog)
 */
export const badgeClassName = 'rounded-full border border-border/30 bg-muted/30 px-3 py-1 text-[11px] tracking-wide text-muted-foreground';

/**
 * Surface label için ortak stil
 * Kullanım: MemoryDialog
 */
export const surfaceLabelClassName = 'mb-4 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground';
