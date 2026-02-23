const STORAGE_KEY = 'running_rpg_data_v1';
const defaultData = {
  entries: [],
  stats: { endurance: 0, speed: 0, recovery: 0, consistency: 0 },
  plan: [],
  trainingPlan: null,
  totalExp: 0,
  updatedAt: new Date().toISOString()
};

const SAMPLE_OCR_TEXTS = [
`21:05 LTE 95%
개요 통계 랩
거리 8,29 k m
총 시간 55:18
평균 페이스 6:40 / k m
평균 심박수 153 b pm
총 칼로리 612 k ca l`,
`GARMIN
DISTANCE 1002 km
TIME 00:52:44
AVG PACE 5:15 /km
AVG HR 168 bpm
CALORIES 745 kcal
22:14`,
`상태바 20:58
거리 12.48 km
duration 1:10:22
pace 5'38 / km
heart rate 161
칼로리 8O2 kcal`
];

const OCR_CONFIG = {
  longEdgeTarget: 1900,
  topNoiseRatio: 0.18,
  topTabRatio: 0.32,
  lowerRoiStart: 0.48
  topNoiseRatio: 0.12,
  topTabRatio: 0.28,
  lowerRoiStart: 0.4
};

let data = loadData();
let editingId = null;
let cvReady = false;
let lastParseResult = null;

const els = {
  sumDistance: byId('sumDistance'), sumDuration: byId('sumDuration'), sumPace: byId('sumPace'),
  sumCount: byId('sumCount'), sumLevel: byId('sumLevel'), sumExp: byId('sumExp'),
  sum30Pace: byId('sum30Pace'), sum30Hr: byId('sum30Hr'), levelProgress: byId('levelProgress'),
  levelRemaining: byId('levelRemaining'),
  imageInput: byId('imageInput'), runOcrBtn: byId('runOcrBtn'), ocrStatus: byId('ocrStatus'), ocrProgress: byId('ocrProgress'),
  ocrText: byId('ocrText'), reparseBtn: byId('reparseBtn'), parseWarnings: byId('parseWarnings'),
  entryForm: byId('entryForm'), date: byId('date'), distance: byId('distance'), duration: byId('duration'), avgHr: byId('avgHr'),
  calories: byId('calories'), memo: byId('memo'), trainingType: byId('trainingType'),
  sortSelect: byId('sortSelect'), entryTableBody: byId('entryTableBody'),
  buildSummary: byId('buildSummary'), statsContainer: byId('statsContainer'),
  planList: byId('planList'), regenPlanBtn: byId('regenPlanBtn'), savePlanBtn: byId('savePlanBtn'),
  currentMonthKm: byId('currentMonthKm'), targetMonthKm: byId('targetMonthKm'), weeklyIncreaseRate: byId('weeklyIncreaseRate'), cutbackEvery: byId('cutbackEvery'),
  weeklyPlanBody: byId('weeklyPlanBody'), planProgress: byId('planProgress'),
  exportJsonBtn: byId('exportJsonBtn'), importJsonInput: byId('importJsonInput'), exportCsvBtn: byId('exportCsvBtn'), resetStorageBtn: byId('resetStorageBtn'),
  globalMessage: byId('globalMessage'),
  debugToggle: byId('debugToggle'), debugPanel: byId('debugPanel'), roiCanvas: byId('roiCanvas'),
  pipelineThumbs: byId('pipelineThumbs'), debugCandidates: byId('debugCandidates'), candidatePanel: byId('candidatePanel'),
  insertTemplateBtn: byId('insertTemplateBtn'), injectSample1Btn: byId('injectSample1Btn'), injectSample2Btn: byId('injectSample2Btn'), injectSample3Btn: byId('injectSample3Btn'),
  mainMenu: byId('mainMenu')
  insertTemplateBtn: byId('insertTemplateBtn'), injectSample1Btn: byId('injectSample1Btn'), injectSample2Btn: byId('injectSample2Btn'), injectSample3Btn: byId('injectSample3Btn')
};

init();

function init() {
  if (!data.plan.length) data.plan = generateMonthlyPlan();
  ensureTrainingPlan();
  initOpenCV();
  bindEvents();
  renderAll();
  els.date.value = toDateInputValue(new Date());
  runParserSelfTest();
}

function initOpenCV() {
  if (!window.cv) return;
  if (window.cv.Mat) {
    cvReady = true;
    return;
  }
  window.cv.onRuntimeInitialized = () => {
    cvReady = true;
    showMsg('OpenCV 로딩 완료');
  };
}

