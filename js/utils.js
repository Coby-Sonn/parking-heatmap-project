// Shared utilities for data fetching and processing

// =================================================================
// 1. CONFIGURATION
// =================================================================
const CONFIG = {
    SUPABASE_URL: 'https://shmtkxshrsrkwovjokqa.supabase.co',
    SUPABASE_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNobXRreHNocnNya3dvdmpva3FhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIyNDQ4MjAsImV4cCI6MjA3NzgyMDgyMH0.oENVmyU00Uy2N6gxir54yu4T0Jw_Jay2tITeQW3QfqE',
    TABLE_NAME: 'parking_consistency_data',
    SLOTS_PER_DAY: 72,
    DAYS: ['ראשון','שני','שלישי','רביעי','חמישי','שישי','שבת'],
    BATCH_SIZE: 1000, // For pagination
    MAX_RETRIES: 3
};

// add near top of utils.js (once): default config for interpolation threshold
window.__HEATMAP_CONFIG = window.__HEATMAP_CONFIG || {};
// change this value to alter when interpolation is allowed (e.g. 3 samples minimum)
window.__HEATMAP_CONFIG.minSamplesToInterpolate = window.__HEATMAP_CONFIG.minSamplesToInterpolate ?? 3;

// ---- Insert near top of utils.js (config + helpers) ----
window.__HEATMAP_CONFIG = window.__HEATMAP_CONFIG || {};
// minimum samples to run the full interpolation algorithm (tune as needed)
window.__HEATMAP_CONFIG.minSamplesForFullInterpolation = window.__HEATMAP_CONFIG.minSamplesForFullInterpolation ?? 3;
// how many neighboring slots to fill around a sparse sample (e.g. 1 = sample slot +/- 1)
window.__HEATMAP_CONFIG.sparseSampleSpread = window.__HEATMAP_CONFIG.sparseSampleSpread ?? 1;
// target timezone for local day mapping
const HEATMAP_TIMEZONE = 'Asia/Jerusalem';

// returns { year, month, day, hour, minute, second, weekdayIndex }
// weekdayIndex: 0 = Sunday, ... 6 = Saturday
function tzPartsForISO(isoString) {
    const date = new Date(isoString);
    const f = new Intl.DateTimeFormat('en-US', {
        timeZone: HEATMAP_TIMEZONE,
        year: 'numeric', month: 'numeric', day: 'numeric',
        hour: 'numeric', minute: 'numeric', second: 'numeric',
        hour12: false,
        weekday: 'short'
    });
    const parts = f.formatToParts(date);
    const map = {};
    for (const p of parts) {
        if (p.type !== 'literal') map[p.type] = p.value;
    }
    const year = Number(map.year);
    const month = Number(map.month);
    const day = Number(map.day);
    const hour = Number(map.hour);
    const minute = Number(map.minute || 0);
    const second = Number(map.second || 0);
    // weekday short e.g. Sun, Mon, Tue
    const wk = (map.weekday || '').toLowerCase();
    const wkMap = { 'sun':0, 'mon':1, 'tue':2, 'wed':3, 'thu':4, 'fri':5, 'sat':6 };
    const weekdayIndex = wkMap[wk] !== undefined ? wkMap[wk] : (new Date(isoString)).getDay();
    return { year, month, day, hour, minute, second, weekdayIndex };
}

// Map a sample (with hour/minute) to a slot index 0..slotsPerDay-1
function mapSampleToSlot(slotsPerDay, sample) {
    const slotsPerHour = slotsPerDay / 24;
    const hour = Number(sample.hour || 0);
    const minute = Number(sample.minute || 0);
    const slotMinutes = 60 / slotsPerHour;
    const intraHour = Math.floor(minute / slotMinutes);
    let slot = (hour * slotsPerHour) + intraHour;
    slot = Math.max(0, Math.min(slotsPerDay - 1, slot));
    return slot;
}

// expose helpers for console debugging
window.__HEATMAP_DEBUG = window.__HEATMAP_DEBUG || {};
window.__HEATMAP_DEBUG.tzPartsForISO = tzPartsForISO;
window.__HEATMAP_DEBUG.mapSampleToSlot = mapSampleToSlot;

