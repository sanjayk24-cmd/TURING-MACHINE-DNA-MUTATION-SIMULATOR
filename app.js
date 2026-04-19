/**
 * ════════════════════════════════════════════════════════════
 *  TURING MACHINE DNA SIMULATOR — script.js
 *  Core: Turing Machine engine + DNA tape visualisation
 * ════════════════════════════════════════════════════════════
 */

'use strict';

/* ──────────────────────────────────────────────────────────
   PREDEFINED MUTATION RULESETS
   Format: { "state,readSymbol": [newState, writeSymbol, direction] }
   Direction: "L" = left, "R" = right
   Halt state = "halt"
────────────────────────────────────────────────────────── */
const PRESETS = {

  // Complementary DNA: A↔T, G↔C
  complement: {
    "q0,A": ["q0", "T", "R"],
    "q0,T": ["q0", "A", "R"],
    "q0,G": ["q0", "C", "R"],
    "q0,C": ["q0", "G", "R"],
    "q0,_": ["halt", "_", "R"]
  },

  // Replace every A with G
  replaceAG: {
    "q0,A": ["q0", "G", "R"],
    "q0,T": ["q0", "T", "R"],
    "q0,G": ["q0", "G", "R"],
    "q0,C": ["q0", "C", "R"],
    "q0,_": ["halt", "_", "R"]
  },

  // Reverse sequence:
  //  Phase q0: scan right to find the last unprocessed cell
  //  Phase q1: write marker then scan back to copy symbol
  //  Uses a two-pass swap approach for simplicity:
  //  We build the reverse by repeatedly moving the rightmost
  //  unprocessed nucleotide to a "result" accumulator in memory.
  //  Because a pure TM reverse is complex, we implement it as
  //  a JS-assisted preset that rewrites the tape directly.
  reverse: "__SPECIAL_REVERSE__"
};

/* ──────────────────────────────────────────────────────────
   DOM REFERENCES
────────────────────────────────────────────────────────── */
const $ = id => document.getElementById(id);

const dnaInput       = $('dnaInput');
const presetSelect   = $('presetSelect');
const ruleEditor     = $('ruleEditor');
const speedSlider    = $('speedSlider');
const speedLabel     = $('speedLabel');
const btnRun         = $('btnRun');
const btnStep        = $('btnStep');
const btnPause       = $('btnPause');
const btnReset       = $('btnReset');
const btnExport      = $('btnExport');
const clearLogBtn    = $('clearLog');

const tapeTrack      = $('tapeTrack');
const headRow        = $('headRow');
const mutationMsg    = $('mutationMsg');

const statState      = $('statState');
const statStep       = $('statStep');
const statHead       = $('statHead');
const statSymbol     = $('statSymbol');
const ruleDisplay    = $('ruleDisplay');
const statusDisplay  = $('statusDisplay');
const statusBadge    = $('statusBadge');
const logBox         = $('logBox');
const resultSeq      = $('resultSeq');

/* ──────────────────────────────────────────────────────────
   TURING MACHINE STATE
────────────────────────────────────────────────────────── */
let tape         = [];      // Array of symbols (strings)
let head         = 0;       // Current head position (index)
let currentState = 'q0';    // Current TM state
let stepCount    = 0;       // How many steps taken
let rules        = {};      // Parsed transition table
let halted       = false;   // Whether TM has halted
let running      = false;   // Auto-run flag
let paused       = false;   // Paused flag
let runTimer     = null;    // setInterval handle
let isSpecialReverse = false; // Flag for built-in reverse preset

