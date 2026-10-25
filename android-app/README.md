# Seerah Quest for Android

A thin Android app (Capacitor) that opens the live Seerah Quest site in a full-screen WebView with its own icon, splash
screen, status bar colour and back button. The server and the web app stay the single source of truth: a change you deploy
shows up in the Android app at once, without a new APK.

Build (needs JDK 17+, the Android SDK in `ANDROID_HOME`, and `npm install` once in this folder):

    node build.mjs                          # opens the address in capacitor.config.json
    node build.mjs https://your.server      # or another one

The signed APK is written to `dist/seerah-quest.apk`. It is signed with `signing/seerah-quest.jks`, whose details are in
`signing/keystore.properties`. Neither file is in git. **Keep both safe**: a new version can only be installed over an old
one if it is signed with the same key, and Google Play needs the same key for updates.

Not done yet (needs the app to be more than a wrapper): push notifications (web push doesn't work inside a WebView; this
needs Firebase), a Play Store listing, and offline screens beyond what the site's service worker keeps.
