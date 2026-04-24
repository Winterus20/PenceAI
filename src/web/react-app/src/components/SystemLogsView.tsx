import { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal, Search, AlertTriangle, X, ChevronDown, ChevronRight } from 'lucide-react';

interface LogEntry {
  id: string;
  timestamp: string;
  level: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  msg: string;
  traceId?: string;
  [key: string]: unknown;
}

const LEVEL_COLORS: Record<string, string> = {
  trace: 'text-gray-500',
  debug: 'text-blue-400',
  info: 'text-green-400',
  warn: 'text-yellow-400',
  error: 'text-red-400',
  fatal: 'text-red-600 font-bold',
};

const LEVEL_BG: Record<string, string> = {
  trace: 'bg-gray-500/5',
  debug: 'bg-blue-500/5',
  info: 'bg-green-500/5',
  warn: 'bg-yellow-500/5',
  error: 'bg-red-500/10',
  fatal: 'bg-red-600/20',
};

export default function SystemLogsView() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [showErrorsOnly, setShowErrorsOnly] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const shouldAutoScroll = useRef(true);

  // İlk yüklemede geçmiş logları çek
  useEffect(() => {
    fetch('/api/logs?limit=1000')
      .then((res) => res.json())
      .then((data) => {
        if (data.success && Array.isArray(data.logs)) {
          setLogs(data.logs);
        }
      })
      .catch((err) => console.error('[SystemLogsView] Failed to fetch logs:', err));
  }, []);

  // Canlı log dinleyicisi
  useEffect(() => {
    const handleSysLog = (event: Event) => {
      const entry = (event as CustomEvent).detail as LogEntry;
      if (!entry) return;
      setLogs((prev) => {
        const next = [...prev, entry];
        if (next.length > 1000) next.shift();
        return next;
      });
    };

    window.addEventListener('sys_log', handleSysLog);
    setIsConnected(true);

    return () => {
      window.removeEventListener('sys_log', handleSysLog);
      setIsConnected(false);
    };
  }, []);

  // Auto-scroll en alta
  useEffect(() => {
    if (shouldAutoScroll.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
    shouldAutoScroll.current = nearBottom;
  }, []);

  const filteredLogs = logs.filter((log) => {
    const matchesSearch =
      !searchQuery ||
      log.msg.toLowerCase().includes(searchQuery.toLowerCase()) ||
      log.level.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (log.traceId && log.traceId.toLowerCase().includes(searchQuery.toLowerCase()));

    const matchesLevel = !showErrorsOnly || log.level === 'error' || log.level === 'fatal';

    return matchesSearch && matchesLevel;
  });

  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  const formatTime = (iso: string) => {
    try {
      const d = new Date(iso);
      return d.toLocaleTimeString('tr-TR', { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3, '0');
    } catch {
      return iso;
    }
  };

  return (
    <div className="flex flex-col h-screen w-full bg-[#0a0a0a] text-gray-200 font-mono text-sm">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 bg-[#111]">
        <div className="flex items-center gap-2">
          <Terminal className="h-4 w-4 text-green-400" />
          <span className="font-semibold text-gray-100">Sistem Logları</span>
          <span
            className={`ml-2 inline-flex h-2 w-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`}
            title={isConnected ? 'Canlı akış bağlı' : 'Bağlantı kesik'}
          />
        </div>
        <div className="flex items-center gap-3">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Ara..."
              className="pl-8 pr-7 py-1.5 rounded-md bg-white/5 border border-white/10 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-green-500/50 w-56"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>

          {/* Error filter */}
          <button
            onClick={() => setShowErrorsOnly((v) => !v)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              showErrorsOnly
                ? 'bg-red-500/20 text-red-300 border border-red-500/30'
                : 'bg-white/5 text-gray-400 border border-white/10 hover:bg-white/10'
            }`}
          >
            <AlertTriangle className="h-3.5 w-3.5" />
            Sadece Hatalar
          </button>

          <div className="text-xs text-gray-600">
            {filteredLogs.length} / {logs.length}
          </div>
        </div>
      </div>

      {/* Log List */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-2 py-2 space-y-0.5"
      >
        {filteredLogs.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-600 text-sm">
            {logs.length === 0 ? 'Henüz log kaydı bulunmuyor...' : 'Eşleşen log bulunamadı'}
          </div>
        ) : (
          filteredLogs.map((log) => {
            const isExpanded = expandedId === log.id;
            const hasDetails = Object.keys(log).some(
              (k) => !['id', 'timestamp', 'level', 'msg', 'traceId'].includes(k)
            );

            return (
              <div
                key={log.id}
                className={`group rounded px-2 py-1 transition-colors ${LEVEL_BG[log.level] || ''} hover:bg-white/5`}
              >
                <div className="flex items-start gap-2 cursor-pointer" onClick={() => hasDetails && toggleExpand(log.id)}>
                  {hasDetails && (
                    <span className="mt-0.5 text-gray-500">
                      {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                    </span>
                  )}
                  <span className="text-gray-500 text-xs shrink-0 w-20 text-right select-none">
                    {formatTime(log.timestamp)}
                  </span>
                  <span
                    className={`text-xs font-bold shrink-0 w-12 text-center uppercase select-none ${
                      LEVEL_COLORS[log.level] || 'text-gray-400'
                    }`}
                  >
                    {log.level}
                  </span>
                  <span className="text-gray-200 break-all leading-relaxed">{log.msg}</span>
                  {log.traceId && (
                    <span className="text-[10px] text-gray-600 shrink-0 ml-auto select-none">[{log.traceId.slice(0, 8)}]</span>
                  )}
                </div>

                {/* Expanded JSON Details */}
                {isExpanded && hasDetails && (
                  <div className="mt-2 ml-24 p-3 rounded-md bg-black/40 border border-white/5 overflow-x-auto">
                    <pre className="text-xs text-gray-400 leading-relaxed">
                      {JSON.stringify(
                        Object.fromEntries(
                          Object.entries(log).filter(([k]) => !['id', 'timestamp', 'level', 'msg', 'traceId'].includes(k))
                        ),
                        null,
                        2
                      )}
                    </pre>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
