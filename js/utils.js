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

console.log('✅ Utils loaded successfully');