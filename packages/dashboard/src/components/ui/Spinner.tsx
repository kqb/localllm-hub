import { HTMLAttributes, forwardRef } from 'react';
import { cn } from '@/utils/cn';

export interface SpinnerProps extends HTMLAttributes<HTMLDivElement> {
  size?: 'sm' | 'md' | 'lg';
}

export const Spinner = forwardRef<HTMLDivElement, SpinnerProps>(
  ({ className, size = 'md', ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          'inline-block border-2 border-border border-t-accent rounded-full animate-spin',
          {
            'w-3.5 h-3.5': size === 'sm',
            'w-6 h-6': size === 'md',
            'w-8 h-8': size === 'lg',
          },
          className
        )}
        {...props}
      />
    );
  }
);

Spinner.displayName = 'Spinner';

export interface LoadingTextProps extends HTMLAttributes<HTMLDivElement> {}

export const LoadingText = forwardRef<HTMLDivElement, LoadingTextProps>(
  ({ className, children = 'Loading...', ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          'flex items-center gap-2 text-text-2 text-sm',
          className
        )}
        {...props}
      >
        <Spinner size="sm" />
        <span>{children}</span>
      </div>
    );
  }
);

LoadingText.displayName = 'LoadingText';
