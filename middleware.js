import { NextResponse } from 'next/server';

const COOKIE_NAME = 'ps_demo_access';
const COOKIE_VALUE = 'granted';
const PUBLIC_PATHS = ['/gate', '/api/gate'];

export function middleware(request) {
  const { pathname } = request.nextUrl;

  // Allow gate page and gate API through without cookie check
  if (PUBLIC_PATHS.some(p => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // Allow static assets through
  if (pathname.match(/\.(ico|png|jpg|jpeg|svg|css|js|woff|woff2|ttf|map)$/)) {
    return NextResponse.next();
  }

  // Check for access cookie
  const cookie = request.cookies.get(COOKIE_NAME);
  if (cookie && cookie.value === COOKIE_VALUE) {
    return NextResponse.next();
  }

  // Redirect to gate
  const url = request.nextUrl.clone();
  url.pathname = '/gate';
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
