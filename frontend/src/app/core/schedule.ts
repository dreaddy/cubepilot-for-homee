// Zeitpläne: homee speichert dtstart (UTC) + iCal-RRULE mit BYHOUR/BYMINUTE in UTC.
// Der Editor arbeitet mit Ortszeit und rechnet beim Lesen und Schreiben um.

import { locale, t } from './i18n';

export type ScheduleMode = 'daily' | 'weekly' | 'interval' | 'once' | 'advanced';

export interface Schedule {
  mode: ScheduleMode;
  /** HH:MM in Ortszeit */
  time: string;
  /** Wochentage MO..SU in Ortszeit */
  days: string[];
  intervalUnit: 'MINUTELY' | 'HOURLY';
  interval: number;
  /** YYYY-MM-DD (Ortszeit) für "einmalig" */
  date: string;
  /** Roh-RRULE für "erweitert" */
  rrule: string;
}

export const WEEKDAYS: { code: string; label: string }[] = [
  { code: 'MO', label: 'Mo' },
  { code: 'TU', label: 'Di' },
  { code: 'WE', label: 'Mi' },
  { code: 'TH', label: 'Do' },
  { code: 'FR', label: 'Fr' },
  { code: 'SA', label: 'Sa' },
  { code: 'SU', label: 'So' },
];

const CODES = WEEKDAYS.map((d) => d.code);

function parseRule(rrule: string): Record<string, string> {
  return Object.fromEntries(
    rrule
      .split(';')
      .filter(Boolean)
      .map((p) => p.split('=') as [string, string]),
  );
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function shiftDays(days: string[], shift: number): string[] {
  return days.map((d) => CODES[(CODES.indexOf(d) + shift + 7) % 7]).filter(Boolean);
}

/** "20261018T093000Z" -> Date */
function parseDtstart(v: string): Date | null {
  const m = v?.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])) : null;
}

