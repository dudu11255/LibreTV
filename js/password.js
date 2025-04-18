// 密码保护功能

/**
 * 检查是否设置了密码保护
 * 通过读取页面上嵌入的环境变量来检查
 */
function isPasswordProtected() {
    // 检查页面上嵌入的环境变量
    const passwordRequired = window.__ENV__ && window.__ENV__.PASSWORD_HASH && window.__ENV__.PASSWORD_HASH.trim() !== '';
    return passwordRequired;
}

/**
 * 检查用户是否已通过密码验证
 * 检查localStorage中的验证状态和时间戳是否有效
 */
function isPasswordVerified() {
    try {
        // 如果没有设置密码保护，则视为已验证
        if (!isPasswordProtected()) {
            return true;
        }

        const verificationData = JSON.parse(localStorage.getItem(PASSWORD_CONFIG.localStorageKey) || '{}');
        const { verified, timestamp } = verificationData;
        
        // 验证是否已验证且未过期
        if (verified && timestamp) {
            const now = Date.now();
            const expiry = timestamp + PASSWORD_CONFIG.verificationTTL;
            return now < expiry;
        }
        
        return false;
    } catch (error) {
        console.error('验证密码状态时出错:', error);
        return false;
    }
}

window.isPasswordProtected = isPasswordProtected;
window.isPasswordVerified = isPasswordVerified;

/**
 * 验证用户输入的密码是否正确
 */
async function verifyPassword(password) {
    // 检查密码是否匹配环境变量中设置的哈希密码
    const correctPasswordHash = window.__ENV__ && window.__ENV__.PASSWORD_HASH;
    
    if (!correctPasswordHash) {
        return true; // 如果没有设置密码，认为验证成功
    }
    
    // 对输入的密码进行哈希处理
    const inputPasswordHash = await sha256(password);
    const isValid = inputPasswordHash === correctPasswordHash;
    
    if (isValid) {
        // 保存验证状态到localStorage
        const verificationData = {
            verified: true,
            timestamp: Date.now()
        };
        localStorage.setItem(PASSWORD_CONFIG.localStorageKey, JSON.stringify(verificationData));
    }
    
    return isValid;
}

/**
 * 将字符串转换为SHA-256哈希
 */
async function sha256(message) {
    // 编码为 UTF-8
    const msgBuffer = new TextEncoder().encode(message);                    
    // 哈希消息
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    // 转换为十六进制字符串
    return Array.from(new Uint8Array(hashBuffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

/**
 * 显示密码验证弹窗
 */
function showPasswordModal() {
    const passwordModal = document.getElementById('passwordModal');
    if (passwordModal) {
        passwordModal.style.display = 'flex';
        
        // 确保输入框获取焦点
        setTimeout(() => {
            const passwordInput = document.getElementById('passwordInput');
            if (passwordInput) {
                passwordInput.focus();
            }
        }, 100);
    }
}

/**
 * 隐藏密码验证弹窗
 */
function hidePasswordModal() {
    const passwordModal = document.getElementById('passwordModal');
    if (passwordModal) {
        passwordModal.style.display = 'none';
    }
}

/**
 * 显示密码错误信息
 */
function showPasswordError() {
    const errorElement = document.getElementById('passwordError');
    if (errorElement) {
        errorElement.classList.remove('hidden');
    }
}

/**
 * 隐藏密码错误信息
 */
function hidePasswordError() {
    const errorElement = document.getElementById('passwordError');
    if (errorElement) {
        errorElement.classList.add('hidden');
    }
}

/**
 * 处理密码提交事件
 */
async function handlePasswordSubmit() {
    const passwordInput = document.getElementById('passwordInput');
    const password = passwordInput ? passwordInput.value.trim() : '';
    
    const isValid = await verifyPassword(password);
    if (isValid) {
        hidePasswordError();
        hidePasswordModal();
    } else {
        showPasswordError();
        // 清空密码输入框
        if (passwordInput) {
            passwordInput.value = '';
            passwordInput.focus();
        }
    }
}

/**
 * 初始化密码验证系统
 */
function initPasswordProtection() {
    if (!isPasswordProtected()) {
        return; // 如果未设置密码保护，则不进行任何操作
    }
    
    // 如果未验证密码，则显示密码验证弹窗
    if (!isPasswordVerified()) {
        showPasswordModal();
        
        // 设置密码提交按钮事件监听
        const submitButton = document.getElementById('passwordSubmitBtn');
        if (submitButton) {
            submitButton.addEventListener('click', handlePasswordSubmit);
        }
        
        // 设置密码输入框回车键监听
        const passwordInput = document.getElementById('passwordInput');
        if (passwordInput) {
            passwordInput.addEventListener('keypress', function(e) {
                if (e.key === 'Enter') {
                    handlePasswordSubmit();
                }
            });
        }
    }
}

// 在页面加载完成后初始化密码保护
document.addEventListener('DOMContentLoaded', initPasswordProtection);