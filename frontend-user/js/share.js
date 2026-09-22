/**
 * 只读分享管理器
 *
 * 把当前画布上的实验配置生成一份分享记录：
 * - 记录内容包含透镜类型、材料与关键参数，以及光源模式
 * - 分享链接中携带完整配置（URL hash），纯前端即可跨设备打开
 * - 他人打开后进入只读视图：只能查看光路与参数，不能改动或删除
 */
class ShareManager {
    constructor(canvasManager) {
        this.canvasManager = canvasManager;
        this.renderer = canvasManager.getRenderer();

        // 只读视图相关状态
        this.shareView = document.getElementById('share-view');
        this.shareCanvas = document.getElementById('share-canvas');
        this.shareRenderer = null;
        this.shareLenses = [];
        // 归一化（0~1）的透镜位置，用于跨设备按画布尺寸还原
        this.shareLensPositions = [];
        this.currentPayload = null;
        this.currentTitle = '';

        this.init();
    }

    /**
     * 初始化：绑定事件，若 URL 中带有分享参数则直接进入只读视图
     */
    init() {
        this.bindOwnerEvents();
        this.bindViewEvents();

        // 浏览器前进/后退时同步视图状态
        window.addEventListener('hashchange', () => {
            const payload = this.readPayloadFromUrl();
            if (payload) {
                this.openReadOnlyView(payload);
            } else {
                this.closeReadOnlyView();
            }
        });

        const payload = this.readPayloadFromUrl();
        if (payload) {
            this.openReadOnlyView(payload);
        }
    }

    /**
     * 当前是否正通过有效的分享链接打开（供引导等模块判断）
     */
    static isViewingShare() {
        try {
            const hash = window.location.hash || '';
            const marker = '#' + CONFIG.SHARE.URL_PARAM + '=';
            if (hash.indexOf(marker) !== 0) return false;
            const encoded = hash.slice(marker.length);
            // 需要能成功解码出快照，损坏的链接按普通编辑器处理
            return ShareManager.decodePayload(encoded) !== null;
        } catch (e) {
            return false;
        }
    }

    // ------------------------------------------------------------------
    // 分享记录的生成与编解码
    // ------------------------------------------------------------------

    /**
     * 从当前画布生成快照（不修改画布上的任何内容与选中状态）
     */
    buildSnapshot(title) {
        return {
            v: 1,
            title: title || '',
            createdAt: Date.now(),
            light: {
                mode: this.renderer.lightMode,
                showDispersion: this.renderer.showDispersion
            },
            // 位置按画布尺寸归一化，保证不同设备打开时布局一致
            lenses: this.canvasManager.lenses.map(lens => ({
                id: lens.id,
                type: lens.type,
                material: lens.material,
                refractiveIndex: lens.refractiveIndex,
                size: lens.size,
                curvature: lens.curvature,
                nx: this.renderer.width ? lens.x / this.renderer.width : 0.5,
                ny: this.renderer.height ? lens.y / this.renderer.height : 0.5
            }))
        };
    }

    /**
     * Unicode 安全的 base64 编码
     */
    encodePayload(snapshot) {
        const json = JSON.stringify(snapshot);
        const b64 = window.btoa(unescape(encodeURIComponent(json)));
        // URL 安全：替换 +/= ，放入 hash 时无需百分号转义
        return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }

    /**
     * 解码分享内容
     */
    static decodePayload(encoded) {
        try {
            let b64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
            while (b64.length % 4) b64 += '=';
            const json = decodeURIComponent(escape(window.atob(b64)));
            const data = JSON.parse(json);
            if (!data || !Array.isArray(data.lenses)) return null;
            return data;
        } catch (e) {
            return null;
        }
    }

    buildShareUrl(encoded) {
        const base = window.location.href.split('#')[0];
        return base + '#' + CONFIG.SHARE.URL_PARAM + '=' + encoded;
    }

    readPayloadFromUrl() {
        const hash = window.location.hash || '';
        const marker = '#' + CONFIG.SHARE.URL_PARAM + '=';
        if (hash.indexOf(marker) !== 0) return null;
        const encoded = hash.slice(marker.length);
        if (!encoded) return null;
        return ShareManager.decodePayload(encoded);
    }

    // ------------------------------------------------------------------
    // 分享入口（编辑器一侧）
    // ------------------------------------------------------------------

