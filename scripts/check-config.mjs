import nextEnv from '@next/env';
nextEnv.loadEnvConfig(process.cwd());
const databaseUrl=process.env.DATABASE_URL || process.env.POSTGRES_URL;
let database={configured:!!databaseUrl,
  looksLikeConnectionString:/^postgres(ql)?:\/\//i.test(databaseUrl || ''),
  copiedPsqlCommand:/^psql\s/i.test(databaseUrl || ''),
  duplicatedAssignment:/^(DATABASE_URL|POSTGRES_URL)=/i.test(databaseUrl || ''),
  containsPlaceholder:/YOUR[-_]|project-ref|your-project|\[PROJECT/i.test(databaseUrl || ''),
};
if(databaseUrl) {
  try {
    const parsed=new URL(databaseUrl);
    database={...database,
      validProtocol:['postgres:','postgresql:'].includes(parsed.protocol),
      connectionType:parsed.hostname.endsWith('.pooler.supabase.com')?'supabase-pooler':parsed.hostname.startsWith('db.')&&parsed.hostname.endsWith('.supabase.co')?'supabase-direct':parsed.hostname==='localhost'?'local':'other',
      placeholder:/YOUR[-_]|\[|\]|<|>|project-ref|your-project/i.test(databaseUrl),
      hasPassword:!!parsed.password,
    };
  }catch {database={...database,validUrl:false};}
}
let appOrigin='not configured';
try {if(process.env.APP_ORIGIN)appOrigin=new URL(process.env.APP_ORIGIN).origin;}catch {appOrigin='invalid';}
console.log(JSON.stringify({appOrigin,database,supabaseConfigured:!!process.env.NEXT_PUBLIC_SUPABASE_URL,vercel:process.env.VERCEL==='1'},null,2));
