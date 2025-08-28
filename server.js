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

// concurrency setup
const asyncLib = require('async');

const queue = asyncLib.queue(async (task, done) => {
  try {
    await task();
    done();
  } catch (err) {
    done(err);
  }
}, 1);

// Import services
const VideoGenerator = require('./services/videoGenerator');
const MetadataGenerator = require('./services/metadataGenerator');
const YouTubeUploader = require('./services/youtubeUploader');

const app = express();
const PORT = process.env.PORT || 3001;

const cron = require('node-cron');
const cleanupOldFiles = require('./services/cleanupService');

// scheduled cleanup
const schedule = '0 * * * *'; // hourly
const isProduction = process.env.NODE_ENV === 'production';

cron.schedule(schedule, async () => {
  console.log(`Running ${isProduction ? 'production' : 'development'} cleanup...`);
  await cleanupOldFiles(path.join(__dirname, 'uploads'), 60);
  await cleanupOldFiles(path.join(__dirname, 'videos'), 60);
});



// middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public')); 

// create uploads directory if it doesn't exist
const uploadsDir = path.join('/tmp', 'uploads');
const videosDir = path.join('/tmp', 'videos');

if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
if (!fs.existsSync(videosDir)) fs.mkdirSync(videosDir, { recursive: true });

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
  res.sendFile(path.join(__dirname, 'public', 'index.html')); 
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

// main upload endpoint

const deleteFiles = async (filePaths) => {
  for (const filePath of filePaths) {
    if (!filePath) continue;
    try {
      await fs.promises.unlink(filePath);
      console.log(`Deleted: ${filePath}`);
    } catch (err) {
      console.error(`Failed to delete ${filePath}:`, err.message);
    }
  }
};

app.post('/api/upload-beat', upload.fields([
  { name: 'beatFile', maxCount: 1 },
  { name: 'coverImage', maxCount: 1 }
]), (req, res) => {
  queue.push(async () => {
    await handleUpload(req, res);
  });
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

async function handleUpload(req, res) {
  let cleanupFiles = [];
  try {
    const { beatTitle, tags, instagramLink, beatstarsLink, genre, manualBpm, manualKey, backgroundStyle } = req.body;

    const beatFile = req.files['beatFile'][0];
    const coverImage = req.files['coverImage'][0];
    cleanupFiles.push(beatFile.path, coverImage.path); // input file tracking

    const sessionId = uuidv4();
    console.log(`Starting upload process for session: ${sessionId}`);

    // bpm/key resolution
    let bpm = manualBpm?.trim() ? parseInt(manualBpm.trim(), 10) : null;
    let key = manualKey?.trim() || null;

    if ((!bpm || isNaN(bpm) || !key) && beatstarsLink) {
      try {
        const scraped = await metadataGenerator.scrapeBeatStarsData(beatstarsLink);
        if ((!bpm || isNaN(bpm)) && scraped.bpm) bpm = scraped.bpm;
        if (!key && scraped.key) key = scraped.key;
      } catch (scrapeError) {
        console.error('Scraping failed:', scrapeError);
      }
    }

    if (!bpm || !key || isNaN(bpm)) {
      await deleteFiles(cleanupFiles);
      return res.json({
        success: false,
        scrapingFailed: true,
        message: 'Could not auto-detect BPM and Key. Please provide them manually.'
      });
    }

    // vid gen
    const { videoPath, tempFiles } = await videoGenerator.generateVideo({
      audioPath: beatFile.path,
      imagePath: coverImage.path,
      outputDir: videosDir,
      sessionId,
      backgroundStyle
    });
    cleanupFiles.push(...tempFiles, videoPath);

    // gen metadata
    const metadata = await metadataGenerator.generateMetadata({
      beatTitle,
      tags,
      genre,
      instagramLink,
      beatstarsLink,
      manualBpm: bpm,
      manualKey: key
    });

    // Upload to YouTube
    const uploadResult = await youtubeUploader.uploadVideo({
      videoPath,
      title: metadata.title,
      description: metadata.description,
      tags: metadata.tags,
      categoryId: '10'
    });

    // Clean up everything after successful upload
    await deleteFiles(cleanupFiles);

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
    await deleteFiles(cleanupFiles);
    res.status(500).json({ success: false, error: error.message });
  }
}