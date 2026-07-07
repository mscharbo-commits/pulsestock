export const config = {
  matcher: '/((?!api/|gate|_vercel|favicon.ico|assets/).*)',
};

export default function middleware(request) {
  const url = new URL(request.url);
  const pathname = url.pathname;

  // Allow all API routes through without cookie check
  if (pathname.startsWith('/api/')) return;

  // Allow static file extensions through
  if (/\.(ico|png|jpg|jpeg|svg|css|woff|woff2|ttf|map|gif|webp|js)$/.test(pathname)) return;

  // Check for access cookie
  const cookies = request.headers.get('cookie') || '';
  const hasAccess = cookies.includes('ps_demo_access=granted');

  if (!hasAccess) {
    return Response.redirect(new URL('/gate', request.url));
  }
}
