'use client';
import React from 'react';

// Renders a pre-built HTML string (chart/table markup) into a container.
export function Html({
  html,
  className,
  id,
  style,
  onClick,
}: {
  html: string;
  className?: string;
  id?: string;
  style?: React.CSSProperties;
  onClick?: (e: React.MouseEvent<HTMLDivElement>) => void;
}) {
  return (
    <div
      id={id}
      className={className}
      style={style}
      onClick={onClick}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
