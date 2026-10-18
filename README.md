# MangaHook API

MangaHook v2 provides real public manga, chapter and image metadata from MangaDex. The old MangaKakalot scraper and placeholder fallback are not used by the deployed entry point. This API does not store accounts, reading progress or personal libraries. SharkStream keeps that data in its browser library.

## Endpoints

- `GET /api/manga?q=&page=1&language=en&status=ongoing&genre=TAG_UUID&sort=popular` — paginated catalogue. Optional filters; sorts: popular, latest, newest, title, rating. `/api/search` and `/api/mangaList` are aliases.
- `GET /api/tags` — genre filters.
- `GET /api/manga/MANGA_UUID` — manga details, authors, cover and reported languages.
- `GET /api/manga/MANGA_UUID/chapters?language=en&page=1` — available hosted chapters, 100 per page.
- `GET /api/chapter/CHAPTER_UUID?manga=MANGA_UUID` — verifies chapter ownership and returns image URLs.

IDs are MangaDex UUIDs. Catalogue language metadata can outlive chapter removals, so an available-language label does not guarantee chapters exist. Empty language feeds are valid. External publisher links are not presented as hosted chapters. The reader allows only source-verified HTTPS MangaDex image hosts, and public metadata alone is cached. Upstream outages and rate limits return explicit errors rather than sample content. Covers/chapters remain on MangaDex infrastructure; there is no image proxy or chapter download service.

Run `npm run check` and `npm test`. Node.js 22 or newer is required. No keys or environment variables are needed. Existing historical `server/`, `docs/` and example sources are retained in the repository for reference but are not imported by the deployed function.
