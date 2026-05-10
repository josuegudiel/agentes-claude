import type { Locator } from '@playwright/test';
import { BasePage } from './BasePage.js';

/**
 * Pagina de gestion de pacientes.
 * AJUSTA selectores a tu app real. Marcamos data-testid donde podemos
 * para que tests no se rompan al cambiar copy.
 */
export interface PatientInput {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  dateOfBirth?: string;
}

export class PatientsPage extends BasePage {
  readonly path = '/patients';

  protected readyLocator(): Locator {
    return this.page.getByRole('heading', { name: /pacientes/i });
  }

  private get newPatientButton(): Locator {
    return this.page.getByRole('button', { name: /nuevo paciente|agregar paciente/i });
  }

  private get searchInput(): Locator {
    return this.page.getByPlaceholder(/buscar paciente/i);
  }

  private get patientsTable(): Locator {
    return this.page.getByRole('table');
  }

  private rowFor(query: string): Locator {
    return this.patientsTable.getByRole('row', { name: new RegExp(query, 'i') });
  }

  async openNewPatientForm(): Promise<void> {
    await this.newPatientButton.click();
    await this.page.getByRole('dialog').waitFor({ state: 'visible' });
  }

  async fillNewPatientForm(input: PatientInput): Promise<void> {
    const dialog = this.page.getByRole('dialog');
    await dialog.getByLabel(/nombre/i).fill(input.firstName);
    await dialog.getByLabel(/apellido/i).fill(input.lastName);
    await dialog.getByLabel(/email|correo/i).fill(input.email);
    if (input.phone) await dialog.getByLabel(/tel[eé]fono/i).fill(input.phone);
    if (input.dateOfBirth) {
      await dialog.getByLabel(/fecha de nacimiento/i).fill(input.dateOfBirth);
    }
    await dialog.getByRole('button', { name: /guardar|crear/i }).click();
    await dialog.waitFor({ state: 'hidden', timeout: 10_000 });
  }

  async search(query: string): Promise<void> {
    await this.searchInput.fill(query);
    // Debounce de tu app — ajusta. Mejor esperar al request HTTP.
    await this.page.waitForLoadState('networkidle');
  }

  async hasPatient(query: string): Promise<boolean> {
    return this.rowFor(query).isVisible();
  }

  async openPatient(query: string): Promise<void> {
    await this.rowFor(query).click();
  }

  async countPatientsInTable(): Promise<number> {
    return this.patientsTable.getByRole('row').count();
  }
}
