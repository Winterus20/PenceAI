/**
 * Güvenlik varsayılanları — config ve otonom onay modülleri tarafından paylaşılır.
 */

/** Zamanlanmış (cron) görevlerde otomatik onaylanacak read-only builtin tool'lar */
export const DEFAULT_AUTONOMOUS_AUTO_APPROVE_TOOLS = [
  'readFile',
  'listDirectory',
  'searchFiles',
  'searchMemory',
  'searchConversation',
  'webSearch',
  'list_timers',
] as const;

export type AutonomousAutoApproveTool = (typeof DEFAULT_AUTONOMOUS_AUTO_APPROVE_TOOLS)[number];
