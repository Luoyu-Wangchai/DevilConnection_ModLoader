// 下载/安装进度浮层：模组工坊安装 与 模组列表更新 共用。
// 单例懒建 DOM，挂 body 右下角浮层（不阻塞页面）。payload 形状 = { phase, pct, received, total, name, tag }，
// phase ∈ meta | download | install | done，与 Manager 的 storeInstallRelease / updateMod 上报一致。
let root, titleEl, barEl, pctEl, textEl, hideTimer;

function ensure() {
	if (root) return;
	root = document.createElement('div');
	root.className = 'hidden fixed bottom-20 md:bottom-6 right-4 left-4 md:left-auto md:w-80 bg-white shadow-2xl rounded-2xl p-4 border border-slate-100 z-[130]';
	root.innerHTML =
		'<div class="flex items-center justify-between mb-2">' +
		'<span data-r="title" class="text-xs font-bold text-slate-700 truncate w-40">下载中</span>' +
		'<span data-r="pct" class="text-[10px] font-mono text-accent"></span>' +
		'</div>' +
		'<div class="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden"><div data-r="bar" class="bg-accent h-full w-0 transition-all duration-200"></div></div>' +
		'<p data-r="text" class="text-[9px] text-slate-400 mt-2 truncate">请稍候...</p>';
	document.body.appendChild(root);
	titleEl = root.querySelector('[data-r="title"]');
	barEl = root.querySelector('[data-r="bar"]');
	pctEl = root.querySelector('[data-r="pct"]');
	textEl = root.querySelector('[data-r="text"]');
}

export function showDownloadProgress(name) {
	ensure();
	if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
	titleEl.textContent = name || '下载中';
	pctEl.textContent = '';
	barEl.style.width = '0%';
	textEl.textContent = '正在准备...';
	root.classList.remove('hidden');
}

export function updateDownloadProgress(payload) {
	if (!root || !payload) return;
	if (payload.phase === 'meta') {
		textEl.textContent = '正在获取版本信息...';
	} else if (payload.phase === 'download') {
		const mb = payload.received ? (payload.received / 1024 / 1024).toFixed(2) : '0';
		const totalMb = payload.total ? (payload.total / 1024 / 1024).toFixed(2) : null;
		textEl.textContent = '正在下载' + (payload.tag ? ' ' + payload.tag : '');
		if (payload.pct != null) {
			barEl.style.width = payload.pct + '%';
			pctEl.textContent = totalMb ? (payload.pct + '% · ' + mb + '/' + totalMb + ' MB') : (payload.pct + '%');
		} else {
			pctEl.textContent = mb + ' MB';
		}
	} else if (payload.phase === 'install') {
		textEl.textContent = '正在安装...';
		barEl.style.width = '99%';
	} else if (payload.phase === 'done') {
		barEl.style.width = '100%';
	}
}

export function hideDownloadProgress() {
	if (!root) return;
	hideTimer = setTimeout(() => root.classList.add('hidden'), 400);
}
