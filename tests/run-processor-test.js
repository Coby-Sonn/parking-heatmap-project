// Simple Node test to verify DataProcessor uses the most recent record per slot

// Make a minimal browser-like global so utils.js can attach to it
global.window = global.window || {};

// Load the utils file (which attaches DataProcessor to window)
require('../js/utils.js');

const DataProcessor = global.window.DataProcessor;
const getLocalDayHourMinute = global.window.getLocalDayHourMinute;

if (!DataProcessor || !getLocalDayHourMinute) {
    console.error('Required utilities not available. Did utils.js load correctly?');
    process.exit(2);
}

const processor = new DataProcessor();

// Two samples that map to the same slot (08:05 and 08:10 local -> same 20-min slot)
const older = { checked_at: '2025-11-14T06:05:00Z', api_status_code: 1 };
const newer = { checked_at: '2025-11-14T06:10:00Z', api_status_code: 2 };

// Intentionally give them out-of-order input to confirm defensive sort works
const rawData = [newer, older];

const result = processor.processHeatmapData(rawData, 'TEST_LOT');

// Compute target day/slot from the newer sample
const parts = getLocalDayHourMinute(newer.checked_at);
const day = parts.day;
const slot = Math.floor(((parts.hour * 60) + parts.minute) / 20);

console.log('Test day:', day, 'slot:', slot);
console.log('Aggregated value at day/slot:', result.rawData[day][slot]);
console.log('Expected (most recent) api_status_code:', newer.api_status_code);

if (result.rawData[day][slot] === newer.api_status_code) {
    console.log('\n✅ PASS: most recent record wins for the slot');
    process.exit(0);
} else {
    console.error('\n❌ FAIL: slot value did not match most recent record');
    process.exit(1);
}
