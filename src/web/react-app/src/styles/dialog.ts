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
export const metaBadgeClassName = 'rounded-full border border-white/5 bg-white/5 px-3 py-1 text-[11px] tracking-wide text-muted-foreground';

export const fieldClassName = 'h-11 rounded-2xl w-full px-3.5 border border-white/10 bg-black/20 text-sm text-foreground shadow-inner placeholder:text-white/30 focus:border-purple-500/30 focus:bg-black/40 focus:ring-2 focus:ring-purple-500/10 transition-all outline-none';

export const selectClassName = 'flex h-11 w-full rounded-2xl border border-white/10 bg-black/20 px-3.5 text-sm capitalize text-foreground shadow-inner outline-none transition-all focus:border-purple-500/30 focus:bg-black/40 focus:ring-2 focus:ring-purple-500/10 [&>option]:bg-[#141414] [&>option]:text-white';

export const textareaClassName = 'min-h-[220px] p-4 w-full rounded-[24px] border border-white/10 bg-black/20 text-sm leading-relaxed text-foreground shadow-inner placeholder:text-white/30 outline-none focus:border-purple-500/30 focus:bg-black/40 focus:ring-2 focus:ring-purple-500/10 transition-all';

/**
 * Badge için ortak stil (MemoryDialog)
 */
export const badgeClassName = 'rounded-full border border-white/5 bg-white/5 px-3 py-1 text-[11px] tracking-wide text-muted-foreground';

/**
 * Surface label için ortak stil
 * Kullanım: MemoryDialog
 */
export const surfaceLabelClassName = 'mb-4 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground';
