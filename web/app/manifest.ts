import type { MetadataRoute } from 'next';

/**
 * Web App Manifest: permite "Agregar a la pantalla de inicio" en movil
 * y abre el scanner en modo standalone (sin barra del navegador),
 * como una app nativa.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'ScannerFree — documentos desde tu celular',
    short_name: 'ScannerFree',
    description:
      'Escanea documentos gratis con la cámara: bordes automáticos, perspectiva, filtros y export a PDF.',
    id: '/',
    start_url: '/',
    scope: '/',
    lang: 'es',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#0B0B0C',
    theme_color: '#0B0B0C',
    // PNG: Android los necesita para instalar (192/512 + maskable) y iOS
    // usa app/apple-icon.png (180). El SVG queda para navegadores de escritorio.
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
    ],
  };
}
