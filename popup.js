const SITES = [
  { name: 'PTHome', host: 'pthome.net', file: 'pthome.json', authType: 'cookie', cookieNames: ['c_secure_uid', 'c_secure_pass', 'c_secure_ssl'], url: 'https://pthome.net/index.php' },
  { name: 'HDArea', host: 'hdarea.club', file: 'hdarea.json', authType: 'cookie', cookieNames: ['c_secure_uid', 'c_secure_pass', 'c_secure_ssl'], url: 'https://hdarea.club/index.php' },
  { name: 'PTer', host: 'pterclub.net', file: 'pter.json', authType: 'cookie', cookieNames: ['c_secure_uid', 'c_secure_pass', 'c_secure_ssl'], url: 'https://pterclub.net/index.php' },
  { name: 'HDHome', host: 'hdhome.org', file: 'hdhome.json', authType: 'cookie', cookieNames: ['c_secure_uid', 'c_secure_pass', 'c_secure_ssl'], url: 'https://hdhome.org/index.php' },
  { name: 'BTSCHOOL', host: 'pt.btschool.club', file: 'btschool.json', authType: 'cookie', cookieNames: ['c_secure_uid', 'c_secure_pass', 'c_secure_ssl'], url: 'https://pt.btschool.club/index.php' },
  { name: 'HDTime', host: 'hdtime.org', file: 'hdtime.json', authType: 'cookie', cookieNames: ['c_secure_uid', 'c_secure_pass', 'c_secure_ssl'], url: 'https://hdtime.org/index.php' },
  { name: 'HDDolby', host: 'www.hddolby.com', file: 'hddolby.json', authType: 'cookie', cookieNames: ['c_secure_uid', 'c_secure_pass', 'c_secure_ssl'], url: 'https://www.hddolby.com/index.php' },
  { name: 'Skyey2', host: 'www.skyey2.com', file: 'skyey2.json', authType: 'skyey2', prefix: 'rkvl_2132_', url: 'https://www.skyey2.com/index.php' },
  { name: 'U2', host: 'u2.dmhy.org', file: 'u2.json', authType: 'single_cookie', url: 'https://u2.dmhy.org/index.php' },
  { name: 'M-Team', host: 'kp.m-team.cc', file: 'mteam.json', authType: 'mteam_api', url: 'https://kp.m-team.cc/index' },
];

const DEFAULT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36 Edg/147.0.0.0';

const btnRefresh = document.getElementById('btnRefresh');
const btnVisit = document.getElementById('btnVisit');
const btnExport = document.getElementById('btnExport');
const btnSaveAutoVisitLimit = document.getElementById('btnSaveAutoVisitLimit');
const statusArea = document.getElementById('statusArea');
const logArea = document.getElementById('logArea');
const btnIcon = document.getElementById('btnIcon');
const btnText = document.getElementById('btnText');
const autoVisitCounter = document.getElementById('autoVisitCounter');
const autoVisitDate = document.getElementById('autoVisitDate');
const autoVisitLimitInput = document.getElementById('autoVisitLimitInput');

let isRunning = false;

function log(msg, type = 'info') {
  const line = document.createElement('div');
  line.className = `log-line ${type}`;
  line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  logArea.appendChild(line);
  logArea.scrollTop = logArea.scrollHeight;
}

function renderStatus(results) {
  statusArea.innerHTML = '';
  const labels = {
    success: 'Ready',
    fail: 'Error',
    pending: 'Loading',
    inactive: 'Not ready',
  };

  for (const result of results) {
    const row = document.createElement('div');
    row.className = `site-row ${result.status}`;
    row.innerHTML = `<span class="site-name">${result.name}</span><span class="site-status">${labels[result.status]}</span>`;
    statusArea.appendChild(row);
  }
}

