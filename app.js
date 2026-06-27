const STORAGE_KEY = "mleczny-plan-state-v1";
const MINUTES_PER_DAY = 24 * 60;
const WEEK_DAYS = 7;
const QUARTER_DAYS = 90;
const TIMER_SLOT_COUNT = 2;
const PLAN_REMINDER_TAG = "mleczny-plan-pobranie";
const TIMER_REMINDER_TAG = "mleczny-plan-minutnik";

const defaultState = {
  schedule: [
    { id: "p1", minutes: 30 },
    { id: "p2", minutes: 240 },
    { id: "p3", minutes: 450 },
    { id: "p4", minutes: 660 },
    { id: "p5", minutes: 870 },
    { id: "p6", minutes: 1080 },
    { id: "p7", minutes: 1290 },
  ],
  timers: [
    { id: "timer-15", minutes: 15 },
    { id: "timer-10", minutes: 10 },
    { id: "timer-7", minutes: 7 },
    { id: "timer-5", minutes: 5 },
    { id: "timer-3", minutes: 3 },
  ],
  activeTimer: null,
  lastTimerId: null,
  lastTimerSlot: 1,
  lastTimerStartedAt: null,
  completedTimerIds: [],
  statsRange: "week",
  logs: [],
};

const dom = {};
let state = loadState();
let appTicker = null;
let pickupReminderTimer = null;
let audioContext = null;
let wakeLock = null;
let activeTimelineDrag = null;

document.addEventListener("DOMContentLoaded", () => {
  cacheDom();
  bindEvents();
  registerServiceWorker();
  initializeInputs();
  renderAll();
  initializeView();
  startTicker();
});

function cacheDom() {
  Object.assign(dom, {
    todayLabel: document.querySelector("#todayLabel"),
    notificationButton: document.querySelector("#notificationButton"),
    views: document.querySelectorAll(".view"),
    tabButtons: document.querySelectorAll(".tab-button"),
    nextPickupPill: document.querySelector("#nextPickupPill"),
    nextPickupTime: document.querySelector("#nextPickupTime"),
    nextPickupCountdown: document.querySelector("#nextPickupCountdown"),
    scheduleList: document.querySelector("#scheduleList"),
    addPickupButton: document.querySelector("#addPickupButton"),
    evenPlanButton: document.querySelector("#evenPlanButton"),
    sessionStatePill: document.querySelector("#sessionStatePill"),
    timerName: document.querySelector("#timerName"),
    timerCountdown: document.querySelector("#timerCountdown"),
    timerHint: document.querySelector("#timerHint"),
    timerProgressBar: document.querySelector("#timerProgressBar"),
    timerList: document.querySelector("#timerList"),
    resetTimersButton: document.querySelector("#resetTimersButton"),
    completedTimersSummary: document.querySelector("#completedTimersSummary"),
    timerForm: document.querySelector("#timerForm"),
    timerMinutesInput: document.querySelector("#timerMinutesInput"),
    startPauseButton: document.querySelector("#startPauseButton"),
    stopSessionButton: document.querySelector("#stopSessionButton"),
    todayTotalPill: document.querySelector("#todayTotalPill"),
    metricToday: document.querySelector("#metricToday"),
    metricPeriodLabel: document.querySelector("#metricPeriodLabel"),
    metricWeek: document.querySelector("#metricWeek"),
    metricAverageLabel: document.querySelector("#metricAverageLabel"),
    metricAverage: document.querySelector("#metricAverage"),
    metricTotalAll: document.querySelector("#metricTotalAll"),
    metricTotalEntries: document.querySelector("#metricTotalEntries"),
    metricEntryCount: document.querySelector("#metricEntryCount"),
    metricEntryAverage: document.querySelector("#metricEntryAverage"),
    metricMaxEntry: document.querySelector("#metricMaxEntry"),
    metricMaxEntryDate: document.querySelector("#metricMaxEntryDate"),
    metricBestDay: document.querySelector("#metricBestDay"),
    metricBestDayDate: document.querySelector("#metricBestDayDate"),
    metricLastEntry: document.querySelector("#metricLastEntry"),
    metricLastEntryDate: document.querySelector("#metricLastEntryDate"),
    metricTrendLabel: document.querySelector("#metricTrendLabel"),
    metricTrend: document.querySelector("#metricTrend"),
    metricTrendDetail: document.querySelector("#metricTrendDetail"),
    rangeButtons: document.querySelectorAll("[data-stats-range]"),
    chartTitle: document.querySelector("#chartTitle"),
    chartSubtitle: document.querySelector("#chartSubtitle"),
    chartPeakPill: document.querySelector("#chartPeakPill"),
    chartScroller: document.querySelector("#chartScroller"),
    weekChart: document.querySelector("#weekChart"),
    logForm: document.querySelector("#logForm"),
    logDate: document.querySelector("#logDate"),
    logTime: document.querySelector("#logTime"),
    logMl: document.querySelector("#logMl"),
    historyList: document.querySelector("#historyList"),
  });
}

