#!/bin/sh
# Rebuilds the two small Arabic font files from the full Amiri font (scripts/fonts/amiri-source.woff2, SIL Open Font License):
#   public/fonts/amiri-durood.woff2  only the letters of the durood shown on the welcome screens (scripts/fonts/durood-chars.txt)
#   public/fonts/salawat.woff2       only ﷺ, for English text
# and the Urdu Nastaliq fonts from scripts/fonts/nastaliq-*-source.woff2 (SIL Open Font License), cut to the Urdu alphabet:
#   public/fonts/nastaliq-400.woff2, nastaliq-700.woff2   (about 117 KB each, from 159 KB)
# Needs fonttools with brotli (pip install fonttools brotli). Run it after changing the durood text; test/client.test.js checks they agree.
set -e
pyftsubset scripts/fonts/amiri-source.woff2 --text-file=scripts/fonts/durood-chars.txt --layout-features='*' --flavor=woff2 --output-file=public/fonts/amiri-durood.woff2
pyftsubset scripts/fonts/amiri-source.woff2 --unicodes=U+FDFA --layout-features='*' --flavor=woff2 --output-file=public/fonts/salawat.woff2
for w in 400 700; do
  pyftsubset scripts/fonts/nastaliq-$w-source.woff2 --unicodes='U+0020-007E,U+00A0,U+0600-06FF,U+200C-200F,U+2010-2011,U+25CC,U+FDF2,U+FDFA' --layout-features='*' --flavor=woff2 --output-file=public/fonts/nastaliq-$w.woff2
done
