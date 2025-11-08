// =================================================================
// 1. CONFIGURATION (No changes here, keys are defined)
// =================================================================

const SUPABASE_URL = 'https://shmtkxshrsrkwovjokqa.supabase.co'; 
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNobXRreHNocnNya3dvdmpva3FhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIyNDQ4MjAsImV4cCI6MjA3NzgyMDgyMH0.oENVmyU00Uy2N6gxir54yu4T0Jw_Jay2tITeQW3QfqE'; 

const TABLE_NAME = 'parking_consistency_data';
const SLOTS_PER_DAY = 72;
// DAYS: [Sun, Mon, Tue, Wed, Thu, Fri, Sat]. Date.getDay() returns 0 for Sunday.
const DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת']; 

// =================================================================
// 2. HELPER FUNCTIONS (No changes here)
// =================================================================

function getTimeSlotIndex(date) {
    const hours = date.getHours();
    const minutes = date.getMinutes();
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
    
    // --- 1. Get Current Day and Slot for Interpolation Limit ---
    const now = new Date();
    const currentDay = now.getDay();
    // Use Math.ceil to ensure the current slot (which is potentially still collecting data) 
    // is the LAST slot we consider filled. Everything after that must be empty.
    const currentSlot = Math.ceil(getTimeSlotIndex(now)); 
    // -----------------------------------------------------------

    // 1. Fetch Data
    const { data, error } = await supabase
        .from(TABLE_NAME)
        .select('checked_at, lot_name, api_status_code')
        .order('checked_at', { ascending: true }); // Crucial for interpolation later

    if (error) {
        console.error('Error fetching data:', error);
        HEATMAP_CONTAINER.innerHTML = `<p style="color: red;">Error loading data: ${error.message}. Please check console for network errors.</p>`;
        return;
    }
    
    // console.log('--- RAW DATA FETCHED ---', data);

    if (!data || data.length === 0) {
        HEATMAP_CONTAINER.innerHTML = `<p>No parking data records found in the table '${TABLE_NAME}'. Please verify your Supabase query and table content.</p>`;
        return;
    }

    // 2. Aggregate Data into a structure of recorded points
    const aggregatedData = {};
    const uniqueLots = new Set();
    let debugCount = 0;

    data.forEach(row => {
        const date = new Date(row.checked_at);
        const dayOfWeek = date.getDay(); 
        const timeSlot = getTimeSlotIndex(date);
        const lotName = row.lot_name;
        const code = row.api_status_code; 

        uniqueLots.add(lotName);

        if (!aggregatedData[lotName]) {
            aggregatedData[lotName] = {};
        }
        if (!aggregatedData[lotName][dayOfWeek]) {
            aggregatedData[lotName][dayOfWeek] = Array(SLOTS_PER_DAY).fill(0); 
        }

        // Store the status code at the exact 20-minute slot
        aggregatedData[lotName][dayOfWeek][timeSlot] = code;

        if (debugCount < 10 && code !== 0) {
            // console.log(`Processed: Lot=${lotName}, Day=${DAYS[dayOfWeek]}, Slot=${timeSlot} (${getTimeString(timeSlot)}), Status=${code}`);
            debugCount++;
        }
    });

    // 3. Interpolate the data to fill in gaps (like the 90-min intervals)
    // --- PASSING CURRENT DAY AND SLOT TO LIMIT INTERPOLATION ---
    const interpolatedData = interpolateData(aggregatedData, uniqueLots, currentDay, currentSlot);
    
    // console.log('--- FINAL AGGREGATED DATA ---', interpolatedData);

    // 4. Sort lot names alphabetically
    const sortedLots = Array.from(uniqueLots).sort();

    // 5. Render the Heatmap
    renderHeatmap(interpolatedData, sortedLots);
}

/**
 * Iterates through the aggregated data and fills in missing 20-minute slots 
 * (marked as 0) with the last known status code, but ONLY up to the current time.
 * @param {object} data - Aggregated data with gaps (0s).
 * @param {Set<string>} lots - Set of unique parking lot names.
 * @param {number} currentDay - Today's day index (0-6).
 * @param {number} currentSlot - Today's current slot index (0-72).
 * @returns {object} Interpolated data structure.
 */
function interpolateData(data, lots, currentDay, currentSlot) {
    const interpolated = {};

    for (const lotName of lots) {
        interpolated[lotName] = {};
        
        for (let day = 0; day < DAYS.length; day++) {
            const dayData = data[lotName][day];

            // Only process if data exists for that lot/day
            if (dayData) {
                interpolated[lotName][day] = [...dayData]; 
                let lastStatus = 0;

                // Determine the end slot for interpolation. 
                // Only interpolate up to the current slot if it's the current day.
                // Otherwise, interpolate the full 72 slots (0-71).
                const endSlot = (day === currentDay) ? currentSlot : SLOTS_PER_DAY;

                // Iterate through all 72 slots for the day
                for (let slot = 0; slot < SLOTS_PER_DAY; slot++) {
                    
                    // --- FUNCTIONAL FIX: STOP INTERPOLATION AT CURRENT TIME ---
                    // If we are on the current day, any slot *after* the current slot must remain 0 (white).
                    if (day === currentDay && slot >= currentSlot) {
                        interpolated[lotName][day][slot] = 0; // Ensure future slots are reset to 0
                        continue; 
                    }
                    // -------------------------------------------------------------

                    const currentStatus = dayData[slot];

                    if (currentStatus > 0) {
                        // If we have a real status (1, 2, 3, or 4), update lastStatus
                        lastStatus = currentStatus;
                    } else if (lastStatus > 0) {
                        // If current status is 0 (empty) but we have a last known status, fill the gap
                        interpolated[lotName][day][slot] = lastStatus;
                    }
                    // If both currentStatus and lastStatus are 0, it remains 0 (status-empty)
                }
            } else {
                // If the entire day is missing, initialize it to 0
                 interpolated[lotName][day] = Array(SLOTS_PER_DAY).fill(0);
            }
        }
    }
    console.log('--- INTERPOLATION COMPLETE. Future slots for the current day are reset to "No Data" (0). ---');
    return interpolated;
}

// =================================================================
// 4. HEATMAP RENDERING (Updated for Day/Time flip and smaller size)
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
    // Title only; directionality and alignment are handled by CSS (`body { direction: rtl; }` and `h2 { text-align: right; }`).
    lotDiv.innerHTML = `<h2>${lotName}</h2>`;

        // --- Heatmap Grid for this Lot (Days as Rows, Time as Columns) ---
        const gridDiv = document.createElement('div');
    gridDiv.className = 'grid-container';
        // 73 columns: 1 (Day Label) + 72 (20-min slots)
        gridDiv.style.gridTemplateColumns = `60px repeat(${SLOTS_PER_DAY}, 1fr)`; 
    // Grid inherits direction from the document CSS; avoid inline direction styles for cleaner markup/CSS control.

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
                                             title="${lotName} - ${dayName} ${timeString} - Status: ${statusText}"></div>`;
            }
        }

        lotDiv.appendChild(gridDiv);
        // Append the whole lot container (which includes the <h2> title and the grid)
        // to the heatmap container. Previously the code appended only the gridDiv,
        // which removed the heading from the DOM and made the lot name invisible.
        HEATMAP_CONTAINER.appendChild(lotDiv);
    });
}

// =================================================================
// 5. INITIALIZATION (The safe entry point)
// =================================================================

document.addEventListener('DOMContentLoaded', () => {
    loadAndProcessData();
});