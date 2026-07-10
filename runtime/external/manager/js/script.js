import { normResponse } from './core/utils.js';
import { desktopApi } from './core/api.js';
import { createTaskRunner } from './core/taskRunner.js';
import { createModal } from './ui/modal.js';
import { createNavigation } from './ui/navigation.js';
import { createModsManager } from './features/mods/index.js';
import { createBackupsManager } from './features/backups/index.js';

const { askConfirm } = createModal();
const { runTask, dispose, isBusy } = createTaskRunner({ askConfirm });

const modsManager = createModsManager({ askConfirm });
const backupsManager = createBackupsManager({ askConfirm, runTask, isBusy });

const navigation = createNavigation({
	onMods: modsManager.refreshMods,
	onBackups: backupsManager.refreshBackups
});

window.switchPage = navigation.switchPage;

modsManager.bindImportButton();
modsManager.bindDropImport();
backupsManager.bindEvents();
navigation.bindNavButtons();

// 上游原作者仓库（致谢用，指向 fork 来源）
const rebuildRepoLink = document.getElementById('rebuild-repo-link');
if (rebuildRepoLink) {
	rebuildRepoLink.onclick = (e) => {
		e.preventDefault();
		desktopApi.openExternal('https://github.com/shouennyou/DevilConnection_ModLoader');
	};
}

// 本 Fork 版本信息（版本号/仓库单一真源 = version.json，经 Manager.js 读出后注入 UI）
let appInfo = { displayVersion: 'RV1.2.7', repoUrl: 'https://github.com/Luoyu-Wangchai/DevilConnection_ModLoader' };
async function initAppInfo() {
	try {
		const res = normResponse(await desktopApi.getAppInfo());
		if (res.ok && res.data) appInfo = { ...appInfo, ...res.data };
	} catch (e) {}
	const titleEl = document.getElementById('app-title');
	if (titleEl) titleEl.textContent = `恶魔连结模组管理器 ${appInfo.displayVersion}`;
	// 所有「Fork rebuild」字样 → 跳本 Fork 仓库
	document.querySelectorAll('.js-fork-link').forEach(a => {
		a.onclick = (e) => { e.preventDefault(); desktopApi.openExternal(appInfo.repoUrl); };
	});
}

// 加载器本地设置（Beta 更新通道开关等），与备份设置同款 localStorage 持久化
const LOADER_SETTINGS_KEY = 'devil_connection_loader_settings_v1';
function loadLoaderSettings() {
	try {
		const j = JSON.parse(localStorage.getItem(LOADER_SETTINGS_KEY) || '{}');
		return { beta_updates: !!j.beta_updates };
	} catch (e) { return { beta_updates: false }; }
}
function saveLoaderSettings(s) {
	try { localStorage.setItem(LOADER_SETTINGS_KEY, JSON.stringify(s)); } catch (e) {}
}
const loaderSettings = loadLoaderSettings();

const betaToggle = document.getElementById('beta-updates-toggle');
function applyBetaToggleUI(enabled) {
	if (!betaToggle) return;
	const isEnabled = !!enabled;
	const dot = betaToggle.querySelector('.switch-dot');
	betaToggle.classList.toggle('switch-on', isEnabled);
	betaToggle.classList.toggle('switch-off', !isEnabled);
	dot.classList.toggle('switch-dot-on', isEnabled);
	dot.classList.toggle('switch-dot-off', !isEnabled);
}
if (betaToggle) {
	applyBetaToggleUI(loaderSettings.beta_updates);
	betaToggle.onclick = () => {
		loaderSettings.beta_updates = !loaderSettings.beta_updates;
		saveLoaderSettings(loaderSettings);
		applyBetaToggleUI(loaderSettings.beta_updates);
	};
}

