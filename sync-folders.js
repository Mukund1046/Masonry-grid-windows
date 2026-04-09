#!/usr/bin/env node

// Syncs Twitter bookmark folders and tags each bookmark with its folder name.
// Uses explicit X session cookies from environment or .env.
// Outputs folder data to folders-data.json

const { mkdirSync, writeFileSync } = require("fs");
const { dirname } = require("path");
const { getFoldersOutputPath, getRequiredEnv } = require("./config");

const X_PUBLIC_BEARER =
  "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";

const GRAPHQL_FEATURES = {
  rweb_video_screen_enabled: false,
  profile_label_improvements_pcf_label_in_post_enabled: true,
  responsive_web_profile_redirect_enabled: false,
  rweb_tipjar_consumption_enabled: false,
  verified_phone_label_enabled: false,
  creator_subscriptions_tweet_preview_api_enabled: true,
  responsive_web_graphql_timeline_navigation_enabled: true,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  premium_content_api_read_enabled: false,
  communities_web_enable_tweet_community_results_fetch: true,
  c9s_tweet_anatomy_moderator_badge_enabled: true,
  responsive_web_grok_analyze_button_fetch_trends_enabled: false,
  responsive_web_grok_analyze_post_followups_enabled: true,
  responsive_web_jetfuel_frame: true,
  responsive_web_grok_share_attachment_enabled: true,
  responsive_web_grok_annotations_enabled: true,
  articles_preview_enabled: true,
  responsive_web_edit_tweet_api_enabled: true,
  graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
  view_counts_everywhere_api_enabled: true,
  longform_notetweets_consumption_enabled: true,
  responsive_web_twitter_article_tweet_consumption_enabled: true,
  content_disclosure_indicator_enabled: true,
  content_disclosure_ai_generated_indicator_enabled: true,
  responsive_web_grok_show_grok_translated_post: true,
  responsive_web_grok_analysis_button_from_backend: true,
  post_ctas_fetch_enabled: true,
  freedom_of_speech_not_reach_fetch_enabled: true,
  standardized_nudges_misinfo: true,
  tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
  longform_notetweets_rich_text_read_enabled: true,
  longform_notetweets_inline_media_enabled: false,
  responsive_web_grok_image_annotation_enabled: true,
  responsive_web_grok_imagine_annotation_enabled: true,
  responsive_web_grok_community_note_auto_translation_is_enabled: false,
  responsive_web_enhance_cards_enabled: false,
};

function getTwitterCookies() {
  const ct0 = getRequiredEnv("X_CT0");
  const authToken = getRequiredEnv("X_AUTH_TOKEN");

  return {
    csrfToken: ct0,
    cookieHeader: `ct0=${ct0}; auth_token=${authToken}`,
  };
}

// --- GraphQL fetch ---

async function fetchGraphQL(queryId, operation, variables) {
  const { csrfToken, cookieHeader } = getTwitterCookies();

  const params = new URLSearchParams({
    variables: JSON.stringify(variables),
    features: JSON.stringify(GRAPHQL_FEATURES),
  });

  const url = `https://x.com/i/api/graphql/${queryId}/${operation}?${params}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        authorization: `Bearer ${X_PUBLIC_BEARER}`,
        "x-csrf-token": csrfToken,
        "x-twitter-auth-type": "OAuth2Session",
        "x-twitter-active-user": "yes",
        cookie: cookieHeader,
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
        accept: "*/*",
        "accept-language": "en-US,en;q=0.9",
        referer: "https://x.com/i/bookmarks",
      },
      signal: controller.signal,
    });

    const body = await response.text();
    if (!body.trim()) {
      throw new Error(`X returned an empty response for ${operation} (${response.status})`);
    }

    if (!response.ok) {
      const hint =
        response.status === 401 || response.status === 403
          ? " Verify that X_CT0 is the shorter csrf token, X_AUTH_TOKEN is the longer auth cookie, and both were copied fresh from x.com."
          : "";
      throw new Error(
        `X returned ${response.status} ${response.statusText} for ${operation}: ${body.slice(0, 300)}${hint}`
      );
    }

    try {
      return JSON.parse(body);
    } catch {
      throw new Error(
        `X returned non-JSON for ${operation}: ${body.slice(0, 300)}`
      );
    }
  } finally {
    clearTimeout(timeout);
  }
}

// --- Parse tweet from GraphQL response ---

function parseTweet(tweetResult) {
  const tweet = tweetResult?.tweet ?? tweetResult;
  const legacy = tweet?.legacy;
  if (!legacy) return null;

  const tweetId = legacy.id_str ?? tweet?.rest_id;
  if (!tweetId) return null;

  const userResult = tweet?.core?.user_results?.result;
  const authorHandle = userResult?.legacy?.screen_name;
  const authorName = userResult?.legacy?.name;
  const authorProfileImageUrl = userResult?.legacy?.profile_image_url_https;

  // Extract media
  const mediaEntities = legacy.extended_entities?.media ?? legacy.entities?.media ?? [];
  const mediaObjects = mediaEntities.map((m) => ({
    type: m.type,
    url: m.media_url_https,
    width: m.original_info?.width ?? m.sizes?.large?.w,
    height: m.original_info?.height ?? m.sizes?.large?.h,
    videoVariants: m.video_info?.variants?.filter((v) => v.content_type === "video/mp4") ?? [],
  }));

  return {
    tweetId,
    text: legacy.full_text ?? "",
    url: `https://x.com/${authorHandle}/status/${tweetId}`,
    authorHandle: authorHandle ?? "",
    authorName: authorName ?? "",
    authorProfileImageUrl: authorProfileImageUrl ?? "",
    postedAt: legacy.created_at ?? "",
    mediaObjects,
    engagement: {
      likeCount: legacy.favorite_count ?? 0,
      repostCount: legacy.retweet_count ?? 0,
      bookmarkCount: legacy.bookmark_count ?? 0,
    },
  };
}

