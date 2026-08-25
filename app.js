const NEIS_BASE_URL = "https://open.neis.go.kr/hub";
const SCHOOL = {
  officeCode: "J10",
  schoolCode: "7530894",
  name: "시흥능곡고등학교",
};

const state = {
  selectedDate: startOfDay(new Date()),
  grade: localStorage.getItem("ng-grade") || "1",
  classNumber: localStorage.getItem("ng-class") || "5",
  apiKey: localStorage.getItem("ng-neis-key") || "",
  controller: null,
  loading: false,
};

const elements = {
  gradeSelect: document.querySelector("#gradeSelect"),
  classSelect: document.querySelector("#classSelect"),
  classHeading: document.querySelector("#classHeading"),
  termChip: document.querySelector("#termChip"),
  selectedDateLabel: document.querySelector("#selectedDateLabel"),
  todayMark: document.querySelector("#todayMark"),
  dateButton: document.querySelector("#dateButton"),
  dateInput: document.querySelector("#dateInput"),
  previousDay: document.querySelector("#previousDay"),
  nextDay: document.querySelector("#nextDay"),
  weekStrip: document.querySelector("#weekStrip"),
  timetableDate: document.querySelector("#timetableDate"),
  mealDate: document.querySelector("#mealDate"),
  timetableList: document.querySelector("#timetableList"),
  timetableSkeleton: document.querySelector("#timetableSkeleton"),
  timetableEmpty: document.querySelector("#timetableEmpty"),
  timetableError: document.querySelector("#timetableError"),
  periodCount: document.querySelector("#periodCount"),
  partialNotice: document.querySelector("#partialNotice"),
  mealSkeleton: document.querySelector("#mealSkeleton"),
  mealContent: document.querySelector("#mealContent"),
  mealEmpty: document.querySelector("#mealEmpty"),
  mealError: document.querySelector("#mealError"),
  calorieChip: document.querySelector("#calorieChip"),
  updateLine: document.querySelector("#updateLine"),
  refreshButton: document.querySelector("#refreshButton"),
  liveBadge: document.querySelector("#liveBadge"),
  liveBadgeText: document.querySelector("#liveBadge b"),
  settingsDialog: document.querySelector("#settingsDialog"),
  settingsForm: document.querySelector("#settingsForm"),
  settingsButton: document.querySelector("#settingsButton"),
  openKeySettings: document.querySelector("#openKeySettings"),
  apiKeyInput: document.querySelector("#apiKeyInput"),
  clearKeyButton: document.querySelector("#clearKeyButton"),
  toast: document.querySelector("#toast"),
};

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date, amount) {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return startOfDay(next);
}

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

function toInputDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toNeisDate(date) {
  return toInputDate(date).replaceAll("-", "");
}

function getAcademicTerm(date) {
  const month = date.getMonth() + 1;
  if (month <= 2) {
    return { year: date.getFullYear() - 1, semester: 2 };
  }
  return { year: date.getFullYear(), semester: month <= 7 ? 1 : 2 };
}

function formatDisplayDate(date, includeWeekday = true) {
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    ...(includeWeekday ? { weekday: "short" } : {}),
  }).format(date);
}

function getWeekDates(date) {
  const day = date.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = addDays(date, mondayOffset);
  return Array.from({ length: 7 }, (_, index) => addDays(monday, index));
}

function populateClasses() {
  elements.classSelect.replaceChildren();
  for (let number = 1; number <= 10; number += 1) {
    const option = document.createElement("option");
    option.value = String(number);
    option.textContent = `${number}반`;
    elements.classSelect.append(option);
  }
}

function updateControls() {
  const today = startOfDay(new Date());
  const term = getAcademicTerm(state.selectedDate);
  elements.gradeSelect.value = state.grade;
  elements.classSelect.value = state.classNumber;
  elements.classHeading.textContent = `${state.grade}학년 ${state.classNumber}반`;
  elements.termChip.textContent = `${term.year} · ${term.semester}학기`;
  elements.selectedDateLabel.textContent = formatDisplayDate(state.selectedDate);
  elements.dateInput.value = toInputDate(state.selectedDate);
  elements.todayMark.classList.toggle("hidden", !sameDay(state.selectedDate, today));
  elements.timetableDate.textContent = formatDisplayDate(state.selectedDate);
  elements.mealDate.textContent = formatDisplayDate(state.selectedDate);
  renderWeekStrip();
}