function bindEvents() {
  dom.tabButtons.forEach((button) => {
    button.addEventListener("click", () => setView(button.dataset.view));
  });

  dom.notificationButton.addEventListener("click", requestNotifications);
  dom.addPickupButton.addEventListener("click", addPickup);
  dom.evenPlanButton.addEventListener("click", distributeScheduleEvenly);

  dom.scheduleList.addEventListener("click", (event) => {
    const removeButton = event.target.closest("[data-remove-pickup]");
    if (!removeButton) return;
    removePickup(removeButton.dataset.id);
  });

  dom.scheduleList.addEventListener("pointerdown", startTimelineDrag);
  dom.scheduleList.addEventListener("keydown", handleTimelineKeydown);

  dom.startPauseButton.addEventListener("click", toggleTimer);
  dom.stopSessionButton.addEventListener("click", stopTimer);
  dom.resetTimersButton.addEventListener("click", resetCompletedTimers);

  dom.timerList.addEventListener("click", (event) => {
    const startButton = event.target.closest("[data-start-timer]");
    if (startButton) {
      startTimer(startButton.dataset.id, startButton.dataset.slot);
      return;
    }

    const deleteButton = event.target.closest("[data-delete-timer]");
    if (deleteButton) {
      deleteTimer(deleteButton.dataset.id);
    }
  });

  dom.timerList.addEventListener("change", (event) => {
    const minutesInput = event.target.closest("[data-timer-minutes]");
    if (minutesInput) {
      updateTimer(minutesInput.dataset.id, { minutes: minutesInput.value });
    }
  });

  dom.timerForm.addEventListener("submit", (event) => {
    event.preventDefault();
    addTimerFromForm();
  });

  dom.rangeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      state.statsRange = button.dataset.statsRange;
      saveState();
      renderStats();
    });
  });

  dom.logForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const timestamp = localDateTimeToTimestamp(dom.logDate.value, dom.logTime.value);
    const amount = Number(dom.logMl.value);
    if (!timestamp || !Number.isFinite(amount) || amount <= 0) return;
    addLog({ amount, timestamp });
    dom.logMl.value = "";
    setDefaultLogDateTime();
    renderStats();
  });

  dom.historyList.addEventListener("click", (event) => {
    const deleteButton = event.target.closest("[data-delete-log]");
    if (!deleteButton) return;
    state.logs = state.logs.filter((log) => log.id !== deleteButton.dataset.id);
    saveState();
    renderStats();
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      renderAll();
      scheduleNextPickupReminder();
    }
  });
}

function initializeInputs() {
  setDefaultLogDateTime();
}

function initializeView() {
  const initialView = new URLSearchParams(window.location.search).get("module");
  setView(isKnownView(initialView) ? initialView : "plan");
}

function renderAll() {
  renderHeader();
  renderNotificationState();
  renderPlan();
  renderSession();
  renderStats();
  scheduleNextPickupReminder();
}

function renderHeader() {
  dom.todayLabel.textContent = new Intl.DateTimeFormat("pl-PL", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date());
}

function setView(name) {
  const viewName = isKnownView(name) ? name : "plan";
  dom.views.forEach((view) => view.classList.toggle("is-active", view.id === `view-${viewName}`));
  dom.tabButtons.forEach((button) => button.classList.toggle("is-active", button.dataset.view === viewName));
  updateModuleParam(viewName);
}

function isKnownView(name) {
  return ["plan", "session", "stats"].includes(name);
}

function updateModuleParam(name) {
  const url = new URL(window.location.href);
  url.searchParams.set("module", name);
  window.history.replaceState(null, "", url);
}

function renderPlan() {
  const sorted = getSortedSchedule();
  const next = getNextPickup();
  dom.nextPickupTime.textContent = minutesToTime(next.minutes);
  dom.nextPickupPill.textContent = minutesToTime(next.minutes);
  dom.nextPickupCountdown.textContent = formatDuration(next.delta);

  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const tickHtml = [0, 360, 720, 1080, 1440]
    .map((minutes) => {
      const percent = timelinePercent(minutes);
      const label = minutes === 1440 ? "24:00" : minutesToTime(minutes);
      return `
        <div class="timeline-tick" style="top: ${percent}%">
          <span>${label}</span>
        </div>
      `;
    })
    .join("");
  const gapHtml = renderTimelineGaps(sorted);
  const markerHtml = sorted
    .map((item, index) => {
      const isNext = item.id === next.id;
      const percent = timelinePercent(item.minutes);
      return `
        <article class="timeline-marker${isNext ? " is-next" : ""}" style="top: ${percent}%">
          <button
            class="timeline-handle"
            data-timeline-handle
            data-id="${item.id}"
            type="button"
            aria-label="Pobranie ${index + 1}, ${minutesToTime(item.minutes)}"
          >
            <span></span>
          </button>
          <div class="timeline-card">
            <div>
              <strong>${minutesToTime(item.minutes)}</strong>
              <span>${isNext ? "następne" : `pobranie ${index + 1}`}</span>
            </div>
            <button class="icon-button remove-pickup" data-remove-pickup data-id="${item.id}" type="button" aria-label="Usuń pobranie" ${sorted.length <= 1 ? "disabled" : ""}>
              <svg><use href="#icon-minus"></use></svg>
            </button>
          </div>
        </article>
      `;
    })
    .join("");

  dom.scheduleList.innerHTML = `
    <section class="timeline-panel" aria-label="Plan pobrań na całą dobę">
      <div class="timeline-track" data-timeline-axis>
        <div class="timeline-rail" aria-hidden="true"></div>
        ${tickHtml}
        <div class="timeline-now" style="top: ${timelinePercent(nowMinutes)}%" aria-hidden="true">
          <span>teraz</span>
        </div>
        ${gapHtml}
        ${markerHtml}
      </div>
    </section>
  `;
}

function renderTimelineGaps(sorted) {
  if (!sorted.length) return "";
  if (sorted.length === 1) {
    return `
      <div class="timeline-gap" style="top: 50%">
        <span>Przerwa 24 h</span>
      </div>
    `;
  }

  return sorted
    .map((item, index) => {
      const nextItem = sorted[(index + 1) % sorted.length];
      const duration = formatDuration(intervalBetween(item.minutes, nextItem.minutes));
      const wraps = index === sorted.length - 1;
      const middle = wraps
        ? item.minutes + (MINUTES_PER_DAY - item.minutes) / 2
        : item.minutes + (nextItem.minutes - item.minutes) / 2;
      const label = wraps ? `do jutra ${duration}` : `Przerwa ${duration}`;
      return `
        <div class="timeline-gap${wraps ? " is-wrap" : ""}" style="top: ${timelinePercent(middle)}%">
          <span>${label}</span>
        </div>
      `;
    })
    .join("");
}

