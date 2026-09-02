const STORAGE_KEY = "my-semester:data:v1";
const THEME_KEY = "my-semester:theme";
const weekdays = ["월", "화", "수", "목", "금"];
const calendarWeekdays = ["월", "화", "수", "목", "금", "토", "일"];
const hourStart = 9;
const hourEnd = 18;
const scrollPositions = new Map();

let semester = loadSemesterData();
let currentDialogSubmit = null;
let toastTimer = 0;
let saveTimer = 0;

const ui = {
  view: "schedule",
  courseId: semester.courses[0]?.id || "",
  courseTab: "plan",
  taskFilter: "all",
  calendarCursor: new Date(2026, 8, 1, 12),
  selectedDate: "2026-09-02"
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isPlainRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isIsoDateString(value, { allowEmpty = true } = {}) {
  if (value === "") return allowEmpty;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function normalizeMeetings(value, fallback) {
  if (!Array.isArray(value)) return fallback;
  if (!value.length) return [];
  const normalized = value.filter((meeting) => {
    if (!isPlainRecord(meeting)) return false;
    const day = Number(meeting.day);
    const start = Number(meeting.start);
    const end = Number(meeting.end);
    return Number.isInteger(day) && day >= 1 && day <= 5 && Number.isFinite(start) && Number.isFinite(end) && start < end;
  }).map((meeting) => ({
    day: Number(meeting.day),
    start: Number(meeting.start),
    end: Number(meeting.end),
    room: typeof meeting.room === "string" ? meeting.room : ""
  }));
  return normalized.length ? normalized : fallback;
}

function mergeRecordsById(defaultItems, savedItems, validate) {
  const savedMap = new Map(
    savedItems.filter((item) => isPlainRecord(item) && typeof item.id === "string").map((item) => [item.id, item])
  );
  const merged = defaultItems.map((item) => {
    const saved = savedMap.get(item.id);
    savedMap.delete(item.id);
    return saved ? { ...item, ...saved } : item;
  });
  savedMap.forEach((item) => merged.push(item));
  return merged.filter(validate);
}

function normalizeSemesterData(candidate) {
  const defaults = clone(window.DEFAULT_SEMESTER_DATA);
  if (!isPlainRecord(candidate) || !Array.isArray(candidate.courses)) return defaults;

  const savedVersion = Number(candidate.version || 0);
  const currentVersion = Number(defaults.version || 1);
  const isLegacy = savedVersion < currentVersion;
  const savedCourses = new Map(candidate.courses.filter((course) => isPlainRecord(course) && typeof course.id === "string").map((course) => [course.id, course]));
  const courses = defaults.courses.map((defaultCourse) => {
    const savedCourse = savedCourses.get(defaultCourse.id);
    if (!savedCourse) return defaultCourse;

    const savedWeeks = new Map((Array.isArray(savedCourse.weeks) ? savedCourse.weeks : []).filter(isPlainRecord).map((week) => [Number(week.week), week]));
    const weeks = defaultCourse.weeks.map((defaultWeek) => {
      const savedWeek = savedWeeks.get(Number(defaultWeek.week));
      if (!savedWeek) return defaultWeek;
      const mergedWeek = isLegacy ? {
        ...defaultWeek,
        note: typeof savedWeek.note === "string" ? savedWeek.note : "",
        reviewed: Boolean(savedWeek.reviewed)
      } : { ...defaultWeek, ...savedWeek };
      return {
        ...mergedWeek,
        week: defaultWeek.week,
        date: isIsoDateString(mergedWeek.date) ? mergedWeek.date : defaultWeek.date,
        topic: typeof mergedWeek.topic === "string" ? mergedWeek.topic : defaultWeek.topic,
        detail: typeof mergedWeek.detail === "string" ? mergedWeek.detail : defaultWeek.detail,
        materials: typeof mergedWeek.materials === "string" ? mergedWeek.materials : defaultWeek.materials,
        assignment: typeof mergedWeek.assignment === "string" ? mergedWeek.assignment : defaultWeek.assignment,
        note: typeof mergedWeek.note === "string" ? mergedWeek.note : "",
        reviewed: Boolean(mergedWeek.reviewed)
      };
    });

    if (isLegacy) {
      return {
        ...defaultCourse,
        courseMemo: typeof savedCourse.courseMemo === "string" ? savedCourse.courseMemo : "",
        examMemo: typeof savedCourse.examMemo === "string" && savedCourse.examMemo.trim() ? savedCourse.examMemo : defaultCourse.examMemo,
        weeks
      };
    }

    return {
      ...defaultCourse,
      ...savedCourse,
      id: defaultCourse.id,
      order: defaultCourse.order,
      name: typeof savedCourse.name === "string" ? savedCourse.name : defaultCourse.name,
      shortName: typeof savedCourse.shortName === "string" ? savedCourse.shortName : defaultCourse.shortName,
      professor: typeof savedCourse.professor === "string" ? savedCourse.professor : defaultCourse.professor,
      professorInfo: typeof savedCourse.professorInfo === "string" ? savedCourse.professorInfo : defaultCourse.professorInfo,
      location: typeof savedCourse.location === "string" ? savedCourse.location : defaultCourse.location,
      meetingLabel: typeof savedCourse.meetingLabel === "string" ? savedCourse.meetingLabel : defaultCourse.meetingLabel,
      description: typeof savedCourse.description === "string" ? savedCourse.description : defaultCourse.description,
      color: typeof savedCourse.color === "string" ? savedCourse.color : defaultCourse.color,
      goals: Array.isArray(savedCourse.goals) ? savedCourse.goals.filter((item) => typeof item === "string") : defaultCourse.goals,
      textbooks: Array.isArray(savedCourse.textbooks) ? savedCourse.textbooks.filter((item) => typeof item === "string") : defaultCourse.textbooks,
      policies: Array.isArray(savedCourse.policies) ? savedCourse.policies.filter((item) => typeof item === "string") : defaultCourse.policies,
      grading: Array.isArray(savedCourse.grading) ? savedCourse.grading.filter(isPlainRecord) : defaultCourse.grading,
      meetings: normalizeMeetings(savedCourse.meetings, defaultCourse.meetings),
      weeks
    };
  });

  if (savedVersion < 5) {
    const humanCourse = courses.find((course) => course.id === "human-way");
    const defaultHumanCourse = defaults.courses.find((course) => course.id === "human-way");
    const previousDefaultMemos = new Set([
      "8주차 수업에서 필요 시 수시고사가 있을 수 있습니다. 15주차에는 대인관계 역량을 평가하는 논술형 기말고사가 예정되어 있습니다.",
      "14주차 기말시험과 과제·서류 마감이 안내되어 있습니다. 15주차 종강예배는 필참이며 출석점수에 반영됩니다."
    ]);
    if (humanCourse && defaultHumanCourse && previousDefaultMemos.has(humanCourse.examMemo)) humanCourse.examMemo = defaultHumanCourse.examMemo;
  }

  const courseIds = new Set(courses.map((course) => course.id));
  const validTask = (item) => isPlainRecord(item) && typeof item.id === "string" && courseIds.has(item.courseId) && typeof item.title === "string" && typeof item.type === "string" && isIsoDateString(item.dueDate) && typeof item.notes === "string" && typeof item.completed === "boolean";
  const validExam = (item) => isPlainRecord(item) && typeof item.id === "string" && courseIds.has(item.courseId) && typeof item.title === "string" && typeof item.type === "string" && isIsoDateString(item.date) && typeof item.location === "string" && typeof item.range === "string" && typeof item.criteria === "string";
  const validEvent = (item) => isPlainRecord(item) && typeof item.id === "string" && typeof item.title === "string" && isIsoDateString(item.date, { allowEmpty: false }) && typeof item.detail === "string" && typeof item.courseId === "string" && (!item.courseId || courseIds.has(item.courseId));
  const savedTasks = Array.isArray(candidate.tasks) ? candidate.tasks : null;
  const savedExams = Array.isArray(candidate.exams) ? candidate.exams : null;
  const savedEvents = Array.isArray(candidate.customEvents) ? candidate.customEvents : null;
  const savedChapels = Array.isArray(candidate.chapels) ? candidate.chapels.filter((item) => isPlainRecord(item) && typeof item.id === "string") : null;
  const tasks = isLegacy && savedTasks ? mergeRecordsById(defaults.tasks, savedTasks, validTask) : (savedTasks ? savedTasks.filter(validTask) : defaults.tasks);
  const exams = isLegacy && savedExams ? mergeRecordsById(defaults.exams, savedExams, validExam) : (savedExams ? savedExams.filter(validExam) : defaults.exams);
  const savedChapelMap = new Map((savedChapels || []).map((chapel) => [chapel.id, chapel]));
  const chapels = defaults.chapels.map((chapel) => ({ ...chapel, ...(savedChapelMap.get(chapel.id) || {}) }));

  if (savedVersion < 4) {
    const updatedTask = defaults.tasks.find((item) => item.id === "human-quiz");
    const savedTask = tasks.find((item) => item.id === "human-quiz");
    if (updatedTask && savedTask) {
      const customNote = savedTask.notes && savedTask.notes !== "정직 수업에서 필요 시 실시" ? savedTask.notes : "";
      Object.assign(savedTask, updatedTask, {
        completed: Boolean(savedTask.completed),
        notes: customNote ? `${updatedTask.notes} · ${customNote}` : updatedTask.notes
      });
    }

    const humanExam = exams.find((item) => item.id === "exam-human-final");
    if (humanExam) Object.assign(humanExam, { title: "기말시험", date: "2026-12-01" });
  }

  return {
    ...defaults,
    meta: { ...defaults.meta, ...(isPlainRecord(candidate.meta) ? candidate.meta : {}) },
    version: currentVersion,
    courses,
    chapels,
    tasks,
    exams,
    customEvents: savedEvents ? savedEvents.filter(validEvent) : defaults.customEvents
  };
}

function loadSemesterData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return clone(window.DEFAULT_SEMESTER_DATA);
    return normalizeSemesterData(JSON.parse(raw));
  } catch (_) {
    return clone(window.DEFAULT_SEMESTER_DATA);
  }
}

