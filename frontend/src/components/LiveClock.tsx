'use client';

import { useEffect, useState } from 'react';
import { ClockIcon } from '@heroicons/react/24/outline';

interface LiveClockProps {
  locale?: string;
}

function formatClock(locale: string, now: Date) {
  const time = new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(now);

  const date = new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  }).format(now);

  return { time, date };
}

export default function LiveClock({ locale = 'en' }: LiveClockProps) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(new Date());
    }, 1000);

    return () => window.clearInterval(timer);
  }, []);

  const { time, date } = formatClock(locale, now);

  return (
    <div className="flex min-w-48 items-center gap-3 rounded-2xl border border-border bg-surface-secondary px-4 py-2 text-sm text-text-secondary shadow-sm transition-colors duration-200 hover:bg-surface">
      <span
        aria-hidden="true"
        className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600"
      >
        <ClockIcon className="h-5 w-5" />
      </span>

      <div className="min-w-0 leading-tight">
        <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-text-muted">
          Live time
        </div>
        <div className="font-mono text-base font-semibold tabular-nums tracking-[0.14em] text-text-primary">
          {time}
        </div>
        <div className="truncate text-xs text-text-muted">{date}</div>
      </div>
    </div>
  );
}