#!/bin/sh
# Rebuilds the two small Arabic font files from the full Amiri font (scripts/fonts/amiri-source.woff2, SIL Open Font License):
#   public/fonts/amiri-durood.woff2  only the letters of the durood shown on the welcome screens (scripts/fonts/durood-chars.txt)
#   public/fonts/salawat.woff2       only ﷺ, for English text
# Needs fonttools with brotli (pip install fonttools brotli). Run it after changing the durood text; test/client.test.js checks they agree.
set -e
pyftsubset scripts/fonts/amiri-source.woff2 --text-file=scripts/fonts/durood-chars.txt --layout-features='*' --flavor=woff2 --output-file=public/fonts/amiri-durood.woff2
pyftsubset scripts/fonts/amiri-source.woff2 --unicodes=U+FDFA --layout-features='*' --flavor=woff2 --output-file=public/fonts/salawat.woff2
