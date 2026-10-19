import { locale, t } from './i18n';

/** „vor 5 Min.“ / “5 min ago”, „gestern“ / “yesterday”, sonst Datum */
export function relativeTime(iso: string | null): string {
  if (!iso) return t('nie');
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return t('gerade eben');
  if (diff < 3600) return t('vor {n} Min.', { n: Math.floor(diff / 60) });
  if (diff < 86400) return t('vor {n} Std.', { n: Math.floor(diff / 3600) });
  if (diff < 2 * 86400) return t('gestern');
  if (diff < 7 * 86400) return t('vor {n} Tagen', { n: Math.floor(diff / 86400) });
  return new Date(iso).toLocaleDateString(locale(), { day: '2-digit', month: '2-digit', year: '2-digit' });
}