function persistSemester({ notify = false } = {}) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...semester, savedAt: new Date().toISOString() }));
    if (notify) showToast("이 노트북에 저장했어요.");
  } catch (_) {
    showToast("저장 공간을 사용할 수 없어요.");
  }
}

function schedulePersist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => persistSemester(), 220);
}

function makeId(prefix) {
  if (crypto?.randomUUID) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function dateFromIso(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso || ""))) return null;
  const date = new Date(`${iso}T12:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isoFromDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDate(iso, { includeYear = false, weekday = true } = {}) {
  const date = dateFromIso(iso);
  if (!date) return "날짜 미정";
  return new Intl.DateTimeFormat("ko-KR", {
    ...(includeYear ? { year: "numeric" } : {}),
    month: "long",
    day: "numeric",
    ...(weekday ? { weekday: "short" } : {})
  }).format(date);
}

function courseById(id) {
  return semester.courses.find((course) => course.id === id);
}

function courseTypeLabel(course) {
  if (course.type === "major") return "전공";
  if (course.type === "online") return "사이버강의";
  return "교양";
}

function taskTypeLabel(type) {
  return ({ assignment: "과제", online: "강의 시청", quiz: "퀴즈", review: "복습", other: "기타" })[type] || "기타";
}

function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2300);
}

function renderCourseNavigation() {
  const host = document.getElementById("courseNav");
  host.innerHTML = semester.courses
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((course) => `
      <button class="course-nav-button${ui.view === "course" && ui.courseId === course.id ? " active" : ""}"
        type="button" data-open-course="${course.id}" style="--course-color:${course.color}"${ui.view === "course" && ui.courseId === course.id ? ' aria-current="page"' : ""}>
        <span class="course-number">${String(course.order).padStart(2, "0")}</span>
        <span class="course-nav-name">${escapeHtml(course.shortName || course.name)}</span>
        <span class="course-kind-dot" aria-hidden="true"></span>
      </button>
    `).join("");
}

function renderTimetable() {
  const host = document.getElementById("timetable");
  if (!host) return;
  const pieces = ['<div class="time-corner"></div>'];

  weekdays.forEach((day, index) => {
    pieces.push(`<div class="day-head" style="grid-column:${index + 2};grid-row:1">${day}</div>`);
  });

  for (let hour = hourStart; hour < hourEnd; hour += 1) {
    const row = hour - hourStart + 2;
    pieces.push(`<div class="time-label" style="grid-column:1;grid-row:${row}">${hour > 12 ? hour - 12 : hour}</div>`);
    weekdays.forEach((_, dayIndex) => {
      pieces.push(`<div class="grid-cell" style="grid-column:${dayIndex + 2};grid-row:${row}"></div>`);
    });
  }

  semester.courses.forEach((course) => {
    (course.meetings || []).forEach((meeting) => {
      const rowStart = Number(meeting.start) - hourStart + 2;
      const rowEnd = Number(meeting.end) - hourStart + 2;
      const typeClass = course.type === "major" ? " major" : "";
      const accessibleLabel = `${weekdays[Number(meeting.day) - 1]}요일 ${Number(meeting.start)}시부터 ${Number(meeting.end)}시까지, ${course.name}, ${meeting.room || course.location || "장소 미정"}`;
      pieces.push(`
        <button class="course-block${typeClass}" type="button" data-peek-course="${course.id}"
          aria-label="${escapeHtml(accessibleLabel)}" style="--course-color:${course.color};grid-column:${Number(meeting.day) + 1};grid-row:${rowStart}/${rowEnd}">
          <strong>${escapeHtml(course.shortName || course.name)}</strong>
          <small>${escapeHtml(meeting.room || course.location)}</small>
        </button>
      `);
    });
  });

  semester.chapels.forEach((session) => {
    const rowStart = Number(session.start) - hourStart + 2;
    const rowEnd = Number(session.end) - hourStart + 2;
    pieces.push(`
      <button class="course-block" type="button" data-peek-chapel="${session.id}"
        aria-label="월요일 ${escapeHtml(session.period)}, ${escapeHtml(session.name)}, ${escapeHtml(session.location)}, ${escapeHtml(session.area)}구역 ${escapeHtml(session.seat)}번"
        style="--course-color:${session.color};grid-column:${Number(session.day) + 1};grid-row:${rowStart}/${rowEnd}">
        <strong>${escapeHtml(session.name)}</strong>
        <small>${escapeHtml(session.location)}</small>
      </button>
    `);
  });

  host.innerHTML = pieces.join("");
}

function renderOnlineCourses() {
  const host = document.getElementById("onlineCards");
  if (!host) return;
  host.innerHTML = semester.courses.filter((course) => course.type === "online").map((course) => `
    <button class="online-course" type="button" data-peek-course="${course.id}">
      <span>↗</span>
      <div>
        <strong>${escapeHtml(course.name)}</strong>
        <small>${escapeHtml(course.professor || "교수 정보 미기재")} · 주차별 학습</small>
      </div>
    </button>
  `).join("");
}

function showCoursePeek(course) {
  const host = document.getElementById("coursePeek");
  const isOnline = course.type === "online";
  host.innerHTML = `
    <div class="peek-empty peek-filled" style="--course-color:${course.color}">
      <span class="peek-orbit" aria-hidden="true"></span>
      <p class="eyebrow">${course.type === "major" ? "MAJOR CLASS" : isOnline ? "ONLINE CLASS" : "CLASS INFO"}</p>
      <h2>${escapeHtml(course.name)}</h2>
      <p>${escapeHtml(course.professor || "교수 정보 미기재")}</p>
      <dl class="peek-facts">
        <div><dt>장소</dt><dd>${escapeHtml(course.location || "정보 없음")}</dd></div>
        <div><dt>시간</dt><dd>${escapeHtml(course.meetingLabel || "시간 미정")}</dd></div>
      </dl>
      <button class="soft-button peek-open-button" type="button" data-open-course="${course.id}">과목 정리본 보기</button>
    </div>
  `;
}

function showChapelPeek(session) {
  const host = document.getElementById("coursePeek");
  host.innerHTML = `
    <div class="peek-empty peek-filled">
      <span class="peek-orbit" aria-hidden="true"></span>
      <p class="eyebrow">CHAPEL SEAT</p>
      <h2>${escapeHtml(session.name)}</h2>
      <p>${escapeHtml(session.location)}</p>
      <dl class="peek-facts">
        <div><dt>시간</dt><dd>월요일 ${escapeHtml(session.period)}</dd></div>
        <div><dt>좌석</dt><dd>${escapeHtml(session.area)}구역 ${escapeHtml(session.seat)}번</dd></div>
      </dl>
      <button class="soft-button peek-open-button" type="button" data-view="chapel">채플 좌석 화면</button>
    </div>
  `;
}

function renderScheduleView() {
  renderTimetable();
  renderOnlineCourses();
}

function renderPageHeading(eyebrow, title, description, actions = "") {
  return `
    <div class="page-heading page-heading-wide">
      <div>
        <p class="eyebrow">${escapeHtml(eyebrow)}</p>
        <h1>${escapeHtml(title)}</h1>
        <p>${escapeHtml(description)}</p>
      </div>
      ${actions ? `<div class="heading-actions">${actions}</div>` : ""}
    </div>
  `;
}

function compareTasksByDueDate(a, b) {
  const aHasDate = Boolean(a.dueDate);
  const bHasDate = Boolean(b.dueDate);
  if (aHasDate !== bHasDate) return aHasDate ? -1 : 1;
  if (aHasDate && a.dueDate !== b.dueDate) return a.dueDate.localeCompare(b.dueDate);
  const aOrder = Number(courseById(a.courseId)?.order || Number.MAX_SAFE_INTEGER);
  const bOrder = Number(courseById(b.courseId)?.order || Number.MAX_SAFE_INTEGER);
  return aOrder - bOrder || a.title.localeCompare(b.title, "ko");
}

function renderTaskItem(task) {
  const course = courseById(task.courseId);
  return `
    <div class="task-item${task.completed ? " completed" : ""}" data-task-id="${task.id}">
      <label class="check-control">
        <input type="checkbox" data-task-toggle="${task.id}" aria-label="${escapeHtml(task.completed ? `완료 취소: ${task.title}` : `완료 표시: ${task.title}`)}" ${task.completed ? "checked" : ""} />
        <span aria-hidden="true"></span>
      </label>
      <button class="task-main" type="button" data-action="edit-task" data-task-id="${task.id}">
        <strong>${escapeHtml(task.title)}</strong>
        <small><span>${escapeHtml(taskTypeLabel(task.type))}</span>${task.dueDate ? `<span>${escapeHtml(formatDate(task.dueDate))}</span>` : `<span>마감 미정</span>`}</small>
      </button>
      <span class="task-color" style="background:${course?.color || "var(--accent)"}"></span>
    </div>
  `;
}

function renderTasksView() {
  const host = document.getElementById("view-tasks");
  const total = semester.tasks.length;
  const completed = semester.tasks.filter((task) => task.completed).length;
  const remaining = total - completed;
  const filtered = semester.tasks.filter((task) => ui.taskFilter === "todo" ? !task.completed : ui.taskFilter === "done" ? task.completed : true).sort(compareTasksByDueDate);

  const groups = semester.courses.map((course) => {
    const tasks = filtered.filter((task) => task.courseId === course.id);
    const allCourseTasks = semester.tasks.filter((task) => task.courseId === course.id);
    return `
      <article class="task-group" style="--course-color:${course.color}">
        <header class="task-group-head">
          <div><span class="course-kind-dot" aria-hidden="true"></span><div><h2>${escapeHtml(course.shortName || course.name)}</h2><small>${allCourseTasks.filter((task) => task.completed).length}/${allCourseTasks.length} 완료</small></div></div>
          <button class="icon-text-button" type="button" data-action="add-task" data-course-id="${course.id}">+ 추가</button>
        </header>
        <div class="task-list">${tasks.length ? tasks.map(renderTaskItem).join("") : `<div class="compact-empty">${ui.taskFilter === "all" ? "아직 등록된 항목이 없어요." : "이 조건에 맞는 항목이 없어요."}</div>`}</div>
      </article>
    `;
  }).join("");

  host.innerHTML = `
    ${renderPageHeading("CHECKLIST", "전체 체크리스트", "과제와 사이버강의 시청 항목을 과목별로 모아 봅니다.", `<button class="primary-button" type="button" data-action="add-task">새 항목</button>`)}
    <div class="summary-grid summary-grid-three">
      <article><span>전체</span><strong>${total}</strong><small>등록된 항목</small></article>
      <article><span>남음</span><strong>${remaining}</strong><small>확인이 필요해요</small></article>
      <article><span>완료</span><strong>${completed}</strong><small>${total ? Math.round((completed / total) * 100) : 0}% 진행</small></article>
    </div>
    <div class="view-toolbar"><div class="segmented-control" role="group" aria-label="체크리스트 필터">
      ${[["all", "전체"], ["todo", "할 일"], ["done", "완료"]].map(([value, label]) => `<button class="${ui.taskFilter === value ? "active" : ""}" type="button" data-task-filter="${value}" aria-pressed="${ui.taskFilter === value}">${label}</button>`).join("")}
    </div></div>
    <div class="task-groups">${groups}</div>
  `;
}

function calendarCourseRank(item, date) {
  const course = courseById(item.courseId);
  const selectedDate = dateFromIso(date);
  const weekday = selectedDate?.getDay();
  const meetings = (course?.meetings || []).filter((meeting) => Number(meeting.day) === weekday).sort((a, b) => Number(a.start) - Number(b.start));
  return {
    scheduled: meetings.length ? 0 : 1,
    start: meetings.length ? Number(meetings[0].start) : Number.MAX_SAFE_INTEGER,
    courseOrder: Number(course?.order || Number.MAX_SAFE_INTEGER)
  };
}

function compareCalendarItemsByTimetable(a, b, date) {
  const aRank = calendarCourseRank(a, date);
  const bRank = calendarCourseRank(b, date);
  const kindOrder = { week: 0, task: 1, exam: 2, custom: 3 };
  return aRank.scheduled - bRank.scheduled
    || aRank.start - bRank.start
    || aRank.courseOrder - bRank.courseOrder
    || (kindOrder[a.kind] ?? 9) - (kindOrder[b.kind] ?? 9)
    || a.title.localeCompare(b.title, "ko");
}

function calendarItemScheduleLabel(item, date) {
  const course = courseById(item.courseId);
  const weekday = dateFromIso(date)?.getDay();
  const meeting = (course?.meetings || []).filter((entry) => Number(entry.day) === weekday).sort((a, b) => Number(a.start) - Number(b.start))[0];
  if (!meeting) return "";
  const startPeriod = Number(meeting.start) - hourStart + 1;
  const endPeriod = Number(meeting.end) - hourStart;
  return startPeriod === endPeriod ? `${startPeriod}교시` : `${startPeriod}~${endPeriod}교시`;
}

function collectCalendarItems() {
  const items = [];
  semester.courses.forEach((course) => {
    (course.weeks || []).forEach((week) => {
      if (!week.date || !week.topic) return;
      items.push({
        id: `week-${course.id}-${week.week}`,
        kind: "week",
        date: week.date,
        courseId: course.id,
        week: week.week,
        title: `${course.shortName || course.name} · ${week.topic}`,
        shortTitle: `${week.week}주 · ${week.topic}`,
        color: course.color,
        detail: week.detail || ""
      });
    });
  });
  semester.tasks.forEach((task) => {
    if (!task.dueDate) return;
    const course = courseById(task.courseId);
    items.push({ id: task.id, kind: "task", date: task.dueDate, courseId: task.courseId, title: `${course?.shortName || "과목"} · ${task.title}`, shortTitle: task.title, color: course?.color || "#d8a2ad", detail: task.notes || "" });
  });
  semester.exams.forEach((exam) => {
    if (!exam.date) return;
    const course = courseById(exam.courseId);
    items.push({ id: exam.id, kind: "exam", date: exam.date, courseId: exam.courseId, title: `${course?.shortName || "과목"} · ${exam.title}`, shortTitle: exam.title, color: course?.color || "#d8a2ad", detail: exam.range || exam.criteria || "" });
  });
  semester.customEvents.forEach((event) => {
    if (!event.date) return;
    const course = courseById(event.courseId);
    items.push({ ...event, kind: "custom", title: event.courseId ? `${course?.shortName || "과목"} · ${event.title}` : event.title, shortTitle: event.title, color: course?.color || "#c2a1dd" });
  });
  return items.sort((a, b) => a.date.localeCompare(b.date) || compareCalendarItemsByTimetable(a, b, a.date));
}

function renderAgendaItem(item, date) {
  const labels = { week: "수업계획", task: "체크리스트", exam: "시험", custom: "직접 추가" };
  const scheduleLabel = calendarItemScheduleLabel(item, date);
  return `
    <button class="agenda-item" type="button" data-calendar-kind="${item.kind}" data-calendar-id="${item.id}" style="--event-color:${item.color}">
      <span class="agenda-dot" aria-hidden="true"></span>
      <span><small>${scheduleLabel ? `${escapeHtml(scheduleLabel)} · ` : ""}${labels[item.kind]}</small><strong>${escapeHtml(item.title)}</strong>${item.detail ? `<em>${escapeHtml(item.detail)}</em>` : ""}</span>
    </button>
  `;
}

function renderAgendaGroups(items, date) {
  const definitions = [
    { kind: "week", label: "수업계획" },
    { kind: "task", label: "체크리스트" },
    { kind: "exam", label: "시험" },
    { kind: "custom", label: "직접 추가" }
  ];
  return definitions.map(({ kind, label }) => {
    const groupItems = items.filter((item) => item.kind === kind).sort((a, b) => compareCalendarItemsByTimetable(a, b, date));
    if (!groupItems.length) return "";
    return `
      <section class="agenda-group" aria-label="${label}">
        <header class="agenda-group-head"><strong>${label}</strong><small>${groupItems.length}</small></header>
        <div class="agenda-group-items">${groupItems.map((item) => renderAgendaItem(item, date)).join("")}</div>
      </section>
    `;
  }).join("");
}

function renderCalendarView() {
  const host = document.getElementById("view-calendar");
  const year = ui.calendarCursor.getFullYear();
  const month = ui.calendarCursor.getMonth();
  const monthLabel = new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "long" }).format(ui.calendarCursor);
  const first = new Date(year, month, 1, 12);
  const mondayOffset = (first.getDay() + 6) % 7;
  const gridStart = new Date(year, month, 1 - mondayOffset, 12);
  const items = collectCalendarItems();
  const dayCells = [];

  for (let index = 0; index < 42; index += 1) {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    const iso = isoFromDate(date);
    const dayItems = items.filter((item) => item.date === iso);
    const outside = date.getMonth() !== month;
    const selected = iso === ui.selectedDate;
    dayCells.push(`
      <div class="calendar-day${outside ? " outside" : ""}${selected ? " selected" : ""}">
        <button class="calendar-day-number" type="button" data-calendar-day="${iso}" aria-label="${formatDate(iso, { includeYear: true })}">${date.getDate()}</button>
        <div class="calendar-day-events">
          ${dayItems.slice(0, 2).map((item) => `<button type="button" data-calendar-kind="${item.kind}" data-calendar-id="${item.id}" style="--event-color:${item.color}">${escapeHtml(item.shortTitle)}</button>`).join("")}
          ${dayItems.length > 2 ? `<button class="calendar-more" type="button" data-calendar-day="${iso}">+${dayItems.length - 2}개</button>` : ""}
        </div>
      </div>
    `);
  }

  const selectedItems = items.filter((item) => item.date === ui.selectedDate).sort((a, b) => compareCalendarItemsByTimetable(a, b, ui.selectedDate));
  host.innerHTML = `
    ${renderPageHeading("SEMESTER CALENDAR", "전체 캘린더", "수업계획서의 주차별 내용과 직접 추가한 일정을 함께 관리합니다.", `<button class="primary-button" type="button" data-action="add-event" data-date="${ui.selectedDate}">일정 추가</button>`)}
    <div class="calendar-shell">
      <section class="calendar-card">
        <header class="calendar-toolbar">
          <button class="soft-button" type="button" data-calendar-move="-1" aria-label="이전 달">←</button>
          <div><strong>${monthLabel}</strong><small>${items.filter((item) => { const date = dateFromIso(item.date); return date?.getFullYear() === year && date?.getMonth() === month; }).length}개 일정</small></div>
          <div class="calendar-toolbar-actions"><button class="soft-button" type="button" data-calendar-today="true">오늘</button><button class="soft-button" type="button" data-calendar-move="1" aria-label="다음 달">→</button></div>
        </header>
        <div class="calendar-viewport">
          <div class="calendar-weekdays">${calendarWeekdays.map((day) => `<span>${day}</span>`).join("")}</div>
          <div class="calendar-grid">${dayCells.join("")}</div>
        </div>
      </section>
      <aside class="day-agenda">
        <div class="day-agenda-head"><div><p class="eyebrow">SELECTED DAY</p><h2>${formatDate(ui.selectedDate, { includeYear: true })}</h2></div><button class="icon-text-button" type="button" data-action="add-event" data-date="${ui.selectedDate}">+ 메모</button></div>
        <div class="agenda-list">${selectedItems.length ? renderAgendaGroups(selectedItems, ui.selectedDate) : `<div class="agenda-empty"><strong>등록된 일정이 없어요.</strong><p>이 날짜에 수업 메모나 개인 일정을 추가할 수 있어요.</p></div>`}</div>
      </aside>
    </div>
  `;
}

function renderExamItem(exam) {
  return `
    <button class="exam-item" type="button" data-action="edit-exam" data-exam-id="${exam.id}">
      <span class="exam-date">${exam.date ? escapeHtml(formatDate(exam.date, { weekday: false })) : "날짜 미정"}</span>
      <span><strong>${escapeHtml(exam.title)}</strong><small>${escapeHtml(exam.range || exam.criteria || "시험 범위와 기준을 입력하세요.")}</small></span>
    </button>
  `;
}

function renderExamsView() {
  const host = document.getElementById("view-exams");
  const examCards = semester.courses.map((course) => {
    const exams = semester.exams.filter((exam) => exam.courseId === course.id);
    return `
      <article class="exam-course-card" style="--course-color:${course.color}">
        <header><div><span class="course-kind-dot" aria-hidden="true"></span><h2>${escapeHtml(course.shortName || course.name)}</h2></div><button class="icon-text-button" type="button" data-action="add-exam" data-course-id="${course.id}">+ 시험</button></header>
        <textarea class="exam-quick-memo" data-exam-memo="${course.id}" rows="3" placeholder="중간·기말 시험 기준, 교수님 공지 등을 적어두세요.">${escapeHtml(course.examMemo || "")}</textarea>
        <div class="exam-list">${exams.length ? exams.map(renderExamItem).join("") : `<div class="compact-empty">등록된 시험 일정이 없어요.</div>`}</div>
      </article>
    `;
  }).join("");

  host.innerHTML = `
    ${renderPageHeading("EXAM NOTES", "시험 정리", "과목별 중간·기말 기준과 시험 범위를 자유롭게 기록합니다.", `<button class="primary-button" type="button" data-action="add-exam">시험 추가</button>`)}
    <div class="exam-grid">${examCards}</div>
  `;
}

function renderChapelSeatMap(chapel) {
  const start = Number(chapel.rowStart);
  const end = Number(chapel.rowEnd);
  const target = Number(chapel.seat);
  if (!Number.isInteger(start) || !Number.isInteger(end) || !Number.isInteger(target) || target < start || target > end) return "";

  const seats = Array.from({ length: end - start + 1 }, (_, index) => start + index);
  return `
    <div class="chapel-mini-map" aria-label="${escapeHtml(chapel.area)}구역 ${start}번부터 ${end}번 좌석 줄에서 ${target}번 위치">
      <div class="chapel-stage-line"><span></span><strong>무대 방향</strong><span></span></div>
      <div class="seat-line-head"><span>${start}번</span><small>${escapeHtml(chapel.area)}구역 · 같은 줄</small><span>${end}번</span></div>
      <div class="seat-line" style="--seat-count:${seats.length}">
        ${seats.map((seat) => `<span class="seat-cell${seat === target ? " active" : ""}" aria-label="${seat}번${seat === target ? ", 내 자리" : ""}">${seat === target ? `<strong>${seat}</strong>` : ""}</span>`).join("")}
      </div>
      <p class="seat-line-summary"><span class="seat-legend-dot"></span><strong>내 자리 ${target}번</strong><span>${start}번–${end}번 줄</span></p>
    </div>
  `;
}

function renderChapelView() {
  const host = document.getElementById("view-chapel");
  host.innerHTML = `
    ${renderPageHeading("CHAPEL SEAT", "채플 좌석", "내 자리와 같은 줄의 양 끝 번호를 함께 확인합니다.")}
    <div class="chapel-seat-grid">
      ${semester.chapels.map((chapel) => `
        <article class="chapel-seat-card">
          <div class="chapel-seat-meta"><span>월요일</span><strong>${escapeHtml(chapel.period)}</strong></div>
          <div class="chapel-seat-heading">
            <div class="seat-number-badge"><span>${escapeHtml(chapel.area)}구역</span><strong>${escapeHtml(chapel.seat)}</strong></div>
            <div><small>좌석 위치</small><h2>${escapeHtml(chapel.area)}구역 ${escapeHtml(chapel.seat)}번</h2><p>${escapeHtml(chapel.name)} · ${escapeHtml(chapel.division)}분반</p></div>
          </div>
          ${renderChapelSeatMap(chapel)}
        </article>
      `).join("")}
    </div>
  `;
}

function renderTextList(items, emptyText) {
  const list = Array.isArray(items) ? items.filter(Boolean) : [];
  if (!list.length) return `<div class="compact-empty">${escapeHtml(emptyText)}</div>`;
  return `<ul class="detail-list">${list.map((item) => `<li>${escapeHtml(typeof item === "string" ? item : item.text || item.title || JSON.stringify(item))}</li>`).join("")}</ul>`;
}

function renderCoursePlan(course) {
  const grading = Array.isArray(course.grading) ? course.grading : [];
  return `
    <div class="course-plan-grid">
      <section class="content-card course-overview-card">
        <div class="content-card-head"><div><p class="eyebrow">COURSE SUMMARY</p><h2>수업 정리</h2></div></div>
        <p class="course-description">${escapeHtml(course.description || "수업계획서에 별도 교과목 개요가 없습니다.")}</p>
        <dl class="info-list"><div><dt>교과목 코드</dt><dd>${escapeHtml(course.code || "미기재")}</dd></div><div><dt>학점</dt><dd>${escapeHtml(course.credits || "미기재")}</dd></div><div><dt>담당 교수</dt><dd>${escapeHtml(course.professor || "미기재")}</dd></div><div><dt>수업 형태</dt><dd>${escapeHtml(course.modality || courseTypeLabel(course))}</dd></div></dl>
      </section>
      <section class="content-card"><div class="content-card-head"><div><p class="eyebrow">GOALS</p><h2>학습 목표</h2></div></div>${renderTextList(course.goals, "학습 목표가 별도로 기재되지 않았어요.")}</section>
      <section class="content-card"><div class="content-card-head"><div><p class="eyebrow">GRADING</p><h2>평가 기준</h2></div></div>${grading.length ? `<div class="grading-list">${grading.map((item) => `<div><span>${escapeHtml(item.label || item.name || "평가")}</span><strong>${escapeHtml(item.value ?? item.percent ?? "")}${typeof (item.value ?? item.percent) === "number" ? "%" : ""}</strong></div>`).join("")}</div>` : `<div class="compact-empty">평가 기준이 기재되지 않았어요.</div>`}</section>
      <section class="content-card"><div class="content-card-head"><div><p class="eyebrow">TEXTBOOK</p><h2>교재·참고자료</h2></div></div>${renderTextList(course.textbooks, "교재가 별도로 기재되지 않았어요.")}</section>
      <section class="content-card plan-wide-card"><div class="content-card-head"><div><p class="eyebrow">CLASS POLICY</p><h2>수업 운영·유의사항</h2></div></div>${renderTextList(course.policies, "추가로 확인할 수업 운영 안내가 없어요.")}</section>
      <section class="content-card plan-wide-card">
        <div class="content-card-head"><div><p class="eyebrow">WEEKLY PREVIEW</p><h2>주차별 미리보기</h2></div><button class="icon-text-button" type="button" data-course-tab="weeks">전체 보기 →</button></div>
        <div class="week-preview-list">${(course.weeks || []).slice(0, 5).map((week) => `<button type="button" data-action="edit-week" data-course-id="${course.id}" data-week="${week.week}"><span>${week.week}주</span><strong>${escapeHtml(week.topic || "수업 내용 미정")}</strong><small>${escapeHtml(formatDate(week.date))}</small></button>`).join("")}</div>
      </section>
    </div>
  `;
}

function renderCourseWeeks(course) {
  return `
    <div class="weeks-heading"><div><p class="eyebrow">WEEKLY NOTES</p><h2>매주 수업 내용과 메모</h2></div><small>메모는 입력하는 동안 자동 저장돼요.</small></div>
    <div class="weeks-list">
      ${(course.weeks || []).map((week) => `
        <article class="week-card${week.reviewed ? " reviewed" : ""}">
          <header>
            <div class="week-number"><span>${week.week}</span><small>WEEK</small></div>
            <div class="week-title"><small>${escapeHtml(formatDate(week.date))}</small><h3>${escapeHtml(week.topic || "수업 내용 미정")}</h3>${week.detail ? `<p>${escapeHtml(week.detail)}</p>` : ""}</div>
            <label class="review-toggle"><input type="checkbox" data-week-review="${course.id}:${week.week}" ${week.reviewed ? "checked" : ""} /><span>복습 완료</span></label>
          </header>
          <textarea rows="3" data-week-note="${course.id}:${week.week}" placeholder="이 주차 수업에서 배운 내용, 교수님 말씀, 궁금한 점을 자유롭게 적으세요.">${escapeHtml(week.note || "")}</textarea>
          <footer><span>${week.assignment ? `과제 · ${escapeHtml(week.assignment)}` : "등록된 과제 없음"}</span><button class="icon-text-button" type="button" data-action="edit-week" data-course-id="${course.id}" data-week="${week.week}">주차 정보 수정</button></footer>
        </article>
      `).join("")}
    </div>
  `;
}

function renderCourseExams(course) {
  const exams = semester.exams.filter((exam) => exam.courseId === course.id);
  return `
    <div class="single-course-exams">
      <section class="content-card"><div class="content-card-head"><div><p class="eyebrow">EXAM STANDARD</p><h2>시험 기준 메모</h2></div></div><textarea class="large-note" rows="9" data-exam-memo="${course.id}" placeholder="중간·기말 시험 범위, 출제 기준, 준비해야 할 내용을 적으세요.">${escapeHtml(course.examMemo || "")}</textarea></section>
      <section class="content-card"><div class="content-card-head"><div><p class="eyebrow">EXAM SCHEDULE</p><h2>시험 일정</h2></div><button class="primary-button small" type="button" data-action="add-exam" data-course-id="${course.id}">시험 추가</button></div><div class="exam-list">${exams.length ? exams.map(renderExamItem).join("") : `<div class="compact-empty">아직 등록된 시험 일정이 없어요.</div>`}</div></section>
    </div>
  `;
}

function renderCourseMemo(course) {
  return `<section class="content-card course-memo-card"><div class="content-card-head"><div><p class="eyebrow">FREE NOTE</p><h2>과목 전체 메모</h2></div><span class="autosave-label">자동 저장</span></div><textarea class="course-free-note" rows="20" data-course-memo="${course.id}" placeholder="과목 전체에 관한 공지, 준비물, 교수님 말씀, 학습 계획을 자유롭게 적으세요.">${escapeHtml(course.courseMemo || "")}</textarea></section>`;
}

function renderCourseView() {
  const host = document.getElementById("view-course");
  const course = courseById(ui.courseId) || semester.courses[0];
  if (!course) return;
  const tabs = [["plan", "수업계획"], ["weeks", "주차별 수업"], ["exams", "시험"], ["memo", "메모"]];
  const tabContent = ui.courseTab === "weeks" ? renderCourseWeeks(course) : ui.courseTab === "exams" ? renderCourseExams(course) : ui.courseTab === "memo" ? renderCourseMemo(course) : renderCoursePlan(course);
  host.innerHTML = `
    <div class="course-hero" style="--course-color:${course.color}">
      <div class="course-hero-main"><button class="back-button" type="button" data-view="schedule">← 시간표</button><p class="eyebrow">${escapeHtml(courseTypeLabel(course).toUpperCase())}</p><h1>${escapeHtml(course.name)}</h1><div class="course-hero-facts"><span>${escapeHtml(course.professor || "교수 정보 미기재")}</span><span>${escapeHtml(course.meetingLabel || "시간 미정")}</span><span>${escapeHtml(course.location || "장소 미정")}</span></div></div>
      <button class="soft-button" type="button" data-action="edit-course" data-course-id="${course.id}">기본 정보 수정</button>
    </div>
    <nav class="course-tabs" aria-label="과목 상세 메뉴">${tabs.map(([value, label]) => `<button type="button" class="${ui.courseTab === value ? "active" : ""}"${ui.courseTab === value ? ' aria-current="page"' : ""} data-course-tab="${value}">${label}</button>`).join("")}</nav>
    <div class="course-tab-content">${tabContent}</div>
  `;
}

function openDialog({ eyebrow = "EDIT", title, body, submitLabel = "저장", onSubmit }) {
  const dialog = document.getElementById("editorDialog");
  document.getElementById("dialogEyebrow").textContent = eyebrow;
  document.getElementById("dialogTitle").textContent = title;
  const form = document.getElementById("editorForm");
  form.innerHTML = `${body}<div class="dialog-actions"><button class="soft-button" type="button" data-dialog-cancel>취소</button><button class="primary-button" type="submit">${escapeHtml(submitLabel)}</button></div>`;
  currentDialogSubmit = onSubmit;
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
  requestAnimationFrame(() => form.querySelector("input, textarea, select")?.focus());
}

function closeDialog() {
  const dialog = document.getElementById("editorDialog");
  currentDialogSubmit = null;
  if (dialog.open && typeof dialog.close === "function") dialog.close();
  else dialog.removeAttribute("open");
}

function courseOptions(selected = "") {
  return semester.courses.map((course) => `<option value="${course.id}" ${course.id === selected ? "selected" : ""}>${escapeHtml(course.name)}</option>`).join("");
}

function openTaskEditor(courseId = semester.courses[0]?.id, taskId = "") {
  const task = semester.tasks.find((item) => item.id === taskId);
  openDialog({
    eyebrow: task ? "EDIT CHECK" : "NEW CHECK",
    title: task ? "체크리스트 수정" : "체크리스트 추가",
    submitLabel: task ? "수정 저장" : "추가",
    body: `
      <div class="form-grid">
        <label class="field full"><span>항목 이름</span><input name="title" required maxlength="120" value="${escapeHtml(task?.title || "")}" placeholder="예: 3주차 강의 시청" /></label>
        <label class="field"><span>과목</span><select name="courseId">${courseOptions(task?.courseId || courseId)}</select></label>
        <label class="field"><span>구분</span><select name="type">${[["assignment", "과제"], ["online", "강의 시청"], ["quiz", "퀴즈"], ["review", "복습"], ["other", "기타"]].map(([value, label]) => `<option value="${value}" ${task?.type === value ? "selected" : ""}>${label}</option>`).join("")}</select></label>
        <label class="field"><span>마감일</span><input name="dueDate" type="date" value="${escapeHtml(task?.dueDate || "")}" /></label>
        <div class="field check-field"><span>상태</span><label><input name="completed" type="checkbox" ${task?.completed ? "checked" : ""} /> 완료됨</label></div>
        <label class="field full"><span>메모</span><textarea name="notes" rows="4" placeholder="제출 링크, 준비물 등을 적으세요.">${escapeHtml(task?.notes || "")}</textarea></label>
      </div>
      ${task ? `<button class="delete-button" type="button" data-delete-task="${task.id}">이 항목 삭제</button>` : ""}
    `,
    onSubmit: (formData) => {
      const next = { id: task?.id || makeId("task"), title: String(formData.get("title") || "").trim(), courseId: String(formData.get("courseId") || ""), type: String(formData.get("type") || "other"), dueDate: String(formData.get("dueDate") || ""), notes: String(formData.get("notes") || "").trim(), completed: formData.get("completed") === "on" };
      if (task) Object.assign(task, next);
      else semester.tasks.push(next);
      semester.tasks.sort(compareTasksByDueDate);
      persistSemester();
      renderActiveView();
      showToast(task ? "체크리스트를 수정했어요." : "체크리스트에 추가했어요.");
    }
  });
}

function openExamEditor(courseId = semester.courses[0]?.id, examId = "") {
  const exam = semester.exams.find((item) => item.id === examId);
  openDialog({
    eyebrow: exam ? "EDIT EXAM" : "NEW EXAM",
    title: exam ? "시험 정보 수정" : "시험 일정 추가",
    submitLabel: exam ? "수정 저장" : "추가",
    body: `
      <div class="form-grid">
        <label class="field full"><span>시험 이름</span><input name="title" required value="${escapeHtml(exam?.title || "")}" placeholder="예: 중간고사" /></label>
        <label class="field"><span>과목</span><select name="courseId">${courseOptions(exam?.courseId || courseId)}</select></label>
        <label class="field"><span>구분</span><select name="type">${[["midterm", "중간"], ["final", "기말"], ["quiz", "퀴즈"], ["other", "기타"]].map(([value, label]) => `<option value="${value}" ${exam?.type === value ? "selected" : ""}>${label}</option>`).join("")}</select></label>
        <label class="field"><span>날짜</span><input name="date" type="date" value="${escapeHtml(exam?.date || "")}" /></label>
        <label class="field"><span>시간·장소</span><input name="location" value="${escapeHtml(exam?.location || "")}" placeholder="예: 14:00 · 본부 210" /></label>
        <label class="field full"><span>시험 범위</span><textarea name="range" rows="4" placeholder="시험 범위를 적으세요.">${escapeHtml(exam?.range || "")}</textarea></label>
        <label class="field full"><span>출제 기준·준비 메모</span><textarea name="criteria" rows="4" placeholder="문항 형식, 준비물, 교수님 공지 등을 적으세요.">${escapeHtml(exam?.criteria || "")}</textarea></label>
      </div>
      ${exam ? `<button class="delete-button" type="button" data-delete-exam="${exam.id}">이 시험 삭제</button>` : ""}
    `,
    onSubmit: (formData) => {
      const next = { id: exam?.id || makeId("exam"), title: String(formData.get("title") || "").trim(), courseId: String(formData.get("courseId") || ""), type: String(formData.get("type") || "other"), date: String(formData.get("date") || ""), location: String(formData.get("location") || "").trim(), range: String(formData.get("range") || "").trim(), criteria: String(formData.get("criteria") || "").trim() };
      if (exam) Object.assign(exam, next);
      else semester.exams.push(next);
      persistSemester();
      renderActiveView();
      showToast(exam ? "시험 정보를 수정했어요." : "시험 일정을 추가했어요.");
    }
  });
}

function openWeekEditor(courseId, weekNumber) {
  const course = courseById(courseId);
  const week = course?.weeks?.find((item) => Number(item.week) === Number(weekNumber));
  if (!course || !week) return;
  openDialog({
    eyebrow: `WEEK ${week.week}`,
    title: `${course.shortName || course.name} 주차 수정`,
    body: `
      <div class="form-grid">
        <label class="field"><span>날짜</span><input name="date" type="date" value="${escapeHtml(week.date || "")}" /></label>
        <label class="field"><span>주차</span><input value="${week.week}주차" disabled /></label>
        <label class="field full"><span>수업 주제</span><input name="topic" required value="${escapeHtml(week.topic || "")}" /></label>
        <label class="field full"><span>세부 내용</span><textarea name="detail" rows="4">${escapeHtml(week.detail || "")}</textarea></label>
        <label class="field full"><span>자료·교재 범위</span><textarea name="materials" rows="3">${escapeHtml(week.materials || "")}</textarea></label>
        <label class="field full"><span>과제·준비사항</span><textarea name="assignment" rows="3">${escapeHtml(week.assignment || "")}</textarea></label>
      </div>
    `,
    onSubmit: (formData) => {
      week.date = String(formData.get("date") || "");
      week.topic = String(formData.get("topic") || "").trim();
      week.detail = String(formData.get("detail") || "").trim();
      week.materials = String(formData.get("materials") || "").trim();
      week.assignment = String(formData.get("assignment") || "").trim();
      persistSemester();
      renderActiveView();
      showToast("주차 정보를 수정했어요.");
    }
  });
}

function openEventEditor(date = ui.selectedDate, eventId = "") {
  const event = semester.customEvents.find((item) => item.id === eventId);
  openDialog({
    eyebrow: event ? "EDIT EVENT" : "NEW EVENT",
    title: event ? "일정 수정" : "캘린더 일정 추가",
    submitLabel: event ? "수정 저장" : "추가",
    body: `
      <div class="form-grid">
        <label class="field full"><span>제목</span><input name="title" required value="${escapeHtml(event?.title || "")}" placeholder="예: 발표 자료 준비" /></label>
        <label class="field"><span>날짜</span><input name="date" type="date" required value="${escapeHtml(event?.date || date)}" /></label>
        <label class="field"><span>과목</span><select name="courseId"><option value="">과목 없음</option>${courseOptions(event?.courseId || "")}</select></label>
        <label class="field full"><span>메모</span><textarea name="detail" rows="5" placeholder="일정에 관한 내용을 자유롭게 적으세요.">${escapeHtml(event?.detail || "")}</textarea></label>
      </div>
      ${event ? `<button class="delete-button" type="button" data-delete-event="${event.id}">이 일정 삭제</button>` : ""}
    `,
    onSubmit: (formData) => {
      const next = { id: event?.id || makeId("event"), title: String(formData.get("title") || "").trim(), date: String(formData.get("date") || ""), courseId: String(formData.get("courseId") || ""), detail: String(formData.get("detail") || "").trim() };
      if (event) Object.assign(event, next);
      else semester.customEvents.push(next);
      ui.selectedDate = next.date;
      const selected = dateFromIso(next.date);
      if (selected) ui.calendarCursor = new Date(selected.getFullYear(), selected.getMonth(), 1, 12);
      persistSemester();
      renderCalendarView();
      showToast(event ? "일정을 수정했어요." : "캘린더에 추가했어요.");
    }
  });
}

function openCourseEditor(courseId) {
  const course = courseById(courseId);
  if (!course) return;
  openDialog({
    eyebrow: "COURSE INFO",
    title: `${course.shortName || course.name} 기본 정보`,
    body: `
      <div class="form-grid">
        <label class="field"><span>담당 교수</span><input name="professor" value="${escapeHtml(course.professor || "")}" /></label>
        <label class="field"><span>교수 정보</span><input name="professorInfo" value="${escapeHtml(course.professorInfo || "")}" placeholder="연구실·상담시간 등" /></label>
        <label class="field"><span>수업 시간</span><input name="meetingLabel" value="${escapeHtml(course.meetingLabel || "")}" /></label>
        <label class="field"><span>강의실</span><input name="location" value="${escapeHtml(course.location || "")}" /></label>
        <label class="field full"><span>수업 한줄 정리</span><textarea name="description" rows="5">${escapeHtml(course.description || "")}</textarea></label>
      </div>
    `,
    onSubmit: (formData) => {
      course.professor = String(formData.get("professor") || "").trim();
      course.professorInfo = String(formData.get("professorInfo") || "").trim();
      course.meetingLabel = String(formData.get("meetingLabel") || "").trim();
      course.location = String(formData.get("location") || "").trim();
      course.description = String(formData.get("description") || "").trim();
      if (course.meetings?.length) course.meetings.forEach((meeting) => { meeting.room = course.location; });
      persistSemester();
      renderActiveView();
      showToast("과목 기본 정보를 수정했어요.");
    }
  });
}

function openCalendarItem(kind, id) {
  if (kind === "custom") return openEventEditor(ui.selectedDate, id);
  if (kind === "task") return openTaskEditor(undefined, id);
  if (kind === "exam") {
    const exam = semester.exams.find((item) => item.id === id);
    return openExamEditor(exam?.courseId, id);
  }
  if (kind === "week") {
    const match = /^week-(.+)-(\d+)$/.exec(id);
    if (match) openWeekEditor(match[1], Number(match[2]));
  }
}

function applyTheme(theme) {
  const next = theme === "light" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  document.querySelector('meta[name="theme-color"]').content = next === "dark" ? "#10131b" : "#eef3f5";
  const toggle = document.getElementById("themeToggle");
  toggle.querySelector(".theme-toggle-label").textContent = next.toUpperCase();
  toggle.setAttribute("aria-label", `${next === "dark" ? "라이트" : "다크"} 모드로 전환`);
  try { localStorage.setItem(THEME_KEY, next); } catch (_) {}
}

function renderActiveView() {
  if (ui.view === "schedule") renderScheduleView();
  else if (ui.view === "tasks") renderTasksView();
  else if (ui.view === "calendar") renderCalendarView();
  else if (ui.view === "exams") renderExamsView();
  else if (ui.view === "chapel") renderChapelView();
  else if (ui.view === "course") renderCourseView();
  renderCourseNavigation();
}

function showView(view, { preserveScroll = true } = {}) {
  if (!document.querySelector(`[data-view-panel="${view}"]`)) return;
  scrollPositions.set(ui.view, window.scrollY);
  ui.view = view;
  document.querySelectorAll("[data-view-panel]").forEach((panel) => {
    const active = panel.dataset.viewPanel === view;
    panel.hidden = !active;
    panel.classList.toggle("active", active);
  });
  document.querySelectorAll(".top-tab").forEach((button) => {
    const active = button.dataset.view === view;
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  renderActiveView();
  closeCourseDock();
  requestAnimationFrame(() => window.scrollTo({ top: preserveScroll ? (scrollPositions.get(view) || 0) : 0, behavior: "auto" }));
}

function openCourse(courseId) {
  ui.courseId = courseId;
  ui.courseTab = "plan";
  showView("course", { preserveScroll: false });
}

function setCourseDock(open) {
  const dock = document.getElementById("courseDock");
  const panel = document.getElementById("coursePanel");
  const isMobile = matchMedia("(max-width: 720px)").matches;
  dock.classList.toggle("open", open);
  document.getElementById("courseDockHandle").setAttribute("aria-expanded", String(open));
  const mobileButton = document.getElementById("mobileMenuButton");
  mobileButton.setAttribute("aria-expanded", String(open));
  mobileButton.setAttribute("aria-label", open ? "과목 메뉴 닫기" : "과목 메뉴 열기");
  panel.setAttribute("aria-hidden", String(isMobile && !open));
  panel.inert = isMobile && !open;
}

function closeCourseDock() {
  setCourseDock(false);
}

function exportData() {
  const payload = JSON.stringify({ ...semester, exportedAt: new Date().toISOString() }, null, 2);
  const blob = new Blob([payload], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `my-semester-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  showToast("학기 데이터를 백업했어요.");
}

