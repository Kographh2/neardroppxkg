import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

test('NearSpace contains only app choices; NearChat requires an account',async({page})=>{
 await page.goto('/');await expect(page.locator('.nearspace-app')).toHaveCount(2);
 await expect(page.getByText('Move anything.',{exact:true})).toHaveCount(0);
 await mkdir('.data/previews',{recursive:true});await page.screenshot({path:'.data/previews/nearspace-desktop.png',fullPage:true});
 await page.setViewportSize({width:320,height:740});await page.screenshot({path:'.data/previews/nearspace-mobile.png',fullPage:true});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.getByRole('link',{name:'NearChat',exact:true}).click();await expect(page.getByRole('button',{name:'Sign in',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Show QR & pairing code',exact:true})).toBeVisible();
 await page.screenshot({path:'.data/previews/nearchat-login-mobile.png',fullPage:true});
});

test('NearChat sends real room messages, creates groups and links/revokes a desktop by code',async({browser})=>{
 test.setTimeout(180000);
 const a=await browser.newContext(),b=await browser.newContext(),desktopContext=await browser.newContext();
 await a.addCookies([{name:'nc_session',value:'near-chat-alice-test',url:'http://localhost:3118'}]);
 await b.addCookies([{name:'nc_session',value:'near-chat-bob-test',url:'http://localhost:3118'}]);
 const alice=await a.newPage(),bob=await b.newPage(),desktop=await desktopContext.newPage();const errors:string[]=[];
 for(const p of [alice,bob,desktop])p.on('pageerror',e=>errors.push(e.message));
 try{
  await alice.goto('/near-chat');await bob.goto('/near-chat');
  await alice.getByRole('button',{name:'New conversation',exact:true}).first().click();
  await alice.getByLabel('Their username',{exact:true}).fill('bob_test');await alice.getByRole('button',{name:'Start chat',exact:true}).click();
  await expect(alice.getByLabel('Message',{exact:true})).toBeVisible();
  const text='Meet at 4? <script>text stays text</script>';
  await alice.getByLabel('Message',{exact:true}).fill(text);await alice.getByRole('button',{name:'Send message',exact:true}).click();
  await bob.locator('.nc-conversations button').filter({hasText:'Alice Test'}).click();
  await expect(bob.locator('.nc-bubble p').filter({hasText:text})).toBeVisible();
  await bob.getByLabel('Message',{exact:true}).fill('Yes, see you then.');await bob.getByRole('button',{name:'Send message',exact:true}).click();
  await expect(alice.getByText('Yes, see you then.',{exact:true})).toBeVisible();
  await alice.screenshot({path:'.data/previews/nearchat-desktop.png',fullPage:true});
  await alice.getByRole('button',{name:'Switch to dark theme',exact:true}).click();await alice.screenshot({path:'.data/previews/nearchat-dark.png',fullPage:true});
  await bob.setViewportSize({width:320,height:740});expect(await bob.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await bob.screenshot({path:'.data/previews/nearchat-mobile.png',fullPage:true});
  await alice.getByRole('button',{name:'New conversation',exact:true}).first().click();await alice.getByLabel('Create a group',{exact:true}).check();
  await alice.getByLabel('Group name',{exact:true}).fill('Weekend plans');await alice.getByLabel('Usernames, separated by commas',{exact:true}).fill('bob_test');await alice.getByRole('button',{name:'Start chat',exact:true}).click();
  await expect(alice.locator('.nc-room-title')).toContainText('Weekend plans');
  await desktop.goto('/near-chat');await desktop.getByRole('button',{name:'Show QR & pairing code',exact:true}).click();
  await expect(desktop.locator('.nc-pair-code')).toBeVisible();const code=await desktop.locator('.nc-pair-code').innerText();
  await expect(desktop.getByRole('img',{name:'Scan to request desktop sign-in'})).toBeVisible();
  await alice.getByRole('button',{name:'Link device',exact:true}).click();await alice.getByLabel('Desktop pairing code',{exact:true}).fill(code);
  await alice.getByRole('button',{name:'Check device',exact:true}).click();await expect(desktop.locator('.nc-sidebar')).toHaveCount(0);
  await alice.getByRole('button',{name:'Approve sign-in',exact:true}).click();await alice.getByRole('button',{name:'Done',exact:true}).click();
  await expect(desktop.locator('.nc-profile')).toContainText('Alice Test');
  await alice.getByRole('button',{name:'Devices',exact:true}).click();await alice.locator('.nc-session').filter({hasText:'Linked computer'}).getByRole('button',{name:'Revoke',exact:true}).click();
  await expect(desktop.getByRole('button',{name:'Sign in',exact:true})).toBeVisible();expect(errors).toEqual([]);
 }finally{await a.close();await b.close();await desktopContext.close();}
});
