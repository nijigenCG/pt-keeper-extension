const MTEAM_API_HOST = 'api.m-team.io';
const AUTO_VISIT_DEBOUNCE_MS = 5 * 1000;
const CLOSE_ALARM_PREFIX = 'close-keepalive-tab-';
const WINDOW_CHECK_ALARM = 'check-normal-window';
const WINDOW_CHECK_PERIOD_MINUTES = 1;
const AUTO_CLOSE_TAB_IDS_KEY = 'autoCloseTabIds';
const LAST_AUTO_VISIT_AT_KEY = 'lastAutoVisitAt';
const HAD_NORMAL_WINDOW_KEY = 'hadNormalWindow';
const PENDING_AUTO_VISIT_REASON_KEY = 'pendingAutoVisitReason';

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

async function visitAllSites(reason) {
  const windows = await getNormalWindows();
  const targetWindow = windows.find(window => window.focused) || windows[0];
  if (!targetWindow?.id) {
    await setStorage({ [PENDING_AUTO_VISIT_REASON_KEY]: reason });
    return false;
  }

  console.log(`[PT Keeper] running keepalive visits: ${reason}`);
  SITES.forEach(site => {
    chrome.tabs.create({ url: site.url, active: false, windowId: targetWindow.id }, tab => {
      if (chrome.runtime.lastError || !tab?.id) return;
      scheduleTabClose(tab.id);
    });
  });
  await setStorage({ [PENDING_AUTO_VISIT_REASON_KEY]: null });
  return true;
}

async function runAutoVisit(reason) {
  if (autoVisitInProgress) return;
  autoVisitInProgress = true;

  try {
    const now = Date.now();
    const { [LAST_AUTO_VISIT_AT_KEY]: lastAutoVisitAt = 0 } = await getStorage({ [LAST_AUTO_VISIT_AT_KEY]: 0 });
    if (now - lastAutoVisitAt < AUTO_VISIT_DEBOUNCE_MS) return;

    await setStorage({ [LAST_AUTO_VISIT_AT_KEY]: now });

    const didOpenTabs = await visitAllSites(reason);
    if (!didOpenTabs) {
      await setStorage({ [LAST_AUTO_VISIT_AT_KEY]: lastAutoVisitAt });
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
  if (force) {
    await runAutoVisit(reason);
    return;
  }
  if (!hadNormalWindow) {
    await runAutoVisit(reason);
    return;
  }
  if (pendingReason) {
    await setStorage({ [PENDING_AUTO_VISIT_REASON_KEY]: null });
    await runAutoVisit(pendingReason);
  }
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
  checkNormalWindowState('startup', true);
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
  }
});