async function importData(file) {
  const previousSemester = semester;
  const previousCourseId = ui.courseId;
  const previousView = ui.view;
  let swapped = false;
  try {
    const parsed = JSON.parse(await file.text());
    if (!Array.isArray(parsed?.courses) || !parsed.courses.length) throw new Error("invalid");
    const knownCourseIds = new Set(window.DEFAULT_SEMESTER_DATA.courses.map((course) => course.id));
    if (!parsed.courses.some((course) => isPlainRecord(course) && knownCourseIds.has(course.id))) throw new Error("invalid");
    const nextSemester = normalizeSemesterData(parsed);
    semester = nextSemester;
    swapped = true;
    ui.courseId = semester.courses[0]?.id || "";
    showView("schedule", { preserveScroll: false });
    persistSemester();
    showToast("백업 데이터를 불러왔어요.");
  } catch (_) {
    if (swapped) {
      semester = previousSemester;
      ui.courseId = previousCourseId;
      showView(previousView, { preserveScroll: true });
    }
    showToast("이 파일은 학기 백업 파일이 아니에요.");
  }
}

function resetData() {
  if (!confirm("직접 작성한 메모와 체크 상태를 지우고 처음 데이터로 돌아갈까요? 먼저 백업하는 것을 권장해요.")) return;
  semester = clone(window.DEFAULT_SEMESTER_DATA);
  persistSemester();
  ui.courseId = semester.courses[0]?.id || "";
  showView("schedule", { preserveScroll: false });
  showToast("처음 데이터로 되돌렸어요.");
}

