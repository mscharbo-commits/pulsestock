export const config = {
  matcher: '/((?!api/|gate|_vercel|favicon.ico|assets/).*)',
};

export default function middleware(request) {
  // Password gate disabled — open access
  return;
}
