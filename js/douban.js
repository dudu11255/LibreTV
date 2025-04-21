// 豆瓣热门电影电视剧推荐功能

// 豆瓣标签列表
const doubanTags = ['热门', '最新', '经典', '可播放', '豆瓣高分', '冷门佳片', '华语', '欧美', '韩国', '日本'];
let doubanCurrentTag = localStorage.getItem('doubanCurrentTag') || '热门';
let doubanPageStart = 0;
const doubanPageSize = 16; // 一次显示的项目数量

// 初始化豆瓣功能
function initDouban() {
    // 设置豆瓣开关的初始状态
    const doubanToggle = document.getElementById('doubanToggle');
    if (doubanToggle) {
        const isEnabled = localStorage.getItem('doubanEnabled') === 'true';
        doubanToggle.checked = isEnabled;
        
        // 设置开关外观
        const toggleBg = doubanToggle.nextElementSibling;
        const toggleDot = toggleBg.nextElementSibling;
        if (isEnabled) {
            toggleBg.classList.add('bg-pink-600');
            toggleDot.classList.add('translate-x-6');
        }
        
        // 添加事件监听
        doubanToggle.addEventListener('change', function(e) {
            const isChecked = e.target.checked;
            localStorage.setItem('doubanEnabled', isChecked);
            
            // 更新开关外观
            if (isChecked) {
                toggleBg.classList.add('bg-pink-600');
                toggleDot.classList.add('translate-x-6');
            } else {
                toggleBg.classList.remove('bg-pink-600');
                toggleDot.classList.remove('translate-x-6');
            }
            
            // 更新显示状态
            updateDoubanVisibility();
        });
        
        // 初始更新显示状态
        updateDoubanVisibility();
    }
    
    // 渲染豆瓣标签
    renderDoubanTags();
    
    // 换一批按钮事件监听
    setupDoubanRefreshBtn();
    
    // 初始加载热门内容
    if (localStorage.getItem('doubanEnabled') === 'true') {
        renderRecommend(doubanCurrentTag, doubanPageSize, doubanPageStart);
    }
}

// 根据设置更新豆瓣区域的显示状态
function updateDoubanVisibility() {
    const doubanArea = document.getElementById('doubanArea');
    if (!doubanArea) return;
    
    const isEnabled = localStorage.getItem('doubanEnabled') === 'true';
    const isSearching = document.getElementById('resultsArea') && 
        !document.getElementById('resultsArea').classList.contains('hidden');
    
    // 只有在启用且没有搜索结果显示时才显示豆瓣区域
    if (isEnabled && !isSearching) {
        doubanArea.classList.remove('hidden');
        // 如果豆瓣结果为空，重新加载
        if (document.getElementById('douban-results').children.length === 0) {
            renderRecommend(doubanCurrentTag, doubanPageSize, doubanPageStart);
        }
    } else {
        doubanArea.classList.add('hidden');
    }
}

// 只填充搜索框，不执行搜索，让用户自主决定搜索时机
function fillSearchInput(title) {
    if (!title) return;
    
    // 安全处理标题，防止XSS
    const safeTitle = title
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    
    const input = document.getElementById('searchInput');
    if (input) {
        input.value = safeTitle;
        
        // 聚焦搜索框，便于用户立即使用键盘操作
        input.focus();
        
        // 显示一个提示，告知用户点击搜索按钮进行搜索
        showToast('已填充搜索内容，点击搜索按钮开始搜索', 'info');
    }
}

// 填充搜索框并执行搜索
function fillAndSearch(title) {
    if (!title) return;
    
    // 安全处理标题，防止XSS
    const safeTitle = title
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    
    const input = document.getElementById('searchInput');
    if (input) {
        input.value = safeTitle;
        search(); // 使用已有的search函数执行搜索
    }
}

// 渲染豆瓣标签选择器
function renderDoubanTags() {
    const tagContainer = document.getElementById('douban-tags');
    if (!tagContainer) return;
    
    tagContainer.innerHTML = '';
    
    doubanTags.forEach(tag => {
        const btn = document.createElement('button');
        btn.className = 'px-3 py-1 rounded text-xs font-medium mr-1 mb-1 ' + 
            (tag === doubanCurrentTag ? 
                'bg-pink-600 text-white' : 
                'bg-[#222] text-gray-300 hover:bg-pink-700 hover:text-white transition');
        
        btn.textContent = tag;
        
        btn.onclick = function() {
            if (doubanCurrentTag !== tag) {
                doubanCurrentTag = tag;
                localStorage.setItem('doubanCurrentTag', tag);
                doubanPageStart = 0;
                renderRecommend(doubanCurrentTag, doubanPageSize, doubanPageStart);
                renderDoubanTags();
            }
        };
        
        tagContainer.appendChild(btn);
    });
}

