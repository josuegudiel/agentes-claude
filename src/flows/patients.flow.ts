import type { Page } from '@playwright/test';
import { PatientsPage, type PatientInput } from '../pages/PatientsPage.js';
import { FlowError } from '../core/errors.js';
import { logger } from '../core/logger.js';

/**
 * Flows de pacientes. Cada funcion es UN caso de uso de negocio
 * (no un click). Devuelve datos serializables para que las tools
 * del agente las consuman directo.
 */

export interface CreatePatientResult {
  email: string;
  visibleInList: boolean;
}

export async function createPatient(
  page: Page,
  input: PatientInput,
): Promise<CreatePatientResult> {
  const log = logger.child({ flow: 'patients.createPatient', email: input.email });
  const patients = new PatientsPage(page);

  await patients.goto();
  await patients.openNewPatientForm();
  await patients.fillNewPatientForm(input);

  // Verificacion: lo que creamos debe aparecer en la lista.
  await patients.search(input.email);
  const found = await patients.hasPatient(input.email);

  if (!found) {
    throw new FlowError('Paciente creado pero no aparece en la lista', {
      code: 'PATIENT_NOT_VISIBLE_AFTER_CREATE',
      context: { email: input.email },
    });
  }

  log.info('Paciente creado');
  return { email: input.email, visibleInList: found };
}

export async function searchPatients(page: Page, query: string): Promise<{ count: number }> {
  const patients = new PatientsPage(page);
  await patients.goto();
  await patients.search(query);
  const count = await patients.countPatientsInTable();
  return { count };
}