function renderWeekStrip() {
  const weekdays = ["월", "화", "수", "목", "금", "토", "일"];
  const today = startOfDay(new Date());
  elements.weekStrip.replaceChildren();

  getWeekDates(state.selectedDate).forEach((date, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "week-day";
    if (index >= 5) button.classList.add("weekend");
    if (sameDay(date, today)) button.classList.add("today");
    if (sameDay(date, state.selectedDate)) button.classList.add("selected");
    button.setAttribute("aria-label", formatDisplayDate(date));
    button.innerHTML = `<span>${weekdays[index]}</span><strong>${date.getDate()}</strong>`;
    button.addEventListener("click", () => setSelectedDate(date));
    elements.weekStrip.append(button);
  });
}

function getDataset(payload, datasetName) {
  if (payload?.RESULT?.CODE === "INFO-200") {
    return { rows: [], total: 0 };
  }

  const dataset = payload?.[datasetName];
  if (!Array.isArray(dataset)) {
    const message = payload?.RESULT?.MESSAGE || "NEIS 응답 형식을 확인할 수 없습니다.";
    throw new Error(message);
  }

  const head = dataset[0]?.head || [];
  const total = Number(head.find((item) => "list_total_count" in item)?.list_total_count || 0);
  const result = head.find((item) => item.RESULT)?.RESULT;
  if (result && result.CODE !== "INFO-000") {
    throw new Error(result.MESSAGE || "NEIS 조회에 실패했습니다.");
  }

  return { rows: dataset[1]?.row || [], total };
}

