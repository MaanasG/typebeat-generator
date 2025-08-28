const fs = require('fs');
const path = require('path');

/**
 * deletes older files periodically
 * @param {string} directory 
 * @param {number} maxAgeMinutes
 */
async function cleanupOldFiles(directory, maxAgeMinutes = 60) {
  const now = Date.now();
  const maxAgeMs = maxAgeMinutes * 60 * 1000;

  try {
    const files = await fs.promises.readdir(directory);
    for (const file of files) {
      const filePath = path.join(directory, file);
      try {
        const stats = await fs.promises.stat(filePath);

        // Delete if older than maxAgeMs
        if (now - stats.mtimeMs > maxAgeMs) {
          await fs.promises.unlink(filePath);
          console.log(`Cleaned up old file: ${filePath}`);
        }
      } catch (err) {
        console.error(`Failed to check/delete ${filePath}:`, err.message);
      }
    }
  } catch (err) {
    console.error(`Failed to read directory ${directory}:`, err.message);
  }
}

module.exports = cleanupOldFiles;
