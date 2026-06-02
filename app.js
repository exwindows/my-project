const STORAGE_KEY = "fortoefl.state.v1";
const DEFAULT_HINT_SETTING = { mode: "fixed", count: 3 };
const MAX_HINT_LETTERS = 4;

const fileInput = document.querySelector("#wordFile");
const manualWordText = document.querySelector("#manualWordText");
const importTextButton = document.querySelector("#importTextButton");
const uploadMessage = document.querySelector("#uploadMessage");
const libraryCount = document.querySelector("#libraryCount");
const resetButton = document.querySelector("#resetButton");
const clearButton = document.querySelector("#clearButton");
const hintButtons = document.querySelectorAll("[data-hint-option]");
const attemptedCount = document.querySelector("#attemptedCount");
const correctCount = document.querySelector("#correctCount");
const accuracyRate = document.querySelector("#accuracyRate");
const streakCount = document.querySelector("#streakCount");
const currentNumber = document.querySelector("#currentNumber");
const totalNumber = document.querySelector("#totalNumber");
const emptyState = document.querySelector("#emptyState");
const quizState = document.querySelector("#quizState");
const meaningText = document.querySelector("#meaningText");
const hintText = document.querySelector("#hintText");
const answerForm = document.querySelector("#answerForm");
const answerInput = document.querySelector("#answerInput");
const feedbackMessage = document.querySelector("#feedbackMessage");
const nextButton = document.querySelector("#nextButton");
const mistakeCount = document.querySelector("#mistakeCount");
const mistakeList = document.querySelector("#mistakeList");

let state = loadState();

if (state.words.length > 0 && state.currentIndex >= state.words.length) {
  state.currentIndex = 0;
}

render();

fileInput.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;

  try {
    const text = await file.text();
    await importWordsFromText(text);
  } catch {
    showUploadMessage("文件读取失败，请换一个 CSV 或 TXT 文件。", "error");
  } finally {
    fileInput.value = "";
  }
});

importTextButton.addEventListener("click", () => {
  importWordsFromText(manualWordText.value);
});

answerForm.addEventListener("submit", (event) => {
  event.preventDefault();
  submitAnswer();
});

nextButton.addEventListener("click", () => {
  moveToNextWord();
  render();
  answerInput.focus();
});

resetButton.addEventListener("click", () => {
  if (state.words.length === 0) return;

  state.stats = createEmptyStats();
  state.currentIndex = 0;
  state.currentHint = createHintForWord(state.words[0].word, state.hintSetting);
  saveState();
  render();
  showFeedback("练习已重新开始。", "neutral");
  answerInput.focus();
});

clearButton.addEventListener("click", () => {
  state = createFreshState([], state.hintSetting);
  saveState();
  render();
  showUploadMessage("词库已清空。", "success");
});

hintButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const option = button.dataset.hintOption;
    state.hintSetting = option === "random"
      ? { mode: "random", count: null }
      : { mode: "fixed", count: Number(option) };

    const currentWord = getCurrentWord();
    if (currentWord) {
      state.currentHint = createHintForWord(currentWord.word, state.hintSetting);
      showFeedback(`提示字母数已切换为 ${formatHintSetting(state.hintSetting)}。`, "neutral");
      answerInput.focus();
    } else {
      showUploadMessage(`提示字母数已切换为 ${formatHintSetting(state.hintSetting)}。`, "success");
    }

    saveState();
    render();
  });
});

function submitAnswer() {
  const currentWord = getCurrentWord();
  if (!currentWord) return;

  const answer = normalizeAnswer(answerInput.value);
  const expected = normalizeAnswer(currentWord.word);

  if (!answer) {
    showFeedback("请输入完整拼写。", "error");
    answerInput.focus();
    return;
  }

  state.stats.attempted += 1;

  if (answer === expected) {
    state.stats.correct += 1;
    state.stats.streak += 1;
    showFeedback("正确。准备下一题。", "success");
    moveToNextWord({ keepFeedback: true });
  } else {
    state.stats.streak = 0;
    addMistake(currentWord, answerInput.value);
    showFeedback(`错误。正确拼写是 ${currentWord.word}。`, "error");
  }

  answerInput.value = "";
  saveState();
  render();
  answerInput.focus();
}

