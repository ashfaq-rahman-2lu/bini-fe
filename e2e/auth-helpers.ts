import { expect, type APIRequestContext, type Page } from '@playwright/test'


export async function signIn(page: Page) {
  await page.getByLabel('Username', { exact: true }).fill('test-user')
  await page.getByLabel('Password', { exact: true }).fill('test-only-login-password')
  const response = page.waitForResponse(result => new URL(result.url()).pathname === '/api/auth/login')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  const result = await response
  expect(result.ok()).toBeTruthy()
  await expect(page.locator('.app-shell')).toBeVisible()
}

export async function visit(page: Page, url: string) {
  await page.goto(url)
  await expect(page.locator('.app-shell').or(page.getByRole('heading', { name: 'Sign in', exact: true }))).toBeVisible()
  if (await page.getByRole('heading', { name: 'Sign in', exact: true }).isVisible()) await signIn(page)
}

export async function reload(page: Page) {
  await page.reload()
  await expect(page.locator('.app-shell')).toBeVisible()
}

// Direct test setup requests authenticate too; browser requests use the real app client.
export function authenticatedApi(page: Page) {
  const headers = { 'X-Bini-Request': '1' }
  return {
    get: (url: string, options?: Parameters<APIRequestContext['get']>[1]) => page.request.get(url, { ...options, headers: { ...options?.headers, ...headers } }),
    post: (url: string, options?: Parameters<APIRequestContext['post']>[1]) => page.request.post(url, { ...options, headers: { ...options?.headers, ...headers } }),
    patch: (url: string, options?: Parameters<APIRequestContext['patch']>[1]) => page.request.patch(url, { ...options, headers: { ...options?.headers, ...headers } }),
  }
}
