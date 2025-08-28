// ==========================================
// 4. services/metadataGenerator.js - AI Metadata Generation
// ==========================================

const puppeteer = require('puppeteer');

class MetadataGenerator {

    
  async generateMetadata({ beatTitle, tags, genre, instagramLink, beatstarsLink, manualBpm, manualKey }) {
    console.log('Generating metadata with provided values:', { 
      beatTitle, 
      tags, 
      genre, 
      manualBpm, 
      manualKey 
    });
    
    // Use the values directly - server has already resolved them
    const bpm = manualBpm;
    const key = manualKey;

    // Build YouTube metadata
    const title = beatTitle;

    let description = '';
    description += 'mail - mainsputitinme@gmail.com\n';
    description += instagramLink
      ? `ig - ${instagramLink}\n`
      : 'ig - instagram.com/1mains\n';

    if (beatstarsLink) {
      description += `download/purchase - ${beatstarsLink}\n`;
    }

    description += '\n';
    description += bpm ? `${bpm}bpm\n` : 'Not Found\n';
    description += key ? `${key}\n` : 'Not Found\n';

    description += '\n';
    description += 'important: free for nonprofit only, purchase a lease by contacting me thru instagram/email\n\n';

    const generatedTags = this.generateTags(tags);
    description += `tags: ${generatedTags.join(', ')}`;

    return {
      title,
      description,
      tags: generatedTags.slice(0, 15)
    };
  }