/* ──────────────────────────────────────────────────────────
   BACKGROUND PARTICLES
────────────────────────────────────────────────────────── */
function spawnParticles() {
  const container = $('bgParticles');
  for (let i = 0; i < 30; i++) {
    const p = document.createElement('div');
    p.className = 'particle';
    p.style.left   = Math.random() * 100 + 'vw';
    p.style.bottom = '-4px';
    p.style.setProperty('--dur',   (6 + Math.random() * 10) + 's');
    p.style.setProperty('--delay', (Math.random() * 12) + 's');
    // randomly tint some particles green or yellow
    const tints = ['#00e5ff','#00ff9d','#ffe200','#b36bff'];
    p.style.background = tints[Math.floor(Math.random() * tints.length)];
    container.appendChild(p);
  }
}

/* ──────────────────────────────────────────────────────────
   TAPE HELPERS
────────────────────────────────────────────────────────── */

/** Build tape array from a DNA string */
function buildTape(seq) {
  tape = seq.toUpperCase().split('').filter(c => 'ATGC_'.includes(c));
  if (tape.length === 0) tape = ['_'];
}

/** Ensure the tape is long enough, expanding with blanks */
function ensureTape(pos) {
  while (pos < 0) {
    tape.unshift('_');
    head++;                 // shift head right to keep position
  }
  while (pos >= tape.length) {
    tape.push('_');
  }
}

/* ──────────────────────────────────────────────────────────
   TAPE RENDERING
────────────────────────────────────────────────────────── */

/** Return the CSS class for a nucleotide symbol */
function cellClass(sym) {
  return 'cell-' + (sym === '_' ? '_' : sym.toUpperCase());
}

/** Render (or re-render) the entire tape */
function renderTape(mutatedIdx = -1) {
  tapeTrack.innerHTML = '';
  headRow.innerHTML   = '';

  const CELL_W = 56; // cell width + gap (px)

  tape.forEach((sym, i) => {
    const cell = document.createElement('div');
    cell.className = `tape-cell ${cellClass(sym)}`;
    if (i === head) cell.classList.add('active');
    if (i === mutatedIdx) cell.classList.add('mutated');

    cell.textContent = sym === '_' ? '·' : sym;

    // index label
    const idx = document.createElement('span');
    idx.className = 'cell-index';
    idx.textContent = i;
    cell.appendChild(idx);

    tapeTrack.appendChild(cell);
  });

  // Position the head arrow
  const arrow = document.createElement('div');
  arrow.className = 'head-arrow';
  arrow.style.left = (20 + head * CELL_W + 21) + 'px'; // 20px padding-left, 21px = half cell
  headRow.appendChild(arrow);

  // Auto-scroll tape to keep head visible
  const viewport = tapeTrack.closest('.tape-viewport');
  const cellLeft  = head * CELL_W;
  const vpWidth   = viewport.clientWidth;
  const scrollTo  = cellLeft - (vpWidth / 2) + 26;
  viewport.scrollTo({ left: Math.max(0, scrollTo), behavior: 'smooth' });
}

/* ──────────────────────────────────────────────────────────
   STATS / INFO UPDATE
────────────────────────────────────────────────────────── */
function bumpStat(el, val) {
  el.textContent = val;
  el.classList.remove('bump');
  void el.offsetWidth;
  el.classList.add('bump');
}

function updateStats(appliedRule = null) {
  bumpStat(statState,  currentState);
  bumpStat(statStep,   stepCount);
  bumpStat(statHead,   head);
  bumpStat(statSymbol, tape[head] || '_');

  // Rule display
  if (appliedRule) {
    const [fromState, readSym, newState, writeSym, dir] = appliedRule;
    ruleDisplay.innerHTML =
      `<span class="rule-parts">` +
      `<span class="rule-state">(${fromState}</span>` +
      `<span>, </span>` +
      `<span class="rule-sym">${readSym})</span>` +
      `<span class="rule-arrow"> → </span>` +
      `<span class="rule-nstate">(${newState}</span>` +
      `<span>, </span>` +
      `<span class="rule-write">${writeSym}</span>` +
      `<span>, </span>` +
      `<span class="rule-dir">${dir})</span>` +
      `</span>`;
  }
}

