/**
 * 本地存储管理（简化版）
 */
const Storage = {
    GUIDE_KEY: 'optics_guide_completed',
    SHARED_DESIGNS_KEY: 'optics_shared_designs',

    /**
     * 检查引导是否完成
     */
    isGuideCompleted() {
        try {
            return localStorage.getItem(this.GUIDE_KEY) === 'true';
        } catch (e) {
            return false;
        }
    },

    /**
     * 标记引导完成
     */
    setGuideCompleted() {
        try {
            localStorage.setItem(this.GUIDE_KEY, 'true');
        } catch (e) {
            // 忽略存储错误
        }
    },

    /**
     * 重置引导状态
     */
    resetGuide() {
        try {
            localStorage.removeItem(this.GUIDE_KEY);
        } catch (e) {
            // 忽略存储错误
        }
    },

    /**
     * 保存一条分享记录
     */
    saveSharedDesign(record) {
        try {
            const records = this.getSharedDesigns();
            records.unshift(record);
            // 只保留最近的若干条，避免超出存储上限
            const trimmed = records.slice(0, CONFIG.SHARE.MAX_RECORDS);
            localStorage.setItem(this.SHARED_DESIGNS_KEY, JSON.stringify(trimmed));
            return true;
        } catch (e) {
            return false;
        }
    },

    /**
     * 获取本地保存的分享记录列表
     */
    getSharedDesigns() {
        try {
            const data = localStorage.getItem(this.SHARED_DESIGNS_KEY);
            const records = data ? JSON.parse(data) : [];
            return Array.isArray(records) ? records : [];
        } catch (e) {
            return [];
        }
    }
};
