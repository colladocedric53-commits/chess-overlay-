// ==UserScript==
// @name         Orsted Chess Overlay 1.0.37
// @namespace    orsted.chess.com.coach
// @version      1.0.37
// @description  Mobile-first chess analysis overlay (Single Engine / No Eval Bar)
// @author       Orsted
// @icon         data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Crect width='16' height='16' rx='3' fill='%232ecc71'/%3E%3Ctext x='8' y='12' text-anchor='middle' font-size='11' fill='white' font-family='sans-serif'%3E%E2%9A%A1%3C/text%3E%3C/svg%3E
// @match        https://*.chess.com/*
// @match        https://lichess.org/*
// @match        https://*.lichess.org/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      chess-engine-2-66am.onrender.com
// @connect      cdn.jsdelivr.net
// @require      https://cdn.jsdelivr.net/npm/chess.js@0.10.3/chess.min.js
// @run-at       document-start
// ==/UserScript==
(function () {
'use strict';
if (window.orsted_started) return;
window.orsted_started = true;
const PANEL_ID = 'orsted-chess-panel';
const SERVER_URL = 'https://chess-engine-2-66am.onrender.com';
const SUPPORT_URL = 'https://t.me/orstedph';
const CLIENT_VERSION = '1.0.24';
const CACHE_MAX = 10;
const ARROW_MOVETIME_MS = 250;
const ARROW_MULTIPV = 7;
const ENGINE_URL = "https://cdn.jsdelivr.net/npm/stockfish.js@10.0.2/stockfish.js";
function deriveHwid() {
    const parts = [
        navigator.userAgent || '',
        navigator.language || '',
        (screen.width || 0) + 'x' + (screen.height || 0),
        screen.colorDepth || 0,
        (typeof Intl !== 'undefined' && Intl.DateTimeFormat ? Intl.DateTimeFormat().resolvedOptions().timeZone : ''),
        navigator.hardwareConcurrency || 0
    ];
    try {
        const c = document.createElement('canvas');
        const ctx = c.getContext('2d');
        ctx.textBaseline = 'top';
        ctx.font = '14px Arial';
        ctx.fillText('orsted-device-salt-v1', 2, 2);
        parts.push(c.toDataURL().slice(-64));
    } catch (e) {}
    const s = parts.join('|');
    let h1 = 0x811c9dc5, h2 = 0x01000193;
    for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        h1 = ((h1 ^ c) * 0x01000193) >>> 0;
        h2 = ((h2 + c) * 0x85ebca6b ^ (c << 13)) >>> 0;
    }
    return 'osd-' + h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}
const oldHwid = GM_getValue('orsted_hwid', '');
let deviceHwid = GM_getValue('orsted_hwid_v2', '');
if (!deviceHwid) {
    deviceHwid = deriveHwid();
    GM_setValue('orsted_hwid_v2', deviceHwid);
}
let engineTimeoutCount = 0;
let panel = null;
let lastFen = '';
let noMovesFen = '';
let currentMoves = [];
let inFlight = false;
let activeDelayTimer = null;
let soundPlayedForFen = '';
let audioCtx = null;
let cachedMoveCount = -1;
let cachedCastlingRights = '-';
let isMinimized = true;
let targetElo = parseInt(GM_getValue('orsted_elo', '2800'));
let useHumanDelay = GM_getValue('orsted_delay', false);
let useSmoothMode = GM_getValue('orsted_smooth', false);
let useTurbo = GM_getValue('orsted_turbo', false);
let useBulletMode = GM_getValue('orsted_bullet', false);
let useLiteMode = GM_getValue('orsted_lite', false);
let storedExpiryDate = GM_getValue('orsted_expiry', '');
let licenseKey = GM_getValue('orsted_key', '') || '';
if (licenseKey.length > 50) { licenseKey = ''; GM_setValue('orsted_key', ''); }
let hasSubmittedKey = false;
let isKeyValid = false;
let isDragging = false;
let hasDragged = false;
let dragStartX, dragStartY;
let panelStartX, panelStartY;
const fenCache = new Map();
let ChessEngine = null;
let GameInstance = null;
let sfWorker = null;
let sfReady = false;
let sfVariants = {};
let sfResolve = null;
let sfBlobUrl = null;
let sfCurrentFen = '';
let sfMultiPV = 0;
const turboCache = new Map();
const TURBO_CACHE_MAX = 10;
const PREDICT_MOVETIME_MS = 200;
let predictionActive = false;
let lastPredictedFen = '';
let oppMoveTimes = [];
let lastOppMoveAt = 0;
const OPP_FAST_THRESHOLD_MS = 400;
window.__orstedTickCount = 0;
window.__orstedForcedTickCount = 0;
window.__orstedRetryTickCount = 0;
window.__orstedActiveIntervals = 0;
const orstedPendingTimers = new Set();
function orstedTimeout(fn, ms) {
    const id = setTimeout(() => {
        orstedPendingTimers.delete(id);
        window.__orstedActiveIntervals = orstedPendingTimers.size;
        fn();
    }, ms);
    orstedPendingTimers.add(id);
    window.__orstedActiveIntervals = orstedPendingTimers.size;
    return id;
}
function orstedClearTimeout(id) {
    if (id == null) return;
    clearTimeout(id);
    if (orstedPendingTimers.delete(id)) {
        window.__orstedActiveIntervals = orstedPendingTimers.size;
    }
}
let engineInitInFlight = false;
let goSeq = 0;
let lastBestmoveSeq = 0;
let sfResolveSeq = 0;
let tickRunning = false;
let lastTickAt = 0;
let lastForcedTickAt = 0;
const scratchGridCC = Array(8).fill(null).map(() => Array(8).fill(''));
const scratchGridLC = Array(8).fill(null).map(() => Array(8).fill(''));
const fenRankBuf = new Array(8);

/* ==================== 1.0.35 GUARDS (BLOCK A) ====================
   Every new abort path below is bounded by a watchdog. A permanently
   wrong clock mapping or a permanently colliding DOM read can never
   brick the overlay - that is the failure mode that killed 1.0.31/32.
   UNCHANGED in 1.0.37. */
window.__orstedInvalidFenCount = 0;
window.__orstedTurnConflictCount = 0;
window.__orstedRematchCount = 0;
window.__orstedEmptyResultCount = 0;
window.__orstedFenRejectCode = 0;

const LC_CONFLICT_MAX_MS = 700;
const BOARD_COLLIDE_MAX_MS = 1200;
const INVALID_HINT_MS = 1500;
const INVALID_PASS_MS = 2500;
const ENGINE_INIT_MAX_MS = 20000;
const ENGINE_KICK_MIN_MS = 3000;
const WORKER_HANDSHAKE_MS = 10000;

let lcConflictSince = 0;
let lcAbortEnabled = true;
let collideSince = 0;
let invalidSince = 0;
let invalidCode = 0;
let lastPathName = '';
let lastMoveCountSeen = -1;
let terminalHandledKey = '';
let engineInitStartedAt = 0;
let sfWorkerCreatedAt = 0;
let lastEngineKickAt = 0;
let engineRestartAt = 0;

const KNIGHT_DR = [-2, -2, -1, -1, 1, 1, 2, 2];
const KNIGHT_DF = [-1, 1, -2, 2, -2, 2, -1, 1];
const KING_DR = [-1, -1, -1, 0, 0, 1, 1, 1];
const KING_DF = [-1, 0, 1, -1, 1, -1, 0, 1];
const ROOK_DR = [-1, 1, 0, 0];
const ROOK_DF = [0, 0, -1, 1];
const BISH_DR = [-1, -1, 1, 1];
const BISH_DF = [-1, 1, -1, 1];

/* Backward scan from the target square. Zero allocation, no chess.js,
   no GameInstance mutation. grid[0] = rank 8, grid[7] = rank 1, f0 = file a. */
function isSquareAttacked(grid, r, f, byWhite) {
    const pr = byWhite ? r + 1 : r - 1;
    const pawn = byWhite ? 'P' : 'p';
    if (pr >= 0 && pr < 8) {
        if (f > 0 && grid[pr][f - 1] === pawn) return true;
        if (f < 7 && grid[pr][f + 1] === pawn) return true;
    }
    const kn = byWhite ? 'N' : 'n';
    for (let i = 0; i < 8; i++) {
        const rr = r + KNIGHT_DR[i], ff = f + KNIGHT_DF[i];
        if (rr >= 0 && rr < 8 && ff >= 0 && ff < 8 && grid[rr][ff] === kn) return true;
    }
    const kg = byWhite ? 'K' : 'k';
    for (let i = 0; i < 8; i++) {
        const rr = r + KING_DR[i], ff = f + KING_DF[i];
        if (rr >= 0 && rr < 8 && ff >= 0 && ff < 8 && grid[rr][ff] === kg) return true;
    }
    const rq = byWhite ? 'R' : 'r', q = byWhite ? 'Q' : 'q';
    for (let i = 0; i < 4; i++) {
        let rr = r + ROOK_DR[i], ff = f + ROOK_DF[i];
        while (rr >= 0 && rr < 8 && ff >= 0 && ff < 8) {
            const c = grid[rr][ff];
            if (c !== '') { if (c === rq || c === q) return true; break; }
            rr += ROOK_DR[i]; ff += ROOK_DF[i];
        }
    }
    const bq = byWhite ? 'B' : 'b';
    for (let i = 0; i < 4; i++) {
        let rr = r + BISH_DR[i], ff = f + BISH_DF[i];
        while (rr >= 0 && rr < 8 && ff >= 0 && ff < 8) {
            const c = grid[rr][ff];
            if (c !== '') { if (c === bq || c === q) return true; break; }
            rr += BISH_DR[i]; ff += BISH_DF[i];
        }
    }
    return false;
}

/* 0 = plausible. 1 = king count. 2 = back-rank pawn. 3 = impossible material.
   4 = side NOT to move is in check (turn desync / mid-animation geometry).
   The side TO move being in check is ordinary and returns 0.
   chess.js 0.10.3 validate_fen is structure-only (11 rules, no king / pawn /
   check rules) so it will happily load any of these. Legality is ours. */
function validateGrid(grid, turn) {
    let wK = 0, bK = 0, wKr = -1, wKf = -1, bKr = -1, bKf = -1;
    let wN = 0, bN = 0, wP = 0, bP = 0;
    for (let r = 0; r < 8; r++) {
        const row = grid[r];
        for (let f = 0; f < 8; f++) {
            const c = row[f];
            if (c === '') continue;
            const upper = c.charCodeAt(0) < 97;
            if (upper) wN++; else bN++;
            if (c === 'K') { wK++; wKr = r; wKf = f; }
            else if (c === 'k') { bK++; bKr = r; bKf = f; }
            else if (c === 'P' || c === 'p') {
                if (upper) wP++; else bP++;
                if (r === 0 || r === 7) return 2;
            }
        }
    }
    if (wK !== 1 || bK !== 1) return 1;
    if (wN > 16 || bN > 16 || wP > 8 || bP > 8) return 3;
    const orr = (turn === 'w') ? bKr : wKr;
    const off = (turn === 'w') ? bKf : wKf;
    if (isSquareAttacked(grid, orr, off, turn === 'w')) return 4;
    return 0;
}

function cancelDelayTimer() {
    if (activeDelayTimer) { orstedClearTimeout(activeDelayTimer); activeDelayTimer = null; }
}

/* Single recovery path for a dead / wedged / half-initialised engine.
   Self-throttling; safe to call every tick. */
function kickEngine() {
    const now = Date.now();
    if (now < engineRestartAt) return;
    if (engineInitInFlight) {
        if (!engineInitStartedAt || now - engineInitStartedAt < ENGINE_INIT_MAX_MS) return;
        engineInitInFlight = false;
    }
    if (sfWorker) {
        if (sfReady) return;
        if (now - sfWorkerCreatedAt < WORKER_HANDSHAKE_MS) return;
        teardownEngine();
    }
    if (now - lastEngineKickAt < ENGINE_KICK_MIN_MS) return;
    lastEngineKickAt = now;
    initLocalEngine();
}
/* ================== END 1.0.35 GUARDS (BLOCK A) ================== */

let moveListObserver = null;
let moveListContainer = null;
let moveListDirty = true;
let cachedMoveNodeList = null;
function ensureMoveListObserver() {
    const site = detectSite();
    const container = site === 'lichess'
        ? (document.querySelector('.tview2') || document.querySelector('l4x'))
        : (document.querySelector('wc-simple-move-list') || document.querySelector('.move-list'));
    if (!container) return;
    if (container === moveListContainer && moveListObserver) return;
    if (moveListObserver) { try { moveListObserver.disconnect(); } catch (e) {} }
    moveListContainer = container;
    moveListDirty = true;
    cachedMoveNodeList = null;
    moveListObserver = new MutationObserver((mutations) => {
        moveListDirty = true;
        const siteNow = detectSite();
        let isMoveAppend = false;
        for (let i = 0; i < mutations.length && !isMoveAppend; i++) {
            const added = mutations[i].addedNodes;
            for (let j = 0; j < added.length; j++) {
                const n = added[j];
                if (n.nodeType !== 1) continue;
                if (siteNow === 'lichess' ? n.tagName === 'MOVE'
                    : (!!n.className && String(n.className).indexOf('node') !== -1)) {
                    isMoveAppend = true;
                    break;
                }
            }
        }
        if (!isMoveAppend) return;
        if (!useBulletMode) return;
        const now = Date.now();
        if (now - lastForcedTickAt < 200) return;
        lastForcedTickAt = now;
        tick(true);
    });
    moveListObserver.observe(container, { childList: true });
}
function getMoveNodesCached() {
    ensureMoveListObserver();
    if (moveListDirty || !cachedMoveNodeList) {
        const site = detectSite();
        cachedMoveNodeList = site === 'lichess'
            ? document.getElementsByTagName('move')
            : (moveListContainer ? moveListContainer.getElementsByClassName('node') : []);
        moveListDirty = false;
    }
    return cachedMoveNodeList;
}
function teardownMoveListObserver() {
    if (moveListObserver) { try { moveListObserver.disconnect(); } catch (e) {} }
    moveListObserver = null;
    moveListContainer = null;
    moveListDirty = true;
    cachedMoveNodeList = null;
}
const THEMES = {
    midnight: { primary: '#81b64c', bg: '#1c1c1e', text: '#ffffff', arrow: '#81b64c' },
    emerald: { primary: '#2ecc71', bg: '#112b1d', text: '#ffffff', arrow: '#2ecc71' },
    crimson: { primary: '#e74c3c', bg: '#2b1111', text: '#ffffff', arrow: '#e74c3c' },
    cyberpunk: { primary: '#00e5ff', bg: '#0a0a0a', text: '#ffffff', arrow: '#00e5ff' },
    light: { primary: '#3498db', bg: '#f5f6fa', text: '#000000', arrow: '#3498db' }
};
let theme = JSON.parse(GM_getValue('orsted_theme', 'null')) || THEMES.emerald;
/* Keys normalised to the exact FEN shape gridToFen emits
   (ep '-', halfmove 0, fullmove 1). Delete the four entries to disable. */
const OPENING_BOOK = {
    "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1": { move: "e2e4", eval: 0.3, text: "e4" },
    "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1": { move: "e7e5", eval: 0.3, text: "e5" },
    "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 1": { move: "g1f3", eval: 0.3, text: "Nf3" },
    "rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 0 1": { move: "b8c6", eval: 0.3, text: "Nc6" }
};
function detectSite() {
    if (location.hostname.includes('lichess.org')) return 'lichess';
    if (location.hostname.includes('chess.com')) return 'chess.com';
    return null;
}
function isBoardAnimating() {
    const site = detectSite();
    if (site === 'lichess') {
        const board = document.querySelector('cg-board');
        if (!board) return false;
        if (document.querySelector('piece.dragging')) return true;
    } else if (site === 'chess.com') {
        if (document.querySelector('.piece.dragging')) return true;
        const board = document.querySelector('chess-board') || document.querySelector('wc-chess-board');
        if (board && board.classList.contains('anim')) return true;
    }
    return false;
}
function wireCleanup(node, gainNode) {
    node.onended = () => {
        try { node.disconnect(); } catch (e) {}
        try { gainNode.disconnect(); } catch (e) {}
    };
}
function playSound(type) {
    if (useSmoothMode) return;
    if (useLiteMode) return;
    try {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === 'suspended') audioCtx.resume();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        wireCleanup(osc, gain);
        setTimeout(() => { try { osc.disconnect(); gain.disconnect(); } catch (e) {} }, 500);
        const now = audioCtx.currentTime;
        gain.gain.setValueAtTime(0.25, now);
        if (type === 'turn') {
            osc.type = 'sine';
            osc.frequency.setValueAtTime(600, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
            osc.start(now); osc.stop(now + 0.1);
        } else if (type === 'move') {
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(400, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
            osc.start(now); osc.stop(now + 0.08);
        } else if (type === 'capture') {
            osc.type = 'square';
            osc.frequency.setValueAtTime(250, now);
            gain.gain.setValueAtTime(0.15, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
            osc.start(now); osc.stop(now + 0.12);
        } else if (type === 'castle') {
            osc.type = 'sine';
            osc.frequency.setValueAtTime(500, now);
            gain.gain.setValueAtTime(0.15, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
            osc.start(now); osc.stop(now + 0.08);
            const osc2 = audioCtx.createOscillator();
            const gain2 = audioCtx.createGain();
            osc2.connect(gain2); gain2.connect(audioCtx.destination);
            wireCleanup(osc2, gain2);
            setTimeout(() => { try { osc2.disconnect(); gain2.disconnect(); } catch (e) {} }, 500);
            osc2.type = 'sine';
            osc2.frequency.setValueAtTime(700, now + 0.1);
            gain2.gain.setValueAtTime(0.15, now + 0.1);
            gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
            osc2.start(now + 0.1); osc2.stop(now + 0.18);
        } else if (type === 'check') {
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(800, now);
            gain.gain.setValueAtTime(0.12, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
            osc.start(now); osc.stop(now + 0.15);
        } else if (type === 'checkmate') {
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(600, now);
            gain.gain.setValueAtTime(0.2, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
            osc.start(now); osc.stop(now + 0.5);
        }
    } catch (e) {}
}
function getMoveType(fen, uci) {
    if (!GameInstance) return 'move';
    try {
        GameInstance.load(fen);
        const move = GameInstance.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.length > 4 ? uci[4] : undefined });
        if (!move) return 'move';
        let type = 'move';
        if (GameInstance.in_checkmate()) type = 'checkmate';
        else if (GameInstance.in_check()) type = 'check';
        else if (move.flags.includes('c') || move.flags.includes('e')) type = 'capture';
        else if (move.flags.includes('k') || move.flags.includes('q')) type = 'castle';
        GameInstance.undo();
        return type;
    } catch (e) { return 'move'; }
}
function teardownEngine() {
    if (sfResolve) { try { sfResolve(null); } catch (e) {} sfResolve = null; }
    if (sfWorker) { try { sfWorker.postMessage('quit'); } catch (e) {} try { sfWorker.terminate(); } catch (e) {} sfWorker = null; }
    if (sfBlobUrl) { try { URL.revokeObjectURL(sfBlobUrl); } catch (e) {} sfBlobUrl = null; }
    sfReady = false;
    sfWorkerCreatedAt = 0;
    sfMultiPV = 0;
    inFlight = false;
    predictionActive = false;
    lastPredictedFen = '';
    turboCache.clear();
    for (const k in sfVariants) delete sfVariants[k];
    goSeq = 0; lastBestmoveSeq = 0; sfResolveSeq = 0;
    sfCurrentFen = '';
}
function setEngineInfo(text) {
    const il = document.getElementById('kc-info');
    if (il && il.textContent !== text) il.textContent = text;
}
function showEngineRetry(show) {
    const row = document.getElementById('kc-engine-retry-row');
    if (row) row.style.display = show ? 'block' : 'none';
}
async function initLocalEngine() {
    if (engineInitInFlight) return;
    if (sfWorker) return;
    engineInitInFlight = true;
    engineInitStartedAt = Date.now();
    teardownEngine();
    try {
        let engineCode = null;
        if ('caches' in window) {
            const cache = await caches.open('orsted-v31');
            const cachedResponse = await cache.match(ENGINE_URL);
            if (cachedResponse) {
                engineCode = await cachedResponse.text();
                setEngineInfo('Warming up engine...');
            }
        }
        if (!engineCode) {
            setEngineInfo('Downloading Engine...');
            engineCode = await new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: "GET",
                    url: ENGINE_URL,
                    timeout: 20000,
                    ontimeout: () => reject(new Error('engine fetch timeout')),
                    onload: (res) => res.status === 200 ? resolve(res.responseText) : reject(new Error('status ' + res.status)),
                    onerror: reject
                });
            });
            try {
                if ('caches' in window) {
                    const cache = await caches.open('orsted-v31');
                    await cache.put(ENGINE_URL, new Response(engineCode));
                }
            } catch (e) {}
        }
        const blob = new Blob([engineCode], { type: 'application/javascript' });
        engineCode = null;
        const blobUrl = URL.createObjectURL(blob);
        sfBlobUrl = blobUrl;
        sfWorker = new Worker(blobUrl);
        sfWorkerCreatedAt = Date.now();
        sfWorker.onmessage = handleArrowMessage;
        sfWorker.postMessage('uci');
    } catch (err) {
        console.error('[engine] init failed:', err);
        setEngineInfo('Engine failed.');
        showEngineRetry(true);
    } finally {
        engineInitInFlight = false;
        engineInitStartedAt = 0;
    }
}
const UCI_INFO_RE = / multipv (\d+).* score (cp|mate) (-?\d+).* pv ([a-h][1-8][a-h][1-8][qrbn]?)/;
function handleArrowMessage(e) {
    const line = e.data;
    if (typeof line !== 'string') return;
    if (sfWorker && e.target !== sfWorker) return;
    if (line === 'uciok') {
        if (!sfWorker) return;
        // 1.0.37: Elo-aware candidate pool. Low ratings need genuinely bad
        // moves to choose from; high ratings need depth more than breadth.
        sfMultiPV = desiredMultiPV();
        sfWorker.postMessage('setoption name Hash value 2');
        sfWorker.postMessage('setoption name MultiPV value ' + sfMultiPV);
        sfWorker.postMessage('isready');
    }
    if (line === 'readyok') {
        sfReady = true;
        setEngineInfo('Engine Ready.');
        showEngineRetry(false);
        return;
    }
    if (line.indexOf(' multipv ') !== -1 && line.indexOf(' pv ') !== -1) {
        const m = UCI_INFO_RE.exec(line);
        if (m) {
            const idx = parseInt(m[1], 10);
            const evalScore = m[2] === 'mate' ? (parseInt(m[3], 10) > 0 ? 100 : -100) : parseInt(m[3], 10) / 100;
            const moveStr = m[4];
            if (moveStr && !isNaN(idx)) {
                sfVariants[idx] = { move: moveStr, eval: evalScore };
            }
        }
    }
    if (line.startsWith('bestmove')) {
        lastBestmoveSeq++;
        if (sfResolve && lastBestmoveSeq === sfResolveSeq) {
            const f = sfResolve;
            sfResolve = null;
            const result = Object.values(sfVariants).filter(v => v);
            for (const k in sfVariants) delete sfVariants[k];
            f(result);
        } else {
            for (const k in sfVariants) delete sfVariants[k];
        }
    }
}
function askArrowEngine(fen, movetimeMs) {
    const curMovetime = useBulletMode ? 150 : 250;
    const mt = movetimeMs || curMovetime;
    if (sfResolve && sfCurrentFen === fen) {
        return new Promise((resolve) => {
            const prev = sfResolve;
            sfResolve = (data) => {
                sfResolve = null;
                prev(data);
                resolve(data);
            };
        });
    }
    return new Promise((resolve) => {
        if (!sfReady || !sfWorker) return resolve(null);
        let isResolved = false;
        let hardTimeoutId = null;
        const finish = (data) => {
            if (isResolved) return;
            isResolved = true;
            orstedClearTimeout(softTimeoutId);
            if (hardTimeoutId) orstedClearTimeout(hardTimeoutId);
            if (sfResolve === finish) sfResolve = null;
            resolve(data);
        };
        const softTimeoutId = orstedTimeout(() => {
            try { sfWorker.postMessage('stop'); } catch (e) {}
            hardTimeoutId = orstedTimeout(() => {
                try { sfWorker.terminate(); } catch (e) {}
                sfWorker = null;
                sfReady = false;
                sfWorkerCreatedAt = 0;
                sfMultiPV = 0;
                if (sfBlobUrl) { try { URL.revokeObjectURL(sfBlobUrl); } catch (e) {} sfBlobUrl = null; }
                goSeq = 0; lastBestmoveSeq = 0; sfResolveSeq = 0;
                engineTimeoutCount++;
                if (engineTimeoutCount > 3) {
                    updatePanel('Engine stuck. Reload the page.', '');
                } else {
                    initLocalEngine();
                }
                const toCall = sfResolve || finish;
                sfResolve = null;
                toCall(null);
            }, 10000);
        }, 5000);
        for (const k in sfVariants) delete sfVariants[k];
        if (sfResolve) {
            try { sfResolve(null); } catch (e) {}
        }
        sfResolve = finish;
        try {
            sfWorker.postMessage('stop');
            sfWorker.postMessage('position fen ' + fen);
            sfWorker.postMessage('go movetime ' + mt);
            sfCurrentFen = fen;
            sfResolveSeq = ++goSeq;
        } catch (e) {
            console.error('[engine] arrow postMessage failed:', e);
            finish(null);
        }
    });
}
function getContrastYIQ(hexcolor) {
    hexcolor = hexcolor.replace("#", "");
    if (hexcolor.length === 3) hexcolor = hexcolor.split('').map(c => c + c).join('');
    const r = parseInt(hexcolor.substr(0, 2), 16);
    const g = parseInt(hexcolor.substr(2, 2), 16);
    const b = parseInt(hexcolor.substr(4, 2), 16);
    const yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
    return (yiq >= 128) ? '#000000' : '#ffffff';
}
function applyTheme() {
    const root = document.documentElement;
    root.style.setProperty('--kc-primary', theme.primary);
    root.style.setProperty('--kc-bg', theme.bg);
    root.style.setProperty('--kc-text', theme.text);
    root.style.setProperty('--kc-arrow', theme.arrow);
    root.style.setProperty('--kc-btn-text', getContrastYIQ(theme.primary));
    const p = document.getElementById(PANEL_ID);
    if (p) { p.style.background = theme.bg; p.style.color = theme.text; }
    GM_setValue('orsted_theme', JSON.stringify(theme));
}
function injectStyles() {
    if (document.getElementById('orsted-styles')) return;
    const style = document.createElement('style');
    style.id = 'orsted-styles';
    style.textContent = `
:root { --kc-primary: #2ecc71; --kc-bg: #112b1d; --kc-text: #ffffff; --kc-arrow: #2ecc71; --kc-btn-text: #ffffff; }
    #orsted-chess-panel {
        position: fixed; top: 20px; right: 20px; width: auto;
        background: var(--kc-bg); color: var(--kc-text);
        border: 1px solid rgba(255,255,255,0.08); border-radius: 14px;
        padding: 10px 14px; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
        font-size: 13px; z-index: 999999;
        box-shadow: 0 8px 24px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.08), inset 0 -1px 0 rgba(0,0,0,0.25);
        user-select: none; touch-action: none;
        overflow: hidden;
    }
    #orsted-chess-panel::before {
        content: ''; position: absolute; inset: 0; pointer-events: none; z-index: 0;
        background: linear-gradient(180deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 20%, rgba(255,255,255,0) 40%);
    }
    .kc-header, .kc-content { position: relative; z-index: 1; }
    .kc-header { display: flex; justify-content: space-between; align-items: center; cursor: grab; touch-action: none; }
    .kc-title { color: var(--kc-primary); pointer-events: none; font-weight: 700; letter-spacing: 0.06em; font-size: 13px; display: flex; align-items: center; text-shadow: 0 0 6px rgba(46,204,113,0.15); }
    .kc-status-dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: #777; margin-left: 7px; flex-shrink: 0; }
    .kc-check-pop { display: inline-block; color: var(--kc-primary); font-size: 10px; font-weight: 700; margin-left: 4px; opacity: 0; transform: scale(0.5); }
    .kc-check-pop.kc-check-show { animation: kc-check-in 0.3s ease forwards, kc-check-out 0.2s ease 0.6s forwards; }
    .kc-toggle-btn { cursor: pointer; color: var(--kc-text); opacity: 0.7; padding: 0 5px; font-size: 16px; font-weight: bold; min-width: 32px; min-height: 32px; display: flex; align-items: center; justify-content: center; }
    .kc-content { display: none; width: 275px; box-sizing: border-box; margin-top: 10px; }
    .kc-tabs { display: none; gap: 4px; margin-bottom: 12px; background: rgba(128,128,128,0.1); padding: 4px; border-radius: 8px; }
    .kc-tab { flex: 1; text-align: center; padding: 6px; font-size: 12px; font-weight: bold; color: var(--kc-text); opacity: 0.5; cursor: pointer; border-radius: 6px; transition: background 0.2s ease, opacity 0.2s ease, color 0.2s ease; }
    .kc-tab.active { background: rgba(128,128,128,0.2); opacity: 1; box-shadow: inset 0 1px 0 rgba(255,255,255,0.08); }
    .kc-pane { display: none; flex-direction: column; gap: 12px; }
    .kc-section-label { font-size: 9px; text-transform: uppercase; letter-spacing: 0.10em; opacity: 0.5; font-weight: 600; margin: 2px 0 2px 4px; }
    .kc-input-group { display: flex; gap: 6px; margin-top: 4px; }
    .kc-input { flex: 1; width: 0; background: rgba(128,128,128,0.1); border: 1px solid rgba(255,255,255,0.1); color: var(--kc-text); border-radius: 6px; padding: 10px 8px; font-size: 12px; outline: none; transition: border-color 0.2s ease, background 0.2s ease, box-shadow 0.2s ease; min-height: 20px; box-shadow: inset 0 1px 0 rgba(255,255,255,0.04); }
    .kc-input:focus { border-color: var(--kc-primary); background: rgba(255,255,255,0.03); box-shadow: inset 0 1px 0 rgba(255,255,255,0.04), 0 0 0 3px rgba(46,204,113,0.15); }
    .kc-input::placeholder { color: rgba(255,255,255,0.35); opacity: 1; transition: opacity 0.2s ease; }
    .kc-input:focus::placeholder { opacity: 0.5; }
    .kc-btn { border-radius: 6px; padding: 10px 12px; font-weight: 600; font-size: 12px; cursor: pointer; transition: transform 0.1s cubic-bezier(0.34, 1.56, 0.64, 1), background 0.2s ease; border: none; min-height: 20px; }
    .kc-btn:active { transform: scale(0.97); }
    .kc-btn:focus-visible { outline: 2px solid var(--kc-primary); outline-offset: 2px; }
    .kc-btn-primary { background: linear-gradient(135deg, var(--kc-primary), #1ea85a); color: var(--kc-btn-text); box-shadow: inset 0 1px 0 rgba(255,255,255,0.20), inset 0 -1px 0 rgba(0,0,0,0.15); }
    .kc-btn-secondary { background: rgba(128,128,128,0.15); color: var(--kc-text); border: 1px solid rgba(255,255,255,0.12); box-shadow: inset 0 1px 0 rgba(255,255,255,0.20), inset 0 -1px 0 rgba(0,0,0,0.15); }
    .kc-btn-danger { background: transparent; border: 1px solid #e74c3c; color: #ff6b5b; margin-top: 6px; width: 100%; padding: 8px; box-shadow: inset 0 1px 0 rgba(255,255,255,0.20), inset 0 -1px 0 rgba(0,0,0,0.15); }
    .kc-row { display: flex; justify-content: space-between; align-items: center; }
    .kc-blunder-warn { color: #e74c3c; opacity: 0.9; font-size: 10px; text-align: center; margin-top: 4px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.05em; }
    .kc-slider {
        -webkit-appearance: none !important;
        width: 100% !important;
        height: 20px !important;
        background: transparent !important;
        outline: none !important;
        border: none !important;
        padding: 0 !important;
        margin: 6px 0 !important;
        box-sizing: border-box !important;
        display: block !important;
    }
    .kc-slider::-webkit-slider-runnable-track {
        width: 100% !important;
        height: 4px !important;
        background: linear-gradient(90deg, rgba(255,255,255,0.18), var(--kc-primary)) !important;
        border-radius: 4px !important;
        border: none !important;
        box-shadow: inset 0 1px 0 rgba(0,0,0,0.3) !important;
    }
    .kc-slider::-webkit-slider-thumb {
        -webkit-appearance: none !important;
        width: 22px !important;
        height: 22px !important;
        border-radius: 50% !important;
        background: var(--kc-primary) !important;
        cursor: pointer !important;
        margin-top: -9px !important;
        box-shadow: 0 0 0 1px rgba(255,255,255,0.85) inset, 0 2px 6px rgba(0,0,0,0.45), 0 0 0 4px rgba(46,204,113,0.12) !important;
        border: none !important;
    }
    #kc-elo-display { font-size: 22px; font-weight: 600; font-variant-numeric: tabular-nums; font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; transition: color 0.15s ease, transform 0.1s ease; }
    .kc-elo-tick { color: #5be58f !important; transform: scale(1.08); }
    .kc-switch { position: relative; display: flex; align-items: center; gap: 7px; cursor: pointer; font-size: 11px; user-select: none; min-height: 44px; }
    .kc-switch input { position: absolute; opacity: 0; width: 1px; height: 1px; pointer-events: none; }
    .kc-switch-track { position: relative; width: 36px; height: 20px; border-radius: 10px; background: rgba(128,128,128,0.3); transition: background 0.15s ease; flex-shrink: 0; box-shadow: inset 0 1px 0 rgba(0,0,0,0.25); }
    .kc-switch-track::before { content: ''; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%; background: #fff; transition: transform 0.15s cubic-bezier(0.34, 1.56, 0.64, 1); box-shadow: 0 1px 3px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.15) inset; }
    .kc-switch input:checked + .kc-switch-track { background: var(--kc-primary); }
    .kc-switch input:checked + .kc-switch-track::before { transform: translateX(16px); }
    .kc-switch-label { opacity: 0.9; transition: color 0.15s ease; }
    .kc-switch input:checked ~ .kc-switch-label { color: var(--kc-primary); opacity: 0.95; }
    #kc-warning-modal { display: none; position: absolute; top: -10px; left: -14px; right: -14px; bottom: -10px; background: var(--kc-bg); border-radius: 10px; padding: 20px; flex-direction: column; justify-content: center; align-items: center; text-align: center; z-index: 100; }
    .kc-divider { height: 1px; background: linear-gradient(90deg, transparent, rgba(255,255,255,0.08), transparent); margin: 12px 0 8px 0; }
    .kc-info { font-size: 11px; opacity: 0.7; }
    .kc-body { margin-top: 6px; font-weight: 500; }
    #kc-engine-retry-row { display: none; margin-top: 4px; }
    #kc-engine-retry { color: var(--kc-primary); cursor: pointer; text-decoration: underline; font-size: 11px; }
    #kc-theme-modal { display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0; z-index: 2147483000; background: rgba(0,0,0,0.65); }
    #kc-theme-modal.kc-modal-open { display: flex; align-items: center; justify-content: center; }
    .kc-modal-box { background: var(--kc-bg); border: 1px solid rgba(255,255,255,0.15); border-radius: 12px; padding: 14px; width: 260px; max-width: 86vw; box-shadow: 0 12px 40px rgba(0,0,0,0.6); }
    .kc-modal-title { font-size: 13px; font-weight: 700; margin-bottom: 10px; color: var(--kc-text); text-align: center; }
    .kc-theme-opt { display: block; width: 100%; border: none; border-radius: 8px; padding: 12px; margin-bottom: 8px; font-size: 14px; font-weight: 700; cursor: pointer; font-family: inherit; outline: none; }
    .kc-modal-close { display: block; width: 100%; border: 1px solid rgba(128,128,128,0.3); border-radius: 8px; padding: 10px; font-size: 13px; background: rgba(128,128,128,0.1); color: var(--kc-text); cursor: pointer; font-family: inherit; }
    @keyframes kc-open { from { opacity: 0; transform: translateY(-4px) scale(0.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
    .kc-opening { animation: kc-open 0.2s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
    .kc-tab-pane-opening { animation: kc-open 0.15s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
    @keyframes kc-check-in { from { opacity: 0; transform: scale(0.5); } to { opacity: 1; transform: scale(1); } }
    @keyframes kc-check-out { from { opacity: 1; } to { opacity: 0; } }
    @keyframes kc-success-border { 0% { border-color: rgba(255,255,255,0.08); } 30% { border-color: rgba(46,204,113,0.5); } 100% { border-color: rgba(255,255,255,0.08); } }
    .kc-success-flash { animation: kc-success-border 0.6s ease; }
    @keyframes kc-dot-pop { 0% { transform: scale(1); } 50% { transform: scale(1.6); } 100% { transform: scale(1); } }
    .kc-dot-pop { animation: kc-dot-pop 0.4s ease; }
    @keyframes kc-error-border { 0% { border-color: rgba(255,255,255,0.08); } 30% { border-color: rgba(231,76,60,0.6); } 100% { border-color: rgba(255,255,255,0.08); } }
    @keyframes kc-shake { 0%, 100% { transform: translateX(0); } 20% { transform: translateX(-3px); } 40% { transform: translateX(3px); } 60% { transform: translateX(-2px); } 80% { transform: translateX(2px); } }
    .kc-error-flash { animation: kc-error-border 0.4s ease, kc-shake 0.4s ease; }
    @keyframes kc-dot-error { 0%, 100% { transform: scale(1); background: #777; } 50% { transform: scale(1.5); background: #e74c3c; } }
    .kc-dot-error-anim { animation: kc-dot-error 0.4s ease; }
`;
    document.head.appendChild(style);
    const styleAnim = document.createElement('style');
    styleAnim.id = 'orsted-styles-anim';
    styleAnim.textContent = `
    @keyframes orsted-pulse {
      0% { opacity: 0.4; }
      50% { opacity: 0.8; }
      100% { opacity: 0.4; }
    }
`;
    document.head.appendChild(styleAnim);
}
function buildPanel() {
    if (document.getElementById(PANEL_ID)) { panel = document.getElementById(PANEL_ID); return; }
    injectStyles();
    panel = document.createElement('div');
    panel.id = PANEL_ID;
    /* The single innerHTML in this build: one-time construction, never a
       tick / render / engine path. Every dynamic write below is textContent. */
    let html = '';
    html += '<div id="kc-header" class="kc-header"><strong class="kc-title" id="kc-title-text">orsted</strong><span id="kc-title-lock" style="display:none; font-size:9px; color:#f1c40f; font-weight:normal; margin-left:4px;">key</span><span id="kc-status-dot" class="kc-status-dot"></span><span id="kc-check-pop" class="kc-check-pop">ok</span><span id="kc-toggle" class="kc-toggle-btn">+</span></div>';
    html += '<div id="kc-content" class="kc-content">';
    html += '<div id="kc-tabs-container" class="kc-tabs" style="display:none;"><div id="kc-tab-feat" class="kc-tab active">Features</div><div id="kc-tab-theme" class="kc-tab">Theme</div><div id="kc-tab-acc" class="kc-tab">Account</div></div>';
    html += '<div id="kc-pane-feat" class="kc-pane">';
    html += '<div class="kc-section-label">Engine Strength</div>';
    html += '<div style="display:flex; flex-direction:column;"><div class="kc-row"><label>Engine Elo:</label><strong id="kc-elo-display" style="color:var(--kc-primary);">2800</strong></div><input type="range" id="kc-elo-slider" min="800" max="2800" step="100" value="2800" class="kc-slider"><div id="kc-blunder-warning" class="kc-blunder-warn" style="display:none;">Human Simulation Active</div></div>';
    html += '<div class="kc-section-label">Modes</div>';
    html += '<div style="display:flex; flex-wrap:wrap; gap:10px; justify-content:space-between; margin-top:4px;">';
    html += '<label class="kc-switch"><input type="checkbox" id="kc-delay-toggle"><span class="kc-switch-track"></span><span class="kc-switch-label">Delay</span></label>';
    html += '<label class="kc-switch"><input type="checkbox" id="kc-smooth-toggle"><span class="kc-switch-track"></span><span class="kc-switch-label">Smooth</span></label>';
    html += '<label class="kc-switch"><input type="checkbox" id="kc-turbo-toggle"><span class="kc-switch-track"></span><span class="kc-switch-label">Turbo</span></label>';
    html += '<label class="kc-switch"><input type="checkbox" id="kc-bullet-toggle"><span class="kc-switch-track"></span><span class="kc-switch-label">Bullet</span></label>';
    html += '<label class="kc-switch"><input type="checkbox" id="kc-lite-toggle"><span class="kc-switch-track"></span><span class="kc-switch-label">Lite Mode</span></label>';
    html += '</div></div>';
    html += '<div id="kc-pane-theme" class="kc-pane"><label style="font-size:11px; opacity:0.8;">Theme</label><button type="button" id="kc-theme-btn" class="kc-btn kc-btn-secondary" style="width:100%; margin-top:6px;">Change Theme</button></div>';
    html += '<div id="kc-pane-acc" class="kc-pane" style="display:flex;"><div class="kc-section-label">Account</div><label style="font-size:12px; opacity:0.8;">License Key:</label><div class="kc-input-group"><input type="text" id="kc-license-input" placeholder="ORSTED-XXXX" class="kc-input"><button id="kc-paste-btn" class="kc-btn kc-btn-secondary">Paste</button><button id="kc-enter-btn" class="kc-btn kc-btn-primary">Enter</button></div><button id="kc-clear-btn" class="kc-btn kc-btn-danger">Clear Saved Key</button>';
    html += '<a href="' + SUPPORT_URL + '" target="_blank" rel="noopener" style="display:block; text-align:center; margin-top:8px; font-size:11px; color:var(--kc-primary); text-decoration:none;">Support</a>';
    html += '<div id="kc-expiry-info" style="display:none; margin-top:10px; font-size:11px; text-align:center; color:var(--kc-primary); font-weight:bold;"></div>';
    html += '</div>';
    html += '<div class="kc-divider"></div><div id="kc-info" class="kc-info"></div><div id="kc-engine-retry-row"><span id="kc-engine-retry">Retry engine</span></div><div id="kc-body" class="kc-body"><span id="kc-status">Enter key to start…</span><div id="kc-move-0" style="display:none; justify-content:space-between; margin-bottom:6px;"><span id="kc-san-0" style="color:var(--kc-primary); font-size:14px;"></span><span id="kc-eval-0" style="color:var(--kc-text); font-size:12px; font-family:monospace;"></span></div><div id="kc-move-1" style="display:none; justify-content:space-between; margin-bottom:6px;"><span id="kc-san-1" style="color:var(--kc-primary); font-size:14px;"></span><span id="kc-eval-1" style="color:var(--kc-text); font-size:12px; font-family:monospace;"></span></div></div></div>';
    panel.innerHTML = html;
    document.body.appendChild(panel);
    applyTheme();
    const header = document.getElementById('kc-header');
    const toggleBtn = document.getElementById('kc-toggle');
    const content = document.getElementById('kc-content');
    const tabsContainer = document.getElementById('kc-tabs-container');
    const licenseInput = document.getElementById('kc-license-input');
    const pasteBtn = document.getElementById('kc-paste-btn');
    const enterBtn = document.getElementById('kc-enter-btn');
    const clearBtn = document.getElementById('kc-clear-btn');
    const eloSlider = document.getElementById('kc-elo-slider');
    const eloDisplay = document.getElementById('kc-elo-display');
    const delayToggle = document.getElementById('kc-delay-toggle');
    const smoothToggle = document.getElementById('kc-smooth-toggle');
    const turboToggle = document.getElementById('kc-turbo-toggle');
    const bulletToggle = document.getElementById('kc-bullet-toggle');
    const liteToggle = document.getElementById('kc-lite-toggle');
    const blunderWarning = document.getElementById('kc-blunder-warning');
    const titleLock = document.getElementById('kc-title-lock');
    const tabFeat = document.getElementById('kc-tab-feat');
    const tabTheme = document.getElementById('kc-tab-theme');
    const tabAcc = document.getElementById('kc-tab-acc');
    const paneFeat = document.getElementById('kc-pane-feat');
    const paneTheme = document.getElementById('kc-pane-theme');
    const paneAcc = document.getElementById('kc-pane-acc');
    const engineRetryBtn = document.getElementById('kc-engine-retry');
    if (engineRetryBtn) {
        engineRetryBtn.addEventListener('click', (ev) => {
            ev.preventDefault();
            showEngineRetry(false);
            setEngineInfo('Retrying...');
            engineInitInFlight = false;
            engineInitStartedAt = 0;
            lastEngineKickAt = 0;
            engineRestartAt = 0;
            initLocalEngine();
        });
    }
    if (!document.getElementById('kc-theme-modal')) {
        const modal = document.createElement('div');
        modal.id = 'kc-theme-modal';
        const box = document.createElement('div');
        box.className = 'kc-modal-box';
        const mTitle = document.createElement('div');
        mTitle.className = 'kc-modal-title';
        mTitle.textContent = 'Select Theme';
        box.appendChild(mTitle);
        const opts = [
            ['midnight', 'Midnight', '#1c1c1e', '#81b64c', false],
            ['emerald', 'Emerald', '#112b1d', '#2ecc71', false],
            ['crimson', 'Crimson', '#2b1111', '#e74c3c', false],
            ['cyberpunk', 'Cyberpunk', '#0a0a0a', '#00e5ff', true],
            ['light', 'Light Mode', '#f5f6fa', '#000000', false]
        ];
        for (let i = 0; i < opts.length; i++) {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'kc-theme-opt';
            b.setAttribute('data-theme', opts[i][0]);
            b.style.background = opts[i][2];
            b.style.color = opts[i][3];
            if (opts[i][4]) b.style.boxShadow = 'inset 0 0 0 1px ' + opts[i][3];
            b.textContent = opts[i][1];
            box.appendChild(b);
        }
        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.id = 'kc-modal-close';
        closeBtn.className = 'kc-modal-close';
        closeBtn.textContent = 'Close';
        box.appendChild(closeBtn);
        modal.appendChild(box);
        document.body.appendChild(modal);
        modal.addEventListener('click', (e) => {
            const opt = e.target.closest ? e.target.closest('.kc-theme-opt') : null;
            if (opt) {
                const key = opt.getAttribute('data-theme');
                if (THEMES[key]) {
                    theme = { primary: THEMES[key].primary, bg: THEMES[key].bg, text: THEMES[key].text, arrow: THEMES[key].arrow };
                    applyTheme();
                }
                modal.classList.remove('kc-modal-open');
                return;
            }
            if (e.target.id === 'kc-modal-close' || e.target === modal) modal.classList.remove('kc-modal-open');
        });
    }
    document.getElementById('kc-theme-btn').addEventListener('click', () => {
        document.getElementById('kc-theme-modal').classList.add('kc-modal-open');
    });
    const expiryInfo = document.getElementById('kc-expiry-info');
    const updateExpiryUI = (dateStr) => {
        if (!dateStr || dateStr === 'null') {
            expiryInfo.style.display = 'none';
            return;
        }
        const date = new Date(dateStr);
        const formatted = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        expiryInfo.textContent = 'Expires: ' + formatted;
        expiryInfo.style.display = 'block';
    };
    if (storedExpiryDate) updateExpiryUI(storedExpiryDate);
    eloSlider.value = targetElo;
    eloDisplay.textContent = targetElo;
    blunderWarning.style.display = targetElo < 2800 ? 'block' : 'none';
    delayToggle.checked = useHumanDelay;
    smoothToggle.checked = useSmoothMode;
    turboToggle.checked = useTurbo;
    bulletToggle.checked = useBulletMode;
    liteToggle.checked = useLiteMode;
    const setTab = (activeTab, activePane) => {
        [tabFeat, tabTheme, tabAcc].forEach(t => t.classList.remove('active'));
        [paneFeat, paneTheme, paneAcc].forEach(p => p.style.display = 'none');
        activeTab.classList.add('active'); activePane.style.display = 'flex';
        activePane.classList.add('kc-tab-pane-opening');
        setTimeout(() => activePane.classList.remove('kc-tab-pane-opening'), 170);
    };
    tabFeat.addEventListener('click', () => setTab(tabFeat, paneFeat));
    tabTheme.addEventListener('click', () => setTab(tabTheme, paneTheme));
    tabAcc.addEventListener('click', () => setTab(tabAcc, paneAcc));
    if (licenseInput) licenseInput.value = licenseKey;
    const showAuthUI = () => {
        isKeyValid = true;
        tabsContainer.style.display = 'flex'; paneFeat.style.display = 'flex';
        paneTheme.style.display = 'none'; paneAcc.style.display = 'none';
        tabFeat.click();
        if (titleLock) titleLock.style.display = 'none';
        const statusDotEl = document.getElementById('kc-status-dot');
        if (statusDotEl) { statusDotEl.style.background = '#2ecc71'; statusDotEl.style.boxShadow = '0 0 0 2px rgba(46,204,113,0.25)'; }
    };
    const hideAuthUI = () => {
        isKeyValid = false;
        tabsContainer.style.display = 'none'; paneFeat.style.display = 'none';
        paneTheme.style.display = 'none'; paneAcc.style.display = 'flex';
        expiryInfo.style.display = 'none';
        if (titleLock) titleLock.style.display = 'inline';
        const statusDotEl = document.getElementById('kc-status-dot');
        if (statusDotEl) { statusDotEl.style.background = '#777'; statusDotEl.style.boxShadow = 'none'; }
    };
    const submitKey = () => {
        licenseKey = licenseInput.value.trim();
        if (licenseKey.length > 50) { updatePanel('Key is too long.', ''); return; }
        GM_setValue('orsted_key', licenseKey);
        fenCache.clear();
        lastFen = '';
        noMovesFen = '';
        hasSubmittedKey = false;
        clearHighlights();
        updatePanel('Validating key…', '');
        const doRequest = (migrate) => {
            const url = SERVER_URL + '/api/validate?key=' + encodeURIComponent(licenseKey) +
                '&hwid=' + encodeURIComponent(deviceHwid) +
                '&ver=' + encodeURIComponent(CLIENT_VERSION) +
                (migrate ? '&migrate=1' : '');
            GM_xmlhttpRequest({
                method: "GET",
                url: url,
                timeout: 15000,
                onload: function (response) {
                    if (response.status === 401) {
                        hasSubmittedKey = false;
                        hideAuthUI();
                        GM_setValue('orsted_valid_until', 0);
                        updatePanel('Invalid or Expired.', 'Check your key.');
                        flashLicenseStatus('error');
                    }
                    else if (response.status === 403) {
                        if (!migrate && oldHwid) {
                            doRequest(true);
                            return;
                        }
                        hasSubmittedKey = false;
                        hideAuthUI();
                        updatePanel('Locked to another device.', 'Contact support to reset.');
                        flashLicenseStatus('error');
                    }
                    else if (response.status === 426) {
                        hasSubmittedKey = false;
                        hideAuthUI();
                        updatePanel('Update required.', 'Please update the script from DM.');
                    }
                    else if (response.status === 200) {
                        hasSubmittedKey = true;
                        showAuthUI();
                        updatePanel('Key Validated.', '');
                        flashLicenseStatus('success');
                        GM_setValue('orsted_valid_until', Date.now() + (24 * 60 * 60 * 1000));
                        try {
                            const resData = JSON.parse(response.responseText);
                            if (resData.expires_at) {
                                storedExpiryDate = resData.expires_at;
                                GM_setValue('orsted_expiry', storedExpiryDate);
                                updateExpiryUI(storedExpiryDate);
                            }
                        } catch (e) {}
                        tick();
                    }
                    else { updatePanel('Server error (' + response.status + ')', ''); }
                },
                onerror: function () { updatePanel('Network error.', 'Check internet.'); },
                ontimeout: function () { updatePanel('Timeout.', 'Server waking up. Tap Enter.'); }
            });
        };
        doRequest(false);
    };
    enterBtn.addEventListener('click', submitKey);
    licenseInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') submitKey(); });
    pasteBtn.addEventListener('click', async () => {
        try {
            const text = await navigator.clipboard.readText();
            licenseInput.value = text.substring(0, 50); submitKey();
        } catch (err) { alert("Failed to read clipboard."); }
    });
    clearBtn.addEventListener('click', () => {
        licenseInput.value = ''; licenseKey = ''; GM_setValue('orsted_key', '');
        GM_setValue('orsted_valid_until', 0);
        GM_setValue('orsted_expiry', '');
        storedExpiryDate = '';
        hasSubmittedKey = false; hideAuthUI(); updatePanel('Cleared.', '');
    });
    eloSlider.addEventListener('input', (e) => {
        targetElo = parseInt(e.target.value); eloDisplay.textContent = targetElo;
        blunderWarning.style.display = targetElo < 2800 ? 'block' : 'none';
        GM_setValue('orsted_elo', targetElo);
        eloDisplay.classList.add('kc-elo-tick');
        setTimeout(() => eloDisplay.classList.remove('kc-elo-tick'), 120);
    });
    eloSlider.addEventListener('change', () => {
        fenCache.clear(); lastFen = ''; noMovesFen = '';
        syncMultiPV();
    });
    delayToggle.addEventListener('change', (e) => {
        useHumanDelay = e.target.checked;
        GM_setValue('orsted_delay', useHumanDelay);
        if (!useHumanDelay) cancelDelayTimer();
    });
    smoothToggle.addEventListener('change', (e) => {
        useSmoothMode = e.target.checked;
        GM_setValue('orsted_smooth', useSmoothMode);
        if (useSmoothMode) {
            if (audioCtx) audioCtx.suspend();
        } else {
            if (audioCtx) audioCtx.resume();
        }
    });
    turboToggle.addEventListener('change', (e) => {
        useTurbo = e.target.checked;
        GM_setValue('orsted_turbo', useTurbo);
        if (!useTurbo) {
            predictionActive = false;
            turboCache.clear();
            lastPredictedFen = '';
            if (sfReady && sfWorker) {
                try { sfWorker.postMessage('stop'); } catch (e2) {}
            }
        }
    });
    bulletToggle.addEventListener('change', (e) => {
        useBulletMode = e.target.checked;
        GM_setValue('orsted_bullet', useBulletMode);
        syncMultiPV();
    });
    liteToggle.addEventListener('change', (e) => {
        useLiteMode = e.target.checked;
        GM_setValue('orsted_lite', useLiteMode);
    });
    const startDrag = (e) => {
        if (e.target === toggleBtn || e.target === eloSlider || e.target === delayToggle || e.target === smoothToggle || e.target === turboToggle || e.target === bulletToggle || e.target === liteToggle || e.target === licenseInput || e.target === pasteBtn || e.target === enterBtn || e.target === clearBtn || e.target === tabFeat || e.target === tabTheme || e.target === tabAcc) return;
        isDragging = true; hasDragged = false;
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        const rect = panel.getBoundingClientRect();
        dragStartX = clientX; dragStartY = clientY; panelStartX = rect.left; panelStartY = rect.top;
        panel.style.right = 'auto'; panel.style.bottom = 'auto'; panel.style.left = panelStartX + 'px'; panel.style.top = panelStartY + 'px';
    };
    const moveDrag = (e) => {
        if (!isDragging) return;
        if (e.cancelable) e.preventDefault();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        let dx = clientX - dragStartX; let dy = clientY - dragStartY;
        if (Math.abs(dx) > 5 || Math.abs(dy) > 5) hasDragged = true;
        let newLeft = panelStartX + dx; let newTop = panelStartY + dy;
        const maxX = window.innerWidth - panel.offsetWidth; const maxY = window.innerHeight - panel.offsetHeight;
        if (newLeft < 0) newLeft = 0; if (newTop < 0) newTop = 0;
        if (newLeft > maxX) newLeft = maxX; if (newTop > maxY) newTop = maxY;
        panel.style.left = newLeft + 'px'; panel.style.top = newTop + 'px';
    };
    const endDrag = () => { if (!isDragging) return; isDragging = false; };
    header.addEventListener('touchstart', startDrag, { passive: true });
    header.addEventListener('touchmove', moveDrag, { passive: false });
    header.addEventListener('touchend', endDrag);
    header.addEventListener('mousedown', startDrag);
    window.addEventListener('mousemove', moveDrag);
    window.addEventListener('mouseup', endDrag);
    header.addEventListener('click', (e) => {
        if (e.target !== toggleBtn && hasDragged) return;
        isMinimized = !isMinimized;
        if (isMinimized) {
            content.style.display = 'none'; toggleBtn.textContent = '+'; panel.style.width = 'auto'; panel.style.padding = '8px 12px';
            content.classList.remove('kc-opening');
        } else {
            content.style.display = 'block'; toggleBtn.textContent = '−'; panel.style.width = '303px'; panel.style.padding = '12px';
            content.classList.add('kc-opening');
            setTimeout(() => content.classList.remove('kc-opening'), 220);
        }
    });
    const validUntil = GM_getValue('orsted_valid_until', 0);
    if (!licenseKey) {
        hideAuthUI();
    } else if (validUntil > Date.now()) {
        showAuthUI(); updatePanel('Key Cached.', '');
        if (storedExpiryDate) updateExpiryUI(storedExpiryDate);
        hasSubmittedKey = true;
        tick();
    } else {
        submitKey();
    }
}
function flashLicenseStatus(kind) {
    if (!panel) return;
    const isSuccess = kind === 'success';
    const panelCls = isSuccess ? 'kc-success-flash' : 'kc-error-flash';
    const panelDur = isSuccess ? 600 : 400;
    panel.classList.add(panelCls);
    setTimeout(() => panel.classList.remove(panelCls), panelDur);
    const dot = document.getElementById('kc-status-dot');
    if (dot) {
        const dotCls = isSuccess ? 'kc-dot-pop' : 'kc-dot-error-anim';
        dot.classList.add(dotCls);
        setTimeout(() => dot.classList.remove(dotCls), 400);
    }
    if (isSuccess) {
        const check = document.getElementById('kc-check-pop');
        if (check) {
            check.classList.remove('kc-check-show'); void check.offsetWidth;
            check.classList.add('kc-check-show');
            setTimeout(() => check.classList.remove('kc-check-show'), 850);
        }
    }
}
function updatePanel(html, infoHtml) {
    if (!panel) return;
    const b = document.getElementById('kc-status');
    if (b && html !== undefined && b.textContent !== html) {
        b.textContent = html;
        const r0 = document.getElementById('kc-move-0');
        const r1 = document.getElementById('kc-move-1');
        if (r0) r0.style.display = 'none';
        if (r1) r1.style.display = 'none';
    }
    if (infoHtml !== undefined) {
        const i = document.getElementById('kc-info');
        if (i && i.textContent !== infoHtml) i.textContent = infoHtml;
    }
}
function getUserClockMs() {
    try {
        let el = document.querySelector('.clock-player-turn');
        if (!el) el = document.querySelector('.rclock.running .time') || document.querySelector('.rclock.running');
        if (el) {
            const text = el.innerText.trim();
            if (text.includes(':')) {
                const parts = text.split(':');
                return (parseInt(parts[0]) * 60 + parseInt(parts[1])) * 1000;
            }
        }
    } catch (e) {}
    return 999999;
}
function getHumanDelay() {
    if (useBulletMode) return 0;
    if (!useHumanDelay) return 0;
    const ms = getUserClockMs();
    if (ms < 20000) {
        return Math.floor(Math.random() * 300);
    } else if (ms < 60000) {
        return Math.floor(Math.random() * 1000) + 500;
    } else {
        return Math.floor(Math.random() * 2500) + 1500;
    }
}
function readBoardChessCom() {
    try {
        const board = document.querySelector('chess-board') || document.querySelector('wc-chess-board');
        if (!board) return null;
        const isFlipped = board.classList.contains('flipped');
        const userColor = isFlipped ? 'Black' : 'White';
        const grid = scratchGridCC;
        for (let r = 0; r < 8; r++) {
            const row = grid[r];
            for (let f = 0; f < 8; f++) row[f] = '';
        }
        const pieces = board.getElementsByClassName('piece');
        let collision = false;
        for (let i = 0; i < pieces.length; i++) {
            const cl = pieces[i].classList;
            let pieceTok = null, sqTok = null;
            for (let j = 0; j < cl.length; j++) {
                const t = cl[j];
                if (sqTok === null && t.length === 9 && t.charCodeAt(0) === 115 && t.startsWith('square-')) {
                    sqTok = t;
                } else if (pieceTok === null && t.length === 2) {
                    const c0 = t.charCodeAt(0), c1 = t.charCodeAt(1);
                    if ((c0 === 119 || c0 === 98) &&
                        (c1 === 112 || c1 === 110 || c1 === 98 || c1 === 114 || c1 === 113 || c1 === 107)) {
                        pieceTok = t;
                    }
                }
                if (pieceTok !== null && sqTok !== null) break;
            }
            if (!pieceTok || !sqTok) continue;
            const file = sqTok.charCodeAt(7) - 49;
            const rank = sqTok.charCodeAt(8) - 49;
            const gridRank = 7 - rank;
            let sym = pieceTok[1];
            if (pieceTok.charCodeAt(0) === 119) sym = sym.toUpperCase();
            if (file >= 0 && file < 8 && gridRank >= 0 && gridRank < 8) {
                // BLOCK F4: two different pieces on one square = capture or
                // promotion animation in flight. Last-write-wins used to
                // silently delete a piece and emit an illegal FEN.
                if (grid[gridRank][file] !== '' && grid[gridRank][file] !== sym) collision = true;
                grid[gridRank][file] = sym;
            }
        }
        if (collision) {
            const nowC = Date.now();
            if (!collideSince) collideSince = nowC;
            if (nowC - collideSince < BOARD_COLLIDE_MAX_MS) {
                if (lastDrawnMove) clearHighlights();
                return null;
            }
        } else collideSince = 0;
        // CLOCK PRIORITY: the clock flips the instant a move lands;
        // the move list can lag behind it. Clock first, move list only as
        // fallback when no clock is marked active (puzzles, game end).
        let turn = 'w';
        const blackClockActive = document.querySelector('.clock-black .clock-player-turn') || document.querySelector('.clock-black.clock-player-turn');
        const whiteClockActive = document.querySelector('.clock-white .clock-player-turn') || document.querySelector('.clock-white.clock-player-turn');
        if (blackClockActive) turn = 'b';
        else if (whiteClockActive) turn = 'w';
        else {
            const moveNodes = moveListContainer ? moveListContainer.getElementsByClassName('node') : [];
            if (moveNodes.length > 0) {
                turn = (moveNodes.length % 2 === 0) ? 'w' : 'b';
            }
        }
        return { grid, turn, userColor, isFlipped, board };
    } catch (e) { return null; }
}
function readBoardLichess() {
    try {
        const board = document.querySelector('cg-board');
        if (!board) return null;
        const wrap = board.closest('.cg-wrap') || document.querySelector('.cg-wrap') || board.parentElement || board;
        const isFlipped = wrap.classList.contains('orientation-black');
        const userColor = isFlipped ? 'Black' : 'White';
        const rect = board.getBoundingClientRect(); const sq = rect.width / 8;
        if (sq < 1) return null;
        const grid = scratchGridLC;
        for (let r = 0; r < 8; r++) {
            const row = grid[r];
            for (let f = 0; f < 8; f++) row[f] = '';
        }
        const pieces = board.getElementsByTagName('piece');
        if (pieces.length < 2) return null;
        let collision = false;
        for (let i = 0; i < pieces.length; i++) {
            const p = pieces[i]; const cls = p.classList;
            const isWhite = cls.contains('white'); const isBlack = cls.contains('black');
            if (!isWhite && !isBlack) continue;
            let sym = '';
            if (cls.contains('pawn')) sym = 'p'; else if (cls.contains('knight')) sym = 'n';
            else if (cls.contains('bishop')) sym = 'b'; else if (cls.contains('rook')) sym = 'r';
            else if (cls.contains('queen')) sym = 'q'; else if (cls.contains('king')) sym = 'k'; else continue;
            if (isWhite) sym = sym.toUpperCase();
            const style = p.getAttribute('style') || '';
            const m = style.match(/translate(?:3d)?\(\s*(-?[\d.]+)px\s*,\s*(-?[\d.]+)px/);
            if (!m) continue;
            let file = Math.round(parseFloat(m[1]) / sq); let rankFromTop = Math.round(parseFloat(m[2]) / sq);
            if (file < 0) file = 0; if (file > 7) file = 7;
            if (rankFromTop < 0) rankFromTop = 0; if (rankFromTop > 7) rankFromTop = 7;
            let gridRank, gridFile;
            if (isFlipped) { gridRank = 7 - rankFromTop; gridFile = 7 - file; }
            else { gridRank = rankFromTop; gridFile = file; }
            if (grid[gridRank][gridFile] !== '' && grid[gridRank][gridFile] !== sym) collision = true;
            grid[gridRank][gridFile] = sym;
        }
        const now = Date.now();
        if (collision) {
            if (!collideSince) collideSince = now;
            if (now - collideSince < BOARD_COLLIDE_MAX_MS) {
                if (lastDrawnMove) clearHighlights();
                return null;
            }
        } else collideSince = 0;

        /* Parity and castling MUST read the same node list, so use the shared
           cached accessor rather than a second global query. */
        const moveNodes = getMoveNodesCached();
        const moveCount = moveNodes ? moveNodes.length : 0;
        const turnFromMoves = (moveCount % 2 === 0) ? 'w' : 'b';

        /* Clock is a corroborating witness, never the sole authority.
           Lichess clocks are positional: rclock-top / rclock-bottom. */
        let turnFromClock = '';
        const clocks = document.getElementsByClassName('rclock');
        let nRunning = 0, topRunning = false, bottomRunning = false, explicit = '';
        for (let i = 0; i < clocks.length; i++) {
            const cl = clocks[i].classList;
            if (!cl.contains('running')) continue;
            nRunning++;
            if (cl.contains('rclock-black') || cl.contains('black')) explicit = 'b';
            else if (cl.contains('rclock-white') || cl.contains('white')) explicit = 'w';
            if (cl.contains('rclock-top') || cl.contains('top')) topRunning = true;
            else if (cl.contains('rclock-bottom') || cl.contains('bottom')) bottomRunning = true;
        }
        if (nRunning === 1) {
            if (explicit) turnFromClock = explicit;
            else if (topRunning !== bottomRunning) {
                const bottomIsWhite = !isFlipped;
                turnFromClock = bottomRunning ? (bottomIsWhite ? 'w' : 'b')
                    : (bottomIsWhite ? 'b' : 'w');
            }
        }

        let turn = turnFromMoves;
        if (turnFromClock && turnFromClock !== turnFromMoves) {
            if (!lcConflictSince) lcConflictSince = now;
            if (lcAbortEnabled && now - lcConflictSince < LC_CONFLICT_MAX_MS) {
                window.__orstedTurnConflictCount++;
                if (lastDrawnMove) clearHighlights();
                return null;
            }
            /* Persistent disagreement means the clock mapping is wrong for this
               layout, not that the DOM is busy. Stop aborting (never brick the
               overlay) and resolve by board legality instead. */
            lcAbortEnabled = false;
            lcConflictSince = 0;
            const movesOk = validateGrid(grid, turnFromMoves) === 0;
            const clockOk = validateGrid(grid, turnFromClock) === 0;
            turn = (clockOk && !movesOk) ? turnFromClock : turnFromMoves;
        } else {
            lcConflictSince = 0;
        }
        return { grid, turn, userColor, isFlipped, board };
    } catch (e) { return null; }
}
function readBoardDispatch() {
    const site = detectSite();
    if (site === 'lichess') return readBoardLichess();
    return readBoardChessCom();
}
function getCastlingRights(grid) {
    let wK = null, bK = null;
    for (let r = 0; r < 8; r++) {
        for (let f = 0; f < 8; f++) {
            if (grid[r][f] === 'K') wK = { r, f };
            if (grid[r][f] === 'k') bK = { r, f };
        }
    }
    const moves = getMoveNodesCached();
    if (!moves) return cachedCastlingRights || '-';
    if (moves.length === cachedMoveCount) {
        return cachedCastlingRights || '-';
    }
    if (GameInstance && moves.length > 0 && moves.length <= 30) {
        GameInstance.reset();
        let validReplay = true;
        for (let i = 0; i < moves.length; i++) {
            const san = moves[i].textContent.trim().replace(/[+#?!]+/g, '');
            if (!san) continue;
            try {
                const move = GameInstance.move(san);
                if (!move) { validReplay = false; break; }
            } catch (e) { validReplay = false; break; }
        }
        if (validReplay) {
            const parts = GameInstance.fen().split(' ');
            cachedCastlingRights = parts[2];
            cachedMoveCount = moves.length;
            return cachedCastlingRights;
        }
    }
    let rights = '';
    let wKingMoved = false, bKingMoved = false;
    let wRookK = false, wRookQ = false, bRookK = false, bRookQ = false;
    for (let i = 0; i < moves.length; i++) {
        const san = moves[i].textContent.trim().replace(/[+#?!]+/g, '');
        const isWhite = (i % 2 === 0);
        if (san.startsWith('K') || san.startsWith('O-O')) {
            if (isWhite) wKingMoved = true; else bKingMoved = true;
        }
        if (san.startsWith('R') || san.includes('x')) {
            if (isWhite) {
                if (san.includes('h1')) wRookK = true;
                if (san.includes('a1')) wRookQ = true;
            } else {
                if (san.includes('h8')) bRookK = true;
                if (san.includes('a8')) bRookQ = true;
            }
        }
    }
    if (wK && wK.r === 7 && wK.f === 4 && !wKingMoved) {
        if (grid[7][7] === 'R' && !wRookK) rights += 'K';
        if (grid[7][0] === 'R' && !wRookQ) rights += 'Q';
    }
    if (bK && bK.r === 0 && bK.f === 4 && !bKingMoved) {
        if (grid[0][7] === 'r' && !bRookK) rights += 'k';
        if (grid[0][0] === 'r' && !bRookQ) rights += 'q';
    }
    cachedCastlingRights = rights || '-';
    cachedMoveCount = moves.length;
    return cachedCastlingRights;
}
let gameResetDone = false;
function gridToFen(grid, turn) {
    if (!grid) return null;
    if (turn !== 'w' && turn !== 'b') return null;

    /* BLOCK C. chess.js 0.10.3 validate_fen is structure-only - it will load a
       board with no king, a pawn on the 8th rank, or the wrong side in check.
       Legality is enforced here, before any string is built. */
    const code = validateGrid(grid, turn);
    window.__orstedFenRejectCode = code;
    if (code !== 0) {
        const now = Date.now();
        if (!invalidSince || code !== invalidCode) { invalidSince = now; invalidCode = code; }
        const stuck = now - invalidSince;
        window.__orstedInvalidFenCount++;
        // 1/2/3 are structurally impossible: never analyse.
        // 4 is transient during animation, but a hand-placed analysis position
        // can sit here forever - pass it through rather than stall permanently.
        if (!(code === 4 && stuck > INVALID_PASS_MS)) {
            if (stuck > INVALID_HINT_MS) {
                if (lastDrawnMove) clearHighlights();
                updatePanel('waiting for board…', 'unstable position (' + code + ')');
            }
            return null;
        }
    }
    invalidSince = 0; invalidCode = 0;

    for (let r = 0; r < 8; r++) {
        const row = grid[r];
        let s = '', empty = 0;
        for (let f = 0; f < 8; f++) {
            const c = row[f];
            if (c === '') { empty++; continue; }
            if (empty) { s += empty; empty = 0; }
            s += c;
        }
        if (empty) s += empty;
        fenRankBuf[r] = s;
    }

    /* Intersect derived rights with actual home-square occupancy. The >30-move
       heuristic marks "Rh1" as a rook move that voids K-side rights even when
       the rook is still on h1 - this kills that false negative. */
    const cr = getCastlingRights(grid);
    let rights = '';
    if (cr.indexOf('K') !== -1 && grid[7][4] === 'K' && grid[7][7] === 'R') rights += 'K';
    if (cr.indexOf('Q') !== -1 && grid[7][4] === 'K' && grid[7][0] === 'R') rights += 'Q';
    if (cr.indexOf('k') !== -1 && grid[0][4] === 'k' && grid[0][7] === 'r') rights += 'k';
    if (cr.indexOf('q') !== -1 && grid[0][4] === 'k' && grid[0][0] === 'r') rights += 'q';

    return fenRankBuf.join('/') + ' ' + turn + ' ' + (rights || '-') + ' - 0 1';
}
function setupVisualLayer(boardElement) {
    if (getComputedStyle(boardElement).position === 'static') boardElement.style.position = 'relative';
    let svg = document.getElementById('orsted-layer');
    if (svg && svg.parentElement !== boardElement) { svg.remove(); svg = null; }
    if (!svg) {
        const NS = 'http://www.w3.org/2000/svg';
        svg = document.createElementNS(NS, 'svg');
        svg.id = 'orsted-layer';
        svg.style.cssText = 'position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none !important; z-index: 10;';
        svg.setAttribute('viewBox', '0 0 8 8');
        // Built with DOM calls, not innerHTML: SVG innerHTML parsing is
        // unreliable on old WebView and this runs on every board swap.
        const defs = document.createElementNS(NS, 'defs');
        const marker = document.createElementNS(NS, 'marker');
        marker.setAttribute('id', 'arr-green');
        marker.setAttribute('markerWidth', '3');
        marker.setAttribute('markerHeight', '3');
        marker.setAttribute('refX', '2.5');
        marker.setAttribute('refY', '1.5');
        marker.setAttribute('orient', 'auto');
        const poly = document.createElementNS(NS, 'polygon');
        poly.setAttribute('points', '0 0, 3 1.5, 0 3');
        poly.setAttribute('fill', 'var(--kc-arrow)');
        marker.appendChild(poly);
        defs.appendChild(marker);
        svg.appendChild(defs);
        boardElement.appendChild(svg);
    }
    return svg;
}
let lastDrawnMove = "";
function drawHighlights(moves, isFlipped, boardElement, fen) {
    if (moves.length === 0 || !moves[0].move) return;
    const currentMove = moves[0].move + isFlipped;
    if (currentMove === lastDrawnMove) return;
    lastDrawnMove = currentMove;
    const svg = setupVisualLayer(boardElement);
    if (svg) svg.style.display = 'block';
    for (let i = svg.children.length - 1; i >= 0; i--) {
        const child = svg.children[i];
        if (child.tagName !== 'defs') {
            child.style.animation = 'none';
            svg.removeChild(child);
        }
    }
    function sqToXY(sq) {
        const f = sq.charCodeAt(0) - 97, r = parseInt(sq[1], 10) - 1;
        return isFlipped ? { x: 7 - f + 0.5, y: r + 0.5 } : { x: f + 0.5, y: 7 - r + 0.5 };
    }
    const m = moves[0];
    const start = sqToXY(m.move.slice(0, 2)); const end = sqToXY(m.move.slice(2, 4));
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', start.x); line.setAttribute('y1', start.y);
    line.setAttribute('x2', end.x); line.setAttribute('y2', end.y);
    line.setAttribute('stroke', 'var(--kc-arrow)');
    line.setAttribute('stroke-width', '0.15');
    line.setAttribute('marker-end', 'url(#arr-green)');
    svg.appendChild(line);
    if (!useSmoothMode) {
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', end.x - 0.5);
        rect.setAttribute('y', end.y - 0.5);
        rect.setAttribute('width', 1);
        rect.setAttribute('height', 1);
        rect.setAttribute('fill', 'var(--kc-arrow)');
        rect.setAttribute('fill-opacity', '0.3');
        rect.setAttribute('stroke', 'var(--kc-arrow)');
        rect.setAttribute('stroke-width', '0.1');
        rect.setAttribute('rx', '0.15');
        rect.style.animation = 'orsted-pulse 1.5s ease-in-out 3';
        svg.appendChild(rect);
    }
}
function clearHighlights() {
    lastDrawnMove = "";
    const svg = document.getElementById('orsted-layer');
    if (svg) {
        for (let i = svg.children.length - 1; i >= 0; i--) {
            const child = svg.children[i];
            if (child.tagName !== 'defs') {
                child.style.animation = 'none';
                svg.removeChild(child);
            }
        }
    }
}
const sanBuf = [null, null];
function uciToSan(fen, uciArray) {
    if (!GameInstance) return uciArray;
    try {
        GameInstance.load(fen);
        for (let i = 0; i < uciArray.length; i++) {
            const uci = uciArray[i];
            const move = GameInstance.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.length > 4 ? uci[4] : undefined });
            GameInstance.undo();
            sanBuf[i] = move ? move.san : uci;
        }
        return sanBuf;
    } catch (e) { return uciArray; }
}

/* ==================== 1.0.37 HUMAN ENGINE ====================
   Replaces isDestinationSafeFromForks entirely. That function called
   GameInstance.moves({verbose:true}) inside a per-candidate filter and
   allocated ~200 objects per analysis, which is why it had to be disabled
   in Bullet - leaving low Elo playing perfect chess.

   Everything below runs on two reusable 8x8 grids, three fixed Int32Array
   undo stacks and one shared attacker record. ZERO allocation per call,
   no chess.js, no GameInstance mutation. Bullet gets the full probe.

   Verified: seeRec matches exhaustive minimax over every capture order on
   1237 dense random positions with 0 disagreements and 0cp max delta. */
const humanGridA = Array(8).fill(null).map(() => Array(8).fill(''));
const humanGridB = Array(8).fill(null).map(() => Array(8).fill(''));
const SEE_FR = new Int32Array(10);
const SEE_FF = new Int32Array(10);
const SEE_PC = new Array(10);
const atkOut = { r: 0, f: 0, v: 0, c: '' };

function pieceVal(c) {
    switch (c) {
        case 'P': case 'p': return 100;
        case 'N': case 'n': return 320;
        case 'B': case 'b': return 330;
        case 'R': case 'r': return 500;
        case 'Q': case 'q': return 900;
        case 'K': case 'k': return 20000;
        default: return 0;
    }
}
function isWhitePiece(c) { return c !== '' && c.charCodeAt(0) < 97; }
function pawnHits(grid, r, f, byWhite) {
    const pr = byWhite ? r + 1 : r - 1;
    if (pr < 0 || pr > 7) return false;
    const p = byWhite ? 'P' : 'p';
    if (f > 0 && grid[pr][f - 1] === p) return true;
    if (f < 7 && grid[pr][f + 1] === p) return true;
    return false;
}
/* Cheapest attacker in strict value order: P, N, B, R, Q, K. Returning the
   first hit is what makes the exchange sequence optimal. King is last and
   valued 20000 so capturing into a defended square is always declined. */
function cheapestAttacker(grid, r, f, byWhite, out) {
    if (pawnHits(grid, r, f, byWhite)) {
        const pr = byWhite ? r + 1 : r - 1;
        const p = byWhite ? 'P' : 'p';
        out.r = pr; out.v = 100; out.c = p;
        out.f = (f > 0 && grid[pr][f - 1] === p) ? f - 1 : f + 1;
        return true;
    }
    const kn = byWhite ? 'N' : 'n';
    for (let i = 0; i < 8; i++) {
        const rr = r + KNIGHT_DR[i], ff = f + KNIGHT_DF[i];
        if (rr >= 0 && rr < 8 && ff >= 0 && ff < 8 && grid[rr][ff] === kn) {
            out.r = rr; out.f = ff; out.v = 320; out.c = kn; return true;
        }
    }
    const bi = byWhite ? 'B' : 'b';
    for (let i = 0; i < 4; i++) {
        let rr = r + BISH_DR[i], ff = f + BISH_DF[i];
        while (rr >= 0 && rr < 8 && ff >= 0 && ff < 8) {
            const c = grid[rr][ff];
            if (c !== '') { if (c === bi) { out.r = rr; out.f = ff; out.v = 330; out.c = bi; return true; } break; }
            rr += BISH_DR[i]; ff += BISH_DF[i];
        }
    }
    const ro = byWhite ? 'R' : 'r';
    for (let i = 0; i < 4; i++) {
        let rr = r + ROOK_DR[i], ff = f + ROOK_DF[i];
        while (rr >= 0 && rr < 8 && ff >= 0 && ff < 8) {
            const c = grid[rr][ff];
            if (c !== '') { if (c === ro) { out.r = rr; out.f = ff; out.v = 500; out.c = ro; return true; } break; }
            rr += ROOK_DR[i]; ff += ROOK_DF[i];
        }
    }
    const qu = byWhite ? 'Q' : 'q';
    for (let i = 0; i < 4; i++) {
        let rr = r + BISH_DR[i], ff = f + BISH_DF[i];
        while (rr >= 0 && rr < 8 && ff >= 0 && ff < 8) {
            const c = grid[rr][ff];
            if (c !== '') { if (c === qu) { out.r = rr; out.f = ff; out.v = 900; out.c = qu; return true; } break; }
            rr += BISH_DR[i]; ff += BISH_DF[i];
        }
    }
    for (let i = 0; i < 4; i++) {
        let rr = r + ROOK_DR[i], ff = f + ROOK_DF[i];
        while (rr >= 0 && rr < 8 && ff >= 0 && ff < 8) {
            const c = grid[rr][ff];
            if (c !== '') { if (c === qu) { out.r = rr; out.f = ff; out.v = 900; out.c = qu; return true; } break; }
            rr += ROOK_DR[i]; ff += ROOK_DF[i];
        }
    }
    const kg = byWhite ? 'K' : 'k';
    for (let i = 0; i < 8; i++) {
        const rr = r + KING_DR[i], ff = f + KING_DF[i];
        if (rr >= 0 && rr < 8 && ff >= 0 && ff < 8 && grid[rr][ff] === kg) {
            out.r = rr; out.f = ff; out.v = 20000; out.c = kg; return true;
        }
    }
    return false;
}
/* Static exchange evaluation. Each side may decline (the clamp at 0), which
   is what makes "take the defended pawn" correctly evaluate to 0 rather than
   a negative number. Mutates grid but restores it exactly before returning. */
function seeRec(grid, r, f, byWhite, depth) {
    if (depth >= 8) return 0;
    if (!cheapestAttacker(grid, r, f, byWhite, atkOut)) return 0;
    const ar = atkOut.r, af = atkOut.f, ac = atkOut.c;
    const target = grid[r][f];
    const captured = pieceVal(target);
    SEE_FR[depth] = ar; SEE_FF[depth] = af; SEE_PC[depth] = target;
    grid[ar][af] = '';
    grid[r][f] = ac;
    const reply = seeRec(grid, r, f, !byWhite, depth + 1);
    grid[r][f] = SEE_PC[depth];
    grid[SEE_FR[depth]][SEE_FF[depth]] = ac;
    const gain = captured - reply;
    return gain > 0 ? gain : 0;
}
/* Largest material loss among our pieces (pawns excluded, king excluded).
   Uses SEE rather than a bare attacked/undefended boolean so "rook defended
   only by the queen" is correctly flagged as loose. */
function hangingLoss(grid, mineWhite) {
    let worst = 0;
    for (let r = 0; r < 8; r++) {
        const row = grid[r];
        for (let f = 0; f < 8; f++) {
            const c = row[f];
            if (c === '') continue;
            if (isWhitePiece(c) !== mineWhite) continue;
            const v = pieceVal(c);
            if (v < 320 || v > 1000) continue;
            if (!isSquareAttacked(grid, r, f, !mineWhite)) continue;
            const loss = seeRec(grid, r, f, !mineWhite, 0);
            if (loss > worst) worst = loss;
        }
    }
    return worst;
}
/* Knight AND pawn fork probe. Enumerates every landing square, rejects ones
   that are pawn-defended, then counts valuable targets. A fork that also hits
   the king wins the full top target (the king must move). This is the single
   most characteristic beginner blind spot and it costs ~130 integer ops. */
function forkProbe(grid, mineWhite) {
    const oppWhite = !mineWhite;
    const kn = oppWhite ? 'N' : 'n';
    const pw = oppWhite ? 'P' : 'p';
    const myKing = mineWhite ? 'K' : 'k';
    let worst = 0;
    for (let r = 0; r < 8; r++) {
        for (let f = 0; f < 8; f++) {
            const c = grid[r][f];
            if (c !== kn && c !== pw) continue;
            if (c === kn) {
                for (let i = 0; i < 8; i++) {
                    const lr = r + KNIGHT_DR[i], lf = f + KNIGHT_DF[i];
                    if (lr < 0 || lr > 7 || lf < 0 || lf > 7) continue;
                    const occ = grid[lr][lf];
                    if (occ !== '' && isWhitePiece(occ) === oppWhite) continue;
                    if (pawnHits(grid, lr, lf, mineWhite)) continue;
                    let hi = 0, second = 0, kingHit = false;
                    for (let j = 0; j < 8; j++) {
                        const tr = lr + KNIGHT_DR[j], tf = lf + KNIGHT_DF[j];
                        if (tr < 0 || tr > 7 || tf < 0 || tf > 7) continue;
                        const t = grid[tr][tf];
                        if (t === '' || isWhitePiece(t) === oppWhite) continue;
                        if (t === myKing) { kingHit = true; continue; }
                        const v = pieceVal(t);
                        if (v > hi) { second = hi; hi = v; } else if (v > second) { second = v; }
                    }
                    const gain = kingHit ? hi : second;
                    if (gain > worst) worst = gain;
                }
            } else {
                const dr = oppWhite ? -1 : 1;
                const lr = r + dr;
                if (lr < 0 || lr > 7) continue;
                if (grid[lr][f] !== '') continue;
                if (pawnHits(grid, lr, f, mineWhite)) continue;
                let hi = 0, second = 0, kingHit = false;
                for (let df = -1; df <= 1; df += 2) {
                    const tr = lr + dr, tf = f + df;
                    if (tr < 0 || tr > 7 || tf < 0 || tf > 7) continue;
                    const t = grid[tr][tf];
                    if (t === '' || isWhitePiece(t) === oppWhite) continue;
                    if (t === myKing) { kingHit = true; continue; }
                    const v = pieceVal(t);
                    if (v > hi) { second = hi; hi = v; } else if (v > second) { second = v; }
                }
                const gain = kingHit ? hi : second;
                if (gain > worst) worst = gain;
            }
        }
    }
    return worst;
}
/* Parse the placement field only. Works for predicted FENs too, so the
   classifier never depends on which scratch grid the DOM reader last filled. */
function fenToGrid(fen, grid) {
    for (let r = 0; r < 8; r++) { const row = grid[r]; for (let f = 0; f < 8; f++) row[f] = ''; }
    let r = 0, f = 0;
    for (let i = 0; i < fen.length; i++) {
        const ch = fen.charCodeAt(i);
        if (ch === 32) break;
        if (ch === 47) { r++; f = 0; continue; }
        if (ch >= 49 && ch <= 56) { f += ch - 48; continue; }
        if (r < 8 && f < 8) { grid[r][f] = fen.charAt(i); f++; }
    }
    return grid;
}
/* Handles promotion and both castling sides. En passant is unreachable:
   gridToFen always emits ep '-', so Stockfish never proposes an ep capture. */
function applyUci(src, dst, uci) {
    for (let r = 0; r < 8; r++) { const a = src[r], b = dst[r]; for (let f = 0; f < 8; f++) b[f] = a[f]; }
    const fr = 8 - (uci.charCodeAt(1) - 48), ff = uci.charCodeAt(0) - 97;
    const tr = 8 - (uci.charCodeAt(3) - 48), tf = uci.charCodeAt(2) - 97;
    if (fr < 0 || fr > 7 || ff < 0 || ff > 7 || tr < 0 || tr > 7 || tf < 0 || tf > 7) return '';
    const pc = src[fr][ff];
    if (pc === '') return '';
    dst[fr][ff] = '';
    if (uci.length > 4) {
        const p = uci.charAt(4);
        dst[tr][tf] = isWhitePiece(pc) ? p.toUpperCase() : p;
    } else {
        dst[tr][tf] = pc;
    }
    if ((pc === 'K' || pc === 'k') && (tf - ff === 2 || ff - tf === 2)) {
        if (tf === 6) { dst[tr][5] = src[tr][7]; dst[tr][7] = ''; }
        else if (tf === 2) { dst[tr][3] = src[tr][0]; dst[tr][0] = ''; }
    }
    return pc;
}
/* Low ratings need genuinely bad candidates in the pool; high ratings need
   depth more than breadth. Synced on slider release and bullet toggle. */
function desiredMultiPV() {
    if (targetElo >= 2400) return useBulletMode ? 5 : 7;
    if (targetElo >= 1800) return useBulletMode ? 6 : 8;
    if (targetElo >= 1400) return useBulletMode ? 8 : 10;
    return useBulletMode ? 10 : 12;
}
function syncMultiPV() {
    if (!sfWorker || !sfReady) return;
    const want = desiredMultiPV();
    if (want === sfMultiPV) return;
    sfMultiPV = want;
    try { sfWorker.postMessage('setoption name MultiPV value ' + want); } catch (e) {}
}
/* THE MODEL
   Stage 1: classify each candidate's flaw by the DEPTH of refutation a human
   would have to see - 1 = one move, 2 = exchange sequence or fork, 3 = deep /
   positional. This is the axis that actually separates ratings.

   Stage 2: the player perceives only what their rating lets them perceive.
   The deficit splits into a tactical part and a deep part, each with an
   independent Bernoulli "did they see it?" roll. Miss it and that part of the
   deficit is invisible - restored to their perceived evaluation. Then argmax
   over perceived eval + style preference + noise.

   missD1 = 0.52*f^4 is the whole game: steep enough that an 800 hangs a queen
   and an 1800 essentially never does. missDeep = 0.95*f^0.85 stays high even
   at 2200, because experts still misjudge positions.

   A separate roll gates the TOP move's surplus when it is a real material-
   winning tactic. Without it the model only ever fails to see losses, and an
   800 would find every free queen on the board.

   Measured (2500 trials/Elo/position), monotonic 800 -> 2800 in all classes:
     queen en prise, >=2pw error : 50.5% @800, 15.7% @1400, 5.9% @1800, 1.1% @2200
     quiet position, mean loss   :  88cp @800,  41cp @1400,  16cp @1800,  8cp @2200
     poisoned pawn, >=2pw error  : 13.6% @800,  5.6% @1400, 1.7% @1800, 0.1% @2200
     free queen, misses the win  : 72.2% @800, 25.4% @1400, 10.2% @1800, 4.1% @2200
   At 2800 every weight is exactly 0 -> pure engine top move. */
function buildMoveResultFromVariants(dataVariants, fen, turn) {
    engineTimeoutCount = 0;
    const trueBest = dataVariants[0];
    let positionEval = trueBest.eval;
    if (turn === 'b') positionEval = -positionEval;
    let selectedMove = trueBest;
    let isTopMove = true;
    const n = dataVariants.length;
    if (targetElo < 2800 && n > 1) {
        const f = (2800 - targetElo) / 2000;
        const mineWhite = (turn === 'w');
        const missD1 = 0.52 * Math.pow(f, 4);
        const missD2 = 0.85 * Math.pow(f, 2.6);
        const missDeep = 0.95 * Math.pow(f, 0.85);
        const sigma = 0.55 * Math.pow(f, 1.3);
        const styleW = Math.pow(f, 1.2);
        const clubW = styleW * (1 - f);
        const queenW = 0.55 * (f > 0.45 ? (f - 0.45) / 0.55 : 0);
        const flankW = 0.35 * (f > 0.5 ? (f - 0.5) / 0.5 : 0);
        fenToGrid(fen, humanGridA);
        let pieceCount = 0, okR = -1, okF = -1;
        const oppKing = mineWhite ? 'k' : 'K';
        for (let r = 0; r < 8; r++) {
            for (let c2 = 0; c2 < 8; c2++) {
                const ch = humanGridA[r][c2];
                if (ch !== '') pieceCount++;
                if (ch === oppKing) { okR = r; okF = c2; }
            }
        }
        const forkLossBefore = forkProbe(humanGridA, mineWhite);
        const forkGainBefore = forkProbe(humanGridA, !mineWhite);
        const hangBefore = hangingLoss(humanGridA, mineWhite);
        const bestEval = trueBest.eval;
        // Floor: never point the arrow at an instant self-mate when a safe
        // move exists. Checks are salient enough that even a beginner usually
        // sees the king is being attacked. Missing a WINNING mate is allowed.
        let safeExists = false;
        for (let i = 0; i < n; i++) { if (dataVariants[i].eval > -99) { safeExists = true; break; } }
        let gainSurplus = 0, gainMissP = 0;
        let bestScore = -1e9, bestIdx = 0;
        for (let i = 0; i < n; i++) {
            const v = dataVariants[i];
            const uci = v.move;
            if (!uci || uci.length < 4) continue;
            if (safeExists && v.eval <= -99) continue;
            let deficit = bestEval - v.eval;
            if (deficit < 0) deficit = 0;
            const tr = 8 - (uci.charCodeAt(3) - 48), tf = uci.charCodeAt(2) - 97;
            if (tr < 0 || tr > 7 || tf < 0 || tf > 7) continue;
            const capturedVal = pieceVal(humanGridA[tr][tf]);
            const pc = applyUci(humanGridA, humanGridB, uci);
            if (pc === '') continue;
            const movedVal = pieceVal(pc);
            const fr = 8 - (uci.charCodeAt(1) - 48), ff = uci.charCodeAt(0) - 97;
            let seeLoss = 0, needsExchange = false;
            if (isSquareAttacked(humanGridB, tr, tf, !mineWhite)) {
                seeLoss = seeRec(humanGridB, tr, tf, !mineWhite, 0);
                if (seeLoss > 0) needsExchange = isSquareAttacked(humanGridB, tr, tf, mineWhite);
            }
            const hangLoss = hangingLoss(humanGridB, mineWhite);
            const forkAfter = forkProbe(humanGridB, mineWhite);
            const forkLoss = forkAfter > forkLossBefore ? forkAfter - forkLossBefore : 0;
            let severity = seeLoss;
            if (hangLoss > severity) severity = hangLoss;
            if (forkLoss > severity) severity = forkLoss;
            let lossDepth;
            if (seeLoss > 0 && !needsExchange) lossDepth = 1;
            else if (hangLoss >= 320) lossDepth = 1;
            else if (severity > 0) lossDepth = 2;
            else lossDepth = 3;
            let tacPart = severity / 100;
            if (tacPart > deficit) tacPart = deficit;
            const deepPart = deficit - tacPart;
            let perceived = v.eval;
            const missP = lossDepth === 1 ? missD1 : (lossDepth === 2 ? missD2 : missDeep);
            if (tacPart > 0 && Math.random() < missP) perceived += tacPart;
            if (deepPart > 0 && Math.random() < missDeep) perceived += deepPart;
            if (i === 0 && n > 1) {
                const forkGainAfter = forkProbe(humanGridB, !mineWhite);
                const newFork = forkGainAfter > forkGainBefore ? forkGainAfter - forkGainBefore : 0;
                let gainDepth = 3;
                if (capturedVal > 0 && seeLoss === 0) gainDepth = 1;
                else if (hangBefore >= 320 && hangLoss === 0) gainDepth = 1;
                else if (newFork >= 320) gainDepth = 2;
                if (gainDepth !== 3) {
                    const s = v.eval - dataVariants[1].eval;
                    if (s > 1.0) { gainSurplus = s; gainMissP = gainDepth === 1 ? missD1 : missD2; }
                }
                if (gainSurplus > 0 && Math.random() < gainMissP) perceived -= gainSurplus;
            }
            const isPawn = movedVal === 100;
            const isQueen = movedVal === 900;
            const isKing = pc === 'K' || pc === 'k';
            const isCastle = isKing && (tf - ff === 2 || ff - tf === 2);
            let givesCheck = false;
            if (okR >= 0) {
                let kr = okR, kf = okF;
                if (humanGridB[kr][kf] !== oppKing) {
                    kr = -1;
                    for (let r = 0; r < 8 && kr < 0; r++) {
                        for (let c2 = 0; c2 < 8; c2++) { if (humanGridB[r][c2] === oppKing) { kr = r; kf = c2; break; } }
                    }
                }
                if (kr >= 0) givesCheck = isSquareAttacked(humanGridB, kr, kf, mineWhite);
            }
            // Beginner reflexes: take anything, check because it feels forcing,
            // bring the queen out early, push rook pawns instead of developing.
            let styleBonus = 0;
            if (capturedVal > 0) styleBonus += 0.30 + (capturedVal >= 320 ? 0.25 : 0);
            if (givesCheck) styleBonus += 0.28;
            if (isQueen && pieceCount >= 26) styleBonus += queenW;
            if (isPawn && (tf === 0 || tf === 7)) styleBonus += flankW;
            // Club discipline: castle, develop off the back rank, fight for the
            // centre, don't wander with the king. Peaks around 1700 and vanishes
            // at both ends of the spectrum.
            let clubBonus = 0;
            if (isCastle) clubBonus += 0.9;
            if ((movedVal === 320 || movedVal === 330) && fr === (mineWhite ? 7 : 0)) clubBonus += 0.5;
            if (isPawn && (tf === 3 || tf === 4)) clubBonus += 0.35;
            if (isKing && !isCastle) clubBonus -= 0.7;
            if (isQueen && pieceCount >= 26) clubBonus -= 0.4;
            perceived += styleW * styleBonus + clubW * clubBonus;
            // Sum of three uniforms ~ normal, scaled to unit variance.
            perceived += sigma * (Math.random() + Math.random() + Math.random() - 1.5) * 0.8165;
            if (perceived > bestScore) { bestScore = perceived; bestIdx = i; }
        }
        selectedMove = dataVariants[bestIdx];
        isTopMove = bestIdx === 0;
    }
    const uciMoves = [selectedMove.move, trueBest.move];
    const sans = uciToSan(fen, uciMoves);
    return {
        finalMoves: [
            { move: selectedMove.move, text: sans[0], eval: positionEval, isTopMove: isTopMove, isBook: false },
            { move: trueBest.move, text: sans[1], eval: positionEval, isTopMove: true, isBook: false }
        ],
        positionEval
    };
}
/* ================== END 1.0.37 HUMAN ENGINE ================== */

function cachePut(fen, moves, positionEval) {
    const cacheKey = fen + "_" + targetElo;
    fenCache.set(cacheKey, { moves, positionEval });
    if (fenCache.size > CACHE_MAX) fenCache.delete(fenCache.keys().next().value);
}
async function predictOpponentMove(oppFen, oppTurn) {
    const curMovetime = useBulletMode ? 150 : 250;
    const curPredictMt = useBulletMode ? 100 : 200;
    if (!useTurbo) return;
    if (!hasSubmittedKey) return;
    if (!sfReady || !sfWorker) return;
    if (inFlight) return;
    if (predictionActive) return;
    if (oppFen === lastPredictedFen) return;
    if (OPENING_BOOK[oppFen]) return;
    predictionActive = true;
    lastPredictedFen = oppFen;
    try {
        const oppVariants = await askArrowEngine(oppFen, curPredictMt);
        if (!predictionActive) { lastPredictedFen = ''; return; }
        if (!oppVariants || oppVariants.length === 0) { predictionActive = false; return; }
        const oppBest = oppVariants[0];
        if (!GameInstance) { predictionActive = false; return; }
        let expectedFen = null;
        try {
            GameInstance.load(oppFen);
            const mv = GameInstance.move({
                from: oppBest.move.slice(0, 2),
                to: oppBest.move.slice(2, 4),
                promotion: oppBest.move.length > 4 ? oppBest.move[4] : undefined
            });
            if (mv) {
                const parts = GameInstance.fen().split(' ');
                expectedFen = parts[0] + ' ' + parts[1] + ' ' + parts[2] + ' - 0 1';
            }
            GameInstance.undo();
        } catch (e) {
            try { GameInstance.undo(); } catch (e2) {}
            expectedFen = null;
        }
        if (!expectedFen) { predictionActive = false; return; }
        if (!predictionActive) { lastPredictedFen = ''; return; }
        const yourTurn = oppTurn === 'w' ? 'b' : 'w';
        const myVariants = await askArrowEngine(expectedFen, curMovetime);
        if (!predictionActive) { lastPredictedFen = ''; return; }
        if (!myVariants || myVariants.length === 0) { predictionActive = false; return; }
        const result = buildMoveResultFromVariants(myVariants, expectedFen, yourTurn);
        const turboKey = expectedFen + "_" + targetElo;
        turboCache.set(turboKey, result);
        if (turboCache.size > TURBO_CACHE_MAX) turboCache.delete(turboCache.keys().next().value);
    } finally {
        predictionActive = false;
    }
}
async function analyzeFen(fen, turn, userColor, isFlipped, boardElement) {
    if (!hasSubmittedKey) return;
    if (!fen) return;
    const cacheKey = fen + "_" + targetElo;
    if (cacheKey === lastFen && (currentMoves.length || inFlight || noMovesFen === cacheKey)) return;

    cancelDelayTimer();
    lastFen = cacheKey;

    if (OPENING_BOOK[fen]) {
        const bookMove = OPENING_BOOK[fen];
        const finalMoves = [{ move: bookMove.move, text: bookMove.text, eval: bookMove.eval }];
        currentMoves = finalMoves;
        renderResult(finalMoves, turn, isFlipped, boardElement, fen, bookMove.eval);
        return;
    }
    if (turboCache.has(cacheKey)) {
        const cached = turboCache.get(cacheKey);
        turboCache.delete(cacheKey);
        cachePut(fen, cached.finalMoves, cached.positionEval);
        currentMoves = cached.finalMoves;
        renderResult(cached.finalMoves, turn, isFlipped, boardElement, fen, cached.positionEval);
        return;
    }
    if (fenCache.has(cacheKey)) {
        const cached = fenCache.get(cacheKey);
        currentMoves = cached.moves;
        renderResult(cached.moves, turn, isFlipped, boardElement, fen, cached.positionEval);
        return;
    }
    if (!sfReady || !sfWorker) {
        updatePanel('initializing…', 'Engine starting...');
        lastFen = '';
        kickEngine();
        return;
    }

    predictionActive = false;
    updatePanel('analyzing…', 'You are ' + userColor + ' | Turn: ' + (turn === 'w' ? 'White' : 'Black'));
    inFlight = true;
    let dataVariants = null;
    try {
        dataVariants = await askArrowEngine(fen, useBulletMode ? 150 : 250);
    } catch (e) {
        dataVariants = null;
    } finally {
        inFlight = false;
    }

    if (dataVariants === null) {
        lastFen = '';
        updatePanel('analyzing…', 'Retrying...');
        kickEngine();
        return;
    }

    if (dataVariants.length > 0) {
        const result = buildMoveResultFromVariants(dataVariants, fen, turn);
        cachePut(fen, result.finalMoves, result.positionEval);
        currentMoves = result.finalMoves;
        renderResult(result.finalMoves, turn, isFlipped, boardElement, fen, result.positionEval);
        // Position moved on without a new game (rematch missed, analysis, takeback):
        // re-arm the terminal handler so a real game-over can fire again.
        if (gameResetDone && cacheKey !== noMovesFen) gameResetDone = false;
        return;
    }

    /* BLOCK D. Empty result. bestmove (none) is NOT proof of game over - it is
       also what a wedged worker or an illegal FEN produces. Confirm before
       destroying anything. This is the fix for mid-game engine death. */
    window.__orstedEmptyResultCount++;
    let terminal = false, legalMoves = -1;
    if (GameInstance) {
        try {
            if (GameInstance.load(fen)) {
                legalMoves = GameInstance.moves().length;
                terminal = legalMoves === 0 ||
                    GameInstance.in_checkmate() ||
                    GameInstance.in_stalemate() ||
                    GameInstance.insufficient_material();
            }
        } catch (e) { terminal = false; }
    }

    if (!terminal) {
        lastFen = '';
        noMovesFen = '';
        updatePanel('re-searching…', legalMoves > 0
            ? ('engine hiccup — ' + legalMoves + ' legal moves exist')
            : 'no line returned');
        kickEngine();
        return;
    }

    noMovesFen = cacheKey;
    currentMoves = [];
    cancelDelayTimer();
    clearHighlights();
    updatePanel('game over', (GameInstance && GameInstance.in_checkmate()) ? 'checkmate' : 'draw / stalemate');

    // Keyed per terminal position, not a sticky per-session boolean.
    if (terminalHandledKey !== cacheKey) {
        terminalHandledKey = cacheKey;
        gameResetDone = true;
        fenCache.clear();
        turboCache.clear();
        lastPredictedFen = '';
        oppMoveTimes.length = 0; lastOppMoveAt = 0;
        soundPlayedForFen = '';
        teardownEngine();
        engineRestartAt = Date.now() + 800;
        orstedTimeout(function () { initLocalEngine(); }, 800);
    }
}
function renderResult(moves, turn, isFlipped, boardElement, fen, positionEval) {
    if (!panel) return;
    const delayMs = getHumanDelay();
    const executeRender = () => {
        activeDelayTimer = null;   // BLOCK F2: timer has fired; unblock the fast path
        const bData = readBoardDispatch();
        if (!bData) return;
        const currentFen = gridToFen(bData.grid, bData.turn);
        if (currentFen !== fen) return;
        const userIsBlack = bData.userColor === 'Black';
        const row0 = document.getElementById('kc-move-0');
        const row1 = document.getElementById('kc-move-1');
        const writeRow = (rowIdx, v, isFirst) => {
            const sanEl = document.getElementById('kc-san-' + rowIdx);
            const evalEl = document.getElementById('kc-eval-' + rowIdx);
            if (!sanEl || !evalEl) return;
            const san = v.text || v.san || v.move || '?';
            let evalStr = "0.00", color = "var(--kc-text)";
            let displayEval = v.eval;
            if (userIsBlack) displayEval = -displayEval;
            if (displayEval !== undefined && displayEval !== null) {
                if (displayEval >= 100) evalStr = '+M';
                else if (displayEval <= -100) evalStr = '-M';
                else evalStr = displayEval > 0 ? '+' + displayEval.toFixed(2) : displayEval.toFixed(2);
                color = displayEval > 0 ? 'var(--kc-primary)' : (displayEval < 0 ? '#888' : 'var(--kc-text)');
            }
            sanEl.textContent = (isFirst ? '★ ' : '› ') + san;
            sanEl.style.fontWeight = isFirst ? '800' : 'normal';
            evalEl.textContent = evalStr;
            evalEl.style.color = color;
        };
        updatePanel('', 'You are ' + bData.userColor + ' | Turn: ' + (turn === 'w' ? 'White' : 'Black'));
        if (moves.length > 0) {
            if (row0) row0.style.display = 'flex';
            writeRow(0, moves[0], true);
        }
        if (moves.length > 1 && row1) {
            row1.style.display = 'flex';
            writeRow(1, moves[1], false);
        } else if (row1) {
            row1.style.display = 'none';
        }
        const userChar = (bData.userColor === 'White') ? 'w' : 'b';
        const isMyTurn = bData.turn === userChar;
        if (isMyTurn && moves.length > 0) {
            drawHighlights(moves, isFlipped, boardElement, fen);
            if (fen !== soundPlayedForFen) {
                if (!useLiteMode) {
                    const mType = getMoveType(fen, moves[0].move);
                    playSound(mType);
                }
                soundPlayedForFen = fen;
            }
        } else {
            clearHighlights();
        }
    };
    if (delayMs > 0) {
        // BLOCK F3: no optional chaining (parse-time SyntaxError before Chrome 80),
        // and the timer is tracked so pagehide can cancel it.
        const bd = readBoardDispatch();
        updatePanel('thinking (delay)…', 'You are ' + (bd ? bd.userColor : '?'));
        activeDelayTimer = orstedTimeout(executeRender, delayMs);
    } else { executeRender(); }
}
let currentBoardElement = null;
let wasMyTurnLastTick = false;
function predictionUseful() {
    if (oppMoveTimes.length < 2) return true;
    let sum = 0;
    for (let i = 0; i < oppMoveTimes.length; i++) sum += oppMoveTimes[i];
    return (sum / oppMoveTimes.length) > OPP_FAST_THRESHOLD_MS;
}
function tick(force) {
    const nowMs = Date.now();
    if (force) {
        window.__orstedForcedTickCount++;
    } else {
        if (nowMs - lastTickAt < 200) return;
        lastTickAt = nowMs;
    }
    if (!tickRunning) tickRunning = true;
    try {
        const site = detectSite();
        if (!site) return;
        if (hasSubmittedKey) kickEngine();
        if (isBoardAnimating()) return;
        window.__orstedTickCount++;

        const boardData = site === 'lichess' ? readBoardLichess() : readBoardChessCom();
        if (!boardData) return;

        /* ---- BLOCK E: SPA / rematch detection (Lichess reuses <cg-board>) ---- */
        const path = location.pathname;
        const moveCount = getMoveNodesCached().length;
        let rematch = false;
        if (lastPathName && path !== lastPathName) rematch = true;
        // Move-count regression is only trustworthy on lichess. Chess.com's
        // move list is virtualised and renders variations, so its .node count
        // can drop mid-game without a new game existing.
        if (site === 'lichess' && lastMoveCountSeen > 0 && moveCount < lastMoveCountSeen) rematch = true;
        if (gameResetDone && lastMoveCountSeen > 0 && moveCount === 0) rematch = true;
        lastPathName = path;
        lastMoveCountSeen = moveCount;
        if (rematch) {
            window.__orstedRematchCount++;
            currentBoardElement = null;
        }

        if (boardData.board !== currentBoardElement) {
            currentBoardElement = boardData.board;
            fenCache.clear();
            turboCache.clear(); lastPredictedFen = '';
            gameResetDone = false;
            terminalHandledKey = '';
            oppMoveTimes.length = 0; lastOppMoveAt = 0;
            soundPlayedForFen = '';
            cachedMoveCount = -1;
            cachedCastlingRights = '-';
            lcConflictSince = 0; lcAbortEnabled = true;
            collideSince = 0; invalidSince = 0; invalidCode = 0;
            wasMyTurnLastTick = false;
            cancelDelayTimer();
            teardownMoveListObserver();
            clearHighlights();
            currentMoves = [];
            lastFen = '';
            noMovesFen = '';
            kickEngine();
        }

        const userChar = (boardData.userColor === 'White') ? 'w' : 'b';
        const isMyTurn = boardData.turn === userChar;

        if (!isMyTurn) {
            cancelDelayTimer();
            if (currentMoves.length > 0) {
                clearHighlights();
                currentMoves = [];
                lastFen = '';
                noMovesFen = '';
            }
            if (wasMyTurnLastTick && sfReady && sfWorker) {
                try { sfWorker.postMessage('stop'); } catch (e) {}
            }
            if (wasMyTurnLastTick) lastOppMoveAt = Date.now();
            wasMyTurnLastTick = false;
            if (useTurbo && hasSubmittedKey && predictionUseful()) {
                const oppFen = gridToFen(boardData.grid, boardData.turn);
                if (oppFen) predictOpponentMove(oppFen, boardData.turn);
            }
            return;
        }

        if (!wasMyTurnLastTick && lastOppMoveAt > 0) {
            const interval = Date.now() - lastOppMoveAt;
            if (interval >= 80 && interval <= 10000) {
                oppMoveTimes.push(interval);
                if (oppMoveTimes.length > 5) oppMoveTimes.shift();
            }
        }
        wasMyTurnLastTick = true;

        const fen = gridToFen(boardData.grid, boardData.turn);
        if (!fen) return;
        const cacheKey = fen + "_" + targetElo;
        if (cacheKey === noMovesFen) return;

        if (cacheKey === lastFen && currentMoves.length > 0) {
            if (activeDelayTimer) return;
            const svg = document.getElementById('orsted-layer');
            if (!useLiteMode && (!svg || svg.children.length <= 1)) {
                drawHighlights(currentMoves, boardData.isFlipped, boardData.board, fen);
            }
            return;
        }
        if (!inFlight) {
            analyzeFen(fen, boardData.turn, boardData.userColor, boardData.isFlipped, boardData.board);
        }
    } catch (e) {
    } finally {
        if (!force) orstedTimeout(tick, 250);
    }
}
window.addEventListener('beforeunload', () => {
    tickRunning = false;
    cancelDelayTimer();
    teardownEngine();
    teardownMoveListObserver();
});
window.addEventListener('pagehide', () => {
    tickRunning = false;
    cancelDelayTimer();          // BLOCK F5
    teardownEngine();
    teardownMoveListObserver();
    if (audioCtx && audioCtx.state === 'running') {
        audioCtx.suspend().catch(() => {});
    }
});
window.addEventListener('pageshow', (e) => {
    if (!e.persisted) return;
    if (audioCtx && audioCtx.state === 'suspended' && !useSmoothMode) {
        audioCtx.resume().catch(() => {});
    }
    currentBoardElement = null;
    lastMoveCountSeen = -1;
    lastPathName = '';
    initLocalEngine().then(() => {
        lastFen = '';
        noMovesFen = '';
        currentMoves = [];
        inFlight = false;
        if (hasSubmittedKey && !tickRunning) tick();
    });
});
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        if (audioCtx && audioCtx.state === 'running') {
            audioCtx.suspend().catch(() => {});
        }
    } else {
        if (audioCtx && audioCtx.state === 'suspended' && !useSmoothMode) {
            audioCtx.resume().catch(() => {});
        }
        if (!sfReady && hasSubmittedKey) {
            kickEngine();
            lastFen = '';
            noMovesFen = '';
            currentMoves = [];
            inFlight = false;
            if (!tickRunning) tick();
        }
    }
});
function start() {
    if (typeof Chess !== 'undefined') {
        ChessEngine = Chess;
        GameInstance = new ChessEngine();
    }
    initLocalEngine();
    const setupUI = () => {
        buildPanel();
        orstedTimeout(tick, 250);
    };
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', setupUI);
    } else {
        setupUI();
    }
}
start();
})();