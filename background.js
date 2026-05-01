// 后台服务 - 拦截 M-Team API 请求，捕获 Authorization 头

const MTEAM_API_HOST = 'api.m-team.io';
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

function visitAllSites() {
  console.log('[PT Keeper] 执行自动保活访问');
  SITES.forEach(site => {
    chrome.tabs.create({ url: site.url, active: false }, tab => {
      setTimeout(() => { try { chrome.tabs.remove(tab.id); } catch(e) {} }, 3000);
    });
  });
}

function registerMTeamInterceptor() {
  chrome.webRequest.onBeforeSendHeaders.addListener(
    (details) => {
      try {
        const url = new URL(details.url);
        if (url.host === MTEAM_API_HOST && url.pathname === '/api/member/profile') {
          const getHeader = name => details.requestHeaders.find(h => h.name === name)?.value || '';
          capturedMTeamHeaders = {
            authorization: getHeader('Authorization'),
            did: getHeader('did'),
            visitorid: getHeader('visitorid'),
            version: getHeader('version') || '1.1.4',
            webversion: getHeader('webversion') || '1140',
          };
          chrome.storage.local.set({ mteam_captured: capturedMTeamHeaders });
        }
      } catch (e) {}
      return {};
    },
    { urls: [`https://${MTEAM_API_HOST}/*`] },
    ['requestHeaders']
  );
}

// 每次浏览器启动 / 扩展首次加载时触发 auto visit
function onFirstRun() {
  visitAllSites();
}

// 安装时
chrome.runtime.onInstalled.addListener(() => {
  registerMTeamInterceptor();
  onFirstRun();
});

// 浏览器启动时（每次打开浏览器都会触发）
chrome.runtime.onStartup.addListener(() => {
  registerMTeamInterceptor();
  onFirstRun();
});

// 处理 popup 消息
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