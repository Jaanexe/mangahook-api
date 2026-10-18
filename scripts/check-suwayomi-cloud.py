"""Read-only chapter/source smoke check against an isolated CI Suwayomi instance.

No SharkStream profiles, libraries, credentials or reading progress are used.
The runner/container is temporary; this never starts a service on the owner's PC.
"""
import json
import time
import urllib.error
import urllib.request

ROOT = "http://127.0.0.1:4567"


def gql(query, variables=None):
    request = urllib.request.Request(
        ROOT + "/api/graphql",
        data=json.dumps({"query": query, "variables": variables or {}}).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=90) as response:
        result = json.load(response)
    if result.get("errors"):
        raise RuntimeError(json.dumps(result["errors"])[:1500])
    return result["data"]


for attempt in range(60):
    try:
        gql("query { __typename }")
        break
    except OSError:
        if attempt == 59:
            raise
        time.sleep(2)

print("Suwayomi is ready; fetching compatible extensions", flush=True)
extensions = gql(
    "mutation { fetchExtensions(input: {}) { extensions { pkgName name versionName } } }"
)["fetchExtensions"]["extensions"]
matches = [e for e in extensions if "weebcentral" in e["pkgName"].lower()]
assert len(matches) == 1, "Expected one compatible WeebCentral extension: " + str(len(matches))
extension = matches[0]
installed = gql(
    "mutation($input: UpdateExtensionInput!) { updateExtension(input: $input) { extension { pkgName isInstalled } } }",
    {"input": {"id": extension["pkgName"], "patch": {"install": True}}},
)["updateExtension"]["extension"]
assert installed["isInstalled"], "The extension did not install"
print("WeebCentral is installed; searching for One Piece", flush=True)

sources = gql("query { sources { nodes { id name lang } } }")["sources"]["nodes"]
matches = [s for s in sources if "weeb" in s["name"].lower() and s["lang"] == "en"]
assert len(matches) == 1, "Expected one installed English WeebCentral source"
source = matches[0]
found = gql(
    "mutation($input: FetchSourceMangaInput!) { fetchSourceManga(input: $input) { mangas { id title url } } }",
    {"input": {"source": source["id"], "type": "SEARCH", "page": 1, "query": "One Piece"}},
)["fetchSourceManga"]["mangas"]
matches = [m for m in found if m["title"].casefold() == "one piece"]
assert len(matches) == 1, "An exact One Piece title match was not available"
manga = matches[0]
detail = gql(
    "mutation($input: FetchMangaAndChaptersInput!) { fetchMangaAndChapters(input: $input) { manga { id title } chapters { id chapterNumber name pageCount } } }",
    {"input": {"id": manga["id"], "fetchManga": True, "fetchChapters": True}},
)["fetchMangaAndChapters"]
chapters = detail["chapters"]
print("One Piece chapters: " + str(len(chapters)), flush=True)
assert len(chapters) > 100, "One Piece still has an incomplete chapter list: " + str(len(chapters))
chapter = next((c for c in chapters if c["chapterNumber"] == 1), None)
assert chapter, "Chapter one was not found"
pages = gql(
    "mutation($input: FetchChapterPagesInput!) { fetchChapterPages(input: $input) { pages } }",
    {"input": {"chapterId": chapter["id"]}},
)["fetchChapterPages"]["pages"]
assert pages and all(p.startswith("/") and not p.startswith("//") for p in pages), "Expected local Suwayomi image routes"
with urllib.request.urlopen(ROOT + pages[0], timeout=90) as image:
    image_type = image.headers.get("Content-Type", "")
    assert image.status == 200 and image_type.startswith("image/"), "The first chapter image is not readable"
    assert image.read(64), "The first chapter image is empty"

print(json.dumps({
    "source": source["name"], "extension": extension["pkgName"],
    "extensionVersion": extension["versionName"], "title": manga["title"],
    "chapters": len(chapters), "chapter": chapter["name"],
    "pages": len(pages), "firstImage": {"status": 200, "type": image_type},
}))
