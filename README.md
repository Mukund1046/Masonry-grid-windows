# twitter-bookmarks-grid

Infinite pannable masonry grid for your Twitter/X bookmarks. Virtualized rendering, folder filtering, lightbox with spring animations.

## Setup

Requires Node.js 20+ and Chrome logged into x.com.

```bash
npm install
npm install -g fieldtheory

# Sync bookmarks from Chrome session
ft sync

# Sync folder data (optional)
node sync-folders.js

# Export to JSON
node export-bookmarks.js

# Run
node server.js
```

Open http://localhost:3000

## How it works

- Masonry positions are computed as pure data, then a fixed pool of ~400 DOM elements is recycled as you pan. Tested with 1,300+ bookmarks.
- The grid tiles infinitely in all directions via modular arithmetic.
- Lightbox clones the clicked element, animates it to center with [Motion One](https://motion.dev/) springs, and loads a high-res image on top.
- Folder sync uses Twitter's internal GraphQL endpoints via Chrome session cookies (same approach as [fieldtheory-cli](https://github.com/afar1/fieldtheory-cli)).

## Excluding bookmarks

Add tweet IDs to `EXCLUDED_IDS` in `export-bookmarks.js` and re-export.

## License

MIT
