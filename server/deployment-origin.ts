// Explicit project default, supplied by the owner. Never derive a production
// allowlist from Host, X-Forwarded-Host, or the browser's Origin header.
export const PRODUCTION_ORIGIN = 'https://neardrops.vercel.app';
type Environment = Readonly<Record<string, string | undefined>>;

function publicHttps(value: string | undefined, hostnameOnly = false) {
  if (!value?.trim()) return undefined;
  try {
    const url = new URL(hostnameOnly ? `https://${value.trim()}` : value.trim());
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) return undefined;
    if (url.hostname === 'localhost' || url.hostname.endsWith('.localhost') || url.hostname === '127.0.0.1' || url.hostname === '[::1]') return undefined;
    return url.origin;
  } catch { return undefined; }
}

export function deploymentOrigins(requestUrl: string, env: Environment = process.env) {
  const deployed = env.NODE_ENV === 'production' || (env.VERCEL === '1' && env.VERCEL_ENV !== 'development');
  if (!deployed) {
    const canonical = new URL(env.APP_ORIGIN || requestUrl).origin;
    return { canonical, allowed: [canonical], secure: canonical.startsWith('https:') };
  }
  const configured = publicHttps(env.APP_ORIGIN);
  const vercel = env.VERCEL === '1';
  const production = vercel ? publicHttps(env.VERCEL_PROJECT_PRODUCTION_URL, true) : undefined;
  const deployment = vercel ? publicHttps(env.VERCEL_URL, true) : undefined;
  const branch = vercel ? publicHttps(env.VERCEL_BRANCH_URL, true) : undefined;
  const canonical = configured || production || PRODUCTION_ORIGIN;
  return {
    canonical,
    allowed: [...new Set([canonical, production, deployment, branch].filter((value): value is string => !!value))],
    secure: true,
  };
}
