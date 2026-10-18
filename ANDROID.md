# Acalyze on Android (APK now, Google Play later)

The Android app is your live website, installed on the phone like an app (a "Trusted Web Activity").
That means: **one codebase**, and every change you push to the website shows up in the app straight away.
You only rebuild the app when you change its name, icon, package name or web address.

## 0. Before you start
- The site must be on HTTPS and **always awake**. Render's free plan sleeps after inactivity, so the first
  open can take up to a minute, which feels broken in an app. Use a paid plan before you launch to parents.
- Decide the **web address** before publishing. The app is tied to it, and changing it later means a new
  app release. A custom domain you own (for example `app.yourdomain.com`) is better than `acalyze.onrender.com`.

## 1. Deploy and test the installable site
1. Push these files and let Render deploy.
2. Open `https://YOUR-SITE/manifest.webmanifest`. You should see JSON.
3. On an Android phone, open `https://YOUR-SITE/app/` in Chrome, menu (⋮) -> **Install app** (or Add to Home screen).
   It should open full-screen with the Acalyze icon. This already works as a phone app, before any APK.

## 2. Build the APK and AAB (no Android Studio needed)
1. Go to **pwabuilder.com**, enter your site address **followed by `/app/`** (for example `https://yoursite.com/app/`), press Start.
2. Choose **Package for stores -> Android**.
3. Set:
   - **Package ID**: reverse of a domain you own, for example `com.yourcompany.acalyze`.
     **It can never change after you publish.**
   - **App name**: Acalyze. **Version**: 1 (increase by 1 for every Play upload).
   - **Signing key**: create a new one.
4. Download the zip. It contains:
   - `*.apk`: install this on phones to test, and share it directly.
   - `*.aab`: the file Google Play wants.
   - the signing key file and `signing-key-info.txt` (passwords and the SHA-256 fingerprint).
   **Back up the key file and passwords somewhere safe (not in GitHub).**

## 3. Remove the browser bar (verify the site <-> app link)
1. Open `signing-key-info.txt` and copy the **SHA-256 fingerprint** (looks like `AB:CD:12:...`).
2. In Render -> Environment, set:
   - `ANDROID_PACKAGE_NAME` = your package ID
   - `ANDROID_SHA256` = the fingerprint (add more later, separated by commas)
3. Redeploy, then open `https://YOUR-SITE/.well-known/assetlinks.json`. It should list your package.
4. Uninstall and reinstall the APK. The address bar at the top should now be gone.

## 4. Install the APK on a phone for testing
Send the `.apk` to the phone (WhatsApp, Drive, USB), open it, and allow "install unknown apps" when asked.

## 5. Google Play
1. Create a **Google Play Console** account (one-time US$25).
2. **Personal accounts** created after 13 Nov 2023 must first run a **closed test with 12+ testers for 14
   days in a row** before applying for production. Organisation accounts are exempt, but need verification
   (a D-U-N-S number). Choose deliberately.
3. Create the app, then upload the **.aab** to Closed testing (or Internal testing for quick checks).
4. Fill in the listing: 512x512 icon (`public/icons/icon-512.png`), 1024x500 feature graphic, phone
   screenshots, short and full description.
5. Required forms: **privacy policy URL** (use `https://YOUR-WEBSITE/privacy/`; you handle student data, so this matters), **Data safety**,
   content rating, target audience (adults: parents, teachers, school staff).
6. When Play shows **App signing**, copy its SHA-256 fingerprint and **add it to `ANDROID_SHA256`**
   (comma-separated with the first one). Without it the Play-installed app shows the browser bar.
7. Google requires new apps and updates to **target Android 16 (API 36)** since 31 Aug 2026. If Play
   rejects the upload for this, rebuild with the newest PWABuilder.
8. Google can reject apps that are only a website with no real function. Acalyze has logins, report cards,
   attendance and fees, which is real functionality, but describe those features clearly in the listing.

## iPhone, iPad and computers
The installable site already works on every device, no store needed:
- **iPhone / iPad**: Safari -> Share -> **Add to Home Screen**.
- **Windows / Mac / Chromebook**: Chrome or Edge -> install icon in the address bar (or menu -> **Install Acalyze**).
- Acalyze also shows an **Install app** button (login page, and the side menu once signed in) with these
  steps for the person's device. Schools can simply tell parents: open the website and tap Install.

A real **App Store** app is a separate project: it needs an Apple Developer account (paid yearly), a Mac with
Xcode to build and submit it, and Apple tends to reject apps that are only a website, so it should come
with native features (such as push notifications). Start with the installable site and add an iOS app
only if parents ask for it.

## 6. Updating later
- Changed something in the website? Push to GitHub. The app updates itself.
- Changed the icon, name or address? Rebuild at PWABuilder, raise the version, upload a new .aab.