// ---- End helpers ----

// =================================================================
// 2. SUPABASE CLIENT
// =================================================================
let supabaseClient = null;

function getSupabaseClient() {
    if (!supabaseClient && window.supabase) {
        supabaseClient = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY);
        console.log('✅ Supabase client initialized');
    }
    return supabaseClient;
}

// =================================================================
// 3. TIMEZONE UTILITIES
// =================================================================
function getLocalDayHourMinute(utcString) {
    const d = new Date(utcString);
    
    // Simple UTC+2 offset for Israel
    const israelOffset = -120; // UTC+2 in minutes
    const localTime = new Date(d.getTime() - (israelOffset * 60 * 1000));

    return {
        day: localTime.getDay(),
        hour: localTime.getHours(),
        minute: localTime.getMinutes(),
    };
}

function getSlot(hour, minute) {
    return Math.floor(((hour * 60) + minute) / 20);
}

function getTimeLabel(slot) {
    const m = slot * 20;
    const h = String(Math.floor(m / 60)).padStart(2,'0');
    const mm = String(m % 60).padStart(2,'0');
    return `${h}:${mm}`;
}

// =================================================================
// 4. DATA FETCHING WITH PAGINATION
// =================================================================
class DataFetcher {
    constructor() {
        this.supabase = getSupabaseClient();
    }

    /**
     * Fetch ALL data for a specific lot with pagination
     * @param {string} lotName - Name of the parking lot
     * @param {number} daysBack - Number of days back to fetch (default: 7)
     * @returns {Promise<Array>} All records for the lot
     */
    async fetchLotData(lotName, daysBack = 7) {
        console.log(`🔄 Fetching data for lot: ${lotName} (${daysBack} days back)`);
        
        if (!this.supabase) {
            throw new Error('Supabase client not initialized');
        }

        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - daysBack);
        const cutoffString = cutoffDate.toISOString();

        let allData = [];
        let hasMore = true;
        let offset = 0;
        let attempts = 0;

        while (hasMore && attempts < CONFIG.MAX_RETRIES) {
            try {
                console.log(`📥 Fetching batch ${Math.floor(offset / CONFIG.BATCH_SIZE) + 1} (offset: ${offset})`);
                
                const { data, error } = await this.supabase
                    .from(CONFIG.TABLE_NAME)
                    .select('checked_at, api_status_code')
                    .eq('lot_name', lotName)
                    .gte('checked_at', cutoffString)
                    .range(offset, offset + CONFIG.BATCH_SIZE - 1)
                    .order('checked_at', { ascending: true });

                if (error) {
                    throw error;
                }

                if (data && data.length > 0) {
                    allData.push(...data);
                    offset += CONFIG.BATCH_SIZE;
                    hasMore = data.length === CONFIG.BATCH_SIZE;
                    
                    console.log(`✅ Batch loaded: ${data.length} records (total: ${allData.length})`);
                } else {
                    hasMore = false;
                    console.log('📭 No more data to fetch');
                }

                attempts = 0; // Reset attempts on success
                
            } catch (error) {
                attempts++;
                console.error(`❌ Error fetching batch (attempt ${attempts}):`, error);
                
                if (attempts >= CONFIG.MAX_RETRIES) {
                    throw new Error(`Failed to fetch data after ${CONFIG.MAX_RETRIES} attempts: ${error.message}`);
                }
                
                // Wait before retry
                await new Promise(resolve => setTimeout(resolve, 1000 * attempts));
            }
        }

        console.log(`🎉 Fetching complete: ${allData.length} total records for ${lotName}`);
        return allData;
    }

    /**
     * Test connection to Supabase
     */
    async testConnection() {
        try {
            const { data, error } = await this.supabase
                .from(CONFIG.TABLE_NAME)
                .select('lot_name')
                .limit(1);

            if (error) throw error;
            
            console.log('✅ Supabase connection test successful');
            return true;
        } catch (error) {
            console.error('❌ Supabase connection test failed:', error);
            return false;
        }
    }
}

