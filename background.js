const MTEAM_API_HOST = 'api.m-team.io';
const AUTO_VISIT_DEBOUNCE_MS = 5 * 1000;
const CLOSE_ALARM_PREFIX = 'close-keepalive-tab-';
const WINDOW_CHECK_ALARM = 'check-normal-window';
const PENDING_AUTO_VISIT_RETRY_ALARM = 'pending-auto-visit-retry';
const WINDOW_CHECK_PERIOD_MINUTES = 1;
const PENDING_AUTO_VISIT_RETRY_DELAY_MINUTES = 0.1;
const AUTO_CLOSE_TAB_IDS_KEY = 'autoCloseTabIds';
const LAST_AUTO_VISIT_AT_KEY = 'lastAutoVisitAt';
const HAD_NORMAL_WINDOW_KEY = 'hadNormalWindow';
const PENDING_AUTO_VISIT_REASON_KEY = 'pendingAutoVisitReason';
const AUTO_VISIT_DAILY_COUNTER_KEY = 'autoVisitDailyCounter';
const AUTO_VISIT_DAILY_LIMIT_KEY = 'autoVisitDailyLimit';
const DEFAULT_AUTO_VISIT_DAILY_LIMIT = 2;

const SITES = [
  { name: 'PTHome',   url: 'https://pthome.net/index.php' },
  { name: 'HDArea',   url: 'https://hdarea.club/index.php' },
  { name: 'PTer',     url: 'https://pterclub.net/index.php' },
  { name: 'HDHome',   url: 'https://hdhome.org/index.php' },
  { name: 'BTSCHOOL', url: 'https://pt.btschool.club/index.php' },
  { name: 'HDTime',   url: 'https://hdtime.org/index.php' },
  { name: 'HDDolby',  url: 'https://www.hddolby.com/index.php' },
  { name: 'Skyey2',   url: 'https://www.skyey2.com/index.php' },
  { name: 'U2',       url: 'https://u2.dmhy.org/index.php' },
  { name: 'M-Team',   url: 'https://kp.m-team.cc/index' },
];

let capturedMTeamHeaders = null;
let autoVisitInProgress = false;
const autoCloseTabIds = new Set();

function getStorage(keys) {
  return new Promise(resolve => chrome.storage.local.get(keys, resolve));
}

function setStorage(items) {
  return new Promise(resolve => chrome.storage.local.set(items, resolve));
}

function getNormalWindows() {
  return new Promise(resolve => chrome.windows.getAll({ windowTypes: ['normal'] }, resolve));
}

function ensureWindowCheckAlarm() {
  chrome.alarms.create(WINDOW_CHECK_ALARM, { periodInMinutes: WINDOW_CHECK_PERIOD_MINUTES });
}

function schedulePendingAutoVisitRetry() {
  chrome.alarms.create(PENDING_AUTO_VISIT_RETRY_ALARM, { delayInMinutes: PENDING_AUTO_VISIT_RETRY_DELAY_MINUTES });
}

function clearPendingAutoVisitRetry() {
  chrome.alarms.clear(PENDING_AUTO_VISIT_RETRY_ALARM);
}

function getBeijingDateKey(timestamp = Date.now()) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(timestamp);
}

function sanitizeAutoVisitDailyLimit(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_AUTO_VISIT_DAILY_LIMIT;
  return Math.max(0, Math.floor(parsed));
}

async function getAutoVisitDailyLimit() {
  const { [AUTO_VISIT_DAILY_LIMIT_KEY]: storedLimit } = await getStorage({
    [AUTO_VISIT_DAILY_LIMIT_KEY]: DEFAULT_AUTO_VISIT_DAILY_LIMIT,
  });
  const limit = sanitizeAutoVisitDailyLimit(storedLimit);
  if (limit !== storedLimit) {
    await setStorage({ [AUTO_VISIT_DAILY_LIMIT_KEY]: limit });
  }
  return limit;
}

async function setAutoVisitDailyLimit(limit) {
  const sanitizedLimit = sanitizeAutoVisitDailyLimit(limit);
  await setStorage({ [AUTO_VISIT_DAILY_LIMIT_KEY]: sanitizedLimit });
  return sanitizedLimit;
}

async function getAutoVisitDailyCounter() {
  const today = getBeijingDateKey();
  const { [AUTO_VISIT_DAILY_COUNTER_KEY]: storedCounter } = await getStorage({
    [AUTO_VISIT_DAILY_COUNTER_KEY]: null,
  });

  if (storedCounter?.date === today && Number.isFinite(storedCounter.count)) {
    return storedCounter;
  }

  const resetCounter = { date: today, count: 0 };
  await setStorage({ [AUTO_VISIT_DAILY_COUNTER_KEY]: resetCounter });
  return resetCounter;
}