function startTimelineDrag(event) {
  const handle = event.target.closest("[data-timeline-handle]");
  if (!handle) return;
  const axis = handle.closest("[data-timeline-axis]");
  if (!axis) return;

  event.preventDefault();
  activeTimelineDrag = {
    id: handle.dataset.id,
    axis,
  };
  handle.setPointerCapture?.(event.pointerId);
  updatePickupFromPointer(event.clientY);
  window.addEventListener("pointermove", moveTimelineDrag);
  window.addEventListener("pointerup", stopTimelineDrag, { once: true });
  window.addEventListener("pointercancel", stopTimelineDrag, { once: true });
}

function moveTimelineDrag(event) {
  if (!activeTimelineDrag) return;
  event.preventDefault();
  updatePickupFromPointer(event.clientY);
}

function stopTimelineDrag() {
  if (!activeTimelineDrag) return;
  activeTimelineDrag = null;
  window.removeEventListener("pointermove", moveTimelineDrag);
  saveState();
  renderPlan();
  scheduleNextPickupReminder();
}

function updatePickupFromPointer(clientY) {
  if (!activeTimelineDrag) return;
  const rect = activeTimelineDrag.axis.getBoundingClientRect();
  const ratio = clamp((clientY - rect.top) / rect.height, 0, 1);
  updatePickupMinutes(activeTimelineDrag.id, roundToStep(ratio * (MINUTES_PER_DAY - 5), 5), { persist: false });
}

function handleTimelineKeydown(event) {
  const handle = event.target.closest("[data-timeline-handle]");
  if (!handle) return;

  const item = state.schedule.find((entry) => entry.id === handle.dataset.id);
  if (!item) return;

  const keySteps = {
    ArrowDown: 5,
    ArrowRight: 5,
    ArrowUp: -5,
    ArrowLeft: -5,
    PageDown: 30,
    PageUp: -30,
  };
  let nextMinutes = item.minutes;
  if (event.key in keySteps) {
    nextMinutes += keySteps[event.key];
  } else if (event.key === "Home") {
    nextMinutes = 0;
  } else if (event.key === "End") {
    nextMinutes = MINUTES_PER_DAY - 5;
  } else {
    return;
  }

  event.preventDefault();
  updatePickupMinutes(item.id, nextMinutes);
}

function updatePickupMinutes(id, minutes, options = {}) {
  const item = state.schedule.find((entry) => entry.id === id);
  if (!item) return;
  item.minutes = clamp(roundToStep(minutes, 5), 0, MINUTES_PER_DAY - 5);
  if (options.persist !== false) {
    saveState();
    scheduleNextPickupReminder();
  }
  renderPlan();
  if (activeTimelineDrag) {
    activeTimelineDrag.axis = dom.scheduleList.querySelector("[data-timeline-axis]") || activeTimelineDrag.axis;
  }
}

function addPickup() {
  if (state.schedule.length >= 12) return;
  const sorted = getSortedSchedule();
  const lastItem = sorted[sorted.length - 1];
  const last = lastItem?.minutes ?? 0;
  state.schedule.push({
    id: createId(),
    minutes: roundToStep((last + 180) % MINUTES_PER_DAY, 5),
  });
  saveState();
  renderPlan();
}

function removePickup(id) {
  if (state.schedule.length <= 1) return;
  state.schedule = state.schedule.filter((entry) => entry.id !== id);
  saveState();
  renderPlan();
  scheduleNextPickupReminder();
}

function distributeScheduleEvenly() {
  const sorted = getSortedSchedule();
  const count = sorted.length;
  const first = sorted[0]?.minutes ?? 0;
  const gap = MINUTES_PER_DAY / count;
  state.schedule = sorted.map((entry, index) => ({
    ...entry,
    minutes: roundToStep((first + gap * index) % MINUTES_PER_DAY, 5),
  }));
  saveState();
  renderPlan();
  scheduleNextPickupReminder();
}

function renderSession() {
  const timer = state.activeTimer;
  const info = getTimerInfo();

  if (info.finished && timer?.status === "running") {
    finishTimer();
    return;
  }

  dom.timerName.textContent = timer ? formatTimerDuration(timer.minutes || Math.round(timer.durationSeconds / 60)) : "Wybierz minutnik";
  dom.timerCountdown.textContent = secondsToClock(info.remainingSeconds);
  dom.timerHint.textContent = getTimerHint();
  dom.sessionStatePill.textContent = getTimerPillLabel();

  const iconId = timer?.status === "running" ? "icon-pause" : "icon-play";
  const buttonText = timer?.status === "running" ? "Pauza" : timer?.status === "paused" ? "Wznów" : "Start";
  dom.startPauseButton.innerHTML = `<svg><use href="#${iconId}"></use></svg>${buttonText}`;

  const progress = info.durationSeconds ? Math.min(100, (info.elapsedSeconds / info.durationSeconds) * 100) : 0;
  document.querySelector(".timer-ring")?.style.setProperty("--progress", `${progress}%`);
  dom.timerProgressBar.style.width = `${progress}%`;
  const focusedTimerInput = document.activeElement?.matches("[data-timer-minutes]");
  if (!focusedTimerInput) {
    renderTimerList();
  }
}

