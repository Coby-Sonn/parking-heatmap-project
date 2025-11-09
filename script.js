// =================================================================
// 1. CONFIGURATION
// =================================================================
const SUPABASE_URL = 'https://shmtkxshrsrkwovjokqa.supabase.co';
const SUPABASE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNobXRreHNocnNya3dvdmpva3FhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIyNDQ4MjAsImV4cCI6MjA3NzgyMDgyMH0.oENVmyU00Uy2N6gxir54yu4T0Jw_Jay2tITeQW3QfqE';

const TABLE_NAME = 'parking_consistency_data';
const SLOTS_PER_DAY = 72;
const DAYS = ['ראשון','שני','שלישי','רביעי','חמישי','שישי','שבת'];

// =================================================================
// 2. SIMPLE LOCAL HELPERS (no manual offset math)
// =================================================================

function getLocalDayHourMinute(utcString) {
  const d = new Date(utcString);

  // ✅ Force Israel offset (UTC+2). 120 min × 60 000 = 7 200 000 ms
  const local = new Date(d.getTime() + 2 * 60 * 60 * 1000);

  return {
    day: local.getDay(),      // now truly local Israel weekday
    hour: local.getHours(),
    minute: local.getMinutes(),
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
// 3. FETCH + PROCESS
// =================================================================
async function loadAndProcessData() {
  const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  const container = document.getElementById('heatmap-container');
  container.innerHTML = 'טוען נתונים...';

  const { data, error } = await supabase
    .from(TABLE_NAME)
    .select('checked_at, lot_name, api_status_code')
    .order('checked_at', { ascending: true });

  if (error) {
    container.innerHTML = `<p style="color:red">שגיאה: ${error.message}</p>`;
    return;
  }

  const now = new Date();
  const currentDay = now.getDay();
  const currentSlot = getSlot(now.getHours(), now.getMinutes());

  const aggregated = {};
  const lots = new Set();

  data.forEach(row => {
    const { day, hour, minute } = getLocalDayHourMinute(row.checked_at);
    const slot = getSlot(hour, minute);
    const lot = row.lot_name;
    lots.add(lot);
    if (!aggregated[lot]) aggregated[lot] = Array(7).fill(0).map(()=>Array(SLOTS_PER_DAY).fill(0));
    aggregated[lot][day][slot] = row.api_status_code;
  });

  // Interpolate
  const interp = {};
  for (const lot of lots) {
    interp[lot] = {};
    for (let d=0; d<7; d++) {
      const arr = aggregated[lot][d];
      interp[lot][d] = [...arr];
      let last=0;
      for (let s=0; s<SLOTS_PER_DAY; s++) {
        if (d===currentDay && s>=currentSlot) { interp[lot][d][s]=0; continue; }
        if (arr[s]>0) last=arr[s];
        else if (last>0) interp[lot][d][s]=last;
      }
    }
  }

  renderHeatmap(interp, Array.from(lots).sort());
}

// =================================================================
// 4. RENDER
// =================================================================
function getStatusText(c){
  return {1:'פנוי',2:'כמעט מלא',3:'מלא',4:'לא ידוע/כישלון',0:'אין נתונים'}[c] || c;
}

function renderHeatmap(data, lots){
  const c = document.getElementById('heatmap-container');
  c.innerHTML = `
  <div class="legend">
    <h3>מקרא</h3>
    <span class="status-1">1=פנוי</span>
    <span class="status-2">2=כמעט מלא</span>
    <span class="status-3">3=מלא</span>
    <span class="status-4">4=לא ידוע/כישלון</span>
    <span class="status-empty">ריק=אין נתונים</span>
  </div><hr>`;

  for(const lot of lots){
    const div=document.createElement('div');
    div.className='lot-heatmap';
    div.innerHTML=`<h2>${lot}</h2>`;
    const grid=document.createElement('div');
    grid.className='grid-container';
    grid.style.gridTemplateColumns=`60px repeat(${SLOTS_PER_DAY},1fr)`;

    grid.innerHTML+=`<div class="time-label time-label-header">יום / שעה</div>`;
    for(let s=0;s<SLOTS_PER_DAY;s+=6){
      const t=getTimeLabel(s);
      const span=document.createElement('span');
      span.className='time-label time-label-header';
      span.style.gridColumn=`span 6`;
      span.textContent=t;
      grid.appendChild(span);
    }

    for(let d=0;d<7;d++){
      grid.innerHTML+=`<div class="time-label">${DAYS[d]}</div>`;
      const arr=data[lot][d]||Array(SLOTS_PER_DAY).fill(0);
      for(let s=0;s<SLOTS_PER_DAY;s++){
        const val=arr[s];
        const cls=val===0?'status-empty':`status-${val}`;
        const t=getTimeLabel(s);
        grid.innerHTML+=`<div class="heatmap-cell ${cls}" title="${lot} - ${DAYS[d]} ${t} - ${getStatusText(val)}"></div>`;
      }
    }
    div.appendChild(grid);
    c.appendChild(div);
  }
}

// =================================================================
// 5. INIT
// =================================================================
document.addEventListener('DOMContentLoaded', loadAndProcessData);