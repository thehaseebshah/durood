#!/bin/sh
# Runs the unit tests with the clock moved to moments where date logic tends to break:
# just after Pakistan midnight going into a Monday (yesterday is in last week), the last minute of a Pakistan day,
# and New Year's Eve turning into the new year in Pakistan.
#   npm run test:dates
fail=0
for t in 2026-10-25T19:05:00Z 2026-10-28T18:59:00Z 2026-12-31T19:10:00Z; do
  out=$(TARGET_ISO=$t NODE_OPTIONS="--import=$(pwd)/scripts/clock-shift.mjs" FLAG_NEW_HIGH=1000000000 node --test --no-warnings test/*.test.js 2>&1) || fail=1
  echo "clock at $t: $(echo "$out" | grep -E '^# (pass|fail)' | tr '\n' ' ')"
done
exit $fail