function bindEvents() {
  els.runOcrBtn.addEventListener('click', handleOcr);
  els.reparseBtn.addEventListener('click', () => parseToForm(els.ocrText.value, null, { source: 'manual_reparse' }));
  els.entryForm.addEventListener('submit', saveEntry);
  els.sortSelect.addEventListener('change', renderEntries);
  els.debugToggle.addEventListener('change', () => {
    els.debugPanel.classList.toggle('hidden', !els.debugToggle.checked);
  });
  bindMainMenu();
  els.insertTemplateBtn.addEventListener('click', insertCorrectionTemplate);
  [els.injectSample1Btn, els.injectSample2Btn, els.injectSample3Btn].forEach((btn, idx) => {
    btn.addEventListener('click', () => {
      els.ocrText.value = SAMPLE_OCR_TEXTS[idx];
      parseToForm(els.ocrText.value, null, { source: `sample_${idx + 1}` });
    });
  });

  els.regenPlanBtn.addEventListener('click', generateAutoMileagePlanFromInput);
  els.savePlanBtn?.addEventListener('click', () => {
    persist('목표 월 마일리지 계획을 저장했습니다.');
  els.regenPlanBtn.addEventListener('click', () => {
    data.plan = generateMonthlyPlan();
    persist('월간 계획을 재생성했습니다.');
    renderPlan();
  });
  els.exportJsonBtn.addEventListener('click', exportJSON);
  els.importJsonInput.addEventListener('change', importJSON);
  els.exportCsvBtn.addEventListener('click', exportCSV);
  els.resetStorageBtn.addEventListener('click', () => {
    if (confirm('정말로 모든 localStorage 데이터를 삭제할까요?')) {
      localStorage.removeItem(STORAGE_KEY);
      data = structuredClone(defaultData);
      data.plan = generateMonthlyPlan();
      persist('초기화 완료');
      renderAll();
    }
  });
}


function bindMainMenu() {
  if (!els.mainMenu) return;
  const buttons = [...els.mainMenu.querySelectorAll('.menu-btn')];
  buttons.forEach((btn) => {
    btn.addEventListener('click', () => switchSection(btn.dataset.target));
  });
  switchSection('dashboardSection');
}

function switchSection(targetId) {
  const sections = document.querySelectorAll('.page-section');
  sections.forEach((section) => section.classList.toggle('hidden', section.id !== targetId));
  if (els.mainMenu) {
    [...els.mainMenu.querySelectorAll('.menu-btn')].forEach((btn) => btn.classList.toggle('active', btn.dataset.target === targetId));
  }
}

async function handleOcr() {
  const file = els.imageInput.files?.[0];
  if (!file) return showMsg('이미지를 먼저 선택하세요.', true);
  if (!window.Tesseract) return showMsg('Tesseract 로딩 실패: 로컬 서버로 실행을 시도하세요.', true);

  els.ocrStatus.textContent = 'OCR 파이프라인 실행 중...';
  els.ocrProgress.value = 0;

  try {
    const image = await loadImageFromFile(file);
    const resizedCanvas = resizeImageToCanvas(image, OCR_CONFIG.longEdgeTarget);
    const roiCandidates = cvReady ? detectRois(resizedCanvas) : [defaultLowerRoi(resizedCanvas)];
    const selectedRois = roiCandidates.length ? roiCandidates : [defaultLowerRoi(resizedCanvas)];
    renderRoiDebug(resizedCanvas, selectedRois);

    const versions = cvReady ? buildPreprocessedVersions(resizedCanvas) : buildFallbackVersions(resizedCanvas);
    renderPipelineThumbs(versions);

    const tasks = [];
    for (const roi of selectedRois) {
      for (const version of versions) {
        tasks.push({ roi, version });
      }
    }
    tasks.push(...versions.map((version) => ({ roi: null, version, isFallbackFull: true })));

    let done = 0;
    let best = null;
    for (const task of tasks) {
      const rawCanvas = task.roi ? cropCanvas(task.version.canvas, task.roi) : task.version.canvas;
      const roiCanvas = maskTopNoiseStrip(rawCanvas, OCR_CONFIG.topNoiseRatio);
      const roiCanvas = task.roi ? cropCanvas(task.version.canvas, task.roi) : task.version.canvas;
      const { text } = await runTesseractMulti(roiCanvas, (status, progress) => {
        if (status === 'recognizing text') {
          const p = Math.round(((done + progress) / tasks.length) * 100);
          els.ocrProgress.value = p;
          els.ocrStatus.textContent = `OCR 진행률 ${p}%`;
        }
      }, task.version.psmSet);

      const parse = parseOCRText(text, {
        roi: task.roi,
        roiSource: task.roi ? 'detected_roi' : 'full_fallback',
        pipelineName: task.version.name,
        imageHeight: task.version.canvas.height
      });
      done += 1;

      if (!best || parse.totalScore > best.parse.totalScore) {
        best = { text, parse, task };
      }
    }

    if (!best) throw new Error('OCR 결과가 비어 있습니다.');
    els.ocrText.value = best.text || '';
    parseToForm(best.text, best.parse, { source: 'ocr_ensemble' });
    els.ocrStatus.textContent = `OCR 완료 · 선택 파이프라인: ${best.task.version.name}`;
  } catch (e) {
    els.ocrStatus.textContent = 'OCR 실패';
    showMsg(`OCR 실패: ${e.message}.`, true);
  }
}

async function runTesseractMulti(canvas, logger, psmSet = [6, 11]) {
  const langs = ['eng+kor', 'eng'];
  let latestErr = null;
  for (const lang of langs) {
    for (const psm of psmSet) {
      try {
        const { data: ocr } = await Tesseract.recognize(canvas, lang, {
          logger,
          tessedit_pageseg_mode: psm,
          tessedit_char_whitelist: '0123456789:.,/kmKMbBpPcCaAlLhHrRtTiImMeE '
        });
        if ((ocr.text || '').trim()) return { text: ocr.text, lang, psm };
      } catch (e) {
        latestErr = e;
      }
    }
  }
  throw latestErr || new Error('모든 OCR 조합 실패');
}

async function runTesseractMulti(canvas, logger, psmSet = [6, 11]) {
  const langs = ['eng+kor', 'eng'];
  let latestErr = null;
  for (const lang of langs) {
    for (const psm of psmSet) {
      try {
        const { data: ocr } = await Tesseract.recognize(canvas, lang, {
          logger,
          tessedit_pageseg_mode: psm,
          tessedit_char_whitelist: '0123456789:.,/kmKMbBpPcCaAlLhHrRtTiImMeE '
        });
        if ((ocr.text || '').trim()) return { text: ocr.text, lang, psm };
      } catch (e) {
        latestErr = e;
      }
    }
  }
  throw latestErr || new Error('모든 OCR 조합 실패');
}

function parseToForm(text, preParsed = null, meta = {}) {
  const parsed = preParsed || parseOCRText(text, { roiSource: meta.source || 'manual' });
  lastParseResult = parsed;

  els.distance.value = parsed.values.distance ?? '';
  els.duration.value = parsed.values.duration ?? '';
  els.avgHr.value = parsed.values.avgHr ?? '';
  els.calories.value = parsed.values.calories ?? '';

  const warn = [];
  if (!parsed.values.distance) warn.push('거리 추출 실패');
  if (!parsed.values.duration) warn.push('시간 추출 실패');
  if (!parsed.values.pace && !(parsed.values.distance && parsed.values.duration)) warn.push('페이스 추출/계산 실패');
  if (!parsed.values.avgHr) warn.push('평균심박 추출 실패');
  if (!parsed.values.calories) warn.push('칼로리 추출 실패');
  els.parseWarnings.innerHTML = warn.map(w => `<div>⚠️ ${w}</div>`).join('');
  renderCandidateSelectors(parsed);
  renderDebugCandidates(parsed);
  showMsg('OCR 파싱 결과를 폼에 반영했습니다.');
}

function parseOCRText(text, context = {}) {
  const normalizedText = normalizeOcrText(text);
  const lines = normalizedText.split('\n').map((line, idx) => ({ raw: line, idx, norm: normalizeLine(line), lineRatio: idx / Math.max(1, normalizedText.split('\n').length - 1) })).filter(l => l.norm);
  const lines = normalizedText.split('\n').map((line, idx) => ({ raw: line, idx, norm: normalizeLine(line) })).filter(l => l.norm);
  const labelIndexes = detectLabelIndexes(lines);

  const candidates = {
    distance: collectDistanceCandidates(lines, labelIndexes, context),
    duration: collectDurationCandidates(lines, labelIndexes, context),
    pace: collectPaceCandidates(lines, labelIndexes, context),
    avgHr: collectHrCandidates(lines, labelIndexes, context),
    calories: collectCalorieCandidates(lines, labelIndexes, context)
  };

  const bestCombo = chooseBestCombination(candidates);
  return {
    values: bestCombo.values,
    candidates,
    reasons: bestCombo.reasons,
    totalScore: bestCombo.totalScore,
    normalizedText,
    meta: context
  };
}

function normalizeOcrText(text = '') {
  return text
    .replace(/\u00A0/g, ' ')
    .replace(/[，]/g, ',')
    .replace(/[：]/g, ':')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\r/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

function normalizeLine(line = '') {
  let t = line.toLowerCase().trim();
  t = t.replace(/(k\s*[.,]?\s*m)/g, 'km');
  t = t.replace(/(b\s*[.,]?\s*p\s*[.,]?\s*m)/g, 'bpm');
  t = t.replace(/(k\s*[.,]?\s*c\s*[.,]?\s*a\s*[.,]?\s*l)/g, 'kcal');
  t = t.replace(/\/\s*k\s*m/g, '/km');
  t = t.replace(/(\d),(\d)/g, '$1.$2');
  t = t.replace(/([0-9])\s*[·•]\s*([0-9])/g, '$1.$2');
  t = t.replace(/[|]/g, '1');
  return t;
}

function fixNumericToken(token, allowDecimal = false) {
  const map = { o: '0', O: '0', l: '1', I: '1', s: '5', S: '5', b: '6', B: '8' };
  const chars = token.split('').map((c) => map[c] ?? c);
  const keep = allowDecimal ? /[0-9.]/ : /[0-9]/;
  return chars.filter((c) => keep.test(c)).join('');
}

function detectLabelIndexes(lines) {
  const dictionary = {
    distance: ['거리', 'dist', 'distance'],
    duration: ['총 시간', 'duration', 'time', '시간'],
    pace: ['평균 페이스', 'pace'],
    avgHr: ['평균 심박', '심박수', 'hr', 'heart'],
    calories: ['총 칼로리', '칼로리', 'kcal', 'calories']
  };
  const out = {};
  for (const [field, words] of Object.entries(dictionary)) {
    out[field] = [];
    for (const line of lines) {
      const score = Math.max(...words.map(w => similarity(line.norm, w)));
      if (score >= 0.62) out[field].push({ idx: line.idx, score });
    }
  }
  return out;
}

function labelProximityScore(lineIdx, labels) {
  if (!labels?.length) return 0;
  const distance = Math.min(...labels.map(l => Math.abs(l.idx - lineIdx)));
  const closeness = Math.max(0, 1 - distance / 4);
  const labelStrength = Math.max(...labels.map(l => l.score));
  return closeness * 30 + labelStrength * 20;
}

function collectDistanceCandidates(lines, labelIndexes, context) {
  const out = [];
  const add = (value, line, reason, base = 40) => {
    if (!value || value < 0.5 || value > 60) return;
    let score = base + labelProximityScore(line.idx, labelIndexes.distance);
    score += context.roi ? 8 : 0;
    if (line.idx / Math.max(1, lines.length) < 0.2) score -= 8;
    out.push({ value: Number(value.toFixed(2)), score, reason, line: line.raw });
  };

  for (const line of lines) {
    const kmMatch = line.norm.match(/(\d{1,3}(?:\.\d{1,3})?)\s*km\b/);
    if (kmMatch) add(Number(kmMatch[1]), line, 'km 패턴');

    const rawNums = line.norm.match(/\b\d{3,5}\b/g) || [];
    for (const raw of rawNums) {
      if (!/dist|거리|km/.test(line.norm)) continue;
      const variants = [
        Number(`${raw.slice(0, raw.length - 2)}.${raw.slice(-2)}`),
        raw.length >= 4 ? Number(`${raw.slice(0, raw.length - 1)}.${raw.slice(-1)}`) : null
      ].filter(Boolean);
      variants.forEach((decimal, idx) => add(decimal, line, idx === 0 ? '소수점 복원(2자리)' : '소수점 복원(1자리)', 30 - idx * 4));
    }
  }
  return dedupeCandidates(out);
}

function collectDurationCandidates(lines, labelIndexes, context) {
  const out = [];
  const add = (value, line, reason, base = 45) => {
    if (!value) return;
    let score = base + labelProximityScore(line.idx, labelIndexes.duration);
    const sec = durationToSec(value);
    if (sec < 120 || sec > 8 * 3600) score -= 35;
    const isTop = line.idx / Math.max(1, lines.length) < 0.25;
    const likelyClock = /^(2[0-3]|1\d):[0-5]\d$/.test(value);
    if (likelyClock && !/duration|총 시간|time|시간/.test(line.norm)) score -= 100;
    if (isTop) score -= 35;
    if (/lte|5g|배터리|battery|상태바/.test(line.norm)) score -= 120;
    if (context.roiSource === 'full_fallback') score -= 4;
    out.push({ value, score, reason, line: line.raw, sec });
  };

  for (const line of lines) {
    const matches = line.norm.match(/\b(\d{1,2}:\d{2}(?::\d{2})?)\b/g) || [];
    for (const m of matches) add(normalizeDuration(m), line, '시간 패턴');
  }
  return dedupeCandidates(out);
}

function collectPaceCandidates(lines, labelIndexes, context) {
  const out = [];
  const add = (value, line, reason, base = 46) => {
    if (!value) return;
    const sec = paceToSec(value);
    if (sec < 180 || sec > 750) return;
    let score = base + labelProximityScore(line.idx, labelIndexes.pace);
    if (/\/km|pace|페이스/.test(line.norm)) score += 8;
    if (context.roi) score += 4;
    out.push({ value, score, reason, line: line.raw, sec });
  };

  for (const line of lines) {
    const p1 = line.norm.match(/(\d{1,2})[:'"`](\d{2})\s*\/\s*km/);
    if (p1) add(`${Number(p1[1])}:${p1[2]}`, line, '페이스 단위 패턴');
    const p2 = line.norm.match(/\b(\d{1,2}:\d{2})\b/);
    if (p2 && /pace|페이스|\/km/.test(line.norm)) add(p2[1], line, '페이스 근접 패턴', 38);
  }
  return dedupeCandidates(out);
}

function collectHrCandidates(lines, labelIndexes, context) {
  const out = [];
  const add = (value, line, reason, base = 40) => {
    if (!value || value < 60 || value > 220) return;
    let score = base + labelProximityScore(line.idx, labelIndexes.avgHr);
    if (/bpm|hr|heart|심박/.test(line.norm)) score += 8;
    if (context.roi) score += 3;
    out.push({ value: Math.round(value), score, reason, line: line.raw });
  };

  for (const line of lines) {
    const m1 = line.norm.match(/\b(\d{2,3})\s*bpm\b/);
    if (m1) add(Number(m1[1]), line, 'bpm 패턴');
    if (/hr|heart|심박/.test(line.norm)) {
      const m2 = line.norm.match(/\b(\d{2,3})\b/);
      if (m2) add(Number(fixNumericToken(m2[1])), line, '라벨 근접 심박', 32);
    }
  }
  return dedupeCandidates(out);
}

function collectCalorieCandidates(lines, labelIndexes, context) {
  const out = [];
  const add = (value, line, reason, base = 40) => {
    if (!value || value < 30 || value > 5000) return;
    let score = base + labelProximityScore(line.idx, labelIndexes.calories);
    if (/kcal|calorie|칼로리/.test(line.norm)) score += 7;
    if (context.roi) score += 3;
    out.push({ value: Math.round(value), score, reason, line: line.raw });
  };

  for (const line of lines) {
    const m1 = line.norm.match(/\b(\d{2,4})\s*kcal\b/);
    if (m1) add(Number(fixNumericToken(m1[1])), line, 'kcal 패턴');
    if (/calorie|칼로리/.test(line.norm)) {
      const m2 = line.norm.match(/\b(\d{2,4})\b/);
      if (m2) add(Number(fixNumericToken(m2[1])), line, '라벨 근접 칼로리', 30);
    }
  }
  return dedupeCandidates(out);
}

function chooseBestCombination(candidates) {
  const distanceList = candidates.distance.length ? candidates.distance : [{ value: null, score: -10 }];
  const durationList = candidates.duration.length ? candidates.duration : [{ value: null, score: -10 }];
  const paceList = candidates.pace.length ? candidates.pace : [{ value: null, score: -8 }];

  let best = {
    totalScore: -Infinity,
    values: { distance: null, duration: null, pace: null, avgHr: null, calories: null },
    reasons: []
  };

  for (const d of distanceList.slice(0, 5)) {
    for (const t of durationList.slice(0, 5)) {
      for (const paceCandidate of paceList.slice(0, 5)) {
        let chosenPace = paceCandidate;
        let score = d.score + t.score + paceCandidate.score;
        const reasons = [`거리:${d.value ?? '-'}(${Math.round(d.score)})`, `시간:${t.value ?? '-'}(${Math.round(t.score)})`, `페이스:${paceCandidate.value ?? '-'}(${Math.round(paceCandidate.score)})`];
        let calcPace = null;
        if (d.value && t.value) {
          calcPace = durationToSec(t.value) / d.value;
          if (calcPace >= 180 && calcPace <= 750) score += 20;
        }
        if (chosenPace.value && calcPace) {
          const delta = Math.abs(paceToSec(chosenPace.value) - calcPace);
          score += Math.max(-20, 32 - delta / 2);
          reasons.push(`페이스 일관성 보정 Δ${Math.round(delta)}초`);
        } else if (calcPace) {
          chosenPace = { ...chosenPace, value: secToPace(calcPace).replace(' /km', '') };
          score += 8;
          reasons.push('계산 페이스 보완');
        }

        const hrBest = candidates.avgHr[0] || { value: null, score: 0 };
        const calBest = candidates.calories[0] || { value: null, score: 0 };
        score += hrBest.score + calBest.score;

        if (score > best.totalScore) {
          best = {
            totalScore: score,
            values: {
              distance: d.value,
              duration: t.value,
              pace: chosenPace.value,
              avgHr: hrBest.value,
              calories: calBest.value
            },
            reasons
          };
        }
      }
    }
  }
  return best;
}

function dedupeCandidates(list) {
  const map = new Map();
  for (const c of list) {
    const key = String(c.value);
    if (!map.has(key) || map.get(key).score < c.score) map.set(key, c);
  }
  return [...map.values()].sort((a, b) => b.score - a.score);
}

function similarity(a, b) {
  const dist = levenshtein(a, b);
  return 1 - dist / Math.max(a.length, b.length, 1);
}

function levenshtein(a = '', b = '') {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[a.length][b.length];
}

function normalizeDuration(v) {
  const parts = v.split(':').map((p) => p.padStart(2, '0'));
  if (parts.length === 2) return `${parts[0]}:${parts[1]}`;
  return `${parts[0]}:${parts[1]}:${parts[2]}`;
}

function paceToSec(v) {
  if (!v) return 0;
  const [m, s] = v.split(':').map(Number);
  return m * 60 + s;
}

function insertCorrectionTemplate() {
  const tpl = `거리 __ km\n총 시간 __\n평균 페이스 __ /km\n평균 심박 __ bpm\n총 칼로리 __ kcal`;
  els.ocrText.value = `${els.ocrText.value.trim()}\n\n${tpl}`.trim();
}

function renderCandidateSelectors(parsed) {
  const fields = [
    { key: 'distance', label: '거리 후보 (km)', format: (v) => v },
    { key: 'duration', label: '시간 후보', format: (v) => v },
    { key: 'pace', label: '페이스 후보', format: (v) => `${v} /km` },
    { key: 'avgHr', label: '평균 심박 후보', format: (v) => `${v} bpm` },
    { key: 'calories', label: '칼로리 후보', format: (v) => `${v} kcal` }
  ];

  els.candidatePanel.innerHTML = '';
  for (const f of fields) {
    const list = parsed.candidates[f.key] || [];
    if (!list.length) continue;
    const wrapper = document.createElement('label');
    wrapper.textContent = f.label;
    const select = document.createElement('select');
    list.slice(0, 6).forEach((c, idx) => {
      const op = document.createElement('option');
      op.value = c.value;
      op.textContent = `${f.format(c.value)} (점수 ${Math.round(c.score)})`;
      if (idx === 0) op.selected = true;
      select.appendChild(op);
    });
    select.addEventListener('change', () => applyCandidateChoice(f.key, select.value));
    wrapper.appendChild(select);
    els.candidatePanel.appendChild(wrapper);
  }
}

function applyCandidateChoice(field, value) {
  if (field === 'distance') els.distance.value = value;
  if (field === 'duration') els.duration.value = value;
  if (field === 'avgHr') els.avgHr.value = value;
  if (field === 'calories') els.calories.value = value;
}

function renderDebugCandidates(parsed) {
  if (!els.debugToggle.checked) return;
  const sections = Object.entries(parsed.candidates).map(([k, list]) => {
    const rows = list.slice(0, 5).map((c) => `<li>${c.value} · ${Math.round(c.score)}점 · ${escapeHtml(c.reason || '')} · ${escapeHtml(c.line || '')}</li>`).join('');
    return `<h4>${k}</h4><ol>${rows || '<li>후보 없음</li>'}</ol>`;
  }).join('');
  els.debugCandidates.innerHTML = `<div><strong>선택 이유</strong><div>${parsed.reasons.join(' / ')}</div></div>${sections}`;
}


function maskTopNoiseStrip(canvas, ratio = 0.18) {
  const copy = document.createElement('canvas');
  copy.width = canvas.width;
  copy.height = canvas.height;
  const ctx = copy.getContext('2d');
  ctx.drawImage(canvas, 0, 0);
  const h = Math.max(24, Math.floor(copy.height * ratio));
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, copy.width, h);
  return copy;
}

}

function normalizeLine(line = '') {
  let t = line.toLowerCase().trim();
  t = t.replace(/(k\s*[.,]?\s*m)/g, 'km');
  t = t.replace(/(b\s*[.,]?\s*p\s*[.,]?\s*m)/g, 'bpm');
  t = t.replace(/(k\s*[.,]?\s*c\s*[.,]?\s*a\s*[.,]?\s*l)/g, 'kcal');
  t = t.replace(/\/\s*k\s*m/g, '/km');
  t = t.replace(/(\d),(\d)/g, '$1.$2');
  t = t.replace(/[|]/g, '1');
  return t;
}

function fixNumericToken(token, allowDecimal = false) {
  const map = { o: '0', O: '0', l: '1', I: '1', s: '5', S: '5', b: '6', B: '8' };
  const chars = token.split('').map((c) => map[c] ?? c);
  const keep = allowDecimal ? /[0-9.]/ : /[0-9]/;
  return chars.filter((c) => keep.test(c)).join('');
}

function detectLabelIndexes(lines) {
  const dictionary = {
    distance: ['거리', 'dist', 'distance'],
    duration: ['총 시간', 'duration', 'time', '시간'],
    pace: ['평균 페이스', 'pace'],
    avgHr: ['평균 심박', '심박수', 'hr', 'heart'],
    calories: ['총 칼로리', '칼로리', 'kcal', 'calories']
  };
  const out = {};
  for (const [field, words] of Object.entries(dictionary)) {
    out[field] = [];
    for (const line of lines) {
      const score = Math.max(...words.map(w => similarity(line.norm, w)));
      if (score >= 0.62) out[field].push({ idx: line.idx, score });
    }
  }
  return out;
}

function labelProximityScore(lineIdx, labels) {
  if (!labels?.length) return 0;
  const distance = Math.min(...labels.map(l => Math.abs(l.idx - lineIdx)));
  const closeness = Math.max(0, 1 - distance / 4);
  const labelStrength = Math.max(...labels.map(l => l.score));
  return closeness * 30 + labelStrength * 20;
}

function collectDistanceCandidates(lines, labelIndexes, context) {
  const out = [];
  const add = (value, line, reason, base = 40) => {
    if (!value || value < 0.5 || value > 60) return;
    let score = base + labelProximityScore(line.idx, labelIndexes.distance);
    score += context.roi ? 8 : 0;
    if (line.idx / Math.max(1, lines.length) < 0.2) score -= 8;
    out.push({ value: Number(value.toFixed(2)), score, reason, line: line.raw });
  };

  for (const line of lines) {
    const kmMatch = line.norm.match(/(\d{1,3}(?:\.\d{1,3})?)\s*km\b/);
    if (kmMatch) add(Number(kmMatch[1]), line, 'km 패턴');

    const rawNums = line.norm.match(/\b\d{3,4}\b/g) || [];
    for (const raw of rawNums) {
      if (!/dist|거리|km/.test(line.norm)) continue;
      const decimal = Number(`${raw.slice(0, raw.length - 2)}.${raw.slice(-2)}`);
      add(decimal, line, '소수점 복원', 30);
    }
  }
  return dedupeCandidates(out);
}

function collectDurationCandidates(lines, labelIndexes, context) {
  const out = [];
  const add = (value, line, reason, base = 45) => {
    if (!value) return;
    let score = base + labelProximityScore(line.idx, labelIndexes.duration);
    const sec = durationToSec(value);
    if (sec < 120 || sec > 8 * 3600) score -= 35;
    const isTop = line.idx / Math.max(1, lines.length) < 0.2;
    if (/^(2[0-3]|1\d):[0-5]\d$/.test(value) && !/duration|총 시간|time|시간/.test(line.norm)) score -= 60;
    if (isTop) score -= 15;
    if (context.roiSource === 'full_fallback') score -= 4;
    out.push({ value, score, reason, line: line.raw, sec });
  };

  for (const line of lines) {
    const matches = line.norm.match(/\b(\d{1,2}:\d{2}(?::\d{2})?)\b/g) || [];
    for (const m of matches) add(normalizeDuration(m), line, '시간 패턴');
  }
  return dedupeCandidates(out);
}

function collectPaceCandidates(lines, labelIndexes, context) {
  const out = [];
  const add = (value, line, reason, base = 46) => {
    if (!value) return;
    const sec = paceToSec(value);
    if (sec < 180 || sec > 750) return;
    let score = base + labelProximityScore(line.idx, labelIndexes.pace);
    if (/\/km|pace|페이스/.test(line.norm)) score += 8;
    if (context.roi) score += 4;
    out.push({ value, score, reason, line: line.raw, sec });
  };

  for (const line of lines) {
    const p1 = line.norm.match(/(\d{1,2})[:'"`](\d{2})\s*\/\s*km/);
    if (p1) add(`${Number(p1[1])}:${p1[2]}`, line, '페이스 단위 패턴');
    const p2 = line.norm.match(/\b(\d{1,2}:\d{2})\b/);
    if (p2 && /pace|페이스|\/km/.test(line.norm)) add(p2[1], line, '페이스 근접 패턴', 38);
  }
  return dedupeCandidates(out);
}

function collectHrCandidates(lines, labelIndexes, context) {
  const out = [];
  const add = (value, line, reason, base = 40) => {
    if (!value || value < 60 || value > 220) return;
    let score = base + labelProximityScore(line.idx, labelIndexes.avgHr);
    if (/bpm|hr|heart|심박/.test(line.norm)) score += 8;
    if (context.roi) score += 3;
    out.push({ value: Math.round(value), score, reason, line: line.raw });
  };

  for (const line of lines) {
    const m1 = line.norm.match(/\b(\d{2,3})\s*bpm\b/);
    if (m1) add(Number(m1[1]), line, 'bpm 패턴');
    if (/hr|heart|심박/.test(line.norm)) {
      const m2 = line.norm.match(/\b(\d{2,3})\b/);
      if (m2) add(Number(fixNumericToken(m2[1])), line, '라벨 근접 심박', 32);
    }
  }
  return dedupeCandidates(out);
}

function collectCalorieCandidates(lines, labelIndexes, context) {
  const out = [];
  const add = (value, line, reason, base = 40) => {
    if (!value || value < 30 || value > 5000) return;
    let score = base + labelProximityScore(line.idx, labelIndexes.calories);
    if (/kcal|calorie|칼로리/.test(line.norm)) score += 7;
    if (context.roi) score += 3;
    out.push({ value: Math.round(value), score, reason, line: line.raw });
  };

  for (const line of lines) {
    const m1 = line.norm.match(/\b(\d{2,4})\s*kcal\b/);
    if (m1) add(Number(fixNumericToken(m1[1])), line, 'kcal 패턴');
    if (/calorie|칼로리/.test(line.norm)) {
      const m2 = line.norm.match(/\b(\d{2,4})\b/);
      if (m2) add(Number(fixNumericToken(m2[1])), line, '라벨 근접 칼로리', 30);
    }
  }
  return dedupeCandidates(out);
}

function chooseBestCombination(candidates) {
  const distanceList = candidates.distance.length ? candidates.distance : [{ value: null, score: -10 }];
  const durationList = candidates.duration.length ? candidates.duration : [{ value: null, score: -10 }];
  const paceList = candidates.pace.length ? candidates.pace : [{ value: null, score: -8 }];

  let best = {
    totalScore: -Infinity,
    values: { distance: null, duration: null, pace: null, avgHr: null, calories: null },
    reasons: []
  };

  for (const d of distanceList.slice(0, 5)) {
    for (const t of durationList.slice(0, 5)) {
      for (const paceCandidate of paceList.slice(0, 5)) {
        let chosenPace = paceCandidate;
        let score = d.score + t.score + paceCandidate.score;
        const reasons = [`거리:${d.value ?? '-'}(${Math.round(d.score)})`, `시간:${t.value ?? '-'}(${Math.round(t.score)})`, `페이스:${paceCandidate.value ?? '-'}(${Math.round(paceCandidate.score)})`];
        let calcPace = null;
        if (d.value && t.value) {
          calcPace = durationToSec(t.value) / d.value;
          if (calcPace >= 180 && calcPace <= 750) score += 20;
        }
        if (chosenPace.value && calcPace) {
          const delta = Math.abs(paceToSec(chosenPace.value) - calcPace);
          score += Math.max(0, 25 - delta / 3);
          reasons.push(`페이스 일관성 보정 Δ${Math.round(delta)}초`);
        } else if (calcPace) {
          chosenPace = { ...chosenPace, value: secToPace(calcPace).replace(' /km', '') };
          score += 8;
          reasons.push('계산 페이스 보완');
        }

        const hrBest = candidates.avgHr[0] || { value: null, score: 0 };
        const calBest = candidates.calories[0] || { value: null, score: 0 };
        score += hrBest.score + calBest.score;

        if (score > best.totalScore) {
          best = {
            totalScore: score,
            values: {
              distance: d.value,
              duration: t.value,
              pace: chosenPace.value,
              avgHr: hrBest.value,
              calories: calBest.value
            },
            reasons
          };
        }
      }
    }
  }
  return best;
}

function dedupeCandidates(list) {
  const map = new Map();
  for (const c of list) {
    const key = String(c.value);
    if (!map.has(key) || map.get(key).score < c.score) map.set(key, c);
  }
  return [...map.values()].sort((a, b) => b.score - a.score);
}

function similarity(a, b) {
  const dist = levenshtein(a, b);
  return 1 - dist / Math.max(a.length, b.length, 1);
}

function levenshtein(a = '', b = '') {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[a.length][b.length];
}

function normalizeDuration(v) {
  const parts = v.split(':').map((p) => p.padStart(2, '0'));
  if (parts.length === 2) return `${parts[0]}:${parts[1]}`;
  return `${parts[0]}:${parts[1]}:${parts[2]}`;
}

function paceToSec(v) {
  if (!v) return 0;
  const [m, s] = v.split(':').map(Number);
  return m * 60 + s;
}

function insertCorrectionTemplate() {
  const tpl = `거리 __ km\n총 시간 __\n평균 페이스 __ /km\n평균 심박 __ bpm\n총 칼로리 __ kcal`;
  els.ocrText.value = `${els.ocrText.value.trim()}\n\n${tpl}`.trim();
}

function renderCandidateSelectors(parsed) {
  const fields = [
    { key: 'distance', label: '거리 후보 (km)', format: (v) => v },
    { key: 'duration', label: '시간 후보', format: (v) => v },
    { key: 'pace', label: '페이스 후보', format: (v) => `${v} /km` },
    { key: 'avgHr', label: '평균 심박 후보', format: (v) => `${v} bpm` },
    { key: 'calories', label: '칼로리 후보', format: (v) => `${v} kcal` }
  ];

  els.candidatePanel.innerHTML = '';
  for (const f of fields) {
    const list = parsed.candidates[f.key] || [];
    if (!list.length) continue;
    const wrapper = document.createElement('label');
    wrapper.textContent = f.label;
    const select = document.createElement('select');
    list.slice(0, 6).forEach((c, idx) => {
      const op = document.createElement('option');
      op.value = c.value;
      op.textContent = `${f.format(c.value)} (점수 ${Math.round(c.score)})`;
      if (idx === 0) op.selected = true;
      select.appendChild(op);
    });
    select.addEventListener('change', () => applyCandidateChoice(f.key, select.value));
    wrapper.appendChild(select);
    els.candidatePanel.appendChild(wrapper);
  }
}

function applyCandidateChoice(field, value) {
  if (field === 'distance') els.distance.value = value;
  if (field === 'duration') els.duration.value = value;
  if (field === 'avgHr') els.avgHr.value = value;
  if (field === 'calories') els.calories.value = value;
}

function renderDebugCandidates(parsed) {
  if (!els.debugToggle.checked) return;
  const sections = Object.entries(parsed.candidates).map(([k, list]) => {
    const rows = list.slice(0, 5).map((c) => `<li>${c.value} · ${Math.round(c.score)}점 · ${escapeHtml(c.reason || '')} · ${escapeHtml(c.line || '')}</li>`).join('');
    return `<h4>${k}</h4><ol>${rows || '<li>후보 없음</li>'}</ol>`;
  }).join('');
  els.debugCandidates.innerHTML = `<div><strong>선택 이유</strong><div>${parsed.reasons.join(' / ')}</div></div>${sections}`;
}

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

function resizeImageToCanvas(img, targetLongEdge) {
  const longEdge = Math.max(img.width, img.height);
  const ratio = targetLongEdge / longEdge;
  const scale = clamp(ratio, 0.65, 2.4);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function buildFallbackVersions(canvas) {
  return [
    { name: '원본 리사이즈', canvas, psmSet: [6, 11] },
    { name: '원본 스파스', canvas, psmSet: [11, 4] },
    { name: '원본 컬럼', canvas, psmSet: [4, 6] },
    { name: '원본 폴백', canvas, psmSet: [6] }
  ];
}

function buildPreprocessedVersions(baseCanvas) {
  const versions = [{ name: '원본 리사이즈', canvas: baseCanvas, psmSet: [6, 11] }];
  const src = cv.imread(baseCanvas);
  const gray = new cv.Mat();
  cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

  const clahe = new cv.CLAHE(2.5, new cv.Size(8, 8));
  const contrast = new cv.Mat();
  clahe.apply(gray, contrast);

  const bilateral = new cv.Mat();
  cv.bilateralFilter(contrast, bilateral, 7, 50, 50, cv.BORDER_DEFAULT);

  const adaptive = new cv.Mat();
  cv.adaptiveThreshold(bilateral, adaptive, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, 31, 10);
  versions.push({ name: '대비강화+이진화(라이트)', canvas: matToCanvas(adaptive), psmSet: [6, 4] });

  const inverted = new cv.Mat();
  cv.bitwise_not(adaptive, inverted);
  versions.push({ name: '대비강화+이진화(다크반전)', canvas: matToCanvas(inverted), psmSet: [11, 6] });

  const closed = new cv.Mat();
  const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(2, 2));
  cv.morphologyEx(adaptive, closed, cv.MORPH_CLOSE, kernel);
  const opened = new cv.Mat();
  cv.morphologyEx(closed, opened, cv.MORPH_OPEN, kernel);
  versions.push({ name: '노이즈제거+이진화+클로징', canvas: matToCanvas(opened), psmSet: [6, 11] });

  src.delete(); gray.delete(); contrast.delete(); bilateral.delete(); adaptive.delete(); inverted.delete(); closed.delete(); opened.delete(); kernel.delete();
  return versions;
}

function detectRois(canvas) {
  const src = cv.imread(canvas);
  const gray = new cv.Mat();
  const edges = new cv.Mat();
  cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
  cv.Canny(gray, edges, 70, 180);

  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  cv.findContours(edges, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

  const candidates = [];
  const imgArea = canvas.width * canvas.height;
  for (let i = 0; i < contours.size(); i++) {
    const cnt = contours.get(i);
    const rect = cv.boundingRect(cnt);
    const area = rect.width * rect.height;
    const yRatio = rect.y / canvas.height;
    if (area < imgArea * 0.06) continue;
    if (rect.width < canvas.width * 0.45) continue;
    if (yRatio < OCR_CONFIG.topTabRatio) continue;
    if (rect.y + rect.height < canvas.height * 0.42) continue;
    let score = area / imgArea * 100;
    if (rect.y > canvas.height * OCR_CONFIG.lowerRoiStart) score += 20;
    candidates.push({ x: rect.x, y: rect.y, width: rect.width, height: rect.height, score });
    cnt.delete();
  }

  contours.delete(); hierarchy.delete(); gray.delete(); edges.delete(); src.delete();

  const lowerRoi = defaultLowerRoi(canvas);
  const merged = [...candidates, lowerRoi].sort((a, b) => b.score - a.score).slice(0, 3);
  return merged;
}

function defaultLowerRoi(canvas) {
  const y = Math.floor(canvas.height * 0.45);
  return { x: 0, y, width: canvas.width, height: canvas.height - y, score: 15 };
}

function cropCanvas(canvas, roi) {
  const c = document.createElement('canvas');
  c.width = roi.width;
  c.height = roi.height;
  c.getContext('2d').drawImage(canvas, roi.x, roi.y, roi.width, roi.height, 0, 0, roi.width, roi.height);
  return c;
}

function matToCanvas(mat) {
  const dst = new cv.Mat();
  if (mat.channels() === 1) cv.cvtColor(mat, dst, cv.COLOR_GRAY2RGBA);
  else cv.cvtColor(mat, dst, cv.COLOR_RGB2RGBA);
  const canvas = document.createElement('canvas');
  canvas.width = dst.cols;
  canvas.height = dst.rows;
  cv.imshow(canvas, dst);
  dst.delete();
  return canvas;
}

function renderRoiDebug(baseCanvas, rois) {
  const canvas = els.roiCanvas;
  const ctx = canvas.getContext('2d');
  canvas.width = baseCanvas.width;
  canvas.height = baseCanvas.height;
  ctx.drawImage(baseCanvas, 0, 0);
  ctx.strokeStyle = '#facc15';
  ctx.lineWidth = 3;
  rois.forEach((r, idx) => {
    ctx.strokeRect(r.x, r.y, r.width, r.height);
    ctx.fillStyle = '#facc15';
    ctx.fillText(`#${idx + 1} ${Math.round(r.score)}`, r.x + 6, r.y + 18);
  });
}

function renderPipelineThumbs(versions) {
  els.pipelineThumbs.innerHTML = '';
  versions.forEach((v) => {
    const card = document.createElement('div');
    card.className = 'thumb-card';
    const img = document.createElement('img');
    img.src = v.canvas.toDataURL('image/png');
    card.innerHTML = `<div>${v.name}</div>`;
    card.appendChild(img);
    els.pipelineThumbs.appendChild(card);
  });
}

function runParserSelfTest() {
  const results = SAMPLE_OCR_TEXTS.map((txt) => parseOCRText(txt, { roiSource: 'self_test' }));
  const ok = results.every((r) => r.values.distance && r.values.duration);
  if (!ok) {
    console.warn('OCR parser self test failed', results);
  }
}

function saveEntry(e) {
  e.preventDefault();
  const entry = {
    id: editingId || crypto.randomUUID(),
    date: els.date.value,
    distance: Number(els.distance.value) || 0,
    durationSec: durationToSec(els.duration.value),
    avgHr: toNullableNumber(els.avgHr.value),
    calories: toNullableNumber(els.calories.value),
    memo: els.memo.value.trim(),
    manualType: els.trainingType.value || null,
  };
  if (!entry.date || !entry.distance || !entry.durationSec) {
    return showMsg('날짜/거리/시간은 필수입니다.', true);
  }

  const computed = computeEntryDerived(entry, data.entries.filter(en => en.id !== entry.id));
  Object.assign(entry, computed);

  if (editingId) {
    data.entries = data.entries.map(en => en.id === entry.id ? entry : en);
    editingId = null;
  } else {
    data.entries.push(entry);
  }
  recalculateAllEntries();
  persist('기록 저장 완료');
  els.entryForm.reset();
  els.date.value = toDateInputValue(new Date());
  renderAll();
}

function recalculateAllEntries() {
  const sorted = [...data.entries].sort((a, b) => a.date.localeCompare(b.date));
  const fresh = [];
  for (const e of sorted) {
    const recomputed = computeEntryDerived(e, fresh);
    fresh.push({ ...e, ...recomputed });
  }
  data.entries = fresh;
  data.totalExp = Math.round(fresh.reduce((s, e) => s + (e.exp || 0), 0));
  data.stats = computeStats(fresh, data.plan);
}

function computeEntryDerived(entry, priorEntries) {
  const pace = secToPace(entry.durationSec / entry.distance);
  const autoType = classifyTraining(entry, priorEntries);
  const type = entry.manualType || autoType;
  const exp = calculateExp(entry, type, priorEntries);
  return { pace, trainingType: type, exp };
}

function classifyTraining(entry, priorEntries) {
  const memo = (entry.memo || '').toLowerCase();
  const keywordInterval = /(인터벌|반복|스프린트|interval|repeat|sprint)/i.test(memo);
  const recent30 = getRecentEntries(priorEntries, 30, entry.date);
  const avgHr = average(recent30.map(e => e.avgHr).filter(Boolean));
  if (entry.avgHr && avgHr) {
    const diff = entry.avgHr - avgHr;
    if (diff <= -15) return '회복/존1';
    if (diff >= -10 && diff <= 10) return '존2';
    if (diff > 10 && diff <= 20) return '템포';
    if (diff > 20 || keywordInterval) return '인터벌';
  }

  const avgPaceSec = average(recent30.map(e => e.durationSec / e.distance));
  const currentPace = entry.durationSec / entry.distance;
  if (keywordInterval) return '인터벌';
  if (avgPaceSec) {
    const ratio = currentPace / avgPaceSec;
    if (ratio > 1.15) return '회복/존1';
    if (ratio >= 0.95 && ratio <= 1.08) return '존2';
    if (ratio < 0.95 && ratio >= 0.85) return '템포';
    if (ratio < 0.85) return '인터벌';
  }
  return '존2';
}

function calculateExp(entry, type, priorEntries) {
  const base = entry.distance * 10;
  const typeBonusMap = { '회복/존1': 0, '존2': 0.2, '템포': 0.4, '인터벌': 0.6 };
  let bonus = typeBonusMap[type] ?? 0;
  if (entry.distance >= 15) bonus += 0.2;

  const recent30 = getRecentEntries(priorEntries, 30, entry.date);
  const avgPaceSec = average(recent30.map(e => e.durationSec / e.distance));
  const curPaceSec = entry.durationSec / entry.distance;
  if (avgPaceSec && curPaceSec < avgPaceSec) {
    const improvementRatio = Math.min((avgPaceSec - curPaceSec) / avgPaceSec, 0.2);
    bonus += improvementRatio;
  }

  const prevDayEntry = findEntryByDate(priorEntries, shiftDate(entry.date, -1));
  if (!prevDayEntry) bonus += 0.1;

  const prev2 = findEntryByDate(priorEntries, shiftDate(entry.date, -1));
  if (prev2 && isHard(type) && isHard(prev2.trainingType)) bonus -= 0.2;

  const recent3 = getRecentEntries(priorEntries, 3, entry.date);
  const hardCount = recent3.filter(e => isHard(e.trainingType)).length;
  if (isHard(type) && hardCount >= 2) bonus -= 0.15;

  bonus = Math.max(Math.min(bonus, 1), -0.8);
  return Math.round(base * (1 + bonus));
}

function computeStats(entries, plan) {
  const recent30 = getRecentEntries(entries, 30);
  let endurance = 0, speed = 0, recovery = 0;
  for (const e of recent30) {
    if (e.trainingType === '존2') { endurance += 2; }
    if (e.distance >= 15) { endurance += 2; }
    if (e.trainingType === '템포') { speed += 2; endurance += 1; }
    if (e.trainingType === '인터벌') { speed += 3; recovery -= 0.6; }
    if (e.trainingType === '회복/존1') { recovery += 2; }
  }

  const last7 = getRecentEntries(entries, 7);
  const freq7 = Math.min(last7.length / 6, 1);
  const freq30 = Math.min(recent30.length / 24, 1);
  const planDoneRatio = plan.length ? plan.filter(p => p.done).length / plan.length : 0;
  const consistency = 100 * (0.45 * freq7 + 0.45 * freq30 + 0.1 * planDoneRatio);

  return {
    endurance: clamp(endurance * 2.5, 0, 100),
    speed: clamp(speed * 2.8, 0, 100),
    recovery: clamp(50 + recovery * 2, 0, 100),
    consistency: clamp(consistency, 0, 100)
  };
}

function generateMonthlyPlan(baseDate = new Date()) {
  const year = baseDate.getFullYear();
  const month = baseDate.getMonth();
  const days = new Date(year, month + 1, 0).getDate();
  const templates = [
    '존2 40~60분', '존2 50분 + 스트라이드', '템포 20분 포함', '인터벌 800m x 5',
    '회복런 30분', '롱런 90분(존2)', '휴식/스트레칭'
  ];
  const plan = [];
  for (let d = 1; d <= days; d++) {
    const dt = new Date(year, month, d);
    const dow = dt.getDay();
    const type = [1,2,3,4,6].includes(dow) ? templates[d % 6] : templates[6];
    plan.push({ id: `${year}-${month+1}-${d}`, date: toDateInputValue(dt), text: type, done: false, linkedEntryId: null });
  }
  return plan;
}


function ensureTrainingPlan() {
  if (data.trainingPlan?.weeks?.length) {
    fillTrainingPlanInputs(data.trainingPlan.settings);
    return;
  }
  const monthEntries = data.entries.filter(e => isCurrentMonth(e.date));
  const currentKm = Number(sum(monthEntries.map(e => e.distance)).toFixed(1)) || 80;
  const targetKm = Number((currentKm * 1.08).toFixed(1));
  data.trainingPlan = buildMileagePlan({ currentMonthKm: currentKm, targetMonthKm: targetKm, increaseRate: 7, cutbackEvery: 3 });
  fillTrainingPlanInputs(data.trainingPlan.settings);
}

function fillTrainingPlanInputs(settings) {
  if (!settings) return;
  if (els.currentMonthKm) els.currentMonthKm.value = settings.currentMonthKm;
  if (els.targetMonthKm) els.targetMonthKm.value = settings.targetMonthKm;
  if (els.weeklyIncreaseRate) els.weeklyIncreaseRate.value = settings.increaseRate;
  if (els.cutbackEvery) els.cutbackEvery.value = settings.cutbackEvery;
}

function generateAutoMileagePlanFromInput() {
  const currentMonthKm = Number(els.currentMonthKm?.value);
  const targetMonthKm = Number(els.targetMonthKm?.value);
  const increaseRate = Number(els.weeklyIncreaseRate?.value || 7);
  const cutbackEvery = Number(els.cutbackEvery?.value || 3);
  if (!currentMonthKm || !targetMonthKm || targetMonthKm < currentMonthKm * 0.9) {
    return showMsg('현재/목표 월 거리 값을 확인하세요. 목표는 현재 대비 지나치게 낮을 수 없습니다.', true);
  }
  data.trainingPlan = buildMileagePlan({ currentMonthKm, targetMonthKm, increaseRate, cutbackEvery });
  persist('목표 월 마일리지 계획을 생성했습니다.');
  renderPlan();
}

function buildMileagePlan({ currentMonthKm, targetMonthKm, increaseRate, cutbackEvery }) {
  const today = new Date();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  const weekStarts = [];
  for (let d = new Date(monthStart); d <= monthEnd; d.setDate(d.getDate() + 7)) weekStarts.push(new Date(d));
  const weekCount = weekStarts.length;

  let weekly = currentMonthKm / weekCount;
  const targetWeeklyAvg = targetMonthKm / weekCount;
  const weeks = [];
  for (let i = 0; i < weekCount; i++) {
    const weekNo = i + 1;
    const isCutback = weekNo > 1 && weekNo % cutbackEvery === 0;
    if (isCutback) weekly *= 0.82;
    else if (weekNo > 1) weekly *= (1 + increaseRate / 100);
    weekly = Math.min(weekly, targetWeeklyAvg * 1.25);
    weeks.push({
      weekNo,
      startDate: toDateInputValue(weekStarts[i]),
      endDate: toDateInputValue(new Date(weekStarts[i].getFullYear(), weekStarts[i].getMonth(), weekStarts[i].getDate() + 6)),
      targetKm: Number(weekly.toFixed(1)),
      isCutback
    });
  }

  const scale = targetMonthKm / Math.max(1, sum(weeks.map(w => w.targetKm)));
  weeks.forEach((w) => {
    w.targetKm = Number((w.targetKm * scale).toFixed(1));
    w.structure = createWeeklyStructure(w.targetKm, w.isCutback);
  });

  return {
    settings: { currentMonthKm, targetMonthKm, increaseRate, cutbackEvery },
    weeks,
    updatedAt: new Date().toISOString()
  };
}

function createWeeklyStructure(weeklyKm, isCutback) {
  const highIntensity = Number((weeklyKm * 0.18).toFixed(1));
  const longRun = Number(Math.min(weeklyKm * 0.30, weeklyKm * (isCutback ? 0.24 : 0.28)).toFixed(1));
  const recovery = Number((weeklyKm * 0.12).toFixed(1));
  const zone2 = Number(Math.max(weeklyKm - highIntensity - longRun - recovery, 0).toFixed(1));
  return {
    zone2,
    highIntensity,
    longRun,
    recovery,
    text: `존2 ${zone2}km · 고강도 ${highIntensity}km · 롱런 ${longRun}km · 회복 ${recovery}km`
  };
}

function calculateWeeklyActualKm(startDate, endDate) {
  return Number(sum(data.entries
    .filter((e) => e.date >= startDate && e.date <= endDate)
    .map((e) => e.distance)).toFixed(1));
}


function renderAll() {
  recalculateAllEntries();
  renderSummary();
  renderEntries();
  renderStats();
  renderPlan();
}

function renderSummary() {
  const monthEntries = data.entries.filter(e => isCurrentMonth(e.date));
  const dist = sum(monthEntries.map(e => e.distance));
  const dur = sum(monthEntries.map(e => e.durationSec));
  const avgPace = dist ? secToPace(dur / dist) : '-';
  const recent30 = getRecentEntries(data.entries, 30);
  const avg30PaceSec = average(recent30.map(e => e.durationSec / e.distance));
  const avg30Hr = average(recent30.map(e => e.avgHr).filter(Boolean));

  els.sumDistance.textContent = `${dist.toFixed(2)} km`;
  els.sumDuration.textContent = secToHms(dur);
  els.sumPace.textContent = avgPace;
  els.sumCount.textContent = `${monthEntries.length}회`;
  const level = getLevelInfo(data.totalExp);
  els.sumLevel.textContent = `Lv.${level.level}`;
  els.sumExp.textContent = `${data.totalExp}`;
  els.sum30Pace.textContent = avg30PaceSec ? secToPace(avg30PaceSec) : '-';
  els.sum30Hr.textContent = avg30Hr ? `${Math.round(avg30Hr)} bpm` : '-';
  els.levelProgress.max = level.currentLevelNeed;
  els.levelProgress.value = level.inLevelExp;
  els.levelRemaining.textContent = `다음 레벨까지 ${level.remaining} EXP`;
}

function renderEntries() {
  const entries = sortedEntries([...data.entries], els.sortSelect.value);
  els.entryTableBody.innerHTML = '';
  for (const e of entries) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${e.date}</td>
      <td>${e.distance.toFixed(2)} km</td>
      <td>${secToHms(e.durationSec)}</td>
      <td>${e.pace}</td>
      <td>${e.avgHr || '-'}</td>
      <td>${e.trainingType}</td>
      <td>${e.exp}</td>
      <td>${escapeHtml(e.memo || '')}</td>
      <td class="manage-btns">
        <button type="button" data-act="edit" data-id="${e.id}">수정</button>
        <button type="button" data-act="delete" data-id="${e.id}">삭제</button>
      </td>
    `;
    els.entryTableBody.appendChild(tr);
  }
  els.entryTableBody.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => handleEntryAction(btn.dataset.act, btn.dataset.id));
  });
}

function handleEntryAction(act, id) {
  const target = data.entries.find(e => e.id === id);
  if (!target) return;
  if (act === 'delete') {
    if (confirm('기록을 삭제할까요?')) {
      data.entries = data.entries.filter(e => e.id !== id);
      for (const p of data.plan) if (p.linkedEntryId === id) { p.linkedEntryId = null; p.done = false; }
      persist('기록 삭제됨');
      renderAll();
    }
  }
  if (act === 'edit') {
    editingId = id;
    els.date.value = target.date;
    els.distance.value = target.distance;
    els.duration.value = secToHms(target.durationSec);
    els.avgHr.value = target.avgHr ?? '';
    els.calories.value = target.calories ?? '';
    els.memo.value = target.memo || '';
    els.trainingType.value = target.manualType || '';
    showMsg('수정 모드입니다. 저장 버튼을 누르면 업데이트됩니다.');
  }
}

function renderStats() {
  const s = data.stats;
  const card = (k, label) => {
    const val = Math.round(s[k] || 0);
    const lv = Math.max(1, Math.ceil(val / 10));
    return `<div class="stat-card"><strong>${label}</strong><div>${val}/100 (Lv.${lv})</div><progress max="100" value="${val}"></progress></div>`;
  };
  els.statsContainer.innerHTML = [
    card('endurance', '지구력 Endurance'),
    card('speed', '스피드 Speed'),
    card('recovery', '회복력 Recovery'),
    card('consistency', '일관성 Consistency')
  ].join('');
  els.buildSummary.textContent = buildSummaryText(data.stats);
}

function buildSummaryText(s) {
  const maxStat = Object.entries(s).sort((a, b) => b[1] - a[1])[0]?.[0];
  const recoveryLow = s.recovery < 35;
  let archetype = '균형형';
  if (maxStat === 'endurance') archetype = '지구력형';
  if (maxStat === 'speed') archetype = '스피드형';
  if (maxStat === 'consistency') archetype = '꾸준함형';
  return recoveryLow ? `${archetype} · 회복 부족 주의` : `${archetype} · 안정적 훈련 흐름`;
}

function renderPlan() {
  if (!data.trainingPlan) ensureTrainingPlan();
  fillTrainingPlanInputs(data.trainingPlan?.settings);

  const weeks = data.trainingPlan?.weeks || [];
  let totalTarget = 0;
  let totalActual = 0;
  if (els.weeklyPlanBody) els.weeklyPlanBody.innerHTML = '';

  weeks.forEach((w) => {
    const actualKm = calculateWeeklyActualKm(w.startDate, w.endDate);
    const progress = w.targetKm ? Math.min(160, (actualKm / w.targetKm) * 100) : 0;
    totalTarget += w.targetKm;
    totalActual += actualKm;

    if (els.weeklyPlanBody) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${w.weekNo}주${w.isCutback ? ' (컷백)' : ''}</td>
        <td>${w.startDate} ~ ${w.endDate}</td>
        <td>${w.targetKm.toFixed(1)} km</td>
        <td>${actualKm.toFixed(1)} km</td>
        <td>${progress.toFixed(0)}%
          <div class="progress-meter"><span style="width:${Math.min(progress, 100)}%"></span></div>
        </td>
        <td>
          <span class="plan-chip">존2 ${w.structure.zone2}</span>
          <span class="plan-chip hard">고강도 ${w.structure.highIntensity}</span>
          <span class="plan-chip">롱런 ${w.structure.longRun}</span>
          <span class="plan-chip">회복 ${w.structure.recovery}</span>
        </td>`;
      els.weeklyPlanBody.appendChild(tr);
    }
  });

  const monthProgress = totalTarget ? (totalActual / totalTarget) * 100 : 0;
  if (els.planProgress) {
    els.planProgress.innerHTML = `월간 목표 ${totalTarget.toFixed(1)}km / 실제 ${totalActual.toFixed(1)}km · 진행률 ${monthProgress.toFixed(1)}%`;
  }

  els.planList.innerHTML = '';
  weeks.forEach((w) => {
    const row = document.createElement('div');
    row.className = `plan-item ${w.isCutback ? 'done' : ''}`;
    row.innerHTML = `<div><strong>${w.weekNo}주차</strong> · ${w.structure.text}<div class="small">고강도 ≤ 20%, 롱런 ≤ 30%, 존2 중심</div></div>`;
    els.planList.appendChild(row);
  });
}

function exportJSON() {
  downloadFile(`running-rpg-${Date.now()}.json`, JSON.stringify(data, null, 2), 'application/json');
  showMsg('JSON 내보내기 완료');
}

function importJSON(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      if (!Array.isArray(parsed.entries)) throw new Error('entries 형식 오류');
      data = {
        ...structuredClone(defaultData),
        ...parsed,
        plan: Array.isArray(parsed.plan) ? parsed.plan : generateMonthlyPlan(),
        trainingPlan: parsed.trainingPlan || null
      };
      ensureTrainingPlan();
      persist('JSON 가져오기 완료');
      renderAll();
    } catch (err) {
      showMsg(`가져오기 실패: ${err.message}`, true);
    }
  };
  reader.readAsText(file);
}

function exportCSV() {
  const header = ['date','distance_km','duration_sec','pace','avg_hr','training_type','exp','calories','memo'];
  const rows = data.entries.map(e => [e.date, e.distance, e.durationSec, e.pace, e.avgHr ?? '', e.trainingType, e.exp, e.calories ?? '', '"' + (e.memo || '').replaceAll('"', '""') + '"']);
  const csv = [header.join(','), ...rows.map(r => r.join(','))].join('\n');
  downloadFile(`running-rpg-${Date.now()}.csv`, csv, 'text/csv;charset=utf-8');
  showMsg('CSV 내보내기 완료');
}

function sortedEntries(entries, key) {
  if (key === 'date') return entries.sort((a,b) => a.date.localeCompare(b.date));
  if (key === 'distance') return entries.sort((a,b) => b.distance - a.distance);
  if (key === 'pace') return entries.sort((a,b) => a.durationSec/a.distance - b.durationSec/b.distance);
  if (key === 'exp') return entries.sort((a,b) => b.exp - a.exp);
  return entries.sort((a,b) => b.date.localeCompare(a.date));
}

function getLevelInfo(totalExp) {
  let level = 1;
  let need = getNeedExp(level);
  let remain = totalExp;
  while (remain >= need) {
    remain -= need;
    level += 1;
    need = getNeedExp(level);
  }
  return { level, inLevelExp: remain, currentLevelNeed: need, remaining: need - remain };
}

function getNeedExp(level) {
  if (level === 1) return 500;
  return Math.round(500 + (level - 1) * 180 + (level - 1) ** 1.35 * 45);
}

function getRecentEntries(entries, days, beforeDate = toDateInputValue(new Date())) {
  const end = new Date(beforeDate + 'T00:00:00');
  const start = new Date(end);
  start.setDate(start.getDate() - days);
  return entries.filter(e => {
    const d = new Date(e.date + 'T00:00:00');
    return d >= start && d < end;
  });
}

function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(defaultData);
    const parsed = JSON.parse(raw);
    return { ...structuredClone(defaultData), ...parsed };
  } catch {
    return structuredClone(defaultData);
  }
}

