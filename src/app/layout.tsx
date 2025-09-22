import type { Metadata } from 'next'
import '@/styles/globals.css'
import { NotificationProvider } from '@/contexts/NotificationContext'
import { LocaleProvider } from '@/contexts/LocaleContext'
import { AuthProvider } from '@/contexts/AuthContext'
import { GlobalMobileDetection } from '@/components/GlobalMobileDetection'

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
    <html lang="en" className="h-full">
      <body 
        className="h-full bg-white text-gray-900 antialiased overflow-hidden"
        suppressHydrationWarning={true}
      >
        <LocaleProvider>
          <AuthProvider>
            <NotificationProvider>
              {children}
              <GlobalMobileDetection />
            </NotificationProvider>
          </AuthProvider>
        </LocaleProvider>
      </body>
    </html>
  )
} 