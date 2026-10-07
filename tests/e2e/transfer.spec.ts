import { test, expect, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFile, mkdir } from 'node:fs/promises';
async function pair(sender:Page,receiver:Page) {
  await sender.goto('/drop'); await receiver.goto('/drop');
  await expect(sender.getByText('You’re online',{exact:true})).toBeVisible();
  await expect(receiver.getByText('You’re online',{exact:true})).toBeVisible();
  const code = await sender.locator('.pairing-code strong').innerText();
  await receiver.getByRole('button',{name:'Enter code',exact:true}).click();
  await receiver.getByLabel('Pairing code',{exact:true}).fill(code);
  await receiver.locator('.code-form').getByRole('button',{name:'Connect device',exact:true}).click();
  await sender.getByRole('dialog').getByRole('button',{name:'Connect',exact:true}).click();
  await expect(sender.getByText('Your devicesare connected.',{exact:false})).toBeVisible();
  await expect(receiver.getByText('Your devicesare connected.',{exact:false})).toBeVisible();
}
test('pair two devices, transfer exact file bytes, text and link with explicit acceptance', async ({browser}) => {
  const a = await browser.newContext({acceptDownloads:true}); const b = await browser.newContext({acceptDownloads:true});
  const sender = await a.newPage(); const receiver = await b.newPage();
  const errors:string[]=[]; sender.on('pageerror',e => errors.push(e.message)); receiver.on('pageerror',e => errors.push(e.message));
  try {
    await pair(sender,receiver);
    const payload = Buffer.alloc(262153); for(let i=0;i<payload.length;i++) payload[i]=i%251;
    await sender.getByLabel('Choose files to send').setInputFiles({name:'holiday-test.bin',mimeType:'application/octet-stream',buffer:payload});
    await expect(receiver.getByText('Incoming transfer',{exact:true})).toBeVisible();
    await expect(sender.getByText(/Waiting for .*…/)).toBeVisible();
    await receiver.getByRole('button',{name:'Accept',exact:true}).click();
    await expect(receiver.getByRole('link',{name:'Save file',exact:true})).toBeVisible({timeout:45000});
    const download = receiver.waitForEvent('download'); await receiver.getByRole('link',{name:'Save file',exact:true}).click();
    const file = await download; const saved = await readFile((await file.path())!);
    expect(createHash('sha256').update(saved).digest('hex')).toBe(createHash('sha256').update(payload).digest('hex'));
    const transport = await sender.evaluate(async () => { const result = await (await fetch('/api/v1/transfer-history')).json(); return result.transfers.find((t: {item:{name:string}}) => t.item.name === 'holiday-test.bin')?.transport; });
    console.info(`Verified file transport: ${transport}`);
    await sender.getByRole('tab',{name:'Text',exact:true}).click(); await sender.getByLabel('Text to send',{exact:true}).fill('A private thought — hello from NearDrop.');
    await sender.getByRole('button',{name:'Send text',exact:true}).click(); await receiver.getByRole('button',{name:'Accept',exact:true}).click();
    await receiver.getByRole('button',{name:'View text',exact:true}).click(); await expect(receiver.getByLabel('Received text',{exact:true})).toHaveValue('A private thought — hello from NearDrop.'); await receiver.getByRole('button',{name:'Close dialog'}).click();
    await sender.getByRole('tab',{name:'Link',exact:true}).click(); await sender.getByLabel('Link to send',{exact:true}).fill('https://example.com/hello'); await sender.getByRole('button',{name:'Send link',exact:true}).click(); await receiver.getByRole('button',{name:'Accept',exact:true}).click(); await receiver.getByRole('button',{name:'View link',exact:true}).click(); await expect(receiver.getByRole('link',{name:'Open link'})).toHaveAttribute('href','https://example.com/hello');
    expect(errors).toEqual([]);
  } finally { await a.close(); await b.close(); }
});
test('encrypted relay works without WebRTC and interrupted transfers never complete',async ({browser}) => {
  const a = await browser.newContext(); const b = await browser.newContext({acceptDownloads:true});
  await a.addInitScript(() => { delete (window as unknown as Record<string,unknown>).RTCPeerConnection; });
  await b.addInitScript(() => { delete (window as unknown as Record<string,unknown>).RTCPeerConnection; });
  const sender = await a.newPage(); const receiver = await b.newPage();
  try {
    await pair(sender,receiver);
    await sender.getByLabel('Choose files to send').setInputFiles([{name:'relay.txt',mimeType:'text/plain',buffer:Buffer.from('Actual encrypted relay bytes')},{name:'second.txt',mimeType:'text/plain',buffer:Buffer.from('Second queued item')}]);
    await receiver.getByRole('button',{name:'Accept',exact:true}).click();
    await expect(receiver.getByRole('link',{name:'Save file',exact:true})).toBeVisible();
    await expect(receiver.getByText('Incoming transfer',{exact:true})).toBeVisible();
    await receiver.getByRole('button',{name:'Decline',exact:true}).click();
    await expect(sender.getByText('Declined',{exact:true})).toBeVisible();
    await sender.getByRole('link',{name:'relay.txt',exact:true}).click(); await expect(sender.getByText('Secure relay',{exact:true})).toBeVisible();
    await sender.goto('/drop'); await expect(sender.getByText('You’re online',{exact:true})).toBeVisible();
    await sender.getByLabel('Choose files to send').setInputFiles({name:'interrupted.bin',mimeType:'application/octet-stream',buffer:Buffer.alloc(1024*1024)});
    await expect(receiver.getByText('Incoming transfer',{exact:true})).toBeVisible(); await b.close();
    await expect(sender.getByText('Transfer interrupted',{exact:true})).toBeVisible();
  } finally { await a.close(); await b.close(); }
});
test('mobile layout, dark theme, rename and navigation', async ({page}) => {
  await page.setViewportSize({width:390,height:844}); await page.goto('/drop');
  await expect(page.getByRole('heading',{name:'From here. To there.'})).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button',{name:'Switch to dark theme'}).click(); await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await page.getByRole('navigation',{name:'Mobile navigation'}).getByRole('link',{name:'Settings'}).click();
  await page.getByLabel('Device name',{exact:true}).fill('My test phone'); await page.getByRole('button',{name:'Save',exact:true}).click(); await expect(page.getByRole('button',{name:'Saved',exact:true})).toBeVisible();
  await page.getByRole('navigation',{name:'Mobile navigation'}).getByRole('link',{name:'Transfer',exact:true}).click(); await expect(page.locator('.device-card.current').getByText('My test phone')).toBeVisible();
  await page.setViewportSize({width:320,height:740}); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('screen review across routes, desktop/mobile, light/dark and keyboard focus', async ({page},testInfo) => {
  const errors:string[]=[]; page.on('pageerror',error => errors.push(error.message));
  await mkdir('.data/previews',{recursive:true});
  await page.setViewportSize({width:1440,height:1000});
  await page.goto('/'); await page.keyboard.press('Tab'); await expect(page.getByRole('link',{name:'Skip to content'})).toBeFocused();
  await page.keyboard.press('Tab');
  await page.screenshot({path:`.data/previews/${testInfo.project.name}-landing.png`,fullPage:true});
  await page.goto('/drop'); await expect(page.locator('.pairing-code strong')).not.toHaveText('••••-••'); await expect(page.locator('.qr-frame img')).toBeVisible();
  await page.screenshot({path:`.data/previews/${testInfo.project.name}-desktop.png`,fullPage:true});
  for (const path of ['/connect','/devices','/history','/settings','/auth/sign-in','/auth/sign-up','/auth/forgot-password','/privacy']) { await page.goto(path); await expect(page.locator('h1')).toBeVisible(); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); }
  await page.setViewportSize({width:390,height:844}); await page.goto('/drop'); await expect(page.locator('.qr-frame img')).toBeVisible();
  await page.screenshot({path:`.data/previews/${testInfo.project.name}-mobile.png`,fullPage:true});
  await page.getByRole('button',{name:'Switch to dark theme'}).click(); await page.screenshot({path:`.data/previews/${testInfo.project.name}-mobile-dark.png`,fullPage:true});
  await page.getByRole('button',{name:'Add a device',exact:true}).click(); await expect(page.getByRole('dialog')).toBeVisible(); await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.setViewportSize({width:320,height:740});
  for (const path of ['/','/drop','/connect','/devices','/history','/settings','/auth/sign-in','/privacy']) { await page.goto(path); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),path).toBe(true); }
  expect(errors).toEqual([]);
});
test('memory receive fallback, empty files, cancelled requests and invalid pairing stay usable', async ({browser}) => {
  const a = await browser.newContext(); const b = await browser.newContext({acceptDownloads:true});
  await b.addInitScript(() => { if (navigator.storage) Object.defineProperty(navigator.storage,'getDirectory',{value:undefined,configurable:true}); });
  const sender = await a.newPage(); const receiver = await b.newPage();
  try {
    await sender.goto('/drop'); await expect(sender.locator('.qr-frame img')).toBeVisible();
    await sender.getByRole('button',{name:'Enter code',exact:true}).click(); await sender.getByLabel('Pairing code',{exact:true}).fill('ABCDEF'); await sender.locator('.code-form').getByRole('button',{name:'Connect device',exact:true}).click(); await expect(sender.getByText(/pairing code is invalid or expired/)).toBeVisible();
    await pair(sender,receiver);
    await sender.getByLabel('Choose files to send').setInputFiles({name:'empty.txt',mimeType:'text/plain',buffer:Buffer.alloc(0)});
    await receiver.getByRole('button',{name:'Accept',exact:true}).click(); const emptyDownload = receiver.waitForEvent('download'); await receiver.getByRole('link',{name:'Save file',exact:true}).click(); expect((await readFile((await (await emptyDownload).path())!)).length).toBe(0);
    await receiver.getByRole('button',{name:'Dismiss',exact:true}).click();
    await sender.getByLabel('Choose files to send').setInputFiles({name:'memory.txt',mimeType:'text/plain',buffer:Buffer.from('Memory fallback is bounded and real.')}); await receiver.getByRole('button',{name:'Accept',exact:true}).click();
    const download = receiver.waitForEvent('download'); await receiver.getByRole('link',{name:'Save file',exact:true}).click(); expect(await readFile((await (await download).path())!,'utf8')).toBe('Memory fallback is bounded and real.');
    await sender.getByLabel('Choose files to send').setInputFiles({name:'cancel.txt',mimeType:'text/plain',buffer:Buffer.from('Do not send')}); await expect(receiver.getByText('Incoming transfer',{exact:true})).toBeVisible(); await sender.getByRole('button',{name:'Cancel cancel.txt',exact:true}).click(); await expect(receiver.getByText('Cancelled',{exact:true})).toBeVisible();
  } finally { await a.close(); await b.close(); }
});
test('initial connection failure retries and blocked local storage does not break guest mode', async ({page}) => {
  await page.addInitScript(() => { Object.defineProperty(window,'localStorage',{get(){throw new DOMException('Storage blocked','SecurityError');}}); });
  let attempts = 0;
  await page.route('**/api/v1/devices/register',async route => { if (++attempts === 1) await route.abort('connectionfailed'); else await route.continue(); });
  await page.goto('/drop'); await expect(page.getByText('You’re offline',{exact:true})).toBeVisible();
  await expect(page.getByText('You’re online',{exact:true})).toBeVisible({timeout:30000});
  await expect(page.locator('.qr-frame img')).toBeVisible();
});
