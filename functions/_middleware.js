// Cloudflare Pages Middleware to inject environment variables
export async function onRequest(context) {
  const { request, env, next } = context;
  
  // Proceed to the next middleware or route handler
  const response = await next();
  
  // Check if the response is HTML
  const contentType = response.headers.get("content-type") || "";
  
  if (contentType.includes("text/html")) {
    // Get the original HTML content
    let html = await response.text();
    
    // Get the password from environment variables
    const password = env.PASSWORD || "";
    
    // Inject the password directly to be hashed client-side
    html = html.replace(
      'window.__ENV__.PASSWORD = "{{PASSWORD}}";', 
      `window.__ENV__.PASSWORD = "${password}"; // This will be hashed client-side before comparison`
    );
    
    // Create a new response with the modified HTML
    return new Response(html, {
      headers: response.headers,
      status: response.status,
      statusText: response.statusText,
    });
  }
  
  // Return the original response for non-HTML content
  return response;
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