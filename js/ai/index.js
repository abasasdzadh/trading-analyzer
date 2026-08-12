/**
 * Multi-Provider AI Layer
 * Analyzes market data using Gemini, OpenAI, OpenRouter, or compatible APIs.
 *
 * Converted from TypeScript to browser-safe JavaScript.
 * API keys are passed via the config parameter (from settings UI / localStorage),
 * NOT from process.env.
 *
 * @namespace window.TradingAI
 */

(function () {
  'use strict';

  // === CONSTANTS ===

  var TIMEOUT_MS = 30000;

  var DEFAULT_MODELS = {
    gemini: 'gemini-2.0-flash',
    openai: 'gpt-4o-mini',
    openrouter: 'google/gemini-2.0-flash-exp:free',
    compatible: 'gpt-4o-mini',
  };

  // === HELPER: SAFE JSON PARSE ===

  /**
   * Attempt to parse AI response text as JSON, with fallback extraction from markdown.
   * @param {string} text - Raw AI response text
   * @returns {AIAnalysis|null} Parsed analysis or null
   */
  function tryParseJSON(text) {
    try {
      var parsed = JSON.parse(text);
      if (validateAIAnalysis(parsed)) {
        return parsed;
      }
    } catch (e) {
      // Not valid top-level JSON — try extraction below
    }

    // Attempt to extract JSON from markdown code blocks or mixed content
    var patterns = [
      /```(?:json)?\s*([\s\S]*?)```/,
      /\{[\s\S]*"summary"[\s\S]*\}/,
    ];

    for (var i = 0; i < patterns.length; i++) {
      var pattern = patterns[i];
      var match = text.match(pattern);
      if (match && (match[1] || match[0])) {
        try {
          var candidate = (match[1] || match[0]).trim();
          var parsed = JSON.parse(candidate);
          if (validateAIAnalysis(parsed)) {
            return parsed;
          }
        } catch (e2) {
          continue;
        }
      }
    }

    return null;
  }

  // === VALIDATION ===

  /**
   * Validate that an object conforms to the AIAnalysis shape.
   * @param {*} obj
   * @returns {boolean}
   */
  function validateAIAnalysis(obj) {
    if (typeof obj !== 'object' || obj === null) return false;

    var hasString = function (key) { return typeof obj[key] === 'string'; };
    var hasStringArray = function (key) {
      return Array.isArray(obj[key]) && obj[key].every(function (v) { return typeof v === 'string'; });
    };

    return (
      hasString('summary') &&
      hasString('trend') &&
      hasStringArray('bullishCase') &&
      hasStringArray('bearishCase') &&
      hasStringArray('risks') &&
      hasStringArray('confirmations') &&
      hasStringArray('invalidations') &&
      hasString('finalAssessment')
    );
  }

  // === PROMPT BUILDER ===

  /**
   * Build the analysis prompt from market data.
   * @param {MarketAnalysisObject} data
   * @returns {string}
   */
  function buildAnalysisPrompt(data) {
    var swingInfo = {
      trend: data.trend,
      swings: data.marketStructure.swings.slice(-10).map(function (s) {
        return {
          type: s.type,
          price: s.price,
          timestamp: new Date(s.timestamp).toISOString(),
        };
      }),
      structureBreaks: data.marketStructure.structureBreaks.slice(-5).map(function (b) {
        return {
          type: b.type,
          direction: b.direction,
          price: b.price,
          timestamp: new Date(b.timestamp).toISOString(),
        };
      }),
      liquiditySweeps: data.marketStructure.liquiditySweeps.slice(-5).map(function (l) {
        return {
          sweepType: l.sweepType,
          price: l.price,
          timestamp: new Date(l.timestamp).toISOString(),
        };
      }),
    };

    var supportResistance = data.supportResistance.slice(0, 8).map(function (z) {
      return {
        type: z.type,
        lower: z.lower,
        upper: z.upper,
        strength: z.strength,
        touches: z.touches,
      };
    });

    var candlePatterns = data.patterns.slice(-5).map(function (p) {
      return {
        name: p.name,
        direction: p.direction,
        strength: p.strength,
      };
    });

    var chartPatterns = data.chartPatterns.slice(-5).map(function (p) {
      return {
        type: p.type,
        direction: p.direction,
        confidence: p.confidence,
      };
    });

    var strategies = data.strategies.map(function (s) {
      return {
        name: s.name,
        direction: s.direction,
        score: s.score,
        reasons: s.reasons,
        warnings: s.warnings,
      };
    });

    var conflicts = data.conflicts.map(function (c) {
      return {
        category: c.category,
        bullish: c.bullish,
        bearish: c.bearish,
        severity: c.severity,
      };
    });

    return 'You are an expert market analyst. Analyze the following market data and provide a structured analysis.\n' +

'CRITICAL RULES:\n' +
'- Do NOT generate, suggest, or calculate any prices, indicators, entry levels, stop-loss levels, or take-profit levels.\n' +
'- Your role is ONLY to analyze the provided data and explain what it means.\n' +
'- Respond ONLY with valid JSON matching the required structure.\n' +
'- Keep each string concise (1-2 sentences max).\n' +

'MARKET DATA:\n' +
'- Symbol: ' + data.symbol + '\n' +
'- Timeframe: ' + data.timeframe + '\n' +
'- Current Price: ' + data.price + '\n' +
'- Market Regime: ' + data.regime + '\n' +
'- Momentum: ' + data.momentum + '\n' +
'- Volatility: ' + data.volatility + '\n' +
'- Volume: ' + data.volume + '\n' +
'- Signal Direction: ' + data.signalDirection + '\n' +
'- Signal Score: ' + data.signalScore + '/100\n' +
'- Risk-Reward Ratio: ' + data.riskReward + '\n' +

'INDICATOR SNAPSHOT:\n' +
(data.rsi !== undefined ? '- RSI: ' + data.rsi + '\n' : '') +
(data.macd ? '- MACD: ' + data.macd.macd + ', Signal: ' + data.macd.signal + ', Histogram: ' + data.macd.histogram + '\n' : '') +
(data.emaAlignment ? '- EMA Alignment: ' + data.emaAlignment + '\n' : '') +
(data.volumeProfile ? '- Volume Profile: ' + data.volumeProfile + '\n' : '') +

'SWING STRUCTURE:\n' +
JSON.stringify(swingInfo, null, 2) + '\n' +

'SUPPORT & RESISTANCE (top 8):\n' +
JSON.stringify(supportResistance, null, 2) + '\n' +

'RECENT CANDLESTICK PATTERNS:\n' +
(candlePatterns.length > 0 ? JSON.stringify(candlePatterns, null, 2) : 'None detected') + '\n' +

'CHART PATTERNS:\n' +
(chartPatterns.length > 0 ? JSON.stringify(chartPatterns, null, 2) : 'None detected') + '\n' +

'STRATEGY SIGNALS:\n' +
JSON.stringify(strategies, null, 2) + '\n' +

'CONFLICTS:\n' +
(conflicts.length > 0 ? JSON.stringify(conflicts, null, 2) : 'None') + '\n' +

'Respond with a JSON object with EXACTLY this structure:\n' +
'{\n' +
'  "summary": "Brief overall market summary",\n' +
'  "trend": "Trend explanation",\n' +
'  "bullishCase": ["reason 1", "reason 2"],\n' +
'  "bearishCase": ["reason 1", "reason 2"],\n' +
'  "risks": ["risk 1", "risk 2"],\n' +
'  "confirmations": ["confirmation 1", "confirmation 2"],\n' +
'  "invalidations": ["invalidation 1", "invalidation 2"],\n' +
'  "finalAssessment": "Your final assessment"\n' +
'}';
  }

  // === HELPER: FETCH WITH TIMEOUT ===

  /**
   * Fetch with an AbortController-based timeout.
   * @param {string} url
   * @param {RequestInit} init
   * @param {number} [timeoutMs]
   * @returns {Promise<Response>}
   */
  async function fetchWithTimeout(url, init, timeoutMs) {
    if (timeoutMs === undefined) timeoutMs = TIMEOUT_MS;
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, timeoutMs);

    try {
      var response = await fetch(url, Object.assign({}, init, { signal: controller.signal }));
      return response;
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new Error('Request timed out after ' + (timeoutMs / 1000) + 's');
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  // === HELPER: EXTRACT TEXT FROM GEMINI RESPONSE ===

  /**
   * Extract text content from a Gemini API response body.
   * @param {*} body - Parsed JSON response
   * @returns {string}
   */
  function extractGeminiText(body) {
    var candidates = body.candidates;
    if (!candidates || !candidates.length) return '';
    var content = candidates[0].content;
    if (!content) return '';
    var parts = content.parts;
    if (!parts || !parts.length) return '';
    return parts[0].text || '';
  }

  // === HELPER: EXTRACT TEXT FROM OPENAI-STYLE RESPONSE ===

  /**
   * Extract text content from an OpenAI-compatible API response body.
   * @param {*} body - Parsed JSON response
   * @returns {string}
   */
  function extractOpenAIText(body) {
    var choices = body.choices;
    if (!choices || !choices.length) return '';
    var message = choices[0].message;
    if (!message) return '';
    return message.content || '';
  }

  // === NULL ANALYSIS FALLBACK ===

  /**
   * Create a null/placeholder AIAnalysis with a reason message.
   * @param {string} reason
   * @returns {AIAnalysis}
   */
  function nullAnalysis(reason) {
    return {
      summary: 'AI analysis unavailable: ' + reason,
      trend: 'Unable to determine',
      bullishCase: [],
      bearishCase: [],
      risks: ['AI analysis failed'],
      confirmations: [],
      invalidations: [],
      finalAssessment: 'Analysis could not be completed.',
    };
  }

  // ============================================================
  // PROVIDER IMPLEMENTATIONS
  // ============================================================

  // --- GEMINI ---

  /**
   * Google Gemini AI provider.
   * @param {AIConfig} config
   * @constructor
   */
  function GeminiProvider(config) {
    this.name = 'Google Gemini';
    this.apiKey = config.apiKey || '';
    this.model = config.model || DEFAULT_MODELS.gemini;
  }

  GeminiProvider.prototype.isConfigured = function () {
    return this.apiKey.length > 0;
  };

  GeminiProvider.prototype.analyzeMarket = async function (data) {
    if (!this.isConfigured()) {
      return null;
    }

    var url = 'https://generativelanguage.googleapis.com/v1beta/models/' +
      encodeURIComponent(this.model) + ':generateContent?key=' + this.apiKey;
    var prompt = buildAnalysisPrompt(data);

    try {
      var res = await fetchWithTimeout(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 2048,
            responseMimeType: 'application/json',
          },
        }),
      });

      if (!res.ok) {
        var status = res.status;
        if (status === 429) {
          return nullAnalysis('Rate limited. Please try again shortly.');
        }
        return nullAnalysis('API error (HTTP ' + status + ')');
      }

      var body = await res.json();
      var text = extractGeminiText(body);
      var analysis = tryParseJSON(text);
      return analysis || nullAnalysis('Failed to parse AI response as valid JSON.');
    } catch (err) {
      var message = err instanceof Error ? err.message : 'Unknown error';
      return nullAnalysis(message);
    }
  };

  // --- OPENAI ---

  /**
   * OpenAI AI provider.
   * @param {AIConfig} config
   * @constructor
   */
  function OpenAIProvider(config) {
    this.name = 'OpenAI';
    this.apiKey = config.apiKey || '';
    this.model = config.model || DEFAULT_MODELS.openai;
  }

  OpenAIProvider.prototype.isConfigured = function () {
    return this.apiKey.length > 0;
  };

  OpenAIProvider.prototype.analyzeMarket = async function (data) {
    if (!this.isConfigured()) {
      return null;
    }

    var url = 'https://api.openai.com/v1/chat/completions';
    var prompt = buildAnalysisPrompt(data);

    try {
      var res = await fetchWithTimeout(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + this.apiKey,
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            {
              role: 'system',
              content: 'You are an expert market analyst. Always respond with valid JSON only, no markdown or extra text.',
            },
            { role: 'user', content: prompt },
          ],
          temperature: 0.3,
          max_tokens: 2048,
          response_format: { type: 'json_object' },
        }),
      });

      if (!res.ok) {
        var status = res.status;
        if (status === 429) {
          return nullAnalysis('Rate limited. Please try again shortly.');
        }
        return nullAnalysis('API error (HTTP ' + status + ')');
      }

      var body = await res.json();
      var text = extractOpenAIText(body);
      var analysis = tryParseJSON(text);
      return analysis || nullAnalysis('Failed to parse AI response as valid JSON.');
    } catch (err) {
      var message = err instanceof Error ? err.message : 'Unknown error';
      return nullAnalysis(message);
    }
  };

  // --- OPENROUTER ---

  /**
   * OpenRouter AI provider (aggregates multiple models).
   * @param {AIConfig} config
   * @constructor
   */
  function OpenRouterProvider(config) {
    this.name = 'OpenRouter';
    this.apiKey = config.apiKey || '';
    this.model = config.model || DEFAULT_MODELS.openrouter;
  }

  OpenRouterProvider.prototype.isConfigured = function () {
    return this.apiKey.length > 0;
  };

  OpenRouterProvider.prototype.analyzeMarket = async function (data) {
    if (!this.isConfigured()) {
      return null;
    }

    var url = 'https://openrouter.ai/api/v1/chat/completions';
    var prompt = buildAnalysisPrompt(data);

    try {
      var res = await fetchWithTimeout(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + this.apiKey,
          'HTTP-Referer': typeof window !== 'undefined' ? window.location.origin : '',
          'X-Title': 'TradingPlatform',
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            {
              role: 'system',
              content: 'You are an expert market analyst. Always respond with valid JSON only, no markdown or extra text.',
            },
            { role: 'user', content: prompt },
          ],
          temperature: 0.3,
          max_tokens: 2048,
        }),
      });

      if (!res.ok) {
        var status = res.status;
        if (status === 429) {
          return nullAnalysis('Rate limited. Please try again shortly.');
        }
        return nullAnalysis('API error (HTTP ' + status + ')');
      }

      var body = await res.json();
      var text = extractOpenAIText(body);
      var analysis = tryParseJSON(text);
      return analysis || nullAnalysis('Failed to parse AI response as valid JSON.');
    } catch (err) {
      var message = err instanceof Error ? err.message : 'Unknown error';
      return nullAnalysis(message);
    }
  };

  // --- COMPATIBLE (OpenAI-compatible) ---

  /**
   * OpenAI-compatible provider for self-hosted models (e.g. Ollama, LM Studio).
   * @param {AIConfig} config
   * @constructor
   */
  function CompatibleProvider(config) {
    this.name = 'Compatible';
    this.apiKey = config.apiKey || '';
    this.model = config.model || DEFAULT_MODELS.compatible;
    this.baseUrl = (config.baseUrl || '').replace(/\/+$/, '');
    if (!this.baseUrl) {
      this.baseUrl = 'http://localhost:11434/v1';
    }
  }

  CompatibleProvider.prototype.isConfigured = function () {
    return this.apiKey.length > 0 && this.baseUrl.length > 0;
  };

  CompatibleProvider.prototype.analyzeMarket = async function (data) {
    if (!this.isConfigured()) {
      return null;
    }

    var url = this.baseUrl + '/chat/completions';
    var prompt = buildAnalysisPrompt(data);

    try {
      var res = await fetchWithTimeout(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + this.apiKey,
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            {
              role: 'system',
              content: 'You are an expert market analyst. Always respond with valid JSON only, no markdown or extra text.',
            },
            { role: 'user', content: prompt },
          ],
          temperature: 0.3,
          max_tokens: 2048,
          response_format: { type: 'json_object' },
        }),
      });

      if (!res.ok) {
        var status = res.status;
        if (status === 429) {
          return nullAnalysis('Rate limited. Please try again shortly.');
        }
        return nullAnalysis('API error (HTTP ' + status + ')');
      }

      var body = await res.json();
      var text = extractOpenAIText(body);
      var analysis = tryParseJSON(text);
      return analysis || nullAnalysis('Failed to parse AI response as valid JSON.');
    } catch (err) {
      var message = err instanceof Error ? err.message : 'Unknown error';
      return nullAnalysis(message);
    }
  };

  // ============================================================
  // FACTORY
  // ============================================================

  /**
   * Create an AI provider instance based on config.
   * @param {AIConfig} config - Must include `provider` ('gemini'|'openai'|'openrouter'|'compatible') and `apiKey`
   * @returns {Object} Provider instance with `analyzeMarket(data)` and `isConfigured()`
   */
  function createAIProvider(config) {
    switch (config.provider) {
      case 'gemini':
        return new GeminiProvider(config);
      case 'openai':
        return new OpenAIProvider(config);
      case 'openrouter':
        return new OpenRouterProvider(config);
      case 'compatible':
        return new CompatibleProvider(config);
      default:
        throw new Error('Unknown AI provider: ' + config.provider);
    }
  }

  // ============================================================
  // CONVENIENCE FUNCTION
  // ============================================================

  /**
   * Analyze market data using the configured AI provider.
   * @param {MarketAnalysisObject} data - Market analysis data object
   * @param {AIConfig} [config] - AI configuration with provider, apiKey, model, baseUrl
   * @returns {Promise<AIAnalysis|null>} Analysis result or null if not configured
   */
  async function getAIAnalysis(data, config) {
    if (!config) {
      return null;
    }

    try {
      var provider = createAIProvider(config);

      if (!provider.isConfigured()) {
        return null;
      }

      return await provider.analyzeMarket(data);
    } catch (e) {
      return null;
    }
  }

  // ─── Export ──────────────────────────────────────────────────────────────────

  window.TradingAI = {
    buildAnalysisPrompt: buildAnalysisPrompt,
    createAIProvider: createAIProvider,
    getAIAnalysis: getAIAnalysis,
    // Expose provider constructors for direct use if needed
    GeminiProvider: GeminiProvider,
    OpenAIProvider: OpenAIProvider,
    OpenRouterProvider: OpenRouterProvider,
    CompatibleProvider: CompatibleProvider,
    // Internal helpers exposed for testing
    _tryParseJSON: tryParseJSON,
    _validateAIAnalysis: validateAIAnalysis,
    _nullAnalysis: nullAnalysis,
  };

})();