    bindOwnerEvents() {
        const btnShare = document.getElementById('btn-share');
        if (btnShare) {
            btnShare.addEventListener('click', () => this.openShareModal());
        }

        const btnClose = document.getElementById('btn-share-close');
        if (btnClose) {
            btnClose.addEventListener('click', () => this.closeShareModal());
        }

        const btnCancel = document.getElementById('btn-share-cancel');
        if (btnCancel) {
            btnCancel.addEventListener('click', () => this.closeShareModal());
        }

        const btnCopy = document.getElementById('btn-copy-share-link');
        if (btnCopy) {
            btnCopy.addEventListener('click', () => this.copyShareLink(btnCopy));
        }

        const btnPreview = document.getElementById('btn-preview-share');
        if (btnPreview) {
            btnPreview.addEventListener('click', () => this.previewShare());
        }
    }

    /**
     * 打开分享弹窗：立即生成快照并保存记录、填充链接
     */
    openShareModal() {
        const titleInput = document.getElementById('share-title-input');
        const title = titleInput.value.trim();

        const snapshot = this.buildSnapshot(title);
        const encoded = this.encodePayload(snapshot);
        const url = this.buildShareUrl(encoded);

        this.currentPayload = snapshot;
        this.currentTitle = title;

        const linkInput = document.getElementById('share-link-input');
        linkInput.value = url;

        // 画布为空时给出说明
        const emptyHint = document.getElementById('share-empty-hint');
        emptyHint.classList.toggle('hidden', snapshot.lenses.length > 0);

        // 保存分享记录到本设备（失败不影响链接分享）
        const saved = Storage.saveSharedDesign({
            id: Utils.generateId(),
            title: title || '未命名实验',
            createdAt: snapshot.createdAt,
            lensCount: snapshot.lenses.length,
            lightMode: snapshot.light.mode
        });
        document.getElementById('share-saved-note').classList.toggle('hidden', !saved);

        document.getElementById('share-modal').classList.remove('hidden');
    }

    closeShareModal() {
        document.getElementById('share-modal').classList.add('hidden');
        // 清空名称，避免下次生成记录时残留
        const titleInput = document.getElementById('share-title-input');
        if (titleInput) titleInput.value = '';
    }

    /**
     * 复制分享链接（带降级方案，兼容非安全上下文与移动浏览器）
     */
    copyShareLink(btn) {
        const linkInput = document.getElementById('share-link-input');
        const url = linkInput.value;

        const setCopied = () => {
            const original = btn.textContent;
            btn.textContent = '已复制';
            btn.disabled = true;
            setTimeout(() => {
                btn.textContent = original;
                btn.disabled = false;
            }, 1500);
        };

        if (navigator.clipboard && window.isSecureContext) {
            navigator.clipboard.writeText(url).then(setCopied).catch(() => {
                this.fallbackCopy(url, setCopied);
            });
        } else {
            this.fallbackCopy(url, setCopied);
        }
    }

    fallbackCopy(text, onSuccess) {
        const input = document.getElementById('share-link-input');
        try {
            input.select();
            input.setSelectionRange(0, text.length);
            document.execCommand('copy');
            window.getSelection().removeAllRanges();
            onSuccess();
        } catch (e) {
            Utils.showToast('复制失败，请手动选择链接复制', 'warning');
        }
    }

    /**
     * 预览只读视图：不刷新页面，主界面状态完整保留在遮罩下方
     */
    previewShare() {
        if (!this.currentPayload) return;
        this.closeShareModal();
        const encoded = this.encodePayload(this.currentPayload);
        const targetHash = '#' + CONFIG.SHARE.URL_PARAM + '=' + encoded;
        if (window.location.hash !== targetHash) {
            window.history.pushState({ share: true }, '', targetHash);
        }
        this.openReadOnlyView(this.currentPayload);
    }

    // ------------------------------------------------------------------
    // 只读视图
    // ------------------------------------------------------------------

    bindViewEvents() {
        const btnBack = document.getElementById('btn-share-back');
        if (btnBack) {
            btnBack.addEventListener('click', () => this.goBack());
        }

        const btnToggleLight = document.getElementById('btn-share-toggle-light');
        if (btnToggleLight) {
            btnToggleLight.addEventListener('click', () => {
                if (!this.shareRenderer) return;
                const isRunning = this.shareRenderer.toggleRunning();
                this.updateViewLightButton(isRunning);
            });
        }

        const btnToggleLabels = document.getElementById('btn-share-toggle-labels');
        if (btnToggleLabels) {
            btnToggleLabels.addEventListener('click', () => {
                if (!this.shareRenderer) return;
                const showLabels = this.shareRenderer.toggleLabels();
                btnToggleLabels.classList.toggle('active', showLabels);
            });
        }

        // 光源模式下拉框仅用于展示当前配置，禁止修改
        const lightModeSelect = document.getElementById('share-light-mode');
        lightModeSelect.addEventListener('mousedown', e => e.preventDefault());
    }