async function incrementAutoVisitDailyCounter(currentCounter) {
  const today = getBeijingDateKey();
  const nextCounter = currentCounter?.date === today
    ? { date: today, count: currentCounter.count + 1 }
    : { date: today, count: 1 };

  await setStorage({ [AUTO_VISIT_DAILY_COUNTER_KEY]: nextCounter });
  return nextCounter;
}

function shouldCountAgainstDailyLimit(reason) {
  return reason !== 'installed';
}

async function setPendingAutoVisitReason(reason) {
  await setStorage({ [PENDING_AUTO_VISIT_REASON_KEY]: reason });
  schedulePendingAutoVisitRetry();
}

async function clearPendingAutoVisitReason() {
  await setStorage({ [PENDING_AUTO_VISIT_REASON_KEY]: null });
  clearPendingAutoVisitRetry();
}

async function trackAutoCloseTab(tabId) {
  autoCloseTabIds.add(tabId);
  const { [AUTO_CLOSE_TAB_IDS_KEY]: ids = [] } = await getStorage({ [AUTO_CLOSE_TAB_IDS_KEY]: [] });
  await setStorage({ [AUTO_CLOSE_TAB_IDS_KEY]: [...new Set([...ids, tabId])] });
}

async function untrackAutoCloseTab(tabId) {
  autoCloseTabIds.delete(tabId);
  const { [AUTO_CLOSE_TAB_IDS_KEY]: ids = [] } = await getStorage({ [AUTO_CLOSE_TAB_IDS_KEY]: [] });
  await setStorage({ [AUTO_CLOSE_TAB_IDS_KEY]: ids.filter(id => id !== tabId) });
}

function closeKeepAliveTab(tabId) {
  if (!tabId) return;
  chrome.tabs.remove(tabId, () => {
    chrome.runtime.lastError;
    untrackAutoCloseTab(tabId);
  });
}

function scheduleTabClose(tabId) {
  trackAutoCloseTab(tabId);
  chrome.alarms.create(`${CLOSE_ALARM_PREFIX}${tabId}`, { delayInMinutes: 0.5 });
  chrome.tabs.get(tabId, tab => {
    if (chrome.runtime.lastError) return;
    if (tab?.status === 'complete') closeKeepAliveTab(tabId);
  });
}

function openKeepAliveTab(windowId, site) {
  return new Promise(resolve => {
    chrome.tabs.create({ url: site.url, active: false, windowId }, tab => {
      if (chrome.runtime.lastError || !tab?.id) {
        console.warn(`[PT Keeper] failed to open ${site.name}: ${chrome.runtime.lastError?.message || 'unknown error'}`);
        resolve(false);
        return;
      }
      scheduleTabClose(tab.id);
      resolve(true);
    });
  });
}

async function visitAllSites(reason) {
  const windows = await getNormalWindows();
  const targetWindow = windows.find(window => window.focused) || windows[0];
  if (!targetWindow?.id) {
    await setPendingAutoVisitReason(reason);
    return false;
  }

  console.log(`[PT Keeper] running keepalive visits: ${reason}`);
  const results = await Promise.all(SITES.map(site => openKeepAliveTab(targetWindow.id, site)));
  if (!results.some(Boolean)) {
    await setPendingAutoVisitReason(reason);
    return false;
  }

  await clearPendingAutoVisitReason();
  return true;
}

async function runAutoVisit(reason) {
  if (autoVisitInProgress) return;
  autoVisitInProgress = true;

  try {
    const shouldCount = shouldCountAgainstDailyLimit(reason);
    let dailyCounter = null;
    let dailyLimit = DEFAULT_AUTO_VISIT_DAILY_LIMIT;

    if (shouldCount) {
      dailyCounter = await getAutoVisitDailyCounter();
      dailyLimit = await getAutoVisitDailyLimit();
      if (dailyCounter.count >= dailyLimit) {
        console.log(`[PT Keeper] skipped keepalive visits for ${reason}: daily limit reached (${dailyCounter.count}/${dailyLimit})`);
        return;
      }
    }

    const now = Date.now();
    const { [LAST_AUTO_VISIT_AT_KEY]: lastAutoVisitAt = 0 } = await getStorage({ [LAST_AUTO_VISIT_AT_KEY]: 0 });
    if (now - lastAutoVisitAt < AUTO_VISIT_DEBOUNCE_MS) return;

    await setStorage({ [LAST_AUTO_VISIT_AT_KEY]: now });

    const didOpenTabs = await visitAllSites(reason);
    if (!didOpenTabs) {
      await setStorage({ [LAST_AUTO_VISIT_AT_KEY]: lastAutoVisitAt });
      return;
    }

    if (shouldCount) {
      await incrementAutoVisitDailyCounter(dailyCounter);
    }
  } finally {
    autoVisitInProgress = false;
  }
}