/* ──────────────────────────────────────────────────────────
   LOGGING
────────────────────────────────────────────────────────── */
function log(msg, type = 'step') {
  const entry = document.createElement('div');
  entry.className = `log-entry log-${type}`;
  entry.textContent = msg;
  logBox.appendChild(entry);
  logBox.scrollTop = logBox.scrollHeight;
}

/* ──────────────────────────────────────────────────────────
   STATUS DISPLAY
────────────────────────────────────────────────────────── */
function setStatus(mode) {
  const icons = {
    idle:    { dot: 'dot-idle',    text: 'READY TO RUN',         badge: 'IDLE' },
    running: { dot: 'dot-running', text: 'RUNNING ⏳',           badge: 'RUNNING' },
    paused:  { dot: 'dot-paused',  text: 'PAUSED',               badge: 'PAUSED' },
    halted:  { dot: 'dot-halted',  text: 'MUTATION COMPLETE ✅',  badge: 'HALTED' }
  };
  const s = icons[mode] || icons.idle;
  statusDisplay.innerHTML = `<span class="dot ${s.dot}"></span> ${s.text}`;
  statusBadge.textContent = s.badge;
  statusBadge.className   = 'status-badge ' + (mode === 'running' ? 'running' : mode === 'halted' ? 'halted' : '');
}

/* ──────────────────────────────────────────────────────────
   MUTATION MESSAGE
────────────────────────────────────────────────────────── */
function showMutMsg(msg) {
  mutationMsg.textContent = msg;
  mutationMsg.classList.add('visible');
  clearTimeout(showMutMsg._t);
  showMutMsg._t = setTimeout(() => mutationMsg.classList.remove('visible'), 1400);
}

/* ──────────────────────────────────────────────────────────
   RULE PARSING
────────────────────────────────────────────────────────── */
function parseRules(jsonStr) {
  try {
    const obj = JSON.parse(jsonStr);
    // Validate structure
    for (const key of Object.keys(obj)) {
      const val = obj[key];
      if (!Array.isArray(val) || val.length !== 3) throw new Error(`Bad rule: ${key}`);
    }
    return { ok: true, rules: obj };
  } catch(e) {
    return { ok: false, error: e.message };
  }
}

/* ──────────────────────────────────────────────────────────
   SINGLE STEP EXECUTION
────────────────────────────────────────────────────────── */
function step() {
  if (halted) return;

  ensureTape(head);

  const sym = tape[head] || '_';
  const key = `${currentState},${sym}`;
  const rule = rules[key];

  if (!rule) {
    // No rule → halt
    halt();
    return;
  }

  const [newState, writeSym, dir] = rule;
  const prevSym = tape[head];
  const wasMutation = writeSym !== prevSym;

  // Write
  tape[head] = writeSym;
  stepCount++;

  // Log
  log(
    `Step ${stepCount}: (${currentState}, ${sym}) → (${newState}, ${writeSym}, ${dir})`,
    wasMutation ? 'mut' : 'step'
  );

  // Show mutation message
  if (wasMutation) {
    showMutMsg(`${prevSym} → ${writeSym} at position ${head}`);
  }

  // Render tape with mutation highlight
  renderTape(wasMutation ? head : -1);

  // Update state
  updateStats([currentState, sym, newState, writeSym, dir]);
  currentState = newState;

  // Move head
  if (dir === 'R') head++;
  else if (dir === 'L') head--;
  if (head < 0) { tape.unshift('_'); head = 0; }

  ensureTape(head);

  // Check halt
  if (newState === 'halt') {
    halt();
    return;
  }

  // Re-render to move the head indicator
  renderTape();
  updateStats();
}

