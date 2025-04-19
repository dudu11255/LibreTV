#!/bin/sh
set -e

# Function to replace environment variables in HTML files
replace_env_vars() {
  # Replace the password placeholder in all HTML files
  find /usr/share/nginx/html -type f -name "*.html" -exec sed -i "s/window.__ENV__.PASSWORD = \"{{PASSWORD}}\";/window.__ENV__.PASSWORD = \"${PASSWORD:-}\";/g" {} \;
  
  # Add proxy API environment variable if needed
  if [ -n "$PROXY_API" ]; then
    find /usr/share/nginx/html -type f -name "*.html" -exec sed -i "s/window.__ENV__.PROXY_API = false;/window.__ENV__.PROXY_API = true;/g" {} \;
  fi
  
  echo "Environment variables have been injected into HTML files."
}

# Replace environment variables in HTML files
replace_env_vars

# Execute the command provided as arguments
exec "$@"