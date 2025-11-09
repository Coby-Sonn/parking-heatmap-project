// Heatmap viewer functionality
class HeatmapViewer {
    constructor() {
        this.lotName = null;
        this.lotCode = null;
        this.lotId = null;
        this.isComparison = false;
        this.lot1 = null;
        this.lot2 = null;
        this.dataFetcher = null;
        this.dataProcessor = null;
        this.heatmapData = null;
        this.comparisonData = null;
        
        this.init();
    }

    async init() {
        console.log('🎯 Initializing Heatmap Viewer...');
        
        // Parse URL parameters
        this.parseUrlParams();
        
        // Initialize data classes
        this.dataFetcher = new DataFetcher();
        this.dataProcessor = new DataProcessor();
        
        // Set up event listeners
        this.setupEventListeners();
        
        // Update UI with lot info
        this.updateLotInfo();
        
        // Test connection first
        const connected = await this.testConnection();
        if (!connected) {
            this.showError('לא ניתן להתחבר לבסיס הנתונים. אנא בדוק את החיבור לאינטרנט ונסה שוב.');
            return;
        }
        
        // Load and display heatmap
        await this.loadHeatmap();
    }

    parseUrlParams() {
        const urlParams = new URLSearchParams(window.location.search);
        this.isComparison = urlParams.get('compare') === 'true';
        
        if (this.isComparison) {
            this.lot1 = {
                name: urlParams.get('lot1'),
                code: urlParams.get('code1'),
                id: urlParams.get('id1')
            };
            this.lot2 = {
                name: urlParams.get('lot2'),
                code: urlParams.get('code2'),
                id: urlParams.get('id2')
            };
            
            console.log('📋 Comparison Mode - URL Parameters:', {
                lot1: this.lot1,
                lot2: this.lot2
            });
            
            if (!this.lot1.name || !this.lot2.name) {
                console.error('❌ Missing lot names for comparison');
                this.showError('נתוני חניונים חסרים להשוואה. אנא חזור לדף הבחירה.');
            }
        } else {
            this.lotName = urlParams.get('lot');
            this.lotCode = urlParams.get('code');
            this.lotId = urlParams.get('id');
            
            console.log('📋 Single Lot Mode - URL Parameters:', {
                lotName: this.lotName,
                lotCode: this.lotCode,
                lotId: this.lotId
            });
            
            if (!this.lotName) {
                console.error('❌ No lot name provided in URL');
                this.showError('לא צוין שם חניון. אנא חזור לדף הבחירה.');
            }
        }
    }