async function importWordsFromText(text) {
  const words = parseWordList(text);

  if (words.length === 0) {
    showUploadMessage("没有找到可用的英文单词。", "error");
    manualWordText.focus();
    return;
  }

  state = createFreshState(words, state.hintSetting);
  manualWordText.value = "";
  answerInput.value = "";
  feedbackMessage.textContent = "";
  feedbackMessage.dataset.type = "";
  saveState();
  render();
  const lookupCount = words.filter((word) => word.needsMeaningLookup).length;
  showUploadMessage(
    lookupCount > 0
      ? `已导入 ${words.length} 个单词，正在自动补全 ${lookupCount} 个释义。`
      : `已导入 ${words.length} 个单词。`,
    "success"
  );
  answerInput.focus();

  if (lookupCount > 0) {
    importTextButton.disabled = true;
    const filledCount = await enrichMissingMeanings(state.words);
    importTextButton.disabled = false;
    saveState();
    render();
    showUploadMessage(`已导入 ${words.length} 个单词，自动补全 ${filledCount} 个释义。`, "success");
  }
}

function moveToNextWord(options = {}) {
  if (state.words.length === 0) return;

  state.currentIndex = (state.currentIndex + 1) % state.words.length;
  state.currentHint = createHintForWord(state.words[state.currentIndex].word, state.hintSetting);
  if (!options.keepFeedback) {
    feedbackMessage.textContent = "";
    feedbackMessage.dataset.type = "";
  }
  saveState();
}

