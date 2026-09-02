'use client';

import Link from 'next/link';
import { useLocale } from '@/contexts/LocaleContext';
import AppTitleBar from '@/components/shell/AppTitleBar';

export default function NotFound() {
  const { t } = useLocale();
  // Fallback so the page never hard-crashes if a locale is missing the key.
  const nf = t.notFound ?? {
    title: 'Page not found',
    description: "The page you're looking for doesn't exist or has been moved.",
    goHome: 'Back to home',
    goBack: 'Go back',
  };

  return (
    // Frameless desktop: any route without a self-drawn title bar would have no
    // window controls, so 404 gets one too. Alt+F4 remains the ultimate
    // fallback. Mounted prop-less, so it shows brand only — no action cluster.
    <div className="min-h-full flex flex-col">
      <AppTitleBar />
      <main className="flex-1 min-h-0 flex flex-col items-center justify-center px-6 py-24 text-center">
        <h1 className="text-5xl font-bold text-foreground">404</h1>
        <p className="mt-3 text-base text-muted-foreground">{nf.title}</p>
        <p className="mt-2 text-sm text-muted-foreground max-w-md">{nf.description}</p>
        <div className="mt-6 flex gap-3">
          <Link
            href="/"
            className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm hover:bg-primary/90"
          >
            {nf.goHome}
          </Link>
          <button
            type="button"
            onClick={() => {
              if (typeof window !== 'undefined') {
                window.history.back();
              }
            }}
            className="px-4 py-2 rounded-md border border-border text-sm hover:bg-accent"
          >
            {nf.goBack}
          </button>
        </div>
      </main>
    </div>
  );
}