function formatDtstart(d: Date): string {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`;
}

function localDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function emptySchedule(): Schedule {
  return { mode: 'daily', time: '07:00', days: ['MO', 'TU', 'WE', 'TH', 'FR'], intervalUnit: 'MINUTELY', interval: 15, date: localDate(new Date()), rrule: '' };
}

/** Liest dtstart/rrule eines Zeit-Auslösers in die Ortszeit-Darstellung. */
export function scheduleFromFields(dtstart: string, rruleRaw: string): Schedule {
  const s = emptySchedule();
  const rrule = rruleRaw ?? '';
  s.rrule = rrule;
  const start = parseDtstart(dtstart);
  const rule = parseRule(rrule);

  if (!rrule) {
    if (start) {
      s.mode = 'once';
      s.date = localDate(start);
      s.time = `${pad(start.getHours())}:${pad(start.getMinutes())}`;
    }
    return s;
  }

  if ((rule['FREQ'] === 'MINUTELY' || rule['FREQ'] === 'HOURLY') && Object.keys(rule).every((k) => ['FREQ', 'INTERVAL'].includes(k))) {
    s.mode = 'interval';
    s.intervalUnit = rule['FREQ'] as Schedule['intervalUnit'];
    s.interval = Number(rule['INTERVAL'] ?? 1);
    return s;
  }

  const known = new Set(['FREQ', 'INTERVAL', 'BYHOUR', 'BYMINUTE', 'BYSECOND', 'BYDAY']);
  const simple =
    (rule['FREQ'] === 'DAILY' || rule['FREQ'] === 'WEEKLY') &&
    Number(rule['INTERVAL'] ?? 1) === 1 &&
    rule['BYHOUR'] !== undefined &&
    !rule['BYHOUR'].includes(',') &&
    !(rule['BYMINUTE'] ?? '').includes(',') &&
    Number(rule['BYSECOND'] ?? 0) === 0 &&
    (rule['FREQ'] !== 'WEEKLY' || !!rule['BYDAY']) &&
    (!rule['BYDAY'] || rule['BYDAY'].split(',').every((d) => CODES.includes(d))) &&
    Object.keys(rule).every((k) => known.has(k));
  if (!simple) {
    s.mode = 'advanced';
    return s;
  }

  // BYHOUR/BYMINUTE sind UTC -> heutiges Datum zur Umrechnung (Sommer-/Winterzeit des aktuellen Tages)
  const now = new Date();
  const utc = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), Number(rule['BYHOUR']), Number(rule['BYMINUTE'] ?? 0)));
  s.time = `${pad(utc.getHours())}:${pad(utc.getMinutes())}`;
  // Liegt die Ortszeit auf einem anderen Wochentag als die UTC-Zeit, Wochentage verschieben
  const shift = (utc.getDay() - utc.getUTCDay() + 7) % 7;
  const days = rule['BYDAY'] ? rule['BYDAY'].split(',') : [];
  if (rule['FREQ'] === 'WEEKLY' || days.length) {
    s.mode = 'weekly';
    s.days = shiftDays(days, shift === 6 ? -1 : shift);
  } else {
    s.mode = 'daily';
  }
  return s;
}

/** Erzeugt dtstart/rrule (UTC) aus der Ortszeit-Darstellung. */
export function scheduleToFields(s: Schedule): { dtstart: string; rrule: string } {
  const [h, m] = s.time.split(':').map(Number);
  const now = new Date();

  if (s.mode === 'interval') {
    return { dtstart: formatDtstart(now), rrule: `FREQ=${s.intervalUnit};INTERVAL=${Math.max(1, s.interval)}` };
  }
  if (s.mode === 'once') {
    const [y, mo, d] = s.date.split('-').map(Number);
    return { dtstart: formatDtstart(new Date(y, mo - 1, d, h, m)), rrule: '' };
  }
  if (s.mode === 'advanced') {
    return { dtstart: formatDtstart(new Date(now.getFullYear(), now.getMonth(), now.getDate(), h || 0, m || 0)), rrule: s.rrule };
  }

  const local = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m);
  const byTime = `BYHOUR=${local.getUTCHours()};BYMINUTE=${local.getUTCMinutes()}`;
  if (s.mode === 'daily') {
    return { dtstart: formatDtstart(local), rrule: `FREQ=DAILY;INTERVAL=1;${byTime}` };
  }
  const shift = (local.getUTCDay() - local.getDay() + 7) % 7;
  const days = shiftDays(
    CODES.filter((c) => s.days.includes(c)),
    shift === 6 ? -1 : shift,
  );
  return { dtstart: formatDtstart(local), rrule: `FREQ=WEEKLY;INTERVAL=1;BYDAY=${days.join(',')};${byTime}` };
}

export function describeSchedule(s: Schedule): string {
  switch (s.mode) {
    case 'daily':
      return t('täglich um {time}', { time: s.time });
    case 'weekly': {
      const days = WEEKDAYS.filter((d) => s.days.includes(d.code));
      const codes = days.map((d) => d.code).join();
      const label =
        days.length === 7 ? t('täglich') : codes === 'MO,TU,WE,TH,FR' ? t('werktags') : codes === 'SA,SU' ? t('am Wochenende') : days.map((d) => t(d.label)).join(', ');
      return t('{days} um {time}', { days: label, time: s.time });
    }
    case 'interval':
      return s.intervalUnit === 'HOURLY'
        ? t(s.interval === 1 ? 'jede Stunde' : 'alle {n} Stunden', { n: s.interval })
        : t(s.interval === 1 ? 'jede Minute' : 'alle {n} Minuten', { n: s.interval });
    case 'once':
      return t('einmalig am {date} um {time}', { date: new Date(s.date).toLocaleDateString(locale()), time: s.time });
    case 'advanced':
      return t('Regel {rrule}', { rrule: s.rrule });
  }
}
