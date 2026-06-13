const MTEAM_API_HOST = 'api.m-team.io';
const AUTO_VISIT_DEBOUNCE_MS = 5 * 1000;
const CLOSE_ALARM_PREFIX = 'close-keepalive-tab-';
const WINDOW_CHECK_ALARM = 'check-normal-window';
const PENDING_AUTO_VISIT_RETRY_ALARM = 'pending-auto-visit-retry';
const WINDOW_CHECK_PERIOD_MINUTES = 1;
const PENDING_AUTO_VISIT_RETRY_DELAY_MINUTES = 0.1;
const AUTO_VISIT_OPEN_RETRY_DELAYS_MS = [0, 1000, 3000];
const AUTO_CLOSE_TAB_IDS_KEY = 'autoCloseTabIds';
const LAST_AUTO_VISIT_AT_KEY = 'lastAutoVisitAt';
const HAD_NORMAL_WINDOW_KEY = 'hadNormalWindow';
const PENDING_AUTO_VISIT_REASON_KEY = 'pendingAutoVisitReason';
const AUTO_VISIT_DAILY_COUNTER_KEY = 'autoVisitDailyCounter';
const AUTO_VISIT_DAILY_LIMIT_KEY = 'autoVisitDailyLimit';
const DEFAULT_AUTO_VISIT_DAILY_LIMIT = 2;
const CAPTURED_SITE_COOKIES_KEY = 'capturedSiteCookies';
const AUTO_VISIT_SESSION_STARTED_KEY = 'autoVisitSessionStarted';

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

const SITE_HOST_TO_KEY = Object.fromEntries(
  SITES.map(site => {
    const host = new URL(site.url).hostname.toLowerCase();
    return [host, host];
  })
);

let capturedMTeamHeaders = null;
let capturedSiteCookies = {};
let autoVisitInProgress = false;
let workerSessionAutoVisitStarted = false;
const autoCloseTabIds = new Set();

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function runAsync(task, label) {
  Promise.resolve()
    .then(task)
    .catch(error => {
      console.warn(`[PT Keeper] ${label} failed: ${error?.message || error}`);
    });
}

function getStorage(keys) {
  return new Promise(resolve => chrome.storage.local.get(keys, resolve));
}

function setStorage(items) {
  return new Promise(resolve => chrome.storage.local.set(items, resolve));
}

function getSessionStorage(keys) {
  if (!chrome.storage.session) return Promise.resolve({});
  return new Promise(resolve => {
    chrome.storage.session.get(keys, result => {
      if (chrome.runtime.lastError) {
        resolve({});
        return;
      }
      resolve(result || {});
    });
  });
}

function setSessionStorage(items) {
  if (!chrome.storage.session) return Promise.resolve();
  return new Promise(resolve => {
    chrome.storage.session.set(items, () => {
      chrome.runtime.lastError;
      resolve();
    });
  });
}

function getNormalWindows() {
  return new Promise(resolve => {
    chrome.windows.getAll({}, windows => {
      if (chrome.runtime.lastError || !Array.isArray(windows)) {
        resolve([]);
        return;
      }
      resolve(windows.filter(window => window.type === 'normal'));
    });
  });
}

function ignoreChromePromise(maybePromise, label) {
  if (maybePromise && typeof maybePromise.catch === 'function') {
    maybePromise.catch(error => {
      console.warn(`[PT Keeper] ${label} failed: ${error?.message || error}`);
    });
  }
}

function createAlarm(name, alarmInfo) {
  try {
    ignoreChromePromise(chrome.alarms.create(name, alarmInfo), `create alarm ${name}`);
  } catch (error) {
    console.warn(`[PT Keeper] create alarm ${name} failed: ${error?.message || error}`);
  }
}

function clearAlarm(name) {
  try {
    ignoreChromePromise(chrome.alarms.clear(name), `clear alarm ${name}`);
  } catch (error) {
    console.warn(`[PT Keeper] clear alarm ${name} failed: ${error?.message || error}`);
  }
}

function ensureWindowCheckAlarm() {
  createAlarm(WINDOW_CHECK_ALARM, { periodInMinutes: WINDOW_CHECK_PERIOD_MINUTES });
}

function schedulePendingAutoVisitRetry() {
  createAlarm(PENDING_AUTO_VISIT_RETRY_ALARM, { delayInMinutes: PENDING_AUTO_VISIT_RETRY_DELAY_MINUTES });
}

