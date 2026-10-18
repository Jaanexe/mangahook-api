# MangaHook API

MangaHook v4 combines MangaDex catalogue information with selectable Atsumaru, MangaKatana, MangaDex and Weeb Central chapter sources. The adapters work across exact-matched catalogue titles, not a list of hard-coded manga. Atsumaru, MangaKatana and Weeb Central supply English chapters; MangaDex supplies its available translations. This API has no database, accounts, cookies, reading history or personal libraries. SharkStream keeps personal data in the browser.

## Endpoints

- `GET /api/manga?q=&page=1&language=en&status=ongoing&genre=TAG_UUID&sort=popular` — paginated catalogue. Optional filters; sorts: popular, latest, newest, title, rating. `/api/search` and `/api/mangaList` are aliases.
- `GET /api/tags` — genre filters.
- `GET /api/manga/MANGA_UUID` — manga details, authors, cover and reported languages.
- `GET /api/manga/MANGA_UUID/chapters?language=en&page=1&source=auto` — chapters, 100 per page. Sources: `auto`, `atsumaru`, `mangakatana`, `weebcentral`, `mangadex`. Auto tries Atsumaru, MangaKatana, then MangaDex. Add `preferred=SOURCE` in Auto mode to check a saved source first. Auto verifies a real chapter manifest and a sample image signature before returning `sourceHealth.status=working`; a broken or empty source is skipped. Weeb Central remains explicitly selectable but is excluded from the normal Auto chain because Vercel returns HTTP 403. Requests omitting `source` preserve legacy MangaDex behaviour.
- Add `all=1` on page one for the searchable chapter catalogue. MangaDex responses are bounded to 5,000 entries and identify truncation. Weeb Central returns its complete list.
- `GET /api/chapter/CHAPTER_ID?manga=MANGA_UUID` — verifies source/series/chapter ownership and returns verified HTTPS page URLs. IDs are MangaDex UUIDs, `wc-SERIES_ULID-CHAPTER_ULID`, `mk-SERIES_NUMBER-CHAPTER_NUMBER`, or `at~SERIES_ID~CHAPTER_ID`.

Manga IDs and covers remain MangaDex IDs, preserving existing bookmarks and libraries. Source matching uses complete normalized titles/aliases and rejects ambiguous editions rather than substituting a sequel. An upstream chapter must appear in the matched series list before pages are requested. Only verified HTTPS source CDN hosts and manga paths are accepted. Requests to Weeb Central are paced and public parsed metadata is cached briefly in memory. There is no image proxy, challenge bypass, chapter download service or persistent server state.

Catalogue language metadata can outlive chapter removals. Empty feeds remain explicit and external-only publisher links are excluded from the integrated reader. An empty feed from one source does not mean the manga has no translation elsewhere.

Live checks on Weeb Central returned readable chapters locally and on a GitHub cloud runner, but Vercel received HTTP 403. No access restrictions are bypassed. MangaKatana is an independent alternative; `node scripts/check-chapter-sources.js` verifies exact catalogue matches, full chapter lists, chapter 1 and a real image signature. Availability remains upstream-dependent.

Source endpoint formats were cross-checked with the Apache-2.0 [Keiyoushi WeebCentral](https://github.com/keiyoushi/extensions-source/tree/main/src/en/weebcentral) and [MangaKatana](https://github.com/keiyoushi/extensions-source/tree/main/src/en/mangakatana) extensions. This deployment uses small Node.js adapters; it does not require a running Suwayomi server, paid hosting, or a service on the owner's PC.

Run `npm ci --ignore-scripts`, `npm run check` and `npm test`. Node.js 22 is used by deployment and CI. No keys or environment variables are needed. Historical `server/`, `docs/` and example sources are retained for reference but are not imported by the deployed function.

Atsumaru endpoint formats: [Keiyoushi adapter](https://github.com/keiyoushi/extensions-source/tree/main/src/en/atsumaru). Source matching tolerates punctuation/spacing differences while retaining sequel and edition words and rejecting incompatible known years. Atsumaru keeps multiple translation groups; counts of uploads are distinct from counts of chapter numbers. Only verified HTTPS cdn.atsu.moe/static/pages image paths are returned. Metadata caches are bounded and temporary; no account or personal reading data is stored.
