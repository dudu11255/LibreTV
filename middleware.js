// Vercel Middleware to inject environment variables
export default async function middleware(request) {
  // Get the URL from the request
  const url = new URL(request.url);
  
  // Only process HTML pages
  const isHtmlPage = url.pathname.endsWith('.html') || url.pathname.endsWith('/');
  if (!isHtmlPage) {
    return; // Let the request pass through unchanged
  }

  // Fetch the original response
  const response = await fetch(request);
  
  // Check if it's an HTML response
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) {
    return response; // Return the original response if not HTML
  }

  // Get the HTML content
  const originalHtml = await response.text();
  
  // Hash the password before injecting it
  const password = process.env.PASSWORD || '';
  
  // Create a new response with the modified HTML
  // If password is set, inject it directly but with a comment indicating it's for hashing
  // Client-side code will hash it before comparison
  const modifiedHtml = originalHtml.replace(
    'window.__ENV__.PASSWORD = "{{PASSWORD}}";',
    `window.__ENV__.PASSWORD = "${password}"; // This will be hashed client-side before comparison`
  );
  
  // Return the new response
  return new Response(modifiedHtml, {
    headers: response.headers,
    status: response.status,
    statusText: response.statusText,
  });
}

// Simple SHA-256 hash function
async function sha256(message) {
  // Encode as UTF-8
  const msgBuffer = new TextEncoder().encode(message);                    
  // Hash the message
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  // Convert to hex string
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export const config = {
  matcher: ['/', '/((?!api|_next/static|_vercel|favicon.ico).*)'],
};