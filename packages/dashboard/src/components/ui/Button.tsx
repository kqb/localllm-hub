import { ButtonHTMLAttributes, forwardRef } from 'react';
import { cn } from '@/utils/cn';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'outline' | 'danger';
  size?: 'sm' | 'md';
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          'rounded border-none font-semibold cursor-pointer transition-opacity hover:opacity-85 whitespace-nowrap',
          {
            'bg-accent text-black': variant === 'primary',
            'bg-transparent text-accent border border-accent hover:bg-accent/10':
              variant === 'outline',
            'bg-red text-white': variant === 'danger',
            'px-2.5 py-1 text-xs': size === 'sm',
            'px-4 py-2 text-[13px]': size === 'md',
          },
          className
        )}
        {...props}
      />
    );
  }
);

Button.displayName = 'Button';
