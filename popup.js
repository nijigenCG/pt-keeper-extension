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
    success: '已保存',
    fail: '未找到',
    pending: '读取中',
    inactive: '未登录',
  };

  for (const result of results) {
    const row = document.createElement('div');
    row.className = `site-row ${result.status}`;
    row.innerHTML = `<span class="site-name">${result.name}</span><span class="site-status">${labels[result.status]}</span>`;
    statusArea.appendChild(row);
  }
}

function buildCookieSiteData(site, cookies) {
  if (site.authType === 'cookie') {
    const found = site.cookieNames
      .map(name => cookies.find(cookie => cookie.name === name))
      .filter(Boolean)
      .map(cookie => ({ name: cookie.name, value: cookie.value }));
    return found.length > 0 ? { cookies: found } : null;
  }

  if (site.authType === 'single_cookie') {
    const cookie = cookies.find(item => item.name === 'nexusphp_u2')
      || cookies.find(item => item.name.includes('u2_') || item.name.includes('sid'))
      || cookies.find(item => item.name.length > 20);
    return cookie ? { cookie_name: cookie.name, cookie_value: cookie.value } : null;
  }

  if (site.authType === 'skyey2') {
    const found = cookies
      .filter(cookie => cookie.name.startsWith(site.prefix))
      .map(cookie => ({ name: cookie.name.replace(site.prefix, ''), value: cookie.value }));
    return found.length > 0 ? { cookies: found } : null;
  }

  return null;
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
  autoVisitDate.textContent = status.date ? `北京时间 ${status.date}` : '北京时间今天';
  autoVisitLimitInput.value = String(status.limit);
}

async function saveAutoVisitLimit() {
  const rawValue = autoVisitLimitInput.value.trim();
  const limit = rawValue === '' ? 2 : Number(rawValue);

  if (!Number.isFinite(limit) || limit < 0) {
    log('每日上限必须是大于等于 0 的整数', 'err');
    return;
  }

  btnSaveAutoVisitLimit.disabled = true;
  try {
    const response = await new Promise(resolve => {
      chrome.runtime.sendMessage({ type: 'SET_AUTO_VISIT_DAILY_LIMIT', limit }, resolve);
    });
    if (!response?.ok) {
      log('保存自动触发上限失败', 'err');
      return;
    }
    autoVisitLimitInput.value = String(response.limit);
    log(`自动触发每日上限已更新为 ${response.limit}`, 'ok');
    await renderAutoVisitStatus();
  } finally {
    btnSaveAutoVisitLimit.disabled = false;
  }
}

async function refreshAll() {
  if (isRunning) return;
  isRunning = true;
  btnIcon.innerHTML = '<span class="spinner"></span>';
  btnText.textContent = '读取中...';
  btnRefresh.disabled = true;
  logArea.style.display = 'block';
  logArea.innerHTML = '';
  log('开始读取所有站点认证信息...');

  const results = [];
  const mteamPlaceholders = SITES
    .filter(site => site.authType === 'mteam_api')
    .map(site => ({ name: site.name, status: 'pending' }));

  for (const site of SITES.filter(item => item.authType !== 'mteam_api')) {
    const result = { name: site.name, file: site.file, status: 'pending' };
    renderStatus([...results.map(item => ({ ...item })), result, ...mteamPlaceholders]);

    try {
      const cookies = await new Promise(resolve => chrome.cookies.getAll({ domain: site.host }, resolve));
      const data = buildCookieSiteData(site, cookies);
      if (data) {
        result.data = data;
        result.status = 'success';
        log(`${site.name}: 读取成功 (${cookies.length} cookies)`, 'ok');
      } else {
        result.status = 'fail';
        const allNames = cookies.map(cookie => cookie.name).join(', ') || '无';
        log(`${site.name}: 未找到目标 Cookie (当前: ${allNames})`, 'err');
      }
    } catch (error) {
      result.status = 'fail';
      log(`${site.name}: ${error.message}`, 'err');
    }

    results.push(result);
    renderStatus([...results.map(item => ({ ...item })), ...mteamPlaceholders]);
  }

  for (const site of SITES.filter(item => item.authType === 'mteam_api')) {
    const result = { name: site.name, file: site.file, status: 'pending' };
    log(`${site.name}: 检查已捕获的认证头...`);
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
      log(`${site.name}: 已获取到 Token`, 'ok');
    } else {
      result.status = 'fail';
      log(`${site.name}: 还没有捕获到 Token`, 'info');
      log(`${site.name}: 请先打开 M-Team 页面并触发 /api/member/profile 请求`, 'info');
    }

    results.push(result);
    renderStatus([...results]);
  }

  const saved = {};
  for (const result of results) {
    if (result.data) saved[result.file] = result.data;
  }

  await new Promise(resolve => chrome.storage.local.set({ cookies: saved }, resolve));
  log(`已保存 ${Object.keys(saved).length} 个站点的认证信息`, 'ok');
  log('点击“导出 Cookie 文件（JSON）”即可下载', 'info');

  isRunning = false;
  btnIcon.innerHTML = '';
  btnText.textContent = '读取所有站点 Cookie';
  btnRefresh.disabled = false;
}

async function visitAll() {
  logArea.style.display = 'block';
  logArea.innerHTML = '';
  log('正在访问所有站点，标签页会在 3 秒后自动关闭...');

  await Promise.all(SITES.map(site => new Promise(resolve => {
    log(`${site.name}: 访问 ${site.url}`, 'info');
    chrome.tabs.create({ url: site.url, active: false }, tab => {
      setTimeout(() => {
        try {
          chrome.tabs.remove(tab.id);
        } catch (error) {}
        resolve();
      }, 3000);
    });
  })));

  log('全部访问完成', 'ok');
}

async function exportJson() {
  const { cookies } = await new Promise(resolve => chrome.storage.local.get('cookies', resolve));
  if (!cookies || Object.keys(cookies).length === 0) {
    alert('还没有读取过 Cookie，请先点击“读取所有站点 Cookie”');
    return;
  }

  const all = {};
  for (const [filename, data] of Object.entries(cookies)) {
    all[filename] = { ...data, headers: { 'User-Agent': DEFAULT_UA } };
  }

  const blob = new Blob([JSON.stringify(all, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  chrome.downloads.download({ url, filename: 'pt-cookies-all.json', saveAs: true });
  log('已下载 pt-cookies-all.json', 'ok');
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
