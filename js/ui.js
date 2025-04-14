// UI相关函数
function toggleSettings(e) {
    // 阻止事件冒泡，防止触发document的点击事件
    e && e.stopPropagation();
    const panel = document.getElementById('settingsPanel');
    panel.classList.toggle('show');
}

// 改进的Toast显示函数 - 支持队列显示多个Toast
const toastQueue = [];
let isShowingToast = false;

function showToast(message, type = 'error') {
    // 将新的toast添加到队列
    toastQueue.push({ message, type });
    
    // 如果当前没有显示中的toast，则开始显示
    if (!isShowingToast) {
        showNextToast();
    }
}

function showNextToast() {
    if (toastQueue.length === 0) {
        isShowingToast = false;
        return;
    }
    
    isShowingToast = true;
    const { message, type } = toastQueue.shift();
    
    const toast = document.getElementById('toast');
    const toastMessage = document.getElementById('toastMessage');
    
    const bgColors = {
        'error': 'bg-red-500',
        'success': 'bg-green-500',
        'info': 'bg-blue-500',
        'warning': 'bg-yellow-500'
    };
    
    const bgColor = bgColors[type] || bgColors.error;
    toast.className = `fixed top-4 left-1/2 -translate-x-1/2 px-6 py-3 rounded-lg shadow-lg transform transition-all duration-300 ${bgColor} text-white`;
    toastMessage.textContent = message;
    
    // 显示提示
    toast.style.opacity = '1';
    toast.style.transform = 'translateX(-50%) translateY(0)';
    
    // 3秒后自动隐藏
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(-50%) translateY(-100%)';
        
        // 等待动画完成后显示下一个toast
        setTimeout(() => {
            showNextToast();
        }, 300);
    }, 3000);
}

// 添加显示/隐藏 loading 的函数
let loadingTimeoutId = null;

function showLoading(message = '加载中...') {
    // 清除任何现有的超时
    if (loadingTimeoutId) {
        clearTimeout(loadingTimeoutId);
    }
    
    const loading = document.getElementById('loading');
    const messageEl = loading.querySelector('p');
    messageEl.textContent = message;
    loading.style.display = 'flex';
    
    // 设置30秒后自动关闭loading，防止无限loading
    loadingTimeoutId = setTimeout(() => {
        hideLoading();
        showToast('操作超时，请稍后重试', 'warning');
    }, 30000);
}

function hideLoading() {
    // 清除超时
    if (loadingTimeoutId) {
        clearTimeout(loadingTimeoutId);
        loadingTimeoutId = null;
    }
    
    const loading = document.getElementById('loading');
    loading.style.display = 'none';
}

function updateSiteStatus(isAvailable) {
    const statusEl = document.getElementById('siteStatus');
    if (isAvailable) {
        statusEl.innerHTML = '<span class="text-green-500">●</span> 可用';
    } else {
        statusEl.innerHTML = '<span class="text-red-500">●</span> 不可用';
    }
}

function closeModal() {
    document.getElementById('modal').classList.add('hidden');
    // 清除 iframe 内容
    document.getElementById('modalContent').innerHTML = '';
}

// 获取搜索历史的增强版本 - 支持新旧格式
function getSearchHistory() {
    try {
        const data = localStorage.getItem(SEARCH_HISTORY_KEY);
        if (!data) return [];
        
        const parsed = JSON.parse(data);
        
        // 检查是否是数组
        if (!Array.isArray(parsed)) return [];
        
        // 支持旧格式（字符串数组）和新格式（对象数组）
        return parsed.map(item => {
            if (typeof item === 'string') {
                return { text: item, timestamp: 0 };
            }
            return item;
        }).filter(item => item && item.text);
    } catch (e) {
        console.error('获取搜索历史出错:', e);
        return [];
    }
}

