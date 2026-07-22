import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

export function listArg(name, fallback) {
  const prefix = `--${name}=`;
  const raw = process.argv.find((argument) => argument.startsWith(prefix));
  return raw ? raw.slice(prefix.length).split(',').filter(Boolean) : fallback;
}

export function valueArg(name, fallback) {
  const prefix = `--${name}=`;
  const raw = process.argv.find((argument) => argument.startsWith(prefix));
  return raw ? raw.slice(prefix.length) : fallback;
}

export async function captureMatrix({
  baseUrl,
  route,
  outputDirectory,
  viewports,
  shots,
  targets,
  readySelector,
  pageStyles = '',
}) {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const failures = [];
  const captures = [];
  try {
    for (const [viewportName, viewport] of Object.entries(viewports)) {
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      for (const shot of shots) {
        const url = new URL(route, baseUrl);
        for (const [key, value] of Object.entries(shot.query ?? {})) {
          url.searchParams.set(key, value);
        }
        const shotTargets = shot.targets ?? Object.keys(targets);
        try {
          await page.goto(url.toString(), { waitUntil: 'domcontentloaded' });
          await page.locator(readySelector).waitFor({ state: 'attached', timeout: 30_000 });
          if (pageStyles) await page.addStyleTag({ content: pageStyles });
          await page.waitForTimeout(shot.settleMs ?? 250);
          for (const targetName of shotTargets) {
            const selector = targets[targetName];
            if (!selector) throw new Error(`Alvo desconhecido: ${targetName}`);
            const locator = page.locator(selector);
            if (await locator.count() !== 1) {
              throw new Error(`Alvo ${targetName} não é único em ${selector}`);
            }
            const directory = path.join(outputDirectory, viewportName, shot.id);
            await mkdir(directory, { recursive: true });
            const file = path.join(directory, `${targetName}.png`);
            await locator.screenshot({ path: file });
            captures.push(file);
          }
          console.log(`✓ ${viewportName}/${shot.id} (${shotTargets.join(', ')})`);
        } catch (error) {
          const label = `${viewportName}/${shot.id}`;
          failures.push(label);
          console.error(`✖ ${label}: ${error instanceof Error ? error.message.split('\n')[0] : error}`);
        }
      }
      await context.close();
    }
  } finally {
    await browser.close();
  }
  if (failures.length) {
    throw new Error(`${failures.length} captura(s) falharam: ${failures.join(', ')}`);
  }
  return captures;
}