  async scrapeBeatStarsData(beatstarsLink, maxRetries = 3) {
    let browser;
    let attempt = 0;

    while (attempt < maxRetries) {
      attempt++;
      try {
        if (!beatstarsLink) return { bpm: null, key: null };

        console.log(`Attempt ${attempt}/${maxRetries} - Scraping BeatStars page: ${beatstarsLink}`);

        // Launch browser with more conservative settings
        browser = await puppeteer.launch({
          headless: true,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process',
            '--disable-gpu',
            '--disable-web-security',
            '--disable-features=VizDisplayCompositor',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding'
          ],
          timeout: 60000
        });

        const page = await browser.newPage();
        
        // Set user agent and headers
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        await page.setExtraHTTPHeaders({
          'Accept-Language': 'en-US,en;q=0.9'
        });
        
        // Set viewport
        await page.setViewport({ width: 1280, height: 800 });

        // Add error handlers
        page.on('error', (err) => {
          console.error('Page error:', err.message);
        });

        page.on('pageerror', (err) => {
          console.error('Page script error:', err.message);
        });

        // Navigate with more robust options
        try {
          await page.goto(beatstarsLink, { 
            waitUntil: ['load', 'domcontentloaded'],
            timeout: 45000 
          });

          // Wait for page to stabilize
          await page.waitForTimeout(5000);

          // Check if page loaded properly
          const pageTitle = await page.title();
          console.log(`Page loaded: ${pageTitle}`);

          if (!pageTitle || pageTitle.toLowerCase().includes('error')) {
            throw new Error('Page failed to load properly');
          }

          // Try to find BPM and Key data
          let bpm = null;
          let key = null;

          // Strategy 1: Look for specific BeatStars selectors and data attributes
          const selectorData = await page.evaluate(() => {
            try {
              // Common BeatStars selectors for beat metadata
              const possibleBpmSelectors = [
                '[data-testid="bpm"]',
                '[data-cy="bpm"]',
                '.beat-bpm',
                '.track-bpm',
                '[class*="bpm"]',
                '[id*="bpm"]'
              ];

              const possibleKeySelectors = [
                '[data-testid="key"]',
                '[data-cy="key"]',
                '.beat-key',
                '.track-key',
                '[class*="key"]',
                '[id*="key"]'
              ];

              let foundBpm = null;
              let foundKey = null;

              // Try BPM selectors
              for (const selector of possibleBpmSelectors) {
                const element = document.querySelector(selector);
                if (element) {
                  const text = element.textContent || element.innerText || '';
                  const bpmMatch = text.match(/(\d+)/);
                  if (bpmMatch) {
                    foundBpm = parseInt(bpmMatch[1]);
                    break;
                  }
                }
              }

              // Try Key selectors
              for (const selector of possibleKeySelectors) {
                const element = document.querySelector(selector);
                if (element) {
                  const text = element.textContent || element.innerText || '';
                  const keyMatch = text.match(/([A-G][#♯b♭]?\s*(?:major|minor|maj|min|m)?)/i);
                  if (keyMatch) {
                    foundKey = keyMatch[1].trim();
                    break;
                  }
                }
              }

              return { bpm: foundBpm, key: foundKey };
            } catch (e) {
              return { bpm: null, key: null, error: e.message };
            }
          });

          bpm = selectorData.bpm;
          key = selectorData.key;

          // Strategy 2: Text pattern matching if selectors didn't work
          if (!bpm || !key) {
            const textData = await page.evaluate(() => {
              try {
                const allText = document.body.innerText || '';
                
                let foundBpm = null;
                let foundKey = null;

                // Look for BPM - more specific patterns
                const bpmPatterns = [
                  /(\d+)\s*bpm/i,
                  /bpm\s*:?\s*(\d+)/i,
                  /tempo\s*:?\s*(\d+)/i
                ];

                for (const pattern of bpmPatterns) {
                  const match = allText.match(pattern);
                  if (match) {
                    foundBpm = parseInt(match[1]);
                    break;
                  }
                }

                // Look for Key - improved patterns
                const keyPatterns = [
                  /key\s*:?\s*([A-G][#♯b♭]?\s*(?:major|minor|maj|min|m)?)/gi,
                  /([A-G][#♯b♭]?)\s+(major|minor|maj|min)/gi,
                  /([A-G][#♯b♭]?m)\b/g  // For patterns like "Am", "F#m"
                ];

                for (const pattern of keyPatterns) {
                  const matches = [...allText.matchAll(pattern)];
                  if (matches.length > 0) {
                    // Filter out false positives
                    const validKeys = matches.filter(match => {
                      const fullMatch = match[0];
                      const lower = fullMatch.toLowerCase();
                      return !lower.includes('email') && 
                             !lower.includes('gmail') && 
                             !lower.includes('member') &&
                             !lower.includes('comment') &&
                             !lower.includes('stream') &&
                             fullMatch.length < 20;
                    });
                    
                    if (validKeys.length > 0) {
                      foundKey = validKeys[0][0].trim();
                      break;
                    }
                  }
                }

                return { bpm: foundBpm, key: foundKey, textLength: allText.length };
              } catch (e) {
                return { bpm: null, key: null, textLength: 0, error: e.message };
              }
            });

            if (!bpm) bpm = textData.bpm;
            if (!key) key = textData.key;
          }

          console.log(`Data extraction result:`, { bpm, key });

          // Strategy 3: Look in script tags and JSON data
          if ((!bpm || !key)) {
            console.log('Trying script tag and API data analysis...');
            
            const scriptData = await page.evaluate(() => {
              try {
                let results = { bpm: null, key: null };
                
                // Look for window variables that might contain beat data
                if (window.__INITIAL_STATE__ || window.__REDUX_STORE__ || window.__NEXT_DATA__) {
                  const stateData = window.__INITIAL_STATE__ || window.__REDUX_STORE__ || window.__NEXT_DATA__;
                  const stateStr = JSON.stringify(stateData);
                  
                  const bpmMatch = stateStr.match(/"bpm"\s*:\s*(\d+)/i);
                  const keyMatch = stateStr.match(/"key"\s*:\s*"([^"]+)"/i);
                  
                  if (bpmMatch) results.bpm = parseInt(bpmMatch[1]);
                  if (keyMatch) results.key = keyMatch[1];
                }
                
                // Look in script tags
                const scripts = Array.from(document.querySelectorAll('script'));
                for (const script of scripts) {
                  const content = script.textContent || '';
                  
                  if (content.includes('bpm') || content.includes('key')) {
                    // Try to find JSON objects containing beat data
                    const jsonMatches = content.match(/\{[^{}]*(?:bpm|key)[^{}]*\}/gi) || [];
                    
                    for (const jsonStr of jsonMatches) {
                      try {
                        const data = JSON.parse(jsonStr);
                        if (data.bpm && !results.bpm) results.bpm = parseInt(data.bpm);
                        if (data.key && !results.key) results.key = data.key;
                      } catch (e) {
                        // Try regex extraction from non-JSON data
                        const bpmMatch = jsonStr.match(/bpm["\s:]*(\d+)/i);
                        const keyMatch = jsonStr.match(/key["\s:]*["']?([A-G][#♯b♭]?\s*(?:major|minor|maj|min|m)?)/i);
                        
                        if (bpmMatch && !results.bpm) results.bpm = parseInt(bpmMatch[1]);
                        if (keyMatch && !results.key) results.key = keyMatch[1];
                      }
                    }
                  }
                }
                
                return results;
              } catch (e) {
                return { bpm: null, key: null, error: e.message };
              }
            });

            if (scriptData.bpm && !bpm) bpm = scriptData.bpm;
            if (scriptData.key && !key) key = scriptData.key;
          }

          // Strategy 4: Try API endpoint if we can extract beat ID
          if (!bpm || !key) {
            const beatId = beatstarsLink.match(/-(\d+)(?:\?|$)/);
            if (beatId) {
              console.log(`Trying direct API call for beat ID: ${beatId[1]}`);
              
              try {
                const apiResponse = await page.evaluate(async (id) => {
                  try {
                    const response = await fetch(`https://api.beatstars.com/beat/${id}`, {
                      headers: {
                        'Accept': 'application/json',
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                      }
                    });
                    
                    if (response.ok) {
                      const data = await response.json();
                      return { 
                        bpm: data.bpm || null, 
                        key: data.key || null,
                        success: true 
                      };
                    }
                  } catch (e) {
                    return { bpm: null, key: null, success: false, error: e.message };
                  }
                  return { bpm: null, key: null, success: false };
                }, beatId[1]);

                if (apiResponse.success) {
                  if (apiResponse.bpm && !bpm) bpm = apiResponse.bpm;
                  if (apiResponse.key && !key) key = apiResponse.key;
                  console.log('API response:', apiResponse);
                }
              } catch (apiError) {
                console.log('API call failed:', apiError.message);
              }
            }
          }

          console.log(`Scraped BeatStars data: BPM=${bpm}, Key=${key}`);
          return { bpm, key };

        } catch (navigationError) {
          console.error(`Navigation error on attempt ${attempt}:`, navigationError.message);
          if (attempt === maxRetries) {
            throw navigationError;
          }
          continue; // Try again
        }

      } catch (error) {
        console.error(`Attempt ${attempt} failed:`, error.message);
        
        if (attempt === maxRetries) {
          console.error('All retry attempts failed');
          return { bpm: null, key: null, scrapingFailed: true };
        }
        
        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
        
      } finally {
        if (browser) {
          try {
            await browser.close();
          } catch (closeError) {
            console.error('Error closing browser:', closeError.message);
          }
          browser = null;
        }
      }
    }

    return { bpm: null, key: null, scrapingFailed: true };
  }

  generateTags(artistNames) {
    if (!artistNames) return [];
    
    // Split artist names by comma and clean them
    const artists = artistNames.split(',').map(name => name.trim().toLowerCase());
    
    const generatedTags = [];
    
    // Add hashtags for each artist
    artists.forEach(artist => {
      generatedTags.push(`#${artist.replace(/\s+/g, '')}`);
    });
    
    // Add various permutations
    artists.forEach(artist => {
      const cleanArtist = artist.replace(/\s+/g, '');
      generatedTags.push(`${cleanArtist} type beat`);
      generatedTags.push(`free ${cleanArtist} type beat`);
    });
    
    // Add additional generic generatedTags
    const genericTags = [
      'type beat',
      'free type beat',
      'beats',
      'instrumental',
      'rap beat',
      'trap beat',
      'hip hop beat',
      'free beat',
      'hard beat',
      'fire beat'
    ];
    
    generatedTags.push(...genericTags);
    
    // Remove duplicates and return
    return [...new Set(generatedTags)];
  }


  // Keep the old formatDescription method for backward compatibility if needed
  formatDescription(baseDescription, instagramLink, beatstarsLink) {
    let description = baseDescription;
    
    description += '\n\n━━━━━━━━━━━━━━━━━━━━━━\n';
    
    if (beatstarsLink) {
      description += `💰 Purchase (Untagged): ${beatstarsLink}\n`;
    }
    
    if (instagramLink) {
      description += `📸 Follow me: ${instagramLink}\n`;
    }
    
    description += '\n━━━━━━━━━━━━━━━━━━━━━━\n';
    description += '🔥 More fire beats coming soon!\n';
    description += '🔔 Subscribe and turn on notifications\n';
    description += '💬 Leave a comment if you vibe with this beat\n\n';
    description += '#typebeat #beats #instrumental #music #producer';
    
    return description;
  }
}

module.exports = MetadataGenerator;