// 保存搜索历史的增强版本 - 添加时间戳和最大数量限制，现在缓存2个月
function saveSearchHistory(query) {
    if (!query || !query.trim()) return;
    
    // 清理输入，防止XSS
    query = query.trim().substring(0, 50).replace(/</g, '&lt;').replace(/>/g, '&gt;');
    
    let history = getSearchHistory();
    
    // 获取当前时间
    const now = Date.now();
    
    // 过滤掉超过2个月的记录（约60天，60*24*60*60*1000 = 5184000000毫秒）
    history = history.filter(item => 
        typeof item === 'object' && item.timestamp && (now - item.timestamp < 5184000000)
    );
    
    // 删除已存在的相同项
    history = history.filter(item => 
        typeof item === 'object' ? item.text !== query : item !== query
    );
    
    // 新项添加到开头，包含时间戳
    history.unshift({
        text: query,
        timestamp: now
    });
    
    // 限制历史记录数量
    if (history.length > MAX_HISTORY_ITEMS) {
        history = history.slice(0, MAX_HISTORY_ITEMS);
    }
    
    try {
        localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(history));
    } catch (e) {
        console.error('保存搜索历史失败:', e);
        // 如果存储失败（可能是localStorage已满），尝试清理旧数据
        try {
            localStorage.removeItem(SEARCH_HISTORY_KEY);
            localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(history.slice(0, 3)));
        } catch (e2) {
            console.error('再次保存搜索历史失败:', e2);
        }
    }
    
    renderSearchHistory();
}

// 渲染最近搜索历史的增强版本
function renderSearchHistory() {
    const historyContainer = document.getElementById('recentSearches');
    if (!historyContainer) return;
    
    const history = getSearchHistory();
    
    if (history.length === 0) {
        historyContainer.innerHTML = '';
        return;
    }
    
    // 创建一个包含标题和清除按钮的行
    historyContainer.innerHTML = `
        <div class="flex justify-between items-center w-full mb-2">
            <div class="text-gray-500">最近搜索:</div>
            <button id="clearHistoryBtn" class="text-gray-500 hover:text-white transition-colors" 
                    onclick="clearSearchHistory()" aria-label="清除搜索历史">
                清除搜索历史
            </button>
        </div>
    `;
    
    history.forEach(item => {
        const tag = document.createElement('button');
        tag.className = 'search-tag';
        tag.textContent = item.text;
        
        // 添加时间提示（如果有时间戳）
        if (item.timestamp) {
            const date = new Date(item.timestamp);
            tag.title = `搜索于: ${date.toLocaleString()}`;
        }
        
        tag.onclick = function() {
            document.getElementById('searchInput').value = item.text;
            search();
        };
        historyContainer.appendChild(tag);
    });
}

// 增加清除搜索历史功能
function clearSearchHistory() {
    try {
        localStorage.removeItem(SEARCH_HISTORY_KEY);
        renderSearchHistory();
        showToast('搜索历史已清除', 'success');
    } catch (e) {
        console.error('清除搜索历史失败:', e);
        showToast('清除搜索历史失败', 'error');
    }
}

// 历史面板相关函数
function toggleHistory(e) {
    if (e) e.stopPropagation();
    
    const panel = document.getElementById('historyPanel');
    if (panel) {
        panel.classList.toggle('show');
        
        // 如果打开了历史记录面板，则加载历史数据
        if (panel.classList.contains('show')) {
            loadViewingHistory();
        }
        
        // 如果设置面板是打开的，则关闭它
        const settingsPanel = document.getElementById('settingsPanel');
        if (settingsPanel && settingsPanel.classList.contains('show')) {
            settingsPanel.classList.remove('show');
        }
    }
}

// 格式化时间戳为友好的日期时间格式
function formatTimestamp(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now - date;
    
    // 小于1小时，显示"X分钟前"
    if (diff < 3600000) {
        const minutes = Math.floor(diff / 60000);
        return minutes <= 0 ? '刚刚' : `${minutes}分钟前`;
    }
    
    // 小于24小时，显示"X小时前"
    if (diff < 86400000) {
        const hours = Math.floor(diff / 3600000);
        return `${hours}小时前`;
    }
    
    // 小于7天，显示"X天前"
    if (diff < 604800000) {
        const days = Math.floor(diff / 86400000);
        return `${days}天前`;
    }
    
    // 其他情况，显示完整日期
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    const hour = date.getHours().toString().padStart(2, '0');
    const minute = date.getMinutes().toString().padStart(2, '0');
    
    return `${year}-${month}-${day} ${hour}:${minute}`;
}