    setupEventListeners() {
        // Back button
        const backBtn = document.getElementById('back-btn');
        if (backBtn) {
            backBtn.addEventListener('click', () => {
                window.location.href = 'index.html';
            });
        }

        // Keyboard navigation
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                window.location.href = 'index.html';
            }
        });
    }

    updateLotInfo() {
        const titleElement = document.getElementById('lot-title');
        const detailsElement = document.getElementById('lot-details');
        
        if (this.isComparison && titleElement && this.lot1 && this.lot2) {
            titleElement.textContent = `השוואה: ${this.lot1.name} vs ${this.lot2.name}`;
            if (detailsElement) {
                detailsElement.innerHTML = `
                    <span>${this.lot1.name}: קוד ${this.lot1.code} | ID ${this.lot1.id}</span><br>
                    <span>${this.lot2.name}: קוד ${this.lot2.code} | ID ${this.lot2.id}</span>
                `;
            }
        } else if (titleElement && this.lotName) {
            titleElement.textContent = `מפת חום - ${this.lotName}`;
            if (detailsElement && this.lotCode && this.lotId) {
                detailsElement.textContent = `קוד: ${this.lotCode} | ID: ${this.lotId}`;
            }
        }
    }

    async testConnection() {
        try {
            this.updateDataStatus('בודק חיבור...', 'loading');
            const connected = await this.dataFetcher.testConnection();
            
            if (connected) {
                this.updateDataStatus('מחובר', 'success');
                return true;
            } else {
                this.updateDataStatus('שגיאת חיבור', 'error');
                return false;
            }
        } catch (error) {
            console.error('❌ Connection test failed:', error);
            this.updateDataStatus('שגיאת חיבור', 'error');
            return false;
        }
    }

    async loadHeatmap() {
        try {
            if (this.isComparison) {
                await this.loadComparisonHeatmap();
            } else {
                await this.loadSingleHeatmap();
            }
        } catch (error) {
            console.error('❌ Error loading heatmap:', error);
            const userMessage = ErrorHandler.handle(error, 'loadHeatmap');
            this.showError(userMessage);
            this.updateDataStatus('שגיאה בטעינה', 'error');
        }
    }

    async loadSingleHeatmap() {
        console.log(`🔄 Loading heatmap for: ${this.lotName}`);
        
        this.updateDataStatus('טוען נתונים...', 'loading');
        
        // Show loading in container
        const container = document.getElementById('heatmap-container');
        LoadingManager.show(container, `טוען נתוני ${this.lotName}...`);
        
        // Fetch data with pagination (increased to 10 days to include Friday night)
        const rawData = await this.dataFetcher.fetchLotData(this.lotName, 10);
        
        if (!rawData || rawData.length === 0) {
            throw new Error('לא נמצאו נתונים עבור החניון הנבחר');
        }
        
        this.updateDataStatus('מעבד נתונים...', 'loading');
        
        // Process data into heatmap format
        this.heatmapData = this.dataProcessor.processHeatmapData(rawData, this.lotName);
        
        console.log('✅ Heatmap data processed:', this.heatmapData);
        
        // Render heatmap
        this.renderHeatmap();
        
        // Show statistics
        this.showStatistics();
        
        this.updateDataStatus(`${rawData.length} רשומות נטענו`, 'success');
    }

    async loadComparisonHeatmap() {
        console.log(`🔄 Loading comparison between: ${this.lot1.name} and ${this.lot2.name}`);
        
        this.updateDataStatus('טוען נתוני השוואה...', 'loading');
        
        const container = document.getElementById('heatmap-container');
        LoadingManager.show(container, `טוען השוואה בין ${this.lot1.name} ל-${this.lot2.name}...`);
        
        // Fetch data for both lots (increased to 10 days to include Friday night)
        const [rawData1, rawData2] = await Promise.all([
            this.dataFetcher.fetchLotData(this.lot1.name, 10),
            this.dataFetcher.fetchLotData(this.lot2.name, 10)
        ]);
        
        if (!rawData1 || rawData1.length === 0 || !rawData2 || rawData2.length === 0) {
            throw new Error('לא נמצאו נתונים מספיקים עבור אחד מהחניונים');
        }
        
        this.updateDataStatus('מעבד נתונים להשוואה...', 'loading');
        
        // Process data for both lots
        const heatmapData1 = this.dataProcessor.processHeatmapData(rawData1, this.lot1.name);
        const heatmapData2 = this.dataProcessor.processHeatmapData(rawData2, this.lot2.name);
        
        this.comparisonData = {
            lot1: heatmapData1,
            lot2: heatmapData2
        };
        
        console.log('✅ Comparison data processed:', this.comparisonData);
        
        // Render comparison heatmap
        this.renderComparisonHeatmap();
        
        // Show comparison statistics
        this.showComparisonStatistics();
        
        this.updateDataStatus(`${rawData1.length + rawData2.length} רשומות נטענו`, 'success');
    }

    renderHeatmap() {
        const container = document.getElementById('heatmap-container');
        if (!container || !this.heatmapData) return;

        console.log('🎨 Rendering heatmap...');
        
        // Clear container
        container.innerHTML = '';
        
        // Create grid container
        const grid = document.createElement('div');
        grid.className = 'grid-container';
        grid.style.gridTemplateColumns = `60px repeat(${CONFIG.SLOTS_PER_DAY}, 1fr)`;
        
        // Add header row
        this.addHeaderRow(grid);
        
        // Add data rows
        this.addDataRows(grid);
        
        container.appendChild(grid);
        
        console.log('✅ Heatmap rendered successfully');
    }

    addHeaderRow(grid) {
        // Corner cell
        const cornerCell = document.createElement('div');
        cornerCell.className = 'time-label time-label-header';
        cornerCell.textContent = 'יום / שעה';
        grid.appendChild(cornerCell);
        
        // Time labels (every 6 slots = 2 hours)
        for (let s = 0; s < CONFIG.SLOTS_PER_DAY; s += 6) {
            const timeLabel = getTimeLabel(s);
            const span = document.createElement('div');
            span.className = 'time-label time-label-header';
            span.style.gridColumn = 'span 6';
            span.textContent = timeLabel;
            grid.appendChild(span);
        }
    }

    addDataRows(grid) {
        for (let d = 0; d < 7; d++) {
            // Day label
            const dayLabel = document.createElement('div');
            dayLabel.className = 'time-label';
            dayLabel.textContent = CONFIG.DAYS[d];
            grid.appendChild(dayLabel);
            
            // Data cells for this day
            const dayData = this.heatmapData.interpolated[d] || Array(CONFIG.SLOTS_PER_DAY).fill(0);
            
            for (let s = 0; s < CONFIG.SLOTS_PER_DAY; s++) {
                const value = dayData[s];
                const cell = document.createElement('div');
                cell.className = `heatmap-cell ${value === 0 ? 'status-empty' : `status-${value}`}`;
                
                // Add tooltip
                const timeLabel = getTimeLabel(s);
                const dayName = CONFIG.DAYS[d];
                const statusText = this.getStatusText(value);
                cell.title = `${this.lotName} - ${dayName} ${timeLabel} - ${statusText}`;
                
                grid.appendChild(cell);
            }
        }
    }

    renderComparisonHeatmap() {
        const container = document.getElementById('heatmap-container');
        if (!container || !this.comparisonData) return;

        console.log('🎨 Rendering comparison heatmap...');
        
        // Clear container
        container.innerHTML = '';
        
        // Create comparison container
        const comparisonContainer = document.createElement('div');
        comparisonContainer.className = 'comparison-container';
        
        // Create heatmap for lot 1
        const heatmap1 = this.createSingleHeatmap(this.comparisonData.lot1, this.lot1.name, '1');
        
        // Create heatmap for lot 2
        const heatmap2 = this.createSingleHeatmap(this.comparisonData.lot2, this.lot2.name, '2');
        
        comparisonContainer.appendChild(heatmap1);
        comparisonContainer.appendChild(heatmap2);
        container.appendChild(comparisonContainer);
        
        console.log('✅ Comparison heatmap rendered successfully');
    }

    createSingleHeatmap(heatmapData, lotName, lotNumber) {
        const wrapper = document.createElement('div');
        wrapper.className = `heatmap-wrapper lot-${lotNumber}`;
        
        const title = document.createElement('h3');
        title.className = 'heatmap-title';
        title.textContent = `${lotNumber}. ${lotName}`;
        wrapper.appendChild(title);
        
        const grid = document.createElement('div');
        grid.className = 'grid-container';
        grid.style.gridTemplateColumns = `60px repeat(${CONFIG.SLOTS_PER_DAY}, 1fr)`;
        
        // Add header row
        this.addHeaderRowToGrid(grid);
        
        // Add data rows for this specific heatmap
        this.addDataRowsToGrid(grid, heatmapData, lotName);
        
        wrapper.appendChild(grid);
        return wrapper;
    }

    addHeaderRowToGrid(grid) {
        // Corner cell
        const cornerCell = document.createElement('div');
        cornerCell.className = 'time-label time-label-header';
        cornerCell.textContent = 'יום / שעה';
        grid.appendChild(cornerCell);
        
        // Time labels (every 6 slots = 2 hours)
        for (let s = 0; s < CONFIG.SLOTS_PER_DAY; s += 6) {
            const timeLabel = getTimeLabel(s);
            const span = document.createElement('div');
            span.className = 'time-label time-label-header';
            span.style.gridColumn = 'span 6';
            span.textContent = timeLabel;
            grid.appendChild(span);
        }
    }

    addDataRowsToGrid(grid, heatmapData, lotName) {
        for (let d = 0; d < 7; d++) {
            // Day label
            const dayLabel = document.createElement('div');
            dayLabel.className = 'time-label';
            dayLabel.textContent = CONFIG.DAYS[d];
            grid.appendChild(dayLabel);
            
            // Data cells for this day
            const dayData = heatmapData.interpolated[d] || Array(CONFIG.SLOTS_PER_DAY).fill(0);
            
            for (let s = 0; s < CONFIG.SLOTS_PER_DAY; s++) {
                const value = dayData[s];
                const cell = document.createElement('div');
                cell.className = `heatmap-cell ${value === 0 ? 'status-empty' : `status-${value}`}`;
                
                // Add tooltip
                const timeLabel = getTimeLabel(s);
                const dayName = CONFIG.DAYS[d];
                const statusText = this.getStatusText(value);
                cell.title = `${lotName} - ${dayName} ${timeLabel} - ${statusText}`;
                
                grid.appendChild(cell);
            }
        }
    }

    showComparisonStatistics() {
        const statsSection = document.getElementById('stats-section');
        if (!statsSection || !this.comparisonData) return;
        
        // Calculate combined statistics
        const totalRecords = this.comparisonData.lot1.totalRecords + this.comparisonData.lot2.totalRecords;
        const daysCoverage1 = this.comparisonData.lot1.dayDistribution.filter(count => count > 0).length;
        const daysCoverage2 = this.comparisonData.lot2.dayDistribution.filter(count => count > 0).length;
        const lastUpdate = new Date().toLocaleString('he-IL');
        
        // Update DOM with comparison stats
        const totalElement = document.getElementById('total-records');
        const daysElement = document.getElementById('days-coverage');
        const updateElement = document.getElementById('last-update');
        
        if (totalElement) totalElement.textContent = totalRecords.toLocaleString();
        if (daysElement) daysElement.textContent = `${Math.max(daysCoverage1, daysCoverage2)}`;
        if (updateElement) updateElement.textContent = lastUpdate;
        
        // Show section
        statsSection.style.display = 'block';
        
        console.log('📊 Comparison statistics displayed:', {
            totalRecords,
            daysCoverage1,
            daysCoverage2,
            lastUpdate
        });
    }

    getStatusText(code) {
        const statusMap = {
            0: 'אין נתונים',
            1: 'פנוי',
            2: 'כמעט מלא',
            3: 'מלא',
            4: 'לא ידוע/כישלון'
        };
        return statusMap[code] || `קוד ${code}`;
    }

    showStatistics() {
        const statsSection = document.getElementById('stats-section');
        if (!statsSection || !this.heatmapData) return;
        
        // Calculate statistics
        const totalRecords = this.heatmapData.totalRecords;
        const daysCoverage = this.heatmapData.dayDistribution.filter(count => count > 0).length;
        const lastUpdate = new Date().toLocaleString('he-IL');
        
        // Update DOM
        const totalElement = document.getElementById('total-records');
        const daysElement = document.getElementById('days-coverage');
        const updateElement = document.getElementById('last-update');
        
        if (totalElement) totalElement.textContent = totalRecords.toLocaleString();
        if (daysElement) daysElement.textContent = daysCoverage;
        if (updateElement) updateElement.textContent = lastUpdate;
        
        // Show section
        statsSection.style.display = 'block';
        
        console.log('📊 Statistics displayed:', {
            totalRecords,
            daysCoverage,
            lastUpdate
        });
    }

    updateDataStatus(message, type) {
        const statusElement = document.getElementById('data-status');
        if (!statusElement) return;
        
        statusElement.textContent = message;
        statusElement.className = `data-status ${type}`;
    }

    showError(message) {
        const container = document.getElementById('heatmap-container');
        if (!container) return;
        
        container.innerHTML = `
            <div class="error-container">
                <div class="error-icon">⚠️</div>
                <h3>שגיאה בטעינת הנתונים</h3>
                <p>${message}</p>
                <button class="retry-btn" onclick="location.reload()">נסה שוב</button>
                <button class="back-btn" onclick="window.location.href='index.html'">חזרה לרשימת החניונים</button>
            </div>
        `;
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    console.log('🚀 Initializing Heatmap Viewer...');
    
    // Check if required libraries are loaded
    if (!window.supabase) {
        console.error('❌ Supabase library not loaded');
        document.getElementById('heatmap-container').innerHTML = `
            <div class="error-container">
                <div class="error-icon">⚠️</div>
                <h3>שגיאה בטעינת המערכת</h3>
                <p>ספריות נדרשות לא נטענו. אנא רענן את הדף.</p>
            </div>
        `;
        return;
    }
    
    if (!window.DataFetcher || !window.DataProcessor) {
        console.error('❌ Utility classes not loaded');
        document.getElementById('heatmap-container').innerHTML = `
            <div class="error-container">
                <div class="error-icon">⚠️</div>
                <h3>שגיאה בטעינת המערכת</h3>
                <p>כלי עזר לא נטענו. אנא רענן את הדף.</p>
            </div>
        `;
        return;
    }
    
    // Initialize heatmap viewer
    new HeatmapViewer();
});