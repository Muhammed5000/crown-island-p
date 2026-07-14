'use client';

import { useState } from 'react';
import { EyeIcon } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { ImageLightbox } from '@/components/ui/ImageLightbox';

interface Doc {
  id: string;
  guestSeq: number;
  guestName: string | null;
  imageUrl: string;
  verificationStatus: string;
}

/** Admin booking-detail guest-ID grid: shows the entered name + click-to-enlarge. */
export function GuestIdGallery({ docs }: { docs: Doc[] }) {
  const [zoom, setZoom] = useState<{ src: string; caption: string } | null>(null);

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
        {docs.map((doc) => {
          const name = doc.guestName?.trim() || `Guest ${doc.guestSeq}`;
          return (
            <div key={doc.id} className="group relative overflow-hidden rounded-xl border border-border/40">
              <button
                type="button"
                onClick={() => setZoom({ src: doc.imageUrl, caption: name })}
                className="block w-full"
                aria-label={`Enlarge ${name} ID`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={doc.imageUrl}
                  alt={`${name} ID`}
                  loading="lazy"
                  className="aspect-[4/3] w-full object-cover transition group-hover:opacity-80"
                />
                <span className="pointer-events-none absolute left-2 top-2 grid size-7 place-items-center rounded-full border border-white/25 bg-black/50 text-white opacity-0 transition group-hover:opacity-100">
                  <EyeIcon className="size-3.5" />
                </span>
              </button>
              <div className="flex items-center justify-between gap-2 px-2.5 py-2">
                <span className="truncate text-xs font-semibold text-foreground" title={name}>
                  {name}
                </span>
                <Badge
                  tone={
                    doc.verificationStatus === 'VERIFIED'
                      ? 'success'
                      : doc.verificationStatus === 'REJECTED'
                        ? 'danger'
                        : 'muted'
                  }
                >
                  {doc.verificationStatus}
                </Badge>
              </div>
            </div>
          );
        })}
      </div>
      {zoom && <ImageLightbox src={zoom.src} alt={zoom.caption} caption={zoom.caption} onClose={() => setZoom(null)} />}
    </>
  );
}
