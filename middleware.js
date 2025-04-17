// Vercel Middleware to inject environment variables
import { NextResponse } from 'next/server';

export default function middleware(request) {
  // Get the original response
  const response = NextResponse.next();
  
  // Modify this to intercept HTML responses only
  // This is a simplified example - in production you'd want more robust content-type checking
  if (request.nextUrl.pathname.endsWith('.html') || request.nextUrl.pathname.endsWith('/')) {
    response.then(async (res) => {
      const contentType = res.headers.get('content-type');
      
      if (contentType && contentType.includes('text/html')) {
        // Get the HTML content
        const originalHtml = await res.text();
        
        // Replace the placeholder with actual environment variable
        // If PASSWORD is not set, replace with empty string
        const password = process.env.PASSWORD || '';
        const modifiedHtml = originalHtml.replace(
          'window.__ENV__.PASSWORD = "{{PASSWORD}}";',
          `window.__ENV__.PASSWORD = "${password}";`
        );
        
        // Create a new response with the modified HTML
        return new Response(modifiedHtml, {
          status: res.status,
          statusText: res.statusText,
          headers: res.headers
        });
      }
      
      return res;
    });
  }
  
  return response;
}

export const config = {
  matcher: ['/', '/((?!api|_next/static|favicon.ico).*)'],
};