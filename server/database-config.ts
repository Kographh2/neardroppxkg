import supabaseCertificate from './certificates/supabase-root.json' with { type: 'json' };
type Environment = Readonly<Record<string, string | undefined>>;

export function normalizeDatabaseUrl(input: string): string {
  let value=input.trim();
  // Accept a pasted dotenv assignment as well as its value. Never execute psql
  // commands, rewrite provider hosts, or guess/replace database credentials.
  for(let i=0;i<3;i++) {
    value=value.replace(/^(?:DATABASE_URL|POSTGRES_URL)\s*=\s*/i,'').trim();
    if((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value=value.slice(1,-1).trim();
  }
  return value;
}

export function databaseConnectionString(env: Environment = process.env): string {
  const input=env.DATABASE_URL?.trim() || env.POSTGRES_URL?.trim();
  if(!input) throw Object.assign(new Error('Database URL is not configured.'),{code:'DATABASE_NOT_CONFIGURED'});
  const value=normalizeDatabaseUrl(input);
  try {
    const url=new URL(value);
    if(!['postgres:','postgresql:'].includes(url.protocol) || !url.hostname) throw new Error();
  } catch {
    throw Object.assign(new Error('Database URL is not a PostgreSQL connection string.'),{code:'DATABASE_URL_INVALID'});
  }
  return value;
}

export function databasePoolOptions(env: Environment = process.env) {
  const connectionString=databaseConnectionString(env);
  const url=new URL(connectionString);
  const supabase=url.hostname.endsWith('.pooler.supabase.com') || (url.hostname.startsWith('db.') && url.hostname.endsWith('.supabase.co'));
  if(supabase) {
    // pg lets URL SSL options override the explicit SSL object. Remove these
    // options so strict verification and the official CA cannot be overwritten.
    for(const option of ['ssl','sslmode','sslrootcert','sslcert','sslkey','uselibpqcompat'])url.searchParams.delete(option);
    return {connectionString:url.toString(),ssl:{rejectUnauthorized:true,ca:env.DATABASE_CA_CERT?.replace(/\\n/g,'\n') || supabaseCertificate.pem}};
  }
  return {connectionString,ssl:env.DATABASE_SSL==='true'?{rejectUnauthorized:true}:undefined};
}