function buildCookieSiteData(site, cookies) {
  const allCookies = cookies.map(cookie => ({ name: cookie.name, value: cookie.value }));

  if (site.authType === 'cookie') {
    const matchedCookies = site.cookieNames
      .map(name => cookies.find(cookie => cookie.name === name))
      .filter(Boolean)
      .map(cookie => ({ name: cookie.name, value: cookie.value }));

    if (allCookies.length === 0) return null;

    return {
      cookies: allCookies,
      matchedCookieCount: matchedCookies.length,
      totalCookieCount: allCookies.length,
    };
  }

  if (site.authType === 'single_cookie') {
    const cookie = cookies.find(item => item.name === 'nexusphp_u2')
      || cookies.find(item => item.name.includes('u2_') || item.name.includes('sid'))
      || cookies.find(item => item.name.length > 20);
    if (cookie) {
      return {
        cookie_name: cookie.name,
        cookie_value: cookie.value,
        cookies: allCookies,
        matchedCookieCount: 1,
        totalCookieCount: allCookies.length,
      };
    }
    return allCookies.length > 0
      ? { cookies: allCookies, matchedCookieCount: 0, totalCookieCount: allCookies.length }
      : null;
  }

  if (site.authType === 'skyey2') {
    const found = cookies
      .filter(cookie => cookie.name.startsWith(site.prefix))
      .map(cookie => ({ name: cookie.name.replace(site.prefix, ''), value: cookie.value }));
    if (found.length > 0) {
      return {
        cookies: found,
        matchedCookieCount: found.length,
        totalCookieCount: allCookies.length,
      };
    }
    return allCookies.length > 0
      ? { cookies: allCookies, matchedCookieCount: 0, totalCookieCount: allCookies.length }
      : null;
  }

  return null;
}

function normalizeCookieDomain(domain) {
  return String(domain || '').replace(/^\./, '').toLowerCase();
}

function getSiteHosts(site) {
  const siteHost = new URL(site.url).hostname.toLowerCase();
  const hostSet = new Set([siteHost]);

  if (site.host) hostSet.add(site.host.toLowerCase());

  if (siteHost.startsWith('www.')) {
    hostSet.add(siteHost.slice(4));
  } else {
    hostSet.add(`www.${siteHost}`);
  }

  if (siteHost.includes('.')) {
    const parts = siteHost.split('.');
    if (parts.length >= 2) {
      hostSet.add(parts.slice(-2).join('.'));
    }
  }

  return [...hostSet];
}

function getCookiesForSite(allCookies, site) {
  const siteHosts = getSiteHosts(site);
  return allCookies.filter(cookie => {
    const cookieDomain = normalizeCookieDomain(cookie.domain);
    if (!cookieDomain) return false;

    return siteHosts.some(siteHost =>
      siteHost === cookieDomain
      || siteHost.endsWith(`.${cookieDomain}`)
      || cookieDomain.endsWith(`.${siteHost}`)
    );
  });
}

