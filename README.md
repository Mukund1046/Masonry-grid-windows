# Bookmarks

An infinite, pannable masonry grid for browsing your Twitter/X bookmarks visually. Built with vanilla JS, virtualized DOM rendering, and Motion One springs.

## Features

- **Infinite pannable grid** -- drag or scroll in any direction, the grid tiles seamlessly
- **Masonry layout** -- images display at their natural aspect ratios, no cropping
- **Virtualized rendering** -- only ~200 DOM nodes regardless of how many bookmarks you have (tested with 1,300+)
- **Lightbox** -- click any item to view it larger with spring animations via Motion One
- **Folder filtering** -- filter by your Twitter bookmark folders with a dropdown pill
- **Video support** -- video bookmarks show a "Play on Twitter" button that opens the original tweet
- **High-res loading** -- grid shows medium thumbnails, lightbox loads full resolution

## Prerequisites

- **Node.js** 20+
- **Google Chrome** logged into x.com (for syncing bookmarks)
- **[fieldtheory-cli](https://github.com/afar1/fieldtheory-cli)** for the initial bookmark sync

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Install fieldtheory-cli

```bash
npm install -g fieldtheory
```

### 3. Sync your bookmarks

Make sure Chrome is open and logged into x.com, then:

```bash
ft sync
```

This downloads all your bookmarks to `~/.ft-bookmarks/`.

### 4. Sync bookmark folders (optional)

```bash
node sync-folders.js
```

This fetches your bookmark folder names and maps each bookmark to its folder(s). Outputs `folders-data.json`.

### 5. Export bookmark data

```bash
node export-bookmarks.js
```

This reads the fieldtheory cache and folder data, then outputs `bookmarks-data.json` with images, dimensions, video URLs, and folder tags.

### 6. Start the server

```bash
node server.js
```

Open `http://localhost:3000` in your browser.

## How it works

### Grid rendering

The grid uses a virtualized masonry layout. All 1,000+ bookmark positions are computed in a data-only pass (no DOM), then a fixed pool of ~400 DOM elements is recycled as you pan. Items entering the viewport get a pool element assigned; items leaving get theirs returned. This keeps memory under 100MB regardless of collection size.

### Infinite tiling

The masonry block repeats in all directions using modular arithmetic. The renderer computes which tile offsets are needed to cover the viewport + buffer, then checks each layout item against those tiles.

### Lightbox

Clicking an item creates a clone positioned with `position: fixed`, then animates it to the viewport center using Motion One's duration-based spring. The original stays hidden in the pool. A high-res image loads on top with a fade-in transition. On close, the clone animates back to the grid position and is removed.

### Folder sync

`sync-folders.js` calls Twitter's internal GraphQL endpoints (`BookmarkFoldersSlice` and `BookmarkFolderTimeline`) using your Chrome session cookies. It extracts the `ct0` CSRF token and `auth_token` from Chrome's cookie database via the macOS Keychain, the same approach used by fieldtheory-cli.

## Excluding bookmarks

To hide specific bookmarks from the grid, add their tweet IDs to the `EXCLUDED_IDS` set in `export-bookmarks.js` and re-run the export:

```js
const EXCLUDED_IDS = new Set([
  "1234567890",
]);
```

## Tech

- Vanilla JS (no framework)
- [Motion One](https://motion.dev/) for lightbox spring animations
- [fieldtheory-cli](https://github.com/afar1/fieldtheory-cli) for bookmark sync
- CSS backdrop-filter for glass effects
- Twitter GraphQL API for folder data

## License

MIT