// =================================================================
// 5. DATA PROCESSING
// =================================================================
class DataProcessor {
    /**
     * Process raw data into heatmap format
     * @param {Array} rawData - Raw data from database
     * @param {string} lotName - Name of the lot
     * @returns {Object} Processed heatmap data
     */
    processHeatmapData(rawData, lotName) {
        console.log(`🔄 Processing ${rawData.length} records for heatmap...`);
        
        const now = new Date();
        const currentDay = now.getDay();
        const currentSlot = getSlot(now.getHours(), now.getMinutes());

        // Initialize aggregated data structure
        const aggregated = Array(7).fill(0).map(() => Array(CONFIG.SLOTS_PER_DAY).fill(0));
        const dayDistribution = [0, 0, 0, 0, 0, 0, 0];

        // Process each record
        rawData.forEach((row, index) => {
            const { day, hour, minute } = getLocalDayHourMinute(row.checked_at);
            const slot = getSlot(hour, minute);
            
            // Debug logging for first few records
            if (index < 5) {
                console.log(`📝 Record ${index}:`, {
                    originalTime: row.checked_at,
                    convertedDay: day,
                    dayName: ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][day],
                    hebrewDay: CONFIG.DAYS[day],
                    hour,
                    minute,
                    slot,
                    status: row.api_status_code
                });
            }
            
            // Count records per day
            dayDistribution[day]++;
            
            // Store the status code
            if (slot >= 0 && slot < CONFIG.SLOTS_PER_DAY) {
                aggregated[day][slot] = row.api_status_code;
            }
        });

        // Log day distribution
        console.log('📈 Day distribution (records per day):');
        dayDistribution.forEach((count, dayIndex) => {
            console.log(`  ${dayIndex} (${['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][dayIndex]}/Hebrew: ${CONFIG.DAYS[dayIndex]}): ${count} records`);
        });

        // Interpolate missing data
        const interpolated = this.interpolateData(aggregated, currentDay, currentSlot);

        // add these debug logs/exports
        try {
            console.debug('[utils] ✅ Processed heatmap snapshot:', {
                lotName: lotName,
                totalRecords: rawData.length,
                dayDistribution: dayDistribution,      // array of 7 counts
                interpolated: interpolated,            // per-day interpolated arrays (if present)
                rawSample: (aggregated || []).slice(0,10) // first 10 raw records for quick inspection
            });

            // human-friendly day names (index -> hebrew)
            const dayNames = ['ראשון','שני','שלישי','רביעי','חמישי','שישי','שבת'];
            console.debug('[utils] 🔎 Day distribution detail:');
            (dayDistribution || []).forEach((cnt, idx) => {
                console.debug(`  ${idx} (${dayNames[idx]}): ${cnt} records`);
            });

            // expose a snapshot globally for ad-hoc console inspection
            window.__HEATMAP_DEBUG = window.__HEATMAP_DEBUG || {};
            window.__HEATMAP_DEBUG.latest = {
                lotName,
                rawData: aggregated,
                interpolated,
                dayDistribution,
                totalRecords: rawData.length,
                processedAt: new Date().toISOString()
            };
        } catch(e) {
            console.warn('[utils] debug logging failed', e);
        }

        return {
            lotName,
            rawData: aggregated,
            interpolated,
            dayDistribution,
            totalRecords: rawData.length,
            processedAt: new Date().toISOString()
        };
    }

    /**
     * Interpolate missing data points
     */
    interpolateData(aggregated, currentDay, currentSlot) {
        const interpolated = Array(7).fill(0).map(() => Array(CONFIG.SLOTS_PER_DAY).fill(0));
        
        for (let d = 0; d < 7; d++) {
            const arr = aggregated[d];
            interpolated[d] = [...arr];
            let lastValidValue = 0;
            
            for (let s = 0; s < CONFIG.SLOTS_PER_DAY; s++) {
                // Don't interpolate future data
                if (d === currentDay && s >= currentSlot) {
                    interpolated[d][s] = 0;
                    continue;
                }
                
                if (arr[s] > 0) {
                    lastValidValue = arr[s];
                } else if (lastValidValue > 0) {
                    interpolated[d][s] = lastValidValue;
                }
            }
        }
        
        return interpolated;
    }
}

