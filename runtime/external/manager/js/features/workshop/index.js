import { normResponse } from '../../core/utils.js';
import { desktopApi } from '../../core/api.js';
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
		const res = normResponse(await desktopApi.storeInstall(mod.repo, tag || undefined));
		busy = false;
		if (res.ok) {
			await askConfirm({ title: '完成', message: `「${mod.name}」已安装${tag ? `（${tag}）` : ''}，下次启动游戏生效。` });
			await refreshWorkshop();
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

	async function refreshWorkshop() {
		const el = listEl();
		if (!el) return;
		el.innerHTML = renderWorkshopLoading();
		try {
			const running = normResponse(await desktopApi.isGameRunning());
			gameRunning = !!(running.ok && running.data);
		} catch (e) { gameRunning = false; }
		const res = normResponse(await desktopApi.getStoreList());
		if (!res.ok) {
			el.innerHTML = renderWorkshopError(res.message);
			return;
		}
		mods = (res.data && res.data.mods) || [];
		if (!mods.length) {
			el.innerHTML = renderWorkshopEmpty();
			return;
		}
		el.innerHTML = mods.map((m, i) => renderStoreRow(m, i, gameRunning)).join('');
		bindRowActions();
	}

	function bindEvents() {
		const btn = document.getElementById('btn-workshop-refresh');
		if (btn) btn.onclick = () => refreshWorkshop();
	}

	return { refreshWorkshop, bindEvents };
}
