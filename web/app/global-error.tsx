'use client';

/**
 * Ultimo recurso si falla el propio layout: sin CSS de la app, estilos en
 * linea. Las paginas siguen guardadas en el telefono.
 */
export default function GlobalError(): React.ReactElement {
  return (
    <html lang="es">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 16,
          padding: 32,
          textAlign: 'center',
          background: '#0b0b0c',
          color: '#f2f2f0',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <h1 style={{ fontSize: 28, margin: 0 }}>Algo salió mal</h1>
        <p style={{ color: '#b4b4b8', margin: 0 }}>Tus páginas siguen guardadas en este teléfono.</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            height: 52,
            padding: '0 28px',
            border: 0,
            borderRadius: 16,
            background: '#d4ff3a',
            color: '#0b0b0c',
            fontWeight: 800,
            fontSize: 18,
          }}
        >
          Recargar
        </button>
      </body>
    </html>
  );
}
