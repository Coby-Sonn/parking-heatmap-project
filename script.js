// =================================================================
// 1. CONFIGURATION 
// =================================================================

const SUPABASE_URL = 'https://shmtkxshrsrkwovjokqa.supabase.co'; 
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNobXRreHNocnNya3dvdmpva3FhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIyNDQ4MjAsImV4cCI6MjA3NzgyMDgyMH0.oENVmyU00Uy2N6gxir54yu4T0Jw_Jay2tITeQW3QfqE'; 

const TABLE_NAME = 'parking_consistency_data';
const SLOTS_PER_DAY = 72; // 72 slots of 20 minutes each
// DAYS: [Sun(0), Mon(1), Tue(2), Wed(3), Thu(4), Fri(5), Sat(6)].
const DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת']; 

// =================================================================
// 2. HELPER FUNCTIONS (LOCAL TIME)
// =================================================================

/**
 * Calculates the index of the 20-minute time slot (0 to 71) using LOCAL time.
 * ✅ FIX: Now uses getHours() / getMinutes() instead of UTC.
 */
function getLocalTimeSlotIndex(date) {
    const hours = date.getHours();
    const minutes = date.getMinutes();
    return Math.floor(((hours * 60) + minutes) / 20);
}

/**
 * Returns HH:MM string for display
 */
function getTimeString(slot) {
    const totalMinutes = slot * 20;
    const hour = String(Math.floor(totalMinutes / 60)).padStart(2, '0');
    const minute = String(totalMinutes % 60).padStart(2, '0');
    return `${hour}:${minute}`;
}

// =================================================================
// 3. DATA FETCHING AND PROCESSING 
// =================================================================

async function loadAndProcessData() {
    const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    const HEATMAP_CONTAINER = document.getElementById('heatmap-container');

    HEATMAP_CONTAINER.innerHTML = '<p>טוען נתוני חניה...</p>';
    
    // --- 1. Current Day and Slot (Local Time) ---
    const now = new Date();
    const currentDay = now.getDay(); // ✅ FIX: local day
    const currentSlot = Math.ceil(((now.getHours() * 60) + now.getMinutes()) / 20); // ✅ FIX: local slot
    // -----------------------------------------------------------

    // 2. Fetch Data
    const { data, error } = await supabase
        .from(TABLE_NAME)
        .select('checked_at, lot_name, api_status_code')
        .order('checked_at', { ascending: true }); 

    if (error) {
        console.error('Error fetching data:', error);
        HEATMAP_CONTAINER.innerHTML = `<p style="color: red;">שגיאה בטעינת נתונים: ${error.message}. בדוק את הקונסול.</p>`;
        return;
    }
    
    if (!data || data.length === 0) {
        HEATMAP_CONTAINER.innerHTML = `<p>לא נמצאו נתונים בטבלה. ודא נכונות הטבלה והמפתח.</p>`;
        return;
    }

    // 3. Aggregate Data (LOCAL TIME)
    const aggregatedData = {};
    const uniqueLots = new Set();
    
    data.forEach(row => {
        // ✅ FIXED: convert UTC timestamp to LOCAL time properly
        const utcDate = new Date(row.checked_at);
        const date = new Date(utcDate.getTime() + (utcDate.getTimezoneOffset() * 60000));
        
        const dayOfWeek = date.getDay(); 
        const timeSlot = getLocalTimeSlotIndex(date);
        
        const lotName = row.lot_name;
        const code = row.api_status_code; 

        uniqueLots.add(lotName);

        if (!aggregatedData[lotName]) {
            aggregatedData[lotName] = Array(DAYS.length)
                .fill(0)
                .map(() => Array(SLOTS_PER_DAY).fill(0));
        }

        aggregatedData[lotName][dayOfWeek][timeSlot] = code;
    });

    // 4. Interpolate
    const interpolatedData = interpolateData(aggregatedData, uniqueLots, currentDay, currentSlot);

    // 5. Sort and Render
    const sortedLots = Array.from(uniqueLots).sort();
    renderHeatmap(interpolatedData, sortedLots);
}

