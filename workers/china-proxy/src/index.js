const UPSTREAM = 'https://aybkk-ashtanga.up.railway.app';

export default {
  async fetch(request) {
    const url = new URL(request.url);

    // Forward all headers but fix Host so Railway's LB routes correctly,
    // and add X-Forwarded-Host so the app can build QR/share links using
    // the proxy domain instead of the Railway origin.
    const headers = new Headers(request.headers);
    headers.set('host', 'aybkk-ashtanga.up.railway.app');
    headers.set('x-forwarded-host', url.hostname);
    headers.set('x-forwarded-proto', 'https');

    const upstreamReq = new Request(
      `${UPSTREAM}${url.pathname}${url.search}`,
      {
        method: request.method,
        headers,
        body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
        redirect: 'follow',
      }
    );

    const res = await fetch(upstreamReq);

    // Rewrite any stray absolute railway.app references in HTML/JSON
    // (covers legacy clients that were not updated to relative URLs).
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('text/html') || ct.includes('application/json')) {
      const text = await res.text();
      const rewritten = text.replaceAll(UPSTREAM, url.origin);
      return new Response(rewritten, { status: res.status, headers: res.headers });
    }

    return res;
  },
};
