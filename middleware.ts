/**
 * Vercel Edge Middleware
 * 1. Basic 認証（HTML ページ全体）— BASIC_AUTH_USER / BASIC_AUTH_PASS が設定されている場合のみ
 * 2. ボット・クローラーブロック（/api/* のみ）
 */

const BOT_UA =
  /bot|crawl|spider|slurp|archiver|wget|curl\/|python-requests|scrapy|httpclient|go-http|java\/|libwww|perl|ruby|php\/|ahrefsbot|semrushbot|mj12bot|dotbot|baiduspider|yandexbot|sogou|bytespider|petalbot|gptbot|claudebot|ccbot/i;

const SOCIAL_PREVIEW_UA =
  /twitterbot|facebookexternalhit|linkedinbot|slackbot|telegrambot|whatsapp|discordbot|redditbot/i;

const SOCIAL_PREVIEW_PATHS = new Set(['/api/story', '/api/og-story']);

// Slack uses Slack-ImgProxy to fetch OG images — distinct from Slackbot
const SOCIAL_IMAGE_UA =
  /Slack-ImgProxy|Slackbot|twitterbot|facebookexternalhit|linkedinbot|telegrambot|whatsapp|discordbot|redditbot/i;

// Basic 認証をスキップするパス
const AUTH_BYPASS_PREFIXES = ['/api/', '/_next/', '/favico/', '/ingest/'];
const AUTH_BYPASS_EXACT = new Set(['/sw.js', '/offline.html', '/manifest.webmanifest']);

function requiresAuth(pathname: string): boolean {
  if (AUTH_BYPASS_EXACT.has(pathname)) return false;
  return !AUTH_BYPASS_PREFIXES.some(p => pathname.startsWith(p));
}

function unauthorized(): Response {
  return new Response('Unauthorized', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Japan Monitor"' },
  });
}

export default function middleware(request: Request) {
  const url = new URL(request.url);
  const path = url.pathname;

  // --- Basic 認証（環境変数が設定されている場合のみ有効）---
  const authUser = process.env.BASIC_AUTH_USER;
  const authPass = process.env.BASIC_AUTH_PASS;

  if (authUser && authPass && requiresAuth(path)) {
    const authHeader = request.headers.get('Authorization') ?? '';
    if (!authHeader.startsWith('Basic ')) return unauthorized();

    const decoded = atob(authHeader.slice(6));
    const colon = decoded.indexOf(':');
    if (colon === -1) return unauthorized();

    const inputUser = decoded.slice(0, colon);
    const inputPass = decoded.slice(colon + 1);
    if (inputUser !== authUser || inputPass !== authPass) return unauthorized();
  }

  // --- 以下は /api/* と /favico/* にのみ適用（ボット保護）---
  const ua = request.headers.get('user-agent') ?? '';

  // Allow social preview/image bots on OG image assets (bypasses Vercel Attack Challenge)
  if (path.startsWith('/favico/') || path.endsWith('.png')) {
    if (SOCIAL_IMAGE_UA.test(ua)) return;
  }

  // Allow social preview bots on exact OG routes only
  if (SOCIAL_PREVIEW_UA.test(ua) && SOCIAL_PREVIEW_PATHS.has(path)) return;

  // Block bots from all API routes
  if (BOT_UA.test(ua)) {
    return new Response('{"error":"Forbidden"}', {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // No user-agent or suspiciously short — likely a script
  if (!ua || ua.length < 10) {
    return new Response('{"error":"Forbidden"}', {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

export const config = {
  matcher: ['/((?!_next/static|_next/image).*)'],
};
