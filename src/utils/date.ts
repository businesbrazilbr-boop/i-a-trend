import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';

export function formatDateBR(dateString: string, options: {
  short?: boolean;
  relative?: boolean;
} = {}): string {
  const date = parseISO(dateString);

  if (options.relative) {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'agora mesmo';
    if (diffMins < 60) return `há ${diffMins} min`;
    if (diffHours < 24) return `há ${diffHours}h`;
    if (diffDays < 7) return `há ${diffDays}d`;
  }

  if (options.short) {
    return format(date, "dd/MM/yyyy 'às' HH'h'mm", { locale: ptBR });
  }

  return format(date, "EEEE, dd 'de' MMMM 'de' yyyy 'às' HH'h'mm", { locale: ptBR });
}

export function formatDateISO(dateString: string): string {
  return parseISO(dateString).toISOString();
}

export function getTimeAgo(dateString: string): string {
  return formatDateBR(dateString, { relative: true });
}