function renderTimerList() {
  const timers = getTimers();
  const completedIds = getCompletedTimerIds();
  const totalSlots = timers.length * TIMER_SLOT_COUNT;
  const completedCount = timers.reduce((count, timer) => {
    return count + getTimerSlots().filter((slot) => completedIds.has(getTimerSlotKey(timer.id, slot))).length;
  }, 0);
  dom.completedTimersSummary.textContent = `${completedCount}/${totalSlots} wykonanych`;
  dom.resetTimersButton.disabled = completedCount === 0;
  dom.timerList.innerHTML = timers
    .map((timer) => {
      const slots = getTimerSlots();
      const isActive = state.activeTimer?.timerId === timer.id && state.activeTimer.status !== "complete";
      const isLast = state.lastTimerId === timer.id;
      const isDone = slots.every((slot) => completedIds.has(getTimerSlotKey(timer.id, slot)));
      const slotButtons = slots
        .map((slot) => {
          const slotKey = getTimerSlotKey(timer.id, slot);
          const isSlotActive = isActive && normalizeTimerSlot(state.activeTimer?.slot) === slot;
          const isSlotDone = completedIds.has(slotKey);
          const isLastSlot = isLast && normalizeTimerSlot(state.lastTimerSlot) === slot;
          const slotLabel = formatTimerDuration(timer.minutes);
          const slotState = isSlotDone ? "wykonany" : `slot ${slot}`;
          return `
            <button class="timer-start${isSlotActive ? " is-active" : ""}${isSlotDone ? " is-done" : ""}" data-start-timer data-id="${timer.id}" data-slot="${slot}" type="button" aria-label="Uruchom ${slotLabel}, slot ${slot}">
              <svg><use href="#${isSlotDone ? "icon-check" : "icon-play"}"></use></svg>
              <span>
                <strong>${slotLabel}</strong>
                <small>${slotState}${isLastSlot ? " · ostatnio" : ""}</small>
              </span>
            </button>
          `;
        })
        .join("");
      return `
        <article class="timer-row${isActive ? " is-active" : ""}${isLast ? " is-last" : ""}${isDone ? " is-done" : ""}">
          <div class="timer-slots">
            ${slotButtons}
          </div>
          <label class="timer-edit timer-edit-minutes">
            <span>Min</span>
            <input data-timer-minutes data-id="${timer.id}" type="number" min="1" max="180" step="1" inputmode="numeric" value="${timer.minutes}">
          </label>
          <button class="icon-button remove-pickup" data-delete-timer data-id="${timer.id}" type="button" aria-label="Usuń minutnik" ${timers.length <= 1 ? "disabled" : ""}>
            <svg><use href="#icon-trash"></use></svg>
          </button>
        </article>
      `;
    })
    .join("");
}

function toggleTimer() {
  primeAudio();
  if (!state.activeTimer || state.activeTimer.status === "complete") {
    const timer = getLastTimer() || getTimers()[0];
    if (timer) startTimer(timer.id, state.lastTimerSlot || 1);
    return;
  }
  if (state.activeTimer.status === "running") {
    pauseTimer();
    return;
  }
  if (state.activeTimer.status === "paused") {
    resumeTimer();
  }
}

function startTimer(id, slotValue = 1) {
  const timer = getTimerById(id);
  if (!timer) return;
  const now = Date.now();
  const slot = normalizeTimerSlot(slotValue);
  const slotKey = getTimerSlotKey(timer.id, slot);
  markTimerCompleted(slotKey);
  state.activeTimer = {
    status: "running",
    timerId: timer.id,
    slot,
    slotKey,
    minutes: timer.minutes,
    label: formatTimerDuration(timer.minutes),
    durationSeconds: timer.minutes * 60,
    startedAt: now,
    pausedMs: 0,
    pauseStartedAt: null,
    completedAt: null,
  };
  state.lastTimerId = timer.id;
  state.lastTimerSlot = slot;
  state.lastTimerStartedAt = now;
  saveState();
  requestWakeLock();
  renderSession();
  playAlert();
}

function pauseTimer() {
  if (!state.activeTimer || state.activeTimer.status !== "running") return;
  state.activeTimer.status = "paused";
  state.activeTimer.pauseStartedAt = Date.now();
  saveState();
  releaseWakeLock();
  renderSession();
}

function resumeTimer() {
  if (!state.activeTimer || state.activeTimer.status !== "paused") return;
  state.activeTimer.pausedMs += Date.now() - state.activeTimer.pauseStartedAt;
  state.activeTimer.pauseStartedAt = null;
  state.activeTimer.status = "running";
  saveState();
  requestWakeLock();
  renderSession();
}

function stopTimer() {
  if (!state.activeTimer) return;
  state.activeTimer = null;
  saveState();
  releaseWakeLock();
  renderSession();
}

function finishTimer() {
  if (!state.activeTimer) return;
  state.activeTimer.status = "complete";
  state.activeTimer.completedAt = Date.now();
  saveState();
  releaseWakeLock();
  playAlert();
  showAppNotification("Minutnik zakończony", `${formatActiveTimerLabel(state.activeTimer)} dobiegł końca.`, TIMER_REMINDER_TAG);
  renderSession();
}

function getTimerPillLabel() {
  if (state.activeTimer?.status === "running") return "trwa";
  if (state.activeTimer?.status === "paused") return "pauza";
  if (state.activeTimer?.status === "complete") return "koniec";
  const last = getLastTimer();
  return last ? `ostatnio ${last.minutes} min` : "gotowe";
}

function getTimerHint() {
  const last = getLastTimer();
  if (!last || !state.lastTimerStartedAt) return "ostatnio: brak";
  return `ostatnio: ${formatTimerDuration(last.minutes)}, ${formatHistoryTime(new Date(state.lastTimerStartedAt))}`;
}

function getTimerInfo() {
  if (!state.activeTimer) {
    const last = getLastTimer();
    const durationSeconds = last ? last.minutes * 60 : 0;
    return {
      elapsedSeconds: 0,
      remainingSeconds: durationSeconds,
      durationSeconds,
      finished: false,
    };
  }

  const elapsedSeconds = Math.min(state.activeTimer.durationSeconds, Math.floor(getTimerElapsedMs() / 1000));
  const remainingSeconds = Math.max(0, state.activeTimer.durationSeconds - elapsedSeconds);

  return {
    elapsedSeconds,
    remainingSeconds,
    durationSeconds: state.activeTimer.durationSeconds,
    finished: remainingSeconds === 0,
  };
}

