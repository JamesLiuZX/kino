# Signing the desktop app

Until the Mac app is **signed with a Developer ID and notarized by Apple**,
macOS says *“Kino” Not Opened: Apple could not verify “Kino” is free of
malware* the first time it's opened. Nothing is wrong with the app: macOS says
this about every app Apple hasn't checked. Windows does the same with
SmartScreen for unsigned installers.

## Opening an unsigned build

**Mac:** click **Done** (not Move to Bin), open **System Settings → Privacy &
Security**, scroll down to *“Kino” was blocked to protect your Mac* and click
**Open Anyway**, then confirm with your password or Touch ID. After that Kino
opens like any other app. The installer window and the release notes say the
same.

Or in Terminal, once Kino is in Applications:

```bash
xattr -dr com.apple.quarantine /Applications/Kino.app
```

**Windows:** on *Windows protected your PC*, click **More info → Run anyway**.

## Making the warning go away for everyone (Mac)

This needs an Apple Developer Program membership (US$99 a year), which only
the person or company publishing Kino can hold. Then, once:

1. **Join** at [developer.apple.com/programs](https://developer.apple.com/programs/)
   as an individual (your Apple ID; no company paperwork).
2. **Make a Developer ID Application certificate.** On your Mac: Xcode →
   Settings → Accounts → your team → Manage Certificates → **+** → *Developer ID
   Application*. Then in Keychain Access, find *Developer ID Application: …*
   under My Certificates, right-click → Export → a `.p12` with a password.
3. **Make an App Store Connect API key** for notarization: [App Store
   Connect](https://appstoreconnect.apple.com/) → Users and Access →
   Integrations → App Store Connect API → Team Keys → **+**, access
   *Developer*. Download the `.p8` (it downloads once) and note its **Key ID**
   and the **Issuer ID** above the list.
4. **Add five secrets** to this repository (Settings → Secrets and variables →
   Actions → New repository secret):

   | Secret | Value |
   |---|---|
   | `MAC_CERT_P12` | `base64 -i DeveloperID.p12 \| pbcopy`, then paste |
   | `MAC_CERT_PASSWORD` | the `.p12` password |
   | `APPLE_API_KEY_P8` | the whole text of the `.p8` file |
   | `APPLE_API_KEY_ID` | the Key ID |
   | `APPLE_API_ISSUER` | the Issuer ID |

   Instead of the API key you can use an Apple ID: `APPLE_ID`,
   `APPLE_APP_SPECIFIC_PASSWORD` (appleid.apple.com → Sign-In and Security →
   App-Specific Passwords) and `APPLE_TEAM_ID` (developer.apple.com →
   Membership).
5. **Release again** with a new version tag. The Desktop workflow signs the app
   with your Developer ID under the hardened runtime, sends it to Apple to
   notarize and staples the ticket, so the DMG opens with no warning, and the
   release notes drop the "opening it the first time" part.

## Windows

SmartScreen warns about any installer without a reputation. A code-signing
certificate (`WIN_CERT_P12` and `WIN_CERT_PASSWORD`, a base64 `.pfx`) removes
the "unknown publisher" line and builds reputation over time. Microsoft's
Artifact Signing (formerly Trusted Signing) is the cheapest route where it's
available; a standard OV certificate from a certificate authority also works.
