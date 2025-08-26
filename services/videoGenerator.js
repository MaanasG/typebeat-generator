const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const path = require('path');

ffmpeg.setFfmpegPath(ffmpegPath);

class VideoGenerator {
  async generateVideo({ audioPath, imagePath, outputDir, sessionId }) {
    return new Promise(async (resolve, reject) => {
      try {
        const tempBlurredImagePath = path.join(outputDir, `temp-bg-${sessionId}.jpg`);
        const tempCompositeImagePath = path.join(outputDir, `temp-composite-${sessionId}.jpg`);
        const outputPath = path.join(outputDir, `video-${sessionId}.mp4`);
        
        console.log(`Step 1: Creating blurred background image`);
        
        // Step 1: Create blurred background image (very fast)
        await this.createBlurredBackgroundImage({
          imagePath,
          outputPath: tempBlurredImagePath
        });
        
        console.log(`Step 2: Creating composite image with centered original`);
        
        // Step 2: Create composite image with original centered on blurred background
        await this.createCompositeImage({
          originalImagePath: imagePath,
          blurredImagePath: tempBlurredImagePath,
          outputPath: tempCompositeImagePath
        });
        
        console.log(`Step 3: Generating final video from composite image`);
        
        // Step 3: Create video from composite image and audio
        await this.createVideoFromImage({
          imagePath: tempCompositeImagePath,
          audioPath,
          outputPath
        });
        
        // Clean up temp files
        const fs = require('fs');
        if (fs.existsSync(tempBlurredImagePath)) {
          fs.unlinkSync(tempBlurredImagePath);
        }
        if (fs.existsSync(tempCompositeImagePath)) {
          fs.unlinkSync(tempCompositeImagePath);
        }
        
        console.log('Video generation completed');
        resolve(outputPath);
        
      } catch (err) {
        console.error('Video generation error:', err);
        reject(err);
      }
    });
  }
  
  createBlurredBackgroundImage({ imagePath, outputPath }) {
    return new Promise((resolve, reject) => {
      ffmpeg()
        .input(imagePath)
        .outputOptions([
          '-vf', 'scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,gblur=sigma=20',
          '-frames:v', '1'  // Only generate 1 frame (single image)
        ])
        .output(outputPath)
        .on('start', (commandLine) => {
          console.log('FFmpeg background image command:', commandLine);
        })
        .on('end', () => {
          console.log('Blurred background image completed');
          resolve();
        })
        .on('error', (err) => {
          console.error('Background image FFmpeg error:', err);
          reject(err);
        })
        .run();
    });
  }
  
  createCompositeImage({ originalImagePath, blurredImagePath, outputPath }) {
    return new Promise((resolve, reject) => {
      // Scale original image to fit within 70% of canvas (1344x756) to ensure good margins
      // This gives 288px margin on sides and 162px margin top/bottom
      ffmpeg()
        .input(blurredImagePath)
        .input(originalImagePath)
        .outputOptions([
          '-filter_complex', '[1:v]scale=1344:756:force_original_aspect_ratio=decrease[fg];[0:v][fg]overlay=(W-w)/2:(H-h)/2',
          '-frames:v', '1'  // Only generate 1 frame (single image)
        ])
        .output(outputPath)
        .on('start', (commandLine) => {
          console.log('FFmpeg composite image command:', commandLine);
        })
        .on('end', () => {
          console.log('Composite image completed');
          resolve();
        })
        .on('error', (err) => {
          console.error('Composite image FFmpeg error:', err);
          reject(err);
        })
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
        .on('start', (commandLine) => {
          console.log('FFmpeg video command:', commandLine);
        })
        .on('progress', (progress) => {
          if (progress.percent && !isNaN(progress.percent)) {
            console.log(`Video: ${Math.round(progress.percent)}% done`);
          } else {
            console.log('Video: Processing...');
          }
        })
        .on('end', () => {
          console.log('Final video completed');
          resolve();
        })
        .on('error', (err) => {
          console.error('Video FFmpeg error:', err);
          reject(err);
        })
        .run();
    });
  }
}

module.exports = VideoGenerator;