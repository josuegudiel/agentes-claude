import type { Metadata, Viewport } from 'next';
import { Barlow_Condensed, Instrument_Sans, JetBrains_Mono } from 'next/font/google';
import './globals.css';

// Diseno "Obturador": tipografia de camara profesional. Barlow Condensed
// para rotulos en mayusculas, JetBrains Mono para datos tecnicos e
// Instrument Sans para el texto corrido.
const display = Barlow_Condensed({
  subsets: ['latin'],
  weight: ['500', '600', '700', '800'],
  variable: '--font-display',
  display: 'swap',
});
const body = Instrument_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-body',
  display: 'swap',
});
const mono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  metadataBase: new URL('https://scannerfree.vercel.app'),
  applicationName: 'ScannerFree',
  title: 'ScannerFree — escanea documentos desde tu celular',
  description:
    'Escanea documentos gratis con la cámara: detección de bordes, corrección de perspectiva, filtros y export a PDF, JPG o PNG. Todo en tu navegador.',
  openGraph: {
    type: 'website',
    url: '/',
    siteName: 'ScannerFree',
    title: 'ScannerFree — escanea documentos desde tu celular',
    description: 'Escanea documentos gratis desde el navegador y guárdalos en PDF.',
    locale: 'es',
  },
  appleWebApp: {
    capable: true,
    title: 'ScannerFree',
    statusBarStyle: 'black-translucent',
  },
};

// viewportFit cover + safe-area en CSS: el visor llega hasta el borde en
// telefonos con notch sin que el home-indicator tape los botones.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#0B0B0C',
  colorScheme: 'dark',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <html lang="es" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body className="scanner-theme min-h-screen font-sans text-night-100 antialiased">
        {children}
      </body>
    </html>
  );
}