    /**
     * 打开只读视图
     * @param {Object} payload 解码后的分享快照
     */
    openReadOnlyView(payload) {
        this.currentPayload = payload;
        this.shareView.classList.remove('hidden');

        // 延迟一帧创建渲染器，确保画布容器已完成布局
        requestAnimationFrame(() => {
            if (!this.shareRenderer) {
                this.shareRenderer = new Renderer(this.shareCanvas);
                window.addEventListener('resize', Utils.debounce(() => {
                    if (this.shareView.classList.contains('hidden')) return;
                    this.shareRenderer.resize();
                    this.restoreLensPositions();
                }, 100));
            } else {
                this.shareRenderer.resize();
            }
            this.renderPayload(payload);
        });
    }

    /**
     * 根据快照渲染只读内容
     */
    renderPayload(payload) {
        const notices = [];

        // 标题与基础信息
        const title = payload.title || '实验配置分享';
        document.getElementById('share-view-title').textContent = title;

        // 光源设置（下拉框只读展示）
        const lightMode = (payload.light && payload.light.mode) || CONFIG.LIGHT_DEFAULTS.mode;
        const modeSelect = document.getElementById('share-light-mode');
        modeSelect.value = lightMode;
        modeSelect.disabled = true;
        this.shareRenderer.setLightMode(lightMode);
        this.shareRenderer.setShowDispersion(!!(payload.light && payload.light.showDispersion));

        // 还原透镜
        this.shareLenses = [];
        this.shareLensPositions = [];

        if (!Array.isArray(payload.lenses) || payload.lenses.length === 0) {
            notices.push({
                type: 'warning',
                text: '这份分享记录中没有透镜，无法构成完整光路，当前只能查看到画布与光源设置。'
            });
        } else {
            payload.lenses.forEach((data, index) => {
                const lens = new Lens({
                    id: data.id,
                    type: data.type,
                    material: data.material,
                    refractiveIndex: data.refractiveIndex,
                    size: data.size,
                    curvature: data.curvature
                });

                // 标记引用材料已不存在的透镜
                const materialExists = Object.values(CONFIG.MATERIALS)
                    .some(material => material.id === data.material);
                lens.materialMissing = !materialExists;
                lens.materialRef = data.material;

                const typeExists = !!Object.values(CONFIG.LENS_TYPES).includes(data.type);
                lens.typeMissing = !typeExists;
                lens.typeRef = data.type;

                if (lens.materialMissing) {
                    notices.push({
                        type: 'warning',
                        text: `第 ${index + 1} 个透镜引用的材料「${data.material}」已不存在，已按普通玻璃方式显示，实际效果可能与原配置不同。`
                    });
                }
                if (lens.typeMissing) {
                    notices.push({
                        type: 'warning',
                        text: `第 ${index + 1} 个透镜的类型「${data.type}」无法识别，画布上可能无法正确显示。`
                    });
                }

                this.shareLenses.push(lens);
                this.shareLensPositions.push({
                    nx: typeof data.nx === 'number' ? data.nx : 0.5,
                    ny: typeof data.ny === 'number' ? data.ny : 0.5
                });
            });
        }

        this.restoreLensPositions();
        this.shareRenderer.setLenses(this.shareLenses);

        // 只读视图默认启动光路，方便查看者直接观察
        this.shareRenderer.setRunning(true);
        this.updateViewLightButton(true);

        // 标注按钮默认激活
        document.getElementById('btn-share-toggle-labels').classList.toggle(
            'active', this.shareRenderer.showLabels
        );

        this.renderMeta(payload);
        this.renderNotices(notices);
        this.renderLensCards();

        // 画布空状态遮罩
        document.getElementById('share-canvas-empty')
            .classList.toggle('hidden', this.shareLenses.length > 0);
    }

    /**
     * 按当前画布尺寸还原透镜像素位置
     */
    restoreLensPositions() {
        if (!this.shareRenderer) return;
        this.shareLenses.forEach((lens, i) => {
            const pos = this.shareLensPositions[i] || { nx: 0.5, ny: 0.5 };
            lens.x = Utils.clamp(
                pos.nx * this.shareRenderer.width,
                50,
                Math.max(50, this.shareRenderer.width - 50)
            );
            lens.y = Utils.clamp(
                pos.ny * this.shareRenderer.height,
                50,
                Math.max(50, this.shareRenderer.height - 50)
            );
        });
    }

