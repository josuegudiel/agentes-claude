import type { Metadata, Viewport } from 'next';
import { Nunito } from 'next/font/google';
import './globals.css';

// Nunito para toda la UI: terminales redondeadas, calida y legible.
// Eleccion deliberada — NO Inter ni Space Grotesk (los defaults que
// delatan una interfaz generada por IA). next/font descarga y
// self-hostea en build: cero requests a Google en runtime.
const body = Nunito({
  subsets: ['latin'],
  variable: '--font-body',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Scanner — escanea documentos desde tu celular',
  description:
    'Escanea documentos con la camara: deteccion de bordes, correccion de perspectiva, filtros y export a JPG, PNG o PDF. Todo en tu navegador.',
};

// viewportFit cover + safe-area en CSS: la UI llega hasta el borde en
// telefonos con notch sin que el home-indicator tape los botones.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#FAF8F3',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <html lang="es" className={body.variable}>
      <body className="scanner-theme min-h-screen font-sans text-stone-800 antialiased">
        {children}
      </body>
    </html>
  );
}
