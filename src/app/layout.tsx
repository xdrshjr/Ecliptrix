import type { Metadata } from 'next'
import '@/styles/globals.css'
import { NotificationProvider } from '@/contexts/NotificationContext'
import { LocaleProvider } from '@/contexts/LocaleContext'

export const metadata: Metadata = {
  title: 'Ecliptrix - Where light and shadow collide',
  description: 'A content creation platform for social media, video editing, voice synthesis, and creative brainstorming.',
  keywords: ['content creation', 'video editing', 'AI', 'social media', 'voice synthesis'],
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="dark h-full" style={{ colorScheme: 'dark' }} suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('ecliptrix-theme');if(t==='light'){document.documentElement.classList.replace('dark','light');document.documentElement.style.colorScheme='light'}}catch(e){}})();`,
          }}
        />
      </head>
      <body
        className="h-full bg-background text-foreground antialiased overflow-hidden font-sans"
        suppressHydrationWarning={true}
      >
        <LocaleProvider>
          <NotificationProvider>
            {children}
          </NotificationProvider>
        </LocaleProvider>
      </body>
    </html>
  )
} 