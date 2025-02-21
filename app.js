/*******************************************************
 * youtubeAutomation.js
 *
 * 1) If a refresh token is not found, starts an Express
 *    server to perform OAuth flow and retrieve tokens.
 * 2) Once we have a refresh token, it lists your videos
 *    via search.list (forMine=true), checks which
 *    are private, and updates them to unlisted and
 *    not made for kids.
 *******************************************************/
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const { google } = require('googleapis');

// ---- CONFIGURATION ----
const TOKENS_PATH = path.join(__dirname, 'tokens.json'); // file to store OAuth tokens
const SCOPES = ['https://www.googleapis.com/auth/youtube.force-ssl']; // Allows managing videos

// Create the OAuth2 client
const oauth2Client = new google.auth.OAuth2(
  process.env.CLIENT_ID,
  process.env.CLIENT_SECRET,
  process.env.REDIRECT_URI
);

// --- Utility functions to load/store tokens ---
function loadStoredTokens() {
  try {
    if (fs.existsSync(TOKENS_PATH)) {
      const content = fs.readFileSync(TOKENS_PATH, 'utf-8');
      return JSON.parse(content);
    }
  } catch (err) {
    console.error('Could not read tokens from file:', err);
  }
  return null;
}

function storeTokens(tokens) {
  fs.writeFileSync(TOKENS_PATH, JSON.stringify(tokens, null, 2), 'utf-8');
  console.log('Refresh token saved to', TOKENS_PATH);
}

// Check if we already have tokens
const existingTokens = loadStoredTokens();
if (existingTokens && existingTokens.refresh_token) {
  console.log('Using existing refresh token from tokens.json');
  oauth2Client.setCredentials(existingTokens);
  updateVideos(); // Jump straight to updating videos
} else {
  // No refresh token => start OAuth flow
  startOAuthServer();
}

/**
 * Launch a local Express server for OAuth if we have no refresh token.
 */
function startOAuthServer() {
  const app = express();

  // 1) /authorize - Start the OAuth flow
  app.get('/authorize', (req, res) => {
    const url = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent', // Force returning a refresh token
      scope: SCOPES,
    });
    console.log('Redirecting user to Google for consent:', url);
    return res.redirect(url);
  });

  // 2) /oauth2callback - Google redirects back here with a ?code=...
  app.get('/oauth2callback', async (req, res) => {
    const code = req.query.code;
    if (!code) {
      return res.status(400).send('Missing code parameter.');
    }
    try {
      const { tokens } = await oauth2Client.getToken(code);
      console.log('Tokens acquired:', tokens);

      // Save tokens (especially refresh_token) to file
      storeTokens(tokens);

      // Set credentials on OAuth2 client
      oauth2Client.setCredentials(tokens);

      // Now we can update videos
      updateVideos();

      return res.send(`
        <h3>Authentication successful!</h3>
        <p>You can close this window. The script is continuing in the console.</p>
      `);
    } catch (err) {
      console.error('Error retrieving tokens:', err);
      return res.status(500).send('Error retrieving tokens.');
    }
  });

  // Start the local server
  const PORT = 3000;
  app.listen(PORT, () => {
    console.log(`OAuth server is listening at http://localhost:${PORT}`);
    console.log(`Go to http://localhost:${PORT}/authorize to begin the OAuth flow.`);
  });
}

/**
 * updateVideos():
 * - Uses search.list(forMine=true) to find your videos in batches of 50
 * - Looks up each video's status
 * - Updates any that are private to unlisted & not made for kids
 */
async function updateVideos() {
  console.log('Starting video update process...');

  const youtube = google.youtube({
    version: 'v3',
    auth: oauth2Client,
  });

  let nextPageToken = null;
  let updatedCount = 0;

  try {
    // Keep paging through results
    do {
      // 1) Use search.list to find up to 50 of your videos
      const searchResponse = await youtube.search.list({
        part: 'id',
        forMine: true,
        type: 'video',
        maxResults: 50,
        pageToken: nextPageToken,
      });

      // Array of search result items
      const videoItems = searchResponse.data.items || [];
      console.log(`Found ${videoItems.length} video(s) in this batch.`);

      // Extract the video IDs
      const videoIds = videoItems.map(item => item.id.videoId);

      nextPageToken = searchResponse.data.nextPageToken;

      if (videoIds.length === 0) {
        // No videos to process in this page, move to the next
        continue;
      }

      // 2) Retrieve status for these IDs
      const videosResponse = await youtube.videos.list({
        part: 'id,status',
        id: videoIds.join(','),
      });

      const videos = videosResponse.data.items || [];

      // 3) Update videos that are private
      for (const video of videos) {
        if (video.status.privacyStatus === 'private') {
          console.log(`Updating video ID: ${video.id}`);

          await youtube.videos.update({
            part: 'status',
            requestBody: {
              id: video.id,
              status: {
                privacyStatus: 'unlisted',
                madeForKids: false,
                selfDeclaredMadeForKids: false,
              },
            },
          });
          updatedCount++;
        }
      }
    } while (nextPageToken);

    console.log(`Done! Updated ${updatedCount} private (draft) video(s).`);
    process.exit(0);
  } catch (error) {
    console.error('Error updating videos:', error);
    process.exit(1);
  }
}
