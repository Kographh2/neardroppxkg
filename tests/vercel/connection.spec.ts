import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';

test('missing API is not offline; manual retry recovers; real network offline recovers',async({page,context})=>{
  let missing=true,attempts=0;
  await page.route('**/api/v1/devices/register',async route=>{
    attempts++;if(missing)await route.fulfill({status:404,contentType:'text/html',body:'<html>Not found</html>'});else await route.continue();
  });
  await page.goto('/drop');await expect(page.locator('.online-label')).toHaveText('Server unavailable');
  await expect(page.getByText(/API is missing from this deployment/)).toBeVisible();
  await expect(page.getByRole('button',{name:'Try again',exact:true})).toBeVisible();
  expect(attempts).toBe(1);missing=false;
  await page.getByRole('button',{name:'Try again',exact:true}).click();
  await expect(page.locator('.online-label')).toHaveText('You’re online');await expect(page.locator('.qr-frame img')).toBeVisible();
  await context.setOffline(true);await expect(page.locator('.online-label')).toHaveText('You’re offline');
  await context.setOffline(false);await expect(page.locator('.online-label')).toHaveText('You’re online');
  await page.setViewportSize({width:320,height:740});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('permanent configuration errors stop automatic retries and manual retry can recover',async({page})=>{
  await page.clock.install();let broken=true,attempts=0;
  await page.route('**/api/v1/devices/register',async route=>{
    attempts++;
    if(broken)await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'The database tables are not ready.',code:'DATABASE_SCHEMA_MISSING',retryable:false})});
    else await route.continue();
  });
  await page.goto('/drop');await expect(page.locator('.online-label')).toHaveText('Server unavailable');
  await expect(page.getByText('The database tables are not ready.')).toBeVisible();
  await page.clock.fastForward(31000);expect(attempts).toBe(1);
  broken=false;await page.getByRole('button',{name:'Try again',exact:true}).click();
  await expect(page.locator('.online-label')).toHaveText('You’re online');
});

test('Next route handlers pair two guests and transfer exact file bytes with HTTP signaling',async({browser})=>{
  const a=await browser.newContext(),b=await browser.newContext({acceptDownloads:true});
  const sender=await a.newPage(),receiver=await b.newPage();
  const errors:string[]=[];sender.on('pageerror',e=>errors.push(e.message));receiver.on('pageerror',e=>errors.push(e.message));
  try {
    await sender.goto('/drop');await receiver.goto('/drop');
    await expect(sender.locator('.qr-frame img')).toBeVisible();await expect(receiver.locator('.qr-frame img')).toBeVisible();
    const code=await sender.locator('.pairing-code strong').innerText();
    await receiver.getByRole('button',{name:'Enter code',exact:true}).click();await receiver.getByLabel('Pairing code',{exact:true}).fill(code);
    await receiver.locator('.code-form').getByRole('button',{name:'Connect device',exact:true}).click();
    await sender.getByRole('dialog').getByRole('button',{name:'Connect',exact:true}).click();
    await expect(sender.locator('.connected-summary')).toBeVisible();
    await expect(receiver.locator('.connected-summary')).toBeVisible();
    const bytes=randomBytes(262153);
    await sender.getByLabel('Choose files to send').setInputFiles({name:'vercel-proof.bin',mimeType:'application/octet-stream',buffer:bytes});
    await receiver.getByRole('button',{name:'Accept',exact:true}).click();
    const downloaded=receiver.waitForEvent('download');await receiver.getByRole('link',{name:'Save file',exact:true}).click();
    const received=await readFile((await (await downloaded).path())!);
    expect(createHash('sha256').update(received).digest('hex')).toBe(createHash('sha256').update(bytes).digest('hex'));
    await expect(sender.getByText('Sent',{exact:true})).toBeVisible();
    expect(errors).toEqual([]);
  } finally {await a.close();await b.close();}
});