function parseWordList(text) {
  const seen = new Set();

  return text
    .split(/\r?\n/)
    .map((line) => parseWordLine(line))
    .filter(Boolean)
    .filter((entry) => {
      const key = entry.word.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function parseWordLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return null;

  const cells = splitCsvLine(trimmed);
  const word = cleanWord(cells[0]);
  const meaning = cells.slice(1).join(",").trim();
  if (!word || !/[a-z]/i.test(word)) return null;

  return {
    id: crypto.randomUUID(),
    word,
    meaning: meaning || "正在查询释义...",
    needsMeaningLookup: !meaning,
  };
}

async function enrichMissingMeanings(words) {
  let filledCount = 0;

  await Promise.all(words.map(async (entry) => {
    if (!entry.needsMeaningLookup) return;

    const meaning = await lookupChineseMeaning(entry.word);
    entry.meaning = meaning || "暂无释义";
    entry.needsMeaningLookup = false;
    if (meaning) filledCount += 1;
  }));

  return filledCount;
}

async function lookupChineseMeaning(word) {
  try {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(word)}&langpair=en%7Czh-CN`;
    const response = await fetch(url);
    if (!response.ok) return "";

    const data = await response.json();
    return String(data.responseData?.translatedText ?? "").trim();
  } catch {
    return "";
  }
}

function splitCsvLine(line) {
  const cells = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }

  cells.push(current.trim());
  return cells;
}

function cleanWord(value) {
  return String(value ?? "")
    .trim()
    .replace(/^"|"$/g, "")
    .replace(/\s+/g, " ");
}

function createHintForWord(word, hintSetting = DEFAULT_HINT_SETTING) {
  const letters = Array.from(word);
  const letterIndexes = letters
    .map((char, index) => ({ char, index }))
    .filter(({ char }) => /[a-z]/i.test(char))
    .map(({ index }) => index);

  const revealCount = getRevealCount(letterIndexes.length, hintSetting);
  const revealIndexes = new Set(letterIndexes.slice(0, revealCount));

  return letters
    .map((char, index) => {
      if (!/[a-z]/i.test(char)) return char;
      return revealIndexes.has(index) ? char : "_";
    })
    .join(" ");
}

function getRevealCount(letterCount, hintSetting) {
  if (letterCount === 0) return 0;

  if (hintSetting?.mode === "random") {
    const maxCount = Math.min(MAX_HINT_LETTERS, letterCount);
    return Math.floor(Math.random() * maxCount) + 1;
  }

  const fixedCount = Number(hintSetting?.count ?? DEFAULT_HINT_SETTING.count);
  return Math.min(Math.max(1, fixedCount), letterCount);
}

function addMistake(word, answer) {
  const existingIndex = state.stats.mistakes.findIndex((item) => item.word === word.word);
  const mistake = {
    word: word.word,
    meaning: word.meaning,
    lastAnswer: answer.trim() || "-",
    count: 1,
  };

  if (existingIndex >= 0) {
    const existing = state.stats.mistakes[existingIndex];
    mistake.count = existing.count + 1;
    state.stats.mistakes.splice(existingIndex, 1);
  }

  state.stats.mistakes.unshift(mistake);
  state.stats.mistakes = state.stats.mistakes.slice(0, 20);
}

function render() {
  const hasWords = state.words.length > 0;
  const currentWord = getCurrentWord();
  const accuracy = state.stats.attempted === 0
    ? 0
    : Math.round((state.stats.correct / state.stats.attempted) * 100);

  libraryCount.textContent = `${state.words.length} words`;
  attemptedCount.textContent = String(state.stats.attempted);
  correctCount.textContent = String(state.stats.correct);
  accuracyRate.textContent = `${accuracy}%`;
  streakCount.textContent = String(state.stats.streak);
  currentNumber.textContent = hasWords ? String(state.currentIndex + 1) : "0";
  totalNumber.textContent = String(state.words.length);
  emptyState.hidden = hasWords;
  quizState.hidden = !hasWords;
  resetButton.disabled = !hasWords;
  clearButton.disabled = !hasWords;
  renderHintButtons();

  if (currentWord) {
    meaningText.textContent = currentWord.meaning;
    hintText.textContent = state.currentHint || createHintForWord(currentWord.word, state.hintSetting);
  }

  renderMistakes();
}

function renderMistakes() {
  mistakeCount.textContent = String(state.stats.mistakes.length);

  if (state.stats.mistakes.length === 0) {
    mistakeList.innerHTML = '<p class="muted-text">暂无错题。</p>';
    return;
  }

  mistakeList.innerHTML = state.stats.mistakes
    .map((mistake) => `
      <article class="mistake-item">
        <div>
          <strong>${escapeHtml(mistake.word)}</strong>
          <span>${escapeHtml(mistake.meaning)}</span>
        </div>
        <small>${mistake.count} 次</small>
      </article>
    `)
    .join("");
}

function getCurrentWord() {
  if (state.words.length === 0) return null;
  return state.words[state.currentIndex] ?? state.words[0];
}

function createFreshState(words, hintSetting = DEFAULT_HINT_SETTING) {
  const normalizedHint = normalizeHintSetting(hintSetting);

  return {
    words,
    currentIndex: 0,
    currentHint: words[0] ? createHintForWord(words[0].word, normalizedHint) : "",
    hintSetting: normalizedHint,
    stats: createEmptyStats(),
  };
}

function createEmptyStats() {
  return {
    attempted: 0,
    correct: 0,
    streak: 0,
    mistakes: [],
  };
}

function normalizeAnswer(value) {
  return String(value ?? "").trim().toLowerCase();
}

function showUploadMessage(message, type) {
  uploadMessage.textContent = message;
  uploadMessage.dataset.type = type;
}

function showFeedback(message, type) {
  feedbackMessage.textContent = message;
  feedbackMessage.dataset.type = type;
}

function formatHintSetting(hintSetting) {
  return hintSetting?.mode === "random" ? "随机" : `${hintSetting?.count ?? DEFAULT_HINT_SETTING.count} 个`;
}

function normalizeHintSetting(hintSetting) {
  if (hintSetting?.mode === "random") {
    return { mode: "random", count: null };
  }

  const count = Number(hintSetting?.count ?? DEFAULT_HINT_SETTING.count);
  return {
    mode: "fixed",
    count: Math.min(Math.max(1, count), MAX_HINT_LETTERS),
  };
}

function renderHintButtons() {
  const hintSetting = state.hintSetting ?? DEFAULT_HINT_SETTING;

  hintButtons.forEach((button) => {
    const isActive = hintSetting.mode === "random"
      ? button.dataset.hintOption === "random"
      : button.dataset.hintOption === String(hintSetting.count);
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!saved || !Array.isArray(saved.words)) return createFreshState([]);

    return {
      words: saved.words,
      currentIndex: Number.isInteger(saved.currentIndex) ? saved.currentIndex : 0,
      currentHint: saved.currentHint || "",
      hintSetting: normalizeHintSetting(saved.hintSetting),
      stats: {
        ...createEmptyStats(),
        ...(saved.stats ?? {}),
        mistakes: Array.isArray(saved.stats?.mistakes) ? saved.stats.mistakes : [],
      },
    };
  } catch {
    return createFreshState([]);
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
