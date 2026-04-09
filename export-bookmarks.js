// Reads the fieldtheory JSONL cache and exports bookmarks with media as JSON
const fs = require("fs");
const path = require("path");
const {
  getBookmarksOutputPath,
  getFoldersOutputPath,
  getJsonlPath,
} = require("./config");

const JSONL_PATH = getJsonlPath();
const OUTPUT_PATH = getBookmarksOutputPath();

// Tweet IDs to exclude from the grid
const EXCLUDED_IDS = new Set([
  "2039806744646566240", // iceberg fonts
  "2040147478096289824", // depth map ascii scan
]);

function main() {
  if (!fs.existsSync(JSONL_PATH)) {
    throw new Error(
      `Bookmarks JSONL not found at ${JSONL_PATH}. Set X_BOOKMARKS_JSONL or FT_DATA_DIR if your bookmarks live somewhere else.`
    );
  }

  const rawJsonl = fs.readFileSync(JSONL_PATH, "utf8");
  const lines = rawJsonl
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const bookmarks = [];

  for (const line of lines) {
    try {
      const raw = JSON.parse(line);
      const id = raw.tweetId || raw.id;
      if (EXCLUDED_IDS.has(id)) continue;

      // Extract media with dimensions (photos + video thumbnails)
      const mediaObjects = (raw.mediaObjects || []).filter(
        (m) => (m.type === "photo" || m.type === "video" || m.type === "animated_gif") && m.url
      );

      const images = mediaObjects.map((m) => {
        const entry = {
          url: m.url,
          width: m.width || 1,
          height: m.height || 1,
          type: m.type || "photo",
        };
        // For videos/gifs, pick the highest quality MP4 variant
        if ((m.type === "video" || m.type === "animated_gif") && m.videoVariants) {
          const mp4s = m.videoVariants
            .filter((v) => v.url && v.url.includes(".mp4"))
            .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
          if (mp4s.length > 0) {
            entry.videoUrl = mp4s[0].url;
          }
        }
        return entry;
      });

      bookmarks.push({
        id: raw.tweetId || raw.id,
        text: raw.text || "",
        url: raw.url || `https://x.com/${raw.authorHandle}/status/${raw.tweetId}`,
        authorHandle: raw.authorHandle || "",
        authorName: raw.authorName || "",
        authorAvatar: raw.authorProfileImageUrl || "",
        postedAt: raw.postedAt || "",
        bookmarkedAt: raw.bookmarkedAt || "",
        syncedAt: raw.syncedAt || "",
        images,
        mediaCount: (raw.media || []).length,
        likeCount: raw.engagement?.likeCount ?? 0,
        repostCount: raw.engagement?.repostCount ?? 0,
        bookmarkCount: raw.engagement?.bookmarkCount ?? 0,
      });
    } catch {
      // Skip malformed lines.
    }
  }

  // Merge folder data if available
  const FOLDERS_PATH = getFoldersOutputPath();
  let folders = [];
  let folderMap = {};
  if (fs.existsSync(FOLDERS_PATH)) {
    const foldersData = JSON.parse(fs.readFileSync(FOLDERS_PATH, "utf8"));
    folders = foldersData.folders || [];
    folderMap = foldersData.folderMap || {};
    let tagged = 0;
    for (const bm of bookmarks) {
      bm.folders = folderMap[bm.id] || [];
      if (bm.folders.length > 0) tagged++;
    }
    console.log(`Tagged ${tagged} bookmarks with folder data (${folders.length} folders)`);
  } else {
    for (const bm of bookmarks) bm.folders = [];
    console.log("No folders-data.json found — run sync-folders.js first for folder support");
  }

  // Sort by most recent first
  bookmarks.sort(
    (a, b) => new Date(b.postedAt).getTime() - new Date(a.postedAt).getTime()
  );

  const output = { folders, bookmarks };

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
  console.log(
    `Exported ${bookmarks.length} bookmarks (${bookmarks.filter((b) => b.images.length > 0).length} with images)`
  );
  console.log(`Wrote ${OUTPUT_PATH}`);
}

try {
  main();
} catch (error) {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
}