function bindEvents() {
  document.addEventListener("click", (event) => {
    const viewButton = event.target.closest("[data-view]");
    if (viewButton) {
      showView(viewButton.dataset.view, { preserveScroll: false });
      return;
    }

    const openCourseButton = event.target.closest("[data-open-course]");
    if (openCourseButton) {
      openCourse(openCourseButton.dataset.openCourse);
      return;
    }

    const peekCourse = event.target.closest("[data-peek-course]");
    if (peekCourse) {
      const course = courseById(peekCourse.dataset.peekCourse);
      if (course) showCoursePeek(course);
      return;
    }

    const peekChapel = event.target.closest("[data-peek-chapel]");
    if (peekChapel) {
      const session = semester.chapels.find((item) => item.id === peekChapel.dataset.peekChapel);
      if (session) showChapelPeek(session);
      return;
    }

    const courseTab = event.target.closest("[data-course-tab]");
    if (courseTab) {
      ui.courseTab = courseTab.dataset.courseTab;
      renderCourseView();
      return;
    }

    const taskFilter = event.target.closest("[data-task-filter]");
    if (taskFilter) {
      ui.taskFilter = taskFilter.dataset.taskFilter;
      renderTasksView();
      return;
    }

    const calendarDay = event.target.closest("[data-calendar-day]");
    if (calendarDay) {
      ui.selectedDate = calendarDay.dataset.calendarDay;
      const selected = dateFromIso(ui.selectedDate);
      if (selected) ui.calendarCursor = new Date(selected.getFullYear(), selected.getMonth(), 1, 12);
      renderCalendarView();
      return;
    }

    const calendarMove = event.target.closest("[data-calendar-move]");
    if (calendarMove) {
      ui.calendarCursor = new Date(ui.calendarCursor.getFullYear(), ui.calendarCursor.getMonth() + Number(calendarMove.dataset.calendarMove), 1, 12);
      ui.selectedDate = isoFromDate(ui.calendarCursor);
      renderCalendarView();
      return;
    }

    if (event.target.closest("[data-calendar-today]")) {
      const today = new Date();
      ui.calendarCursor = new Date(today.getFullYear(), today.getMonth(), 1, 12);
      ui.selectedDate = isoFromDate(today);
      renderCalendarView();
      return;
    }

    const calendarItem = event.target.closest("[data-calendar-kind][data-calendar-id]");
    if (calendarItem) {
      openCalendarItem(calendarItem.dataset.calendarKind, calendarItem.dataset.calendarId);
      return;
    }

    const action = event.target.closest("[data-action]");
    if (action) {
      if (action.dataset.action === "add-task") openTaskEditor(action.dataset.courseId);
      else if (action.dataset.action === "edit-task") openTaskEditor(undefined, action.dataset.taskId);
      else if (action.dataset.action === "add-exam") openExamEditor(action.dataset.courseId);
      else if (action.dataset.action === "edit-exam") openExamEditor(undefined, action.dataset.examId);
      else if (action.dataset.action === "add-event") openEventEditor(action.dataset.date || ui.selectedDate);
      else if (action.dataset.action === "edit-week") openWeekEditor(action.dataset.courseId, action.dataset.week);
      else if (action.dataset.action === "edit-course") openCourseEditor(action.dataset.courseId);
      return;
    }

    if (event.target.closest("[data-dialog-cancel]")) {
      closeDialog();
      return;
    }

    const deleteTask = event.target.closest("[data-delete-task]");
    if (deleteTask && confirm("이 체크리스트 항목을 삭제할까요?")) {
      semester.tasks = semester.tasks.filter((task) => task.id !== deleteTask.dataset.deleteTask);
      persistSemester();
      closeDialog();
      renderActiveView();
      showToast("항목을 삭제했어요.");
      return;
    }

    const deleteExam = event.target.closest("[data-delete-exam]");
    if (deleteExam && confirm("이 시험 정보를 삭제할까요?")) {
      semester.exams = semester.exams.filter((exam) => exam.id !== deleteExam.dataset.deleteExam);
      persistSemester();
      closeDialog();
      renderActiveView();
      showToast("시험 정보를 삭제했어요.");
      return;
    }

    const deleteEvent = event.target.closest("[data-delete-event]");
    if (deleteEvent && confirm("이 일정을 삭제할까요?")) {
      semester.customEvents = semester.customEvents.filter((item) => item.id !== deleteEvent.dataset.deleteEvent);
      persistSemester();
      closeDialog();
      renderCalendarView();
      showToast("일정을 삭제했어요.");
    }
  });

  document.addEventListener("change", (event) => {
    const taskToggle = event.target.closest("[data-task-toggle]");
    if (taskToggle) {
      const taskId = taskToggle.dataset.taskToggle;
      const task = semester.tasks.find((item) => item.id === taskToggle.dataset.taskToggle);
      if (task) task.completed = taskToggle.checked;
      persistSemester();
      renderActiveView();
      requestAnimationFrame(() => [...document.querySelectorAll("[data-task-toggle]")].find((input) => input.dataset.taskToggle === taskId)?.focus());
    }

    const weekReview = event.target.closest("[data-week-review]");
    if (weekReview) {
      const [courseId, weekNumber] = weekReview.dataset.weekReview.split(":");
      const week = courseById(courseId)?.weeks?.find((item) => Number(item.week) === Number(weekNumber));
      if (week) week.reviewed = weekReview.checked;
      persistSemester();
      renderCourseView();
    }
  });

  document.addEventListener("input", (event) => {
    const weekNote = event.target.closest("[data-week-note]");
    if (weekNote) {
      const [courseId, weekNumber] = weekNote.dataset.weekNote.split(":");
      const week = courseById(courseId)?.weeks?.find((item) => Number(item.week) === Number(weekNumber));
      if (week) week.note = weekNote.value;
      schedulePersist();
    }

    const examMemo = event.target.closest("[data-exam-memo]");
    if (examMemo) {
      const course = courseById(examMemo.dataset.examMemo);
      if (course) course.examMemo = examMemo.value;
      schedulePersist();
    }

    const courseMemo = event.target.closest("[data-course-memo]");
    if (courseMemo) {
      const course = courseById(courseMemo.dataset.courseMemo);
      if (course) course.courseMemo = courseMemo.value;
      schedulePersist();
    }
  });

  document.getElementById("editorForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const submit = currentDialogSubmit;
    if (!submit) return;
    submit(new FormData(event.currentTarget));
    closeDialog();
  });

  document.getElementById("dialogCloseButton").addEventListener("click", closeDialog);
  document.getElementById("editorDialog").addEventListener("click", (event) => { if (event.target === event.currentTarget) closeDialog(); });
  document.getElementById("themeToggle").addEventListener("click", () => applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"));

  const dock = document.getElementById("courseDock");
  document.getElementById("courseDockHandle").addEventListener("click", () => setCourseDock(!dock.classList.contains("open")));
  document.getElementById("mobileMenuButton").addEventListener("click", () => setCourseDock(true));
  dock.addEventListener("click", (event) => { if (event.target === dock) closeCourseDock(); });

  document.getElementById("exportDataButton").addEventListener("click", exportData);
  document.getElementById("importDataButton").addEventListener("click", () => document.getElementById("importDataInput").click());
  document.getElementById("resetDataButton").addEventListener("click", resetData);
  document.getElementById("importDataInput").addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    if (file) importData(file);
    event.target.value = "";
  });

  document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeCourseDock(); });
  window.addEventListener("pagehide", () => {
    clearTimeout(saveTimer);
    persistSemester();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "hidden") return;
    clearTimeout(saveTimer);
    persistSemester();
  });
  matchMedia("(max-width: 720px)").addEventListener("change", () => setCourseDock(false));
}

function init() {
  bindEvents();
  applyTheme(document.documentElement.dataset.theme);
  setCourseDock(false);
  renderCourseNavigation();
  renderScheduleView();
}

init();
