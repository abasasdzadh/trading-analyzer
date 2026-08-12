/**
 * IndexedDB Storage Layer
 * Complete client-side persistence replacing Prisma/SQLite.
 *
 * Database: 'trading-platform', Version: 1
 * Object stores: settings, watchlist, watchlistItem, signal, alert,
 *                 backtest, backtestTrade, paperTrade, tradeJournal, aiRequest
 *
 * @namespace window.TradingStorage
 */

(function () {
  'use strict';

  var DB_NAME = 'trading-platform';
  var DB_VERSION = 1;
  var db = null;

  // ============================================================
  // Database Initialization
  // ============================================================

  /**
   * Open (or create) the IndexedDB database with all required object stores.
   * Must be called before any other operations.
   *
   * @returns {Promise<IDBDatabase>}
   */
  function init() {
    if (db) return Promise.resolve(db);

    return new Promise(function (resolve, reject) {
      var request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = function (event) {
        var database = event.target.result;

        // Settings — key-value store (key is unique)
        if (!database.objectStoreNames.contains('settings')) {
          var settingsStore = database.createObjectStore('settings', { keyPath: 'id' });
          settingsStore.createIndex('by_key', 'key', { unique: true });
        }

        // Watchlist
        if (!database.objectStoreNames.contains('watchlist')) {
          database.createObjectStore('watchlist', { keyPath: 'id' });
        }

        // WatchlistItem — linked to watchlist via watchlistId
        if (!database.objectStoreNames.contains('watchlistItem')) {
          var itemStore = database.createObjectStore('watchlistItem', { keyPath: 'id' });
          itemStore.createIndex('by_watchlistId', 'watchlistId', { unique: false });
          itemStore.createIndex('by_watchlistId_symbol', ['watchlistId', 'symbol'], { unique: false });
        }

        // Signal
        if (!database.objectStoreNames.contains('signal')) {
          var signalStore = database.createObjectStore('signal', { keyPath: 'id' });
          signalStore.createIndex('by_createdAt', 'createdAt', { unique: false });
        }

        // Alert
        if (!database.objectStoreNames.contains('alert')) {
          var alertStore = database.createObjectStore('alert', { keyPath: 'id' });
          alertStore.createIndex('by_symbol', 'symbol', { unique: false });
          alertStore.createIndex('by_active', 'active', { unique: false });
        }

        // Backtest
        if (!database.objectStoreNames.contains('backtest')) {
          var backtestStore = database.createObjectStore('backtest', { keyPath: 'id' });
          backtestStore.createIndex('by_createdAt', 'createdAt', { unique: false });
        }

        // BacktestTrade — linked to backtest via backtestId
        if (!database.objectStoreNames.contains('backtestTrade')) {
          var btTradeStore = database.createObjectStore('backtestTrade', { keyPath: 'id' });
          btTradeStore.createIndex('by_backtestId', 'backtestId', { unique: false });
        }

        // PaperTrade
        if (!database.objectStoreNames.contains('paperTrade')) {
          var paperStore = database.createObjectStore('paperTrade', { keyPath: 'id' });
          paperStore.createIndex('by_status', 'status', { unique: false });
          paperStore.createIndex('by_createdAt', 'createdAt', { unique: false });
        }

        // TradeJournal
        if (!database.objectStoreNames.contains('tradeJournal')) {
          var journalStore = database.createObjectStore('tradeJournal', { keyPath: 'id' });
          journalStore.createIndex('by_createdAt', 'createdAt', { unique: false });
        }

        // AiRequest
        if (!database.objectStoreNames.contains('aiRequest')) {
          var aiStore = database.createObjectStore('aiRequest', { keyPath: 'id' });
          aiStore.createIndex('by_createdAt', 'createdAt', { unique: false });
        }
      };

      request.onsuccess = function (event) {
        db = event.target.result;
        resolve(db);
      };

      request.onerror = function (event) {
        reject(event.target.error);
      };
    });
  }

  // ============================================================
  // Generic Helpers
  // ============================================================

  /**
 * Generate a CUID-like ID for new records.
* @returns {string}
*/
  function generateId() {
    var timestamp = Date.now().toString(36);
    var randomPart = Math.random().toString(36).substring(2, 10);
    var counter = (typeof cuidCounter !== 'undefined' ? ++cuidCounter : (cuidCounter = 1)).toString(36);
    return 'c' + timestamp + randomPart + counter;
  }
  var cuidCounter = 0;

  /**
   * Wrap an IDBRequest in a Promise.
   * @param {IDBRequest} request
   * @returns {Promise<*>}
   */
  function promisify(request) {
    return new Promise(function (resolve, reject) {
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error); };
    });
  }

  /**
   * Get a transaction and object store.
   * @param {string} storeName
   * @param {string} [mode='readonly']
   * @returns {{ tx: IDBTransaction, store: IDBObjectStore }}
   */
  function getStore(storeName, mode) {
    if (!mode) mode = 'readonly';
    var tx = db.transaction(storeName, mode);
    var store = tx.objectStore(storeName);
    return { tx: tx, store: store };
  }

  /**
   * Ensure the database is initialized before proceeding.
   * @returns {Promise<void>}
   */
  function ensureDB() {
    if (db) return Promise.resolve();
    return init();
  }

  // ============================================================
  // Settings
  // ============================================================

  /**
   * Get a setting value by key.
   * @param {string} key
   * @returns {Promise<string|null>} The stored value or null
   */
  function getSetting(key) {
    return ensureDB().then(function () {
      var ref = getStore('settings');
      var index = ref.store.index('by_key');
      return promisify(index.get(key)).then(function (record) {
        return record ? record.value : null;
      });
    });
  }

  /**
   * Set (upsert) a setting value.
   * @param {string} key
   * @param {string} value
   * @returns {Promise<void>}
   */
  function setSetting(key, value) {
    return ensureDB().then(function () {
      var ref = getStore('settings', 'readwrite');
      var index = ref.store.index('by_key');
      return promisify(index.get(key)).then(function (existing) {
        var record;
        if (existing) {
          record = existing;
          record.value = value;
          record.updatedAt = new Date().toISOString();
        } else {
          record = {
            id: generateId(),
            key: key,
            value: value,
            updatedAt: new Date().toISOString(),
          };
        }
        return promisify(ref.store.put(record));
      });
    });
  }

  // ============================================================
  // Watchlist
  // ============================================================

  /**
   * Get all watchlists with their items.
   * @returns {Promise<Object[]>} Array of watchlist objects with `items` array
   */
  function getWatchlists() {
    return ensureDB().then(function () {
      var ref = getStore('watchlist');
      return promisify(ref.store.getAll()).then(function (watchlists) {
        // Fetch all items
        var itemRef = getStore('watchlistItem');
        return promisify(itemRef.store.getAll()).then(function (items) {
          // Group items by watchlistId
          var itemsByWatchlist = {};
          for (var i = 0; i < items.length; i++) {
            var wlId = items[i].watchlistId;
            if (!itemsByWatchlist[wlId]) itemsByWatchlist[wlId] = [];
            itemsByWatchlist[wlId].push(items[i]);
          }
          // Attach items to watchlists
          for (var j = 0; j < watchlists.length; j++) {
            watchlists[j].items = itemsByWatchlist[watchlists[j].id] || [];
          }
          return watchlists;
        });
      });
    });
  }

  /**
   * Create a new watchlist.
   * @param {string} name
   * @returns {Promise<Object>} The created watchlist
   */
  function createWatchlist(name) {
    return ensureDB().then(function () {
      var record = {
        id: generateId(),
        name: name || 'Default',
        createdAt: new Date().toISOString(),
      };
      var ref = getStore('watchlist', 'readwrite');
      return promisify(ref.store.add(record)).then(function () { return record; });
    });
  }

  /**
   * Delete a watchlist and all its items (cascade).
   * @param {string} id
   * @returns {Promise<void>}
   */
  function deleteWatchlist(id) {
    return ensureDB().then(function () {
      // First delete all items belonging to this watchlist
      var itemRef = getStore('watchlistItem', 'readwrite');
      var index = itemRef.store.index('by_watchlistId');
      return promisify(index.getAll(id)).then(function (items) {
        var promises = [];
        for (var i = 0; i < items.length; i++) {
          promises.push(promisify(itemRef.store.delete(items[i].id)));
        }
        return Promise.all(promises);
      }).then(function () {
        // Then delete the watchlist itself
        var ref = getStore('watchlist', 'readwrite');
        return promisify(ref.store.delete(id));
      });
    });
  }

  /**
   * Add a symbol to a watchlist.
   * @param {string} watchlistId
   * @param {string} symbol
   * @returns {Promise<Object>} The created watchlist item
   */
  function addWatchlistItem(watchlistId, symbol) {
    return ensureDB().then(function () {
      var record = {
        id: generateId(),
        watchlistId: watchlistId,
        symbol: symbol,
        addedAt: new Date().toISOString(),
      };
      var ref = getStore('watchlistItem', 'readwrite');
      return promisify(ref.store.add(record)).then(function () { return record; });
    });
  }

  /**
   * Remove a symbol from a watchlist.
   * @param {string} watchlistId
   * @param {string} symbol
   * @returns {Promise<void>}
   */
  function removeWatchlistItem(watchlistId, symbol) {
    return ensureDB().then(function () {
      var ref = getStore('watchlistItem', 'readwrite');
      var index = ref.store.index('by_watchlistId_symbol');
      // IDBKeyRange for compound index
      var range = IDBKeyRange.only([watchlistId, symbol]);
      return promisify(index.getAll(range)).then(function (items) {
        var promises = [];
        for (var i = 0; i < items.length; i++) {
          promises.push(promisify(ref.store.delete(items[i].id)));
        }
        return Promise.all(promises);
      });
    });
  }

  // ============================================================
  // Signals
  // ============================================================

  /**
   * Save a signal object.
   * @param {Object} signal - Signal data (id will be generated if not provided)
   * @returns {Promise<Object>} The saved signal
   */
  function saveSignal(signal) {
    return ensureDB().then(function () {
      var record = Object.assign({}, signal, {
        id: signal.id || generateId(),
        createdAt: signal.createdAt || new Date().toISOString(),
        // Ensure JSON fields are stored as strings (matching Prisma schema)
        reasons: typeof signal.reasons === 'string' ? signal.reasons : JSON.stringify(signal.reasons || []),
        warnings: typeof signal.warnings === 'string' ? signal.warnings : JSON.stringify(signal.warnings || []),
        indicators: typeof signal.indicators === 'string' ? signal.indicators : JSON.stringify(signal.indicators || {}),
        aiAnalysis: signal.aiAnalysis ? (typeof signal.aiAnalysis === 'string' ? signal.aiAnalysis : JSON.stringify(signal.aiAnalysis)) : null,
      });
      var ref = getStore('signal', 'readwrite');
      return promisify(ref.store.put(record)).then(function () { return record; });
    });
  }

  /**
   * Get signals with pagination, ordered by createdAt descending.
   * @param {number} [limit=50]
   * @param {number} [offset=0]
   * @returns {Promise<Object[]>}
   */
  function getSignals(limit, offset) {
    if (limit === undefined) limit = 50;
    if (offset === undefined) offset = 0;
    return ensureDB().then(function () {
      var ref = getStore('signal');
      var index = ref.store.index('by_createdAt');
      return promisify(index.getAll()).then(function (all) {
        // Sort descending by createdAt
        all.sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); });
        return all.slice(offset, offset + limit);
      });
    });
  }

  /**
   * Delete a signal by ID.
   * @param {string} id
   * @returns {Promise<void>}
   */
  function deleteSignal(id) {
    return ensureDB().then(function () {
      var ref = getStore('signal', 'readwrite');
      return promisify(ref.store.delete(id));
    });
  }

  // ============================================================
  // Alerts
  // ============================================================

  /**
   * Save an alert configuration.
   * @param {Object} alert - Alert data (id will be generated if not provided)
   * @returns {Promise<Object>} The saved alert
   */
  function saveAlert(alert) {
    return ensureDB().then(function () {
      var record = Object.assign({}, alert, {
        id: alert.id || generateId(),
        createdAt: alert.createdAt || new Date().toISOString(),
        condition: typeof alert.condition === 'string' ? alert.condition : JSON.stringify(alert.condition),
      });
      var ref = getStore('alert', 'readwrite');
      return promisify(ref.store.put(record)).then(function () { return record; });
    });
  }

  /**
   * Get all alerts.
   * @returns {Promise<Object[]>}
   */
  function getAlerts() {
    return ensureDB().then(function () {
      var ref = getStore('alert');
      return promisify(ref.store.getAll());
    });
  }

  /**
   * Update an existing alert by ID.
   * @param {string} id
   * @param {Object} updates - Partial alert fields to update
   * @returns {Promise<Object>} The updated alert
   */
  function updateAlert(id, updates) {
    return ensureDB().then(function () {
      var ref = getStore('alert', 'readwrite');
      return promisify(ref.store.get(id)).then(function (existing) {
        if (!existing) throw new Error('Alert not found: ' + id);
        var updated = Object.assign({}, existing, updates, { id: id });
        return promisify(ref.store.put(updated)).then(function () { return updated; });
      });
    });
  }

  /**
   * Delete an alert by ID.
   * @param {string} id
   * @returns {Promise<void>}
   */
  function deleteAlert(id) {
    return ensureDB().then(function () {
      var ref = getStore('alert', 'readwrite');
      return promisify(ref.store.delete(id));
    });
  }

  // ============================================================
  // Backtest
  // ============================================================

  /**
   * Save a backtest result and its associated trades.
   * @param {Object} result - Full BacktestResult object (id will be generated if not provided)
   * @returns {Promise<Object>} The saved backtest (without trades array on the record)
   */
  function saveBacktest(result) {
    return ensureDB().then(function () {
      var id = result.id || generateId();
      var now = new Date().toISOString();

      // Flatten the backtest result for storage (matching Prisma schema)
      var record = {
        id: id,
        symbol: result.config ? result.config.symbol : '',
        timeframe: result.config ? result.config.timeframe : '',
        strategy: result.config ? (result.config.strategy || 'default') : 'default',
        startDate: result.config ? result.config.startDate : '',
        endDate: result.config ? result.config.endDate : '',
        initialCapital: result.initialCapital || 0,
        finalCapital: result.finalCapital || 0,
        netProfit: result.netProfit || 0,
        netProfitPct: result.netProfitPct || 0,
        totalTrades: result.totalTrades || 0,
        winningTrades: result.winningTrades || 0,
        losingTrades: result.losingTrades || 0,
        winRate: result.winRate || 0,
        avgWin: result.avgWin || 0,
        avgLoss: result.avgLoss || 0,
        profitFactor: result.profitFactor || 0,
        maxDrawdown: result.maxDrawdown || 0,
        maxDrawdownPct: result.maxDrawdownPct || 0,
        sharpeRatio: result.sharpeRatio !== null && result.sharpeRatio !== undefined ? result.sharpeRatio : null,
        avgRiskReward: result.avgRiskReward || 0,
        largestWin: result.largestWin || 0,
        largestLoss: result.largestLoss || 0,
        createdAt: now,
      };

      // Save the backtest record
      var ref = getStore('backtest', 'readwrite');
      return promisify(ref.store.put(record)).then(function () {
        // Save associated trades
        var tradePromises = [];
        var trades = result.trades || [];
        for (var i = 0; i < trades.length; i++) {
          var trade = Object.assign({}, trades[i], {
            id: generateId(),
            backtestId: id,
          });
          tradePromises.push(saveBacktestTradeInternal(trade));
        }
        return Promise.all(tradePromises).then(function () { return record; });
      });
    });
  }

  /**
   * Internal helper to save a single backtest trade.
   * @param {Object} trade
   * @returns {Promise<Object>}
   */
  function saveBacktestTradeInternal(trade) {
    var ref = getStore('backtestTrade', 'readwrite');
    return promisify(ref.store.put(trade)).then(function () { return trade; });
  }

  /**
   * Get all backtests, ordered by createdAt descending.
   * @returns {Promise<Object[]>}
   */
  function getBacktests() {
    return ensureDB().then(function () {
      var ref = getStore('backtest');
      var index = ref.store.index('by_createdAt');
      return promisify(index.getAll()).then(function (all) {
        all.sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); });
        return all;
      });
    });
  }

  /**
   * Delete a backtest and all its associated trades (cascade).
   * @param {string} id
   * @returns {Promise<void>}
   */
  function deleteBacktest(id) {
    return ensureDB().then(function () {
      // Delete all trades belonging to this backtest
      var tradeRef = getStore('backtestTrade', 'readwrite');
      var index = tradeRef.store.index('by_backtestId');
      return promisify(index.getAll(id)).then(function (trades) {
        var promises = [];
        for (var i = 0; i < trades.length; i++) {
          promises.push(promisify(tradeRef.store.delete(trades[i].id)));
        }
        return Promise.all(promises);
      }).then(function () {
        // Delete the backtest itself
        var ref = getStore('backtest', 'readwrite');
        return promisify(ref.store.delete(id));
      });
    });
  }

  // ============================================================
  // Paper Trades
  // ============================================================

  /**
   * Save a paper trade.
   * @param {Object} trade - Paper trade data
   * @returns {Promise<Object>} The saved paper trade
   */
  function savePaperTrade(trade) {
    return ensureDB().then(function () {
      var record = Object.assign({}, trade, {
        id: trade.id || generateId(),
        status: trade.status || 'OPEN',
        createdAt: trade.createdAt || new Date().toISOString(),
      });
      var ref = getStore('paperTrade', 'readwrite');
      return promisify(ref.store.put(record)).then(function () { return record; });
    });
  }

  /**
   * Get all paper trades.
   * @returns {Promise<Object[]>}
   */
  function getPaperTrades() {
    return ensureDB().then(function () {
      var ref = getStore('paperTrade');
      return promisify(ref.store.getAll());
    });
  }

  /**
   * Update a paper trade by ID.
   * @param {string} id
   * @param {Object} updates - Partial fields to update
   * @returns {Promise<Object>} The updated paper trade
   */
  function updatePaperTrade(id, updates) {
    return ensureDB().then(function () {
      var ref = getStore('paperTrade', 'readwrite');
      return promisify(ref.store.get(id)).then(function (existing) {
        if (!existing) throw new Error('PaperTrade not found: ' + id);
        var updated = Object.assign({}, existing, updates, { id: id });
        return promisify(ref.store.put(updated)).then(function () { return updated; });
      });
    });
  }

  // ============================================================
  // Trade Journal
  // ============================================================

  /**
   * Save a trade journal entry.
   * @param {Object} entry - Journal entry data
   * @returns {Promise<Object>} The saved entry
   */
  function saveJournalEntry(entry) {
    return ensureDB().then(function () {
      var record = Object.assign({}, entry, {
        id: entry.id || generateId(),
        createdAt: entry.createdAt || new Date().toISOString(),
      });
      var ref = getStore('tradeJournal', 'readwrite');
      return promisify(ref.store.put(record)).then(function () { return record; });
    });
  }

  /**
   * Get all trade journal entries, ordered by createdAt descending.
   * @returns {Promise<Object[]>}
   */
  function getJournalEntries() {
    return ensureDB().then(function () {
      var ref = getStore('tradeJournal');
      var index = ref.store.index('by_createdAt');
      return promisify(index.getAll()).then(function (all) {
        all.sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); });
        return all;
      });
    });
  }

  // ============================================================
  // AI Requests (cache)
  // ============================================================

  /**
   * Save an AI request/response for caching.
   * @param {Object} request - AI request data
   * @returns {Promise<Object>} The saved request
   */
  function saveAIRequest(request) {
    return ensureDB().then(function () {
      var record = Object.assign({}, request, {
        id: request.id || generateId(),
        createdAt: request.createdAt || new Date().toISOString(),
      });
      var ref = getStore('aiRequest', 'readwrite');
      return promisify(ref.store.put(record)).then(function () { return record; });
    });
  }

  /**
   * Get recent AI requests, ordered by createdAt descending.
   * @param {number} [limit=20]
   * @returns {Promise<Object[]>}
   */
  function getAIRequests(limit) {
    if (limit === undefined) limit = 20;
    return ensureDB().then(function () {
      var ref = getStore('aiRequest');
      var index = ref.store.index('by_createdAt');
      return promisify(index.getAll()).then(function (all) {
        all.sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); });
        return all.slice(0, limit);
      });
    });
  }

  // ─── Export ──────────────────────────────────────────────────────────────────

  window.TradingStorage = {
    // Initialize
    init: init,

    // Settings
    getSetting: getSetting,
    setSetting: setSetting,

    // Watchlist
    getWatchlists: getWatchlists,
    createWatchlist: createWatchlist,
    deleteWatchlist: deleteWatchlist,
    addWatchlistItem: addWatchlistItem,
    removeWatchlistItem: removeWatchlistItem,

    // Signals
    saveSignal: saveSignal,
    getSignals: getSignals,
    deleteSignal: deleteSignal,

    // Alerts
    saveAlert: saveAlert,
    getAlerts: getAlerts,
    updateAlert: updateAlert,
    deleteAlert: deleteAlert,

    // Backtest
    saveBacktest: saveBacktest,
    getBacktests: getBacktests,
    deleteBacktest: deleteBacktest,

    // Paper Trades
    savePaperTrade: savePaperTrade,
    getPaperTrades: getPaperTrades,
    updatePaperTrade: updatePaperTrade,

    // Trade Journal
    saveJournalEntry: saveJournalEntry,
    getJournalEntries: getJournalEntries,

    // AI Requests
    saveAIRequest: saveAIRequest,
    getAIRequests: getAIRequests,
  };

})();
