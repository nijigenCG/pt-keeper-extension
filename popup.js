const SITES = [
  { name: 'PTHome',    host: 'pthome.net',        file: 'pthome.json',   authType: 'cookie',    cookieNames: ['c_secure_uid', 'c_secure_pass', 'c_secure_ssl'], url: 'https://pthome.net/index.php' },
  { name: 'HDArea',    host: 'hdarea.club',       file: 'hdarea.json',   authType: 'cookie',    cookieNames: ['c_secure_uid', 'c_secure_pass', 'c_secure_ssl'], url: 'https://hdarea.club/index.php' },
  { name: 'PTer',      host: 'pterclub.net',       file: 'pter.json',    authType: 'cookie',    cookieNames: ['c_secure_uid', 'c_secure_pass', 'c_secure_ssl'], url: 'https://pterclub.net/index.php' },
  { name: 'HDHome',    host: 'hdhome.org',         file: 'hdhome.json',  authType: 'cookie',    cookieNames: ['c_secure_uid', 'c_secure_pass', 'c_secure_ssl'], url: 'https://hdhome.org/index.php' },
  { name: 'BTSCHOOL',  host: 'pt.btschool.club',   file: 'btschool.json',authType: 'cookie',   cookieNames: ['c_secure_uid', 'c_secure_pass', 'c_secure_ssl'], url: 'https://pt.btschool.club/index.php' },
  { name: 'HDTime',    host: 'hdtime.org',         file: 'hdtime.json',  authType: 'cookie',    cookieNames: ['c_secure_uid', 'c_secure_pass', 'c_secure_ssl'], url: 'https://hdtime.org/index.php' },
  { name: 'HDDolby',   host: 'www.hddolby.com',    file: 'hddolby.json', authType: 'cookie',   cookieNames: ['c_secure_uid', 'c_secure_pass', 'c_secure_ssl'], url: 'https://www.hddolby.com/index.php' },
  { name: 'Skyey2',    host: 'www.skyey2.com',     file: 'skyey2.json',  authType: 'skyey2',    prefix: 'rkvl_2132_', url: 'https://www.skyey2.com/index.php' },
  { name: 'U2',        host: 'u2.dmhy.org',         file: 'u2.json',      authType: 'single_cookie', url: 'https://u2.dmhy.org/index.php' },
  { name: 'M-Team',    host: 'kp.m-team.cc',        file: 'mteam.json',   authType: 'mteam_api', url: 'https://kp.m-team.cc/index' },
];

const DEFAULT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36 Edg/147.0.0.0';

const btnRefresh = document.getElementById('btnRefresh');
const btnVisit   = document.getElementById('btnVisit');
const btnExport  = document.getElementById('btnExport');
const statusArea = document.getElementById('statusArea');
const logArea    = document.getElementById('logArea');
const btnIcon    = document.getElementById('btnIcon');
const btnText    = document.getElementById('btnText');

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
  for (const r of results) {
    const row = document.createElement('div');
    row.className = `site-row ${r.status}`;
    const labels = { success: '✓ 已保存', fail: '✗ 未找到', pending: '○ 读取中', inactive: '－ 未登录' };
    row.innerHTML = `<span class="site-name">${r.name}</span><span class="site-status">${labels[r.status]}</span>`;
    statusArea.appendChild(row);
  }
}

function buildCookieSiteData(site, cookies) {
  if (site.authType === 'cookie') {
    const found = site.cookieNames
      .map(n => cookies.find(c => c.name === n))
      .filter(Boolean)
      .map(c => ({ name: c.name, value: c.value }));
    return found.length > 0 ? { cookies: found } : null;
  } else if (site.authType === 'single_cookie') {
    const c = cookies.find(c => c.name === 'nexusphp_u2')
             || cookies.find(c => c.name.includes('u2_') || c.name.includes('sid'))
             || cookies.find(c => c.name.length > 20);
    return c ? { cookie_name: c.name, cookie_value: c.value } : null;
  } else if (site.authType === 'skyey2') {
    const found = cookies
      .filter(c => c.name.startsWith(site.prefix))
      .map(c => ({ name: c.name.replace(site.prefix, ''), value: c.value }));
    return found.length > 0 ? { cookies: found } : null;
  }
  return null;
}

