/**
 * 只读分享管理器
 *
 * 把当前画布上的实验配置（透镜类型、材料与关键参数、光源模式）序列化为一份
 * 分享记录：记录经 base64 编码后放入链接 hash，打开链接即进入只读视图。
 *
 * 只读视图使用独立的 Canvas / Renderer 渲染，不修改主画布管理器的任何状态，
 * 因此返回主界面后，用户自己的编辑内容与透镜选中状态保持不变。
 */
class ShareManager {
    constructor(canvasManager) {
        this.canvasManager = canvasManager;

        // 只读视图相关
        this.overlay = document.getElementById('share-view');
        this.viewCanvas = document.getElementById('share-canvas');
        this.viewRenderer = null;
        this.viewLenses = [];
        this.record = null;
        this.originalWidth = 0;
        this.originalHeight = 0;
        this.handleViewResize = null;

        // 生成分享弹窗相关
        this.createModal = document.getElementById('share-create-modal');
        this.linkInput = document.getElementById('share-link-input');
        this.lastRecord = null;

        this.init();
    }

    /**
     * 当前是否正处于只读分享视图
     */
    static isShareViewActive() {
        const overlay = document.getElementById('share-view');
        return !!overlay && !overlay.classList.contains('hidden');
    }

    init() {
        this.bindCreateEvents();
        this.bindViewEvents();

        // 打开页面时链接中带有分享记录，则直接进入只读视图
        const record = this.readRecordFromHash();
        if (record) {
            this.openView(record);
        }
    }

    /**
     * 绑定“生成分享记录”相关事件
     */
    bindCreateEvents() {
        document.getElementById('btn-share').addEventListener('click', () => {
            this.openCreateModal();
        });

        document.getElementById('btn-share-create-close').addEventListener('click', () => {
            this.closeCreateModal();
        });

        document.getElementById('btn-share-create-cancel').addEventListener('click', () => {
            this.closeCreateModal();
        });

        this.createModal.addEventListener('click', (e) => {
            if (e.target === this.createModal) {
                this.closeCreateModal();
            }
        });

        document.getElementById('btn-copy-share-link').addEventListener('click', () => {
            this.copyLink();
        });

        document.getElementById('btn-share-open-preview').addEventListener('click', () => {
            if (this.lastRecord) {
                this.closeCreateModal();
                this.openView(this.lastRecord);
            }
        });
    }

    /**
     * 绑定只读视图内事件
     */
    bindViewEvents() {
        document.getElementById('btn-share-back').addEventListener('click', () => {
            this.closeView();
        });

        // 只读视图内的画布不绑定任何指针 / 拖放事件，
        // 从交互层面保证不能拖动、改动或删除透镜。
    }

    /**
     * 由当前画布生成分享记录
     */
    createRecord() {
        const renderer = this.canvasManager.getRenderer();
        const lenses = this.canvasManager.lenses.map(lens => lens.toJSON());

        return {
            version: 1,
            createdAt: Date.now(),
            lensCount: lenses.length,
            lightMode: renderer.lightMode,
            canvas: {
                width: renderer.width,
                height: renderer.height
            },
            lenses
        };
    }

    /**
     * 打开“生成分享记录”弹窗
     */
    openCreateModal() {
        const record = this.createRecord();
        this.lastRecord = record;
        this.saveRecordMeta(record);

        const url = this.buildShareUrl(record);
        this.linkInput.value = url;

        // 摘要信息
        const chips = document.getElementById('share-summary-chips');
        const lightName = record.lightMode === CONFIG.LIGHT_MODES.POINT ? '点光源' : '平行光';
        chips.innerHTML = `
            <span class="share-summary-chip">透镜数量：<strong>${record.lensCount}</strong></span>
            <span class="share-summary-chip">光源：<strong>${lightName}</strong></span>
            <span class="share-summary-chip">权限：<strong>仅查看（不可编辑）</strong></span>
        `;

        document.getElementById('share-empty-note').classList.toggle('hidden', record.lensCount > 0);
        this.createModal.classList.remove('hidden');
    }

    closeCreateModal() {
        this.createModal.classList.add('hidden');
    }

