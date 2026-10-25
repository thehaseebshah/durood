// Builds the Android app (a release APK you can install by hand, signed with signing/seerah-quest.jks) that opens the live Seerah Quest site.
//   node build.mjs [https://your-server]     the address defaults to the one in capacitor.config.json
// Needs JDK 17+, the Android SDK (ANDROID_HOME) and `npm install` run once here.
import { readFileSync, writeFileSync, copyFileSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
const url = process.argv[2];
const cfg = JSON.parse(readFileSync('capacitor.config.json', 'utf8'));
if (url) { cfg.server.url = url.replace(/\/$/, ''); cfg.server.allowNavigation = [new URL(cfg.server.url).host]; writeFileSync('capacitor.config.json', JSON.stringify(cfg, null, 2)); }
const run = (c, o = {}) => execSync(c, { stdio: 'inherit', ...o });
run('npx cap sync android');
run('./gradlew assembleRelease --no-daemon -q --max-workers=1 -I ../maven-mirror.init.gradle', { cwd: 'android' });
mkdirSync('dist', { recursive: true });
copyFileSync('android/app/build/outputs/apk/release/app-release.apk', 'dist/seerah-quest.apk');
console.log(`\nBuilt dist/seerah-quest.apk, opening ${cfg.server.url}`);