function clearPendingAutoVisitRetry() {
  clearAlarm(PENDING_AUTO_VISIT_RETRY_ALARM);
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

async function hasSessionAutoVisitStarted() {
  const { [AUTO_VISIT_SESSION_STARTED_KEY]: started = workerSessionAutoVisitStarted } = await getSessionStorage({
    [AUTO_VISIT_SESSION_STARTED_KEY]: workerSessionAutoVisitStarted,
  });
  workerSessionAutoVisitStarted = Boolean(started);
  return workerSessionAutoVisitStarted;
}

async function setSessionAutoVisitStarted(started) {
  workerSessionAutoVisitStarted = Boolean(started);
  await setSessionStorage({ [AUTO_VISIT_SESSION_STARTED_KEY]: workerSessionAutoVisitStarted });
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
  createAlarm(`${CLOSE_ALARM_PREFIX}${tabId}`, { delayInMinutes: 0.5 });
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
  for (const retryDelay of AUTO_VISIT_OPEN_RETRY_DELAYS_MS) {
    if (retryDelay > 0) await delay(retryDelay);

    const windows = await getNormalWindows();
    const targetWindow = windows.find(window => window.focused) || windows[0];
    if (!targetWindow?.id) continue;

    console.log(`[PT Keeper] running keepalive visits: ${reason}`);
    const results = await Promise.all(SITES.map(site => openKeepAliveTab(targetWindow.id, site)));
    if (results.some(Boolean)) {
      await clearPendingAutoVisitReason();
      return true;
    }
  }

  await setPendingAutoVisitReason(reason);
  return false;
}

async function runAutoVisit(reason) {
  if (autoVisitInProgress) return false;
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
        return true;
      }
    }

    const now = Date.now();
    const { [LAST_AUTO_VISIT_AT_KEY]: lastAutoVisitAt = 0 } = await getStorage({ [LAST_AUTO_VISIT_AT_KEY]: 0 });
    if (now - lastAutoVisitAt < AUTO_VISIT_DEBOUNCE_MS) return true;

    await setStorage({ [LAST_AUTO_VISIT_AT_KEY]: now });

    const didOpenTabs = await visitAllSites(reason);
    if (!didOpenTabs) {
      await setStorage({ [LAST_AUTO_VISIT_AT_KEY]: lastAutoVisitAt });
      return false;
    }

    if (shouldCount) {
      await incrementAutoVisitDailyCounter(dailyCounter);
    }

    return true;
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

  if (!hasNormalWindow) {
    await setSessionAutoVisitStarted(false);
    return;
  }

  if (pendingReason) {
    const didHandleAutoVisit = await runAutoVisit(pendingReason);
    if (didHandleAutoVisit) {
      await clearPendingAutoVisitReason();
      await setSessionAutoVisitStarted(true);
    }
    return;
  }

  const sessionAutoVisitStarted = await hasSessionAutoVisitStarted();
  if (force || !sessionAutoVisitStarted || !hadNormalWindow) {
    const didHandleAutoVisit = await runAutoVisit(reason);
    if (didHandleAutoVisit) await setSessionAutoVisitStarted(true);
  }
}

async function handleBrowserStartup() {
  await setSessionAutoVisitStarted(false);
  await setStorage({
    [HAD_NORMAL_WINDOW_KEY]: false,
    [PENDING_AUTO_VISIT_REASON_KEY]: 'startup',
  });
  schedulePendingAutoVisitRetry();
  await checkNormalWindowState('startup', true);
}

async function handleNormalWindowCreated() {
  await setSessionAutoVisitStarted(false);
  await setPendingAutoVisitReason('first-normal-window');
  await checkNormalWindowState('first-normal-window', true);
}

async function handleTabCreated(tab) {
  if (autoVisitInProgress) return;
  if (tab?.url && SITES.some(site => tab.url.startsWith(site.url))) return;

  await delay(500);
  const sessionAutoVisitStarted = await hasSessionAutoVisitStarted();
  if (sessionAutoVisitStarted) return;

  await setPendingAutoVisitReason('first-tab-created');
  await checkNormalWindowState('first-tab-created', true);
}

