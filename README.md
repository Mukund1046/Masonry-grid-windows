# twitter-bookmarks-grid

An infinite pannable masonry grid for your Twitter bookmarks. Browse your bookmarks visually or by folder. Based on [@afar1](https://github.com/afar1)'s great [fieldtheory-cli](https://github.com/afar1/fieldtheory-cli) repo.

Feel free to remix this into a webapp, browser extension or whatever suits your needs!

![Grid view](assets/example.png)
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

## Excluding bookmarks

Add tweet IDs to `EXCLUDED_IDS` in `export-bookmarks.js` and re-export.

## License

MIT
