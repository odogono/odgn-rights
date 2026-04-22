import { expect, test } from '@playwright/test';

test.describe('ODGN Rights Playground', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should load the playground', async ({ page }) => {
    await expect(page).toHaveTitle(/ODGN Rights Playground/);
    const mainApp = page.getByRole('application', {
      name: 'ODGN Rights Playground'
    });
    await expect(mainApp).toBeVisible();
  });

  test('should display major panels', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Editor' })).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Hierarchy' })
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Permission Tester' })
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Pattern Sandbox' })
    ).toBeVisible();
  });

  test('should load a preset', async ({ page }) => {
    // There are 3 comboboxes: Preset selector, Format selector, and Path autocomplete
    // The preset selector is in the toolbar-left
    const presetSelect = page.locator('.toolbar-left select');
    await presetSelect.selectOption('complex-hierarchy');

    // Check if the Hierarchy panel updated (it should contain 'engineer' from complex-hierarchy)
    await expect(
      page.getByRole('heading', { name: 'Hierarchy' })
    ).toBeVisible();
    await expect(page.getByText('Role: engineer')).toBeVisible();
  });

  test('should run a permission test', async ({ page }) => {
    // Fill path - use ID to be specific as there are multiple "Path" labels
    const pathInput = page.locator('#test-path');
    await pathInput.fill('/org/finance/reports');

    // Toggle Read and Write flags
    const readCheckbox = page.getByLabel('Read(r)');
    if (!(await readCheckbox.isChecked())) {
      await readCheckbox.check();
    }

    const writeCheckbox = page.getByLabel('Write(w)');
    await writeCheckbox.check();

    // Click Test button
    await page.getByRole('button', { name: 'Test' }).click();

    // Check result
    await expect(page.getByText('Result:')).toBeVisible();

    // Check history
    await expect(page.getByRole('heading', { name: 'History' })).toBeVisible();
    await expect(page.locator('.test-history li')).toHaveCount(1);
  });

  test('should use pattern sandbox', async ({ page }) => {
    const patternInput = page.locator('#pattern-input');
    const pathInput = page.locator('#path-input');

    await patternInput.fill('/public/**');
    await pathInput.fill('/public/images/logo.png');

    await expect(page.getByText('Matches!')).toBeVisible();

    await pathInput.fill('/private/secret.txt');
    await expect(page.getByText('No match')).toBeVisible();
  });

  test('should toggle help panel', async ({ page }) => {
    await page.getByRole('button', { name: 'Help' }).click();
    await expect(page.getByText('Keyboard Shortcuts')).toBeVisible();
  });

  test('should switch to the resource tree screen and sync role edits into JSON', async ({
    page
  }) => {
    const presetSelect = page.locator('.toolbar-left select');
    await presetSelect.selectOption('resource-tree-authoring');
    await page.getByRole('button', { name: 'Resource Tree' }).click();

    await expect(
      page.getByRole('heading', { name: 'Resource Tree' })
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Config JSON' })).toBeVisible();
    await expect(page.getByText('meta')).toBeVisible();

    await page.getByLabel('Editable role').selectOption('meta-auditor');

    const usersRow = page.locator('.resource-node-row', { hasText: 'users' });
    await usersRow.click();
    await usersRow.locator('.resource-chip').nth(1).click();

    const editor = page.getByLabel('Resource tree JSON editor');
    await expect(editor).toHaveValue(/"allow": "rw"/);
    await expect(page.getByText('role:meta-auditor (selected role)')).toBeVisible();
  });

  test('should support tree CRUD and disable tree edits when JSON is invalid', async ({
    page
  }) => {
    const presetSelect = page.locator('.toolbar-left select');
    await presetSelect.selectOption('resource-tree-authoring');
    await page.getByRole('button', { name: 'Resource Tree' }).click();

    page.once('dialog', dialog => dialog.accept('novum'));
    await page.getByRole('button', { name: 'Add Root' }).click();
    await expect(page.getByLabel('Resource tree JSON editor')).toHaveValue(
      /"name": "novum"/
    );

    await page.getByLabel('Editable role').selectOption('meta-auditor');

    const metaRow = page.locator('.resource-node-row', { hasText: 'meta' });
    page.once('dialog', dialog => dialog.accept('metadata'));
    await metaRow.getByRole('button', { name: 'Rename' }).click();
    await expect(page.getByLabel('Resource tree JSON editor')).toHaveValue(
      /\/metadata\/prod\/users/
    );

    const metadataRow = page.locator('.resource-node-row', { hasText: 'metadata' });
    page.once('dialog', dialog => dialog.accept());
    await metadataRow.getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByLabel('Resource tree JSON editor')).not.toHaveValue(
      /\/metadata\/prod\/users/
    );

    const editor = page.getByLabel('Resource tree JSON editor');
    await editor.fill('{');
    await expect(page.getByRole('button', { name: 'Add Root' })).toBeDisabled();
    await expect(
      page.getByText('Fix the JSON editor before changing the tree.')
    ).toBeVisible();
    await expect(page.getByText('workbench')).toBeVisible();
  });
});
