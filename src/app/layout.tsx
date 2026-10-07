import type { Metadata, Viewport } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: { default: 'NearDrop — Move anything. Anywhere.', template: '%s · NearDrop' },
  description: 'Fast, private transfers between your devices. No cables. No complicated setup.',
  manifest: '/manifest.webmanifest', icons: { icon: '/favicon.svg', apple: '/icon-192.png' },
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'NearDrop' }
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: [{ media: '(prefers-color-scheme: light)', color: '#f7f8fa' }, { media: '(prefers-color-scheme: dark)', color: '#0b0d10' }] };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en" data-scroll-behavior="smooth" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{ __html: "try{document.documentElement.dataset.theme=localStorage.getItem('nd-theme')||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light')}catch(e){}" }}/></head><body><a className="skip-link" href="#main-content">Skip to content</a>{children}</body></html>;
}
