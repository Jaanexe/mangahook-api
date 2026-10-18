# Suwayomi cloud trial

The owner selected Suwayomi, then required cloud-only hosting on free plans. No service should run on the owner's PC.

## Verified source access

The isolated GitHub Actions trial ran Suwayomi 2.4.2366 with the English Weeb Central extension 1.6.25. It returned 1,196 One Piece chapters. Chapter 1 returned 57 pages, and the first image returned HTTP 200 with `image/jpeg` content. The runner removed its temporary container afterwards. No personal SharkStream data was used.

- Tested commit: `484059af9a119413de2057891669f9e3b375723d`
- Source check: https://github.com/Jaanexe/mangahook-api/actions/runs/39103368145
- Server image: `ghcr.io/suwayomi/suwayomi-server@sha256:1fac27c387dc2ea9949e1a01ad7f6d6de9d72d3988338a95476748e5c45c4582`
- Observed memory after the source check: about 500 MiB.

## Deployment remains unverified

Vercel currently documents a container runtime beta on all plans. Its containers scale to zero and do not provide durable local state. A production attempt needs a separate database for public source/catalogue metadata and an extension installation strategy that survives instance replacement. A small Free-plan Neon project has been prepared for that metadata; it is not connected to Suwayomi yet. Personal profiles, favourites, reading progress and preferences must remain in SharkStream's browser store. No account or user-data API should be added.

The connected Vercel account rejected the target team's access/billing check with HTTP 403. The installed-CLI fallback was unavailable. A connection with access to the intended SharkStream workspace and its plan is needed before a free deployment can be verified. Do not assume the production integration works from the successful GitHub source test.

The existing MangaHook production API is unchanged. Its One Piece feed currently returns one English chapter, but MangaDex's image endpoint for that chapter returns 404 despite available metadata. This is a source-availability failure rather than a chapter pagination failure.

## Required next checks

1. Verify the intended Vercel workspace and free-plan limits after access is restored.
2. Test the pinned Suwayomi image on Vercel with external public metadata storage, authentication and reproducible extension installation. Verify a cold restart and multiple requests.
3. Add the MangaHook adapter only after the deployment works. Validate title matching, chapter ownership and image responses. Never expose Suwayomi administration credentials in the browser.
4. Preserve existing MangaDex bookmarks and browser saves while adding source-specific chapter IDs; protect stale-tab writers with a storage-version migration if needed.
5. Verify One Piece chapter 1, later chapters, real page loading, navigation and saved progress in SharkStream before calling the migration complete.

References: [Vercel container runtime](https://vercel.com/docs/functions/runtimes/container), [Vercel Hobby limits](https://vercel.com/docs/plans/hobby), [Neon Free plan](https://neon.com/pricing), [Suwayomi Docker](https://github.com/Suwayomi/Suwayomi-Server-docker).