function getTimerElapsedMs() {
  if (!state.activeTimer) return 0;
  if (state.activeTimer.status === "complete") return state.activeTimer.durationSeconds * 1000;
  const end = state.activeTimer.status === "paused" ? state.activeTimer.pauseStartedAt : Date.now();
  return Math.max(0, end - state.activeTimer.startedAt - state.activeTimer.pausedMs);
}

function addTimerFromForm() {
  const minutes = normalizeTimerMinutes(dom.timerMinutesInput.value);
  if (!minutes) return;
  state.timers.push({
    id: createId(),
    minutes,
  });
  dom.timerMinutesInput.value = "";
  saveState();
  renderSession();
}

function updateTimer(id, updates) {
  const timer = getTimerById(id);
  if (!timer) return;
  if ("minutes" in updates) {
    timer.minutes = normalizeTimerMinutes(updates.minutes) || timer.minutes;
    if (state.activeTimer?.timerId === id && state.activeTimer.status !== "running" && state.activeTimer.status !== "paused") {
      state.activeTimer.durationSeconds = timer.minutes * 60;
      state.activeTimer.minutes = timer.minutes;
      state.activeTimer.label = formatTimerDuration(timer.minutes);
    }
  }
  saveState();
  renderSession();
}

function deleteTimer(id) {
  if (state.timers.length <= 1) return;
  state.timers = state.timers.filter((timer) => timer.id !== id);
  state.completedTimerIds = getCompletedTimerIdsArray().filter((timerId) => !isTimerCompletionForTimer(timerId, id));
  if (state.activeTimer?.timerId === id) {
    state.activeTimer = null;
    releaseWakeLock();
  }
  if (state.lastTimerId === id) {
    state.lastTimerId = state.timers[0]?.id || null;
    state.lastTimerSlot = 1;
    state.lastTimerStartedAt = null;
  }
  saveState();
  renderSession();
}

function markTimerCompleted(id) {
  const completedIds = getCompletedTimerIds();
  completedIds.add(id);
  state.completedTimerIds = [...completedIds];
}

function resetCompletedTimers() {
  state.completedTimerIds = [];
  saveState();
  renderSession();
}

function getCompletedTimerIds() {
  return new Set(getCompletedTimerIdsArray());
}

function getCompletedTimerIdsArray() {
  return Array.isArray(state.completedTimerIds) ? state.completedTimerIds : [];
}

function getTimerSlots() {
  return Array.from({ length: TIMER_SLOT_COUNT }, (_, index) => index + 1);
}

function getTimerSlotKey(id, slotValue) {
  return `${id}:${normalizeTimerSlot(slotValue)}`;
}

function parseTimerSlotKey(value) {
  const raw = String(value || "");
  const separator = raw.lastIndexOf(":");
  if (separator === -1) {
    return { id: raw, slot: 1, isLegacy: true };
  }
  return {
    id: raw.slice(0, separator),
    slot: normalizeTimerSlot(raw.slice(separator + 1)),
    isLegacy: false,
  };
}

function isTimerCompletionForTimer(value, id) {
  return parseTimerSlotKey(value).id === id;
}

function normalizeCompletedTimerIds(ids, timers) {
  if (!Array.isArray(ids)) return [];
  const timerIds = new Set(timers.map((timer) => timer.id));
  const normalized = new Set();
  ids.forEach((value) => {
    const parsed = parseTimerSlotKey(value);
    if (!timerIds.has(parsed.id)) return;
    normalized.add(getTimerSlotKey(parsed.id, parsed.isLegacy ? 1 : parsed.slot));
  });
  return [...normalized];
}

function getTimers() {
  if (!Array.isArray(state.timers) || !state.timers.length) {
    state.timers = cloneDefaultState().timers;
  }
  return state.timers;
}

function getTimerById(id) {
  return getTimers().find((timer) => timer.id === id);
}

function getLastTimer() {
  return getTimerById(state.lastTimerId);
}

function normalizeTimerMinutes(value) {
  const minutes = Number(value);
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  return clamp(Math.round(minutes), 1, 180);
}

function normalizeTimerSlot(value) {
  const slot = Number(value);
  if (!Number.isInteger(slot) || slot < 1 || slot > TIMER_SLOT_COUNT) return 1;
  return slot;
}

function formatTimerDuration(minutes) {
  return `${normalizeTimerMinutes(minutes) || 0} min`;
}

function formatActiveTimerLabel(timer) {
  if (!timer) return "Minutnik";
  return formatTimerDuration(timer.minutes || Math.round(timer.durationSeconds / 60));
}

function normalizeStoredTimers(timers) {
  if (!Array.isArray(timers) || !timers.length) return cloneDefaultState().timers;
  return timers
    .map((timer) => {
      const minutes = normalizeTimerMinutes(timer?.minutes);
      if (!minutes) return null;
      return {
        id: timer?.id || createId(),
        minutes,
      };
    })
    .filter(Boolean);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}