// --- Parse timeline response ---

function parseTimeline(json, timelinePath) {
  const instructions = timelinePath(json) ?? [];
  const tweets = [];

  for (const instruction of instructions) {
    const entries = instruction.entries ?? [];
    for (const entry of entries) {
      const result = entry.content?.itemContent?.tweet_results?.result;
      if (!result) continue;

      // Handle tombstones / unavailable tweets
      if (result.__typename === "TweetWithVisibilityResults") {
        const parsed = parseTweet(result.tweet);
        if (parsed) tweets.push(parsed);
      } else {
        const parsed = parseTweet(result);
        if (parsed) tweets.push(parsed);
      }
    }
  }

  // Extract cursor for pagination
  let cursor = null;
  for (const instruction of instructions) {
    const entries = instruction.entries ?? [];
    for (const entry of entries) {
      if (entry.content?.cursorType === "Bottom" || entry.entryId?.startsWith("cursor-bottom")) {
        cursor = entry.content?.value;
      }
    }
  }

  return { tweets, cursor };
}

// --- Fetch all pages of a folder ---

async function fetchFolderBookmarks(folderId, folderName) {
  const allTweets = [];
  let cursor = null;
  let page = 0;

  while (true) {
    page++;
    const variables = {
      bookmark_collection_id: folderId,
      includePromotedContent: true,
    };
    if (cursor) variables.cursor = cursor;

    process.stdout.write(`  ${folderName}: page ${page} (${allTweets.length} tweets)...\r`);

    let json;
    try {
      json = fetchGraphQL("LML09uXDwh87F1zd7pbf2w", "BookmarkFolderTimeline", variables);
    } catch (e) {
      console.error(`\n  Error fetching ${folderName} page ${page}: ${e.message}`);
      break;
    }

    const { tweets, cursor: nextCursor } = parseTimeline(
      json,
      (j) => j?.data?.bookmark_collection_timeline?.timeline?.instructions
    );

    allTweets.push(...tweets);

    if (!nextCursor || tweets.length === 0) break;
    cursor = nextCursor;
  }

  console.log(`  ${folderName}: ${allTweets.length} tweets              `);
  return allTweets;
}

// --- Main ---

async function main() {
  console.log("Fetching bookmark folders...\n");

  // 1. Get folder list
  const foldersJson = await fetchGraphQL("i78YDd0Tza-dV4SYs58kRg", "BookmarkFoldersSlice", {});
  const folderItems = foldersJson?.data?.viewer?.user_results?.result?.bookmark_collections_slice?.items ?? [];

  const folders = folderItems.map((f) => ({ id: f.id, name: f.name }));
  console.log(`Found ${folders.length} folders: ${folders.map((f) => f.name).join(", ")}\n`);

  // 2. Fetch bookmarks for each folder
  const folderMap = {}; // tweetId → folderName

  for (const folder of folders) {
    const tweets = await fetchFolderBookmarks(folder.id, folder.name);
    for (const t of tweets) {
      // A tweet can be in multiple folders — store as array
      if (!folderMap[t.tweetId]) folderMap[t.tweetId] = [];
      if (!folderMap[t.tweetId].includes(folder.name)) {
        folderMap[t.tweetId].push(folder.name);
      }
    }
  }

  // 3. Write output
  const output = {
    folders,
    folderMap, // tweetId → [folderName, ...]
  };

  const outPath = getFoldersOutputPath();
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(output, null, 2));

  const taggedCount = Object.keys(folderMap).length;
  console.log(`\nDone! ${taggedCount} bookmarks tagged across ${folders.length} folders.`);
  console.log(`Saved to ${outPath}`);
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
});
