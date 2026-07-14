'use client';

/**
 * Player for the about-page video.
 *
 *  - Direct `.mp4` / `.webm` / `.mov` URLs render as a native `<video>` with
 *    controls + a poster image. Autoplay is *muted* so iOS Safari respects it.
 *  - YouTube / Vimeo URLs are normalised to an `embed` URL and rendered as
 *    an iframe so we don't try to play them with the HTML5 element.
 *  - Anything else falls back to a plain link inside a small card so the page
 *    never silently swallows bad content the admin pasted.
 */

interface Props {
  url: string;
  poster?: string;
  /** Alt-style label read by screen readers. */
  title: string;
}

const VIDEO_EXTENSIONS = /\.(mp4|webm|mov|m4v|ogg|ogv)(\?.*)?$/i;

function toEmbedUrl(url: string): string | null {
  try {
    const u = new URL(url);
    // YouTube — handle watch?v=, youtu.be/, and existing /embed/ links.
    if (/(^|\.)youtube\.com$/i.test(u.hostname)) {
      if (u.pathname.startsWith('/embed/')) return u.toString();
      const id = u.searchParams.get('v');
      if (id) return `https://www.youtube.com/embed/${id}`;
    }
    if (/(^|\.)youtu\.be$/i.test(u.hostname)) {
      const id = u.pathname.replace(/^\//, '');
      if (id) return `https://www.youtube.com/embed/${id}`;
    }
    // Vimeo — handle vimeo.com/ID and existing player.vimeo.com URLs.
    if (/(^|\.)vimeo\.com$/i.test(u.hostname)) {
      if (u.hostname === 'player.vimeo.com') return u.toString();
      const id = u.pathname.replace(/^\//, '').split('/')[0];
      if (id && /^\d+$/.test(id)) return `https://player.vimeo.com/video/${id}`;
    }
  } catch {
    return null;
  }
  return null;
}

export function ExperienceVideo({ url, poster, title }: Props) {
  const embedUrl = toEmbedUrl(url);
  const isVideoFile = VIDEO_EXTENSIONS.test(url);

  if (isVideoFile) {
    return (
      <video
        controls
        playsInline
        preload="metadata"
        poster={poster}
        className="h-full w-full object-cover"
        aria-label={title}
      >
        <source src={url} />
      </video>
    );
  }

  if (embedUrl) {
    return (
      <iframe
        src={embedUrl}
        title={title}
        className="h-full w-full"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
      />
    );
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex h-full w-full items-center justify-center bg-muted text-sm font-medium text-gold-700 underline-offset-4 hover:underline"
    >
      {title} ↗
    </a>
  );
}
