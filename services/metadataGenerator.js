// ==========================================
// Enhanced metadataGenerator.js with Last.fm API Integration
// ==========================================

const puppeteer = require('puppeteer');
const axios = require('axios');

class MetadataGenerator {
  constructor() {
    this.lastfmApiKey = process.env.LASTFM_API_KEY;
  }

  // Search for similar artists using Last.fm API
  async getSimilarArtistsLastfm(artistName, limit = 5) {
    if (!this.lastfmApiKey) {
      console.warn('Last.fm API key not found. Skipping Last.fm integration.');
      return [];
    }

    try {
      const response = await axios.get('https://ws.audioscrobbler.com/2.0/', {
        params: {
          method: 'artist.getsimilar',
          artist: artistName,
          api_key: this.lastfmApiKey,
          format: 'json',
          limit: limit
        }
      });

      if (response.data.similarartists && response.data.similarartists.artist) {
        const artists = Array.isArray(response.data.similarartists.artist) 
          ? response.data.similarartists.artist 
          : [response.data.similarartists.artist];
        
        return artists.map(artist => artist.name);
      }
      return [];
    } catch (error) {
      console.error(`Error getting similar artists from Last.fm for ${artistName}:`, error.message);
      return [];
    }
  }

  // Search for similar artists using ListenBrainz Labs API (no auth required!)
  async getSimilarArtistsListenBrainz(artistName, limit = 5) {
    try {
      // First, we need to get the MusicBrainz ID for the artist
      const searchResponse = await axios.get('https://musicbrainz.org/ws/2/artist/', {
        params: {
          query: artistName,
          fmt: 'json',
          limit: 1
        },
        headers: {
          'User-Agent': 'TypeBeatGenerator/1.0 (contact@example.com)'
        }
      });

      if (searchResponse.data.artists && searchResponse.data.artists.length > 0) {
        const mbid = searchResponse.data.artists[0].id;
        console.log(`Found MusicBrainz ID for ${artistName}: ${mbid}`);

        // Now get similar artists from ListenBrainz
        const similarResponse = await axios.get(`https://labs.api.listenbrainz.org/similar-artists/json`, {
          params: {
            artist_mbid: mbid,
            algorithm: 'session_based_days_7500_session_300_contribution_5_threshold_10_limit_100_filter_True_skip_30'
          }
        });

        if (similarResponse.data && Array.isArray(similarResponse.data)) {
          return similarResponse.data
            .slice(0, limit)
            .map(item => item.artist_name || item.name);
        }
      }
      return [];
    } catch (error) {
      console.error(`Error getting similar artists from ListenBrainz for ${artistName}:`, error.message);
      return [];
    }
  }

  // Search for similar artists using Deezer API (no auth required!)
  async getSimilarArtistsDeezer(artistName, limit = 5) {
    try {
      // Search for artist
      const searchResponse = await axios.get('https://api.deezer.com/search/artist', {
        params: {
          q: artistName,
          limit: 1
        }
      });

      if (searchResponse.data.data && searchResponse.data.data.length > 0) {
        const artistId = searchResponse.data.data[0].id;
        console.log(`Found Deezer artist ID for ${artistName}: ${artistId}`);

        // Get related artists
        const relatedResponse = await axios.get(`https://api.deezer.com/artist/${artistId}/related`, {
          params: {
            limit: limit
          }
        });

        if (relatedResponse.data.data && Array.isArray(relatedResponse.data.data)) {
          return relatedResponse.data.data.map(artist => artist.name);
        }
      }
      return [];
    } catch (error) {
      console.error(`Error getting similar artists from Deezer for ${artistName}:`, error.message);
      return [];
    }
  }

