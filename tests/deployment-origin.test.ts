import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deploymentOrigins, PRODUCTION_ORIGIN } from '../server/deployment-origin';
import { backendFailure } from '../server/backend-error';

test('production ignores a stale localhost origin without weakening HTTPS or CSRF',()=>{
  const resolved=deploymentOrigins('https://attacker.example/api/v1/devices/register',{
    NODE_ENV:'production',VERCEL:'1',VERCEL_ENV:'production',APP_ORIGIN:'http://localhost:3000',
    VERCEL_PROJECT_PRODUCTION_URL:'neardrops.vercel.app',VERCEL_URL:'neardrops-deployment.vercel.app',
  });
  assert.equal(resolved.canonical,PRODUCTION_ORIGIN);assert.equal(resolved.secure,true);
  assert.equal(resolved.allowed.includes('http://localhost:3000'),false);
  assert.equal(resolved.allowed.includes('https://attacker.example'),false);
  assert.ok(resolved.allowed.includes('https://neardrops-deployment.vercel.app'));
});
test('production fallback works without system variables, previews and explicit custom domains are supported',()=>{
  assert.equal(deploymentOrigins('http://untrusted-host/',{NODE_ENV:'production',APP_ORIGIN:'http://localhost:3000'}).canonical,PRODUCTION_ORIGIN);
  assert.equal(deploymentOrigins('https://anything/',{NODE_ENV:'production',APP_ORIGIN:'https://drop.example/'}).canonical,'https://drop.example');
  const preview=deploymentOrigins('https://other/',{NODE_ENV:'production',VERCEL:'1',VERCEL_ENV:'preview',VERCEL_PROJECT_PRODUCTION_URL:'neardrops.vercel.app',VERCEL_BRANCH_URL:'neardrops-git-test.vercel.app'});
  assert.ok(preview.allowed.includes('https://neardrops-git-test.vercel.app'));
  for(const invalid of ['https://name:password@evil.example','https://evil.example/path','https://evil.example/?q=1','garbage','https://localhost'])
    assert.equal(deploymentOrigins('https://anything/',{NODE_ENV:'production',APP_ORIGIN:invalid}).canonical,PRODUCTION_ORIGIN);
});
test('local development keeps its explicit HTTP origin',()=>{
  const resolved=deploymentOrigins('http://localhost:3118/api',{NODE_ENV:'development',APP_ORIGIN:'http://localhost:3118'});
  assert.equal(resolved.canonical,'http://localhost:3118');assert.equal(resolved.secure,false);
});
test('database failures are actionable and contain no credentials or raw error message',()=>{
  assert.equal(backendFailure({code:'ENOTFOUND'}).code,'DATABASE_DNS_ERROR');
  assert.equal(backendFailure({code:'42P01'}).retryable,false);
  assert.equal(backendFailure({code:'28P01'}).code,'DATABASE_AUTH_ERROR');
  assert.equal(backendFailure({code:'42501'}).code,'DATABASE_PERMISSION_ERROR');
  const result=backendFailure(new Error('postgresql://user:secret@private-host/database'));
  assert.equal(JSON.stringify(result).includes('secret'),false);
  assert.equal(JSON.stringify(result).includes('private-host'),false);
});