function parseCookieString(cookieString) {
  if (!cookieString) return [];

  return cookieString
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

function looksLikeAuthStorageKey(key) {
  const normalizedKey = String(key || '').toLowerCase();
  return [
    'token',
    'auth',
    'jwt',
    'session',
    'cookie',
    'uid',
    'user',
    'pass',
    'login',
  ].some(part => normalizedKey.includes(part));
}

function convertStorageEntriesToCookies(storageEntries = {}) {
  return Object.entries(storageEntries)
    .filter(([key, value]) => key && value && looksLikeAuthStorageKey(key))
    .map(([key, value]) => ({ name: key, value: String(value) }));
}

function mergeCookies(...cookieGroups) {
  const merged = [];
  const seen = new Set();

  for (const group of cookieGroups) {
    for (const cookie of group || []) {
      const key = `${cookie.name}\u0000${cookie.value}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(cookie);
    }
  }

  return merged;
}

function getSiteCookieCaptureKey(site) {
  return new URL(site.url).hostname.toLowerCase();
}

function buildProbeUrl(site) {
  const url = new URL(site.url);
  url.searchParams.set('_ptk_probe', String(Date.now()));
  return url.toString();
}

function waitForTabComplete(tabId, timeoutMs = 15000) {
  return new Promise(resolve => {
    let settled = false;

    const finish = result => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(handleUpdated);
      resolve(result);
    };

    const handleUpdated = (updatedTabId, changeInfo) => {
      if (updatedTabId !== tabId) return;
      if (changeInfo.status === 'complete') finish('complete');
    };

    const timer = setTimeout(() => finish('timeout'), timeoutMs);

    chrome.tabs.onUpdated.addListener(handleUpdated);
    chrome.tabs.get(tabId, tab => {
      if (chrome.runtime.lastError || !tab) {
        finish('unavailable');
        return;
      }
      if (tab.status === 'complete') finish('complete');
    });
  });
}

async function readCookiesFromPageContext(site) {
  const tab = await new Promise(resolve => chrome.tabs.create({ url: buildProbeUrl(site), active: false }, resolve));
  if (!tab?.id) return [];

  try {
    await waitForTabComplete(tab.id);
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => ({
        cookieString: document.cookie,
        localStorageEntries: Object.fromEntries(
          Array.from({ length: localStorage.length }, (_, index) => {
            const key = localStorage.key(index);
            return [key, localStorage.getItem(key)];
          }).filter(([key]) => key)
        ),
        sessionStorageEntries: Object.fromEntries(
          Array.from({ length: sessionStorage.length }, (_, index) => {
            const key = sessionStorage.key(index);
            return [key, sessionStorage.getItem(key)];
          }).filter(([key]) => key)
        ),
      }),
    });

    const pageResult = result?.result || {};
    const pageCookies = parseCookieString(pageResult.cookieString || '');
    if (pageCookies.length > 0) return pageCookies;

    const storageCookies = [
      ...convertStorageEntriesToCookies(pageResult.localStorageEntries),
      ...convertStorageEntriesToCookies(pageResult.sessionStorageEntries),
    ];

    if (storageCookies.length > 0) {
      log(`${site.name}: using auth-like storage keys as fallback`, 'info');
    }

    return storageCookies;
  } catch (error) {
    log(`${site.name}: page fallback failed (${error.message})`, 'info');
    return [];
  } finally {
    chrome.tabs.remove(tab.id, () => {
      chrome.runtime.lastError;
    });
  }
}

async function triggerCookieHeaderCapture(site) {
  await new Promise(resolve => chrome.runtime.sendMessage({ type: 'CLEAR_CAPTURED_SITE_COOKIES' }, resolve));

  const tab = await new Promise(resolve => chrome.tabs.create({ url: buildProbeUrl(site), active: false }, resolve));
  if (!tab?.id) return [];

  try {
    await waitForTabComplete(tab.id);
    await new Promise(resolve => setTimeout(resolve, 2000));
    const capturedSiteCookies = await new Promise(resolve =>
      chrome.runtime.sendMessage({ type: 'GET_CAPTURED_SITE_COOKIES' }, resolve)
    );

    return capturedSiteCookies?.[getSiteCookieCaptureKey(site)] || [];
  } finally {
    chrome.tabs.remove(tab.id, () => {
      chrome.runtime.lastError;
    });
  }
}

async function fetchAutoVisitStatus() {
  return new Promise(resolve => {
    chrome.runtime.sendMessage({ type: 'GET_AUTO_VISIT_STATUS' }, response => {
      resolve(response || { count: 0, limit: 2, date: '' });
    });
  });
}

async function renderAutoVisitStatus() {
  const status = await fetchAutoVisitStatus();
  autoVisitCounter.textContent = `${status.count} / ${status.limit}`;
  autoVisitDate.textContent = status.date ? `Beijing time ${status.date}` : 'Beijing time today';
  autoVisitLimitInput.value = String(status.limit);
}

async function saveAutoVisitLimit() {
  const rawValue = autoVisitLimitInput.value.trim();
  const limit = rawValue === '' ? 2 : Number(rawValue);

  if (!Number.isFinite(limit) || limit < 0) {
    log('Daily limit must be an integer greater than or equal to 0', 'err');
    return;
  }

  btnSaveAutoVisitLimit.disabled = true;
  try {
    const response = await new Promise(resolve => {
      chrome.runtime.sendMessage({ type: 'SET_AUTO_VISIT_DAILY_LIMIT', limit }, resolve);
    });
    if (!response?.ok) {
      log('Failed to save daily auto-visit limit', 'err');
      return;
    }
    autoVisitLimitInput.value = String(response.limit);
    log(`Daily auto-visit limit updated to ${response.limit}`, 'ok');
    await renderAutoVisitStatus();
  } finally {
    btnSaveAutoVisitLimit.disabled = false;
  }
}

async function refreshAll() {
  if (isRunning) return;
  isRunning = true;
  btnIcon.innerHTML = '<span class="spinner"></span>';
  btnText.textContent = 'Reading...';
  btnRefresh.disabled = true;
  logArea.style.display = 'block';
  logArea.innerHTML = '';
  log('Reading site credentials...');

  const allBrowserCookies = await new Promise(resolve => chrome.cookies.getAll({}, resolve));
  const { cookies: existingCookies = {} } = await new Promise(resolve => chrome.storage.local.get('cookies', resolve));

  const results = [];
  const mteamPlaceholders = SITES
    .filter(site => site.authType === 'mteam_api')
    .map(site => ({ name: site.name, status: 'pending' }));

  for (const site of SITES.filter(item => item.authType !== 'mteam_api')) {
    const result = { name: site.name, file: site.file, status: 'pending' };
    renderStatus([...results.map(item => ({ ...item })), result, ...mteamPlaceholders]);

    try {
      let cookies = getCookiesForSite(allBrowserCookies, site);
      if (cookies.length === 0) {
        log(`${site.name}: no cookies in cookie store, trying request-header capture...`, 'info');
        cookies = mergeCookies(cookies, await triggerCookieHeaderCapture(site));
        const refreshedCookies = await new Promise(resolve => chrome.cookies.getAll({}, resolve));
        cookies = mergeCookies(cookies, getCookiesForSite(refreshedCookies, site));
      }
      if (cookies.length === 0) {
        log(`${site.name}: request-header capture empty, trying page fallback...`, 'info');
        cookies = mergeCookies(cookies, await readCookiesFromPageContext(site));
        const refreshedCookies = await new Promise(resolve => chrome.cookies.getAll({}, resolve));
        cookies = mergeCookies(cookies, getCookiesForSite(refreshedCookies, site));
      }

      const data = buildCookieSiteData(site, cookies);

      if (data) {
        result.data = data;
        result.status = 'success';

        const matched = Number.isFinite(data.matchedCookieCount) ? data.matchedCookieCount : 'n/a';
        const total = Number.isFinite(data.totalCookieCount) ? data.totalCookieCount : cookies.length;
        log(`${site.name}: read ${total} cookies, matched ${matched} known cookies`, 'ok');
      } else {
        const previousData = existingCookies[site.file];
        if (previousData) {
          result.data = previousData;
          result.status = 'success';
          log(`${site.name}: current read failed, keeping previously saved credentials`, 'info');
        } else {
          result.status = 'inactive';
          const allNames = cookies.map(cookie => cookie.name).join(', ') || 'none';
          log(`${site.name}: no usable credentials found yet (${allNames})`, 'info');
        }
      }
    } catch (error) {
      const previousData = existingCookies[site.file];
      if (previousData) {
        result.data = previousData;
        result.status = 'success';
        log(`${site.name}: read error, keeping previously saved credentials (${error.message})`, 'info');
      } else {
        result.status = 'fail';
        log(`${site.name}: ${error.message}`, 'err');
      }
    }

    results.push(result);
    renderStatus([...results.map(item => ({ ...item })), ...mteamPlaceholders]);
  }

  for (const site of SITES.filter(item => item.authType === 'mteam_api')) {
    const result = { name: site.name, file: site.file, status: 'pending' };
    log(`${site.name}: checking captured auth headers...`);
    const captured = await new Promise(resolve => chrome.runtime.sendMessage({ type: 'GET_CAPTURED_HEADERS' }, resolve));

    if (captured?.authorization?.startsWith('Bearer ')) {
      result.data = {
        token: captured.authorization.replace('Bearer ', ''),
        did: captured.did,
        visitorid: captured.visitorid,
        version: captured.version || '1.1.4',
        webversion: captured.webversion || '1140',
      };
      result.status = 'success';
      log(`${site.name}: captured token`, 'ok');
    } else {
      const previousData = existingCookies[site.file];
      if (previousData) {
        result.data = previousData;
        result.status = 'success';
        log(`${site.name}: token not captured this time, keeping previously saved credentials`, 'info');
      } else {
        result.status = 'inactive';
        log(`${site.name}: token not captured yet`, 'info');
        log(`${site.name}: open M-Team and trigger /api/member/profile first`, 'info');
      }
    }

    results.push(result);
    renderStatus([...results]);
  }

  const saved = {};
  for (const result of results) {
    if (!result.data) continue;

    if (result.data.cookie_name && result.data.cookie_value) {
      saved[result.file] = {
        cookie_name: result.data.cookie_name,
        cookie_value: result.data.cookie_value,
      };
      continue;
    }

    if (result.data.cookies) {
      saved[result.file] = { cookies: result.data.cookies };
      continue;
    }

    saved[result.file] = result.data;
  }

  await new Promise(resolve => chrome.storage.local.set({ cookies: saved }, resolve));
  log(`Saved credentials for ${Object.keys(saved).length} sites`, 'ok');
  log('Use Export Cookie JSON to download the result', 'info');

  isRunning = false;
  btnIcon.innerHTML = '';
  btnText.textContent = 'Read all site cookies';
  btnRefresh.disabled = false;
}

async function visitAll() {
  logArea.style.display = 'block';
  logArea.innerHTML = '';
  log('Opening all sites, tabs will close after 3 seconds...');

  await Promise.all(SITES.map(site => new Promise(resolve => {
    log(`${site.name}: visit ${site.url}`, 'info');
    chrome.tabs.create({ url: site.url, active: false }, tab => {
      setTimeout(() => {
        try {
          chrome.tabs.remove(tab.id);
        } catch (error) {}
        resolve();
      }, 3000);
    });
  })));

  log('Finished visiting all sites', 'ok');
}

async function exportJson() {
  const { cookies } = await new Promise(resolve => chrome.storage.local.get('cookies', resolve));
  if (!cookies || Object.keys(cookies).length === 0) {
    alert('No cookies have been read yet. Click Read all site cookies first.');
    return;
  }

  const all = {};
  for (const [filename, data] of Object.entries(cookies)) {
    all[filename] = { ...data, headers: { 'User-Agent': DEFAULT_UA } };
  }

  const blob = new Blob([JSON.stringify(all, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  chrome.downloads.download({ url, filename: 'pt-cookies-all.json', saveAs: true });
  log('Downloaded pt-cookies-all.json', 'ok');
}

async function init() {
  const { cookies } = await new Promise(resolve => chrome.storage.local.get('cookies', resolve));
  if (cookies && Object.keys(cookies).length > 0) {
    renderStatus(SITES.map(site => ({
      name: site.name,
      status: cookies[site.file] ? 'success' : 'inactive',
    })));
  }

  await renderAutoVisitStatus();
}

btnRefresh.addEventListener('click', refreshAll);
btnVisit.addEventListener('click', visitAll);
btnExport.addEventListener('click', exportJson);
btnSaveAutoVisitLimit.addEventListener('click', saveAutoVisitLimit);
autoVisitLimitInput.addEventListener('keydown', event => {
  if (event.key === 'Enter') saveAutoVisitLimit();
});

init();
