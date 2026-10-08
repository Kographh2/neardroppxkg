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
    // Reproduce WAN signaling latency that used to exceed the 8-second budget.
    test.setTimeout(180000);
    await sender.route('**/api/v1/events',async route=>{
      if(route.request().method()==='POST' && route.request().postDataJSON()?.event?.description?.type==='offer') await new Promise(resolve=>setTimeout(resolve,9000));
      await route.continue();
    });
    const bytes=randomBytes(2*1024*1024+9);
    await sender.getByLabel('Choose files to send').setInputFiles({name:'vercel-proof.bin',mimeType:'application/octet-stream',buffer:bytes});
    await receiver.getByRole('button',{name:'Accept',exact:true}).click();
    await expect(receiver.getByRole('link',{name:'Save file',exact:true})).toBeVisible({timeout:60000});
    const downloaded=receiver.waitForEvent('download');await receiver.getByRole('link',{name:'Save file',exact:true}).click();
    const received=await readFile((await (await downloaded).path())!);
    expect(createHash('sha256').update(received).digest('hex')).toBe(createHash('sha256').update(bytes).digest('hex'));
    await expect(sender.getByText('Sent',{exact:true})).toBeVisible();
    await sender.getByRole('navigation',{name:'Main navigation',exact:true}).getByRole('link',{name:'Chat',exact:true}).click();
    await receiver.getByRole('navigation',{name:'Main navigation',exact:true}).getByRole('link',{name:'Chat',exact:true}).click();
    for(const [page,code] of [[sender,'alice-secret-phrase'],[receiver,'bob-secret-phrase']] as const) {
      await page.getByRole('button',{name:'Set private code',exact:true}).click();
      await page.getByRole('dialog').getByLabel('Private code',{exact:true}).fill(code);
      await page.getByRole('dialog').getByLabel('Confirm private code',{exact:true}).fill(code);
      await page.getByRole('button',{name:'Save private code',exact:true}).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
    }
    const secret='A private message that must never appear in the chat list';
    await expect(sender.getByLabel('Message',{exact:true})).toBeEnabled();
    await sender.getByLabel('Message',{exact:true}).fill(secret);
    await sender.getByLabel('Private code to send',{exact:true}).fill('alice-secret-phrase');
    await sender.getByRole('button',{name:'Send privately',exact:true}).click();
    await expect(receiver.locator('.cipher-message')).toHaveCount(1);
    await expect(receiver.getByText(secret,{exact:true})).toHaveCount(0);
    await receiver.locator('.cipher-message').click();
    await receiver.getByRole('dialog').getByLabel('Private code',{exact:true}).fill('incorrect-code');
    await receiver.getByRole('button',{name:'Unlock message',exact:true}).click();
    await expect(receiver.getByRole('dialog').getByRole('alert')).toContainText('Incorrect private code');
    await receiver.getByRole('dialog').getByLabel('Private code',{exact:true}).fill('bob-secret-phrase');
    await receiver.getByRole('button',{name:'Unlock message',exact:true}).click();
    await expect(receiver.locator('.private-message')).toHaveText(secret);
    await receiver.getByRole('button',{name:'Close & lock',exact:true}).click();
    await expect(receiver.getByText(secret,{exact:true})).toHaveCount(0);
    await receiver.locator('.cipher-message').click();
    await expect(receiver.getByRole('button',{name:'Unlock message',exact:true})).toBeVisible();
    await expect(receiver.getByText(secret,{exact:true})).toHaveCount(0);
    await receiver.getByRole('button',{name:'Close dialog',exact:true}).click();
    await receiver.setViewportSize({width:320,height:720});
    expect(await receiver.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  } finally {await a.close();await b.close();}
});
