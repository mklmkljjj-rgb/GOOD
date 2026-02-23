const STORAGE_KEY = 'running_rpg_data_v1';
const defaultData = {
  entries: [],
  stats: { endurance: 0, speed: 0, recovery: 0, consistency: 0 },
  plan: [],
  totalExp: 0,
  updatedAt: new Date().toISOString()
};

let data = loadData();
let editingId = null;

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
  planList: byId('planList'), regenPlanBtn: byId('regenPlanBtn'),
  exportJsonBtn: byId('exportJsonBtn'), importJsonInput: byId('importJsonInput'), exportCsvBtn: byId('exportCsvBtn'), resetStorageBtn: byId('resetStorageBtn'),
  globalMessage: byId('globalMessage')
};

init();

function init() {
  if (!data.plan.length) data.plan = generateMonthlyPlan();
  bindEvents();
  renderAll();
  els.date.value = toDateInputValue(new Date());
}

function bindEvents() {
  els.runOcrBtn.addEventListener('click', handleOcr);
  els.reparseBtn.addEventListener('click', () => parseToForm(els.ocrText.value));
  els.entryForm.addEventListener('submit', saveEntry);
  els.sortSelect.addEventListener('change', renderEntries);
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

async function handleOcr() {
  const file = els.imageInput.files?.[0];
  if (!file) return showMsg('이미지를 먼저 선택하세요.', true);
  if (!window.Tesseract) return showMsg('Tesseract 로딩 실패: 로컬 서버로 실행을 시도하세요.', true);

  els.ocrStatus.textContent = 'OCR 실행 중...';
  els.ocrProgress.value = 0;
  try {
    const { data: ocr } = await Tesseract.recognize(file, 'eng+kor', {
      logger: (m) => {
        if (m.status === 'recognizing text') {
          els.ocrProgress.value = Math.round((m.progress || 0) * 100);
          els.ocrStatus.textContent = `OCR 진행률 ${els.ocrProgress.value}%`;
        }
      }
    });
    els.ocrText.value = ocr.text || '';
    els.ocrStatus.textContent = 'OCR 완료';
    parseToForm(ocr.text || '');
  } catch (e) {
    els.ocrStatus.textContent = 'OCR 실패';
    showMsg(`OCR 실패: ${e.message}. 파일을 선명하게 크롭해 재시도하세요.`, true);
  }
}

function parseToForm(text) {
  const parsed = parseOCRText(text);
  const warn = [];
  els.distance.value = parsed.distance ?? '';
  els.duration.value = parsed.duration ?? '';
  els.avgHr.value = parsed.avgHr ?? '';
  els.calories.value = parsed.calories ?? '';
  if (!parsed.distance) warn.push('거리 추출 실패');
  if (!parsed.duration) warn.push('시간 추출 실패');
  if (!parsed.pace && !(parsed.distance && parsed.duration)) warn.push('페이스 추출/계산 실패');
  if (!parsed.avgHr) warn.push('평균심박 추출 실패');
  if (!parsed.calories) warn.push('칼로리 추출 실패');
  els.parseWarnings.innerHTML = warn.map(w => `<div>⚠️ ${w}</div>`).join('');
  showMsg('OCR 파싱 결과를 폼에 반영했습니다.');
}

function parseOCRText(text) {
  const normalized = text.replace(/,/g, '.');
  const distance = matchNumber(normalized, /(\d+(?:\.\d+)?)\s*km/i);
  const duration = matchDuration(normalized);
  const pace = matchPace(normalized);
  const avgHr = matchNumber(normalized, /(?:avg\s*hr|average\s*heart\s*rate|심박|평균\s*심박)[^\d]{0,10}(\d{2,3})|\b(\d{2,3})\s*bpm/i);
  const calories = matchNumber(normalized, /(\d{2,5})\s*kcal/i);
  return { distance, duration, pace, avgHr, calories };
}

function matchDuration(text) {
  const m = text.match(/\b((?:\d{1,2}:)?\d{1,2}:\d{2})\b/);
  return m ? m[1] : null;
}

function matchPace(text) {
  const p1 = text.match(/(\d{1,2})[:'](\d{2})\s*(?:"|”)?\s*\/?\s*km/i);
  if (p1) return `${p1[1]}:${p1[2]}`;
  const p2 = text.match(/(\d{1,2}:\d{2})\s*\/?\s*km/i);
  return p2 ? p2[1] : null;
}

function matchNumber(text, regex) {
  const m = text.match(regex);
  if (!m) return null;
  const candidate = m.slice(1).find(Boolean);
  return candidate ? Number(candidate) : null;
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
  els.buildSummary.textContent = buildSummaryText(s);
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
  els.planList.innerHTML = '';
  const mapByDate = Object.fromEntries(data.entries.map(e => [e.date, e.id]));
  data.plan.forEach(p => {
    if (mapByDate[p.date]) { p.done = true; p.linkedEntryId = mapByDate[p.date]; }
    const row = document.createElement('div');
    row.className = `plan-item ${p.done ? 'done' : ''}`;
    row.innerHTML = `<div><strong>${p.date}</strong> · ${p.text}<div class="small">${p.linkedEntryId ? '기록과 연결됨' : '미연결'}</div></div>`;
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = p.done;
    cb.addEventListener('change', () => {
      p.done = cb.checked;
      persist('계획 완료 체크 업데이트');
      renderStats();
      renderPlan();
    });
    row.appendChild(cb);
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
        plan: Array.isArray(parsed.plan) ? parsed.plan : generateMonthlyPlan()
      };
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
