// Heatmap Viewer (SMART + Prediction-Only)
// -------------------------------------------------------------

class HeatmapViewer {
    constructor() {
        this.lotName = null;
        this.lotCode = null;
        this.lotId = null;

        this.isComparison = false;
        this.lot1 = null;
        this.lot2 = null;

        this.mode = 'mixed'; // "mixed" or "prediction"

        this.dataFetcher = new DataFetcher();
        this.dataProcessor = new DataProcessor();

        this.rawData = null;
        this.histData = null;

        this.rawProcessed = null;
        this.histProcessed = null;
        this.currentProcessed = null;

        this.init();
    }

    /* ------------------------------------------------------------
     * INIT
     * ------------------------------------------------------------ */
    async init() {
        this.parseUrlParams();
        this.updateLotInfo();
        this.setupEventListeners();

        const ok = await this.dataFetcher.testConnection();
        if (!ok) return this.showError('שגיאה בחיבור למסד הנתונים');

        await this.loadHeatmap();
    }

    /* ------------------------------------------------------------
     * URL PARAM HANDLING
     * ------------------------------------------------------------ */
    parseUrlParams() {
        const p = new URLSearchParams(window.location.search);

        this.isComparison = p.get('compare') === 'true';

        if (this.isComparison) {
            this.lot1 = {
                name: p.get('lot1'),
                code: p.get('code1'),
                id: p.get('id1')
            };
            this.lot2 = {
                name: p.get('lot2'),
                code: p.get('code2'),
                id: p.get('id2')
            };
        } else {
            this.lotName = p.get('lot');
            this.lotCode = p.get('code');
            this.lotId = p.get('id');

            if (!this.lotName) {
                return this.showError('לא צוין חניון');
            }
        }
    }

