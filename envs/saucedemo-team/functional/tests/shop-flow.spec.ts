import { test, expect } from '@playwright/test';

// Public demo credentials — printed on the SauceDemo login page itself.
const USER = 'standard_user';
const PASS = 'secret_sauce';

async function login(page) {
  await page.goto('/');
  await page.getByTestId('username').fill(USER);
  await page.getByTestId('password').fill(PASS);
  await page.getByTestId('login-button').click();
}

test('login page renders the credential form', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('username')).toBeVisible();
  await expect(page.getByTestId('password')).toBeVisible();
  await expect(page.getByTestId('login-button')).toBeVisible();
});

test('valid login lands on the inventory page', async ({ page }) => {
  await login(page);
  await expect(page.getByTestId('title')).toHaveText('Products');
  await expect(page.getByTestId('inventory-item')).toHaveCount(6);
});

test('adding the backpack updates the cart badge', async ({ page }) => {
  await login(page);
  await page.getByTestId('add-to-cart-sauce-labs-backpack').click();
  await expect(page.getByTestId('shopping-cart-badge')).toHaveText('1');
});

test('cart page shows the added item', async ({ page }) => {
  await login(page);
  await page.getByTestId('add-to-cart-sauce-labs-backpack').click();
  await page.getByTestId('shopping-cart-link').click();
  await expect(page.getByTestId('title')).toHaveText('Your Cart');
  await expect(page.getByTestId('inventory-item-name')).toHaveText('Sauce Labs Backpack');
});