/* ──────────────────────────────────────────────────────────
   HALT
────────────────────────────────────────────────────────── */
function halt() {
  halted  = true;
  running = false;
  clearInterval(runTimer);
  setStatus('halted');
  const finalSeq = tape.join('').replace(/_+/g, '').trim() || '_';
  resultSeq.textContent = finalSeq;
  log(`════ HALTED after ${stepCount} steps. Result: ${finalSeq} ════`, 'halt');
  btnRun.disabled   = false;
  btnStep.disabled  = true;
  btnPause.disabled = true;
  renderTape();
  updateStats();
}

/* ──────────────────────────────────────────────────────────
   SPECIAL REVERSE (not easily expressible as a standard TM rule table)
   We rewrite the tape directly then re-init rules to a pass-through
   that processes one cell at a time while revealing the already-reversed tape.
────────────────────────────────────────────────────────── */
function applySpecialReverse() {
  // Build reversed tape
  const content = tape.filter(c => c !== '_');
  const reversed = content.reverse();
  buildTape(reversed.join(''));
  renderTape();
  log('Reverse preset: tape content has been reversed.', 'info');
  log('Running a pass-through scan to animate the result…', 'info');

  // Now use a simple pass-through rule set to animate the head moving R
  rules = {};
  for (const sym of ['A', 'T', 'G', 'C', '_']) {
    rules[`q0,${sym}`] = ['q0', sym, 'R'];
  }
  rules['q0,_'] = ['halt', '_', 'R'];
  isSpecialReverse = false; // rules are now loaded
}

/* ──────────────────────────────────────────────────────────
   INIT / RESET
────────────────────────────────────────────────────────── */
function init() {
  // Stop any running sim
  clearInterval(runTimer);
  running = paused = halted = false;
  stepCount = 0;
  head = 0;
  currentState = 'q0';
  isSpecialReverse = false;

  // Build tape
  const dnaStr = dnaInput.value.toUpperCase().replace(/[^ATGC]/g, '') || 'ATGCGT';
  buildTape(dnaStr);

  // Load rules
  const preset = presetSelect.value;
  if (preset && preset !== 'custom') {
    const p = PRESETS[preset];
    if (p === '__SPECIAL_REVERSE__') {
      isSpecialReverse = true;
      rules = {};
    } else {
      rules = JSON.parse(JSON.stringify(p)); // deep copy
      ruleEditor.value = JSON.stringify(rules, null, 2);
    }
  } else {
    const parsed = parseRules(ruleEditor.value);
    if (!parsed.ok) {
      log(`Rule parse error: ${parsed.error}`, 'error');
      rules = {};
    } else {
      rules = parsed.rules;
    }
  }

  // UI
  resultSeq.textContent = '—';
  ruleDisplay.innerHTML = '<span class="rule-none">— no rule applied yet —</span>';
  setStatus('idle');
  updateStats();
  renderTape();

  btnRun.disabled   = false;
  btnStep.disabled  = false;
  btnPause.disabled = true;
}

/* ──────────────────────────────────────────────────────────
   RUN (auto)
────────────────────────────────────────────────────────── */
function run() {
  if (halted) return;
  if (running) return;

  // Handle special reverse first
  if (isSpecialReverse) {
    applySpecialReverse();
  }

  running = true;
  paused  = false;
  setStatus('running');
  btnRun.disabled   = true;
  btnStep.disabled  = true;
  btnPause.disabled = false;

  const delay = parseInt(speedSlider.value, 10);
  runTimer = setInterval(() => {
    if (!running || paused || halted) { clearInterval(runTimer); return; }
    step();
    if (halted) clearInterval(runTimer);
  }, delay);
}

/* ──────────────────────────────────────────────────────────
   PAUSE / RESUME
────────────────────────────────────────────────────────── */
function togglePause() {
  if (!running) return;
  paused = !paused;
  if (paused) {
    clearInterval(runTimer);
    setStatus('paused');
    btnPause.textContent = '▶ RESUME';
  } else {
    const delay = parseInt(speedSlider.value, 10);
    runTimer = setInterval(() => {
      if (!running || paused || halted) { clearInterval(runTimer); return; }
      step();
      if (halted) clearInterval(runTimer);
    }, delay);
    setStatus('running');
    btnPause.textContent = '⏸ PAUSE';
  }
}