function persist(msg) {
  data.updatedAt = new Date().toISOString();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  if (msg) showMsg(msg);
}

function showMsg(msg, isError = false) {
  els.globalMessage.textContent = msg;
  els.globalMessage.style.color = isError ? '#f87171' : '#94a3b8';
}

function byId(id) { return document.getElementById(id); }
function toNullableNumber(v) { const n = Number(v); return Number.isFinite(n) && v !== '' ? n : null; }
function durationToSec(s) {
  if (!s) return 0;
  const parts = s.split(':').map(Number);
  if (parts.some(Number.isNaN)) return 0;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return 0;
}
function secToHms(sec) {
  sec = Math.round(sec || 0);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}
function secToPace(secPerKm) {
  if (!secPerKm || !Number.isFinite(secPerKm)) return '-';
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${String(s).padStart(2,'0')} /km`;
}
function toDateInputValue(d) { return d.toISOString().slice(0,10); }
function isCurrentMonth(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth();
}
function sum(arr) { return arr.reduce((a,b) => a + (b || 0), 0); }
function average(arr) { return arr.length ? sum(arr) / arr.length : null; }
function clamp(v,min,max) { return Math.max(min, Math.min(max, v)); }
function shiftDate(dateStr, days) { const d = new Date(dateStr + 'T00:00:00'); d.setDate(d.getDate()+days); return toDateInputValue(d); }
function findEntryByDate(entries, dateStr) { return entries.find(e => e.date === dateStr); }
function isHard(type) { return type === '템포' || type === '인터벌'; }
function escapeHtml(str) { return str.replace(/[&<>'"]/g, (ch) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])); }
function downloadFile(name, content, type) {
  const blob = new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  URL.revokeObjectURL(a.href);
  a.remove();
}