function renderStats() {
  const range = state.statsRange === "quarter" ? "quarter" : "week";
  const config = getStatsRangeConfig(range);
  const today = getDayKey(Date.now());
  const totals = getLastDays(config.dayCount, 0, config.chartMode);
  const previousTotals = getLastDays(config.dayCount, config.dayCount, config.chartMode).map((day) => day.total);
  const logs = [...state.logs].sort((a, b) => b.timestamp - a.timestamp);
  const todayTotal = sumForDay(today);
  const periodTotal = totals.reduce((sum, bucket) => sum + bucket.total, 0);
  const periodEntryCount = totals.reduce((sum, bucket) => sum + bucket.entries, 0);
  const previousPeriodTotal = previousTotals.reduce((sum, total) => sum + total, 0);
  const average = Math.round(periodTotal / config.averageDivisor);
  const historyStats = getHistoryStats(logs, periodTotal, previousPeriodTotal);
  const peakDay = totals.reduce((best, day) => (day.total > (best?.total || 0) ? day : best), null);

  dom.todayTotalPill.textContent = `${todayTotal} ml`;
  dom.metricPeriodLabel.textContent = config.metricLabel;
  dom.metricToday.textContent = `${todayTotal} ml`;
  dom.metricWeek.textContent = `${periodTotal} ml`;
  dom.metricAverageLabel.textContent = config.averageLabel;
  dom.metricAverage.textContent = `${average} ml`;
  dom.metricTotalAll.textContent = `${historyStats.totalAll} ml`;
  dom.metricTotalEntries.textContent = pluralizeEntries(historyStats.entryCount);
  dom.metricEntryCount.textContent = String(historyStats.entryCount);
  dom.metricEntryAverage.textContent = `${historyStats.entryAverage} ml`;
  dom.metricMaxEntry.textContent = `${historyStats.maxEntryAmount} ml`;
  dom.metricMaxEntryDate.textContent = historyStats.maxEntryDate;
  dom.metricBestDay.textContent = `${historyStats.bestDayTotal} ml`;
  dom.metricBestDayDate.textContent = historyStats.bestDayDate;
  dom.metricLastEntry.textContent = `${historyStats.lastEntryAmount} ml`;
  dom.metricLastEntryDate.textContent = historyStats.lastEntryDate;
  dom.metricTrendLabel.textContent = config.trendLabel;
  dom.metricTrend.textContent = formatSignedMl(historyStats.trendDelta);
  dom.metricTrendDetail.textContent = `poprzednio ${previousPeriodTotal} ml`;
  dom.metricTrend.classList.toggle("is-positive", historyStats.trendDelta > 0);
  dom.metricTrend.classList.toggle("is-negative", historyStats.trendDelta < 0);
  dom.metricTrend.classList.toggle("is-neutral", historyStats.trendDelta === 0);
  dom.rangeButtons.forEach((button) => {
    const isActive = button.dataset.statsRange === range;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });
  dom.chartTitle.textContent = config.chartTitle;
  dom.chartSubtitle.textContent = `${totals.length} dni · ${periodTotal} ml · ${pluralizeEntries(periodEntryCount)}`;
  dom.chartPeakPill.textContent = peakDay?.total ? `max ${peakDay.total} ml` : "max 0 ml";
  dom.weekChart.classList.toggle("is-week", range === "week");
  dom.weekChart.classList.toggle("is-quarter", range === "quarter");
  dom.weekChart.style.setProperty("--chart-days", totals.length);
  dom.weekChart.setAttribute("aria-label", config.chartAriaLabel);

  renderChart(totals, range);
  renderHistory();
}

function getStatsRangeConfig(range) {
  if (range === "quarter") {
    return {
      metricLabel: "3 mies.",
      averageLabel: "Śr. / dzień",
      averageDivisor: QUARTER_DAYS,
      trendLabel: "Trend 90 dni",
      chartTitle: "Ostatnie 90 dni",
      chartAriaLabel: "Wykres pobrań z ostatnich 90 dni, dzień po dniu",
      dayCount: QUARTER_DAYS,
      chartMode: "date",
    };
  }
  return {
    metricLabel: "7 dni",
    averageLabel: "Śr. / dzień",
    averageDivisor: WEEK_DAYS,
    trendLabel: "Trend 7 dni",
    chartTitle: "Ostatnie 7 dni",
    chartAriaLabel: "Wykres pobrań z ostatnich 7 dni",
    dayCount: WEEK_DAYS,
    chartMode: "weekday",
  };
}

function getHistoryStats(logs, weekTotal, previousWeekTotal) {
  const entryCount = logs.length;
  const totalAll = logs.reduce((sum, log) => sum + log.amount, 0);
  const entryAverage = entryCount ? Math.round(totalAll / entryCount) : 0;
  const maxEntry = logs.reduce((best, log) => (!best || log.amount > best.amount ? log : best), null);
  const lastEntry = logs[0] || null;
  const totalsByDay = logs.reduce((map, log) => {
    const key = getDayKey(log.timestamp);
    map.set(key, (map.get(key) || 0) + log.amount);
    return map;
  }, new Map());
  const bestDay = [...totalsByDay.entries()].reduce(
    (best, [key, total]) => (!best || total > best.total ? { key, total } : best),
    null,
  );

  return {
    entryCount,
    totalAll,
    entryAverage,
    maxEntryAmount: maxEntry?.amount || 0,
    maxEntryDate: maxEntry ? formatLogDateTime(maxEntry.timestamp) : "brak",
    bestDayTotal: bestDay?.total || 0,
    bestDayDate: bestDay ? formatHistoryDate(dateFromDayKey(bestDay.key)) : "brak",
    lastEntryAmount: lastEntry?.amount || 0,
    lastEntryDate: lastEntry ? formatLogDateTime(lastEntry.timestamp) : "brak",
    trendDelta: weekTotal - previousWeekTotal,
  };
}

function renderChart(days, range) {
  const max = Math.max(1, ...days.map((day) => day.total));
  dom.weekChart.innerHTML = days
    .map((day) => {
      const height = day.total ? Math.max(8, Math.round((day.total / max) * 100)) : 0;
      const classes = [
        "chart-day",
        day.total ? "has-data" : "is-empty-day",
        day.total === max && day.total > 0 ? "is-best" : "",
        day.isToday ? "is-today" : "",
      ]
        .filter(Boolean)
        .join(" ");
      return `
        <div class="${classes}" title="${escapeAttribute(`${day.fullLabel}: ${day.total} ml, ${pluralizeEntries(day.entries)}`)}">
          <div class="bar-wrap">
            <span class="bar-value" style="--bar-height: ${height}%">${day.total || ""}</span>
            <span class="bar${day.total ? "" : " is-empty"}" style="height: ${height}%"></span>
          </div>
          <small>${escapeHtml(day.label)}</small>
          <span class="chart-date">${escapeHtml(day.subLabel)}</span>
          <span class="chart-count">${day.entries ? `${day.entries}x` : ""}</span>
        </div>
      `;
    })
    .join("");
  requestAnimationFrame(() => {
    if (dom.chartScroller) {
      dom.chartScroller.scrollLeft = dom.chartScroller.scrollWidth;
    }
  });
}

