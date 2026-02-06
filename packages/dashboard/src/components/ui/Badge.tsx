import { HTMLAttributes, forwardRef } from 'react';
import { cn } from '@/utils/cn';
import { BadgeVariant } from '@/types';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant = 'blue', children, ...props }, ref) => {
    const variantClasses: Record<BadgeVariant, string> = {
      green: 'bg-green/15 text-green',
      red: 'bg-red/15 text-red',
      yellow: 'bg-yellow/15 text-yellow',
      blue: 'bg-accent/15 text-accent',
      purple: 'bg-purple/15 text-purple',
      orange: 'bg-orange/15 text-orange',
    };

    return (
      <span
        ref={ref}
        className={cn(
          'inline-block px-2 py-0.5 rounded-xl text-[11px] font-semibold',
          variantClasses[variant],
          className
        )}
        {...props}
      >
        {children}
      </span>
    );
  }
);

Badge.displayName = 'Badge';
