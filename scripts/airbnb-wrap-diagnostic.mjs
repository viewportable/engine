import { chromium } from 'playwright';

const url = process.argv[2];
if (!url) {
  throw new Error('Usage: node scripts/airbnb-wrap-diagnostic.mjs <url>');
}

const widths = [320, 321, 328, 335, 341, 356, 375];
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 375, height: 900 } });

try {
  await page.goto(url);

  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

    const state = await page.evaluate(() => {
      const lists = [...document.querySelectorAll('ul.list-layout.list-inline')];
      const target = lists.find((list) =>
        [...list.querySelectorAll(':scope > li')].some((item) =>
          item.textContent?.includes('Terms & Privacy'),
        ),
      );

      if (!(target instanceof HTMLElement)) return null;

      return {
        list: target.getBoundingClientRect().toJSON(),
        items: [...target.querySelectorAll(':scope > li')].map((item) => ({
          text: item.textContent?.trim() ?? '',
          rect: item.getBoundingClientRect().toJSON(),
          display: getComputedStyle(item).display,
        })),
      };
    });

    process.stdout.write(`${width}: ${JSON.stringify(state)}\n`);
  }
} finally {
  await browser.close();
}