    /* ------------------------------------------------------------
     * EVENT LISTENERS
     * ------------------------------------------------------------ */
    setupEventListeners() {
        const backBtn = document.getElementById('back-btn');
        if (backBtn)
            backBtn.addEventListener('click', () => window.location.href = 'index.html');

        // Toggle switch for mixed vs prediction-only mode
        const toggle = document.getElementById('prediction-toggle');
        if (toggle) {
            toggle.addEventListener('change', () => {
                this.mode = toggle.checked ? 'prediction' : 'mixed';

                if (this.isComparison && this.comparisonHist) {
                    // Comparison mode: rebuild data based on mode
                    if (this.mode === 'prediction') {
                        this.comparisonData = {
                            lot1: this.dataProcessor.buildPredictionOnlyMatrix(this.comparisonHist.lot1),
                            lot2: this.dataProcessor.buildPredictionOnlyMatrix(this.comparisonHist.lot2)
                        };
                    } else {
                        this.comparisonData = {
                            lot1: this.dataProcessor.combineSmartHeatmap(this.comparisonRaw.lot1, this.comparisonHist.lot1),
                            lot2: this.dataProcessor.combineSmartHeatmap(this.comparisonRaw.lot2, this.comparisonHist.lot2)
                        };
                    }
                    this.renderComparisonHeatmap();
                } else {
                    // Single lot mode
                    this.renderHeatmap();
                }
            });
        }

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') window.location.href = 'index.html';
        });
    }

    /* ------------------------------------------------------------
     * LOT TITLE
     * ------------------------------------------------------------ */
    updateLotInfo() {
        const t = document.getElementById('lot-title');
        const d = document.getElementById('lot-details');

        if (this.isComparison) {
            if (t) t.textContent = `השוואה: ${this.lot1.name} מול ${this.lot2.name}`;
            if (d) {
                d.innerHTML = `
                    <span>${this.lot1.name}: קוד ${this.lot1.code}</span><br>
                    <span>${this.lot2.name}: קוד ${this.lot2.code}</span>
                `;
            }
        } else {
            if (t) t.textContent = `מפת חום – ${this.lotName}`;
            if (d) d.textContent = `קוד: ${this.lotCode} | ID: ${this.lotId}`;
        }
    }

    /* ------------------------------------------------------------
     * STATUS BAR
     * ------------------------------------------------------------ */
    updateDataStatus(msg, type) {
        const el = document.getElementById('data-status');
        if (!el) return;

        el.textContent = msg;
        el.className = `data-status ${type}`;
    }

    /* ------------------------------------------------------------
     * LOAD HEATMAP (single OR comparison)
     * ------------------------------------------------------------ */
    async loadHeatmap() {
        if (this.isComparison) {
            return this.loadComparisonHeatmap();
        } else {
            return this.loadSingleHeatmap();
        }
    }

    /* ------------------------------------------------------------
     * SINGLE LOT MODE
     * ------------------------------------------------------------ */
    async loadSingleHeatmap() {
        this.updateDataStatus('טוען נתונים...', 'loading');

        const container = document.getElementById('heatmap-container');
        LoadingManager.show(container, `טוען נתוני ${this.lotName}...`);

        const [rawRows, histRows] = await Promise.all([
            this.dataFetcher.fetchLotData(this.lotName, 10),
            this.dataFetcher.fetchLotHistoricalData(this.lotName)
        ]);

        this.rawData = rawRows;
        this.histData = histRows;

        // Process
        const rawProcessed =
            rawRows.length > 0
                ? this.dataProcessor.processHeatmapData(rawRows, this.lotName)
                : this.dataProcessor.createEmptyHeatmap(this.lotName);

        const histProcessed =
            histRows.length > 0
                ? this.dataProcessor.processHistoricalHeatmapData(histRows, this.lotName)
                : this.dataProcessor.createEmptyHeatmap(this.lotName);

        this.rawProcessed = rawProcessed;
        this.histProcessed = histProcessed;

        // Default dataset (smart mix)
        this.currentProcessed =
            this.dataProcessor.combineSmartHeatmap(rawProcessed, histProcessed);

        this.updateDataStatus(
            `${rawRows.length} רשומות חיות | ${histRows.length} רשומות היסטוריות`,
            'success'
        );

        LoadingManager.hide(container);
        this.renderHeatmap();
        this.showStatistics();
    }

    /* ------------------------------------------------------------
     * COMPARISON MODE
     * ------------------------------------------------------------ */
    async loadComparisonHeatmap() {
        this.updateDataStatus('טוען השוואת חניונים...', 'loading');

        // Fetch both raw and historical data for both lots
        const [raw1, raw2, hist1, hist2] = await Promise.all([
            this.dataFetcher.fetchLotData(this.lot1.name, 10),
            this.dataFetcher.fetchLotData(this.lot2.name, 10),
            this.dataFetcher.fetchLotHistoricalData(this.lot1.name),
            this.dataFetcher.fetchLotHistoricalData(this.lot2.name)
        ]);

        // Process raw data
        const rawP1 = raw1.length > 0
            ? this.dataProcessor.processHeatmapData(raw1, this.lot1.name)
            : this.dataProcessor.createEmptyHeatmap(this.lot1.name);
        const rawP2 = raw2.length > 0
            ? this.dataProcessor.processHeatmapData(raw2, this.lot2.name)
            : this.dataProcessor.createEmptyHeatmap(this.lot2.name);

        // Process historical data
        const histP1 = hist1.length > 0
            ? this.dataProcessor.processHistoricalHeatmapData(hist1, this.lot1.name)
            : this.dataProcessor.createEmptyHeatmap(this.lot1.name);
        const histP2 = hist2.length > 0
            ? this.dataProcessor.processHistoricalHeatmapData(hist2, this.lot2.name)
            : this.dataProcessor.createEmptyHeatmap(this.lot2.name);

        // Store for toggle switching
        this.comparisonRaw = { lot1: rawP1, lot2: rawP2 };
        this.comparisonHist = { lot1: histP1, lot2: histP2 };

        // Default: combined smart heatmap
        this.comparisonData = {
            lot1: this.dataProcessor.combineSmartHeatmap(rawP1, histP1),
            lot2: this.dataProcessor.combineSmartHeatmap(rawP2, histP2)
        };

        this.updateDataStatus(
            `${raw1.length + raw2.length} רשומות חיות | ${hist1.length + hist2.length} רשומות היסטוריות`,
            'success'
        );

        this.renderComparisonHeatmap();
    }

    /* ------------------------------------------------------------
     * RENDER SINGLE LOT
     * ------------------------------------------------------------ */
    renderHeatmap() {
        const container = document.getElementById('heatmap-container');
        if (!container || !this.rawProcessed || !this.histProcessed) return;

        container.innerHTML = '';

        // Determine dataset based on mode
        let matrix;
        if (this.mode === 'prediction') {
            matrix = this.dataProcessor.buildPredictionOnlyMatrix(this.histProcessed);
        } else {
            matrix = this.dataProcessor.combineSmartHeatmap(
                this.rawProcessed,
                this.histProcessed
            );
        }

        this.currentProcessed = matrix;

        const grid = document.createElement('div');
        grid.className = 'grid-container';
        grid.style.gridTemplateColumns = `60px repeat(${CONFIG.SLOTS_PER_DAY}, 1fr)`;

        this.addHeaderRow(grid);
        this.addDataRows(grid, matrix);

        container.appendChild(grid);
    }

    /* ------------------------------------------------------------
     * GRID HEADER
     * ------------------------------------------------------------ */
    addHeaderRow(grid) {
        const corner = document.createElement('div');
        corner.className = 'time-label time-label-header';
        corner.textContent = 'יום / שעה';
        grid.appendChild(corner);

        for (let s = 0; s < CONFIG.SLOTS_PER_DAY; s += 6) {
            const label = document.createElement('div');
            label.className = 'time-label time-label-header';
            label.style.gridColumn = 'span 6';
            label.textContent = getTimeLabel(s);
            grid.appendChild(label);
        }
    }

    /* ------------------------------------------------------------
     * ADD HEATMAP ROWS
     * ------------------------------------------------------------ */
    addDataRows(grid, data) {
        for (let d = 0; d < 7; d++) {
            const dayLabel = document.createElement('div');
            dayLabel.className = 'time-label';
            dayLabel.textContent = CONFIG.DAYS[d];
            grid.appendChild(dayLabel);

            const row = data.interpolated[d];

            for (let s = 0; s < CONFIG.SLOTS_PER_DAY; s++) {
                const val = row[s];
                const cell = document.createElement('div');

                cell.className =
                    val === 0 ? 'heatmap-cell status-empty' : `heatmap-cell status-${val}`;

                // highlight current slot
                if (data.currentDay === d && data.currentSlot === s) {
                    cell.classList.add('current-time');
                }

                const time = getTimeLabel(s);
                const isFuture =
                    (d > data.currentDay) ||
                    (d === data.currentDay && s > data.currentSlot);

                if (this.mode === 'prediction') {
                    cell.title = `תחזית: ${CONFIG.DAYS[d]} ${time} – ${this.getStatusText(val)}`;
                } else {
                    if (isFuture) {
                        cell.title = `תחזית: ${CONFIG.DAYS[d]} ${time} – ${this.getStatusText(val)}`;
                    } else {
                        cell.title = `נמדד: ${CONFIG.DAYS[d]} ${time} – ${this.getStatusText(val)}`;
                    }
                }

                grid.appendChild(cell);
            }
        }
    }

    /* ------------------------------------------------------------
     * COMPARISON MODE
     * ------------------------------------------------------------ */
    renderComparisonHeatmap() {
        const container = document.getElementById('heatmap-container');
        container.innerHTML = '';

        const wrap = document.createElement('div');
        wrap.className = 'comparison-container';

        wrap.appendChild(this.makeSingleComparison(this.comparisonData.lot1, this.lot1.name, '1'));
        wrap.appendChild(this.makeSingleComparison(this.comparisonData.lot2, this.lot2.name, '2'));

        container.appendChild(wrap);
    }

    makeSingleComparison(data, name, number) {
        const box = document.createElement('div');
        box.className = 'heatmap-wrapper';

        const title = document.createElement('h3');
        title.textContent = `${number}. ${name}`;
        box.appendChild(title);

        const grid = document.createElement('div');
        grid.className = 'grid-container';
        grid.style.gridTemplateColumns = `60px repeat(${CONFIG.SLOTS_PER_DAY}, 1fr)`;

        this.addHeaderRow(grid);
        this.addDataRows(grid, data);

        box.appendChild(grid);
        return box;
    }

    /* ------------------------------------------------------------
     * HUMAN LABELS
     * ------------------------------------------------------------ */
    getStatusText(code) {
        return {
            0: 'אין נתון',
            1: 'פנוי',
            2: 'כמעט מלא',
            3: 'מלא',
            4: 'לא ידוע'
        }[code] || `קוד ${code}`;
    }

    /* ------------------------------------------------------------
     * STATS
     * ------------------------------------------------------------ */
    showStatistics() {
        const section = document.getElementById('stats-section');
        if (!section) return;

        const total = this.rawData.length + this.histData.length;
        const days = this.rawProcessed.dayDistribution.filter(n => n > 0).length;

        document.getElementById('total-records').textContent = total;
        document.getElementById('days-coverage').textContent = days;
        document.getElementById('last-update').textContent =
            new Date().toLocaleString('he-IL');

        section.style.display = 'block';
    }

    /* ------------------------------------------------------------
     * ERROR DISPLAY
     * ------------------------------------------------------------ */
    showError(msg) {
        const c = document.getElementById('heatmap-container');
        if (!c) return;

        c.innerHTML = `
            <div class="error-container">
                <div class="error-icon">⚠️</div>
                <h3>שגיאה</h3>
                <p>${msg}</p>
                <button onclick="location.reload()">נסה שוב</button>
            </div>
        `;
    }
}

/* ------------------------------------------------------------
 * ON DOCUMENT READY
 * ------------------------------------------------------------ */
document.addEventListener('DOMContentLoaded', () => {
    if (!window.supabase)
        return console.error('❌ Supabase not loaded');

    new HeatmapViewer();
});
