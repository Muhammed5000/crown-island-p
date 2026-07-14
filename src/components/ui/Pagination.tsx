import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/cn';

interface Props {
  currentPage: number;
  totalPages: number;
  baseUrl: string;
  searchParams: Record<string, string | string[] | undefined>;
}

export function Pagination({ currentPage, totalPages, baseUrl, searchParams }: Props) {
  if (totalPages <= 1) return null;

  function getPageUrl(page: number) {
    const params = new URLSearchParams();
    Object.entries(searchParams).forEach(([key, value]) => {
      if (value !== undefined && key !== 'page') {
        if (Array.isArray(value)) {
          value.forEach((v) => params.append(key, v));
        } else {
          params.append(key, value as string);
        }
      }
    });
    if (page > 1) {
      params.set('page', String(page));
    }
    const qs = params.toString();
    return `${baseUrl}${qs ? `?${qs}` : ''}`;
  }

  // Generate page numbers to show: current, 2 before, 2 after, first, last
  const pages = new Set<number>();
  pages.add(1);
  pages.add(totalPages);
  for (let i = Math.max(1, currentPage - 2); i <= Math.min(totalPages, currentPage + 2); i++) {
    pages.add(i);
  }

  const sortedPages = Array.from(pages).sort((a, b) => a - b);
  const items: (number | 'ellipsis')[] = [];
  
  for (let i = 0; i < sortedPages.length; i++) {
    const cur = sortedPages[i]!;
    const prev = sortedPages[i - 1];
    if (i > 0 && prev !== undefined && cur - prev > 1) {
      items.push('ellipsis');
    }
    items.push(cur);
  }

  return (
    <nav className="flex items-center justify-center gap-1 py-4" aria-label="Pagination">
      <Link
        href={getPageUrl(currentPage - 1)}
        className={cn(
          'flex size-10 items-center justify-center rounded-xl border border-border/60 transition-colors hover:bg-muted/60',
          currentPage <= 1 && 'pointer-events-none opacity-40'
        )}
        aria-disabled={currentPage <= 1}
      >
        <ChevronLeftIcon className="size-5" />
      </Link>

      {items.map((item, idx) => (
        item === 'ellipsis' ? (
          <span key={`ellipsis-${idx}`} className="flex size-10 items-center justify-center text-muted-foreground">
            …
          </span>
        ) : (
          <Link
            key={item}
            href={getPageUrl(item)}
            className={cn(
              'flex size-10 items-center justify-center rounded-xl border text-sm font-medium transition-colors',
              item === currentPage
                ? 'border-accent/50 bg-accent/10 text-accent'
                : 'border-border/60 text-muted-foreground hover:bg-muted/60 hover:text-foreground'
            )}
            aria-current={item === currentPage ? 'page' : undefined}
          >
            {item}
          </Link>
        )
      ))}

      <Link
        href={getPageUrl(currentPage + 1)}
        className={cn(
          'flex size-10 items-center justify-center rounded-xl border border-border/60 transition-colors hover:bg-muted/60',
          currentPage >= totalPages && 'pointer-events-none opacity-40'
        )}
        aria-disabled={currentPage >= totalPages}
      >
        <ChevronRightIcon className="size-5" />
      </Link>
    </nav>
  );
}
