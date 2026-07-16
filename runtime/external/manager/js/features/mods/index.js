import { desktopApi } from '../../core/api.js';
import { normResponse, sizeMB, pickFiles } from '../../core/utils.js';
import { createConfigModal } from '../../ui/configModal.js';
import { showDownloadProgress, updateDownloadProgress, hideDownloadProgress } from '../../ui/downloadProgress.js';
import {
	renderAsarInstalledCard,
	renderAsarMissingCard,
	renderEmptyMods,
	renderModsLoadError,
	renderModRow
} from './render.js';

export function createModsManager({ askConfirm }) {
	let modSortableInstance = null;
	const { openConfigModal } = createConfigModal();
	// 版本检测结果内存缓存（key=文件名|本地版本号：更新后版本变化自动失效），减少 GitHub API 访问
	const modStatusCache = new Map();

	// 版本状态徽章填色：outdated 橘黄 / current 淡绿 / ahead 淡蓝 / 其它 灰
	function applyModStatus(el, data) {
		const map = {
			outdated: ['检测到更新', 'bg-amber-100 text-amber-600'],
			current: ['已是最新版本', 'bg-emerald-100 text-emerald-600'],
			ahead: ['已是最新版本', 'bg-sky-100 text-sky-600'],
			noRelease: ['暂无发布', 'bg-slate-100 text-slate-400'],
			unknown: ['暂无法检测', 'bg-slate-100 text-slate-400'],
			error: ['检测失败', 'bg-slate-100 text-slate-400']
		};
		const pair = map[data && data.status] || map.unknown;
		el.textContent = pair[0];
		el.className = `px-1.5 py-0.5 rounded text-[10px] shrink-0 ${pair[1]}`;
	}

	// 点「更新」：先自动检测，再按结果决定是否下载更新
	async function handleModUpdate(idx, mod, onRefresh) {
		const chk = normResponse(await desktopApi.checkModUpdate(idx, mod.name));
		if (!chk.ok) { await askConfirm({ title: '检测失败', message: chk.message || '无法检测更新' }); return; }
		const d = chk.data || {};
		if (d.status === 'current') { await askConfirm({ title: '已是最新版本', message: `「${mod.displayName || mod.name}」已是最新版本。` }); return; }
		if (d.status === 'ahead') { await askConfirm({ title: '已是最新版本', message: `「${mod.displayName || mod.name}」当前版本高于远端，无需更新。` }); return; }
		if (d.status !== 'outdated') { await askConfirm({ title: '暂无法更新', message: '未能确定远端版本，无法更新。' }); return; }
		const go = await askConfirm({ title: '发现模组更新', message: `「${mod.displayName || mod.name}」有新版本 ${d.remoteDisplay || ''}，是否下载并更新？` });
		if (!go) return;
		showDownloadProgress(mod.displayName || mod.name);
		const unsub = desktopApi.onUpdateModProgress(p => updateDownloadProgress(p));
		let res;
		try {
			res = normResponse(await desktopApi.updateMod(idx, mod.name));
		} catch (e) {
			res = { ok: false, message: (e && e.message) || '更新失败' };
		} finally {
			if (unsub) unsub();
			hideDownloadProgress();
		}
		if (res.ok) { await askConfirm({ title: '更新完成', message: '模组已更新，下次启动游戏生效。' }); onRefresh(); }
		else await askConfirm({ title: '更新失败', message: res.message || '未知错误' });
	}

	function createModItemElement(mod, idx, onRefresh, gameRunning) {
		const wrapper = document.createElement('div');
		wrapper.innerHTML = renderModRow(mod, idx, sizeMB(mod.size), gameRunning);
		const item = wrapper.firstElementChild;

		const configBtn = item.querySelector('[data-a="config"]');
		if (configBtn) configBtn.onclick = async () => {
			try { await openConfigModal(idx, mod.displayName || mod.name, mod.name); }
			catch (e) { await askConfirm({ title: '配置不可用', message: String(e && e.message || e) }); }
		};

		item.querySelector('[data-a="toggle"]').onclick = async () => {
			if (gameRunning) { await askConfirm({ title: '游戏运行中', message: '启用/禁用模组需要先完全关闭游戏。' }); return; }
			const r = normResponse(await desktopApi.toggleModDisabled(idx, mod.name));
			if (!r.ok) await askConfirm({ title: '操作失败', message: r.message || '未知错误' });
			onRefresh();
		};
		item.querySelector('[data-a="delete"]').onclick = async () => {
			if (gameRunning) { await askConfirm({ title: '游戏运行中', message: '删除模组需要先完全关闭游戏。' }); return; }
			const ok = await askConfirm({
				title: '删除确认',
				message: `确定要删除 "${mod.displayName || mod.name}" 吗？`
			});
			if (ok) {
				const r = normResponse(await desktopApi.deleteMod(idx, mod.name));
				if (!r.ok) await askConfirm({ title: '删除失败', message: r.message || '未知错误' });
				onRefresh();
			}
		};

		const updateBtn = item.querySelector('[data-a="update"]');
		if (updateBtn) updateBtn.onclick = async () => {
			if (gameRunning) { await askConfirm({ title: '游戏运行中', message: '更新模组需要先完全关闭游戏。' }); return; }
			handleModUpdate(idx, mod, onRefresh);
		};

		// 有更新渠道的模组：渲染后填色版本状态徽章——命中内存缓存直接用，未命中才请求一次
		if (mod.hasUpdateChannel) {
			const statusEl = item.querySelector('[data-mod-status]');
			const cacheKey = `${mod.diskName}|${mod.versionNum}`;
			const cached = modStatusCache.get(cacheKey);
			if (cached) {
				if (statusEl) applyModStatus(statusEl, cached);
			} else {
				desktopApi.checkModUpdate(idx, mod.name)
					.then(res => {
						const r = normResponse(res);
						const d = r.ok ? (r.data || {}) : { status: 'error' };
						if (d.status && d.status !== 'error') modStatusCache.set(cacheKey, d);
						if (statusEl) applyModStatus(statusEl, d);
					})
					.catch(() => { if (statusEl) applyModStatus(statusEl, { status: 'error' }); });
			}
		}

		return item;
	}

	async function refreshMods() {
		const list = document.getElementById('mod-list');
		const asarBox = document.getElementById('asar-box');

		if (modSortableInstance) {
			modSortableInstance.destroy();
			modSortableInstance = null;
		}

		const res = normResponse(await desktopApi.getModsData());
		if (!res.ok) {
			list.innerHTML = renderModsLoadError(res.message);
			return;
		}
		const data = res.data || {};

		asarBox.innerHTML = data.asarItem
			? renderAsarInstalledCard(sizeMB(data.asarItem.size))
			: renderAsarMissingCard();

		const mods = data.mods || [];
		if (mods.length === 0) {
			list.innerHTML = renderEmptyMods();
			return;
		}

		list.innerHTML = '';
		mods.forEach((mod, idx) => {
			list.appendChild(createModItemElement(mod, idx, refreshMods, data.gameRunning));
		});

		modSortableInstance = Sortable.create(list, {
			animation: 300,
			handle: '.drag-handle',
			filter: '.mod-btn',
			preventOnFilter: false,
			ghostClass: 'ghost-item',
			dragClass: 'dragging-item',
			chosenClass: 'chosen-item',
			forceFallback: true,
			fallbackOnBody: true,
			swapThreshold: 0.65,
			onEnd: async (evt) => {
				if (evt.oldIndex === evt.newIndex) return;
				const r = normResponse(await desktopApi.moveModTo(evt.oldIndex, evt.newIndex));
				if (!r.ok) await askConfirm({ title: '排序失败', message: r.message || '未知错误' });
				refreshMods();
			}
		});
	}

	function conflictPrompt(r) {
		const name = r.displayName || r.file;
		const oldV = r.oldVersionText || '未知版本';
		const newV = r.newVersionText || '未知版本';
		if (r.kind === 'upgrade') return { title: '发现模组更新', message: `「${name}」将从 ${oldV} 更新到 ${newV}，是否继续？` };
		if (r.kind === 'downgrade') return { title: '版本降级警告', message: `导入的「${name}」版本 (${newV}) 低于已安装版本 (${oldV})，确定要降级吗？` };
		if (r.kind === 'same') return { title: '版本相同', message: `「${name}」的导入版本与已安装版本相同 (${newV})，是否覆盖重装？` };
		return { title: '无法验证版本', message: `「${name}」已安装，但无法比较版本（模组未提供数字验证版本号），是否覆盖？` };
	}

	async function importModFiles(files) {
		let changed = false;
		const notes = [];
		for (const file of files) {
			if (!/\.(asar|zip|rar)$/i.test(file.name)) {
				await askConfirm({ title: '无法导入', message: `不支持的文件：${file.name}（仅支持 .asar / .zip / .rar）` });
				continue;
			}
			const bytes = new Uint8Array(await file.arrayBuffer());
			const res = normResponse(await desktopApi.importModFromBuffer(file.name, bytes));
			if (!res.ok) {
				await askConfirm({ title: '导入失败', message: `${file.name}：${res.message || '未知错误'}` });
				continue;
			}
			const data = res.data || {};
			for (const r of data.results || []) {
				if (r.status === 'added') { changed = true; continue; }
				if (r.status === 'invalid') {
					await askConfirm({ title: '导入失败', message: `${r.file}：${r.message || '文件无效'}` });
					continue;
				}
				const yes = await askConfirm(conflictPrompt(r));
				if (!yes) { await desktopApi.cancelPendingImport(r.token); continue; }
				const c = normResponse(await desktopApi.confirmPendingImport(r.token));
				if (c.ok) changed = true;
				else await askConfirm({ title: '更新失败', message: c.message || '未知错误' });
			}
			const cw = data.config || {};
			if (cw.written || cw.skipped) {
				notes.push(`配置文件：写入 ${cw.written} 个${cw.skipped ? `，跳过 ${cw.skipped} 个已存在的` : ''}`);
			}
		}
		if (notes.length) await askConfirm({ title: '导入完成', message: notes.join('，') });
		if (changed || notes.length) refreshMods();
	}

	function bindImportButton() {
		document.getElementById('btn-import-mod').onclick = () => {
			pickFiles({ accept: '.asar,.zip,.rar', multiple: true, onSelected: (files) => importModFiles(files) });
		};

		const openBtn = document.getElementById('btn-open-mods-folder');
		if (openBtn) openBtn.onclick = () => desktopApi.openModsFolder();

		const fixBtn = document.getElementById('btn-autofix-order');
		if (fixBtn) fixBtn.onclick = async () => {
			const res = normResponse(await desktopApi.autoFixOrder());
			if (res.ok) { await askConfirm({ title: '顺序已修复', message: '已按依赖关系重排模组顺序，下次启动生效。' }); refreshMods(); }
			else await askConfirm({ title: '无法修复', message: res.message || '未知错误' });
		};
	}

	function bindDropImport() {
		const overlay = document.createElement('div');
		overlay.style.cssText = 'display:none;position:fixed;inset:0;z-index:200;background:rgba(124,58,237,0.12);backdrop-filter:blur(2px);align-items:center;justify-content:center;pointer-events:none;';
		overlay.innerHTML = '<div style="background:#fff;border:2px dashed #7c3aed;border-radius:24px;padding:28px 44px;font-weight:700;color:#7c3aed;font-size:17px;box-shadow:0 20px 50px rgba(91,33,182,.25);">松开以导入模组（.asar / .zip / .rar）</div>';
		document.body.appendChild(overlay);
		let depth = 0;
		const hide = () => { depth = 0; overlay.style.display = 'none'; };
		window.addEventListener('dragenter', (e) => {
			e.preventDefault();
			if (!e.dataTransfer || ![...e.dataTransfer.types].includes('Files')) return;
			depth++;
			overlay.style.display = 'flex';
		});
		window.addEventListener('dragover', (e) => { e.preventDefault(); });
		window.addEventListener('dragleave', (e) => {
			e.preventDefault();
			depth = Math.max(0, depth - 1);
			if (depth === 0) overlay.style.display = 'none';
		});
		window.addEventListener('drop', async (e) => {
			e.preventDefault();
			hide();
			const files = e.dataTransfer ? [...e.dataTransfer.files] : [];
			if (!files.length) return;
			if (window.switchPage) window.switchPage('mods');
			await importModFiles(files);
		});
	}

	return { refreshMods, bindImportButton, bindDropImport };
}
