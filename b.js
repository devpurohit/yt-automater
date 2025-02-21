require('dotenv').config();
const { google } = require('googleapis');

async function main() {
  const oauth2Client = new google.auth.OAuth2(
    process.env.CLIENT_ID,
    process.env.CLIENT_SECRET,
    process.env.REDIRECT_URI
  );

  // Use your existing refresh token here
  oauth2Client.setCredentials({ refresh_token: process.env.REFRESH_TOKEN });

  const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

  try {
    let nextPageToken = null;
    let updatedCount = 0;

    do {
      // 1) Get up to 50 of *your* videos via search
      const searchResponse = await youtube.search.list({
        part: 'id',
        forMine: true,
        type: 'video',
        maxResults: 50,
        pageToken: nextPageToken,
      });

      // Extract the video IDs
      const videoItems = searchResponse.data.items || [];
      const videoIds = videoItems.map(item => item.id.videoId);

      // Prepare for next page
      nextPageToken = searchResponse.data.nextPageToken;

      // If no videos on this page, continue
      if (!videoIds.length) continue;

      // 2) For those IDs, retrieve their status
      const videosResponse = await youtube.videos.list({
        part: 'status',
        id: videoIds.join(','),
      });
      const videos = videosResponse.data.items || [];

      // 3) Update those which are private
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

    console.log(`Done! Updated ${updatedCount} private video(s).`);
  } catch (error) {
    console.error('Error:', error);
  }
}

main();
