// 空壳设计：不内置任何数据源，全部由用户在设置中添加自定义 API。
const CUSTOMER_SITES = {};

// 调用全局方法合并
if (window.extendAPISites) {
    window.extendAPISites(CUSTOMER_SITES);
} else {
    console.error("错误：请先加载 config.js！");
}
