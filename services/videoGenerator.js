const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const path = require('path');
const fs = require('fs').promises;

ffmpeg.setFfmpegPath(ffmpegPath);

class VideoGenerator {
  async generateVideo({ audioPath, imagePath, outputDir, sessionId, backgroundStyle = 'blurred' }) {
    // No temp files needed anymore - single-pass processing!
    const tempFiles = [];
    
    try {
      const outputPath = path.join(outputDir, `video-${sessionId}.mp4`);

      if (backgroundStyle === 'black') {
        // Direct approach - single FFmpeg command combining everything
        await this.createVideoWithBlackBackground({
          originalImagePath: imagePath,
          audioPath,
          outputPath
        });
      } else {
        // Combined approach - create video with blurred background in one step
        await this.createVideoWithBlurredBackground({
          imagePath,
          audioPath,
          outputPath
        });
      }

      console.log('Video generation completed');
      // Return video path and empty tempFiles array (for backwards compatibility)
      // The server.js will handle cleanup of the final video after upload
      return { videoPath: outputPath, tempFiles };
    } catch (err) {
      console.error('Video generation error:', err);
      throw err;
    }
  }

  // Combined single-pass video generation with black background
  createVideoWithBlackBackground({ originalImagePath, audioPath, outputPath }) {
    return new Promise((resolve, reject) => {
      ffmpeg()
        .input(originalImagePath)
        .inputOptions(['-loop 1'])
        .input(audioPath)
        .videoCodec('libx264')
        .audioCodec('aac')
        .outputOptions([
          '-vf', 'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black',
          '-tune stillimage',
          '-pix_fmt yuv420p',
          '-shortest',
          '-r 1',
          '-b:a 192k',
          '-preset ultrafast', // Faster encoding, less memory
          '-threads 2', // Limit threads to reduce memory
          '-bufsize 512k', // Limit buffer size
          '-maxrate 2M' // Limit bitrate
        ])
        .output(outputPath)
        .on('start', cmd => console.log('FFmpeg command:', cmd))
        .on('progress', (progress) => {
          if (progress.percent && !isNaN(progress.percent)) {
            console.log(`Video: ${Math.round(progress.percent)}% done`);
          }
        })
        .on('end', () => {
          console.log('Video completed');
          resolve();
        })
        .on('error', reject)
        .run();
    });
  }

  // Combined single-pass video generation with blurred background
  createVideoWithBlurredBackground({ imagePath, audioPath, outputPath }) {
    return new Promise((resolve, reject) => {
      // Complex filter that does everything in one pass:
      // 1. Split input into 2 streams
      // 2. First stream: scale, crop, and blur for background
      // 3. Second stream: scale to fit in center (70% of canvas)
      // 4. Overlay the scaled original on top of blurred background
      const filterComplex = [
        '[0:v]split=2[bg][fg]',
        '[bg]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,gblur=sigma=20[blurred]',
        '[fg]scale=1344:756:force_original_aspect_ratio=decrease[scaled]',
        '[blurred][scaled]overlay=(W-w)/2:(H-h)/2'
      ].join(';');

      ffmpeg()
        .input(imagePath)
        .inputOptions(['-loop 1'])
        .input(audioPath)
        .videoCodec('libx264')
        .audioCodec('aac')
        .outputOptions([
          '-filter_complex', filterComplex,
          '-tune stillimage',
          '-pix_fmt yuv420p',
          '-shortest',
          '-r 1',
          '-b:a 192k',
          '-preset ultrafast', // Faster encoding, less memory
          '-threads 2', // Limit threads
          '-bufsize 512k', // Limit buffer
          '-maxrate 2M' // Limit bitrate
        ])
        .output(outputPath)
        .on('start', cmd => console.log('FFmpeg command:', cmd))
        .on('progress', (progress) => {
          if (progress.percent && !isNaN(progress.percent)) {
            console.log(`Video: ${Math.round(progress.percent)}% done`);
          }
        })
        .on('end', () => {
          console.log('Video completed');
          resolve();
        })
        .on('error', reject)
        .run();
    });
  }

  // Legacy methods kept for backward compatibility (but not used in optimized flow)
  createBlackBackgroundImage({ originalImagePath, outputPath }) {
    return new Promise((resolve, reject) => {
      ffmpeg()
        .input(originalImagePath)
        .outputOptions([
          '-vf', 'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black',
          '-frames:v', '1'
        ])
        .output(outputPath)
        .on('start', cmd => console.log('FFmpeg black background command:', cmd))
        .on('end', resolve)
        .on('error', reject)
        .run();
    });
  }

  createBlurredBackgroundImage({ imagePath, outputPath }) {
    return new Promise((resolve, reject) => {
      ffmpeg()
        .input(imagePath)
        .outputOptions([
          '-vf', 'scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,gblur=sigma=20',
          '-frames:v', '1'
        ])
        .output(outputPath)
        .on('start', cmd => console.log('FFmpeg background image command:', cmd))
        .on('end', resolve)
        .on('error', reject)
        .run();
    });
  }

  createCompositeImage({ originalImagePath, blurredImagePath, outputPath }) {
    return new Promise((resolve, reject) => {
      ffmpeg()
        .input(blurredImagePath)
        .input(originalImagePath)
        .outputOptions([
          '-filter_complex', '[1:v]scale=1344:756:force_original_aspect_ratio=decrease[fg];[0:v][fg]overlay=(W-w)/2:(H-h)/2',
          '-frames:v', '1'
        ])
        .output(outputPath)
        .on('start', cmd => console.log('FFmpeg composite image command:', cmd))
        .on('end', resolve)
        .on('error', reject)
        .run();
    });
  }

  createVideoFromImage({ imagePath, audioPath, outputPath }) {
    return new Promise((resolve, reject) => {
      ffmpeg()
        .input(imagePath)
        .inputOptions(['-loop 1'])
        .input(audioPath)
        .videoCodec('libx264')
        .audioCodec('aac')
        .outputOptions([
          '-tune stillimage',
          '-pix_fmt yuv420p',
          '-shortest',
          '-r 1',
          '-b:a 192k'
        ])
        .output(outputPath)
        .on('start', cmd => console.log('FFmpeg video command:', cmd))
        .on('progress', (progress) => {
          if (progress.percent && !isNaN(progress.percent)) {
            console.log(`Video: ${Math.round(progress.percent)}% done`);
          }
        })
        .on('end', resolve)
        .on('error', reject)
        .run();
    });
  }
}

module.exports = VideoGenerator;