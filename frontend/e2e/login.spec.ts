import { expect, test } from '@playwright/test';

test.describe('login page', () => {
  test('shows the unauthenticated login controls', async ({ page }) => {
    await page.goto('/en/auth/login');

    await expect(page).toHaveURL(/\/en\/auth\/login$/);
    await expect(page.getByRole('heading', { name: 'Sign In' })).toBeVisible();
    await expect(page.getByText('Access your industrial management system')).toBeVisible();

    const emailInput = page.getByLabel('Email Address');
    const passwordInput = page.locator('#password');
    await expect(emailInput).toBeVisible();
    await expect(emailInput).toHaveAttribute('type', 'email');
    await expect(passwordInput).toBeVisible();
    await expect(passwordInput).toHaveAttribute('type', 'password');

    await expect(page.getByLabel('Keep me logged in')).toBeChecked();
    await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Sign Up' })).toHaveAttribute(
      'href',
      '/en/auth/register',
    );
    await expect(page.getByRole('link', { name: 'Forgot password?' })).toHaveAttribute(
      'href',
      '/en/auth/forgot-password',
    );

    await page.getByLabel('Show password').click();
    await expect(passwordInput).toHaveAttribute('type', 'text');
    await expect(page.getByLabel('Hide password')).toBeVisible();
  });
});
