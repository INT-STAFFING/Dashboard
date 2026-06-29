'use client';
import React from 'react';

// Renders a pre-built HTML string (chart/table markup) into a container.
export function Html({
  html,
  className,
  id,
  style,
  onClick,
  ariaLabel,
}: {
  html: string;
  className?: string;
  id?: string;
  style?: React.CSSProperties;
  onClick?: (e: React.MouseEvent<HTMLDivElement>) => void;
  // When provided, the container is announced to screen readers as a single
  // image with this text alternative (WCAG 1.1.1) — the inner SVG markup, which
  // is otherwise opaque to assistive tech, becomes presentational.
  ariaLabel?: string;
}) {
  return (
    <div
      id={id}
      className={className}
      style={style}
      onClick={onClick}
      role={ariaLabel ? 'img' : undefined}
      aria-label={ariaLabel}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
