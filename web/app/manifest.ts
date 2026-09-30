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
    start_url: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#0B0B0C',
    theme_color: '#0B0B0C',
    icons: [
      {
        src: '/icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'any',
      },
    ],
  };
}
