import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Card, CardHeader, CardContent } from '../Card';

describe('Card', () => {
  it('renders children', () => {
    render(<Card>Card content</Card>);
    expect(screen.getByText('Card content')).toBeInTheDocument();
  });

  it('applies base styles', () => {
    render(<Card>Content</Card>);
    const card = screen.getByText('Content');
    expect(card).toHaveClass('bg-bg-2', 'border', 'border-border', 'rounded');
  });

  it('accepts custom className', () => {
    render(<Card className="custom">Content</Card>);
    expect(screen.getByText('Content')).toHaveClass('custom');
  });
});

describe('CardHeader', () => {
  it('renders as h2', () => {
    render(<CardHeader>Header</CardHeader>);
    const header = screen.getByText('Header');
    expect(header.tagName).toBe('H2');
  });

  it('applies header styles', () => {
    render(<CardHeader>Header</CardHeader>);
    const header = screen.getByText('Header');
    expect(header).toHaveClass('text-sm', 'uppercase', 'text-text-2');
  });
});

describe('CardContent', () => {
  it('renders children', () => {
    render(<CardContent>Content text</CardContent>);
    expect(screen.getByText('Content text')).toBeInTheDocument();
  });
});
