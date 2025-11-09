// =================================================================
// 1. CONFIGURATION 
// =================================================================

const SUPABASE_URL = 'https://shmtkxshrsrkwovjokqa.supabase.co'; 
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNobXRreHNocnNya3dvdmpva3FhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIyNDQ4MjAsImV4cCI6MjA3NzgyMDgyMH0.oENVmyU00Uy2N6gxir54yu4T0Jw_Jay2tITeQW3QfqE'; 

const TABLE_NAME = 'parking_consistency_data';
const SLOTS_PER_DAY = 72;
// DAYS: [Sun(0), Mon(1), Tue(2), Wed(3), Thu(4), Fri(5), Sat(6)].
const DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת']; 

// =================================================================
// 2. HELPER FUNCTIONS (Using UTC time for aggregation keys)
// =================================================================

/**
 * Calculates the index of the 20-minute time slot (0 to 71) using UTC time.
 */
function getUTCTimeSlotIndex(date) {
    const hours = date.getUTCHours();
    const minutes = date.getUTCMinutes();
    return Math.floor(((hours * 60) + minutes) / 20);
}

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
    
    // --- 1. Current Day and Slot for Interpolation Limit (Local Time) ---
    const now = new Date();
    const currentDay = now.getDay(); // Local Day (0-6)
    const currentSlot = Math.ceil(((now.getHours() * 60) + now.getMinutes()) / 20); // Local Slot (0-72)
    // -----------------------------------------------------------

    // 1. Fetch Data
    const { data, error } = await supabase
        .from(TABLE_NAME)
        // Fetching without the ::text cast to allow JS Date to parse the timestampz correctly
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

    // 2. Aggregate Data into a structure of recorded points
    // We use a Map/Object where keys are lotName, and values are arrays [Day0, Day1, ..., Day6]
    // where each DayX is an array of 72 slots.
    const aggregatedData = {};
    const uniqueLots = new Set();
    
    data.forEach(row => {
        const date = new Date(row.checked_at);
        
        // Use UTC Day (0=Sun, 6=Sat) for reliable indexing, ignoring local timezone shifts.
        const dayOfWeek = date.getUTCDay(); 
        const timeSlot = getUTCTimeSlotIndex(date); 
        
        const lotName = row.lot_name;
        const code = row.api_status_code; 

        uniqueLots.add(lotName);

        if (!aggregatedData[lotName]) {
            // Initialize the lot with 7 arrays (one for each day, 0-6)
            aggregatedData[lotName] = Array(DAYS.length).fill(0).map(() => Array(SLOTS_PER_DAY).fill(0));
        }

        // Store the status code directly into the UTC-indexed array
        aggregatedData[lotName][dayOfWeek][timeSlot] = code;
    });

    // 3. Interpolate the data to fill in gaps and cap the future slots
    const interpolatedData = interpolateData(aggregatedData, uniqueLots, currentDay, currentSlot);

    // 4. Sort lot names alphabetically
    const sortedLots = Array.from(uniqueLots).sort();

    // 5. Render the Heatmap
    renderHeatmap(interpolatedData, sortedLots);
}

/**
 * Fills in missing 20-minute slots with the last known status code, 
 * but ONLY up to the current local time.
 */
function interpolateData(data, lots, currentDay, currentSlot) {
    const interpolated = {};

    for (const lotName of lots) {
        interpolated[lotName] = {};
        
        // Iterate through all 7 days (0=Sunday UTC)
        for (let day = 0; day < DAYS.length; day++) {
            const dayData = data[lotName][day]; // This is the UTC day data
            
            // Crucial: We need to determine if this UTC day corresponds to the *current local day*
            // This is complex due to timezone shifts. The safest assumption is:
            // If the local day index matches the UTC index, apply the current time limit.
            const isTodayLocal = (day === currentDay);
            
            if (dayData) {
                interpolated[lotName][day] = [...dayData]; 
                let lastStatus = 0;

                // Iterate through all 72 slots for the day
                for (let slot = 0; slot < SLOTS_PER_DAY; slot++) {
                    
                    // --- TIME GATE CHECK (Uses LOCAL day/time for display cutoff) ---
                    // Only apply the cutoff if the current loop day matches the LOCAL day.
                    if (isTodayLocal && slot >= currentSlot) {
                        interpolated[lotName][day][slot] = 0; 
                        continue; 
                    }
                    // -------------------------------------------------------------

                    const currentStatus = dayData[slot];

                    if (currentStatus > 0) {
                        lastStatus = currentStatus;
                    } else if (lastStatus > 0) {
                        // Fill the gap
                        interpolated[lotName][day][slot] = lastStatus;
                    }
                }
            } else {
                // If the entire day is missing, initialize it to 0
                 interpolated[lotName][day] = Array(SLOTS_PER_DAY).fill(0);
            }
        }
    }
    return interpolated;
}

// =================================================================
// 4. HEATMAP RENDERING (No changes)
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
    
    // Add Legend
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

        // --- Heatmap Grid for this Lot (Days as Rows, Time as Columns) ---
        const gridDiv = document.createElement('div');
        gridDiv.className = 'grid-container';
        gridDiv.style.gridTemplateColumns = `60px repeat(${SLOTS_PER_DAY}, 1fr)`; 
        
        // 1. Time Slot Header Row (73 cells)
        gridDiv.innerHTML += `<div class="time-label time-label-header">יום / שעה</div>`; // RTL Day / Time header
        for (let slot = 0; slot < SLOTS_PER_DAY; slot += 6) { // Print only every 6th slot (2 hours)
            const timeString = getTimeString(slot);
            const span = document.createElement('span');
            span.className = 'time-label time-label-header';
            span.style.gridColumn = `span 6`; // Span 6 columns (2 hours)
            span.textContent = timeString;
            gridDiv.appendChild(span);
        }

        // 2. Data Cells (7 rows x 72 columns)
        for (let day = 0; day < DAYS.length; day++) {
            const dayName = DAYS[day];
            const dayData = data[lotName][day] || Array(SLOTS_PER_DAY).fill(0);

            // Day Label (Row Header)
            gridDiv.innerHTML += `<div class="time-label">${dayName}</div>`;

            // Add 72 cells for the 24 hours
            for (let slot = 0; slot < SLOTS_PER_DAY; slot++) {
                const status = dayData[slot];
                const statusText = getStatusText(status);
                const timeString = getTimeString(slot);

                let className = `status-${status}`;
                if (status === 0) {
                    className = 'status-empty';
                }

                gridDiv.innerHTML += `<div class="heatmap-cell ${className}"
                                             title="${lotName} - ${dayName} ${timeString} - סטטוס: ${statusText}"></div>`;
            }
        }

        lotDiv.appendChild(gridDiv);
        HEATMAP_CONTAINER.appendChild(lotDiv);
    });
}

// =================================================================
// 5. INITIALIZATION (The safe entry point)
// =================================================================

document.addEventListener('DOMContentLoaded', () => {
    loadAndProcessData();
});