/**
 * Fills in missing 20-minute slots with the last known status code,
 * up to the current LOCAL time.
 */
function interpolateData(data, lots, currentDay, currentSlot) {
    const interpolated = {};

    for (const lotName of lots) {
        interpolated[lotName] = {};
        
        for (let day = 0; day < DAYS.length; day++) {
            const dayData = data[lotName][day];
            const isTodayLocal = (day === currentDay);
            
            if (dayData) {
                interpolated[lotName][day] = [...dayData]; 
                let lastStatus = 0;

                for (let slot = 0; slot < SLOTS_PER_DAY; slot++) {
                    if (isTodayLocal && slot >= currentSlot) {
                        interpolated[lotName][day][slot] = 0; 
                        continue; 
                    }

                    const currentStatus = dayData[slot];
                    if (currentStatus > 0) {
                        lastStatus = currentStatus;
                    } else if (lastStatus > 0) {
                        interpolated[lotName][day][slot] = lastStatus;
                    }
                }
            } else {
                interpolated[lotName][day] = Array(SLOTS_PER_DAY).fill(0);
            }
        }
    }
    return interpolated;
}

// =================================================================
// 4. HEATMAP RENDERING
// =================================================================

function getStatusText(code) {
    switch(code) {
        case 1: return "1=פנוי";
        case 2: return "2=כמעט מלא";
        case 3: return "3=מלא";
        case 4: return "4=לא ידוע/כישלון";
        case 0: return "אין נתונים";
        default: return `סטטוס לא ידוע (${code})`; 
    }
}

function renderHeatmap(data, lots) {
    const HEATMAP_CONTAINER = document.getElementById('heatmap-container'); 
    HEATMAP_CONTAINER.innerHTML = '';
    
    const legend = `
        <div class="legend">
            <h3>מקרא</h3>
            <span class="status-1">1=פנוי</span>
            <span class="status-2">2=כמעט מלא</span>
            <span class="status-3">3=מלא</span>
            <span class="status-4">4=לא ידוע/כישלון</span>
            <span class="status-empty">ריק=אין נתונים</span>
        </div>
        <hr>
    `;
    HEATMAP_CONTAINER.innerHTML = legend;

    lots.forEach(lotName => {
        const lotDiv = document.createElement('div');
        lotDiv.className = 'lot-heatmap';
        lotDiv.innerHTML = `<h2>${lotName}</h2>`;

        const gridDiv = document.createElement('div');
        gridDiv.className = 'grid-container';
        gridDiv.style.gridTemplateColumns = `60px repeat(${SLOTS_PER_DAY}, 1fr)`; 
        
        gridDiv.innerHTML += `<div class="time-label time-label-header">יום / שעה</div>`;
        for (let slot = 0; slot < SLOTS_PER_DAY; slot += 6) { 
            const timeString = getTimeString(slot);
            const span = document.createElement('span');
            span.className = 'time-label time-label-header';
            span.style.gridColumn = `span 6`;
            span.textContent = timeString;
            gridDiv.appendChild(span);
        }

        for (let day = 0; day < DAYS.length; day++) {
            const dayName = DAYS[day];
            const dayData = data[lotName][day] || Array(SLOTS_PER_DAY).fill(0);

            gridDiv.innerHTML += `<div class="time-label">${dayName}</div>`;

            for (let slot = 0; slot < SLOTS_PER_DAY; slot++) {
                const status = dayData[slot];
                const statusText = getStatusText(status);
                const timeString = getTimeString(slot);
                let className = `status-${status}`;
                if (status === 0) className = 'status-empty';

                gridDiv.innerHTML += `
                    <div class="heatmap-cell ${className}"
                         title="${lotName} - ${dayName} ${timeString} - סטטוס: ${statusText}"></div>`;
            }
        }

        lotDiv.appendChild(gridDiv);
        HEATMAP_CONTAINER.appendChild(lotDiv);
    });
}

// =================================================================
// 5. INITIALIZATION
// =================================================================

document.addEventListener('DOMContentLoaded', () => {
    loadAndProcessData();
});