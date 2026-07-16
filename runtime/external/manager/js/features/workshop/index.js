import { normResponse } from '../../core/utils.js';
import { desktopApi } from '../../core/api.js';
import { showDownloadProgress, updateDownloadProgress, hideDownloadProgress } from '../../ui/downloadProgress.js';
import {
	renderWorkshopLoading,
	renderWorkshopError,
	renderWorkshopEmpty,
	renderStoreRow,
	renderHistoryLoading,
	renderHistoryError,
	renderHistoryList
} from './render.js';

export function createWorkshopManager({ askConfirm }) {
	let mods = [];
	let gameRunning = false;
	let busy = false;
	let filterText = '';

	const listEl = () => document.getElementById('workshop-list');

	async function doInstall(mod, tag) {
		if (busy) return;
		if (gameRunning) {
			await askConfirm({ title: '游戏运行中', message: '安装与更新需要在游戏关闭后进行，请先关闭游戏。' });
			return;
		}
		const action = tag
			? `将「${mod.name}」安装为 ${tag} 版本？选择旧版本即为降级，安装后下次启动游戏生效。`
			: (mod.installed
				? `将「${mod.name}」从 ${mod.localDisplay || '当前版本'} 更新到 ${mod.remoteDisplay || '最新版本'}？`
				: `从 GitHub 下载并安装「${mod.name}」（${mod.remoteDisplay || '最新版本'}）？`);
		const go = await askConfirm({ title: tag ? '安装历史版本' : (mod.installed ? '更新模组' : '下载模组'), message: action });
		if (!go) return;
		busy = true;
		showDownloadProgress(mod.name);
		const unsub = desktopApi.onStoreProgress((payload) => updateDownloadProgress(payload));
		let res;
		try {
			res = normResponse(await desktopApi.storeInstall(mod.repo, tag || undefined));
		} catch (e) {
			res = { ok: false, message: (e && e.message) || '安装失败' };
		} finally {
			// 无论成功/异常都要复位，否则 busy 永久为 true、进度条不消失、后续安装全被吞
			if (unsub) unsub();
			hideDownloadProgress();
			busy = false;
		}
		if (res.ok) {
			await askConfirm({ title: '完成', message: `「${mod.name}」已安装${tag ? `（${tag}）` : ''}，下次启动游戏生效。` });
			await refreshWorkshop(true);
		} else {
			await askConfirm({ title: '安装失败', message: res.message || '未知错误' });
		}
	}

	async function toggleHistory(row, mod) {
		const panel = row.querySelector('[data-history-panel]');
		if (!panel) return;
		if (!panel.classList.contains('hidden')) {
			panel.classList.add('hidden');
			return;
		}
		panel.classList.remove('hidden');
		if (panel.dataset.loaded === '1') return;
		panel.innerHTML = renderHistoryLoading();
		const res = normResponse(await desktopApi.storeHistory(mod.repo));
		if (!res.ok) {
			panel.innerHTML = renderHistoryError(res.message);
			return;
		}
		panel.dataset.loaded = '1';
		panel.innerHTML = renderHistoryList((res.data && res.data.releases) || [], gameRunning);
		panel.querySelectorAll('button[data-tag]').forEach(btn => {
			btn.onclick = (e) => {
				e.stopPropagation();
				doInstall(mod, btn.dataset.tag);
			};
		});
	}

	function bindRowActions() {
		const el = listEl();
		if (!el) return;
		el.querySelectorAll('[data-store-idx]').forEach(row => {
			const mod = mods[parseInt(row.dataset.storeIdx, 10)];
			if (!mod) return;
			row.querySelectorAll('button[data-a]').forEach(btn => {
				btn.onclick = (e) => {
					e.stopPropagation();
					const a = btn.dataset.a;
					if (a === 'install') doInstall(mod, null);
					else if (a === 'history') toggleHistory(row, mod);
					else if (a === 'github') desktopApi.openExternal(`https://github.com/${mod.repo}`);
				};
			});
		});
	}

	// 搜索过滤：名称 / 简介 / 作者，行保留原始索引以正确绑定操作
	function matchesFilter(m) {
		if (!filterText) return true;
		const q = filterText.toLowerCase();
		return (m.name || '').toLowerCase().includes(q)
			|| (m.desc || '').toLowerCase().includes(q)
			|| (m.author || '').toLowerCase().includes(q);
	}

	function renderList() {
		const el = listEl();
		if (!el) return;
		const visible = mods.map((m, i) => ({ m, i })).filter(x => matchesFilter(x.m));
		if (!mods.length) {
			el.innerHTML = renderWorkshopEmpty();
			return;
		}
		if (!visible.length) {
			el.innerHTML = '<div class="p-10 text-slate-300 text-center italic text-xs">没有匹配的模组</div>';
			return;
		}
		el.innerHTML = visible.map(x => renderStoreRow(x.m, x.i, gameRunning)).join('');
		bindRowActions();
	}

	// 列表内存缓存：切页回来直接用上次结果，只有「刷新列表」/安装完成才重新访问 GitHub
	let loaded = false;

	async function refreshWorkshop(force) {
		const el = listEl();
		if (!el) return;
		try {
			const running = normResponse(await desktopApi.isGameRunning());
			gameRunning = !!(running.ok && running.data);
		} catch (e) { gameRunning = false; }
		if (!force && loaded && mods.length) {
			renderList();
			return;
		}
		el.innerHTML = renderWorkshopLoading();
		const res = normResponse(await desktopApi.getStoreList());
		if (!res.ok) {
			el.innerHTML = renderWorkshopError(res.message);
			return;
		}
		mods = (res.data && res.data.mods) || [];
		loaded = true;
		renderList();
	}

	function bindEvents() {
		const btn = document.getElementById('btn-workshop-refresh');
		if (btn) btn.onclick = () => refreshWorkshop(true);
		const search = document.getElementById('workshop-search');
		if (search) {
			search.oninput = () => {
				filterText = search.value.trim();
				renderList();
			};
		}
	}

	return { refreshWorkshop, bindEvents };
}