// =================================================================
// 6. ERROR HANDLING
// =================================================================
class ErrorHandler {
    static handle(error, context = '') {
        const errorInfo = {
            message: error.message || 'Unknown error',
            context,
            timestamp: new Date().toISOString(),
            stack: error.stack
        };
        
        console.error('🚨 Error occurred:', errorInfo);
        
        // Return user-friendly message
        if (error.message?.includes('network')) {
            return 'בעיית חיבור לאינטרנט. אנא בדוק את החיבור שלך ונסה שוב.';
        } else if (error.message?.includes('unauthorized')) {
            return 'שגיאת הרשאה. אנא רענן את הדף ונסה שוב.';
        } else if (error.message?.includes('timeout')) {
            return 'הבקשה ארכה יותר מדי. אנא נסה שוב.';
        } else {
            return 'אירעה שגיאה בטעינת הנתונים. אנא נסה שוב מאוחר יותר.';
        }
    }
}

// =================================================================
// 7. LOADING STATES
// =================================================================
class LoadingManager {
    static show(container, message = 'טוען נתונים...') {
        if (!container) return;
        
        container.innerHTML = `
            <div class="loading">
                <div class="spinner"></div>
                <p>${message}</p>
            </div>
        `;
    }
    
    static hide(container) {
        if (!container) return;
        
        const loading = container.querySelector('.loading');
        if (loading) {
            loading.remove();
        }
    }
}

// =================================================================
// 8. EXPORTS
// =================================================================
window.DataFetcher = DataFetcher;
window.DataProcessor = DataProcessor;
window.ErrorHandler = ErrorHandler;
window.LoadingManager = LoadingManager;
window.CONFIG = CONFIG;
window.getLocalDayHourMinute = getLocalDayHourMinute;
window.getSlot = getSlot;
window.getTimeLabel = getTimeLabel;

// Also expose a small debug hint so you can quickly inspect tz conversions from console:
window.__HEATMAP_DEBUG = window.__HEATMAP_DEBUG || {};
window.__HEATMAP_DEBUG.tzPartsForISO = tzPartsForISO;

// --- After processing/interpolating per-day arrays, log highest slot seen per day for debugging ---
/*
  Insert this snippet after processed.interpolated is prepared (or at the end of your processing function)
  so you can see where the latest samples map to.
*/
(function() {
    try {
        if (window.__HEATMAP_DEBUG && window.__HEATMAP_DEBUG.latest) {
            const processed = window.__HEATMAP_DEBUG.latest;
            const slotsPerDay = (typeof CONFIG !== 'undefined' && CONFIG.SLOTS_PER_DAY) ? CONFIG.SLOTS_PER_DAY : (processed.interpolated && processed.interpolated[0] ? processed.interpolated[0].length : 24);
            const maxSlots = (processed.rawData || []).map((dayArr, d) => {
                // rawData likely holds raw records per day, but if structure differs use dayDistribution and processed.interpolated as fallback
                const samples = dayArr || [];
                let maxSlot = -1;
                for (const s of samples) {
                    // expect s.hour and s.minute to be present on samples after conversion
                    const slot = mapSampleToSlot(slotsPerDay, s);
                    if (slot > maxSlot) maxSlot = slot;
                }
                return maxSlot;
            });
            console.debug('[utils] 🔎 Max slot index seen per day (0..N-1):', maxSlots);
            // human-friendly check: convert slot to time label for quick verification
            function slotToTime(slot) {
                if (slot < 0) return 'none';
                const slotsPerHour = slotsPerDay / 24;
                const hour = Math.floor(slot / slotsPerHour);
                const intra = slot % slotsPerHour;
                const minutes = Math.round(intra * (60 / slotsPerHour));
                return `${hour.toString().padStart(2,'0')}:${minutes.toString().padStart(2,'0')}`;
            }
            console.debug('[utils] 🔎 Max slot human times per day:', maxSlots.map(s => slotToTime(s)));
        }
    } catch (e) {
        console.debug('[utils] max-slot debug failed', e);
    }
})();