function renderHistory() {
  const logs = [...state.logs].sort((a, b) => b.timestamp - a.timestamp).slice(0, 20);
  if (!logs.length) {
    dom.historyList.innerHTML = `<div class="empty-state">Brak zapisów</div>`;
    return;
  }
  dom.historyList.innerHTML = logs
    .map((log) => {
      const date = new Date(log.timestamp);
      return `
        <article class="history-item">
          <div>
            <strong>${formatHistoryDate(date)}</strong>
            <span>${formatHistoryTime(date)}</span>
          </div>
          <div class="history-amount">${log.amount} ml</div>
          <button class="icon-button is-danger" data-delete-log data-id="${log.id}" type="button" aria-label="Usuń zapis">
            <svg><use href="#icon-trash"></use></svg>
          </button>
        </article>
      `;
    })
    .join("");
}

function addLog({ amount, timestamp }) {
  state.logs.push({
    id: createId(),
    amount: Math.round(amount),
    timestamp,
  });
  saveState();
}

function requestNotifications() {
  primeAudio();
  if (!("Notification" in window)) {
    renderNotificationState();
    return;
  }
  if (Notification.permission === "granted") {
    showAppNotification("Powiadomienia aktywne", "Przypomnienia są włączone.", PLAN_REMINDER_TAG);
    return;
  }
  Notification.requestPermission().then(() => {
    renderNotificationState();
    if (Notification.permission === "granted") {
      showAppNotification("Powiadomienia aktywne", "Przypomnienia są włączone.", PLAN_REMINDER_TAG);
    }
  });
}

function renderNotificationState() {
  const isGranted = "Notification" in window && Notification.permission === "granted";
  dom.notificationButton.classList.toggle("is-on", isGranted);
}

async function showAppNotification(title, body, tag) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const options = {
    body,
    tag,
    icon: "assets/icon.svg",
    badge: "assets/icon.svg",
    vibrate: [120, 80, 120],
  };
  try {
    const registration = await navigator.serviceWorker?.ready;
    if (registration?.showNotification) {
      registration.showNotification(title, options);
      return;
    }
  } catch {
    // Fall back to a page notification below.
  }
  try {
    new Notification(title, options);
  } catch {
    // Some mobile browsers only allow service worker notifications.
  }
}

function scheduleNextPickupReminder() {
  window.clearTimeout(pickupReminderTimer);
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const next = getNextPickup();
  const delay = Math.max(1000, next.delta * 60 * 1000);
  if (delay > 2_147_000_000) return;
  pickupReminderTimer = window.setTimeout(() => {
    playAlert();
    showAppNotification("Czas pobrania", `Zaplanowane na ${minutesToTime(next.minutes)}.`, PLAN_REMINDER_TAG);
    window.setTimeout(scheduleNextPickupReminder, 70_000);
  }, delay);
}

function primeAudio() {
  if (audioContext) return;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;
  audioContext = new AudioContextClass();
  if (audioContext.state === "suspended") {
    audioContext.resume();
  }
}

function playAlert() {
  primeAudio();
  if (!audioContext) return;
  const start = audioContext.currentTime;
  const gain = audioContext.createGain();
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(0.14, start + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.38);
  gain.connect(audioContext.destination);

  [660, 880].forEach((frequency, index) => {
    const oscillator = audioContext.createOscillator();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, start + index * 0.12);
    oscillator.connect(gain);
    oscillator.start(start + index * 0.12);
    oscillator.stop(start + 0.42);
  });
}

async function requestWakeLock() {
  if (!("wakeLock" in navigator)) return;
  try {
    wakeLock = await navigator.wakeLock.request("screen");
  } catch {
    wakeLock = null;
  }
}

function releaseWakeLock() {
  if (!wakeLock) return;
  wakeLock.release().catch(() => {});
  wakeLock = null;
}

function startTicker() {
  window.clearInterval(appTicker);
  appTicker = window.setInterval(() => {
    renderPlanSummaryOnly();
    renderSession();
  }, 1000);
}

function renderPlanSummaryOnly() {
  const next = getNextPickup();
  dom.nextPickupTime.textContent = minutesToTime(next.minutes);
  dom.nextPickupPill.textContent = minutesToTime(next.minutes);
  dom.nextPickupCountdown.textContent = formatDuration(next.delta);
}

function getSortedSchedule() {
  return [...state.schedule].sort((a, b) => a.minutes - b.minutes);
}

function getNextPickup() {
  const sorted = getSortedSchedule();
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const sameDay = sorted.find((item) => item.minutes >= nowMinutes);
  const item = sameDay || sorted[0] || { id: "fallback", minutes: 0 };
  const delta = intervalBetween(nowMinutes, item.minutes);
  return { ...item, delta: delta === MINUTES_PER_DAY ? 0 : delta };
}

