import { handleHttp } from '../../../../../server/http-platform';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;
export const GET = handleHttp;
export const POST = handleHttp;
export const PATCH = handleHttp;
export const DELETE = handleHttp;
