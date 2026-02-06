import { HTMLAttributes, forwardRef } from 'react';
import { cn } from '@/utils/cn';

export interface StatusDotProps extends HTMLAttributes<HTMLSpanElement> {
  status: 'ok' | 'error' | 'warn';
}

export const StatusDot = forwardRef<HTMLSpanElement, StatusDotProps>(
  ({ className, status, ...props }, ref) => {
    return (
      <span
        ref={ref}
        className={cn(
          'inline-block w-2.5 h-2.5 rounded-full',
          {
            'bg-green shadow-[0_0_6px] shadow-green': status === 'ok',
            'bg-red shadow-[0_0_6px] shadow-red': status === 'error',
            'bg-yellow': status === 'warn',
          },
          className
        )}
        {...props}
      />
    );
  }
);

StatusDot.displayName = 'StatusDot';
