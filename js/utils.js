/* ========================================================================
 * utils.js — Clean Hybrid Version (SMART + PREDICTION-ONLY Support)
 * ======================================================================*/

/* ---------------------------------------------------------------
 * 1. CONFIG
 * -------------------------------------------------------------*/
const CONFIG = {
    SUPABASE_URL: 'https://shmtkxshrsrkwovjokqa.supabase.co',
    SUPABASE_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNobXRreHNocnNya3dvdmpva3FhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIyNDQ4MjAsImV4cCI6MjA3NzgyMDgyMH0.oENVmyU00Uy2N6gxir54yu4T0Jw_Jay2tITeQW3QfqE',
    TABLE_NAME: 'parking_consistency_data',
    HEATMAP_VIEW_NAME: 'parking_heatmap_3week',
    SLOTS_PER_DAY: 72, // 20-min slots
    DAYS: ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'],
    BATCH_SIZE: 1000,
    MAX_RETRIES: 3
};

// Configurable interpolation behavior
window.__HEATMAP_CONFIG = window.__HEATMAP_CONFIG || {};
window.__HEATMAP_CONFIG.minSamplesToInterpolate =
    window.__HEATMAP_CONFIG.minSamplesToInterpolate ?? 3;

/* ---------------------------------------------------------------
 * 2. TIME HELPERS
 * -------------------------------------------------------------*/
const HEATMAP_TIMEZONE = 'Asia/Jerusalem';

function getLocalDayHourMinute(utcString) {
    const utcDate = new Date(utcString);

    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: HEATMAP_TIMEZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    }).formatToParts(utcDate);

    const map = {};
    for (const p of parts) {
        if (p.type !== 'literal') map[p.type] = parseInt(p.value, 10);
    }

    const date = new Date(map.year, map.month - 1, map.day, map.hour, map.minute);

    return {
        day: date.getDay(),
        hour: map.hour,
        minute: map.minute
    };
}

function getSlot(hour, minute) {
    return Math.floor(((hour * 60) + minute) / 20);
}

function getTimeLabel(slot) {
    const mins = slot * 20;
    const h = String(Math.floor(mins / 60)).padStart(2, '0');
    const m = String(mins % 60).padStart(2, '0');
    return `${h}:${m}`;
}

window.getLocalDayHourMinute = getLocalDayHourMinute;
window.getSlot = getSlot;
window.getTimeLabel = getTimeLabel;

/* ---------------------------------------------------------------
 * 3. SUPABASE CLIENT
 * -------------------------------------------------------------*/
let supabaseClient = null;

function getSupabaseClient() {
    if (!supabaseClient && window.supabase) {
        supabaseClient = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY);
    }
    return supabaseClient;
}

/* ---------------------------------------------------------------
 * 4. DATA FETCHING
 * -------------------------------------------------------------*/
class DataFetcher {
    constructor() {
        this.supabase = getSupabaseClient();
    }

    async testConnection() {
        try {
            const { error } = await this.supabase
                .from(CONFIG.TABLE_NAME)
                .select('lot_name')
                .limit(1);

            if (error) throw error;
            return true;
        } catch (err) {
            console.error('❌ Supabase connection error:', err.message);
            return false;
        }
    }

    async fetchLotData(lotName, daysBack = 7) {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - daysBack);

        let rows = [];
        let offset = 0;
        let hasMore = true;
        let attempts = 0;

        while (hasMore && attempts < CONFIG.MAX_RETRIES) {
            try {
                const { data, error } = await this.supabase
                    .from(CONFIG.TABLE_NAME)
                    .select('checked_at, api_status_code')
                    .eq('lot_name', lotName)
                    .gte('checked_at', cutoff.toISOString())
                    .order('checked_at', { ascending: true })
                    .range(offset, offset + CONFIG.BATCH_SIZE - 1);

                if (error) throw error;

                if (data.length > 0) {
                    rows.push(...data);
                    offset += CONFIG.BATCH_SIZE;
                    hasMore = data.length === CONFIG.BATCH_SIZE;
                } else {
                    hasMore = false;
                }
            } catch (err) {
                attempts++;
                console.warn('⚠️ Raw fetch attempt failed:', err.message);
                if (attempts >= CONFIG.MAX_RETRIES) throw err;
            }
        }

        return rows;
    }

    async fetchLotHistoricalData(lotName) {
        const { data, error } = await this.supabase
            .from(CONFIG.HEATMAP_VIEW_NAME)
            .select('weekday_index, slot_index, avg_status_code, sample_count')
            .eq('lot_name', lotName);

        if (error) {
            console.error('❌ HIST fetch error:', error.message);
            throw error;
        }

        return data || [];
    }
}

/* ---------------------------------------------------------------
 * 5. DATA PROCESSING
 * -------------------------------------------------------------*/
class DataProcessor {

    createEmptyHeatmap(lotName) {
        const now = new Date();
        const loc = getLocalDayHourMinute(now.toISOString());
        const curDay = loc.day;
        const curSlot = getSlot(loc.hour, loc.minute);

        return {
            lotName,
            rawData: Array(7).fill(0).map(() => Array(CONFIG.SLOTS_PER_DAY).fill(0)),
            interpolated: Array(7).fill(0).map(() => Array(CONFIG.SLOTS_PER_DAY).fill(0)),
            dayDistribution: [0, 0, 0, 0, 0, 0, 0],
            totalRecords: 0,
            processedAt: now.toISOString(),
            currentDay: curDay,
            currentSlot: curSlot
        };
    }