  // Get expanded artist list using multiple APIs with fallbacks
  // Ensures even distribution of similar artists across all input artists
  async getExpandedArtistList(inputArtists, targetCount = 10) {
    const artists = inputArtists.split(',').map(name => name.trim()).filter(Boolean);
    const expandedArtists = new Set(artists.map(a => a.toLowerCase()));
    
    console.log(`Expanding artist list from ${artists.length} to ${targetCount} artists...`);

    // Calculate how many similar artists to fetch per input artist
    const remainingSlots = targetCount - artists.length;
    const artistsPerInput = Math.floor(remainingSlots / artists.length);
    const extraSlots = remainingSlots % artists.length;
    
    console.log(`Will fetch ${artistsPerInput} similar artists per input artist (${extraSlots} artists will get +1 extra)`);

    try {
      // For each input artist, find similar artists with balanced distribution
      for (let i = 0; i < artists.length; i++) {
        const artist = artists[i];
        
        // Calculate how many to fetch for this artist
        // First N artists get the extra slot
        const limitForThisArtist = artistsPerInput + (i < extraSlots ? 1 : 0);
        
        if (limitForThisArtist === 0) {
          console.log(`Skipping similar artist search for ${artist} (target count reached)`);
          continue;
        }

        console.log(`Fetching ${limitForThisArtist} similar artists for ${artist}...`);
        
        let similarArtists = [];

        // Try Last.fm first (most reliable and fast)
        if (this.lastfmApiKey) {
          console.log(`Trying Last.fm for ${artist}...`);
          similarArtists = await this.getSimilarArtistsLastfm(artist, limitForThisArtist);
        }

        // Fallback to Deezer if Last.fm didn't work
        if (similarArtists.length === 0) {
          console.log(`Trying Deezer for ${artist}...`);
          similarArtists = await this.getSimilarArtistsDeezer(artist, limitForThisArtist);
        }

        // Fallback to ListenBrainz if both failed
        if (similarArtists.length === 0) {
          console.log(`Trying ListenBrainz for ${artist}...`);
          similarArtists = await this.getSimilarArtistsListenBrainz(artist, limitForThisArtist);
        }

        if (similarArtists.length > 0) {
          console.log(`Found ${similarArtists.length} similar artists for ${artist}:`, similarArtists.join(', '));
          
          // Add only the calculated number of artists
          let added = 0;
          for (const name of similarArtists) {
            if (added >= limitForThisArtist) break;
            const lowerName = name.toLowerCase();
            if (!expandedArtists.has(lowerName)) {
              expandedArtists.add(lowerName);
              added++;
            }
          }
          console.log(`Added ${added}/${limitForThisArtist} new artists from ${artist}`);
        } else {
          console.log(`No similar artists found for ${artist}`);
        }
        
        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 250));
      }
    } catch (error) {
      console.error('Error expanding artist list:', error.message);
    }

    const result = Array.from(expandedArtists);
    console.log(`Final artist list (${result.length}):`, result.join(', '));
    console.log(`Distribution: ${artists.length} input + ${result.length - artists.length} similar = ${result.length} total`);
    return result;
  }

  // Enhanced tag generation with similar artists
  async generateEnhancedTags(inputArtists, genre = null) {
    // Get expanded artist list including similar artists
    const allArtists = await this.getExpandedArtistList(inputArtists, 10);
    
    const tags = new Set();
    const currentYear = new Date().getFullYear();
    const lastYear = currentYear - 1;

    // Generate tags for each artist
    allArtists.forEach(artist => {
      const cleanArtist = artist.replace(/\s+/g, '').toLowerCase();
      
      // Core artist tags
      tags.add(`${artist} type beat`);
      tags.add(`${cleanArtist} type beat`);
      tags.add(`free ${artist} type beat`);
      tags.add(`${artist} ${currentYear} type beat`);
      tags.add(`${artist} type beat ${currentYear}`);
      tags.add(`${artist} type beat free`);
      
      // Add hashtag version
      tags.add(`#${cleanArtist}`);
    });

    // Generate combination tags (top artists only)
    const topArtists = allArtists.slice(0, 5);
    for (let i = 0; i < topArtists.length; i++) {
      for (let j = i + 1; j < Math.min(i + 3, topArtists.length); j++) {
        const clean1 = topArtists[i].replace(/\s+/g, '').toLowerCase();
        const clean2 = topArtists[j].replace(/\s+/g, '').toLowerCase();
        tags.add(`${clean1} x ${clean2} type beat`);
        tags.add(`${topArtists[i]} x ${topArtists[j]} type beat`);
      }
    }

    // Genre-specific tags
    if (genre) {
      tags.add(`${genre} type beat`);
      tags.add(`${genre} beat ${currentYear}`);
      tags.add(`free ${genre} beat`);
      
      topArtists.slice(0, 3).forEach(artist => {
        tags.add(`${artist} ${genre} type beat`);
      });
    }

    // Generic tags
    const genericTags = [
      'type beat',
      `type beat ${currentYear}`,
      `type beat ${lastYear}`,
      'free type beat',
      'beats',
      'instrumental',
      'rap beat',
      'trap beat',
      'hip hop beat',
      'free beat',
      'hard beat',
      'fire beat',
      'beat free',
      `beat ${currentYear}`,
      'untagged beat',
      'free instrumental'
    ];
    
    genericTags.forEach(tag => tags.add(tag));

    return Array.from(tags);
  }

  // Generate SEO-optimized description paragraph
  generateSEOParagraph(tags, maxTags = 50) {
    // Take first maxTags and join with commas
    const selectedTags = tags.slice(0, maxTags);
    return selectedTags.join(', ');
  }

