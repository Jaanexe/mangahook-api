# MangaHook API

Discovery adds `GET /api/discover?section=browse|trending|latest`, `GET /api/authors?q=NAME` and `GET /api/tags?all=1`. Public catalogue data only; no library is uploaded. Default discovery includes safe/suggestive titles. Explicit content-rating filters use the documented MangaDex rating categories.

Browse supports comma-separated ratings, types, genres, themes, demographics, languages and publication statuses, independent genre/theme inclusion modes, author-or-artist IDs, release-year ranges, known final chapter numbers and documented catalogue sorting. Native filters run upstream; remaining conditions run on a bounded provider batch, preserving pagination even when no matching items occur in that batch. Unknown years/chapter totals never satisfy minimums. `unreleased` means a known future publication year and uses newest-year sorting, since MangaDex does not expose a confirmed upcoming status.

Trending uses real daily [AniList trend activity](https://docs.anilist.co/reference/object/page), summed over day/week/month among the matched popular MangaDex titles linked by AniList IDs. It is not a global view-count ranking. Daily history is temporarily cached and reused across period switches. Latest Hot ranks popular titles among recent updates; New preserves the latest-update order. No unavailable 7/30-day view metrics are invented.

Explicit-source chapter lists accept `metadata=1` to skip redundant sample-page/image checks when only a chapter index is needed. Automatic selection checks eligible sources concurrently and returns the first to finish a real chapter manifest and image-signature/cross-site-policy check. Fast chapter lists alone cannot win. Checks stay within the requested language. An explicit `preferred=SOURCE` is retained when healthy; prepared alternatives are ready if it fails. Slower checks cannot change an already returned result. Each adapter keeps its existing request pacing, bounded caches and timeouts.

MangaHook v4 combines MangaDex catalogue information with selectable Atsumaru, MangaKatana, MangaDex and Weeb Central chapter sources. The adapters work across exact-matched catalogue titles, not a list of hard-coded manga. Atsumaru, MangaKatana and Weeb Central supply English chapters; MangaDex supplies its available translations. This API has no database, accounts, cookies, reading history or personal libraries. SharkStream keeps personal data in the browser.

## Endpoints

- `GET /api/manga?q=&page=1&language=en&status=ongoing&genre=TAG_UUID&sort=popular` — paginated catalogue. Optional filters; sorts: popular, latest, newest, title, rating. `/api/search` and `/api/mangaList` are aliases.
- `GET /api/tags` — genre filters.
- `GET /api/manga/MANGA_UUID` — manga details, authors, cover and reported languages.
- `GET /api/manga/MANGA_UUID/related` — confirmed MangaDex relationships (sequels, prequels, spin-offs and other editions), with covers in one bounded batch of up to 24 titles. No title similarity or guessed IDs; unknown relationship types and self-links are omitted. Anime adaptations are resolved separately through the existing AniList link.
- `GET /api/manga/MANGA_UUID/chapters?language=en&page=1&source=auto` — chapters, 100 per page. Sources: `auto`, `atsumaru`, `mangakatana`, `weebcentral`, `mangadex`. Auto races MangaKatana, Atsumaru and MangaDex for English; other languages use available MangaDex translations. Add `preferred=SOURCE` in Auto mode to retain an explicit saved choice if healthy. Auto verifies a real chapter manifest and a sample image signature and cross-site embedding policy before returning `sourceHealth.status=working`; a broken or empty source is skipped. Weeb Central remains explicitly selectable but is excluded from the normal Auto chain because Vercel returns HTTP 403. Requests omitting `source` preserve legacy MangaDex behaviour.
- Add `all=1` on page one for the searchable chapter catalogue. MangaDex responses are bounded to 5,000 entries and identify truncation. Weeb Central returns its complete list.
- `GET /api/chapter/CHAPTER_ID?manga=MANGA_UUID` — verifies source/series/chapter ownership and returns verified HTTPS page URLs. IDs are MangaDex UUIDs, `wc-SERIES_ULID-CHAPTER_ULID`, `mk-SERIES_NUMBER-CHAPTER_NUMBER`, or `at~SERIES_ID~CHAPTER_ID`.

Manga IDs and covers remain MangaDex IDs, preserving existing bookmarks and libraries. Source matching uses complete normalized titles/aliases and rejects ambiguous editions rather than substituting a sequel. An upstream chapter must appear in the matched series list before pages are requested. Only verified HTTPS source CDN hosts and manga paths are accepted. Requests to Weeb Central are paced and public parsed metadata is cached briefly in memory. There is no image proxy, challenge bypass, chapter download service or persistent server state.

Catalogue language metadata can outlive chapter removals. Empty feeds remain explicit and external-only publisher links are excluded from the integrated reader. An empty feed from one source does not mean the manga has no translation elsewhere.

Live checks on Weeb Central returned readable chapters locally and on a GitHub cloud runner, but Vercel received HTTP 403. No access restrictions are bypassed. MangaKatana is an independent alternative; `node scripts/check-chapter-sources.js` verifies exact catalogue matches, full chapter lists, chapter 1 and a real image signature. Availability remains upstream-dependent.

Source endpoint formats were cross-checked with the Apache-2.0 [Keiyoushi WeebCentral](https://github.com/keiyoushi/extensions-source/tree/main/src/en/weebcentral) and [MangaKatana](https://github.com/keiyoushi/extensions-source/tree/main/src/en/mangakatana) extensions. This deployment uses small Node.js adapters; it does not require a running Suwayomi server, paid hosting, or a service on the owner's PC.

Run `npm ci --ignore-scripts`, `npm run check` and `npm test`. Node.js 22 is used by deployment and CI. No keys or environment variables are needed. Historical `server/`, `docs/` and example sources are retained for reference but are not imported by the deployed function.

Atsumaru endpoint formats: [Keiyoushi adapter](https://github.com/keiyoushi/extensions-source/tree/main/src/en/atsumaru). Source matching tolerates punctuation/spacing differences while retaining sequel and edition words and rejecting incompatible known years. Atsumaru keeps multiple translation groups; counts of uploads are distinct from counts of chapter numbers. Only verified HTTPS cdn.atsu.moe/static/pages image paths are returned. Metadata caches are bounded and temporary; no account or personal reading data is stored.

Atsumaru currently serves a Cross-Origin-Resource-Policy of same-site to cross-site browser requests. The health check sends SharkStream’s public Origin and normal cross-site image headers and rejects that policy. It never proxies or strips these protections. A direct HTTP 200 alone is not enough to call a source working.

## Catalogue outage recovery

MangaDex remains the primary catalogue. During provider outages MangaBaka supplies public metadata, with separate `mb-` IDs; it is not a chapter host. Credit: https://mangabaka.org/data/api and its contributing sources (CC BY-NC-SA 4.0). Existing MangaDex UUIDs remain unchanged. Chapter adapters must verify the exact title and real page images. MangaDex chapters for a backup record require one explicit, unique AniList cross-reference; unknown editions and missing translations remain unavailable.

Only bounded public metadata is cached, with stale metadata available for 24 hours. No profiles, saves, reading history, cookies or credentials enter this service. Maintenance pages are failures, never fake empty catalogues.
