import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import '@/styles/globals.css'
import { NotificationProvider } from '@/contexts/NotificationContext'
import { LocaleProvider } from '@/contexts/LocaleContext'
import { AuthProvider } from '@/contexts/AuthContext'
import { GlobalMobileDetection } from '@/components/GlobalMobileDetection'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
})

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
    <html lang="en" className={`${inter.variable} dark h-full`}>
      <body
        className="h-full bg-background text-foreground antialiased overflow-hidden font-sans"
        suppressHydrationWarning={true}
      >
        <LocaleProvider>
          <NotificationProvider>
            <AuthProvider>
              {children}
              <GlobalMobileDetection />
            </AuthProvider>
          </NotificationProvider>
        </LocaleProvider>
      </body>
    </html>
  )
} 