// ==========================================
// 5. services/youtubeUploader.js - YouTube API Integration
// ==========================================

const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

class YouTubeUploader {
  constructor() {
    this.oauth2Client = new google.auth.OAuth2(
      process.env.YOUTUBE_CLIENT_ID,
      process.env.YOUTUBE_CLIENT_SECRET,
      process.env.YOUTUBE_REDIRECT_URI
    );

    this.youtube = google.youtube({
      version: 'v3',
      auth: this.oauth2Client
    });

    // Load stored refresh token if available
    this.loadStoredTokens();
  }

  getAuthUrl() {
    return this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: [
        'https://www.googleapis.com/auth/youtube.upload',
        'https://www.googleapis.com/auth/youtube'
      ],
      prompt: 'consent' // Force consent screen to ensure refresh token
    });
  }

  async getTokensFromCode(code) {
    const { tokens } = await this.oauth2Client.getToken(code);
    this.oauth2Client.setCredentials(tokens);
    
    // Store refresh token for future use
    this.storeTokens(tokens);
    
    return tokens;
  }

  storeTokens(tokens) {
    const tokenPath = path.join(__dirname, '..', 'youtube_tokens.json');
    fs.writeFileSync(tokenPath, JSON.stringify(tokens, null, 2));
    console.log('Tokens stored successfully');
  }

  loadStoredTokens() {
    const tokenPath = path.join(__dirname, '..', 'youtube_tokens.json');
    if (fs.existsSync(tokenPath)) {
      const tokens = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
      this.oauth2Client.setCredentials(tokens);
      console.log('Tokens loaded. Has refresh token:', !!tokens.refresh_token);
    } else {
      console.log('No stored tokens found');
    }
  }

  async refreshTokensIfNeeded() {
    try {
      const currentCredentials = this.oauth2Client.credentials;
      
      // Debug logging
      console.log('Current credentials:', {
        hasAccessToken: !!currentCredentials.access_token,
        hasRefreshToken: !!currentCredentials.refresh_token,
        expiryDate: currentCredentials.expiry_date
      });
      
      // Check if we have a refresh token
      if (!currentCredentials.refresh_token) {
        throw new Error('No refresh token available. Please re-authenticate.');
      }
      
      // Check if access token is expired or will expire soon (within 5 minutes)
      const now = Date.now();
      const expiryTime = currentCredentials.expiry_date;
      const fiveMinutesFromNow = now + (5 * 60 * 1000);
      
      if (!expiryTime || expiryTime <= fiveMinutesFromNow) {
        console.log('Access token expired or expiring soon, refreshing...');
        const { credentials } = await this.oauth2Client.refreshAccessToken();
        this.oauth2Client.setCredentials(credentials);
        this.storeTokens(credentials);
        console.log('Tokens refreshed successfully');
      } else {
        console.log('Access token is still valid');
      }
      
    } catch (error) {
      console.error('Token refresh failed:', error);
      throw new Error('YouTube authentication expired. Please re-authenticate.');
    }
  }

  async uploadVideo({ videoPath, title, description, tags, categoryId = '10' }) {
    try {
      // Ensure we have valid tokens
      await this.refreshTokensIfNeeded();

      const fileSize = fs.statSync(videoPath).size;
      
      const requestBody = {
        snippet: {
          title: title.substring(0, 100), // YouTube title limit
          description: description.substring(0, 5000), // YouTube description limit
          tags: tags.slice(0, 15), // YouTube allows max 15 tags
          categoryId: categoryId,
          defaultLanguage: 'en',
          defaultAudioLanguage: 'en'
        },
        status: {
          privacyStatus: 'public', // or 'private', 'unlisted'
          selfDeclaredMadeForKids: false
        }
      };

      const media = {
        mimeType: 'video/mp4',
        body: fs.createReadStream(videoPath)
      };

      console.log('Starting YouTube upload...');
      console.log(`File size: ${(fileSize / 1024 / 1024).toFixed(2)} MB`);

      const response = await this.youtube.videos.insert({
        part: ['snippet', 'status'],
        requestBody: requestBody,
        media: media
      });

      console.log(`Upload successful! Video ID: ${response.data.id}`);

      return {
        videoId: response.data.id,
        url: `https://youtube.com/watch?v=${response.data.id}`,
        title: response.data.snippet.title,
        publishedAt: response.data.snippet.publishedAt
      };

    } catch (error) {
      console.error('YouTube upload failed:', error);
      
      if (error.code === 401) {
        throw new Error('YouTube authentication expired. Please re-authenticate.');
      } else if (error.code === 403) {
        throw new Error('YouTube API quota exceeded or permissions denied.');
      } else {
        throw new Error(`YouTube upload failed: ${error.message}`);
      }
    }
  }
}

module.exports = YouTubeUploader;