// 一键自动更新：进度弹窗 + 可取消；成功后主进程会自动重启加载器
async function runAutoUpdate() {
	const wrap = document.getElementById('update-modal');
	const text = document.getElementById('update-modal-text');
	const bar = document.getElementById('update-modal-bar');
	const pctEl = document.getElementById('update-modal-pct');
	const btnCancel = document.getElementById('update-modal-cancel');
	if (!wrap) return;
	wrap.classList.remove('hidden');
	text.textContent = '准备中...';
	bar.style.width = '0%';
	pctEl.textContent = '';
	btnCancel.classList.remove('hidden');
	btnCancel.onclick = () => { desktopApi.cancelUpdate(); };
	const unsub = desktopApi.onUpdateProgress((p) => {
		if (!p) return;
		if (p.text) text.textContent = p.text;
		if (p.pct != null) { bar.style.width = p.pct + '%'; pctEl.textContent = p.pct + '%'; }
		else if (p.received) { pctEl.textContent = (p.received / 1024 / 1024).toFixed(1) + ' MB'; }
		if (p.phase === 'done') btnCancel.classList.add('hidden');
	});
	const res = normResponse(await desktopApi.downloadAndApplyUpdate(loaderSettings.beta_updates));
	if (unsub) unsub();
	if (!res.ok) {
		wrap.classList.add('hidden');
		await askConfirm({ title: '更新失败', message: res.message || '未知错误，请稍后重试或前往 GitHub 手动更新。' });
		return;
	}
	text.textContent = '更新完成，加载器即将自动重启...';
	bar.style.width = '100%';
	pctEl.textContent = '100%';
}

// 检查更新：去 GitHub release 比对版本（按 Beta 开关选通道），可自动更新则一键更新，否则跳手动下载
const cardCheckUpdate = document.getElementById('card-check-update');
if (cardCheckUpdate) {
	const label = document.getElementById('check-update-label');
	const icon = document.getElementById('check-update-icon');
	let checking = false;
	cardCheckUpdate.onclick = async () => {
		if (checking) return;
		checking = true;
		const restore = () => { checking = false; if (label) label.textContent = '检查更新'; if (icon) icon.classList.remove('animate-spin'); };
		if (label) label.textContent = '正在检查...';
		if (icon) icon.classList.add('animate-spin');
		const res = normResponse(await desktopApi.checkForUpdate(loaderSettings.beta_updates));
		restore();
		if (!res.ok) {
			await askConfirm({ title: '检查更新失败', message: res.message || '无法连接 GitHub，请检查网络后重试。' });
			return;
		}
		const d = res.data || {};
		if (d.hasUpdate && d.latest) {
			const head = d.reason === 'leaveBeta'
				? `当前 ${d.current} 为 Beta 测试版，已关闭 Beta 更新通道，将回到最新稳定版 ${d.latest}。`
				: `当前 ${d.current}，最新 ${d.latest}。`;
			if (d.canAutoUpdate) {
				const go = await askConfirm({
					title: `发现新版本 ${d.latest}`,
					message: head + ` 是否立即自动更新？完成后加载器将自动重启（游戏若在运行也会一并重启）。`
				});
				if (go) runAutoUpdate();
			} else {
				const go = await askConfirm({
					title: `发现新版本 ${d.latest}`,
					message: head + ` 该版本未提供自动更新包，是否前往 GitHub 下载安装器手动更新？`
				});
				if (go) desktopApi.openExternal(d.url || appInfo.repoUrl + '/releases');
			}
		} else {
			await askConfirm({
				title: '已是最新版本',
				message: d.note ? `当前版本 ${d.current}（${d.note}）。` : `当前版本 ${d.current} 已是最新。`
			});
		}
	};
}

document.getElementById('btn-start').onclick = async () => {
	const btn = document.getElementById('btn-start');
	btn.disabled = true;
	btn.textContent = ' 正在启动... ';
	const res = normResponse(await desktopApi.launchGame());
	if (!res.ok) {
		btn.disabled = false;
		btn.textContent = ' 启动游戏 ';
		await askConfirm({ title: '启动失败', message: res.message || '无法启动游戏' });
	}
};

window.addEventListener('beforeunload', () => { dispose(); });

window.onload = async () => {
	await initAppInfo();
	await backupsManager.initBackupSystem();
	await navigation.switchPage('home');
};
