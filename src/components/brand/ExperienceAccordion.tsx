'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import { useRouter } from '@/i18n/navigation';
import { cn } from '@/lib/cn';
import type { Category } from '@prisma/client';

interface Props {
  categories: Category[];
  locale: string;
}

const FALLBACK_IMAGES: Record<string, string> = {
  'crown-surge':
    'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1200&q=75',
  'crown-solace':
    'https://images.unsplash.com/photo-1544124499-58912cbddaad?auto=format&fit=crop&w=1200&q=75',
  'crown-club':
    'https://images.unsplash.com/photo-1566417713940-fe7c737a9ef2?auto=format&fit=crop&w=1200&q=75',
};

const DEFAULT_FALLBACK = 'https://images.unsplash.com/photo-1506929562872-bb421503ef21?auto=format&fit=crop&w=1200&q=75';

/**
 * Interactive "Harmonica" style accordion for categories.
 * Features auto-cycling and smooth expansion animations.
 * 
 * Interaction:
 * - Tap an inactive card: Make it active.
 * - Tap an already active card: Navigate to category page.
 */
export function ExperienceAccordion({ categories, locale }: Props) {
  const router = useRouter();
  const [activeIndex, setActiveIndex] = useState(0);
  const [isHovered, setIsHovered] = useState(false);

  // Auto-cycle effect
  useEffect(() => {
    if (isHovered || categories.length <= 1) return;

    const interval = setInterval(() => {
      setActiveIndex((prev) => (prev + 1) % categories.length);
    }, 4000);

    return () => clearInterval(interval);
  }, [categories.length, isHovered]);

  const handleCardClick = (index: number, slug: string) => {
    if (activeIndex === index) {
      // Second click on active card -> navigate
      router.push(`/booking/${slug}`);
    } else {
      // First click on inactive card -> activate it
      setActiveIndex(index);
    }
  };

  return (
    <div 
      className="flex h-[280px] w-full gap-2 py-4 lg:h-full lg:gap-6 lg:py-0"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {categories.map((category, index) => {
        const isActive = activeIndex === index;
        const name = locale === 'ar' ? category.nameAr : category.nameEn;
        const [word1 = '', ...rest] = name.split(/\s+/);
        const word2 = rest.join(' ');
        
        const src = category.coverUrl && !category.coverUrl.startsWith('/images/') 
          ? category.coverUrl 
          : (FALLBACK_IMAGES[category.slug] || DEFAULT_FALLBACK);

        return (
          <div
            key={category.id}
            onClick={() => handleCardClick(index, category.slug)}
            onMouseEnter={() => !isActive && setActiveIndex(index)}
            className={cn(
              'relative h-full cursor-pointer overflow-hidden rounded-2xl border border-gold-400/20 transition-all duration-1000 ease-[cubic-bezier(0.4,0,0.2,1)]',
              isActive ? 'flex-[4] border-gold-400/40 shadow-glow' : 'flex-1 grayscale-[0.4] hover:flex-[1.2] hover:grayscale-0'
            )}
            role="button"
            aria-expanded={isActive}
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleCardClick(index, category.slug);
              }
            }}
          >
            {/* Background Image */}
            <Image
              src={src}
              alt={name}
              fill
              priority={index === 0}
              className={cn(
                'object-cover transition-transform duration-1000',
                isActive ? 'scale-110' : 'scale-100'
              )}
            />

            {/* Overlay */}
            <div className={cn(
              'absolute inset-0 bg-gradient-to-t from-navy-950/90 via-navy-950/20 to-transparent transition-opacity duration-700',
              isActive ? 'opacity-100' : 'opacity-60'
            )} />

            {/* Content Container */}
            <div className={cn(
              'absolute inset-0 flex flex-col justify-end p-5 transition-all duration-700 lg:p-12',
              isActive ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0 lg:opacity-100 lg:translate-y-0'
            )}>
              <div className={cn(
                'flex flex-col transition-transform duration-700',
                isActive ? 'scale-100' : 'scale-90 origin-bottom-left'
              )}>
                <p className="font-display text-lg font-black tracking-[0.2em] text-gold-400 [text-shadow:0_4px_16px_rgba(0,0,0,0.9)] md:text-2xl lg:text-5xl xl:text-6xl">
                  {word1.toUpperCase()}
                </p>
                {word2 && (
                  <p className="mt-1 font-display text-lg font-black tracking-[0.2em] text-gold-400 [text-shadow:0_4px_16px_rgba(0,0,0,0.9)] md:text-2xl lg:text-5xl xl:text-6xl">
                    {word2.toUpperCase()}
                  </p>
                )}
              </div>
              
              {isActive && (
                <div className="mt-4 animate-fade-in lg:mt-8">
                  <p className="line-clamp-2 max-w-2xl text-[11px] font-medium text-cream/90 md:text-sm lg:text-lg lg:leading-relaxed [text-shadow:0_2px_8px_rgba(0,0,0,0.8)]">
                    {locale === 'ar' ? category.descAr : category.descEn}
                  </p>
                  
                  {/* Subtle "Discover" hint on desktop */}
                  <p className="mt-4 hidden text-xs font-bold uppercase tracking-[0.3em] text-gold-300 lg:block">
                    Click to Explore →
                  </p>
                </div>
              )}
            </div>
            
            {/* Active Indicator Bar */}
            <div className={cn(
              'absolute bottom-0 left-0 h-1.5 bg-gold-400 transition-all duration-[4000ms] ease-linear',
              isActive && !isHovered ? 'w-full' : 'w-0'
            )} />
          </div>
        );
      })}
    </div>
  );
}
