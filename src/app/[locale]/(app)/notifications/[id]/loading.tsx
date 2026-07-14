/**
 * Skeleton for the notification detail page. Mirrors the REAL layout exactly —
 * the bare (un-carded) NotificationReader inside max-w-2xl with space-y-5 — so
 * the content swaps in with no layout shift on the push-deep-link path.
 */
export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6 lg:py-8">
      {/* back link */}
      <div className="mb-5 h-4 w-28 animate-pulse rounded bg-muted" />

      <div className="space-y-5">
        {/* hero image */}
        <div className="aspect-[16/9] w-full animate-pulse rounded-2xl bg-muted ring-1 ring-border/60" />

        {/* byline row */}
        <div className="flex items-center gap-2.5 border-b border-gold-400/20 pb-4">
          <div className="size-7 animate-pulse rounded-full bg-muted" />
          <div className="h-3 w-32 animate-pulse rounded bg-muted" />
        </div>

        {/* title */}
        <div className="h-7 w-3/4 animate-pulse rounded bg-muted" />

        {/* body */}
        <div className="space-y-2.5">
          <div className="h-4 w-full animate-pulse rounded bg-muted" />
          <div className="h-4 w-11/12 animate-pulse rounded bg-muted" />
          <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
        </div>
      </div>
    </div>
  );
}
