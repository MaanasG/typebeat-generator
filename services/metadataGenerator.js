//  metadataGenerator.js with last.fm API 

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

  // similar artists with Deezer API (no auth)
  async getSimilarArtistsDeezer(artistName, limit = 5) {
    try {
      // search for artist
      const searchResponse = await axios.get('https://api.deezer.com/search/artist', {
        params: {
          q: artistName,
          limit: 1
        }
      });

      if (searchResponse.data.data && searchResponse.data.data.length > 0) {
        const artistId = searchResponse.data.data[0].id;
        console.log(`Found Deezer artist ID for ${artistName}: ${artistId}`);

        // get related artists
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

  // api fallbacks
  async getExpandedArtistList(inputArtists, targetCount = 10) {
    const artists = inputArtists.split(',').map(name => name.trim()).filter(Boolean);
    const expandedArtists = new Set(artists.map(a => a.toLowerCase()));
    
    console.log(`Expanding artist list from ${artists.length} to ${targetCount} artists...`);

    // # of similar artists
    const remainingSlots = targetCount - artists.length;
    const artistsPerInput = Math.floor(remainingSlots / artists.length);
    const extraSlots = remainingSlots % artists.length;
    
    console.log(`Will fetch ${artistsPerInput} similar artists per input artist (${extraSlots} artists will get +1 extra)`);

    try {
      // For each input artist, find similar artists with balanced distribution
      for (let i = 0; i < artists.length; i++) {
        const artist = artists[i];
        
        const limitForThisArtist = artistsPerInput + (i < extraSlots ? 1 : 0);
        
        if (limitForThisArtist === 0) {
          console.log(`Skipping similar artist search for ${artist} (target count reached)`);
          continue;
        }

        console.log(`Fetching ${limitForThisArtist} similar artists for ${artist}...`);
        
        let similarArtists = [];

        // lastfm
        if (this.lastfmApiKey) {
          console.log(`Trying Last.fm for ${artist}...`);
          similarArtists = await this.getSimilarArtistsLastfm(artist, limitForThisArtist);
        }

        // deezer fallback
        if (similarArtists.length === 0) {
          console.log(`Trying Deezer for ${artist}...`);
          similarArtists = await this.getSimilarArtistsDeezer(artist, limitForThisArtist);
        }

        // listenbrainz fallback 
        if (similarArtists.length === 0) {
          console.log(`Trying ListenBrainz for ${artist}...`);
          similarArtists = await this.getSimilarArtistsListenBrainz(artist, limitForThisArtist);
        }

        if (similarArtists.length > 0) {
          console.log(`Found ${similarArtists.length} similar artists for ${artist}:`, similarArtists.join(', '));
          
          // add artists
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
        
        // rate limit
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

  async generateEnhancedTags(inputArtists, genre = null) {
    const allArtists = await this.getExpandedArtistList(inputArtists, 10);
    
    const tags = new Set();
    const currentYear = new Date().getFullYear();
    const lastYear = currentYear - 1;

    allArtists.forEach(artist => {
      const cleanArtist = artist.replace(/\s+/g, '').toLowerCase();
      
      tags.add(`${artist} type beat`);
      tags.add(`${cleanArtist} type beat`);
      tags.add(`free ${artist} type beat`);
      tags.add(`${artist} ${currentYear} type beat`);
      tags.add(`${artist} type beat ${currentYear}`);
      tags.add(`${artist} type beat free`);
      
      //add hashtag version
      tags.add(`#${cleanArtist}`);
    });

    const topArtists = allArtists.slice(0, 5);
    for (let i = 0; i < topArtists.length; i++) {
      for (let j = i + 1; j < Math.min(i + 3, topArtists.length); j++) {
        const clean1 = topArtists[i].replace(/\s+/g, '').toLowerCase();
        const clean2 = topArtists[j].replace(/\s+/g, '').toLowerCase();
        tags.add(`${clean1} x ${clean2} type beat`);
        tags.add(`${topArtists[i]} x ${topArtists[j]} type beat`);
      }
    }

    // genre-specific tags
    if (genre) {
      tags.add(`${genre} type beat`);
      tags.add(`${genre} beat ${currentYear}`);
      tags.add(`free ${genre} beat`);
      
      topArtists.slice(0, 3).forEach(artist => {
        tags.add(`${artist} ${genre} type beat`);
      });
    }

    // generics
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

  generateSEOParagraph(tags, maxTags = 50) {
    const selectedTags = tags.slice(0, maxTags);
    return selectedTags.join(', ');
  }

async analyzeAudioFile(audioPath) {
  const { spawn } = require('child_process');
  const path = require('path');
  
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(__dirname, 'analyze_audio.py');
    
    console.log(`Analyzing audio file: ${audioPath}`);
    
    const python = spawn('python3', [scriptPath, audioPath]);
    
    let dataString = '';
    let errorString = '';
    
    python.stdout.on('data', (data) => {
      dataString += data.toString();
    });
    
    python.stderr.on('data', (data) => {
      errorString += data.toString();
    });
    
    python.on('close', (code) => {
      if (code !== 0) {
        console.error(`Python script error output: ${errorString}`);
        reject(new Error(`Audio analysis failed with code ${code}`));
        return;
      }
      
      try {
        const result = JSON.parse(dataString.trim());
        
        if (result.error) {
          console.error(`Audio analysis error: ${result.error}`);
          resolve({ bpm: null, key: null });
        } else {
          console.log(`Audio analysis successful: BPM=${result.bpm}, Key=${result.key}`);
          resolve({ bpm: result.bpm, key: result.key });
        }
      } catch (error) {
        console.error('Failed to parse audio analysis result:', error);
        console.error('Raw output:', dataString);
        reject(new Error('Failed to parse audio analysis result'));
      }
    });
    
    python.on('error', (error) => {
      console.error('Failed to start Python process:', error);
      reject(new Error(`Failed to start audio analysis: ${error.message}`));
    });
  });
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

  async scrapeBeatStarsData(beatstarsLink, maxRetries = 2) {
    let browser;
    let attempt = 0;

    while (attempt < maxRetries) {
      attempt++;
      try {
        if (!beatstarsLink) return { bpm: null, key: null };

        console.log(`\n=== Attempt ${attempt}/${maxRetries} ===`);
        console.log(`Scraping: ${beatstarsLink}`);

        // Use puppeteer-extra with stealth plugin if available, otherwise standard puppeteer
        browser = await puppeteer.launch({
          headless: false, // Try visible mode first for debugging
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled', // Hide automation
            '--disable-features=IsolateOrigins,site-per-process',
            '--window-size=1920,1080'
          ],
          timeout: 60000,
          defaultViewport: null
        });

        const page = await browser.newPage();

        // More realistic browser fingerprint
        await page.evaluateOnNewDocument(() => {
          // Override the navigator.webdriver property
          Object.defineProperty(navigator, 'webdriver', {
            get: () => false,
          });

          // Override the permissions API
          const originalQuery = window.navigator.permissions.query;
          window.navigator.permissions.query = (parameters) => (
            parameters.name === 'notifications' ?
              Promise.resolve({ state: Notification.permission }) :
              originalQuery(parameters)
          );

          // Add chrome object
          window.chrome = {
            runtime: {}
          };
        });

        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        await page.setExtraHTTPHeaders({
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Encoding': 'gzip, deflate, br',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1'
        });

        let bpm = null;
        let key = null;

        console.log('Navigating to page...');
        
        // Simple navigation with long timeout
        const response = await page.goto(beatstarsLink, {
          waitUntil: 'networkidle0',
          timeout: 60000
        });

        console.log(`Response status: ${response?.status()}`);
        
        // Check if we got blocked
        const pageTitle = await page.title();
        console.log(`Page title: ${pageTitle}`);
        
        const url = page.url();
        console.log(`Current URL: ${url}`);

        // Take a screenshot to see what we got
        await page.screenshot({ 
          path: `beatstars-loaded-${Date.now()}.png`,
          fullPage: false 
        });
        console.log('Screenshot saved');

        // Check if page has actual content
        const bodyContent = await page.evaluate(() => {
          return {
            hasBody: !!document.body,
            bodyLength: document.body?.innerHTML?.length || 0,
            bodyText: document.body?.innerText?.substring(0, 200) || ''
          };
        });

        console.log('Body content:', bodyContent);

        if (bodyContent.bodyLength < 100) {
          throw new Error('Page appears to be empty or blocked');
        }

        // Wait extra time for Angular to load
        console.log('Waiting for Angular to initialize...');
        await page.waitForTimeout(5000);

        // Check what elements we have
        const elementCheck = await page.evaluate(() => {
          return {
            socialLines: document.querySelectorAll('.social-interaction-line').length,
            labels: document.querySelectorAll('.label').length,
            values: document.querySelectorAll('.value').length,
            allClasses: Array.from(new Set(
              Array.from(document.querySelectorAll('*'))
                .flatMap(el => Array.from(el.classList))
                .filter(cls => cls.includes('bpm') || cls.includes('key') || cls.includes('stat') || cls.includes('profile'))
            )).slice(0, 20)
          };
        });

        console.log('Element check:', elementCheck);

        // Try to find BPM and Key
        console.log('Attempting to scrape beat data...');
        const beatData = await page.evaluate(() => {
          let data = { bpm: null, key: null, debug: [] };
          
          try {
            // Strategy 1: Look for social-interaction-line
            const lines = document.querySelectorAll('.social-interaction-line');
            data.debug.push(`Found ${lines.length} .social-interaction-line elements`);
            
            lines.forEach((line, index) => {
              const label = line.querySelector('.label');
              const value = line.querySelector('.value');
              
              if (label && value) {
                const labelText = label.textContent.trim().toUpperCase();
                const valueText = value.textContent.trim();
                
                data.debug.push(`Line ${index}: "${labelText}" = "${valueText}"`);
                
                if (labelText === 'BPM') {
                  const bpmNum = parseInt(valueText);
                  if (!isNaN(bpmNum) && bpmNum >= 40 && bpmNum <= 200) {
                    data.bpm = bpmNum;
                    data.debug.push(`✓ Found BPM: ${bpmNum}`);
                  }
                } else if (labelText === 'KEY') {
                  if (valueText.match(/^[A-G][#♯b♭]?m?(?:ajor|inor)?$/i)) {
                    data.key = valueText;
                    data.debug.push(`✓ Found Key: ${valueText}`);
                  }
                }
              }
            });

            // Strategy 2: Search all text if nothing found
            if (!data.bpm || !data.key) {
              data.debug.push('Trying fallback text search...');
              
              const allText = document.body.innerText;
              
              // Look for BPM pattern
              const bpmMatch = allText.match(/BPM[:\s]*(\d{2,3})|(\d{2,3})[:\s]*BPM/i);
              if (bpmMatch && !data.bpm) {
                const num = parseInt(bpmMatch[1] || bpmMatch[2]);
                if (num >= 40 && num <= 200) {
                  data.bpm = num;
                  data.debug.push(`✓ Found BPM from text: ${num}`);
                }
              }

              // Look for Key pattern
              const keyMatch = allText.match(/Key[:\s]*([A-G][#♯b♭]?m?(?:ajor|inor)?)/i);
              if (keyMatch && !data.key) {
                data.key = keyMatch[1];
                data.debug.push(`✓ Found Key from text: ${keyMatch[1]}`);
              }
            }

          } catch (e) {
            data.debug.push(`Error: ${e.message}`);
          }
          
          return data;
        });

        console.log('Scraping result:', beatData);
        beatData.debug.forEach(msg => console.log(`  ${msg}`));

        bpm = beatData.bpm;
        key = beatData.key;

        // Keep browser open for 5 seconds so you can see what happened
        console.log('Keeping browser open for 5 seconds for inspection...');
        await page.waitForTimeout(5000);

        await browser.close();
        browser = null;

        if (bpm || key) {
          console.log(`✓ Success! BPM=${bpm}, Key=${key}`);
          return { bpm, key };
        } else {
          throw new Error('Could not find BPM or Key data on page');
        }

      } catch (error) {
        console.error(`✗ Attempt ${attempt} failed:`, error.message);
        
        if (browser) {
          try {
            await browser.close();
          } catch (e) {}
          browser = null;
        }
        
        if (attempt === maxRetries) {
          console.error('=== All attempts failed ===');
          return { bpm: null, key: null, scrapingFailed: true };
        }
        
        console.log(`Waiting before retry...`);
        await new Promise(resolve => setTimeout(resolve, 3000));
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