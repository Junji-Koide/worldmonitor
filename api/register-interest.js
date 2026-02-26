export const config = { runtime: 'edge' };

import { ConvexHttpClient } from 'convex/browser';
import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';
import { checkRateLimit, getClientIp } from './_rate-limit.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LENGTH = 320;

export default async function handler(req) {
  if (isDisallowedOrigin(req)) {
    return new Response(JSON.stringify({ error: 'Origin not allowed' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const cors = getCorsHeaders(req, 'POST, OPTIONS');

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json', ...cors },
    });
  }

  const ip = getClientIp(req);
  const { limited } = checkRateLimit(ip, { limit: 5, windowMs: 60 * 60 * 1000 });
  if (limited) {
    return new Response(JSON.stringify({ error: 'Rate limited' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json', ...cors },
    });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...cors },
    });
  }

  const { email, source, appVersion } = body;
  if (!email || typeof email !== 'string' || email.length > MAX_EMAIL_LENGTH || !EMAIL_RE.test(email)) {
    return new Response(JSON.stringify({ error: 'Invalid email address' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...cors },
    });
  }

  const convexUrl = process.env.CONVEX_URL;
  if (!convexUrl) {
    return new Response(JSON.stringify({ error: 'Registration service unavailable' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json', ...cors },
    });
  }

  try {
    const client = new ConvexHttpClient(convexUrl);
    const result = await client.mutation('registerInterest:register', {
      email,
      source: source || 'unknown',
      appVersion: appVersion || 'unknown',
    });
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...cors },
    });
  } catch (err) {
    console.error('[register-interest] Convex error:', err);
    return new Response(JSON.stringify({ error: 'Registration failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...cors },
    });
  }
}
