// Test double for the host-provided "@kirocrew/app-sdk/ui": plain elements with the
// same props the page passes. Styling is the host's job and is not under test.
import type { ComponentPropsWithoutRef, ReactNode } from 'react';

export function Card({ children, ...rest }: ComponentPropsWithoutRef<'div'>) {
  return <div {...rest}>{children}</div>;
}

export function CardTitle({ children, ...rest }: ComponentPropsWithoutRef<'h3'>) {
  return <h3 {...rest}>{children}</h3>;
}

export function Badge({
  children,
  variant,
  ...rest
}: { variant: 'ok' | 'err' | 'warn' | 'aim' | 'muted'; children: ReactNode } & Omit<ComponentPropsWithoutRef<'span'>, 'children'>) {
  return (
    <span data-variant={variant} {...rest}>
      {children}
    </span>
  );
}

export function StatCard({ label, value }: { label: string; value?: string | number | null; accent?: boolean }) {
  return (
    <div data-testid="stat">
      <span>{label}</span> <b>{value}</b>
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: string; actions?: ReactNode }) {
  return (
    <header>
      <h1>{title}</h1>
      {subtitle && <p>{subtitle}</p>}
      {actions}
    </header>
  );
}
