# Local Chrome Web Store Releases

Flippah releases can be built and submitted entirely from the development computer. GitHub Actions is not required.

Chrome Web Store installations must receive executable extension updates through the Chrome Web Store. A Store-installed copy cannot load an off-store hotfix or remotely hosted JavaScript. The quick-fix path is therefore a local, one-command Store submission followed by Google's review and automatic publication.

## User Update Check

The toolbar popup includes a user-clicked update button. It asks Chrome to check the Store immediately and reports whether the installed version is current, an update is downloading, or Chrome has throttled a recent duplicate check.

The button never runs on a timer and never reloads Flippah during an active auction workflow. When an update is ready, the popup asks the user to close it and refresh the auction page after Chrome installs the update.

## One-Time Store API Setup

1. Configure API access while the initial submission is pending; wait for approval before uploading its replacement.
2. Enable the Chrome Web Store API in a Google Cloud project.
3. Create one service account for Flippah releases.
4. Add that service-account email under the Chrome Web Store Developer Dashboard account settings.
5. Grant the local Google account permission to impersonate that service account and authenticate `gcloud`.
6. Create `%LOCALAPPDATA%\Flippah\chrome-web-store.json`:

```json
{
  "publisherId": "YOUR_PUBLISHER_ID",
  "extensionId": "kfpfojddcfgglgbanijddljiaplifhga",
  "serviceAccountEmail": "YOUR_SERVICE_ACCOUNT_EMAIL"
}
```

This file contains identifiers, not an access token or private key. The release command obtains a short-lived access token from `gcloud` and never prints it. Do not create or commit a service-account JSON key.

## Prepare Locally

Check authentication and current Store state without building or uploading:

```powershell
npm run release:chrome -- --status
```

After the release version has been updated and committed:

```powershell
npm run release:chrome
```

The command requires a clean worktree, runs the complete test suite, builds and verifies the Store package, and writes a local checksum receipt. It does not contact the Store without `--publish`.

To require an exact version as an additional typo guard, append it after `--`, for example `npm run release:chrome -- 0.5.46`.

## Submit For Review

```powershell
npm run release:chrome -- --publish
```

The publisher performs these gates in order:

1. Run all tests and build the verified Store ZIP.
2. Read a short-lived Chrome Web Store token from `gcloud`.
3. Fetch the current Store status.
4. Refuse an active review, staged release, policy warning, or non-increasing version.
5. Upload the complete ZIP to the existing item.
6. Poll until Store package validation succeeds.
7. Submit for review with `DEFAULT_PUBLISH` and warnings treated as blocking.
8. Record the resulting Store state and package SHA-256 in `artifacts/chrome-web-store`.

Changes to permissions, host access, privacy behavior, screenshots, or listing text must still be reviewed in the Developer Dashboard before submission.

## Verified local setup

On 2026-09-05, Google Cloud CLI and the keyless publisher setup were completed on
the owner's computer. The `--status` command authenticated through service-account
impersonation and returned this item's v0.5.45 `PENDING_REVIEW` state. The API
connection is verified; a v0.5.46 upload and Store-installed update remain pending.
No GitHub Actions workflow or service-account private key is required.
