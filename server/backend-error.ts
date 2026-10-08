export interface BackendFailure { code: string; message: string; retryable: boolean }

/** Map safe diagnostic categories, never SQL, hostnames, passwords or stack traces. */
export function backendFailure(error: unknown): BackendFailure {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  switch (code) {
    case 'DATABASE_NOT_CONFIGURED':
      return {code,message:'Set DATABASE_URL in Vercel to the PostgreSQL connection string from Supabase Connect → Transaction pooler, then redeploy.',retryable:false};
    case 'DATABASE_URL_INVALID':
      return {code,message:'DATABASE_URL is not a valid PostgreSQL connection string. Paste the connection URI from Supabase Connect → Transaction pooler into its Vercel value field, then redeploy.',retryable:false};
    case 'ENOTFOUND': case 'EAI_AGAIN':
      return { code:'DATABASE_DNS_ERROR', message:'The database hostname could not be resolved. In Vercel, set DATABASE_URL to the exact connection string from Supabase Connect → Transaction pooler, then redeploy. Check that the Supabase project is active.', retryable:true };
    case '28P01': case '28000':
      return { code:'DATABASE_AUTH_ERROR', message:'The database rejected its credentials. Update the database username and password in Vercel DATABASE_URL, then redeploy.', retryable:false };
    case '42P01': case '42703':
      return { code:'DATABASE_SCHEMA_MISSING', message:'The NearDrop database tables are not ready. Run migrations/001_platform.sql and migrations/002_http_signaling.sql in Supabase SQL Editor, then press Try again.', retryable:false };
    case '42501':
      return { code:'DATABASE_PERMISSION_ERROR', message:'The backend database role cannot access the NearDrop tables. Configure DATABASE_URL with the authorized backend database role.', retryable:false };
    case 'DEPTH_ZERO_SELF_SIGNED_CERT': case 'SELF_SIGNED_CERT_IN_CHAIN': case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE': case 'CERT_HAS_EXPIRED':
      return { code:'DATABASE_TLS_ERROR', message:'The database TLS certificate could not be verified. Configure the provider CA certificate; do not disable TLS verification.', retryable:false };
    case 'ECONNREFUSED': case 'ETIMEDOUT': case 'ENETUNREACH': case 'EHOSTUNREACH':
      return { code:'DATABASE_UNREACHABLE', message:'The database could not be reached. Check that the project is active and use the Supabase transaction pooler connection string for Vercel.', retryable:true };
    case '53300':
      return { code:'DATABASE_CAPACITY', message:'The database has reached its connection limit. Try again shortly; the site owner should check connection pooling.', retryable:true };
    default:
      return { code:'BACKEND_UNAVAILABLE', message:'The NearDrop backend is unavailable. Check the Vercel function logs and database configuration, then try again.', retryable:true };
  }
}
