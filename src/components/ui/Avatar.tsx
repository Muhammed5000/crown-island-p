import { cn } from '@/lib/cn';

interface AvatarProps {
  src?: string | null;
  name?: string | null;
  size?: number;
  className?: string;
}

function initials(name?: string | null) {
  if (!name) return '';
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

export function Avatar({ src, name, size = 36, className }: AvatarProps) {
  const style = { width: size, height: size };
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- profile photos from third-party OAuth providers
      <img
        src={src}
        alt={name ?? ''}
        style={style}
        className={cn('rounded-full object-cover ring-1 ring-border', className)}
      />
    );
  }
  return (
    <div
      style={style}
      className={cn(
        'flex items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary ring-1 ring-border',
        className,
      )}
      aria-label={name ?? ''}
    >
      {initials(name)}
    </div>
  );
}
