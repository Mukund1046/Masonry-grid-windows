# twitter-bookmarks-grid

An infinite pannable masonry grid for your Twitter bookmarks. Browse your bookmarks visually or by folder. Based on [@afar1](https://github.com/afar1)'s great [fieldtheory-cli](https://github.com/afar1/fieldtheory-cli) repo.

Feel free to remix this into a webapp, browser extension or whatever suits your needs!

<video src="https://s3.us-east-1.amazonaws.com/danield.design/assets/twitter-bookmarks-grid/example-video.mp4" autoplay loop muted playsinline></video>

![Lightbox view](assets/example-2.png)

## Setup

Requires Node.js 20+ and Chrome logged into x.com.

```bash
# Install fieldtheory-cli and sync your bookmarks
npm install -g fieldtheory
ft sync

# Install dependencies
npm install

# Sync your bookmark folders (optional)
node sync-folders.js

# Export bookmarks to JSON for the grid
node export-bookmarks.js

# Start browsing
node server.js
```

Open http://localhost:3000

## How it works

- Masonry positions are computed as pure data, then a fixed pool of ~400 DOM elements is recycled as you pan. Tested with 1,300+ bookmarks.
- Lightbox clones the clicked element, animates it to center with [Motion One](https://motion.dev/) springs, and loads a high-res image on top.
- Folder sync uses Twitter's internal GraphQL endpoints via Chrome session cookies (same approach as fieldtheory-cli).

## Folder sync

`sync-folders.js` fetches your Twitter bookmark folders so you can filter the grid by folder. It uses Twitter's internal GraphQL API (`BookmarkFoldersSlice` and `BookmarkFolderTimeline`) authenticated via your Chrome session cookies — no API keys needed.

Run `node sync-folders.js` and it will:
1. List all your bookmark folders
2. Fetch the bookmarks in each folder (paginated, ~20 per page)
3. Output `folders-data.json` mapping tweet IDs to folder names

Then re-run `node export-bookmarks.js` to merge the folder data into the grid. A dropdown pill in the top-right lets you filter by folder.

Note: Twitter's GraphQL query IDs can change when they update their web app. If the sync fails, you may need to update the query IDs in `sync-folders.js` by inspecting the network tab on x.com/i/bookmarks.

## Excluding bookmarks

Add tweet IDs to `EXCLUDED_IDS` in `export-bookmarks.js` and re-export.

## License

MIT