    processHeatmapData(rawData, lotName) {
        const now = new Date();
        const loc = getLocalDayHourMinute(now.toISOString());
        const curDay = loc.day;
        const curSlot = getSlot(loc.hour, loc.minute);

        const grid = Array(7).fill(0).map(() => Array(CONFIG.SLOTS_PER_DAY).fill(0));
        const dist = [0, 0, 0, 0, 0, 0, 0];

        try { rawData.sort((a, b) => new Date(a.checked_at) - new Date(b.checked_at)); }
        catch (_) { }

        rawData.forEach(r => {
            const { day, hour, minute } = getLocalDayHourMinute(r.checked_at);
            const slot = getSlot(hour, minute);

            if (day < 0 || day > 6 || slot < 0 || slot >= CONFIG.SLOTS_PER_DAY) return;

            dist[day]++;

            if (r.api_status_code > 0) {
                grid[day][slot] = r.api_status_code;
            }
        });

        return {
            lotName,
            rawData: grid,
            interpolated: this.interpolateData(grid),
            dayDistribution: dist,
            totalRecords: rawData.length,
            processedAt: now.toISOString(),
            currentDay: curDay,
            currentSlot: curSlot
        };
    }

    processHistoricalHeatmapData(rows, lotName) {
        const now = new Date();
        const loc = getLocalDayHourMinute(now.toISOString());
        const curDay = loc.day;
        const curSlot = getSlot(loc.hour, loc.minute);

        const grid = Array(7).fill(0).map(() => Array(CONFIG.SLOTS_PER_DAY).fill(0));
        const dist = [0, 0, 0, 0, 0, 0, 0];

        rows.forEach(r => {
            const d = r.weekday_index;
            const s = r.slot_index;
            const avg = Number(r.avg_status_code ?? 0);
            const samples = Number(r.sample_count ?? 0);

            if (d < 0 || d > 6 || s < 0 || s >= CONFIG.SLOTS_PER_DAY) return;

            dist[d] += samples;

            if (samples < 3) {
                grid[d][s] = 0; // Mark as needing interpolation
            } else {
                let rounded = Math.round(avg);
                if (rounded < 1 || rounded > 4) rounded = 4;
                grid[d][s] = rounded;
            }
        });

        // Apply interpolation to fill missing/insufficient slots
        const interpolated = this.interpolateData(grid);

        return {
            lotName,
            rawData: grid,
            interpolated: interpolated,
            dayDistribution: dist,
            totalRecords: rows.length,
            processedAt: now.toISOString(),
            currentDay: curDay,
            currentSlot: curSlot
        };
    }

    /* --------------------------
     * SMART COMBINER
     * ------------------------*/
    combineSmartHeatmap(rawP, histP) {
        const smart = Array(7).fill(0).map(() => Array(CONFIG.SLOTS_PER_DAY).fill(0));

        for (let d = 0; d < 7; d++) {
            for (let s = 0; s < CONFIG.SLOTS_PER_DAY; s++) {
                const rawVal = rawP.rawData[d][s];
                const histVal = histP.interpolated[d][s]; // Use interpolated historical data

                const isFuture =
                    (d > rawP.currentDay) ||
                    (d === rawP.currentDay && s > rawP.currentSlot);

                if (!isFuture) {
                    smart[d][s] = rawVal > 0 ? rawVal :
                        histVal > 0 ? histVal : 0;
                } else {
                    smart[d][s] = histVal > 0 ? histVal : 0;
                }
            }
        }

        return {
            lotName: rawP.lotName,
            rawData: smart,
            interpolated: this.interpolateData(smart),
            dayDistribution: rawP.dayDistribution,
            totalRecords: rawP.totalRecords + histP.totalRecords,
            processedAt: new Date().toISOString(),
            currentDay: rawP.currentDay,
            currentSlot: rawP.currentSlot
        };
    }

    /* --------------------------
     * PREDICTION ONLY MODE
     * ------------------------*/
    buildPredictionOnlyMatrix(histProcessed) {
        // Use the interpolated data for prediction-only mode
        return {
            lotName: histProcessed.lotName,
            rawData: histProcessed.interpolated,
            interpolated: histProcessed.interpolated,
            dayDistribution: histProcessed.dayDistribution,
            totalRecords: histProcessed.totalRecords,
            processedAt: new Date().toISOString(),
            currentDay: histProcessed.currentDay,
            currentSlot: histProcessed.currentSlot
        };
    }

    /* --------------------------
     * INTERPOLATION
     * ------------------------*/
    interpolateData(grid) {
        const out = JSON.parse(JSON.stringify(grid));

        for (let d = 0; d < 7; d++) {
            let last = 0;
            for (let s = 0; s < CONFIG.SLOTS_PER_DAY; s++) {
                if (out[d][s] > 0) last = out[d][s];
                else if (last > 0) out[d][s] = last;
            }
        }

        return out;
    }
}

/* ---------------------------------------------------------------
 * 6. EXPORTS
 * -------------------------------------------------------------*/
window.CONFIG = CONFIG;
window.DataFetcher = DataFetcher;
window.DataProcessor = DataProcessor;
window.getTimeLabel = getTimeLabel;
window.getLocalDayHourMinute = getLocalDayHourMinute;
window.getSlot = getSlot;


/* ========================================================================
 * 7. LOADING MANAGER (needed by heatmap-viewer.js)
 * ======================================================================*/

class LoadingManager {
    static show(container, message = 'טוען נתונים...') {
        if (!container) return;

        container.innerHTML = `
            <div class="loading">
                <lottie-player class="lottie-player"
                               src="lotties/loader.json"
                               background="transparent"
                               speed="1"
                               loop
                               autoplay></lottie-player>
                <p>${message}</p>
            </div>
        `;
    }

    static hide(container) {
        if (!container) return;

        const loading = container.querySelector('.loading');
        if (loading) loading.remove();
    }
}

// EXPOSE globally
window.LoadingManager = LoadingManager;
