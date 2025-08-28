// ==========================================
// 2. server.js - Main Express Server
// ==========================================

const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

// Import services
const VideoGenerator = require('./services/videoGenerator');
const MetadataGenerator = require('./services/metadataGenerator');
const YouTubeUploader = require('./services/youtubeUploader');

const app = express();
const PORT = process.env.PORT || 3001;

// middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public')); // ADD THIS LINE

// create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, 'uploads');
const videosDir = path.join(__dirname, 'videos');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);
if (!fs.existsSync(videosDir)) fs.mkdirSync(videosDir);

// cfigure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 100 * 1024 * 1024 // 100MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.fieldname === 'beatFile') {
      if (file.mimetype.startsWith('audio/')) {
        cb(null, true);
      } else {
        cb(new Error('Beat file must be an audio file'));
      }
    } else if (file.fieldname === 'coverImage') {
      if (file.mimetype.startsWith('image/')) {
        cb(null, true);
      } else {
        cb(new Error('Cover must be an image file'));
      }
    } else {
      cb(new Error('Unexpected field'));
    }
  }
});

// initialize services
const videoGenerator = new VideoGenerator();
const metadataGenerator = new MetadataGenerator();
const youtubeUploader = new YouTubeUploader();

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));  // CHANGE THIS LINE
});

/*
//  endpoint to check BPM/Key from BeatStars link
app.post('/api/check-beatstars-data', async (req, res) => {
  try {
    const { beatstarsLink } = req.body;
    
    if (!beatstarsLink) {
      return res.json({ success: false, error: 'No BeatStars link provided' });
    }

    console.log('Checking BeatStars data for:', beatstarsLink);
    
    // Try to scrape the data
    const { bpm, key, scrapingFailed } = await metadataGenerator.scrapeBeatStarsData(beatstarsLink);
    
    res.json({
      success: true,
      data: { bpm, key },
      scrapingFailed: scrapingFailed || (!bpm && !key)
    });

  } catch (error) {
    console.error('BeatStars data check failed:', error);
    res.json({
      success: false,
      error: error.message,
      scrapingFailed: true
    });
  }
});
*/

// Main upload endpoint
// Replace the BPM/Key resolution logic in your server.js upload endpoint:

app.post('/api/upload-beat', upload.fields([
  { name: 'beatFile', maxCount: 1 },
  { name: 'coverImage', maxCount: 1 }
]), async (req, res) => {
  try {
    const { beatTitle, tags, instagramLink, beatstarsLink, genre, manualBpm, manualKey, backgroundStyle } = req.body;

    const beatFile = req.files['beatFile'][0];
    const coverImage = req.files['coverImage'][0];
    const sessionId = uuidv4();
    console.log(`Starting upload process for session: ${sessionId}`);

    // Step 1: Resolve BPM/Key before video generation
    // Parse manual values properly (they come as strings from FormData)
    let bpm = null;
    let key = null;

    // Check for manual values first (they take priority)
    if (manualBpm && manualBpm.trim() !== '') {
      bpm = parseInt(manualBpm.trim(), 10);
      console.log('Using manual BPM:', bpm);
    }
    
    if (manualKey && manualKey.trim() !== '') {
      key = manualKey.trim();
      console.log('Using manual Key:', key);
    }

    // Only attempt scraping if we still don't have values AND we have a BeatStars link
    const needsBpm = !bpm || isNaN(bpm);
    const needsKey = !key;
    
    console.log('BPM/Key status:', { 
      needsBpm, 
      needsKey, 
      hasBeatstarsLink: !!beatstarsLink,
      manualBpm,
      manualKey 
    });

    if ((needsBpm || needsKey) && beatstarsLink) {
      console.log('Attempting to scrape BeatStars data...');
      try {
        const scraped = await metadataGenerator.scrapeBeatStarsData(beatstarsLink);
        
        // Only use scraped values if we don't have manual ones
        if (needsBpm && scraped.bpm) {
          bpm = scraped.bpm;
          console.log('Scraped BPM:', bpm);
        }
        if (needsKey && scraped.key) {
          key = scraped.key;
          console.log('Scraped Key:', key);
        }
      } catch (scrapeError) {
        console.error('Scraping failed:', scrapeError);
      }
    } else {
      console.log('Skipping scraping - manual values provided or no BeatStars link');
    }

    // Final check - if still missing BPM or Key, request manual input
    if (!bpm || !key || isNaN(bpm)) {
      console.log('BPM/Key still missing after scraping attempt:', { bpm, key });
      return res.json({
        success: false,
        scrapingFailed: true,
        message: 'Could not auto-detect BPM and Key. Please provide them manually.',
        missingData: {
          bpm: !bpm || isNaN(bpm),
          key: !key
        }
      });
    }

    console.log('Final BPM/Key values:', { bpm, key });

    // Step 2: Generate video (now we have BPM/Key)
    console.log('Generating video...');
    const videoPath = await videoGenerator.generateVideo({
      audioPath: beatFile.path,
      imagePath: coverImage.path,
      outputDir: videosDir,
      sessionId,
      backgroundStyle
    });

    // Step 3: Generate metadata
    console.log('Generating metadata...');
    const metadata = await metadataGenerator.generateMetadata({
      beatTitle,
      tags,
      genre,
      instagramLink,
      beatstarsLink,
      manualBpm: bpm,
      manualKey: key
    });

    // Step 4: Upload to YouTube
    console.log('Uploading to YouTube...');
    const uploadResult = await youtubeUploader.uploadVideo({
      videoPath,
      title: metadata.title,
      description: metadata.description,
      tags: metadata.tags,
      categoryId: '10'
    });

    res.json({
      success: true,
      sessionId,
      result: {
        videoId: uploadResult.videoId,
        youtubeUrl: `https://youtube.com/watch?v=${uploadResult.videoId}`,
        title: metadata.title,
        description: metadata.description,
        tags: metadata.tags
      }
    });

  } catch (error) {
    console.error('Upload process failed:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// YouTube OAuth routes
app.get('/api/auth/youtube', (req, res) => {
  const authUrl = youtubeUploader.getAuthUrl();
  res.json({ authUrl });
});

app.post('/api/auth/youtube/callback', async (req, res) => {
  try {
    const { code } = req.body;
    const tokens = await youtubeUploader.getTokensFromCode(code);
    res.json({ success: true, message: 'Authentication successful' });
  } catch (error) {
    console.error('YouTube auth failed:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/auth/youtube/callback', async (req, res) => {
  try {
    const { code, error } = req.query;
    
    if (error) {
      // redirect back to frontend with error
      return res.redirect(`/?auth_error=${encodeURIComponent(error)}`);
    }
    
    if (code) {
      // exchange code for tokens
      const tokens = await youtubeUploader.getTokensFromCode(code);
      
      // redirect back to frontend with success
      res.redirect('/?auth_success=true');
    } else {
      res.redirect('/?auth_error=no_code_received');
    }
  } catch (error) {
    console.error('YouTube auth failed:', error);
    res.redirect(`/?auth_error=${encodeURIComponent(error.message)}`);
  }
});

// testing

app.get('/api/test-config', (req, res) => {
  res.json({
    status: 'Server running',
    config: {
      youtube_client_id: process.env.YOUTUBE_CLIENT_ID ? 'Set' : 'Missing',
      youtube_client_secret: process.env.YOUTUBE_CLIENT_SECRET ? 'Set' : 'Missing',
      youtube_redirect_uri: process.env.YOUTUBE_REDIRECT_URI
    }
  });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});