import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Badge } from '../Badge';

describe('Badge', () => {
  it('renders children', () => {
    render(<Badge>Test Badge</Badge>);
    expect(screen.getByText('Test Badge')).toBeInTheDocument();
  });

  it('applies blue variant by default', () => {
    render(<Badge>Default</Badge>);
    const badge = screen.getByText('Default');
    expect(badge).toHaveClass('bg-accent/15', 'text-accent');
  });

  it('applies green variant', () => {
    render(<Badge variant="green">Success</Badge>);
    const badge = screen.getByText('Success');
    expect(badge).toHaveClass('bg-green/15', 'text-green');
  });

  it('applies red variant', () => {
    render(<Badge variant="red">Error</Badge>);
    const badge = screen.getByText('Error');
    expect(badge).toHaveClass('bg-red/15', 'text-red');
  });

  it('applies yellow variant', () => {
    render(<Badge variant="yellow">Warning</Badge>);
    const badge = screen.getByText('Warning');
    expect(badge).toHaveClass('bg-yellow/15', 'text-yellow');
  });

  it('applies purple variant', () => {
    render(<Badge variant="purple">Info</Badge>);
    const badge = screen.getByText('Info');
    expect(badge).toHaveClass('bg-purple/15', 'text-purple');
  });

  it('applies orange variant', () => {
    render(<Badge variant="orange">Alert</Badge>);
    const badge = screen.getByText('Alert');
    expect(badge).toHaveClass('bg-orange/15', 'text-orange');
  });
});
