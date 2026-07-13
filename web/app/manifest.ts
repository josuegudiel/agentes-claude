import type { MetadataRoute } from 'next';

/**
 * Web App Manifest: permite "Agregar a la pantalla de inicio" en movil
 * y abre el scanner en modo standalone (sin barra del navegador),
 * como una app nativa.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Scanner — documentos desde tu celular',
    short_name: 'Scanner',
    description:
      'Escanea documentos con la camara: bordes automaticos, perspectiva, filtros y export a PDF.',
    start_url: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#FAF8F3',
    theme_color: '#FAF8F3',
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