async function fetchNeis(endpoint, params, signal) {
  const query = new URLSearchParams({
    Type: "json",
    pIndex: "1",
    pSize: state.apiKey ? "100" : "5",
    ATPT_OFCDC_SC_CODE: SCHOOL.officeCode,
    SD_SCHUL_CODE: SCHOOL.schoolCode,
    ...params,
  });

  if (state.apiKey) query.set("KEY", state.apiKey);
  const response = await fetch(`${NEIS_BASE_URL}/${endpoint}?${query}`, {
    signal,
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
}

async function loadTimetable(signal) {
  const term = getAcademicTerm(state.selectedDate);
  const payload = await fetchNeis("hisTimetable", {
    AY: String(term.year),
    SEM: String(term.semester),
    GRADE: state.grade,
    CLASS_NM: state.classNumber,
    ALL_TI_YMD: toNeisDate(state.selectedDate),
  }, signal);
  return getDataset(payload, "hisTimetable");
}

async function loadMeals(signal) {
  const payload = await fetchNeis("mealServiceDietInfo", {
    MLSV_YMD: toNeisDate(state.selectedDate),
  }, signal);
  return getDataset(payload, "mealServiceDietInfo");
}

function setLoading() {
  state.loading = true;
  elements.refreshButton.classList.add("refreshing");
  elements.timetableSkeleton.classList.remove("hidden");
  elements.mealSkeleton.classList.remove("hidden");
  elements.timetableList.classList.add("hidden");
  elements.mealContent.classList.add("hidden");
  elements.timetableEmpty.classList.add("hidden");
  elements.mealEmpty.classList.add("hidden");
  elements.timetableError.classList.add("hidden");
  elements.mealError.classList.add("hidden");
  elements.partialNotice.classList.add("hidden");
  elements.periodCount.textContent = "조회 중";
  elements.calorieChip.textContent = "조회 중";
  elements.updateLine.textContent = "NEIS에서 최신 데이터를 불러오는 중입니다.";
}

function finishLoading() {
  state.loading = false;
  elements.refreshButton.classList.remove("refreshing");
  elements.liveBadge.classList.remove("offline");
  elements.liveBadgeText.textContent = "NEIS";
  const time = new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit" }).format(new Date());
  elements.updateLine.textContent = `${time} 기준으로 새로 불러왔습니다.`;
}

function renderTimetable({ rows, total }) {
  elements.timetableSkeleton.classList.add("hidden");
  elements.timetableList.replaceChildren();
  elements.timetableList.classList.remove("hidden");

  if (!rows.length) {
    elements.timetableList.classList.add("hidden");
    elements.timetableEmpty.classList.remove("hidden");
    elements.periodCount.textContent = "수업 없음";
    return;
  }

  const sortedRows = [...rows].sort((a, b) => Number(a.PERIO) - Number(b.PERIO));
  sortedRows.forEach((row) => {
    const item = document.createElement("li");
    item.className = "period-row";
    const number = document.createElement("span");
    number.className = "period-number";
    number.textContent = row.PERIO;
    const subject = document.createElement("span");
    subject.className = "period-subject";
    subject.textContent = row.ITRT_CNTNT || "수업";
    const label = document.createElement("span");
    label.className = "period-label";
    label.textContent = `${row.PERIO}교시`;
    item.append(number, subject, label);
    elements.timetableList.append(item);
  });

  elements.periodCount.textContent = `${total || rows.length}교시`;
  elements.partialNotice.classList.toggle("hidden", total <= rows.length);
}

function splitHtmlLines(value) {
  return String(value || "")
    .split(/<br\s*\/?\s*>/i)
    .map((item) => item.replace(/&amp;/g, "&").trim())
    .filter(Boolean);
}

function parseDish(value) {
  const allergens = value.match(/\(([\d.]+)\)\s*$/)?.[1] || "";
  const name = value.replace(/\s*\([\d.]+\)\s*$/, "").trim();
  return { name, allergens };
}

function renderMeals({ rows }) {
  elements.mealSkeleton.classList.add("hidden");
  elements.mealContent.replaceChildren();

  if (!rows.length) {
    elements.mealEmpty.classList.remove("hidden");
    elements.calorieChip.textContent = "급식 없음";
    return;
  }

  elements.mealContent.classList.remove("hidden");
  elements.calorieChip.textContent = rows[0].CAL_INFO || "식단";

  rows.forEach((meal) => {
    const block = document.createElement("article");
    block.className = "meal-block";

    const meta = document.createElement("div");
    meta.className = "meal-meta";
    const type = document.createElement("span");
    type.className = "meal-type";
    type.textContent = meal.MMEAL_SC_NM || "급식";
    const kcal = document.createElement("span");
    kcal.className = "meal-kcal";
    kcal.textContent = meal.CAL_INFO || "";
    meta.append(type, kcal);

    const list = document.createElement("ul");
    list.className = "dish-list";
    const allergyNotes = [];
    splitHtmlLines(meal.DDISH_NM).forEach((rawDish) => {
      const dish = parseDish(rawDish);
      const item = document.createElement("li");
      item.className = "dish-item";
      item.textContent = dish.name;
      list.append(item);
      if (dish.allergens) allergyNotes.push(`${dish.name} (${dish.allergens})`);
    });

    const details = document.createElement("details");
    details.className = "meal-details";
    const summary = document.createElement("summary");
    summary.textContent = "알레르기·영양 정보";
    const copy = document.createElement("p");
    copy.className = "detail-copy";
    const nutrition = splitHtmlLines(meal.NTR_INFO).join(" · ");
    copy.textContent = `${allergyNotes.join(" · ")}${nutrition ? `\n${nutrition}` : ""}`;
    details.append(summary, copy);

    block.append(meta, list, details);
    elements.mealContent.append(block);
  });
}

function renderTimetableError() {
  elements.timetableSkeleton.classList.add("hidden");
  elements.timetableList.classList.add("hidden");
  elements.timetableError.classList.remove("hidden");
  elements.periodCount.textContent = "오류";
}

function renderMealError() {
  elements.mealSkeleton.classList.add("hidden");
  elements.mealContent.classList.add("hidden");
  elements.mealError.classList.remove("hidden");
  elements.calorieChip.textContent = "오류";
}

async function refreshData() {
  if (state.controller) state.controller.abort();
  state.controller = new AbortController();
  const activeController = state.controller;
  setLoading();

  const [timetableResult, mealResult] = await Promise.allSettled([
    loadTimetable(activeController.signal),
    loadMeals(activeController.signal),
  ]);

  if (activeController.signal.aborted) return;

  if (timetableResult.status === "fulfilled") {
    renderTimetable(timetableResult.value);
  } else {
    console.error(timetableResult.reason);
    renderTimetableError();
  }

  if (mealResult.status === "fulfilled") {
    renderMeals(mealResult.value);
  } else {
    console.error(mealResult.reason);
    renderMealError();
  }

  if (timetableResult.status === "rejected" && mealResult.status === "rejected") {
    elements.liveBadge.classList.add("offline");
    elements.liveBadgeText.textContent = "연결 오류";
    elements.updateLine.textContent = "NEIS 연결에 실패했습니다.";
    state.loading = false;
    elements.refreshButton.classList.remove("refreshing");
    return;
  }

  finishLoading();
}

function setSelectedDate(date) {
  state.selectedDate = startOfDay(date);
  updateControls();
  refreshData();
}

let toastTimer;
function showToast(message) {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add("show");
  toastTimer = setTimeout(() => elements.toast.classList.remove("show"), 2200);
}

function openSettings() {
  elements.apiKeyInput.value = state.apiKey;
  elements.settingsDialog.showModal();
}

function bindEvents() {
  elements.gradeSelect.addEventListener("change", () => {
    state.grade = elements.gradeSelect.value;
    localStorage.setItem("ng-grade", state.grade);
    updateControls();
    refreshData();
  });

  elements.classSelect.addEventListener("change", () => {
    state.classNumber = elements.classSelect.value;
    localStorage.setItem("ng-class", state.classNumber);
    updateControls();
    refreshData();
  });

  elements.previousDay.addEventListener("click", () => setSelectedDate(addDays(state.selectedDate, -1)));
  elements.nextDay.addEventListener("click", () => setSelectedDate(addDays(state.selectedDate, 1)));
  elements.dateButton.addEventListener("click", () => {
    if (typeof elements.dateInput.showPicker === "function") {
      elements.dateInput.showPicker();
    } else {
      elements.dateInput.click();
    }
  });
  elements.dateInput.addEventListener("change", () => {
    if (!elements.dateInput.value) return;
    const [year, month, day] = elements.dateInput.value.split("-").map(Number);
    setSelectedDate(new Date(year, month - 1, day));
  });

  elements.refreshButton.addEventListener("click", () => {
    if (!state.loading) refreshData();
  });

  document.querySelectorAll("[data-retry]").forEach((button) => {
    button.addEventListener("click", refreshData);
  });

  document.querySelectorAll(".section-tab").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".section-tab").forEach((tab) => tab.classList.toggle("active", tab === button));
      document.querySelector(`#${button.dataset.target}`).scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });

  elements.settingsButton.addEventListener("click", openSettings);
  elements.openKeySettings.addEventListener("click", openSettings);

  elements.settingsForm.addEventListener("submit", (event) => {
    event.preventDefault();
    state.apiKey = elements.apiKeyInput.value.trim();
    if (state.apiKey) {
      localStorage.setItem("ng-neis-key", state.apiKey);
      showToast("인증키를 저장했습니다.");
    } else {
      localStorage.removeItem("ng-neis-key");
      showToast("샘플 조회 모드로 설정했습니다.");
    }
    elements.settingsDialog.close();
    refreshData();
  });

  elements.clearKeyButton.addEventListener("click", () => {
    state.apiKey = "";
    elements.apiKeyInput.value = "";
    localStorage.removeItem("ng-neis-key");
    elements.settingsDialog.close();
    showToast("저장된 인증키를 삭제했습니다.");
    refreshData();
  });

  elements.settingsDialog.addEventListener("click", (event) => {
    if (event.target === elements.settingsDialog) elements.settingsDialog.close();
  });
}

populateClasses();
updateControls();
bindEvents();
refreshData();