// 获取观看历史记录
function getViewingHistory() {
    try {
        const data = localStorage.getItem('viewingHistory');
        return data ? JSON.parse(data) : [];
    } catch (e) {
        console.error('获取观看历史失败:', e);
        return [];
    }
}

// 加载观看历史并渲染
function loadViewingHistory() {
    const historyList = document.getElementById('historyList');
    if (!historyList) return;
    
    const history = getViewingHistory();
    
    if (history.length === 0) {
        historyList.innerHTML = `<div class="text-center text-gray-500 py-8">暂无观看记录</div>`;
        return;
    }
    
    // 渲染历史记录
    historyList.innerHTML = history.map(item => {
        // 防止XSS
        const safeTitle = item.title
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
        
        const safeSource = item.sourceName ? 
            item.sourceName.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') : 
            '未知来源';
            
        const episodeText = item.episodeIndex !== undefined ? 
            `第${item.episodeIndex + 1}集` : '';
        
        // 构建历史记录项HTML，移除缩略图，添加来源信息
        return `
            <div class="history-item cursor-pointer" onclick="playFromHistory('${item.url}', '${safeTitle}', ${item.episodeIndex || 0})">
                <div class="history-info">
                    <div class="history-title">${safeTitle}</div>
                    <div class="history-meta">
                        <span class="history-episode">${episodeText}</span>
                        ${episodeText ? '<span class="history-separator mx-1">·</span>' : ''}
                        <span class="history-source">${safeSource}</span>
                    </div>
                    <div class="history-time">${formatTimestamp(item.timestamp)}</div>
                </div>
            </div>
        `;
    }).join('');
}

// 从历史记录播放
function playFromHistory(url, title, episodeIndex) {
    // 构造播放页面URL并跳转
    const playerUrl = `player.html?url=${encodeURIComponent(url)}&title=${encodeURIComponent(title)}&index=${episodeIndex}`;
    window.open(playerUrl, '_blank');
}

// 添加观看历史
function addToViewingHistory(videoInfo) {
    try {
        const history = getViewingHistory();
        
        // 检查是否已经存在相同的项目（基于URL）
        const existingIndex = history.findIndex(item => item.url === videoInfo.url);
        if (existingIndex !== -1) {
            // 存在则移除旧的记录
            history.splice(existingIndex, 1);
        }
        
        // 添加新记录到最前面
        history.unshift({
            ...videoInfo,
            timestamp: Date.now()
        });
        
        // 限制历史记录数量为50条
        const maxHistoryItems = 50;
        if (history.length > maxHistoryItems) {
            history.splice(maxHistoryItems);
        }
        
        // 保存到本地存储
        localStorage.setItem('viewingHistory', JSON.stringify(history));
    } catch (e) {
        console.error('保存观看历史失败:', e);
    }
}

// 清空观看历史
function clearViewingHistory() {
    try {
        localStorage.removeItem('viewingHistory');
        loadViewingHistory(); // 重新加载空的历史记录
        showToast('观看历史已清空', 'success');
    } catch (e) {
        console.error('清除观看历史失败:', e);
        showToast('清除观看历史失败', 'error');
    }
}

// 更新toggleSettings函数以处理历史面板互动
const originalToggleSettings = toggleSettings;
toggleSettings = function(e) {
    if (e) e.stopPropagation();
    
    // 原始设置面板切换逻辑
    originalToggleSettings(e);
    
    // 如果历史记录面板是打开的，则关闭它
    const historyPanel = document.getElementById('historyPanel');
    if (historyPanel && historyPanel.classList.contains('show')) {
        historyPanel.classList.remove('show');
    }
};

// 点击外部关闭历史面板
document.addEventListener('DOMContentLoaded', function() {
    document.addEventListener('click', function(e) {
        const historyPanel = document.getElementById('historyPanel');
        const historyButton = document.querySelector('button[onclick="toggleHistory(event)"]');
        
        if (historyPanel && historyButton && 
            !historyPanel.contains(e.target) && 
            !historyButton.contains(e.target) && 
            historyPanel.classList.contains('show')) {
            historyPanel.classList.remove('show');
        }
    });
});
