// Lot selector functionality
class LotSelector {
    constructor() {
        this.allLots = [];
        this.filteredLots = [];
        this.selectedLots = [];
        this.searchInput = null;
        this.clearBtn = null;
        this.lotsGrid = null;
        this.lotCount = null;
        this.compareBtn = null;
        this.selectionMode = false;
        
        this.init();
    }

    async init() {
        // Get DOM elements
        this.searchInput = document.getElementById('search-input');
        this.clearBtn = document.getElementById('clear-search');
        this.lotsGrid = document.getElementById('lots-grid');
        this.lotCount = document.getElementById('lot-count');
        this.compareBtn = document.getElementById('compare-btn');

        // Set up event listeners
        this.setupEventListeners();

        // Load lots data
        await this.loadLots();
        
        // Render lots
        this.renderLots();
    }

    setupEventListeners() {
        // Search input
        this.searchInput.addEventListener('input', (e) => {
            this.filterLots(e.target.value);
            this.toggleClearButton(e.target.value);
        });

        // Clear button
        this.clearBtn.addEventListener('click', () => {
            this.clearSearch();
        });

        // Compare button
        if (this.compareBtn) {
            this.compareBtn.addEventListener('click', () => {
                this.toggleSelectionMode();
            });
        }

        // Initialize compare status
        this.updateCompareUI();

        // Enter key for search
        this.searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.filterLots(this.searchInput.value);
            }
        });
    }

    async loadLots() {
        try {
            console.log('📊 Loading lots data from JSON file...');
            
            const response = await fetch('./data/lots-data.json');
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json();
            // Sort lots alphabetically by Hebrew name
            this.allLots = data.parking_lots.active.sort((a, b) => a.name.localeCompare(b.name, 'he'));
            this.filteredLots = [...this.allLots];
            
            console.log(`✅ Loaded ${this.allLots.length} parking lots (sorted alphabetically)`);
            
            // Update count
            this.updateLotCount();
            
        } catch (error) {
            console.error('❌ Error loading lots data:', error);
            this.showError('שגיאה בטעינת נתוני החניונים');
        }
    }

    filterLots(searchTerm) {
        const term = searchTerm.trim().toLowerCase();
        
        if (!term) {
            this.filteredLots = [...this.allLots];
        } else {
            this.filteredLots = this.allLots.filter(lot => 
                lot.name.toLowerCase().includes(term) ||
                lot.code_achoza.toString().includes(term) ||
                lot.website_id.toString().includes(term)
            );
        }
        
        console.log(`🔍 Search: "${searchTerm}" - Found ${this.filteredLots.length} results`);
        
        this.updateLotCount();
        this.renderLots();
    }

    toggleClearButton(value) {
        if (value.length > 0) {
            this.clearBtn.classList.add('visible');
        } else {
            this.clearBtn.classList.remove('visible');
        }
    }

    clearSearch() {
        this.searchInput.value = '';
        this.clearBtn.classList.remove('visible');
        this.filteredLots = [...this.allLots];
        this.updateLotCount();
        this.renderLots();
        this.searchInput.focus();
    }

    updateLotCount() {
        if (this.lotCount) {
            this.lotCount.textContent = this.filteredLots.length;
        }
    }

    renderLots() {
        if (!this.lotsGrid) return;

        // Clear current content
        this.lotsGrid.innerHTML = '';

        if (this.filteredLots.length === 0) {
            this.showNoResults();
            return;
        }

        // Create lot cards
        this.filteredLots.forEach(lot => {
            const lotCard = this.createLotCard(lot);
            this.lotsGrid.appendChild(lotCard);
        });
    }

    createLotCard(lot) {
        const card = document.createElement('div');
        card.className = 'lot-card';
        card.setAttribute('data-lot-name', lot.name);
        
        // Generate a parking icon based on lot name
        const icon = this.getLotIcon(lot.name);
        
        const isSelected = this.selectedLots.some(selected => selected.name === lot.name);
        const selectedClass = isSelected ? 'selected' : '';
        
        card.innerHTML = `
            <div class="lot-icon">${icon}</div>
            <div class="lot-name">${lot.name}</div>
            <div class="lot-details">
                <span>קוד: ${lot.code_achoza}</span>
                <span>ID: ${lot.website_id}</span>
            </div>
            ${this.selectionMode ?
                `<button class="select-btn ${selectedClass}">${isSelected ? 'בוטל' : 'בחר'}</button>` :
                `<button class="view-btn">צפה במפת החום</button>`
            }
        `;

        // Add click event
        card.addEventListener('click', (e) => {
            if (this.selectionMode) {
                this.toggleLotSelection(lot, card);
            } else {
                this.navigateToHeatmap(lot);
            }
        });

        if (isSelected) {
            card.classList.add('selected');
        }

        return card;
    }

    getLotIcon(lotName) {
        // Simple icon mapping based on lot name keywords
        const name = lotName.toLowerCase();
        
        if (name.includes('מזרח') || name.includes('מערב')) return '🧭';
        if (name.includes('צפון') || name.includes('דרום')) return '🧭';
        if (name.includes('תחנה')) return '🚉';
        if (name.includes('חוף') || name.includes('ים')) return '🏖️';
        if (name.includes('גן') || name.includes('פארק')) return '🌳';
        if (name.includes('מוזיאון')) return '🏛️';
        if (name.includes('מכללה') || name.includes('אוניברסיטה')) return '🎓';
        if (name.includes('תרבות')) return '🎭';
        if (name.includes('רפואה') || name.includes('רפואי') || name.includes('אסותא')) return '🏥';
        if (name.includes('כרמל')) return '⛰️';
        if (name.includes('יפו')) return '🌊';
        if (name.includes('תל')) return '🏙️';
        
        return '🅿️'; // Default parking icon
    }

    toggleSelectionMode() {
        this.selectionMode = !this.selectionMode;
        
        if (this.selectionMode) {
            this.compareBtn.textContent = 'בטל השוואה';
            this.compareBtn.classList.add('active');
            document.getElementById('compare-status').style.display = 'block';
        } else {
            this.compareBtn.textContent = 'השווה חניונים';
            this.compareBtn.classList.remove('active');
            this.selectedLots = [];
            document.getElementById('compare-status').style.display = 'none';
        }
        
        this.renderLots();
        this.updateCompareUI();
    }

    toggleLotSelection(lot, card) {
        const existingIndex = this.selectedLots.findIndex(selected => selected.name === lot.name);
        
        if (existingIndex >= 0) {
            // Remove from selection
            this.selectedLots.splice(existingIndex, 1);
            card.classList.remove('selected');
            card.querySelector('.select-btn').textContent = 'בחר';
            card.querySelector('.select-btn').classList.remove('selected');
        } else if (this.selectedLots.length < 2) {
            // Add to selection (max 2)
            this.selectedLots.push(lot);
            card.classList.add('selected');
            card.querySelector('.select-btn').textContent = 'בוטל';
            card.querySelector('.select-btn').classList.add('selected');
        }
        
        this.updateCompareUI();
    }

    updateCompareUI() {
        const compareStatus = document.getElementById('compare-status');
        if (!compareStatus) return;
        
        if (this.selectedLots.length === 0) {
            compareStatus.textContent = 'בחר עד 2 חניונים להשוואה';
            compareStatus.className = 'compare-status';
        } else if (this.selectedLots.length === 1) {
            compareStatus.textContent = `נבחר: ${this.selectedLots[0].name} (בחר עוד 1)`;
            compareStatus.className = 'compare-status partial';
        } else if (this.selectedLots.length === 2) {
            compareStatus.innerHTML = `
                <span>נבחרו: ${this.selectedLots[0].name}, ${this.selectedLots[1].name}</span>
                <button class="start-compare-btn" id="start-compare-btn">התחל השוואה</button>
            `;
            compareStatus.className = 'compare-status ready';
            
            // Add event listener to the new button
            const startBtn = document.getElementById('start-compare-btn');
            if (startBtn) {
                startBtn.addEventListener('click', () => {
                    this.startComparison();
                });
            }
        }
    }

    startComparison() {
        if (this.selectedLots.length !== 2) return;
        
        console.log(`🔄 Starting comparison between: ${this.selectedLots[0].name} and ${this.selectedLots[1].name}`);
        
        const params = new URLSearchParams({
            lot1: this.selectedLots[0].name,
            code1: this.selectedLots[0].code_achoza,
            id1: this.selectedLots[0].website_id,
            lot2: this.selectedLots[1].name,
            code2: this.selectedLots[1].code_achoza,
            id2: this.selectedLots[1].website_id,
            compare: 'true'
        });
        
        window.location.href = `heatmap.html?${params.toString()}`;
    }

    navigateToHeatmap(lot) {
        console.log(`🚀 Navigating to heatmap for: ${lot.name}`);
        
        // Create URL with lot information
        const params = new URLSearchParams({
            lot: lot.name,
            code: lot.code_achoza,
            id: lot.website_id
        });
        
        // Navigate to heatmap page
        window.location.href = `heatmap.html?${params.toString()}`;
    }

    showNoResults() {
        const searchTerm = this.searchInput.value.trim();
        
        this.lotsGrid.innerHTML = `
            <div class="no-results">
                <div class="no-results-icon">🔍</div>
                <h3>לא נמצאו תוצאות</h3>
                <p>לא נמצאו חניונים המתאימים לחיפוש "${searchTerm}"</p>
                <p>נסה לחפש במילים אחרות או בדוק את האיות</p>
            </div>
        `;
    }

    showError(message) {
        this.lotsGrid.innerHTML = `
            <div class="no-results">
                <div class="no-results-icon">⚠️</div>
                <h3>שגיאה בטעינת הנתונים</h3>
                <p>${message}</p>
                <p>אנא רענן את הדף ונסה שוב</p>
            </div>
        `;
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    console.log('🚀 Initializing Lot Selector...');
    new LotSelector();
});