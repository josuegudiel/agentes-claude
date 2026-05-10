import { test, expect } from '../../src/fixtures/test.fixture.js';
import { createPatient } from '../../src/flows/patients.flow.js';
import { makePatient } from '../../src/fixtures/data/patients.js';

test.describe('Pacientes', () => {
  test('crear paciente desde el formulario @smoke', async ({ asUser }) => {
    const input = makePatient();
    const result = await createPatient(asUser, input);
    expect(result.visibleInList).toBe(true);
    expect(result.email).toBe(input.email);
  });

  test('busqueda devuelve resultados', async ({ asUser, patients }) => {
    const created = makePatient();
    await createPatient(asUser, created);

    await patients.goto();
    await patients.search(created.email);
    await expect(asUser.getByRole('row', { name: new RegExp(created.email, 'i') })).toBeVisible();
  });
});