function intervalBetween(from, to) {
  const diff = (to - from + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return diff === 0 ? MINUTES_PER_DAY : diff;
}

function minutesToTime(minutes) {
  const normalized = ((Math.round(minutes) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const hours = Math.floor(normalized / 60);
  const mins = normalized % 60;
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

function formatDuration(minutes) {
  if (minutes <= 0) return "teraz";
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours && mins) return `${hours} h ${mins} min`;
  if (hours) return `${hours} h`;
  return `${mins} min`;
}

function secondsToClock(seconds) {
  const safeSeconds = Math.max(0, seconds);
  const minutes = Math.floor(safeSeconds / 60);
  const rest = safeSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

function getLastDays(count, offset = 0, mode = "weekday") {
  const days = [];
  const date = startOfToday();
  date.setDate(date.getDate() - (count - 1 + offset));
  const todayKey = getDayKey(Date.now());
  for (let index = 0; index < count; index += 1) {
    const current = new Date(date);
    current.setDate(date.getDate() + index);
    const key = getDayKey(current.getTime());
    const weekday = new Intl.DateTimeFormat("pl-PL", { weekday: "short" }).format(current).replace(".", "");
    const dateLabel = `${current.getDate()}.${current.getMonth() + 1}`;
    const summary = getDaySummary(key);
    days.push({
      key,
      label: mode === "date" ? dateLabel : weekday,
      subLabel: mode === "date" ? weekday : dateLabel,
      fullLabel: formatChartFullDate(current),
      total: summary.total,
      entries: summary.entries,
      isToday: key === todayKey,
    });
  }
  return days;
}

function getDaySummary(dayKey) {
  return state.logs.reduce(
    (summary, log) => {
      if (getDayKey(log.timestamp) !== dayKey) return summary;
      summary.total += log.amount;
      summary.entries += 1;
      return summary;
    },
    { total: 0, entries: 0 },
  );
}

function getLastWeeks(count, offset = 0) {
  const buckets = [];
  const end = startOfToday();
  end.setDate(end.getDate() - offset * 7);
  end.setHours(23, 59, 59, 999);

  for (let index = count - 1; index >= 0; index -= 1) {
    const start = startOfToday();
    start.setDate(end.getDate() - index * 7 - 6);
    const stop = new Date(start);
    stop.setDate(start.getDate() + 6);
    stop.setHours(23, 59, 59, 999);
    const weekIndex = count - index;
    buckets.push({
      key: `${getDayKey(start.getTime())}:${getDayKey(stop.getTime())}`,
      label: weekIndex % 2 === 1 ? `${start.getDate()}.${start.getMonth() + 1}` : "",
      total: sumForRange(start.getTime(), stop.getTime()),
    });
  }

  return buckets;
}

function sumForDay(dayKey) {
  return state.logs
    .filter((log) => getDayKey(log.timestamp) === dayKey)
    .reduce((sum, log) => sum + log.amount, 0);
}

function sumForRange(startTimestamp, endTimestamp) {
  return state.logs
    .filter((log) => log.timestamp >= startTimestamp && log.timestamp <= endTimestamp)
    .reduce((sum, log) => sum + log.amount, 0);
}

function getDayKey(timestamp) {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function dateFromDayKey(dayKey) {
  const [year, month, day] = dayKey.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function startOfToday() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

function setDefaultLogDateTime() {
  const now = new Date();
  dom.logDate.value = getDayKey(now.getTime());
  dom.logTime.value = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

function localDateTimeToTimestamp(dateValue, timeValue) {
  if (!dateValue || !timeValue) return null;
  const [year, month, day] = dateValue.split("-").map(Number);
  const [hours, minutes] = timeValue.split(":").map(Number);
  const date = new Date(year, month - 1, day, hours, minutes, 0, 0);
  const timestamp = date.getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function formatHistoryDate(date) {
  return new Intl.DateTimeFormat("pl-PL", {
    day: "2-digit",
    month: "short",
  }).format(date);
}

function formatChartFullDate(date) {
  return new Intl.DateTimeFormat("pl-PL", {
    weekday: "long",
    day: "2-digit",
    month: "long",
  }).format(date);
}

function formatHistoryTime(date) {
  return new Intl.DateTimeFormat("pl-PL", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatLogDateTime(timestamp) {
  const date = new Date(timestamp);
  return `${formatHistoryDate(date)}, ${formatHistoryTime(date)}`;
}

function formatSignedMl(amount) {
  if (amount > 0) return `+${amount} ml`;
  return `${amount} ml`;
}

function pluralizeEntries(count) {
  if (count === 1) return "1 wpis";
  const lastDigit = count % 10;
  const lastTwoDigits = count % 100;
  if (lastDigit >= 2 && lastDigit <= 4 && (lastTwoDigits < 12 || lastTwoDigits > 14)) {
    return `${count} wpisy`;
  }
  return `${count} wpisów`;
}

function roundToStep(value, step) {
  return Math.round(value / step) * step;
}

function timelinePercent(minutes) {
  return clamp((minutes / MINUTES_PER_DAY) * 100, 0, 100);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function createId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return cloneDefaultState();
    const parsed = JSON.parse(raw);
    const timers = normalizeStoredTimers(parsed.timers);
    return {
      ...cloneDefaultState(),
      ...parsed,
      schedule: Array.isArray(parsed.schedule) && parsed.schedule.length ? parsed.schedule : defaultState.schedule,
      timers,
      activeTimer: normalizeStoredActiveTimer(parsed.activeTimer),
      lastTimerId: parsed.lastTimerId || null,
      lastTimerSlot: normalizeTimerSlot(parsed.lastTimerSlot),
      lastTimerStartedAt: parsed.lastTimerStartedAt || null,
      completedTimerIds: normalizeCompletedTimerIds(parsed.completedTimerIds, timers),
      statsRange: parsed.statsRange === "quarter" ? "quarter" : "week",
      logs: Array.isArray(parsed.logs) ? parsed.logs : [],
    };
  } catch {
    return cloneDefaultState();
  }
}

function normalizeStoredActiveTimer(timer) {
  if (!timer?.durationSeconds) return null;
  const minutes = normalizeTimerMinutes(timer.minutes) || Math.round(timer.durationSeconds / 60);
  const slot = normalizeTimerSlot(timer.slot);
  return {
    ...timer,
    slot,
    slotKey: getTimerSlotKey(timer.timerId, slot),
    minutes,
    label: formatTimerDuration(minutes),
  };
}

function cloneDefaultState() {
  return JSON.parse(JSON.stringify(defaultState));
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}
