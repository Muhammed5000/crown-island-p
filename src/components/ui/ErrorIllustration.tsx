'use client';

import React from 'react';
import { cn } from '@/lib/cn';

interface Props {
  type: 'not-found' | 'forbidden' | 'failed' | 'error' | 'empty' | 'storm';
  className?: string;
}

/**
 * Premium SVG Illustrations for Crown Island error and empty states.
 * Designed with the Navy/Gold/Cream palette.
 */
export function ErrorIllustration({ type, className }: Props) {
  switch (type) {
    case 'forbidden':
      return (
        <svg
          viewBox="0 0 200 200"
          className={cn('size-48', className)}
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <circle cx="100" cy="100" r="90" stroke="#9c7d34" strokeWidth="2" strokeDasharray="4 4" className="opacity-30" />
          <path
            d="M60 140V80C60 57.9086 77.9086 40 100 40C122.091 40 140 57.9086 140 80V140"
            stroke="#9c7d34"
            strokeWidth="8"
            strokeLinecap="round"
          />
          <rect x="50" y="100" width="100" height="70" rx="12" fill="#1c2b40" stroke="#9c7d34" strokeWidth="4" />
          <circle cx="100" cy="135" r="8" fill="#9c7d34" />
          <rect x="97" y="140" width="6" height="12" rx="3" fill="#9c7d34" />
          <path
            d="M100 65V55"
            stroke="#9c7d34"
            strokeWidth="4"
            strokeLinecap="round"
            className="animate-pulse"
          />
        </svg>
      );

    case 'failed':
    case 'storm':
      return (
        <svg
          viewBox="0 0 200 200"
          className={cn('size-48', className)}
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          {/* Sea */}
          <path
            d="M20 150C40 145 60 155 80 150C100 145 120 155 140 150C160 145 180 155 180 150"
            stroke="#9c7d34"
            strokeWidth="3"
            strokeLinecap="round"
            className="animate-pulse"
          />
          <path
            d="M10 165C30 160 50 170 70 165C90 160 110 170 130 165C150 160 170 170 190 165"
            stroke="#9c7d34"
            strokeWidth="2"
            strokeLinecap="round"
            className="opacity-40"
          />
          
          {/* Broken Sandcastle */}
          <path d="M70 150L75 120H95L100 150" fill="#1c2b40" stroke="#9c7d34" strokeWidth="2" />
          <path d="M105 150L110 130H125L130 150" fill="#1c2b40" stroke="#9c7d34" strokeWidth="2" />
          <path d="M117 130L117 115" stroke="#9c7d34" strokeWidth="2" strokeLinecap="round" />
          <path d="M117 115L125 120L117 125" fill="#9c7d34" className="opacity-50" />
          
          {/* Rain / Lightning */}
          <path d="M130 40L120 60H135L125 80" stroke="#9c7d34" strokeWidth="3" strokeLinecap="round" className="animate-bounce" />
          <circle cx="50" cy="50" r="1" fill="#9c7d34" className="animate-ping" />
          <circle cx="150" cy="60" r="1" fill="#9c7d34" className="animate-ping" style={{ animationDelay: '1s' }} />
        </svg>
      );

    case 'empty':
      return (
        <svg
          viewBox="0 0 200 200"
          className={cn('size-48', className)}
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          {/* Beach Chair */}
          <path d="M60 140L140 140" stroke="#9c7d34" strokeWidth="4" strokeLinecap="round" />
          <path d="M70 140L60 100L110 90" stroke="#9c7d34" strokeWidth="4" strokeLinecap="round" />
          <path d="M110 90L130 140" stroke="#9c7d34" strokeWidth="4" strokeLinecap="round" />
          <path d="M60 100L50 110" stroke="#9c7d34" strokeWidth="4" strokeLinecap="round" />
          
          {/* Sun setting */}
          <circle cx="100" cy="160" r="40" fill="#9c7d34" className="opacity-20" />
          <path d="M40 160H160" stroke="#9c7d34" strokeWidth="2" className="opacity-30" />
          
          {/* Flying birds */}
          <path d="M140 60C145 55 150 60 150 60" stroke="#9c7d34" strokeWidth="2" strokeLinecap="round" className="animate-pulse" />
          <path d="M160 50C165 45 170 50 170 50" stroke="#9c7d34" strokeWidth="2" strokeLinecap="round" className="animate-pulse" style={{ animationDelay: '0.5s' }} />
        </svg>
      );

    case 'not-found':
    default:
      return (
        <svg
          viewBox="0 0 200 200"
          className={cn('size-48', className)}
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M100 160C144.183 160 180 124.183 180 80C180 35.8172 144.183 0 100 0C55.8172 0 20 35.8172 20 80C20 124.183 55.8172 160 100 160Z"
            fill="#9c7d34"
            fillOpacity="0.05"
          />
          <path
            d="M100 130C127.614 130 150 107.614 150 80C150 52.3858 127.614 30 100 30C72.3858 30 50 52.3858 50 80C50 107.614 72.3858 130 100 130Z"
            stroke="#9c7d34"
            strokeWidth="2"
            strokeDasharray="8 8"
            className="animate-[spin_20s_linear_infinite]"
          />
          <path
            d="M80 80C80 68.9543 88.9543 60 100 60C111.046 60 120 68.9543 120 80C120 91.0457 111.046 100 100 100C88.9543 100 80 91.0457 80 80Z"
            stroke="#9c7d34"
            strokeWidth="4"
          />
          <path
            d="M100 100V130"
            stroke="#9c7d34"
            strokeWidth="4"
            strokeLinecap="round"
          />
          <path
            d="M70 140H130"
            stroke="#9c7d34"
            strokeWidth="8"
            strokeLinecap="round"
            className="opacity-20"
          />
        </svg>
      );
  }
}