async function handleNormalWindowRemoved() {
  await delay(500);
  const windows = await getNormalWindows();
  if (windows.length === 0) {
    await setSessionAutoVisitStarted(false);
    await setStorage({ [HAD_NORMAL_WINDOW_KEY]: false });
    return;
  }
  await setStorage({ [HAD_NORMAL_WINDOW_KEY]: true });
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

function parseCookieHeader(cookieHeader) {
  if (!cookieHeader) return [];

  return cookieHeader
    .split(';')
    .map(part => part.trim())
    .filter(Boolean)
    .map(part => {
      const separatorIndex = part.indexOf('=');
      if (separatorIndex < 0) return null;
      return {
        name: part.slice(0, separatorIndex).trim(),
        value: part.slice(separatorIndex + 1),
      };
    })
    .filter(Boolean);
}

function getTrackedSiteKey(hostname) {
  const normalizedHost = hostname.toLowerCase();
  const directMatch = SITE_HOST_TO_KEY[normalizedHost];
  if (directMatch) return directMatch;

  return Object.keys(SITE_HOST_TO_KEY).find(siteHost =>
    normalizedHost === siteHost
    || normalizedHost.endsWith(`.${siteHost}`)
    || siteHost.endsWith(`.${normalizedHost}`)
  ) || null;
}

async function captureSiteCookieHeaders(details) {
  try {
    const url = new URL(details.url);
    const siteKey = getTrackedSiteKey(url.hostname);
    if (!siteKey) return {};

    const headers = details.requestHeaders || [];
    const cookieHeader = headers.find(header => header.name.toLowerCase() === 'cookie')?.value || '';
    const parsedCookies = parseCookieHeader(cookieHeader);
    if (parsedCookies.length === 0) return {};

    capturedSiteCookies[siteKey] = parsedCookies;

    const { [CAPTURED_SITE_COOKIES_KEY]: storedSiteCookies = {} } = await getStorage({
      [CAPTURED_SITE_COOKIES_KEY]: {},
    });

    await setStorage({
      [CAPTURED_SITE_COOKIES_KEY]: {
        ...storedSiteCookies,
        [siteKey]: parsedCookies,
      },
    });
  } catch (error) {}
  return {};
}

function addRequestHeadersListener(listener, filter, label) {
  try {
    chrome.webRequest.onBeforeSendHeaders.addListener(listener, filter, ['requestHeaders', 'extraHeaders']);
    return;
  } catch (error) {
    console.warn(`[PT Keeper] ${label} extraHeaders listener failed, retrying without extraHeaders: ${error?.message || error}`);
  }

  try {
    chrome.webRequest.onBeforeSendHeaders.addListener(listener, filter, ['requestHeaders']);
  } catch (error) {
    console.warn(`[PT Keeper] ${label} listener disabled: ${error?.message || error}`);
  }
}

const TRACKED_SITE_REQUEST_URLS = [
  'https://pthome.net/*',
  'https://*.pthome.net/*',
  'https://hdarea.club/*',
  'https://*.hdarea.club/*',
  'https://pterclub.net/*',
  'https://*.pterclub.net/*',
  'https://hdhome.org/*',
  'https://*.hdhome.org/*',
  'https://pt.btschool.club/*',
  'https://btschool.club/*',
  'https://*.btschool.club/*',
  'https://hdtime.org/*',
  'https://*.hdtime.org/*',
  'https://hddolby.com/*',
  'https://www.hddolby.com/*',
  'https://*.hddolby.com/*',
  'https://skyey2.com/*',
  'https://www.skyey2.com/*',
  'https://*.skyey2.com/*',
  'https://u2.dmhy.org/*',
  'https://dmhy.org/*',
  'https://*.dmhy.org/*',
  'https://kp.m-team.cc/*',
  'https://*.m-team.cc/*',
];

addRequestHeadersListener(
  captureMTeamHeaders,
  { urls: [`https://${MTEAM_API_HOST}/*`] },
  'M-Team header capture'
);

addRequestHeadersListener(
  details => {
    captureSiteCookieHeaders(details);
    return {};
  },
  { urls: TRACKED_SITE_REQUEST_URLS },
  'site cookie capture'
);

ensureWindowCheckAlarm();

chrome.runtime.onInstalled.addListener(() => {
  ensureWindowCheckAlarm();
  runAsync(() => checkNormalWindowState('installed', true), 'installed auto visit');
});

chrome.runtime.onStartup.addListener(() => {
  ensureWindowCheckAlarm();
  runAsync(handleBrowserStartup, 'startup auto visit');
});

chrome.windows.onCreated.addListener(window => {
  if (window.type && window.type !== 'normal') return;
  runAsync(handleNormalWindowCreated, 'normal window auto visit');
});

chrome.windows.onRemoved.addListener(() => {
  runAsync(handleNormalWindowRemoved, 'window state update');
});

chrome.tabs.onCreated.addListener(tab => {
  runAsync(() => handleTabCreated(tab), 'tab-created auto visit');
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
    runAsync(() => checkNormalWindowState('window-check'), 'window-check auto visit');
    return;
  }
  if (alarm.name === PENDING_AUTO_VISIT_RETRY_ALARM) {
    runAsync(() => checkNormalWindowState('pending-auto-visit-retry'), 'pending auto visit retry');
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
  if (msg.type === 'GET_CAPTURED_SITE_COOKIES') {
    chrome.storage.local.get(CAPTURED_SITE_COOKIES_KEY, ({ [CAPTURED_SITE_COOKIES_KEY]: storedSiteCookies }) => {
      sendResponse({
        ...capturedSiteCookies,
        ...(storedSiteCookies || {}),
      });
    });
    return true;
  }
  if (msg.type === 'CLEAR_CAPTURED_SITE_COOKIES') {
    capturedSiteCookies = {};
    chrome.storage.local.set({ [CAPTURED_SITE_COOKIES_KEY]: {} }, () => sendResponse({ ok: true }));
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
