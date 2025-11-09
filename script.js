// =================================================================
// 1. CONFIGURATION 
// =================================================================

const SUPABASE_URL = 'https://shmtkxshrsrkwovjokqa.supabase.co'; 
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNobXRreHNocnNya3dvdmpva3FhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIyNDQ4MjAsImV4cCI6MjA3NzgyMDgyMH0.oENVmyU00Uy2N6gxir54yu4T0Jw_Jay2tITeQW3QfqE'; 

const TABLE_NAME = 'parking_consistency_data';
const SLOTS_PER_DAY = 72; // 72 slots of 20 minutes
const DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת']; 
const TZ = 'Asia/Jerusalem'; // <- authoritative time zone for everything

// Prebuild a formatter for Israel time
const tzFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ,
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23'
});

// =================================================================
// 2. HELPER FUNCTIONS (Israel local time via Intl)
// =================================================================

/**
 * Extracts Israel-local weekday, hour, minute (no manual offset math).
 * Returns { dayIndex: 0..6 (Sun..Sat), hour: 0..23, minute: 0..59 }.
 */
function getIsraelParts(date) {
  const parts = tzFormatter.formatToParts(date);
  const get = (t) => parts.find(p => p.type === t)?.value;

  const weekday = (get('weekday') || '').toLowerCase().slice(0, 3); // "sun".."sat"
  const dayMap = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
  const dayIndex = dayMap[weekday];

  // hour/minute are zero-padded strings in h23 (00..23)
  const hour = parseInt(get('hour') || '0', 10);
  const minute = parseInt(get('minute') || '0', 10);

  return { dayIndex, hour, minute };
}

/** Returns the 20-min slot index (0..71) from hour/minute. */
function slotIndexFromHM(hour, minute) {
  return Math.floor(((hour * 60) + minute) / 20);
}

/** HH:MM label for a slot (pure display). */
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

  // --- Current "today" and slot in Israel time ---
  const now = new Date();
  const { dayIndex: currentDay, hour: curH, minute: curM } = getIsraelParts(now);
  const currentSlot = Math.ceil(((curH * 60) + curM) / 20); // cutoff

  // 1) Fetch
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

  // 2) Aggregate into Israel-local day/slot buckets
  const aggregatedData = {};
  const uniqueLots = new Set();

  for (const row of data) {
    const utcDate = new Date(row.checked_at); // this is in UTC from DB
    const { dayIndex, hour, minute } = getIsraelParts(utcDate); // convert via TZ
    const timeSlot = slotIndexFromHM(hour, minute);

    const lotName = row.lot_name;
    const code = row.api_status_code;

    uniqueLots.add(lotName);

    if (!aggregatedData[lotName]) {
      aggregatedData[lotName] = Array(DAYS.length).fill(0).map(() => Array(SLOTS_PER_DAY).fill(0));
    }

    aggregatedData[lotName][dayIndex][timeSlot] = code;
  }

  // 3) Interpolate (fill gaps) but never beyond "now" in Israel time
  const interpolatedData = interpolateData(aggregatedData, uniqueLots, currentDay, currentSlot);

  // 4. Diagnostics: count how many rows fell into each day for each lot
  const diagnosticDiv = document.createElement('div');
  diagnosticDiv.style.fontFamily = 'monospace';
  diagnosticDiv.style.direction = 'ltr';
  diagnosticDiv.innerHTML = '<h3>DEBUG BUCKET COUNTS (Israel Time)</h3><pre>';

  for (const lotName of uniqueLots) {
    diagnosticDiv.innerHTML += `\n${lotName}:\n`;
    for (let d = 0; d < DAYS.length; d++) {
      const dayArr = aggregatedData[lotName][d] || [];
      const nonzero = dayArr.filter(x => x > 0).length;
      diagnosticDiv.innerHTML += `  ${DAYS[d]}: ${nonzero} slots\n`;
    }
  }
  diagnosticDiv.innerHTML += '</pre><hr>';
  document.body.prepend(diagnosticDiv);
  
  // 5. Sort & Render
  const sortedLots = Array.from(uniqueLots).sort();
  renderHeatmap(interpolatedData, sortedLots);
}

/**
 * Fills missing 20-min slots with last known status, capped at "now" (Israel time).
 */
function interpolateData(data, lots, currentDay, currentSlot) {
  const interpolated = {};

  for (const lotName of lots) {
    interpolated[lotName] = {};

    for (let day = 0; day < DAYS.length; day++) {
      const dayData = data[lotName][day];
      const isTodayIL = (day === currentDay);

      if (dayData) {
        interpolated[lotName][day] = [...dayData];
        let lastStatus = 0;

        for (let slot = 0; slot < SLOTS_PER_DAY; slot++) {
          if (isTodayIL && slot >= currentSlot) {
            interpolated[lotName][day][slot] = 0; // future today -> empty
            continue;
          }

          const s = dayData[slot];
          if (s > 0) {
            lastStatus = s;
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
  switch (code) {
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

    // Time header (labels every 2 hours)
    gridDiv.innerHTML += `<div class="time-label time-label-header">יום / שעה</div>`;
    for (let slot = 0; slot < SLOTS_PER_DAY; slot += 6) {
      const timeString = getTimeString(slot);
      const span = document.createElement('span');
      span.className = 'time-label time-label-header';
      span.style.gridColumn = `span 6`;
      span.textContent = timeString;
      gridDiv.appendChild(span);
    }

    // 7 rows: Sun..Sat (Israel-local indexes already)
    for (let day = 0; day < DAYS.length; day++) {
      const dayName = DAYS[day];
      const dayData = data[lotName][day] || Array(SLOTS_PER_DAY).fill(0);

      // Row label
      gridDiv.innerHTML += `<div class="time-label">${dayName}</div>`;

      // 24h * 3 slots/hour = 72 cells
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