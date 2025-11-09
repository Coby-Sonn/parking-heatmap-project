// =================================================================
// 1. CONFIGURATION 
// =================================================================

const SUPABASE_URL = 'https://shmtkxshrsrkwovjokqa.supabase.co';
const SUPABASE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNobXRreHNocnNya3dvdmpva3FhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIyNDQ4MjAsImV4cCI6MjA3NzgyMDgyMH0.oENVmyU00Uy2N6gxir54yu4T0Jw_Jay2tITeQW3QfqE';

const TABLE_NAME = 'parking_consistency_data';
const SLOTS_PER_DAY = 72; // 72 slots of 20 minutes each
const DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const TZ = 'Asia/Jerusalem';

// =================================================================
// 2. HELPER FUNCTIONS (Israel Local Time, DST-safe)
// =================================================================

/**
 * Extracts Israel-local day/hour/minute safely with Intl API.
 * This avoids all iOS/WebKit date parsing issues.
 */
function getIsraelParts(date) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);

  const weekday = fmt.find((p) => p.type === 'weekday')?.value?.toLowerCase() || '';
  const hour = parseInt(fmt.find((p) => p.type === 'hour')?.value || '0', 10);
  const minute = parseInt(fmt.find((p) => p.type === 'minute')?.value || '0', 10);

  // Map covers abbreviations and full words
  const map = {
    sun: 0, sunday: 0,
    mon: 1, monday: 1,
    tue: 2, tuesday: 2,
    wed: 3, wednesday: 3,
    thu: 4, thursday: 4,
    fri: 5, friday: 5,
    sat: 6, saturday: 6,
  };
  const key = Object.keys(map).find((k) => weekday.startsWith(k)) || 'sun';
  const dayIndex = map[key];
  return { dayIndex, hour, minute };
}

/** Convert hour/minute to a 20-min slot index (0–71). */
function slotIndexFromHM(hour, minute) {
  return Math.floor(((hour * 60) + minute) / 20);
}

/** Human-readable time for tooltips. */
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

  // --- Current day & slot in Israel local time ---
  const now = new Date();
  const { dayIndex: currentDay, hour: curH, minute: curM } = getIsraelParts(now);
  const currentSlot = Math.ceil(((curH * 60) + curM) / 20);

  // 1. Fetch
  const { data, error } = await supabase
    .from(TABLE_NAME)
    .select('checked_at, lot_name, api_status_code')
    .order('checked_at', { ascending: true });

  if (error) {
    HEATMAP_CONTAINER.innerHTML = `<p style="color:red">שגיאה: ${error.message}</p>`;
    console.error(error);
    return;
  }

  if (!data || data.length === 0) {
    HEATMAP_CONTAINER.innerHTML = `<p>לא נמצאו נתונים בטבלה.</p>`;
    return;
  }

  // 2. Aggregate into Israel-local buckets
  const aggregatedData = {};
  const uniqueLots = new Set();

  for (const row of data) {
    const utcDate = new Date(row.checked_at);
    const { dayIndex, hour, minute } = getIsraelParts(utcDate);
    const slot = slotIndexFromHM(hour, minute);

    const lotName = row.lot_name;
    const code = row.api_status_code;

    uniqueLots.add(lotName);
    if (!aggregatedData[lotName]) {
      aggregatedData[lotName] = Array(DAYS.length)
        .fill(0)
        .map(() => Array(SLOTS_PER_DAY).fill(0));
    }

    aggregatedData[lotName][dayIndex][slot] = code;
  }

  // 3. Interpolate (fill gaps up to current local time)
  const interpolated = interpolateData(aggregatedData, uniqueLots, currentDay, currentSlot);

  // 4. Debug — print bucket counts visibly
  const diag = document.createElement('div');
  diag.style.fontFamily = 'monospace';
  diag.style.direction = 'ltr';
  diag.innerHTML = '<h3>DEBUG BUCKET COUNTS (Israel Time)</h3><pre>';
  for (const lot of uniqueLots) {
    diag.innerHTML += `\n${lot}:\n`;
    for (let d = 0; d < DAYS.length; d++) {
      const count = (aggregatedData[lot][d] || []).filter(x => x > 0).length;
      diag.innerHTML += `  ${DAYS[d]}: ${count} slots\n`;
    }
  }
  diag.innerHTML += '</pre><hr>';
  document.body.prepend(diag);

  // 5. Sort & render
  const sortedLots = Array.from(uniqueLots).sort();
  renderHeatmap(interpolated, sortedLots);
}

/**
 * Fill missing 20-min slots with last known status (no future slots).
 */
function interpolateData(data, lots, currentDay, currentSlot) {
  const interpolated = {};
  for (const lot of lots) {
    interpolated[lot] = {};
    for (let day = 0; day < DAYS.length; day++) {
      const dayData = data[lot][day];
      const isToday = (day === currentDay);

      if (dayData) {
        interpolated[lot][day] = [...dayData];
        let lastStatus = 0;
        for (let slot = 0; slot < SLOTS_PER_DAY; slot++) {
          if (isToday && slot >= currentSlot) {
            interpolated[lot][day][slot] = 0;
            continue;
          }
          const s = dayData[slot];
          if (s > 0) lastStatus = s;
          else if (lastStatus > 0) interpolated[lot][day][slot] = lastStatus;
        }
      } else {
        interpolated[lot][day] = Array(SLOTS_PER_DAY).fill(0);
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
  HEATMAP_CONTAINER.innerHTML = `
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

  lots.forEach(lot => {
    const lotDiv = document.createElement('div');
    lotDiv.className = 'lot-heatmap';
    lotDiv.innerHTML = `<h2>${lot}</h2>`;

    const grid = document.createElement('div');
    grid.className = 'grid-container';
    grid.style.gridTemplateColumns = `60px repeat(${SLOTS_PER_DAY}, 1fr)`;

    grid.innerHTML += `<div class="time-label time-label-header">יום / שעה</div>`;
    for (let slot = 0; slot < SLOTS_PER_DAY; slot += 6) {
      const t = getTimeString(slot);
      const span = document.createElement('span');
      span.className = 'time-label time-label-header';
      span.style.gridColumn = `span 6`;
      span.textContent = t;
      grid.appendChild(span);
    }

    for (let d = 0; d < DAYS.length; d++) {
      const dayName = DAYS[d];
      const arr = data[lot][d] || Array(SLOTS_PER_DAY).fill(0);
      grid.innerHTML += `<div class="time-label">${dayName}</div>`;
      for (let slot = 0; slot < SLOTS_PER_DAY; slot++) {
        const s = arr[slot];
        const statusText = getStatusText(s);
        const t = getTimeString(slot);
        let className = s === 0 ? 'status-empty' : `status-${s}`;
        grid.innerHTML += `<div class="heatmap-cell ${className}" 
          title="${lot} - ${dayName} ${t} - סטטוס: ${statusText}"></div>`;
      }
    }

    lotDiv.appendChild(grid);
    HEATMAP_CONTAINER.appendChild(lotDiv);
  });
}

// =================================================================
// 5. INITIALIZATION
// =================================================================

document.addEventListener('DOMContentLoaded', () => loadAndProcessData());