    /**
     * 渲染记录元信息
     */
    renderMeta(payload) {
        const meta = document.getElementById('share-meta');
        meta.innerHTML = '';

        const created = payload.createdAt ? Utils.formatDate(payload.createdAt) : '未知时间';
        const modeText = payload.light && payload.light.mode === 'point' ? '点光源' : '平行光';
        const rows = [
            ['分享时间', created],
            ['透镜数量', payload.lenses.length + ' 个'],
            ['光源模式', modeText]
        ];
        rows.forEach(([label, value]) => {
            const row = document.createElement('div');
            row.className = 'share-meta-row';
            const labelEl = document.createElement('span');
            labelEl.className = 'share-meta-label';
            labelEl.textContent = label;
            const valueEl = document.createElement('span');
            valueEl.className = 'share-meta-value';
            valueEl.textContent = value;
            row.appendChild(labelEl);
            row.appendChild(valueEl);
            meta.appendChild(row);
        });
    }

    /**
     * 渲染说明/警告信息
     */
    renderNotices(notices) {
        const container = document.getElementById('share-notices');
        container.innerHTML = '';
        notices.forEach(notice => {
            const el = document.createElement('div');
            el.className = 'share-notice share-notice-' + notice.type;
            el.textContent = '⚠️ ' + notice.text;
            container.appendChild(el);
        });
    }

    /**
     * 渲染透镜参数卡片（按在光路上从左到右的顺序）
     */
    renderLensCards() {
        const list = document.getElementById('share-lens-list');
        list.innerHTML = '';

        const ordered = this.shareLenses
            .map((lens, index) => ({ lens, index }))
            .sort((a, b) => a.lens.x - b.lens.x);

        ordered.forEach(({ lens, index }) => {
            const typeName = lens.typeMissing ? `未知类型（${lens.typeRef}）` : lens.getTypeName();
            const materialName = lens.materialMissing
                ? `材料已失效（${lens.materialRef}）`
                : lens.getMaterialName();

            const focalLength = lens.getFocalLength();
            let focalText = '不适用';
            if (isFinite(focalLength)) {
                focalText = focalLength < 0
                    ? `虚焦点 ${Math.abs(Math.round(focalLength))} px`
                    : `${Math.round(focalLength)} px`;
            }

            const card = document.createElement('div');
            card.className = 'share-lens-card';
            if (lens.materialMissing) card.classList.add('has-warning');

            const title = document.createElement('div');
            title.className = 'share-lens-card-title';
            const idxBadge = document.createElement('span');
            idxBadge.className = 'share-lens-index';
            idxBadge.textContent = '#' + (index + 1);
            const typeEl = document.createElement('span');
            typeEl.textContent = typeName;
            title.appendChild(idxBadge);
            title.appendChild(typeEl);
            card.appendChild(title);

            const rows = [
                ['材料', materialName, lens.materialMissing],
                ['折射率', Number(lens.refractiveIndex).toFixed(2), false],
                ['尺寸', lens.size + '%', false]
            ];
            if (lens.type !== CONFIG.LENS_TYPES.PLANO) {
                rows.push(['弧度', lens.curvature + '%', false]);
            }
            rows.push(['焦距', focalText, false]);

            rows.forEach(([label, value, warn]) => {
                const row = document.createElement('div');
                row.className = 'share-lens-row';
                const labelEl = document.createElement('span');
                labelEl.textContent = label;
                const valueEl = document.createElement('span');
                valueEl.textContent = value;
                if (warn) valueEl.className = 'share-value-warning';
                row.appendChild(labelEl);
                row.appendChild(valueEl);
                card.appendChild(row);
            });

            list.appendChild(card);
        });
    }

    updateViewLightButton(isRunning) {
        const btn = document.getElementById('btn-share-toggle-light');
        if (!btn) return;
        btn.classList.toggle('active', isRunning);
        btn.querySelector('span').textContent = isRunning ? '暂停光路' : '启动光路';
        const icon = btn.querySelector('svg');
        if (isRunning) {
            icon.innerHTML = '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>';
        } else {
            icon.innerHTML = '<polygon points="5 3 19 12 5 21 5 3"/>';
        }
    }

    /**
     * 返回主界面：移除分享参数并隐藏只读视图
     */
    goBack() {
        if (window.location.hash) {
            window.history.pushState({ share: false }, '', window.location.pathname + window.location.search);
        }
        this.closeReadOnlyView();
    }

    /**
     * 关闭只读视图
     */
    closeReadOnlyView() {
        this.shareView.classList.add('hidden');
        this.currentPayload = null;

        // 直接打开链接时主画布一度处于隐藏状态，回到主界面后重新适配尺寸
        window.dispatchEvent(new Event('resize'));
    }
}
