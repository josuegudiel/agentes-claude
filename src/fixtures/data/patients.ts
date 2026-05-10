import type { PatientInput } from '../../pages/PatientsPage.js';

/**
 * Factories de datos. NO uses datos hardcoded en los tests — usa estas
 * funciones. Cada llamada genera datos unicos para evitar colisiones
 * en runs paralelos.
 */

let counter = 0;

export function makePatient(overrides: Partial<PatientInput> = {}): PatientInput {
  const n = ++counter;
  const ts = Date.now();
  return {
    firstName: `Test${n}`,
    lastName: `Paciente${ts}`,
    email: `test+${ts}-${n}@ejemplo.com`,
    phone: '+50212345678',
    dateOfBirth: '1990-01-01',
    ...overrides,
  };
}