async function checkNormalWindowState(reason, force = false) {
  const windows = await getNormalWindows();
  const hasNormalWindow = windows.length > 0;
  const state = await getStorage({
    [HAD_NORMAL_WINDOW_KEY]: false,
    [PENDING_AUTO_VISIT_REASON_KEY]: null,
  });

  const hadNormalWindow = Boolean(state[HAD_NORMAL_WINDOW_KEY]);
  const pendingReason = state[PENDING_AUTO_VISIT_REASON_KEY];

  await setStorage({ [HAD_NORMAL_WINDOW_KEY]: hasNormalWindow });

  if (!hasNormalWindow) return;
  if (pendingReason) {
    await clearPendingAutoVisitReason();
    await runAutoVisit(pendingReason);
    return;
  }
  if (force || !hadNormalWindow) {
    await runAutoVisit(reason);
  }
}

async function handleBrowserStartup() {
  await setStorage({
    [HAD_NORMAL_WINDOW_KEY]: false,
    [PENDING_AUTO_VISIT_REASON_KEY]: 'startup',
  });
  schedulePendingAutoVisitRetry();
  await checkNormalWindowState('startup');
}

function captureMTeamHeaders(details) {
  try {
    const url = new URL(details.url);
    if (url.host !== MTEAM_API_HOST || url.pathname !== '/api/member/profile') return {};

    const headers = details.requestHeaders || [];
    const getHeader = name => headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';

    capturedMTeamHeaders = {
      authorization: getHeader('Authorization'),
      did: getHeader('did'),
      visitorid: getHeader('visitorid'),
      version: getHeader('version') || '1.1.4',
      webversion: getHeader('webversion') || '1140',
    };
    chrome.storage.local.set({ mteam_captured: capturedMTeamHeaders });
  } catch (e) {}
  return {};
}

chrome.webRequest.onBeforeSendHeaders.addListener(
  captureMTeamHeaders,
  { urls: [`https://${MTEAM_API_HOST}/*`] },
  ['requestHeaders']
);

ensureWindowCheckAlarm();

chrome.runtime.onInstalled.addListener(() => {
  ensureWindowCheckAlarm();
  checkNormalWindowState('installed', true);
});

chrome.runtime.onStartup.addListener(() => {
  ensureWindowCheckAlarm();
  handleBrowserStartup();
});

chrome.windows.onCreated.addListener(window => {
  if (window.type && window.type !== 'normal') return;
  checkNormalWindowState('first-normal-window');
});

chrome.windows.onRemoved.addListener(() => {
  checkNormalWindowState('window-removed');
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (changeInfo.status !== 'complete') return;
  if (autoCloseTabIds.has(tabId)) {
    closeKeepAliveTab(tabId);
    return;
  }
  const { [AUTO_CLOSE_TAB_IDS_KEY]: ids = [] } = await getStorage({ [AUTO_CLOSE_TAB_IDS_KEY]: [] });
  if (ids.includes(tabId)) closeKeepAliveTab(tabId);
});

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === WINDOW_CHECK_ALARM) {
    ensureWindowCheckAlarm();
    checkNormalWindowState('window-check');
    return;
  }
  if (alarm.name === PENDING_AUTO_VISIT_RETRY_ALARM) {
    checkNormalWindowState('pending-auto-visit-retry');
    return;
  }
  if (alarm.name.startsWith(CLOSE_ALARM_PREFIX)) {
    closeKeepAliveTab(Number(alarm.name.slice(CLOSE_ALARM_PREFIX.length)));
  }
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'GET_CAPTURED_HEADERS') {
    chrome.storage.local.get('mteam_captured', ({ mteam_captured }) => sendResponse(mteam_captured || {}));
    return true;
  }
  if (msg.type === 'CLEAR_CAPTURED') {
    capturedMTeamHeaders = null;
    chrome.storage.local.set({ mteam_captured: null });
    sendResponse({ ok: true });
    return;
  }
  if (msg.type === 'GET_AUTO_VISIT_STATUS') {
    Promise.all([getAutoVisitDailyCounter(), getAutoVisitDailyLimit()]).then(([counter, limit]) => {
      sendResponse({
        date: counter.date,
        count: counter.count,
        limit,
      });
    });
    return true;
  }
  if (msg.type === 'SET_AUTO_VISIT_DAILY_LIMIT') {
    setAutoVisitDailyLimit(msg.limit).then(limit => sendResponse({ ok: true, limit }));
    return true;
  }
});