    /**
     * 复制分享链接
     */
    async copyLink() {
        const url = this.linkInput.value;
        if (!url) return;

        const btn = document.getElementById('btn-copy-share-link');

        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(url);
            } else {
                // 兼容不支持 Clipboard API 的环境（如 file:// 直接打开）
                this.linkInput.removeAttribute('readonly');
                this.linkInput.select();
                document.execCommand('copy');
                this.linkInput.setAttribute('readonly', 'readonly');
            }
            const oldText = btn.textContent;
            btn.textContent = '已复制 ✓';
            setTimeout(() => { btn.textContent = oldText; }, 1500);
            Utils.showToast('分享链接已复制，对方打开即为只读视图', 'success');
        } catch (e) {
            this.linkInput.removeAttribute('readonly');
            this.linkInput.select();
            Utils.showToast('复制失败，请手动选中链接复制', 'warning');
        }
    }

    /**
     * 构造包含分享记录的链接
     */
    buildShareUrl(record) {
        const encoded = ShareManager.encodeRecord(record);
        const base = location.origin && location.origin !== 'null'
            ? location.origin + location.pathname
            : location.href.split('#')[0];
        return `${base}#share=${encoded}`;
    }

    /**
     * 保存分享记录摘要到本地（纯前端环境下作为本地留存，
     * 完整记录以链接 hash 为准，可跨设备打开）
     */
    saveRecordMeta(record) {
        const key = CONFIG.STORAGE_KEYS.SHARES;
        let list = [];
        try {
            list = JSON.parse(localStorage.getItem(key) || '[]');
            if (!Array.isArray(list)) list = [];
        } catch (e) {
            list = [];
        }

        list.unshift({
            createdAt: record.createdAt,
            lensCount: record.lensCount,
            lightMode: record.lightMode
        });
        list = list.slice(0, 20);

        try {
            localStorage.setItem(key, JSON.stringify(list));
        } catch (e) {
            // 忽略存储错误
        }
    }

    /**
     * 读取并解码链接中的分享记录
     */
    readRecordFromHash() {
        const match = /(?:^#|&)share=([^&]+)/.exec(location.hash || '');
        if (!match) return null;

        try {
            const json = decodeURIComponent(escape(atob(decodeURIComponent(match[1]))));
            const record = JSON.parse(json);
            return ShareManager.isValidRecord(record) ? record : null;
        } catch (e) {
            return null;
        }
    }

    static encodeRecord(record) {
        const json = JSON.stringify(record);
        return encodeURIComponent(btoa(unescape(encodeURIComponent(json))));
    }

    static isValidRecord(record) {
        return record
            && typeof record === 'object'
            && Array.isArray(record.lenses)
            && typeof record.createdAt === 'number';
    }

    /**
     * 打开只读分享视图
     */
    openView(record) {
        this.record = record;
        this.originalWidth = (record.canvas && record.canvas.width) || 0;
        this.originalHeight = (record.canvas && record.canvas.height) || 0;

        // 先展示视图，再创建渲染器，确保画布容器已有实际尺寸
        this.overlay.classList.remove('hidden');

        document.getElementById('share-title').textContent = '实验配置分享';
        document.getElementById('share-time').textContent =
            '分享时间：' + Utils.formatDate(record.createdAt);
        document.getElementById('share-light-mode').textContent =
            record.lightMode === CONFIG.LIGHT_MODES.POINT ? '点光源' : '平行光';

        this.renderWarnings(record);

        // 使用独立的渲染器渲染只读画布，不触碰主画布
        this.viewRenderer = new Renderer(this.viewCanvas);
        this.viewRenderer.setLightMode(record.lightMode || CONFIG.LIGHT_DEFAULTS.mode);
        this.viewLenses = this.buildViewLenses(record);
        this.viewRenderer.setLenses(this.viewLenses);
        this.viewRenderer.setRunning(true);

        this.renderLensCards(record);
        this.updateEmptyState(record);

        // 视图尺寸变化时仅重排只读画布
        this.handleViewResize = Utils.debounce(() => {
            if (!this.viewRenderer) return;
            this.viewRenderer.resize();
            this.relayoutLenses();
            this.viewRenderer.setLenses(this.viewLenses);
            this.viewRenderer.setRunning(true);
        }, 100);
        window.addEventListener('resize', this.handleViewResize);
    }

    /**
     * 由分享记录构建视图透镜（按画布尺寸比例换算位置）
     */
    buildViewLenses(record) {
        return record.lenses.map(data => {
            const lens = new Lens({
                id: data.id,
                type: data.type,
                x: 0,
                y: 0,
                size: data.size,
                curvature: data.curvature,
                material: data.material
            });

            // 记录中的折射率为实际使用值，恢复它（材料缺失时不能被默认值覆盖）
            if (typeof data.refractiveIndex === 'number') {
                lens.refractiveIndex = data.refractiveIndex;
            }
            // 只读：不显示任何选中高亮
            lens.selected = false;

            this.placeLens(lens, data);
            return lens;
        });
    }

    /**
     * 按原始画布与当前画布的比例换算透镜位置
     */
    placeLens(lens, data) {
        const ratioX = this.originalWidth
            ? this.viewRenderer.width / this.originalWidth : 1;
        const ratioY = this.originalHeight
            ? this.viewRenderer.height / this.originalHeight : 1;

        const sourceW = this.originalWidth || this.viewRenderer.width;
        const sourceH = this.originalHeight || this.viewRenderer.height;
        const srcX = typeof data.x === 'number' ? data.x : sourceW / 2;
        const srcY = typeof data.y === 'number' ? data.y : sourceH / 2;

        lens.x = Utils.clamp(srcX * ratioX, 50, this.viewRenderer.width - 50);
        lens.y = Utils.clamp(srcY * ratioY, 50, this.viewRenderer.height - 50);
    }

    relayoutLenses() {
        this.record.lenses.forEach((data, i) => {
            if (this.viewLenses[i]) {
                this.placeLens(this.viewLenses[i], data);
            }
        });
    }

    isKnownMaterial(materialId) {
        return Object.values(CONFIG.MATERIALS).some(m => m.id === materialId);
    }

    isKnownLensType(type) {
        return Object.values(CONFIG.LENS_TYPES).indexOf(type) !== -1;
    }

    /**
     * 渲染异常说明横幅
     */
    renderWarnings(record) {
        const container = document.getElementById('share-warnings');
        const warnings = [];

        if (record.lenses.length === 0) {
            warnings.push('这份分享记录中没有透镜，无法展示光路，只能查看空画布与光源设置。');
        } else {
            const missing = record.lenses.filter(l => !this.isKnownMaterial(l.material));
            if (missing.length > 0) {
                const names = missing.map(l => l.material == null ? '（未指定）' : `“${l.material}”`);
                warnings.push(
                    `有 ${missing.length} 个透镜引用的材料已不存在（${names.join('、')}），`
                    + '相关参数仍按分享时的数值只读展示，光路颜色使用默认样式。'
                );
            }

            const badType = record.lenses.filter(l => !this.isKnownLensType(l.type));
            if (badType.length > 0) {
                warnings.push(`有 ${badType.length} 个透镜的类型无法识别，可能来自更新版本的应用。`);
            }
        }

        container.innerHTML = warnings.map(text => `
            <div class="share-warning">
                <span class="share-warning-icon">⚠️</span>
                <span>${this.escapeHtml(text)}</span>
            </div>
        `).join('');
    }

    updateEmptyState(record) {
        const empty = document.getElementById('share-canvas-empty');
        empty.classList.toggle('hidden', record.lenses.length > 0);
    }

    /**
     * 渲染右侧只读透镜参数卡片
     */
    renderLensCards(record) {
        const container = document.getElementById('share-lens-cards');

        if (record.lenses.length === 0) {
            container.innerHTML = `
                <div class="panel-empty share-panel-empty">
                    <div class="empty-icon">📭</div>
                    <p>分享记录中没有透镜<br>无参数可查看</p>
                </div>
            `;
            return;
        }

        container.innerHTML = record.lenses.map((data, index) => {
            const missingMaterial = !this.isKnownMaterial(data.material);
            const materialName = missingMaterial
                ? `已失效（${data.material == null ? '未指定' : this.escapeHtml(String(data.material))}）`
                : this.escapeHtml(this.getMaterialName(data.material));

            const tempLens = new Lens({ type: data.type });
            const typeName = this.isKnownLensType(data.type)
                ? tempLens.getTypeName()
                : `未知类型（${this.escapeHtml(String(data.type))}）`;

            const ri = typeof data.refractiveIndex === 'number' ? data.refractiveIndex.toFixed(2) : '—';
            const size = typeof data.size === 'number' ? `${data.size}%` : '—';
            const curvature = this.isKnownLensType(data.type) && data.type !== CONFIG.LENS_TYPES.PLANO
                ? `${data.curvature}%`
                : null;
            const focal = this.formatFocalLength(data);

            return `
                <div class="share-lens-card${missingMaterial ? ' is-missing-material' : ''}">
                    <div class="share-lens-card-title">
                        <span class="share-lens-index">透镜 ${index + 1}</span>
                        <span class="share-lens-type">${typeName}</span>
                    </div>
                    <dl class="share-param-list">
                        <div class="share-param-row">
                            <dt>透镜类型</dt><dd>${typeName}</dd>
                        </div>
                        <div class="share-param-row">
                            <dt>材料</dt>
                            <dd>${materialName}${missingMaterial ? ' <span class="share-tag-warning">材料已不存在</span>' : ''}</dd>
                        </div>
                        <div class="share-param-row">
                            <dt>折射率</dt><dd>${ri}</dd>
                        </div>
                        <div class="share-param-row">
                            <dt>尺寸</dt><dd>${size}</dd>
                        </div>
                        ${curvature !== null ? `
                        <div class="share-param-row">
                            <dt>弧度</dt><dd>${curvature}</dd>
                        </div>` : ''}
                        ${focal !== null ? `
                        <div class="share-param-row">
                            <dt>焦距（约）</dt><dd>${focal}</dd>
                        </div>` : ''}
                    </dl>
                </div>
            `;
        }).join('');
    }

    getMaterialName(materialId) {
        const found = Object.values(CONFIG.MATERIALS).find(m => m.id === materialId);
        return found ? found.name : '未知材料';
    }

    /**
     * 估算焦距展示文本（基于分享参数，使用与主画布相同的物理模型）
     */
    formatFocalLength(data) {
        if (!this.isKnownLensType(data.type)) return null;
        if (data.type === CONFIG.LENS_TYPES.PLANO) return '∞（不偏折）';

        const ri = typeof data.refractiveIndex === 'number' ? data.refractiveIndex : 1.5;
        const size = typeof data.size === 'number' ? data.size : 100;
        const curvature = typeof data.curvature === 'number' ? data.curvature : 50;
        const height = 80 * (size / 100);
        const focal = Physics.calculateFocalLength(ri, curvature, height);

        if (data.type === CONFIG.LENS_TYPES.CONCAVE) {
            return `虚焦点 ≈ ${Math.abs(focal).toFixed(0)}px（发散）`;
        }
        return `实焦点 ≈ ${focal.toFixed(0)}px`;
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * 关闭只读视图，返回主界面
     *
     * 主画布的透镜数据、渲染器运行状态与选中透镜全程未被修改，
     * 这里仅销毁只读视图并刷新一次主画布显示。
     */
    closeView() {
        if (this.handleViewResize) {
            window.removeEventListener('resize', this.handleViewResize);
            this.handleViewResize = null;
        }

        this.overlay.classList.add('hidden');
        this.viewRenderer = null;
        this.viewLenses = [];
        this.record = null;

        // 清掉地址栏中的分享记录，回到干净的主界面
        if (/(?:^#|&)share=/.test(location.hash || '')) {
            history.replaceState(null, '', location.pathname + location.search);
        }

        // 恢复主画布显示：数据未变动，仅重新渲染并同步参数面板
        const renderer = this.canvasManager.getRenderer();
        renderer.setLenses(this.canvasManager.lenses);
        if (this.canvasManager.selectedLens) {
            window.dispatchEvent(new CustomEvent('lensSelected', {
                detail: this.canvasManager.selectedLens
            }));
        } else {
            window.dispatchEvent(new CustomEvent('lensDeselected'));
        }

        Utils.showToast('已返回主界面，你的编辑内容保持不变', 'info');
    }
}