/* ──────────────────────────────────────────────────────────
   STEP (manual single step)
────────────────────────────────────────────────────────── */
function manualStep() {
  if (halted) return;
  if (running && !paused) return;

  // Handle special reverse first
  if (isSpecialReverse) {
    applySpecialReverse();
  }

  setStatus('running');
  step();
  if (!halted) setStatus('paused');
}

/* ──────────────────────────────────────────────────────────
   EXPORT
────────────────────────────────────────────────────────── */
function exportResult() {
  const final = tape.join('').replace(/_+/g, '').trim() || '_';
  const original = dnaInput.value.toUpperCase();
  const preset   = presetSelect.value || 'custom';
  const content  =
    `TURING MACHINE DNA SIMULATOR — EXPORT\n` +
    `======================================\n` +
    `Original Sequence : ${original}\n` +
    `Preset / Rules    : ${preset}\n` +
    `Steps Taken       : ${stepCount}\n` +
    `Final State       : ${currentState}\n` +
    `Result Sequence   : ${final}\n` +
    `Exported At       : ${new Date().toISOString()}\n`;

  const blob = new Blob([content], { type: 'text/plain' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `dna_mutation_result_${Date.now()}.txt`;
  a.click();
  URL.revokeObjectURL(url);
  log('Result exported to file.', 'info');
}

/* ──────────────────────────────────────────────────────────
   PRESET CHANGE → UPDATE RULE EDITOR
────────────────────────────────────────────────────────── */
function onPresetChange() {
  const val = presetSelect.value;
  if (!val || val === 'custom') {
    // Leave editor as-is
    return;
  }
  const p = PRESETS[val];
  if (p === '__SPECIAL_REVERSE__') {
    ruleEditor.value = '// Built-in reverse logic (no rule table needed)';
  } else {
    ruleEditor.value = JSON.stringify(p, null, 2);
  }
}

/* ──────────────────────────────────────────────────────────
   SPEED CHANGE
────────────────────────────────────────────────────────── */
function onSpeedChange() {
  const ms = parseInt(speedSlider.value, 10);
  speedLabel.textContent = ms + 'ms';
  // If already running, restart timer with new delay
  if (running && !paused) {
    clearInterval(runTimer);
    runTimer = setInterval(() => {
      if (!running || paused || halted) { clearInterval(runTimer); return; }
      step();
      if (halted) clearInterval(runTimer);
    }, ms);
  }
}

/* ──────────────────────────────────────────────────────────
   DNA INPUT VALIDATION (only ATGC allowed)
────────────────────────────────────────────────────────── */
dnaInput.addEventListener('input', () => {
  const clean = dnaInput.value.toUpperCase().replace(/[^ATGC]/g, '');
  if (dnaInput.value !== clean) dnaInput.value = clean;
});

/* ──────────────────────────────────────────────────────────
   EVENT LISTENERS
────────────────────────────────────────────────────────── */
btnRun.addEventListener('click',     run);
btnStep.addEventListener('click',    manualStep);
btnPause.addEventListener('click',   togglePause);
btnReset.addEventListener('click',   init);
btnExport.addEventListener('click',  exportResult);
clearLogBtn.addEventListener('click', () => { logBox.innerHTML = ''; });
presetSelect.addEventListener('change', onPresetChange);
speedSlider.addEventListener('input', onSpeedChange);

/* ──────────────────────────────────────────────────────────
   BOOTSTRAP
────────────────────────────────────────────────────────── */
spawnParticles();

// Set default preset and init
presetSelect.value = 'complement';
onPresetChange();
init();

log('Welcome to the Turing Machine DNA Simulator 🧬', 'info');
log('Select a preset or write custom rules, then press RUN or STEP.', 'info');