async function refreshAll() {
  if (isRunning) return;
  isRunning = true;
  btnIcon.innerHTML = '<span class="spinner"></span>';
  btnText.textContent = '读取中...';
  btnRefresh.disabled = true;
  logArea.style.display = 'block';
  logArea.innerHTML = '';
  log('开始读取所有站点...');

  const results = [];

  // 1. 读取普通 Cookie
  for (const site of SITES.filter(s => s.authType !== 'mteam_api')) {
    const result = { name: site.name, file: site.file, status: 'pending' };
    renderStatus([...results, ...SITES.filter(s => s.authType === 'mteam_api').map(s => ({ name: s.name, status: 'pending' }))]);
    const placeholder = SITES.filter(s => s.authType === 'mteam_api').map(s => ({ name: s.name, status: 'pending' }));
    renderStatus([...results.map(r => ({...r, status: r.data ? 'success' : 'inactive'})), result, ...placeholder]);

    try {
      const cookies = await new Promise(r => chrome.cookies.getAll({ domain: site.host }, r));
      const data = buildCookieSiteData(site, cookies);
      if (data) {
        result.data = data;
        result.status = 'success';
        log(`${site.name}: ✓ 读取成功 (${cookies.length} cookies)`, 'ok');
      } else {
        result.status = 'fail';
        const allNames = cookies.map(c => c.name).join(', ') || '无';
        log(`${site.name}: ✗ 未找到目标Cookie (当前: ${allNames})`, 'err');
      }
    } catch (e) {
      result.status = 'fail';
      log(`${site.name}: ✗ ${e.message}`, 'err');
    }
    results.push(result);
    // 重新渲染
    const mteamPending = SITES.filter(s => s.authType === 'mteam_api').map(s => ({ name: s.name, status: 'pending' }));
    renderStatus([...results.map(r => ({...r})), ...mteamPending]);
  }

  // 2. 读取 M-Team Token（通过 background 拦截）
  for (const site of SITES.filter(s => s.authType === 'mteam_api')) {
    const result = { name: site.name, file: site.file, status: 'pending' };
    log(`${site.name}: 检查已捕获的头信息...`);
    const captured = await new Promise(r => chrome.runtime.sendMessage({ type: 'GET_CAPTURED_HEADERS' }, r));

    if (captured && captured.authorization && captured.authorization.startsWith('Bearer ')) {
      result.data = {
        token: captured.authorization.replace('Bearer ', ''),
        did: captured.did,
        visitorid: captured.visitorid,
        version: captured.version || '1.1.4',
        webversion: captured.webversion || '1140',
      };
      result.status = 'success';
      log(`${site.name}: ✓ 从拦截器获取到 Token`, 'ok');
    } else {
      log(`${site.name}: ⚠ 未捕获到 Token`, 'info');
      log(`${site.name}: 提示: 请先打开 M-Team 页面，访问任意页面触发 /api/member/profile 请求`, 'info');
      result.status = 'fail';
    }
    results.push(result);
    renderStatus([...results]);
  }

  // 保存到 storage
  const saved = {};
  for (const r of results) {
    if (r.data) saved[r.file] = r.data;
  }
  await new Promise(r => chrome.storage.local.set({ cookies: saved }, r));
  log(`已保存 ${Object.keys(saved).length} 个站点的认证信息`, 'ok');
  log('点击"导出 Cookie 文件"下载 JSON', 'info');

  isRunning = false;
  btnIcon.innerHTML = '';
  btnText.textContent = '读取所有站点 Cookie';
  btnRefresh.disabled = false;
}

async function visitAll() {
  logArea.style.display = 'block';
  logArea.innerHTML = '';
  log('正在并发打开所有站点（3秒后自动关闭标签页）...');

  await Promise.all(SITES.map(site =>
    new Promise(resolve => {
      log(`${site.name}: 访问 ${site.url}`, 'info');
      chrome.tabs.create({ url: site.url, active: false }, tab => {
        setTimeout(() => { try { chrome.tabs.remove(tab.id); } catch(e) {} resolve(); }, 3000);
      });
    })
  ));

  log('全部访问完成', 'ok');
}

async function exportAll() {
  const { cookies } = await new Promise(r => chrome.storage.local.get('cookies', r));
  if (!cookies || Object.keys(cookies).length === 0) {
    alert('还没有读取过 Cookie，请先点击"读取所有站点 Cookie"');
    return;
  }

  // 按站点逐一输出，方便复制到各文件
  let text = '';
  for (const [filename, data] of Object.entries(cookies)) {
    const out = {
      ...data,
      headers: { "User-Agent": DEFAULT_UA }
    };
    text += `========== ${filename} ==========\n`;
    text += JSON.stringify(out, null, 2) + '\n\n';
  }

  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  chrome.downloads.download({ url, filename: 'pt-cookies.txt', saveAs: true });
  log('已下载 pt-cookies.txt', 'ok');
}

async function exportJson() {
  const { cookies } = await new Promise(r => chrome.storage.local.get('cookies', r));
  if (!cookies || Object.keys(cookies).length === 0) {
    alert('还没有读取过 Cookie，请先点击"读取所有站点 Cookie"');
    return;
  }

  const all = {};
  for (const [filename, data] of Object.entries(cookies)) {
    all[filename] = { ...data, headers: { "User-Agent": DEFAULT_UA } };
  }
  const blob = new Blob([JSON.stringify(all, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  chrome.downloads.download({ url, filename: 'pt-cookies-all.json', saveAs: true });
  log('已下载 pt-cookies-all.json', 'ok');
}

btnRefresh.addEventListener('click', refreshAll);
btnVisit.addEventListener('click', visitAll);
btnExport.addEventListener('click', exportJson);

// 加载时显示已保存状态 + 自动触发保活
async function init() {
  const { cookies } = await new Promise(r => chrome.storage.local.get('cookies', r));
  if (cookies && Object.keys(cookies).length > 0) {
    renderStatus(SITES.map(s => ({
      name: s.name,
      status: cookies[s.file] ? 'success' : 'inactive'
    })));
  }

  // 每次打开 popup 时自动执行一次保活
  setTimeout(() => {
    logArea.style.display = 'block';
    logArea.innerHTML = '';
    log('自动保活: 正在打开所有站点...');
    SITES.forEach((site, i) => {
      setTimeout(() => {
        log(`${site.name}: ${site.url}`, 'info');
        chrome.tabs.create({ url: site.url, active: false }, tab => {
          setTimeout(() => { try { chrome.tabs.remove(tab.id); } catch(e) {} }, 3000);
        });
      }, i * 200);
    });
    setTimeout(() => log('自动保活完成', 'ok'), SITES.length * 200 + 3500);
  }, 2000);
}

init();
