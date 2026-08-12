/**
 * AI Trading Analysis Platform — Main Application
 * Single Page Application (SPA) managing all pages, routing, charts,
 * WebSocket connections, and user interactions.
 *
 * @namespace window.App
 * @requires TradingConfig, BinanceProvider, TradingIndicators,
 *           TradingMarketStructure, TradingPatterns, TradingStrategies,
 *           TradingSignalEngine, TradingRisk, TradingAI,
 *           TradingBacktest, TradingStorage
 */

(function () {
  'use strict';

  // ════════════════════════════════════════════════════════════════════════════
  // STATE
  // ════════════════════════════════════════════════════════════════════════════

  var state = {
    currentPage: 'dashboard',
    selectedSymbol: 'BTCUSDT',
    selectedTimeframe: '1h',
    candles: [],
    tickers: [],
    currentSignal: null,
    recentSignals: [],
    isLoading: false,
    isAnalyzing: false,
    isScanning: false,
    isBacktesting: false,
    scannerResults: [],
    backtestResult: null,
    backtestConfig: {
      symbol: 'BTCUSDT',
      timeframe: '1h',
      startDate: '',
      endDate: '',
      strategy: 'all',
      initialCapital: 10000,
      riskPerTrade: 1,
    },
    alertConfigs: [],
    triggeredAlerts: [],
    config: {},
    chart: null,
    chartSeries: {},
    ws: null,
    wsDebounce: null,
    settingsTab: 'general',
    signalsFilter: 'ALL',
    scannerSort: 'score',
  };

  // ════════════════════════════════════════════════════════════════════════════
  // HELPERS
  // ════════════════════════════════════════════════════════════════════════════

  /** Format a number for display */
  function fmt(n, decimals) {
    if (n === null || n === undefined || isNaN(n)) return '--';
    decimals = decimals !== undefined ? decimals : 2;
    return Number(n).toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  }

  /** Format price based on magnitude */
  function fmtPrice(price) {
    if (price === null || price === undefined || isNaN(price)) return '--';
    if (price >= 1000) return fmt(price, 2);
    if (price >= 1) return fmt(price, 4);
    if (price >= 0.01) return fmt(price, 6);
    return fmt(price, 8);
  }

  /** Format volume in human-readable form */
  function fmtVolume(vol) {
    if (vol === null || vol === undefined) return '--';
    if (vol >= 1e9) return (vol / 1e9).toFixed(2) + 'B';
    if (vol >= 1e6) return (vol / 1e6).toFixed(2) + 'M';
    if (vol >= 1e3) return (vol / 1e3).toFixed(1) + 'K';
    return fmt(vol, 0);
  }

  /** Format percentage with sign */
  function fmtPct(pct) {
    if (pct === null || pct === undefined || isNaN(pct)) return '--';
    var sign = pct >= 0 ? '+' : '';
    return sign + pct.toFixed(2) + '%';
  }

  /** Format a timestamp to a readable string */
  function fmtDate(ts) {
    if (!ts) return '--';
    var d = new Date(ts);
    return d.toLocaleString('en-US', {
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  }

  /** Debounce a function */
  function debounce(fn, ms) {
    var timer;
    return function () {
      var args = arguments;
      var ctx = this;
      clearTimeout(timer);
      timer = setTimeout(function () { fn.apply(ctx, args); }, ms);
    };
  }

  /** Escape HTML to prevent XSS */
  function escHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /** Get DOM element safely */
  function $(sel) { return document.querySelector(sel); }
  function $$(sel) { return document.querySelectorAll(sel); }

  // ════════════════════════════════════════════════════════════════════════════
  // TOAST SYSTEM
  // ════════════════════════════════════════════════════════════════════════════

  function showToast(message, type) {
    type = type || 'info';
    var container = $('#toast-container');
    if (!container) return;

    var icons = {
      success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>',
      error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
      warning: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
      info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
    };

    var el = document.createElement('div');
    el.className = 'toast toast-' + type;
    el.innerHTML =
      '<span class="toast-icon">' + (icons[type] || icons.info) + '</span>' +
      '<span class="toast-message">' + escHtml(message) + '</span>';

    container.appendChild(el);

    // Trigger animation
    requestAnimationFrame(function () {
      el.classList.add('toast-visible');
    });

    setTimeout(function () {
      el.classList.remove('toast-visible');
      el.classList.add('toast-exit');
      setTimeout(function () {
        if (el.parentNode) el.parentNode.removeChild(el);
      }, 350);
    }, 4000);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // MODAL SYSTEM
  // ════════════════════════════════════════════════════════════════════════════

  function showModal(title, contentHtml, footerHtml) {
    var overlay = $('#modal-overlay');
    var titleEl = $('#modal-title');
    var bodyEl = $('#modal-body');
    var footerEl = $('#modal-footer');

    if (!overlay) return;

    titleEl.textContent = title || 'Detail';
    bodyEl.innerHTML = contentHtml || '';
    footerEl.innerHTML = footerHtml || '';

    overlay.classList.remove('hidden');
    overlay.classList.add('visible');
  }

  function closeModal() {
    var overlay = $('#modal-overlay');
    if (!overlay) return;
    overlay.classList.remove('visible');
    overlay.classList.add('hidden');
  }

  // ════════════════════════════════════════════════════════════════════════════
  // NAVIGATION
  // ════════════════════════════════════════════════════════════════════════════

  function navigate(page) {
    state.currentPage = page;

    // Update sidebar active state
    var navItems = $$('.sidebar-nav .nav-item');
    for (var i = 0; i < navItems.length; i++) {
      navItems[i].classList.toggle('active', navItems[i].getAttribute('data-page') === page);
    }

    // Show/hide pages
    var pages = $$('.page');
    for (var j = 0; j < pages.length; j++) {
      var p = pages[j];
      p.classList.toggle('active', p.id === 'page-' + page);
    }

    // Render page content
    switch (page) {
      case 'dashboard': renderDashboard(); break;
      case 'chart': renderChart(); break;
      case 'scanner': renderScanner(); break;
      case 'signals': renderSignals(); break;
      case 'backtest': renderBacktest(); break;
      case 'settings': renderSettings(); break;
    }

    // Close mobile sidebar
    closeMobileSidebar();
  }

  // ════════════════════════════════════════════════════════════════════════════
  // INITIALIZATION
  // ════════════════════════════════════════════════════════════════════════════

  async function init() {
    try {
      // Deep-clone default config
      state.config = JSON.parse(JSON.stringify(window.TradingConfig.DEFAULT_CONFIG));

      // Initialize storage
      await window.TradingStorage.init();

      // Load saved settings from localStorage
      loadSavedSettings();

      // Populate symbol select
      populateSymbolSelect();

      // Populate timeframe buttons
      populateTimeframeButtons();

      // Set up event listeners
      setupEventListeners();

      // Load default symbol data
      await loadMarketData();

      // Load recent signals
      await loadRecentSignals();

      // Navigate to dashboard
      navigate('dashboard');

      // Start WebSocket
      startWebSocket();

      // Load tickers for dashboard
      loadTickers();

      showToast('Platform initialized successfully', 'success');
    } catch (err) {
      console.error('Init error:', err);
      showToast('Failed to initialize platform: ' + err.message, 'error');
    }
  }

  /** Load settings from localStorage */
  function loadSavedSettings() {
    try {
      var saved = localStorage.getItem('trading-platform-settings');
      if (saved) {
        var parsed = JSON.parse(saved);
        if (parsed.config) {
          // Merge saved config into state
          deepMerge(state.config, parsed.config);
        }
        if (parsed.symbol) state.selectedSymbol = parsed.symbol;
        if (parsed.timeframe) state.selectedTimeframe = parsed.timeframe;
        if (parsed.ai) {
          if (!state.config.ai) state.config.ai = {};
          Object.assign(state.config.ai, parsed.ai);
        }
      }

      // Load AI config separately from localStorage for security
      var aiKey = localStorage.getItem('trading-platform-ai-key');
      if (aiKey && state.config.ai) {
        state.config.ai.apiKey = aiKey;
      }
    } catch (e) {
      console.warn('Failed to load saved settings:', e);
    }
  }

  /** Deep merge source into target */
  function deepMerge(target, source) {
    for (var key in source) {
      if (!source.hasOwnProperty(key)) continue;
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key]) &&
          target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])) {
        deepMerge(target[key], source[key]);
      } else {
        target[key] = source[key];
      }
    }
  }

  /** Populate the symbol select dropdown */
  function populateSymbolSelect() {
    var select = $('#symbol-select');
    if (!select) return;

    select.innerHTML = '';
    var symbols = window.TradingConfig.DEFAULT_SYMBOLS;
    for (var i = 0; i < symbols.length; i++) {
      var opt = document.createElement('option');
      opt.value = symbols[i];
      opt.textContent = symbols[i].replace('USDT', '/USDT');
      if (symbols[i] === state.selectedSymbol) opt.selected = true;
      select.appendChild(opt);
    }
  }

  /** Populate timeframe buttons in header */
  function populateTimeframeButtons() {
    var container = $('#timeframe-selector');
    if (!container) return;

    container.innerHTML = '';
    var tfs = window.TradingConfig.TIMEFRAMES;
    for (var i = 0; i < tfs.length; i++) {
      var btn = document.createElement('button');
      btn.className = 'tf-btn' + (tfs[i].value === state.selectedTimeframe ? ' active' : '');
      btn.setAttribute('data-tf', tfs[i].value);
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-selected', tfs[i].value === state.selectedTimeframe ? 'true' : 'false');
      btn.textContent = tfs[i].label;
      container.appendChild(btn);
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // EVENT LISTENERS
  // ════════════════════════════════════════════════════════════════════════════

  function setupEventListeners() {
    // Sidebar nav clicks
    var navItems = $$('.sidebar-nav .nav-item');
    for (var i = 0; i < navItems.length; i++) {
      navItems[i].addEventListener('click', function () {
        var page = this.getAttribute('data-page');
        if (page) navigate(page);
      });
      navItems[i].addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          var page = this.getAttribute('data-page');
          if (page) navigate(page);
        }
      });
    }

    // Symbol select change
    var symbolSelect = $('#symbol-select');
    if (symbolSelect) {
      symbolSelect.addEventListener('change', function () {
        updateSymbol(this.value);
      });
    }

    // Timeframe button clicks (delegated)
    var tfContainer = $('#timeframe-selector');
    if (tfContainer) {
      tfContainer.addEventListener('click', function (e) {
        var btn = e.target.closest('.tf-btn');
        if (btn) {
          updateTimeframe(btn.getAttribute('data-tf'));
        }
      });
    }

    // Analyze button
    var analyzeBtn = $('#analyze-btn');
    if (analyzeBtn) {
      analyzeBtn.addEventListener('click', function () {
        analyzeSymbol();
      });
    }

    // Modal close button
    var modalClose = $('#modal-close');
    if (modalClose) {
      modalClose.addEventListener('click', closeModal);
    }

    // Modal overlay click to close
    var modalOverlay = $('#modal-overlay');
    if (modalOverlay) {
      modalOverlay.addEventListener('click', function (e) {
        if (e.target === this) closeModal();
      });
    }

    // Escape key to close modal
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeModal();
    });

    // Mobile sidebar toggle
    var sidebarToggle = $('#sidebar-toggle');
    if (sidebarToggle) {
      sidebarToggle.addEventListener('click', toggleMobileSidebar);
    }

    var sidebarBackdrop = $('#sidebar-backdrop');
    if (sidebarBackdrop) {
      sidebarBackdrop.addEventListener('click', closeMobileSidebar);
    }
  }

  function toggleMobileSidebar() {
    document.body.classList.toggle('sidebar-open');
  }

  function closeMobileSidebar() {
    document.body.classList.remove('sidebar-open');
  }

  // ════════════════════════════════════════════════════════════════════════════
  // SYMBOL & TIMEFRAME UPDATES
  // ════════════════════════════════════════════════════════════════════════════

  async function updateSymbol(symbol) {
    state.selectedSymbol = symbol;
    state.currentSignal = null;

    // Update timeframe button active state
    var btns = $$('.tf-btn');
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.toggle('active', btns[i].getAttribute('data-tf') === state.selectedTimeframe);
    }

    await loadMarketData();
    startWebSocket();

    // Re-render current page
    switch (state.currentPage) {
      case 'dashboard': renderDashboard(); break;
      case 'chart': renderChart(); break;
    }
  }

  async function updateTimeframe(tf) {
    state.selectedTimeframe = tf;
    state.currentSignal = null;

    // Update button active state
    var btns = $$('.tf-btn');
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.toggle('active', btns[i].getAttribute('data-tf') === tf);
      btns[i].setAttribute('aria-selected', btns[i].getAttribute('data-tf') === tf ? 'true' : 'false');
    }

    await loadMarketData();
    startWebSocket();

    // Re-render current page
    switch (state.currentPage) {
      case 'dashboard': renderDashboard(); break;
      case 'chart': renderChart(); break;
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // MARKET DATA LOADING
  // ════════════════════════════════════════════════════════════════════════════

  async function loadMarketData() {
    state.isLoading = true;
    updatePriceDisplay();

    try {
      var candles = await window.BinanceProvider.getKlines(state.selectedSymbol, state.selectedTimeframe, 500);
      state.candles = candles;

      // Update price display
      updatePriceDisplay();

      // If on chart page, render chart
      if (state.currentPage === 'chart') {
        renderChartWidget();
      }
    } catch (err) {
      console.error('Failed to load market data:', err);
      showToast('Failed to load market data: ' + err.message, 'error');
    } finally {
      state.isLoading = false;
    }
  }

  async function loadTickers() {
    try {
      var tickers = [];
      var symbols = window.TradingConfig.DEFAULT_SYMBOLS;

      // Batch fetch tickers with rate limiting
      for (var i = 0; i < symbols.length; i++) {
        try {
          var ticker = await window.BinanceProvider.getTicker(symbols[i]);
          tickers.push(ticker);
        } catch (e) {
          // Skip failed ticker
        }
        if (i < symbols.length - 1) {
          await new Promise(function (r) { setTimeout(r, 100); });
        }
      }
      state.tickers = tickers;

      // Re-render dashboard tickers if on dashboard
      if (state.currentPage === 'dashboard') {
        renderDashboardTickers();
      }
    } catch (err) {
      console.warn('Failed to load tickers:', err);
    }
  }

  function updatePriceDisplay() {
    var el = $('#current-price');
    if (!el) return;

    if (state.candles.length > 0) {
      var last = state.candles[state.candles.length - 1];
      el.textContent = fmtPrice(last.close);

      // Color based on open vs close
      var change = last.close - last.open;
      el.style.color = change >= 0 ? 'var(--green)' : 'var(--red)';
    } else {
      el.textContent = '--';
      el.style.color = '';
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // SIGNAL ANALYSIS
  // ════════════════════════════════════════════════════════════════════════════

  async function analyzeSymbol() {
    if (state.candles.length < 50) {
      showToast('Not enough candle data (need at least 50)', 'warning');
      return;
    }

    state.isAnalyzing = true;
    var analyzeBtn = $('#analyze-btn');
    if (analyzeBtn) analyzeBtn.disabled = true;

    try {
      // Generate signal via engine
      var signal = window.TradingSignalEngine.generateSignal(
        state.selectedSymbol,
        state.selectedTimeframe,
        state.candles,
        state.config
      );

      state.currentSignal = signal;

      // Optionally call AI if configured
      if (state.config.ai && state.config.ai.apiKey && state.config.ai.apiKey.length > 0) {
        try {
          showToast('Requesting AI analysis...', 'info');

          var getLatest = window.TradingIndicators.getLatestValue;
          var indicators = window.TradingIndicators.calculateAllIndicators(state.candles, state.config.indicatorParams);
          var structure = window.TradingMarketStructure.analyzeMarketStructure(state.candles, state.config.indicatorParams.swingLookback);
          var regime = signal.regime || window.TradingPatterns.detectMarketRegime(state.candles);

          var aiData = {
            symbol: signal.symbol,
            timeframe: signal.timeframe,
            price: signal.entry,
            regime: regime,
            momentum: getLatest(indicators.rsi) !== null ? (getLatest(indicators.rsi) > 50 ? 'bullish' : 'bearish') : 'neutral',
            volatility: getLatest(indicators.atr) ? 'moderate' : 'low',
            volume: getLatest(indicators.obv) ? 'normal' : 'low',
            signalDirection: signal.direction,
            signalScore: signal.score,
            riskReward: signal.riskReward,
            rsi: getLatest(indicators.rsi),
            macd: {
              macd: getLatest(indicators.macd.line),
              signal: getLatest(indicators.macd.signal),
              histogram: getLatest(indicators.macd.histogram),
            },
            emaAlignment: structure.trend,
            volumeProfile: 'normal',
            trend: structure.trend,
            marketStructure: structure,
            supportResistance: window.TradingMarketStructure.detectSupportResistance(state.candles, structure.swings),
            patterns: signal.patterns || [],
            chartPatterns: signal.chartPatterns || [],
            strategies: [],
            conflicts: signal.conflicts || [],
          };

          var aiAnalysis = await window.TradingAI.getAIAnalysis(aiData, state.config.ai);
          if (aiAnalysis) {
            signal.aiAnalysis = aiAnalysis;
            showToast('AI analysis complete', 'success');
          }
        } catch (aiErr) {
          console.warn('AI analysis failed:', aiErr);
          showToast('AI analysis failed: ' + aiErr.message, 'warning');
        }
      }

      // Save signal to storage
      try {
        await window.TradingStorage.saveSignal(signal);
        await loadRecentSignals();
      } catch (saveErr) {
        console.warn('Failed to save signal:', saveErr);
      }

      showToast('Analysis complete: ' + signal.direction + ' (' + signal.score + '/100)', 'success');

      // Re-render current page
      switch (state.currentPage) {
        case 'dashboard': renderDashboard(); break;
        case 'chart': renderChart(); break;
      }
    } catch (err) {
      console.error('Analysis failed:', err);
      showToast('Analysis failed: ' + err.message, 'error');
    } finally {
      state.isAnalyzing = false;
      if (analyzeBtn) analyzeBtn.disabled = false;
    }
  }

  async function loadRecentSignals() {
    try {
      var signals = await window.TradingStorage.getSignals(20, 0);
      state.recentSignals = signals;
    } catch (e) {
      state.recentSignals = [];
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // WEBSOCKET
  // ════════════════════════════════════════════════════════════════════════════

  function startWebSocket() {
    // Close existing connection
    if (state.ws) {
      try { state.ws.close(); } catch (e) {}
      state.ws = null;
    }

    var statusDot = $('#connection-status');
    var url = window.BinanceProvider.getWebSocketUrl(state.selectedSymbol, state.selectedTimeframe);

    try {
      state.ws = new WebSocket(url);

      state.ws.onopen = function () {
        if (statusDot) {
          statusDot.className = 'status-dot connected';
          statusDot.setAttribute('data-tooltip', 'Connected');
        }
      };

      state.ws.onmessage = function (event) {
        // Debounce updates
        clearTimeout(state.wsDebounce);
        state.wsDebounce = setTimeout(function () {
          handleWsMessage(event);
        }, 500);
      };

      state.ws.onclose = function () {
        if (statusDot) {
          statusDot.className = 'status-dot disconnected';
          statusDot.setAttribute('data-tooltip', 'Disconnected');
        }
        // Reconnect after 5 seconds
        setTimeout(function () {
          if (state.selectedSymbol && state.currentPage !== 'settings') {
            startWebSocket();
          }
        }, 5000);
      };

      state.ws.onerror = function () {
        if (statusDot) {
          statusDot.className = 'status-dot disconnected';
          statusDot.setAttribute('data-tooltip', 'Connection error');
        }
      };
    } catch (e) {
      console.warn('WebSocket connection failed:', e);
    }
  }

  function handleWsMessage(event) {
    try {
      var data = JSON.parse(event.data);
      var candle = window.BinanceProvider.parseWsKlineMessage(data);

      if (state.candles.length > 0) {
        var lastCandle = state.candles[state.candles.length - 1];

        // Update the last candle if same timestamp
        if (lastCandle.timestamp === candle.timestamp) {
          state.candles[state.candles.length - 1] = candle;
        } else if (candle.timestamp > lastCandle.timestamp) {
          // New candle
          state.candles.push(candle);
          if (state.candles.length > 1000) {
            state.candles.shift();
          }
        }

        // Update price display
        updatePriceDisplay();

        // Update chart if visible
        if (state.currentPage === 'chart' && state.chart) {
          updateChartData();
        }
      }
    } catch (e) {
      // Silently ignore parse errors
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // CHART RENDERING
  // ════════════════════════════════════════════════════════════════════════════

  function renderChartWidget() {
    var container = document.getElementById('chart-container');
    if (!container) return;

    // Destroy existing chart
    if (state.chart) {
      state.chart.remove();
      state.chart = null;
      state.chartSeries = {};
    }

    if (state.candles.length < 2) {
      container.innerHTML = '<div class="empty-state"><p>Waiting for market data...</p></div>';
      return;
    }

    // Create chart
    var chartOptions = {
      layout: {
        background: { type: 'solid', color: 'transparent' },
        textColor: '#71717a',
        fontSize: 12,
      },
      grid: {
        vertLines: { color: 'rgba(30,30,46,0.5)' },
        horzLines: { color: 'rgba(30,30,46,0.5)' },
      },
      crosshair: {
        mode: 0,
        vertLine: { color: 'rgba(96,165,250,0.3)', width: 1, style: 2 },
        horzLine: { color: 'rgba(96,165,250,0.3)', width: 1, style: 2 },
      },
      rightPriceScale: {
        borderColor: 'rgba(30,30,46,0.8)',
        scaleMargins: { top: 0.1, bottom: 0.25 },
      },
      timeScale: {
        borderColor: 'rgba(30,30,46,0.8)',
        timeVisible: true,
        secondsVisible: false,
      },
      handleScroll: true,
      handleScale: true,
    };

    state.chart = LightweightCharts.createChart(container, chartOptions);
    container.style.height = '100%';

    // Candlestick series
    var candleSeries = state.chart.addCandlestickSeries({
      upColor: '#34d399',
      downColor: '#f87171',
      borderUpColor: '#34d399',
      borderDownColor: '#f87171',
      wickUpColor: '#34d399',
      wickDownColor: '#f87171',
    });

    var chartData = state.candles.map(function (c) {
      return {
        time: c.timestamp,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      };
    });

    candleSeries.setData(chartData);
    state.chartSeries.candles = candleSeries;

    // Calculate indicators
    var indicators = window.TradingIndicators.calculateAllIndicators(state.candles, state.config.indicatorParams);
    var getLatest = window.TradingIndicators.getLatestValue;

    // EMA lines
    var emaColors = { 9: '#facc15', 20: '#60a5fa', 50: '#fb923c', 100: '#a78bfa', 200: '#f472b6' };
    var emaPeriods = state.config.indicatorParams.emaPeriods || [9, 20, 50, 100, 200];

    state.chartSeries.ema = {};
    for (var ep = 0; ep < emaPeriods.length; ep++) {
      var period = emaPeriods[ep];
      if (indicators.ema[period] && emaColors[period]) {
        var emaData = [];
        for (var ei = 0; ei < indicators.ema[period].length; ei++) {
          if (indicators.ema[period][ei] !== null && indicators.ema[period][ei] !== undefined) {
            emaData.push({
              time: state.candles[ei].timestamp,
              value: indicators.ema[period][ei],
            });
          }
        }
        if (emaData.length > 0) {
          var emaLine = state.chart.addLineSeries({
            color: emaColors[period],
            lineWidth: 1,
            title: 'EMA ' + period,
            visible: period === 9 || period === 20 || period === 50 || period === 200,
          });
          emaLine.setData(emaData);
          state.chartSeries.ema[period] = emaLine;
        }
      }
    }

    // Bollinger Bands
    var bbUpperData = [];
    var bbLowerData = [];
    for (var bi = 0; bi < indicators.bollinger.upper.length; bi++) {
      var t = state.candles[bi].timestamp;
      if (indicators.bollinger.upper[bi] !== null) {
        bbUpperData.push({ time: t, value: indicators.bollinger.upper[bi] });
      }
      if (indicators.bollinger.lower[bi] !== null) {
        bbLowerData.push({ time: t, value: indicators.bollinger.lower[bi] });
      }
    }

    if (bbUpperData.length > 0) {
      var bbUpper = state.chart.addLineSeries({
        color: 'rgba(167,139,250,0.4)',
        lineWidth: 1,
        lineStyle: 2,
        title: 'BB Upper',
      });
      bbUpper.setData(bbUpperData);
      state.chartSeries.bbUpper = bbUpper;
    }
    if (bbLowerData.length > 0) {
      var bbLower = state.chart.addLineSeries({
        color: 'rgba(167,139,250,0.4)',
        lineWidth: 1,
        lineStyle: 2,
        title: 'BB Lower',
      });
      bbLower.setData(bbLowerData);
      state.chartSeries.bbLower = bbLower;
    }

    // VWAP
    var vwapData = [];
    for (var vi = 0; vi < indicators.vwap.length; vi++) {
      if (indicators.vwap[vi] !== null && indicators.vwap[vi] !== undefined) {
        vwapData.push({
          time: state.candles[vi].timestamp,
          value: indicators.vwap[vi],
        });
      }
    }
    if (vwapData.length > 0) {
      var vwapLine = state.chart.addLineSeries({
        color: 'rgba(250,204,21,0.6)',
        lineWidth: 1,
        lineStyle: 0,
        title: 'VWAP',
      });
      vwapLine.setData(vwapData);
      state.chartSeries.vwap = vwapLine;
    }

    // Volume bars
    var volumeSeries = state.chart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    });

    var volumeData = state.candles.map(function (c, idx) {
      var color = c.close >= c.open ? 'rgba(52,211,153,0.25)' : 'rgba(248,113,113,0.25)';
      return { time: c.timestamp, value: c.volume, color: color };
    });

    volumeSeries.setData(volumeData);
    state.chartSeries.volume = volumeSeries;

    state.chart.priceScale('volume').applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });

    // MACD sub-chart
    renderMACDSubChart();

    // Resize handler
    var resizeObserver = new ResizeObserver(function () {
      if (state.chart) {
        state.chart.applyOptions({ width: container.clientWidth, height: container.clientHeight });
      }
    });
    resizeObserver.observe(container);

    // Fit content
    state.chart.timeScale().fitContent();
  }

  function renderMACDSubChart() {
    var macdContainer = document.getElementById('macd-chart-container');
    if (!macdContainer || state.candles.length < 2) return;

    // Destroy existing MACD chart
    if (state.chartSeries.macdChart) {
      state.chartSeries.macdChart.remove();
    }

    var indicators = window.TradingIndicators.calculateAllIndicators(state.candles, state.config.indicatorParams);
    var macdLine = indicators.macd.line;
    var macdSignal = indicators.macd.signal;
    var macdHist = indicators.macd.histogram;

    var macdChart = LightweightCharts.createChart(macdContainer, {
      layout: {
        background: { type: 'solid', color: 'transparent' },
        textColor: '#52525b',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: 'rgba(30,30,46,0.3)' },
        horzLines: { color: 'rgba(30,30,46,0.3)' },
      },
      rightPriceScale: { borderColor: 'rgba(30,30,46,0.5)' },
      timeScale: {
        borderColor: 'rgba(30,30,46,0.5)',
        visible: false,
      },
      crosshair: { mode: 0 },
      handleScroll: false,
      handleScale: false,
    });

    // Sync time scales
    state.chart.timeScale().subscribeVisibleLogicalRangeChange(function (range) {
      if (range && macdChart) {
        macdChart.timeScale().setVisibleLogicalRange(range);
      }
    });

    macdContainer.style.height = '100%';

    // MACD Histogram
    var histData = [];
    for (var i = 0; i < macdHist.length; i++) {
      if (macdHist[i] !== null && macdHist[i] !== undefined) {
        histData.push({
          time: state.candles[i].timestamp,
          value: macdHist[i],
          color: macdHist[i] >= 0 ? 'rgba(52,211,153,0.6)' : 'rgba(248,113,113,0.6)',
        });
      }
    }

    if (histData.length > 0) {
      var histSeries = macdChart.addHistogramSeries({
        priceFormat: { type: 'price', precision: 6, minMove: 0.000001 },
      });
      histSeries.setData(histData);
    }

    // MACD Line
    var macdLineData = [];
    for (var j = 0; j < macdLine.length; j++) {
      if (macdLine[j] !== null && macdLine[j] !== undefined) {
        macdLineData.push({ time: state.candles[j].timestamp, value: macdLine[j] });
      }
    }
    if (macdLineData.length > 0) {
      var mlSeries = macdChart.addLineSeries({ color: '#60a5fa', lineWidth: 1, title: 'MACD' });
      mlSeries.setData(macdLineData);
    }

    // Signal Line
    var sigData = [];
    for (var k = 0; k < macdSignal.length; k++) {
      if (macdSignal[k] !== null && macdSignal[k] !== undefined) {
        sigData.push({ time: state.candles[k].timestamp, value: macdSignal[k] });
      }
    }
    if (sigData.length > 0) {
      var ssSeries = macdChart.addLineSeries({ color: '#fb923c', lineWidth: 1, title: 'Signal' });
      ssSeries.setData(sigData);
    }

    state.chartSeries.macdChart = macdChart;

    // Resize observer for MACD
    var macdRO = new ResizeObserver(function () {
      if (state.chartSeries.macdChart) {
        state.chartSeries.macdChart.applyOptions({
          width: macdContainer.clientWidth,
          height: macdContainer.clientHeight,
        });
      }
    });
    macdRO.observe(macdContainer);

    macdChart.timeScale().fitContent();
  }

  function updateChartData() {
    if (!state.chart || !state.chartSeries.candles) return;

    var last = state.candles[state.candles.length - 1];

    state.chartSeries.candles.update({
      time: last.timestamp,
      open: last.open,
      high: last.high,
      low: last.low,
      close: last.close,
    });

    // Update volume
    if (state.chartSeries.volume) {
      var volColor = last.close >= last.open ? 'rgba(52,211,153,0.25)' : 'rgba(248,113,113,0.25)';
      state.chartSeries.volume.update({
        time: last.timestamp,
        value: last.volume,
        color: volColor,
      });
    }

    // Update EMA lines
    var emaSeries = state.chartSeries.ema;
    if (emaSeries) {
      var indicators = window.TradingIndicators.calculateAllIndicators(state.candles, state.config.indicatorParams);
      var emaPeriods = state.config.indicatorParams.emaPeriods || [9, 20, 50, 100, 200];
      for (var ep = 0; ep < emaPeriods.length; ep++) {
        var period = emaPeriods[ep];
        if (emaSeries[period] && indicators.ema[period]) {
          var lastEma = indicators.ema[period][indicators.ema[period].length - 1];
          if (lastEma !== null && lastEma !== undefined) {
            emaSeries[period].update({
              time: last.timestamp,
              value: lastEma,
            });
          }
        }
      }
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // SCANNER
  // ════════════════════════════════════════════════════════════════════════════

  async function runScanner() {
    if (state.isScanning) return;

    state.isScanning = true;
    state.scannerResults = [];
    renderScannerProgress(0);

    var symbols = window.TradingConfig.DEFAULT_SYMBOLS;
    var total = symbols.length;

    for (var i = 0; i < symbols.length; i++) {
      try {
        var candles = await window.BinanceProvider.getKlines(symbols[i], state.selectedTimeframe, 500);

        if (candles.length >= 50) {
          var result = window.TradingBacktest.quickAnalysis(symbols[i], candles, state.selectedTimeframe);

          // Also get price
          var price = candles[candles.length - 1].close;
          var prevClose = candles.length >= 2 ? candles[candles.length - 2].close : price;
          var changePercent = prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : 0;

          result.price = price;
          result.changePercent = changePercent;

          state.scannerResults.push(result);
        }

        // Rate limiting
        if (i < symbols.length - 1) {
          await new Promise(function (r) { setTimeout(r, 200); });
        }
      } catch (err) {
        console.warn('Scanner error for ' + symbols[i] + ':', err);
      }

      renderScannerProgress(Math.round(((i + 1) / total) * 100));
    }

    // Sort results
    sortScannerResults();

    state.isScanning = false;
    showToast('Scan complete: ' + state.scannerResults.length + ' symbols analyzed', 'success');
    renderScannerTable();
  }

  function sortScannerResults() {
    var sort = state.scannerSort;
    state.scannerResults.sort(function (a, b) {
      switch (sort) {
        case 'score': return (b.score || 0) - (a.score || 0);
        case 'change': return Math.abs(b.changePercent || 0) - Math.abs(a.changePercent || 0);
        case 'volume': return (b.volume || 0) - (a.volume || 0);
        case 'rsi': return (a.rsi || 50) - (b.rsi || 50);
        default: return (b.score || 0) - (a.score || 0);
      }
    });
  }

  function renderScannerProgress(pct) {
    var el = document.getElementById('scanner-progress');
    if (!el) return;
    el.innerHTML =
      '<div class="progress-bar">' +
        '<div class="progress-fill" style="width:' + pct + '%"></div>' +
      '</div>' +
      '<p class="progress-text">Scanning... ' + pct + '%</p>';
  }

  // ════════════════════════════════════════════════════════════════════════════
  // BACKTEST
  // ════════════════════════════════════════════════════════════════════════════

  async function runBacktest() {
    if (state.isBacktesting) return;

    // Read config from form
    var config = {
      symbol: (document.getElementById('bt-symbol') || {}).value || state.selectedSymbol,
      timeframe: (document.getElementById('bt-timeframe') || {}).value || state.selectedTimeframe,
      startDate: (document.getElementById('bt-start') || {}).value || '',
      endDate: (document.getElementById('bt-end') || {}).value || '',
      strategy: (document.getElementById('bt-strategy') || {}).value || 'all',
      initialCapital: parseFloat((document.getElementById('bt-capital') || {}).value) || 10000,
      riskPerTrade: parseFloat((document.getElementById('bt-risk') || {}).value) || 1,
      fee: state.config.risk.fee || 0.001,
      slippage: state.config.risk.slippage || 0.0005,
    };

    // Validation
    if (!config.startDate || !config.endDate) {
      showToast('Please specify start and end dates', 'warning');
      return;
    }
    if (config.startDate >= config.endDate) {
      showToast('Start date must be before end date', 'warning');
      return;
    }
    if (config.initialCapital <= 0) {
      showToast('Initial capital must be greater than 0', 'warning');
      return;
    }

    state.isBacktesting = true;
    state.backtestResult = null;

    var statusEl = document.getElementById('bt-status');
    if (statusEl) statusEl.innerHTML = '<div class="spinner"></div><span>Running backtest...</span>';

    try {
      var result = await window.TradingBacktest.runBacktest(config);
      state.backtestResult = result;

      // Save to storage
      try {
        await window.TradingStorage.saveBacktest(result);
      } catch (e) {
        console.warn('Failed to save backtest:', e);
      }

      showToast('Backtest complete: ' + result.totalTrades + ' trades', 'success');
      renderBacktestResults();
    } catch (err) {
      console.error('Backtest failed:', err);
      showToast('Backtest failed: ' + err.message, 'error');
      if (statusEl) statusEl.innerHTML = '<span class="text-red">Backtest failed</span>';
    } finally {
      state.isBacktesting = false;
    }
  }

  function renderBacktestResults() {
    var container = document.getElementById('bt-results');
    if (!container || !state.backtestResult) return;

    var r = state.backtestResult;
    var netColor = r.netProfit >= 0 ? 'var(--green)' : 'var(--red)';

    var html =
      '<div class="bt-metrics-grid">' +
        metricCard('Net Profit', '<span style="color:' + netColor + '">' + fmt(r.netProfit, 2) + ' (' + fmtPct(r.netProfitPct) + ')</span>') +
        metricCard('Win Rate', '<span style="color:' + (r.winRate >= 50 ? 'var(--green)' : 'var(--red)') + '">' + fmt(r.winRate, 1) + '%</span>') +
        metricCard('Profit Factor', fmt(r.profitFactor, 2)) +
        metricCard('Max Drawdown', '<span style="color:var(--red)">' + fmt(r.maxDrawdown, 2) + ' (' + fmtPct(-r.maxDrawdownPct) + ')</span>') +
        metricCard('Sharpe Ratio', r.sharpeRatio !== null ? fmt(r.sharpeRatio, 2) : 'N/A') +
        metricCard('Total Trades', fmt(r.totalTrades, 0)) +
      '</div>';

    // Equity curve
    html += '<div class="bt-equity-section">' +
      '<h4>Equity Curve</h4>' +
      '<div id="bt-equity-chart" class="bt-equity-chart"></div>' +
    '</div>';

    // Trades table
    if (r.trades && r.trades.length > 0) {
      html += '<div class="bt-trades-section">' +
        '<h4>Trade History (' + r.trades.length + ' trades)</h4>' +
        '<div class="table-wrapper">' +
          '<table class="data-table">' +
            '<thead>' +
              '<tr>' +
                '<th>Date</th><th>Dir</th><th>Entry</th><th>Exit</th><th>P/L</th><th>R:R</th><th>Reason</th>' +
              '</tr>' +
            '</thead>' +
            '<tbody>';

      for (var i = 0; i < r.trades.length; i++) {
        var t = r.trades[i];
        var plColor = t.pnl >= 0 ? 'var(--green)' : 'var(--red)';
        var dirBadge = t.direction === 'LONG'
          ? '<span class="badge badge-long">LONG</span>'
          : '<span class="badge badge-short">SHORT</span>';

        html +=
              '<tr>' +
                '<td>' + escHtml(t.date) + '</td>' +
                '<td>' + dirBadge + '</td>' +
                '<td>' + fmtPrice(t.entry) + '</td>' +
                '<td>' + fmtPrice(t.exit) + '</td>' +
                '<td style="color:' + plColor + '">' + fmt(t.pnl, 2) + '</td>' +
                '<td>' + fmt(t.riskReward, 2) + '</td>' +
                '<td class="cell-truncate" title="' + escHtml(t.reason) + '">' + escHtml(t.reason) + '</td>' +
              '</tr>';
      }

      html += '</tbody></table></div></div>';
    }

    container.innerHTML = html;

    // Render equity curve chart
    setTimeout(function () { renderEquityCurve(); }, 100);
  }

  function metricCard(label, value) {
    return '<div class="metric-card"><span class="metric-label">' + escHtml(label) + '</span><span class="metric-value">' + value + '</span></div>';
  }

  function renderEquityCurve() {
    var container = document.getElementById('bt-equity-chart');
    if (!container || !state.backtestResult || !state.backtestResult.equityCurve) return;

    var equityData = state.backtestResult.equityCurve;
    if (equityData.length < 2) return;

    var chart = LightweightCharts.createChart(container, {
      layout: {
        background: { type: 'solid', color: 'transparent' },
        textColor: '#71717a',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: 'rgba(30,30,46,0.3)' },
        horzLines: { color: 'rgba(30,30,46,0.3)' },
      },
      rightPriceScale: { borderColor: 'rgba(30,30,46,0.5)' },
      timeScale: { borderColor: 'rgba(30,30,46,0.5)' },
      crosshair: { mode: 0 },
    });

    container.style.height = '250px';

    var lineData = equityData.map(function (d) {
      return {
        time: Math.floor(new Date(d.date).getTime() / 1000),
        value: d.equity,
      };
    });

    // Sort by time
    lineData.sort(function (a, b) { return a.time - b.time; });

    var series = chart.addLineSeries({
      color: '#60a5fa',
      lineWidth: 2,
    });
    series.setData(lineData);
    chart.timeScale().fitContent();

    var ro = new ResizeObserver(function () {
      chart.applyOptions({ width: container.clientWidth, height: container.clientHeight });
    });
    ro.observe(container);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // SETTINGS
  // ════════════════════════════════════════════════════════════════════════════

  async function saveSettings() {
    try {
      // Read values from form
      var config = state.config;

      // General
      config.defaultSymbol = (document.getElementById('set-symbol') || {}).value || 'BTCUSDT';
      config.defaultTimeframe = (document.getElementById('set-timeframe') || {}).value || '1h';

      // Indicators
      config.indicatorParams.emaPeriods = readCsvInput('set-ema-periods', [9, 20, 50, 100, 200]);
      config.indicatorParams.rsiPeriod = parseInt((document.getElementById('set-rsi-period') || {}).value) || 14;
      config.indicatorParams.rsiOverbought = parseInt((document.getElementById('set-rsi-ob') || {}).value) || 70;
      config.indicatorParams.rsiOversold = parseInt((document.getElementById('set-rsi-os') || {}).value) || 30;
      config.indicatorParams.macdFast = parseInt((document.getElementById('set-macd-fast') || {}).value) || 12;
      config.indicatorParams.macdSlow = parseInt((document.getElementById('set-macd-slow') || {}).value) || 26;
      config.indicatorParams.macdSignal = parseInt((document.getElementById('set-macd-signal') || {}).value) || 9;
      config.indicatorParams.bollingerPeriod = parseInt((document.getElementById('set-bb-period') || {}).value) || 20;
      config.indicatorParams.bollingerStdDev = parseFloat((document.getElementById('set-bb-std') || {}).value) || 2;
      config.indicatorParams.atrPeriod = parseInt((document.getElementById('set-atr-period') || {}).value) || 14;
      config.indicatorParams.stochasticK = parseInt((document.getElementById('set-stoch-k') || {}).value) || 14;
      config.indicatorParams.stochasticD = parseInt((document.getElementById('set-stoch-d') || {}).value) || 3;
      config.indicatorParams.adxPeriod = parseInt((document.getElementById('set-adx-period') || {}).value) || 14;
      config.indicatorParams.swingLookback = parseInt((document.getElementById('set-swing-lb') || {}).value) || 3;

      // Risk
      config.risk.accountBalance = parseFloat((document.getElementById('set-balance') || {}).value) || 10000;
      config.risk.riskPerTrade = parseFloat((document.getElementById('set-risk-pct') || {}).value) || 1;
      config.risk.maxOpenTrades = parseInt((document.getElementById('set-max-trades') || {}).value) || 5;
      config.risk.maxDailyLoss = parseFloat((document.getElementById('set-max-daily-loss') || {}).value) || 5;
      config.risk.minRiskReward = parseFloat((document.getElementById('set-min-rr') || {}).value) || 1.5;
      // Fee and slippage are entered as percentages (e.g. 0.1 for 0.1%) and stored as decimals (e.g. 0.001)
      var feeVal = parseFloat((document.getElementById('set-fee') || {}).value);
      config.risk.fee = feeVal > 0 ? feeVal / 100 : 0.001;
      var slippageVal = parseFloat((document.getElementById('set-slippage') || {}).value);
      config.risk.slippage = slippageVal > 0 ? slippageVal / 100 : 0.0005;

      // AI
      if (config.ai) {
        config.ai.provider = (document.getElementById('set-ai-provider') || {}).value || 'openai';
        config.ai.model = (document.getElementById('set-ai-model') || {}).value || 'gpt-4o-mini';
        config.ai.baseUrl = (document.getElementById('set-ai-baseurl') || {}).value || '';
        var apiKey = (document.getElementById('set-ai-key') || {}).value || '';
        if (apiKey) {
          config.ai.apiKey = apiKey;
          localStorage.setItem('trading-platform-ai-key', apiKey);
        }
      }

      // Save to localStorage
      localStorage.setItem('trading-platform-settings', JSON.stringify({
        config: config,
        symbol: state.selectedSymbol,
        timeframe: state.selectedTimeframe,
        ai: config.ai,
      }));

      // Save to IndexedDB
      await window.TradingStorage.setSetting('config', JSON.stringify(config));

      showToast('Settings saved successfully', 'success');
    } catch (err) {
      console.error('Save settings failed:', err);
      showToast('Failed to save settings: ' + err.message, 'error');
    }
  }

  function readCsvInput(id, defaultArr) {
    var el = document.getElementById(id);
    if (!el) return defaultArr;
    var val = el.value;
    if (!val) return defaultArr;
    try {
      return val.split(',').map(function (s) { return parseInt(s.trim()); }).filter(function (n) { return !isNaN(n); });
    } catch (e) {
      return defaultArr;
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // PAGE RENDERERS
  // ════════════════════════════════════════════════════════════════════════════

  // ─── DASHBOARD ──────────────────────────────────────────────────────────────

  function renderDashboard() {
    var page = document.getElementById('page-dashboard');
    if (!page) return;

    var signal = state.currentSignal;
    var scoreColor = signal ? window.TradingConfig.getScoreColor(signal.score) : 'var(--text-secondary)';
    var dirColor = signal ? window.TradingConfig.getDirectionColor(signal.direction) : 'var(--text-secondary)';
    var strength = signal ? (window.TradingConfig.getScoreStrength(signal.score)) : 'N/A';
    var regime = signal ? signal.regime : 'N/A';

    var winRate = 'N/A';
    if (state.recentSignals.length > 0) {
      var longs = state.recentSignals.filter(function (s) {
        return s.direction === 'LONG' || s.direction === 'SHORT';
      });
      if (longs.length > 0) {
        winRate = longs.length + ' signal' + (longs.length !== 1 ? 's' : '');
      }
    }

    var aiStatus = 'Not configured';
    if (state.config.ai && state.config.ai.apiKey) {
      aiStatus = state.config.ai.provider.charAt(0).toUpperCase() + state.config.ai.provider.slice(1);
    }

    var html =
      '<div class="dashboard-page">' +
        // Stats cards
        '<div class="stats-row">' +
          '<div class="stat-card">' +
            '<span class="stat-label">Current Signal</span>' +
            '<span class="stat-value" style="color:' + dirColor + '">' + (signal ? signal.direction : 'N/A') + '</span>' +
          '</div>' +
          '<div class="stat-card">' +
            '<span class="stat-label">Signal Score</span>' +
            '<span class="stat-value" style="color:' + scoreColor + '">' + (signal ? signal.score + '/100' : 'N/A') + '</span>' +
          '</div>' +
          '<div class="stat-card">' +
            '<span class="stat-label">Market Regime</span>' +
            '<span class="stat-value">' + escHtml(regime) + '</span>' +
          '</div>' +
          '<div class="stat-card">' +
            '<span class="stat-label">AI Status</span>' +
            '<span class="stat-value">' + escHtml(aiStatus) + '</span>' +
          '</div>' +
        '</div>';

    // Quick signal summary
    if (signal) {
      html += '<div class="signal-summary-card card">' +
        '<div class="card-header">' +
          '<h3>' + escHtml(state.selectedSymbol) + ' — ' + escHtml(state.selectedTimeframe.toUpperCase()) + '</h3>' +
          '<span class="badge" style="background:' + dirColor + ';color:#000">' + escHtml(strength) + '</span>' +
        '</div>' +
        '<div class="card-body">' +
          '<div class="signal-levels-row">' +
            '<div class="level-item"><span class="level-label">Entry</span><span class="level-value">' + fmtPrice(signal.entry) + '</span></div>' +
            '<div class="level-item"><span class="level-label">Stop Loss</span><span class="level-value text-red">' + fmtPrice(signal.stopLoss) + '</span></div>' +
            '<div class="level-item"><span class="level-label">TP1</span><span class="level-value text-green">' + fmtPrice(signal.takeProfits[0]) + '</span></div>' +
            '<div class="level-item"><span class="level-label">TP2</span><span class="level-value text-green">' + fmtPrice(signal.takeProfits[1] || 0) + '</span></div>' +
            '<div class="level-item"><span class="level-label">TP3</span><span class="level-value text-green">' + fmtPrice(signal.takeProfits[2] || 0) + '</span></div>' +
          '</div>';

      // Score breakdown
      if (signal.scoreBreakdown) {
        html += '<div class="score-breakdown">';
        var cats = ['trend', 'momentum', 'volume', 'structure', 'priceAction', 'volatility'];
        for (var i = 0; i < cats.length; i++) {
          var cat = cats[i];
          var bd = signal.scoreBreakdown[cat];
          if (bd) {
            var pct = Math.min(100, Math.round((bd.score / bd.max) * 100));
            html += '<div class="score-bar-row">' +
              '<span class="score-cat">' + escHtml(cat.charAt(0).toUpperCase() + cat.slice(1)) + '</span>' +
              '<div class="score-bar"><div class="score-fill" style="width:' + pct + '%;background:' + scoreColor + '"></div></div>' +
              '<span class="score-pct">' + bd.score + '</span>' +
            '</div>';
          }
        }
        html += '</div>';
      }

      // Top reasons
      if (signal.reasons && signal.reasons.length > 0) {
        html += '<div class="signal-reasons"><h4>Key Reasons</h4><ul>';
        var maxReasons = Math.min(signal.reasons.length, 6);
        for (var r = 0; r < maxReasons; r++) {
          html += '<li>' + escHtml(signal.reasons[r]) + '</li>';
        }
        html += '</ul></div>';
      }

      html += '</div></div>';
    }

    // Market ticker grid
    html += '<div class="section">' +
      '<h3 class="section-title">Market Overview</h3>' +
      '<div id="dashboard-tickers" class="ticker-grid">';

    if (state.tickers.length > 0) {
      for (var ti = 0; ti < state.tickers.length; ti++) {
        var t = state.tickers[ti];
        var tColor = t.changePercent24h >= 0 ? 'var(--green)' : 'var(--red)';
        html += renderTickerCard(t);
      }
    } else {
      html += '<div class="empty-state"><p>Loading market data...</p><div class="spinner"></div></div>';
    }

    html += '</div></div>';

    // Recent signals
    html += '<div class="section">' +
      '<h3 class="section-title">Recent Signals</h3>';

    if (state.recentSignals.length > 0) {
      html += '<div class="signals-list compact">';
      var maxSignals = Math.min(state.recentSignals.length, 5);
      for (var si = 0; si < maxSignals; si++) {
        html += renderSignalCard(state.recentSignals[si], true);
      }
      html += '</div>';
    } else {
      html += '<div class="empty-state"><p>No signals yet. Click Analyze to generate your first signal.</p></div>';
    }

    html += '</div></div>';

    page.innerHTML = html;

    // Re-render tickers section if data available
    if (state.tickers.length > 0) {
      renderDashboardTickers();
    }
  }

  function renderTickerCard(ticker) {
    var changeColor = ticker.changePercent24h >= 0 ? 'var(--green)' : 'var(--red)';
    var isActive = ticker.symbol === state.selectedSymbol ? 'ticker-card active' : 'ticker-card';

    return '<div class="' + isActive + '" data-symbol="' + escHtml(ticker.symbol) + '">' +
      '<div class="ticker-header">' +
        '<span class="ticker-symbol">' + escHtml(ticker.symbol.replace('USDT', '')) + '</span>' +
        '<span class="ticker-price">' + fmtPrice(ticker.price) + '</span>' +
      '</div>' +
      '<div class="ticker-meta">' +
        '<span class="ticker-change" style="color:' + changeColor + '">' + fmtPct(ticker.changePercent24h) + '</span>' +
        '<span class="ticker-vol">' + fmtVolume(ticker.quoteVolume24h) + '</span>' +
      '</div>' +
    '</div>';
  }

  function renderDashboardTickers() {
    var container = document.getElementById('dashboard-tickers');
    if (!container) return;

    if (state.tickers.length === 0) {
      container.innerHTML = '<div class="empty-state"><p>Loading market data...</p><div class="spinner"></div></div>';
      return;
    }

    var html = '';
    for (var i = 0; i < state.tickers.length; i++) {
      html += renderTickerCard(state.tickers[i]);
    }
    container.innerHTML = html;

    // Add click handlers to ticker cards
    var cards = container.querySelectorAll('.ticker-card');
    for (var j = 0; j < cards.length; j++) {
      cards[j].addEventListener('click', function () {
        var sym = this.getAttribute('data-symbol');
        if (sym) {
          var select = $('#symbol-select');
          if (select) select.value = sym;
          updateSymbol(sym);
        }
      });
    }
  }

  // ─── CHART ───────────────────────────────────────────────────────────────────

  function renderChart() {
    var page = document.getElementById('page-chart');
    if (!page) return;

    var html =
      '<div class="chart-page">' +
        // Chart toolbar
        '<div class="chart-toolbar">' +
          '<div class="toolbar-left">' +
            '<span class="chart-symbol">' + escHtml(state.selectedSymbol) + '</span>' +
            '<span class="chart-tf">' + escHtml(state.selectedTimeframe.toUpperCase()) + '</span>' +
          '</div>' +
          '<div class="toolbar-right">' +
            '<button class="btn btn-sm btn-outline" id="chart-fullscreen" title="Fullscreen">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>' +
              ' Fullscreen' +
            '</button>' +
          '</div>' +
        '</div>' +
        // Main chart
        '<div id="chart-container" class="chart-main"></div>' +
        // MACD sub-chart
        '<div id="macd-chart-container" class="chart-sub"></div>' +
        // Analysis panel
        '<div id="chart-analysis" class="chart-analysis"></div>' +
      '</div>';

    page.innerHTML = html;

    // Render chart widget
    if (state.candles.length > 1) {
      renderChartWidget();
    }

    // Render analysis panel if signal exists
    renderChartAnalysis();

    // Fullscreen handler
    var fsBtn = document.getElementById('chart-fullscreen');
    if (fsBtn) {
      fsBtn.addEventListener('click', function () {
        var chartPage = document.querySelector('.chart-page');
        if (chartPage) {
          if (document.fullscreenElement) {
            document.exitFullscreen();
          } else {
            chartPage.requestFullscreen().catch(function () {});
          }
        }
      });
    }
  }

  function renderChartAnalysis() {
    var panel = document.getElementById('chart-analysis');
    if (!panel) return;

    var signal = state.currentSignal;
    if (!signal) {
      panel.innerHTML = '<div class="analysis-empty">' +
        '<p>Click <strong>Analyze</strong> to generate a trading signal for ' + escHtml(state.selectedSymbol) + '</p>' +
      '</div>';
      return;
    }

    var scoreColor = window.TradingConfig.getScoreColor(signal.score);
    var dirColor = window.TradingConfig.getDirectionColor(signal.direction);
    var strength = window.TradingConfig.getScoreStrength(signal.score);

    var html =
      '<div class="analysis-panel card">' +
        '<div class="card-header">' +
          '<h3>Signal Analysis</h3>' +
          '<div class="signal-badges">' +
            '<span class="badge" style="background:' + dirColor + ';color:#000">' + escHtml(signal.direction) + '</span>' +
            '<span class="badge" style="background:' + scoreColor + ';color:#000">' + signal.score + '/100</span>' +
            '<span class="badge badge-secondary">' + escHtml(strength) + '</span>' +
            '<span class="badge badge-secondary">' + escHtml(signal.regime) + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="card-body">' +
          '<div class="signal-levels-row">' +
            '<div class="level-item"><span class="level-label">Entry</span><span class="level-value">' + fmtPrice(signal.entry) + '</span></div>' +
            '<div class="level-item"><span class="level-label">Stop Loss</span><span class="level-value text-red">' + fmtPrice(signal.stopLoss) + '</span></div>' +
            '<div class="level-item"><span class="level-label">TP1 (1:1)</span><span class="level-value text-green">' + fmtPrice(signal.takeProfits[0]) + '</span></div>' +
            '<div class="level-item"><span class="level-label">TP2 (1:2)</span><span class="level-value text-green">' + fmtPrice(signal.takeProfits[1] || 0) + '</span></div>' +
            '<div class="level-item"><span class="level-label">TP3 (1:3)</span><span class="level-value text-green">' + fmtPrice(signal.takeProfits[2] || 0) + '</span></div>' +
          '</div>';

    // Score breakdown bars
    if (signal.scoreBreakdown) {
      html += '<div class="score-breakdown">';
      var cats = ['trend', 'momentum', 'volume', 'structure', 'priceAction', 'volatility'];
      for (var i = 0; i < cats.length; i++) {
        var cat = cats[i];
        var bd = signal.scoreBreakdown[cat];
        if (bd) {
          var pct = Math.min(100, Math.round((bd.score / bd.max) * 100));
          html += '<div class="score-bar-row">' +
            '<span class="score-cat">' + escHtml(cat.charAt(0).toUpperCase() + cat.slice(1)) + '</span>' +
            '<div class="score-bar"><div class="score-fill" style="width:' + pct + '%;background:' + scoreColor + '"></div></div>' +
            '<span class="score-pct">' + bd.score + '</span>' +
          '</div>';
        }
      }
      html += '</div>';
    }

    // Reasons
    if (signal.reasons && signal.reasons.length > 0) {
      html += '<div class="analysis-section"><h4>Reasons</h4><ul class="analysis-list">';
      for (var r = 0; r < Math.min(signal.reasons.length, 10); r++) {
        html += '<li>' + escHtml(signal.reasons[r]) + '</li>';
      }
      html += '</ul></div>';
    }

    // Warnings
    if (signal.warnings && signal.warnings.length > 0) {
      html += '<div class="analysis-section warnings"><h4>Warnings</h4><ul class="analysis-list">';
      for (var w = 0; w < Math.min(signal.warnings.length, 5); w++) {
        html += '<li class="warning-item">' + escHtml(signal.warnings[w]) + '</li>';
      }
      html += '</ul></div>';
    }

    // AI Analysis
    if (signal.aiAnalysis) {
      var ai = signal.aiAnalysis;
      html += '<div class="ai-analysis-section">' +
        '<h4>AI Analysis</h4>' +
        '<div class="ai-summary">' + escHtml(ai.summary) + '</div>' +
        '<div class="ai-trend">' + escHtml(ai.trend) + '</div>';

      if (ai.bullishCase && ai.bullishCase.length > 0) {
        html += '<div class="ai-case bullish"><strong>Bullish Case:</strong><ul>';
        for (var b = 0; b < ai.bullishCase.length; b++) {
          html += '<li>' + escHtml(ai.bullishCase[b]) + '</li>';
        }
        html += '</ul></div>';
      }

      if (ai.bearishCase && ai.bearishCase.length > 0) {
        html += '<div class="ai-case bearish"><strong>Bearish Case:</strong><ul>';
        for (var be = 0; be < ai.bearishCase.length; be++) {
          html += '<li>' + escHtml(ai.bearishCase[be]) + '</li>';
        }
        html += '</ul></div>';
      }

      if (ai.risks && ai.risks.length > 0) {
        html += '<div class="ai-case risks"><strong>Risks:</strong><ul>';
        for (var rk = 0; rk < ai.risks.length; rk++) {
          html += '<li>' + escHtml(ai.risks[rk]) + '</li>';
        }
        html += '</ul></div>';
      }

      if (ai.finalAssessment) {
        html += '<div class="ai-final"><strong>Final Assessment:</strong> ' + escHtml(ai.finalAssessment) + '</div>';
      }

      html += '</div>';
    }

    html += '</div></div>';
    panel.innerHTML = html;
  }

  // ─── SCANNER ──────────────────────────────────────────────────────────────────

  function renderScanner() {
    var page = document.getElementById('page-scanner');
    if (!page) return;

    var html =
      '<div class="scanner-page">' +
        '<div class="scanner-header">' +
          '<h2>Market Scanner</h2>' +
          '<div class="scanner-controls">' +
            '<div class="scanner-sort">' +
              '<span>Sort:</span>' +
              '<select id="scanner-sort-select" class="input-sm">' +
                '<option value="score"' + (state.scannerSort === 'score' ? ' selected' : '') + '>Score</option>' +
                '<option value="change"' + (state.scannerSort === 'change' ? ' selected' : '') + '>24h Change</option>' +
                '<option value="volume"' + (state.scannerSort === 'volume' ? ' selected' : '') + '>Volume</option>' +
                '<option value="rsi"' + (state.scannerSort === 'rsi' ? ' selected' : '') + '>RSI</option>' +
              '</select>' +
            '</div>' +
            '<button id="scan-all-btn" class="btn btn-primary"' + (state.isScanning ? ' disabled' : '') + '>' +
              (state.isScanning ? '<span class="spinner-sm"></span> Scanning...' : 'Scan All Symbols') +
            '</button>' +
          '</div>' +
        '</div>' +
        '<div id="scanner-progress" class="scanner-progress"></div>' +
        '<div id="scanner-table-container" class="scanner-table-container">';

    if (state.scannerResults.length > 0) {
      html += renderScannerTableHTML();
    } else {
      html += '<div class="empty-state"><p>Click "Scan All Symbols" to analyze the market</p></div>';
    }

    html += '</div></div>';
    page.innerHTML = html;

    // Event listeners
    var scanBtn = document.getElementById('scan-all-btn');
    if (scanBtn) {
      scanBtn.addEventListener('click', function () {
        runScanner();
      });
    }

    var sortSelect = document.getElementById('scanner-sort-select');
    if (sortSelect) {
      sortSelect.addEventListener('change', function () {
        state.scannerSort = this.value;
        sortScannerResults();
        renderScannerTable();
      });
    }
  }

  function renderScannerTableHTML() {
    var html =
      '<div class="table-wrapper"><table class="data-table">' +
        '<thead><tr>' +
          '<th>Symbol</th><th>Price</th><th>24h Change</th><th>Score</th><th>Direction</th>' +
          '<th>RSI</th><th>Volume</th><th>Setup</th><th></th>' +
        '</tr></thead><tbody>';

    for (var i = 0; i < state.scannerResults.length; i++) {
      var r = state.scannerResults[i];
      var scoreColor = window.TradingConfig.getScoreColor(r.score);
      var dirColor = window.TradingConfig.getDirectionColor(r.direction);
      var changeColor = r.changePercent >= 0 ? 'var(--green)' : 'var(--red)';

      var dirBadge = r.direction === 'LONG'
        ? '<span class="badge badge-long">LONG</span>'
        : r.direction === 'SHORT'
          ? '<span class="badge badge-short">SHORT</span>'
          : '<span class="badge badge-secondary">NO TRADE</span>';

      html +=
        '<tr data-symbol="' + escHtml(r.symbol || '') + '" class="scanner-row">' +
          '<td class="symbol-cell">' + escHtml((r.symbol || '').replace('USDT', '')) + '</td>' +
          '<td>' + fmtPrice(r.price) + '</td>' +
          '<td style="color:' + changeColor + '">' + fmtPct(r.changePercent) + '</td>' +
          '<td><span style="color:' + scoreColor + ';font-weight:600">' + (r.score || 0) + '</span></td>' +
          '<td>' + dirBadge + '</td>' +
          '<td>' + fmt(r.rsi, 1) + '</td>' +
          '<td>' + fmtVolume(r.volume) + '</td>' +
          '<td class="cell-truncate">' + escHtml(r.setup || 'N/A') + '</td>' +
          '<td><button class="btn btn-sm btn-outline view-chart-btn" data-symbol="' + escHtml(r.symbol || '') + '">Chart</button></td>' +
        '</tr>';
    }

    html += '</tbody></table></div>';
    return html;
  }

  function renderScannerTable() {
    var container = document.getElementById('scanner-table-container');
    if (!container) return;

    if (state.scannerResults.length > 0) {
      container.innerHTML = renderScannerTableHTML();

      // Add row click handlers
      var rows = container.querySelectorAll('.scanner-row');
      for (var i = 0; i < rows.length; i++) {
        rows[i].addEventListener('click', function (e) {
          if (e.target.closest('.view-chart-btn')) return;
          var sym = this.getAttribute('data-symbol');
          if (sym) {
            var select = $('#symbol-select');
            if (select) select.value = sym;
            updateSymbol(sym);
            navigate('chart');
          }
        });
      }

      var chartBtns = container.querySelectorAll('.view-chart-btn');
      for (var j = 0; j < chartBtns.length; j++) {
        chartBtns[j].addEventListener('click', function (e) {
          e.stopPropagation();
          var sym = this.getAttribute('data-symbol');
          if (sym) {
            var select = $('#symbol-select');
            if (select) select.value = sym;
            updateSymbol(sym);
            navigate('chart');
          }
        });
      }
    } else {
      container.innerHTML = '<div class="empty-state"><p>No scan results. Click "Scan All Symbols" to start.</p></div>';
    }
  }

  // ─── SIGNALS ─────────────────────────────────────────────────────────────────

  function renderSignals() {
    var page = document.getElementById('page-signals');
    if (!page) return;

    var html =
      '<div class="signals-page">' +
        '<div class="signals-header">' +
          '<h2>Signal History</h2>' +
          '<div class="signals-controls">' +
            '<div class="signals-filter">' +
              '<button class="btn btn-sm btn-outline' + (state.signalsFilter === 'ALL' ? ' active' : '') + '" data-filter="ALL">All</button>' +
              '<button class="btn btn-sm btn-outline' + (state.signalsFilter === 'LONG' ? ' active' : '') + '" data-filter="LONG">Long</button>' +
              '<button class="btn btn-sm btn-outline' + (state.signalsFilter === 'SHORT' ? ' active' : '') + '" data-filter="SHORT">Short</button>' +
            '</div>' +
            '<button id="refresh-signals-btn" class="btn btn-sm btn-outline">Refresh</button>' +
          '</div>' +
        '</div>';

    var filtered = state.recentSignals;
    if (state.signalsFilter !== 'ALL') {
      filtered = state.recentSignals.filter(function (s) {
        return s.direction === state.signalsFilter;
      });
    }

    if (filtered.length > 0) {
      html += '<div class="signals-list">';
      for (var i = 0; i < filtered.length; i++) {
        html += renderSignalCard(filtered[i], false);
      }
      html += '</div>';
    } else {
      html += '<div class="empty-state"><p>No signals found. Run an analysis to generate signals.</p></div>';
    }

    html += '</div>';
    page.innerHTML = html;

    // Event listeners
    var filterBtns = page.querySelectorAll('.signals-filter button');
    for (var f = 0; f < filterBtns.length; f++) {
      filterBtns[f].addEventListener('click', function () {
        state.signalsFilter = this.getAttribute('data-filter');
        renderSignals();
      });
    }

    var refreshBtn = document.getElementById('refresh-signals-btn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', async function () {
        try {
          await loadRecentSignals();
          renderSignals();
          showToast('Signals refreshed', 'info');
        } catch (e) {
          showToast('Failed to refresh signals', 'error');
        }
      });
    }

    // Signal card interactions
    var signalCards = page.querySelectorAll('.signal-card');
    for (var c = 0; c < signalCards.length; c++) {
      signalCards[c].addEventListener('click', function () {
        var id = this.getAttribute('data-signal-id');
        if (id) expandSignalModal(id);
      });
    }
  }

  function renderSignalCard(signal, compact) {
    var scoreColor = window.TradingConfig.getScoreColor(signal.score || 0);
    var dirColor = window.TradingConfig.getDirectionColor(signal.direction);
    var strength = signal.strength || window.TradingConfig.getScoreStrength(signal.score || 0);

    var dirBadge = signal.direction === 'LONG'
      ? '<span class="badge badge-long">LONG</span>'
      : signal.direction === 'SHORT'
        ? '<span class="badge badge-short">SHORT</span>'
        : '<span class="badge badge-secondary">NO TRADE</span>';

    var reasons = [];
    if (typeof signal.reasons === 'string') {
      try { reasons = JSON.parse(signal.reasons); } catch (e) { reasons = [signal.reasons]; }
    } else if (Array.isArray(signal.reasons)) {
      reasons = signal.reasons;
    }

    var maxReasons = compact ? 3 : 5;

    var html =
      '<div class="signal-card card" data-signal-id="' + escHtml(signal.id || '') + '">' +
        '<div class="card-header">' +
          '<div class="signal-card-title">' +
            '<strong>' + escHtml(signal.symbol || '') + '</strong>' +
            '<span class="signal-card-tf">' + escHtml(signal.timeframe || '').toUpperCase() + '</span>' +
          '</div>' +
          '<div class="signal-card-badges">' +
            dirBadge +
            '<span class="badge" style="background:' + scoreColor + ';color:#000">' + (signal.score || 0) + '/100</span>' +
          '</div>' +
        '</div>' +
        '<div class="card-body">' +
          '<div class="signal-levels-row compact">' +
            '<span>Entry: <strong>' + fmtPrice(signal.entry) + '</strong></span>' +
            '<span>SL: <strong class="text-red">' + fmtPrice(signal.stopLoss) + '</strong></span>' +
            '<span>TP1: <strong class="text-green">' + fmtPrice(signal.takeProfits && signal.takeProfits[0] ? signal.takeProfits[0] : 0) + '</strong></span>' +
          '</div>';

    if (!compact && reasons.length > 0) {
      html += '<ul class="signal-reasons-compact">';
      for (var r = 0; r < Math.min(reasons.length, maxReasons); r++) {
        html += '<li>' + escHtml(reasons[r]) + '</li>';
      }
      if (reasons.length > maxReasons) {
        html += '<li class="more">+ ' + (reasons.length - maxReasons) + ' more...</li>';
      }
      html += '</ul>';
    }

    html += '<div class="signal-card-footer">' +
      '<span class="signal-time">' + fmtDate(signal.createdAt || signal.timestamp) + '</span>' +
      '<span class="signal-strength">' + escHtml(strength) + '</span>' +
    '</div>';

    html += '</div></div>';
    return html;
  }

  function expandSignalModal(signalId) {
    var signal = state.recentSignals.find(function (s) { return s.id === signalId; });
    if (!signal) return;

    var scoreColor = window.TradingConfig.getScoreColor(signal.score || 0);
    var dirColor = window.TradingConfig.getDirectionColor(signal.direction);

    var reasons = [];
    if (typeof signal.reasons === 'string') {
      try { reasons = JSON.parse(signal.reasons); } catch (e) { reasons = [signal.reasons]; }
    } else if (Array.isArray(signal.reasons)) {
      reasons = signal.reasons;
    }

    var warnings = [];
    if (typeof signal.warnings === 'string') {
      try { warnings = JSON.parse(signal.warnings); } catch (e) { warnings = [signal.warnings]; }
    } else if (Array.isArray(signal.warnings)) {
      warnings = signal.warnings;
    }

    var aiAnalysis = null;
    if (typeof signal.aiAnalysis === 'string') {
      try { aiAnalysis = JSON.parse(signal.aiAnalysis); } catch (e) {}
    } else if (typeof signal.aiAnalysis === 'object' && signal.aiAnalysis) {
      aiAnalysis = signal.aiAnalysis;
    }

    var content =
      '<div class="modal-signal-detail">' +
        '<div class="signal-meta">' +
          '<span class="badge" style="background:' + dirColor + ';color:#000">' + escHtml(signal.direction) + '</span>' +
          '<span class="badge" style="background:' + scoreColor + ';color:#000">' + (signal.score || 0) + '/100</span>' +
          '<span>' + escHtml(signal.symbol) + ' · ' + escHtml((signal.timeframe || '').toUpperCase()) + '</span>' +
          '<span>' + fmtDate(signal.createdAt || signal.timestamp) + '</span>' +
        '</div>' +
        '<div class="signal-levels-row">' +
          '<div class="level-item"><span class="level-label">Entry</span><span class="level-value">' + fmtPrice(signal.entry) + '</span></div>' +
          '<div class="level-item"><span class="level-label">Stop Loss</span><span class="level-value text-red">' + fmtPrice(signal.stopLoss) + '</span></div>' +
          '<div class="level-item"><span class="level-label">TP1</span><span class="level-value text-green">' + fmtPrice(signal.takeProfits && signal.takeProfits[0] ? signal.takeProfits[0] : 0) + '</span></div>' +
          '<div class="level-item"><span class="level-label">TP2</span><span class="level-value text-green">' + fmtPrice(signal.takeProfits && signal.takeProfits[1] ? signal.takeProfits[1] : 0) + '</span></div>' +
        '</div>';

    if (reasons.length > 0) {
      content += '<h4>Reasons</h4><ul class="modal-list">';
      for (var r = 0; r < reasons.length; r++) {
        content += '<li>' + escHtml(reasons[r]) + '</li>';
      }
      content += '</ul>';
    }

    if (warnings.length > 0) {
      content += '<h4 class="warning-header">Warnings</h4><ul class="modal-list warning-list">';
      for (var w = 0; w < warnings.length; w++) {
        content += '<li>' + escHtml(warnings[w]) + '</li>';
      }
      content += '</ul>';
    }

    if (aiAnalysis) {
      content += '<div class="ai-modal-section"><h4>AI Analysis</h4>' +
        '<p><strong>Summary:</strong> ' + escHtml(aiAnalysis.summary) + '</p>' +
        '<p><strong>Trend:</strong> ' + escHtml(aiAnalysis.trend) + '</p>';

      if (aiAnalysis.bullishCase && aiAnalysis.bullishCase.length > 0) {
        content += '<p><strong>Bullish Case:</strong></p><ul>';
        for (var b = 0; b < aiAnalysis.bullishCase.length; b++) {
          content += '<li>' + escHtml(aiAnalysis.bullishCase[b]) + '</li>';
        }
        content += '</ul>';
      }

      if (aiAnalysis.bearishCase && aiAnalysis.bearishCase.length > 0) {
        content += '<p><strong>Bearish Case:</strong></p><ul>';
        for (var be = 0; be < aiAnalysis.bearishCase.length; be++) {
          content += '<li>' + escHtml(aiAnalysis.bearishCase[be]) + '</li>';
        }
        content += '</ul>';
      }

      if (aiAnalysis.finalAssessment) {
        content += '<p><strong>Assessment:</strong> ' + escHtml(aiAnalysis.finalAssessment) + '</p>';
      }
      content += '</div>';
    }

    content += '</div>';

    var footer =
      '<button class="btn btn-outline" onclick="window.App.closeModal()">Close</button>' +
      '<button class="btn btn-danger" onclick="window.App.deleteSignal(\'' + escHtml(signal.id) + '\')">Delete</button>';

    showModal('Signal Detail — ' + escHtml(signal.symbol), content, footer);
  }

  async function deleteSignal(id) {
    try {
      await window.TradingStorage.deleteSignal(id);
      await loadRecentSignals();
      closeModal();
      renderSignals();
      showToast('Signal deleted', 'info');
    } catch (e) {
      showToast('Failed to delete signal', 'error');
    }
  }

  // ─── BACKTEST ───────────────────────────────────────────────────────────────

  function renderBacktest() {
    var page = document.getElementById('page-backtest');
    if (!page) return;

    // Set default dates
    var today = new Date().toISOString().split('T')[0];
    var threeMonthsAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    var html =
      '<div class="backtest-page">' +
        '<h2>Strategy Backtester</h2>' +
        '<div class="bt-config card">' +
          '<div class="card-header"><h3>Configuration</h3></div>' +
          '<div class="card-body">' +
            '<div class="form-grid">' +
              formGroup('Symbol', '<select id="bt-symbol" class="input">' + buildSymbolOptions(state.selectedSymbol) + '</select>') +
              formGroup('Timeframe', '<select id="bt-timeframe" class="input">' + buildTimeframeOptions(state.selectedTimeframe) + '</select>') +
              formGroup('Start Date', '<input type="date" id="bt-start" class="input" value="' + (state.backtestConfig.startDate || threeMonthsAgo) + '">') +
              formGroup('End Date', '<input type="date" id="bt-end" class="input" value="' + (state.backtestConfig.endDate || today) + '">') +
              formGroup('Strategy', '<select id="bt-strategy" class="input"><option value="all">All Strategies</option><option value="trend">Trend Following</option><option value="momentum">Momentum</option><option value="breakout">Breakout</option></select>') +
              formGroup('Initial Capital ($)', '<input type="number" id="bt-capital" class="input" value="' + (state.backtestConfig.initialCapital || 10000) + '" min="100" step="100">') +
              formGroup('Risk Per Trade (%)', '<input type="number" id="bt-risk" class="input" value="' + (state.backtestConfig.riskPerTrade || 1) + '" min="0.1" max="10" step="0.1">') +
              '<div></div>' +
            '</div>' +
            '<div class="form-actions">' +
              '<button id="run-backtest-btn" class="btn btn-primary"' + (state.isBacktesting ? ' disabled' : '') + '>' +
                (state.isBacktesting ? '<span class="spinner-sm"></span> Running...' : 'Run Backtest') +
              '</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div id="bt-status"></div>' +
        '<div id="bt-results"></div>' +
      '</div>';

    page.innerHTML = html;

    // Event listener
    var runBtn = document.getElementById('run-backtest-btn');
    if (runBtn) {
      runBtn.addEventListener('click', function () {
        runBacktest();
      });
    }

    // Re-render results if available
    if (state.backtestResult) {
      renderBacktestResults();
    }
  }

  function formGroup(label, inputHtml) {
    return '<div class="form-group">' +
      '<label class="form-label">' + escHtml(label) + '</label>' +
      inputHtml +
    '</div>';
  }

  function buildSymbolOptions(selected) {
    var html = '';
    var symbols = window.TradingConfig.DEFAULT_SYMBOLS;
    for (var i = 0; i < symbols.length; i++) {
      html += '<option value="' + escHtml(symbols[i]) + '"' + (symbols[i] === selected ? ' selected' : '') + '>' + escHtml(symbols[i]) + '</option>';
    }
    return html;
  }

  function buildTimeframeOptions(selected) {
    var html = '';
    var tfs = window.TradingConfig.TIMEFRAMES;
    for (var i = 0; i < tfs.length; i++) {
      html += '<option value="' + escHtml(tfs[i].value) + '"' + (tfs[i].value === selected ? ' selected' : '') + '>' + escHtml(tfs[i].label) + '</option>';
    }
    return html;
  }

  // ─── SETTINGS ────────────────────────────────────────────────────────────────

  function renderSettings() {
    var page = document.getElementById('page-settings');
    if (!page) return;

    var config = state.config;
    var aiConfig = config.ai || {};

    var html =
      '<div class="settings-page">' +
        '<h2>Settings</h2>' +
        '<div class="settings-tabs">' +
          '<button class="settings-tab' + (state.settingsTab === 'general' ? ' active' : '') + '" data-tab="general">General</button>' +
          '<button class="settings-tab' + (state.settingsTab === 'indicators' ? ' active' : '') + '" data-tab="indicators">Indicators</button>' +
          '<button class="settings-tab' + (state.settingsTab === 'risk' ? ' active' : '') + '" data-tab="risk">Risk</button>' +
          '<button class="settings-tab' + (state.settingsTab === 'ai' ? ' active' : '') + '" data-tab="ai">AI</button>' +
          '<button class="settings-tab' + (state.settingsTab === 'about' ? ' active' : '') + '" data-tab="about">About</button>' +
        '</div>' +
        '<div class="settings-content" id="settings-content">' +
          renderSettingsTab(state.settingsTab) +
        '</div>' +
        '<div class="settings-actions">' +
          '<button id="save-settings-btn" class="btn btn-primary">Save Settings</button>' +
        '</div>' +
      '</div>';

    page.innerHTML = html;

    // Tab switching
    var tabs = page.querySelectorAll('.settings-tab');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].addEventListener('click', function () {
        state.settingsTab = this.getAttribute('data-tab');
        renderSettings();
      });
    }

    // Save button
    var saveBtn = document.getElementById('save-settings-btn');
    if (saveBtn) {
      saveBtn.addEventListener('click', function () {
        saveSettings();
      });
    }
  }

  function renderSettingsTab(tab) {
    var config = state.config;
    var risk = config.risk || {};
    var params = config.indicatorParams || {};
    var aiConfig = config.ai || {};

    switch (tab) {
      case 'general':
        return '<div class="settings-panel">' +
          formGroup('Default Symbol', '<select id="set-symbol" class="input">' + buildSymbolOptions(config.defaultSymbol) + '</select>') +
          formGroup('Default Timeframe', '<select id="set-timeframe" class="input">' + buildTimeframeOptions(config.defaultTimeframe) + '</select>') +
        '</div>';

      case 'indicators':
        return '<div class="settings-panel">' +
          '<h4>EMA Settings</h4>' +
          formGroup('EMA Periods (comma-separated)', '<input type="text" id="set-ema-periods" class="input" value="' + (params.emaPeriods || [9, 20, 50, 100, 200]).join(', ') + '">') +
          '<h4 class="mt-4">RSI Settings</h4>' +
          formGroup('RSI Period', '<input type="number" id="set-rsi-period" class="input" value="' + (params.rsiPeriod || 14) + '" min="2" max="100">') +
          formGroup('RSI Overbought', '<input type="number" id="set-rsi-ob" class="input" value="' + (params.rsiOverbought || 70) + '" min="50" max="100">') +
          formGroup('RSI Oversold', '<input type="number" id="set-rsi-os" class="input" value="' + (params.rsiOversold || 30) + '" min="0" max="50">') +
          '<h4 class="mt-4">MACD Settings</h4>' +
          formGroup('MACD Fast', '<input type="number" id="set-macd-fast" class="input" value="' + (params.macdFast || 12) + '" min="2" max="50">') +
          formGroup('MACD Slow', '<input type="number" id="set-macd-slow" class="input" value="' + (params.macdSlow || 26) + '" min="5" max="100">') +
          formGroup('MACD Signal', '<input type="number" id="set-macd-signal" class="input" value="' + (params.macdSignal || 9) + '" min="2" max="50">') +
          '<h4 class="mt-4">Bollinger Bands</h4>' +
          formGroup('BB Period', '<input type="number" id="set-bb-period" class="input" value="' + (params.bollingerPeriod || 20) + '" min="5" max="100">') +
          formGroup('BB Std Dev', '<input type="number" id="set-bb-std" class="input" value="' + (params.bollingerStdDev || 2) + '" min="0.5" max="4" step="0.1">') +
          '<h4 class="mt-4">Other Indicators</h4>' +
          formGroup('ATR Period', '<input type="number" id="set-atr-period" class="input" value="' + (params.atrPeriod || 14) + '" min="1" max="50">') +
          formGroup('Stochastic %K', '<input type="number" id="set-stoch-k" class="input" value="' + (params.stochasticK || 14) + '" min="1" max="50">') +
          formGroup('Stochastic %D', '<input type="number" id="set-stoch-d" class="input" value="' + (params.stochasticD || 3) + '" min="1" max="20">') +
          formGroup('ADX Period', '<input type="number" id="set-adx-period" class="input" value="' + (params.adxPeriod || 14) + '" min="1" max="50">') +
          formGroup('Swing Lookback', '<input type="number" id="set-swing-lb" class="input" value="' + (params.swingLookback || 3) + '" min="1" max="10">') +
        '</div>';

      case 'risk':
        return '<div class="settings-panel">' +
          formGroup('Account Balance ($)', '<input type="number" id="set-balance" class="input" value="' + (risk.accountBalance || 10000) + '" min="100" step="100">') +
          formGroup('Risk Per Trade (%)', '<input type="number" id="set-risk-pct" class="input" value="' + (risk.riskPerTrade || 1) + '" min="0.1" max="10" step="0.1">') +
          formGroup('Max Open Trades', '<input type="number" id="set-max-trades" class="input" value="' + (risk.maxOpenTrades || 5) + '" min="1" max="20">') +
          formGroup('Max Daily Loss (%)', '<input type="number" id="set-max-daily-loss" class="input" value="' + (risk.maxDailyLoss || 5) + '" min="1" max="20" step="0.5">') +
          formGroup('Min Risk:Reward', '<input type="number" id="set-min-rr" class="input" value="' + (risk.minRiskReward || 1.5) + '" min="0.5" max="10" step="0.1">') +
          formGroup('Fee (%)', '<input type="number" id="set-fee" class="input" value="' + ((risk.fee || 0.001) * 100) + '" min="0" max="1" step="0.01">') +
          formGroup('Slippage (%)', '<input type="number" id="set-slippage" class="input" value="' + ((risk.slippage || 0.0005) * 100) + '" min="0" max="1" step="0.01">') +
        '</div>';

      case 'ai':
        return '<div class="settings-panel">' +
          formGroup('AI Provider', '<select id="set-ai-provider" class="input">' +
            '<option value="openai"' + (aiConfig.provider === 'openai' ? ' selected' : '') + '>OpenAI</option>' +
            '<option value="gemini"' + (aiConfig.provider === 'gemini' ? ' selected' : '') + '>Google Gemini</option>' +
            '<option value="openrouter"' + (aiConfig.provider === 'openrouter' ? ' selected' : '') + '>OpenRouter</option>' +
            '<option value="compatible"' + (aiConfig.provider === 'compatible' ? ' selected' : '') + '>Compatible (OpenAI-compatible)</option>' +
          '</select>') +
          formGroup('Model Name', '<input type="text" id="set-ai-model" class="input" value="' + escHtml(aiConfig.model || 'gpt-4o-mini') + '" placeholder="e.g., gpt-4o-mini">') +
          formGroup('API Key', '<input type="password" id="set-ai-key" class="input" value="' + escHtml(aiConfig.apiKey || '') + '" placeholder="Enter your API key">') +
          formGroup('Base URL (for Compatible)', '<input type="text" id="set-ai-baseurl" class="input" value="' + escHtml(aiConfig.baseUrl || '') + '" placeholder="e.g., http://localhost:11434/v1">') +
          '<p class="form-hint">API key is stored locally in your browser. Never shared externally.</p>' +
        '</div>';

      case 'about':
        return '<div class="settings-panel about-panel">' +
          '<h3>AI Trading Analysis Platform</h3>' +
          '<p class="text-secondary">Professional trading analysis with 18+ technical indicators, 7 strategies, and AI-powered insights.</p>' +
          '<h4 class="mt-4">Features</h4>' +
          '<ul class="feature-list">' +
            '<li>Real-time candlestick charting with lightweight-charts</li>' +
            '<li>18 technical indicators (EMA, RSI, MACD, Bollinger, ATR, VWAP, etc.)</li>' +
            '<li>Smart Money Concepts: BOS, CHoCH, liquidity sweeps</li>' +
            '<li>7 trading strategies with weighted scoring</li>' +
            '<li>Multi-symbol market scanner</li>' +
            '<li>Strategy backtester with equity curve</li>' +
            '<li>AI-powered market analysis (OpenAI, Gemini, OpenRouter, Compatible)</li>' +
            '<li>Real-time WebSocket price updates from Binance</li>' +
            '<li>Signal history with IndexedDB storage</li>' +
            '<li>Full risk management: position sizing, SL/TP, fees, slippage</li>' +
          '</ul>' +
          '<h4 class="mt-4">Supported Exchanges</h4>' +
          '<p>Binance (spot) — Free public API, no API key required for market data</p>' +
          '<h4 class="mt-4">Version</h4>' +
          '<p>1.0.0</p>' +
        '</div>';

      default:
        return '';
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // PUBLIC API
  // ════════════════════════════════════════════════════════════════════════════

  window.App = {
    // State (read-only for external access)
    get state() { return state; },

    // Navigation
    init: init,
    navigate: navigate,

    // UI
    showToast: showToast,
    showModal: function (title, content, footer) { showModal(title, content, footer); },
    closeModal: closeModal,

    // Actions
    analyzeSymbol: analyzeSymbol,
    runScanner: runScanner,
    runBacktest: runBacktest,
    saveSettings: saveSettings,
    deleteSignal: deleteSignal,

    // Data
    loadMarketData: loadMarketData,
    loadTickers: loadTickers,
    loadRecentSignals: loadRecentSignals,
    updateSymbol: updateSymbol,
    updateTimeframe: updateTimeframe,
  };

  // ════════════════════════════════════════════════════════════════════════════
  // AUTO-INIT ON DOM READY
  // ════════════════════════════════════════════════════════════════════════════

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      window.App.init();
    });
  } else {
    // DOM already loaded
    setTimeout(function () {
      window.App.init();
    }, 0);
  }

})();
