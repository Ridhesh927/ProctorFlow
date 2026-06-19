import { browser } from 'k6/browser';
import { check } from 'k6';

export const options = {
  scenarios: {
    ui: {
      executor: 'shared-iterations',
      options: {
        browser: {
            type: 'chromium',
        },
      },
    },
  },
  thresholds: {
    checks: ['rate==1.0'],
  }
};

export default async function () {
  const page = await browser.newPage();

  try {
    // Navigate to the frontend login page
    await page.goto('http://localhost:5173/login');

    // Wait for the page to load by checking for an element
    // Assuming there's a login button or form, adjust selector as needed
    await page.waitForSelector('form');

    // Example of taking a screenshot for debugging (optional)
    // await page.screenshot({ path: 'screenshot.png' });

    // Check if navigation was successful
    check(page, {
      'login page loaded': (p) => p.url() === 'http://localhost:5173/login',
    });

  } finally {
    await page.close();
  }
}
