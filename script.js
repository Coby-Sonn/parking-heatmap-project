// =================================================================
// 1. CONFIGURATION AND INITIAL SETUP
// =================================================================

// !!! IMPORTANT: REPLACE THESE PLACEHOLDERS WITH YOUR ACTUAL KEYS !!!
const SUPABASE_URL = 'https://shmtkxshrsrkwovjokqa.supabase.co'; // e.g., 'https://xyz.supabase.co'
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNobXRreHNocnNya3dvdmpva3FhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIyNDQ4MjAsImV4cCI6MjA3NzgyMDgyMH0.oENVmyU00Uy2N6gxir54yu4T0Jw_Jay2tITeQW3QfqE'; // e.g., 'eyJhbGciOiJIUzI1Ni...'
// !!! ----------------------------------------------------------- !!!

const supabase = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const HEATMAP_CONTAINER = document.getElementById('heatmap-container');
const TABLE_NAME = 'parking_consistency_data';
const SLOTS_PER_DAY = 72; // 24 hours * 3 slots/hour (20 minutes)
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// =================================================================
// 2. HELPER FUNCTIONS
// =================================================================

/**
 * Calculates the index of the 20-minute time slot (0 to 71) for a given Date object.
 * Slot 0 = 00:00 - 00:19
 * Slot 71 = 23:40 - 23:59
 * @param {Date} date - The timestamp of the record.
 * @returns {number} The 20-minute slot index.
 */
function getTimeSlotIndex(date) {
    const hours = date.getHours();
    const minutes = date.getMinutes();
    // Total minutes from midnight: (hours * 60) + minutes
    // Divide by 20 to get the slot index
    return Math.floor(((hours * 60) + minutes) / 20);
}

/**
 * Calculates the time string (HH:MM) for a given 20-minute slot index.
 * @param {number} slot - The 20-minute slot index (0-71).
 * @returns {string} The formatted time string (e.g., "07:40").
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

/**
 * Fetches data from Supabase, aggregates it by lot, day, and time slot.
 */
async function loadAndProcessData() {
    HEATMAP_CONTAINER.innerHTML = '<p>Loading parking data...</p>';

    // 1. Fetch Data: Selects only the necessary columns
    const { data, error } = await supabase
        .from(TABLE_NAME)
        .select('checked_at, lot_name, code_achoza')
        .order('checked_at', { ascending: true });

    if (error) {
        console.error('Error fetching data:', error);
        HEATMAP_CONTAINER.innerHTML = `<p style="color: red;">Error loading data: ${error.message}</p>`;
        return;
    }

    // 2. Aggregate Data into a Heatmap Structure
    // Structure: { lot_name: { day_of_week: { time_slot_index: code_achoza } } }
    const aggregatedData = {};
    const uniqueLots = new Set();

    data.forEach(row => {
        const date = new Date(row.checked_at);
        const dayOfWeek = date.getDay(); // 0 (Sunday) to 6 (Saturday)
        const timeSlot = getTimeSlotIndex(date);
        const lotName = row.lot_name;
        const code = row.code_achoza;

        uniqueLots.add(lotName);

        if (!aggregatedData[lotName]) {
            aggregatedData[lotName] = {};
        }
        if (!aggregatedData[lotName][dayOfWeek]) {
            aggregatedData[lotName][dayOfWeek] = {};
        }

        // Store the status code for this specific slot.
        aggregatedData[lotName][dayOfWeek][timeSlot] = code;
    });

    // 3. Sort lot names alphabetically for consistent heatmap rows
    const sortedLots = Array.from(uniqueLots).sort();

    // 4. Render the Heatmap
    renderHeatmap(aggregatedData, sortedLots);
}

// =================================================================
// 4. HEATMAP RENDERING
// =================================================================

/**
 * Generates and displays the heatmap grids for each parking lot.
 * The layout is Time Slots (Rows) vs. Days of the Week (Columns).
 * @param {object} data - The aggregated data structure.
 * @param {string[]} lots - An array of sorted unique lot names.
 */
function renderHeatmap(data, lots) {
    // Clear previous content
    HEATMAP_CONTAINER.innerHTML = '';
    
    // Add a simple legend
    const legend = `
        <div class="legend">
            <h3>Vacancy Legend</h3>
            <span class="status-1">1=Free</span>
            <span class="status-2">2=Almost Full</span>
            <span class="status-3">3=Full</span>
            <span class="status-4">4=Unknown/Failure</span>
            <span class="status-empty">Empty=No Data</span>
        </div>
        <hr>
    `;
    HEATMAP_CONTAINER.innerHTML = legend;


    lots.forEach(lotName => {
        const lotDiv = document.createElement('div');
        lotDiv.className = 'lot-heatmap';

        // --- Lot Name Header ---
        lotDiv.innerHTML = `<h2>${lotName}</h2>`;

        // --- Heatmap Grid for this Lot (Day x Time) ---
        const gridDiv = document.createElement('div');
        gridDiv.className = 'grid-container';
        // 80px for the time label column + 7 days (1fr each)
        gridDiv.style.gridTemplateColumns = `80px repeat(${DAYS.length}, 1fr)`;

        // 1. Day Header Row
        gridDiv.innerHTML += `<div class="time-label">Time</div>`; // Placeholder for Time column
        DAYS.forEach(day => {
            gridDiv.innerHTML += `<div class="time-label">${day}</div>`;
        });

        // 2. Data Cells (72 rows x 7 columns)
        for (let slot = 0; slot < SLOTS_PER_DAY; slot++) {
            const timeString = getTimeString(slot);

            // Add Time Label for the row
            gridDiv.innerHTML += `<div class="time-label">${timeString}</div>`;

            // Add 7 cells (one for each day)
            for (let day = 0; day < DAYS.length; day++) {
                // Get status: check if lot exists, then if day exists, then if slot exists. Default to 0 (empty).
                const status = data[lotName]?.[day]?.[slot] || 0;

                let className = `status-${status}`;
                if (status === 0) {
                    className = 'status-empty';
                }

                gridDiv.innerHTML += `<div class="heatmap-cell ${className}"
                                             title="${lotName} - ${DAYS[day]} ${timeString} - Status: ${status}"></div>`;
            }
        }

        lotDiv.appendChild(gridDiv);
        HEATMAP_CONTAINER.appendChild(lotDiv);
    });
}

// =================================================================
// 5. INITIALIZATION
// =================================================================

// Call the main function to start the process when the script loads
loadAndProcessData();