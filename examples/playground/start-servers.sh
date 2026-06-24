#!/bin/bash
# Start two CLI serve instances for the platform playground project.
# Run this BEFORE `bun run dev`.
#
# Web App  → port 3001
# Mobile App → port 3002

DIR="$(cd "$(dirname "$0")" && pwd)"
CLI="$DIR/../../dist/index.cjs"

# Find node
if command -v node &>/dev/null; then
  NODE=node
elif [ -f "$HOME/.nvm/versions/node/v22.14.0/bin/node" ]; then
  NODE="$HOME/.nvm/versions/node/v22.14.0/bin/node"
else
  echo "Error: node not found. Install Node.js or set up nvm."
  exit 1
fi

echo "Using node: $($NODE --version)"
echo ""

echo "Starting Web App server on :3001..."
"$NODE" "$CLI" serve \
  --root "$DIR/plans/web-plan" \
  --port 3001 \
  --no-ui &
PID_WEB=$!

echo "Starting Mobile App server on :3002..."
"$NODE" "$CLI" serve \
  --root "$DIR/plans/mobile-plan" \
  --port 3002 \
  --no-ui &
PID_MOBILE=$!

echo ""
echo "  Web App API:    http://localhost:3001/api"
echo "  Mobile App API: http://localhost:3002/api"
echo ""
echo "  Now run: bun run dev"
echo "  Open:    http://localhost:4000"
echo ""
echo "Press Ctrl+C to stop both servers."

cleanup() {
  kill "$PID_WEB" "$PID_MOBILE" 2>/dev/null
  exit
}
trap cleanup INT TERM

wait
