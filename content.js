// 内容脚本 - 注入到 M-Team 页面，拦截 API 请求头
// 用于捕获 Authorization、did、visitorid 等认证信息

(() => {
  const MTEAM_API_HOST = 'api.m-team.io';

  // 拦截 fetch，捕获特定请求头
  const originalFetch = window.fetch;
  window.fetch = async (...args) => {
    const [input] = args;
    const url = typeof input === 'string' ? input : input.url;

    if (url.includes(MTEAM_API_HOST)) {
      // 尝试从已发送请求中提取头
      try {
        const headers = {};
        // 从当前页面的 storage 尝试读取（如果有登录信息）
        const stored = await chrome.storage.local.get('mteam_headers');
        if (stored.mteam_headers) {
          chrome.runtime.sendMessage({ type: 'MTEAM_HEADERS_FETCHED', headers: stored.mteam_headers });
        }
      } catch (e) {}
    }

    return originalFetch(...args);
  };

  // 拦截 XMLHttpRequest
  const originalXHR = window.XMLHttpRequest;
  window.XMLHttpRequest = function () {
    const xhr = new originalXHR();
    xhr.addEventListener('load', () => {
      if (xhr.responseURL && xhr.responseURL.includes(MTEAM_API_HOST)) {
        // XHR 的 Authorization 头可以从 response 响应头获取，或者
        // 直接从页面的 Auth 存储读取
        fetchMTeamHeadersFromPage();
      }
    });
    return xhr;
  };

  async function fetchMTeamHeadersFromPage() {
    try {
      // 尝试从 localStorage/sessionStorage 中找到 token
      const data = {};

      // 遍历所有 storage key
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key) {
          const val = localStorage.getItem(key);
          if (val && (key.toLowerCase().includes('token') || key.toLowerCase().includes('auth') || key.toLowerCase().includes('jwt') || key.toLowerCase().includes('mteam'))) {
            data[key] = val;
          }
        }
      }

      if (Object.keys(data).length > 0) {
        chrome.storage.local.set({ mteam_headers: data });
      }
    } catch (e) {}
  }

  // 监听来自 popup 的消息
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'GET_MTEAM_HEADERS') {
      // 尝试从页面中提取 API 请求中已发送的认证信息
      // 通过注入脚本方式获取页面脚本环境中的变量
      chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
        if (!tab) { sendResponse({}); return; }
        chrome.tabs.executeScript(tab.id, {
          code: `
            (() => {
              const result = {};
              // 尝试从 localStorage 找 token
              for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                if (k && (k.includes('token') || k.includes('auth') || k.includes('Authorization'))) {
                  result[k] = localStorage.getItem(k);
                }
              }
              // 也检查 sessionStorage
              for (let i = 0; i < sessionStorage.length; i++) {
                const k = sessionStorage.key(i);
                if (k && (k.includes('token') || k.includes('auth'))) {
                  result[k] = sessionStorage.getItem(k);
                }
              }
              return result;
            })()
          `
        }, (vals) => {
          sendResponse(vals?.[0] || {});
        });
      });
      return true; // 异步响应
    }
  });
})();