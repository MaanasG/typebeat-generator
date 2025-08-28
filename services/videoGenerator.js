const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const path = require('path');

ffmpeg.setFfmpegPath(ffmpegPath);

class VideoGenerator {
  async generateVideo({ audioPath, imagePath, outputDir, sessionId, backgroundStyle = 'blurred' }) {
  return new Promise(async (resolve, reject) => {
    try {
      const outputPath = path.join(outputDir, `video-${sessionId}.mp4`);

      let finalImagePath;

      if (backgroundStyle === 'black') {
        // Just scale the original image to fit black background
        const blackBackgroundPath = path.join(outputDir, `temp-black-${sessionId}.jpg`);
        await this.createBlackBackgroundImage({
          originalImagePath: imagePath,
          outputPath: blackBackgroundPath
        });
        finalImagePath = blackBackgroundPath;
      } else {
        // Existing blurred background workflow
        const tempBlurredImagePath = path.join(outputDir, `temp-bg-${sessionId}.jpg`);
        const tempCompositeImagePath = path.join(outputDir, `temp-composite-${sessionId}.jpg`);

        await this.createBlurredBackgroundImage({
          imagePath,
          outputPath: tempBlurredImagePath
        });

        await this.createCompositeImage({
          originalImagePath: imagePath,
          blurredImagePath: tempBlurredImagePath,
          outputPath: tempCompositeImagePath
        });

        finalImagePath = tempCompositeImagePath;
      }

      await this.createVideoFromImage({
        imagePath: finalImagePath,
        audioPath,
        outputPath
      });

      console.log('Video generation completed');
      resolve(outputPath);
    } catch (err) {
      console.error('Video generation error:', err);
      reject(err);
    }
  });
}

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