// 设置换一批按钮事件
function setupDoubanRefreshBtn() {
    const btn = document.getElementById('douban-refresh-btn');
    if (!btn) return;
    
    btn.onclick = function() {
        doubanPageStart += doubanPageSize;
        if (doubanPageStart > 9 * doubanPageSize) {
            doubanPageStart = 0;
        }
        
        renderRecommend(doubanCurrentTag, doubanPageSize, doubanPageStart);
    };
}

// 渲染热门推荐内容
function renderRecommend(tag, pageLimit, pageStart) {
    const container = document.getElementById("douban-results");
    if (!container) return;
    
    // 显示加载状态
    container.innerHTML = `
        <div class="col-span-full flex justify-center items-center p-10">
            <div class="w-6 h-6 border-2 border-pink-500 border-t-transparent rounded-full animate-spin mr-2"></div>
            <span class="text-pink-500">加载中...</span>
        </div>
    `;
    
    const target = `https://movie.douban.com/j/search_subjects?type=movie&tag=${tag}&sort=recommend&page_limit=${pageLimit}&page_start=${pageStart}`;

    fetch(PROXY_URL + encodeURIComponent(target))
        .then(response => response.json())
        .then(data => {
            // 创建文档片段以提高性能
            const fragment = document.createDocumentFragment();
            
            // 如果没有数据
            if (!data.subjects || data.subjects.length === 0) {
                const emptyEl = document.createElement("div");
                emptyEl.className = "col-span-full text-center py-8";
                emptyEl.innerHTML = `
                    <div class="text-pink-500">❌ 暂无数据，请尝试其他分类或刷新</div>
                `;
                fragment.appendChild(emptyEl);
            } else {
                // 循环创建每个影视卡片
                data.subjects.forEach(item => {
                    const card = document.createElement("div");
                    card.className = "bg-[#111] hover:bg-[#222] transition-all duration-300 rounded-lg overflow-hidden flex flex-col transform hover:scale-105 shadow-md hover:shadow-lg";
                    
                    // 生成卡片内容，确保安全显示（防止XSS）
                    const safeTitle = item.title
                        .replace(/</g, '&lt;')
                        .replace(/>/g, '&gt;')
                        .replace(/"/g, '&quot;');
                    
                    const safeRate = (item.rate || "暂无")
                        .replace(/</g, '&lt;')
                        .replace(/>/g, '&gt;');
                    
                    // 修复图片加载问题：使用备用图片URL方案
                    // 1. 尝试使用原始图片地址但不通过代理
                    // 2. 如果加载失败，使用备用图片
                    const originalCoverUrl = item.cover;
                    
                    card.innerHTML = `
                        <div class="relative w-full aspect-[2/3] overflow-hidden cursor-pointer" onclick="fillSearchInput('${safeTitle}')">
                            <img src="${originalCoverUrl}" alt="${safeTitle}" 
                                class="w-full h-full object-cover transition-transform duration-500 hover:scale-110"
                                onerror="this.onerror=null; this.src='https://via.placeholder.com/300x450/111111/FFFFFF?text=${encodeURIComponent(safeTitle)}'; this.classList.add('object-contain');"
                                loading="lazy">
                            <div class="absolute inset-0 bg-gradient-to-t from-black to-transparent opacity-60"></div>
                            <div class="absolute bottom-2 left-2 bg-black/70 text-white text-xs px-2 py-1 rounded-sm">
                                <span class="text-yellow-400">★</span> ${safeRate}
                            </div>
                        </div>
                        <div class="p-2 text-center bg-[#111]">
                            <button onclick="fillSearchInput('${safeTitle}')" 
                                    class="text-sm font-medium text-white truncate w-full hover:text-pink-400 transition">
                                ${safeTitle}
                            </button>
                        </div>
                    `;
                    
                    fragment.appendChild(card);
                });
            }
            
            // 清空并添加所有新元素
            container.innerHTML = "";
            container.appendChild(fragment);
        })
        .catch(err => {
            container.innerHTML = `
                <div class="col-span-full text-center py-8">
                    <div class="text-red-400">❌ 获取豆瓣数据失败，请稍后重试</div>
                </div>
            `;
            console.error("豆瓣 API 请求失败：", err);
        });
}

// 重置到首页
function resetToHome() {
    resetSearchArea();
    updateDoubanVisibility();
}

// 加载豆瓣首页内容
document.addEventListener('DOMContentLoaded', initDouban);