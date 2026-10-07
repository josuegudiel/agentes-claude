'use client';

// Primero: la politica de Trusted Types debe existir antes de cargar
// workers o registrar el service worker.
import './trusted-types';
import { useEffect } from 'react';

/**
 * Registra el service worker (public/sw.js) para que la app abra sin
 * conexion. Solo en produccion: en desarrollo cachear estorba.
 */
export function ServiceWorker(): null {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (!('serviceWorker' in navigator)) return;
    const register = (): void => {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
        /* sin SW la app funciona igual (solo no abre sin conexion) */
      });
    };
    // Despues de cargar: no competir con la primera pintura ni con la camara.
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
  }, []);
  return null;
}
