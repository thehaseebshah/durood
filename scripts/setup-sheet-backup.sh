#!/usr/bin/env bash
# One command sets up the Google Sheet backup, entirely from the terminal:
#   bash scripts/setup-sheet-backup.sh
# It makes the Google Sheet and its receiving script (with clasp, Google's Apps Script tool), deploys the script as a web app,
# gives the address and a fresh secret to the Cloudflare Worker, and sends a first backup so you can see it work.
# Needs: Node, and the one-time switch "Google Apps Script API" turned on at https://script.google.com/home/usersettings
set -euo pipefail
cd "$(dirname "$0")/.."
WORKER_URL="${WORKER_URL:-https://tasbeeh.haseebshah.workers.dev}"

echo "1/6  Updating the Worker (it gets a way to run a backup on demand)..."
git pull --ff-only
npm install --no-audit --no-fund >/dev/null
npm run deploy >/dev/null

mkdir -p .sheet-backup && cd .sheet-backup
echo "2/6  Signing in to Google (a browser window opens by itself)..."
npx --yes @google/clasp login

echo "3/6  Creating the Google Sheet and its script..."
SECRET="$(openssl rand -hex 24)"
sed "s/put-a-long-random-secret-here/${SECRET}/" ../docs/google-sheets-backup.gs > Code.js
cat > appsscript.json <<'JSON'
{
  "timeZone": "Asia/Karachi",
  "exceptionLogging": "STACKDRIVER",
  "runtimeVersion": "V8",
  "oauthScopes": ["https://www.googleapis.com/auth/spreadsheets.currentonly"],
  "webapp": { "executeAs": "USER_DEPLOYING", "access": "ANYONE_ANONYMOUS" }
}
JSON
[ -f .clasp.json ] || npx @google/clasp create-script --type sheets --title "Tasbeeh backup"
npx @google/clasp push --force

echo "4/6  Publishing the script as a web app..."
DEPLOY_OUT="$(npx @google/clasp create-deployment --description "backup receiver $(date +%s)" 2>&1)"; echo "$DEPLOY_OUT"
# the address of the web app is the id Google just printed for the new deployment (never the "@HEAD" test one)
DEPLOY_ID="$(printf '%s' "$DEPLOY_OUT" | grep -o 'AKfy[A-Za-z0-9_-]*' | head -1)"
if [ -z "$DEPLOY_ID" ]; then DEPLOY_ID="$(npx @google/clasp list-deployments | grep -v HEAD | grep -o 'AKfy[A-Za-z0-9_-]*' | tail -1)"; fi
[ -n "$DEPLOY_ID" ] || { echo "Could not read the deployment id. Run: npx @google/clasp list-deployments"; exit 1; }
URL="https://script.google.com/macros/s/${DEPLOY_ID}/exec"
# a working web app answers a wrong secret with a small JSON message; Google's "unable to open the file" page means the address is not a web app
if ! curl -sL -m 40 -X POST -H 'Content-Type: text/plain' -d '{}' "$URL" | grep -q 'bad token'; then
  echo "     (the web app does not answer yet; this is normal until you allow it in the next step)"
fi

echo "5/6  Giving the address and the secret to the Worker..."
cd ..
printf '%s' "$URL" | npx wrangler secret put SHEETS_URL
printf '%s' "$SECRET" | npx wrangler secret put SHEETS_TOKEN

echo
echo "6/6  One click only Google can do: it must ask YOU, the owner, to allow the script to use the sheet."
echo "     Opening ${URL}"
(open "$URL" 2>/dev/null || xdg-open "$URL" 2>/dev/null || echo "     Open this address in your browser: $URL")
read -r -p "     Click Advanced > Go to Tasbeeh backup > Allow, then press Enter here... " _

echo "Sending a first backup..."
curl -s -X POST "${WORKER_URL}/api/backup" -H "x-backup-token: ${SECRET}"; echo
echo "Status:"
curl -s "${WORKER_URL}/healthz"; echo
echo "Done. Your sheet is in Google Drive, named \"Tasbeeh backup\"."