async generateMetadata({ beatTitle, tags, genre, email, instagramLink, beatstarsLink, manualBpm, manualKey }) {
  console.log('Generating metadata with provided values:', { 
    beatTitle, 
    tags, 
    genre,
    email,
    manualBpm, 
    manualKey 
  });
  
  const bpm = manualBpm;
  const key = manualKey;

  const title = beatTitle;

  let description = '';
  description += email 
    ? `mail - ${email}\n`
    : 'mail - placeholder@gmail.com\n';
    
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

  const allTags = await this.generateEnhancedTags(tags, genre);
  const seoParagraph = this.generateSEOParagraph(allTags, 50);
  
  description += `${seoParagraph}`;

  return {
    title,
    description,
    tags: allTags.slice(0, 15) 
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
        
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        await page.setExtraHTTPHeaders({
          'Accept-Language': 'en-US,en;q=0.9'
        });
        
        await page.setViewport({ width: 1280, height: 800 });

        page.on('error', (err) => {
          console.error('Page error:', err.message);
        });

        page.on('pageerror', (err) => {
          console.error('Page script error:', err.message);
        });

        try {
          await page.goto(beatstarsLink, { 
            waitUntil: ['load', 'domcontentloaded'],
            timeout: 45000 
          });

          await page.waitForTimeout(5000);

          const pageTitle = await page.title();
          console.log(`Page loaded: ${pageTitle}`);

          if (!pageTitle || pageTitle.toLowerCase().includes('error')) {
            throw new Error('Page failed to load properly');
          }

          let bpm = null;
          let key = null;

          const selectorData = await page.evaluate(() => {
            try {
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

          if (!bpm || !key) {
            const textData = await page.evaluate(() => {
              try {
                const allText = document.body.innerText || '';
                
                let foundBpm = null;
                let foundKey = null;

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

                const keyPatterns = [
                  /key\s*:?\s*([A-G][#♯b♭]?\s*(?:major|minor|maj|min|m)?)/gi,
                  /([A-G][#♯b♭]?)\s+(major|minor|maj|min)/gi,
                  /([A-G][#♯b♭]?m)\b/g
                ];

                for (const pattern of keyPatterns) {
                  const matches = [...allText.matchAll(pattern)];
                  if (matches.length > 0) {
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

          if ((!bpm || !key)) {
            console.log('Trying script tag and API data analysis...');
            
            const scriptData = await page.evaluate(() => {
              try {
                let results = { bpm: null, key: null };
                
                if (window.__INITIAL_STATE__ || window.__REDUX_STORE__ || window.__NEXT_DATA__) {
                  const stateData = window.__INITIAL_STATE__ || window.__REDUX_STORE__ || window.__NEXT_DATA__;
                  const stateStr = JSON.stringify(stateData);
                  
                  const bpmMatch = stateStr.match(/"bpm"\s*:\s*(\d+)/i);
                  const keyMatch = stateStr.match(/"key"\s*:\s*"([^"]+)"/i);
                  
                  if (bpmMatch) results.bpm = parseInt(bpmMatch[1]);
                  if (keyMatch) results.key = keyMatch[1];
                }
                
                const scripts = Array.from(document.querySelectorAll('script'));
                for (const script of scripts) {
                  const content = script.textContent || '';
                  
                  if (content.includes('bpm') || content.includes('key')) {
                    const jsonMatches = content.match(/\{[^{}]*(?:bpm|key)[^{}]*\}/gi) || [];
                    
                    for (const jsonStr of jsonMatches) {
                      try {
                        const data = JSON.parse(jsonStr);
                        if (data.bpm && !results.bpm) results.bpm = parseInt(data.bpm);
                        if (data.key && !results.key) results.key = data.key;
                      } catch (e) {
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
          continue;
        }

      } catch (error) {
        console.error(`Attempt ${attempt} failed:`, error.message);
        
        if (attempt === maxRetries) {
          console.error('All retry attempts failed');
          return { bpm: null, key: null, scrapingFailed: true };
        }
        
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
    
    const artists = artistNames.split(',').map(name => name.trim().toLowerCase());
    
    const generatedTags = [];
    
    artists.forEach(artist => {
      generatedTags.push(`#${artist.replace(/\s+/g, '')}`);
    });
    
    artists.forEach(artist => {
      const cleanArtist = artist.replace(/\s+/g, '');
      generatedTags.push(`${cleanArtist} type beat`);
      generatedTags.push(`free ${cleanArtist} type beat`);
    });
    
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
    
    return [...new Set(generatedTags)];
  }

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