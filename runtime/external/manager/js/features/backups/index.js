import { desktopApi } from '../../core/api.js';
import { normResponse, normalizePositiveInt } from '../../core/utils.js';
import {
	renderBackupFetchError,
	renderBackupEmpty,
	renderBackupRow
} from './render.js';

const BACKUP_SETTINGS_KEY = 'devil_connection_backup_settings_v1';

export function createBackupsManager({ askConfirm, runTask, isBusy }) {
	const autoToggle = document.getElementById('auto-enabled-toggle');

	function getDefaultBackupSettings() {
		return {
			auto_backup_enabled: true,
			auto_backup_keep_days: 7,
			auto_backup_max_count: 15
		};
	}

	function applyAutoToggleUI(enabled) {
		const isEnabled = !!enabled;
		const dot = autoToggle.querySelector('.switch-dot');
		autoToggle.dataset.enabled = isEnabled ? 'true' : 'false';
		autoToggle.classList.toggle('switch-on', isEnabled);
		autoToggle.classList.toggle('switch-off', !isEnabled);
		dot.classList.toggle('switch-dot-on', isEnabled);
		dot.classList.toggle('switch-dot-off', !isEnabled);
	}

	function loadBackupSettingsFromLocal() {
		try {
			const raw = localStorage.getItem(BACKUP_SETTINGS_KEY);
			if (!raw) return getDefaultBackupSettings();
			const parsed = JSON.parse(raw);
			const defaults = getDefaultBackupSettings();
			return {
				auto_backup_enabled: parsed?.auto_backup_enabled === undefined ? defaults.auto_backup_enabled : !!parsed.auto_backup_enabled,
				auto_backup_keep_days: normalizePositiveInt(parsed?.auto_backup_keep_days, defaults.auto_backup_keep_days),
				auto_backup_max_count: normalizePositiveInt(parsed?.auto_backup_max_count, defaults.auto_backup_max_count)
			};
		} catch (_e) {
			return getDefaultBackupSettings();
		}
	}

	function writeBackupSettingsToLocal(settings) {
		localStorage.setItem(BACKUP_SETTINGS_KEY, JSON.stringify(settings));
	}

	function saveSettings() {
		const settings = {
			auto_backup_enabled: autoToggle.dataset.enabled === 'true',
			auto_backup_keep_days: normalizePositiveInt(document.getElementById('keep-days').value, 7),
			auto_backup_max_count: normalizePositiveInt(document.getElementById('max-count').value, 10)
		};
		writeBackupSettingsToLocal(settings);
	}

	function renderBackupTitle(item) {
		if (item.customName) return item.customName;
		return '自动备份';
	}

	function pickFile({ accept, onSelected }) {
		const input = document.createElement('input');
		input.type = 'file';
		input.accept = accept;
		input.onchange = async () => {
			const file = input.files[0];
			if (!file) return;
			await onSelected(file);
		};
		input.click();
	}

	async function runTaskAndRefresh(taskName, action) {
		return runTask(taskName, async (ctx) => {
			const result = await action(ctx);
			await refreshBackups();
			return result;
		});
	}

	async function initBackupSystem() {
		const stateEl = document.getElementById('backup-state');
		try {
			const settings = loadBackupSettingsFromLocal();
			applyAutoToggleUI(settings.auto_backup_enabled);
			document.getElementById('keep-days').value = settings.auto_backup_keep_days || 7;
			document.getElementById('max-count').value = settings.auto_backup_max_count || 10;
			writeBackupSettingsToLocal(settings);

			if (!settings.auto_backup_enabled) {
				stateEl.textContent = '自动备份：已关闭';
				return;
			}

			stateEl.textContent = '自动备份：执行中（保留 ' + settings.auto_backup_keep_days + ' 天 / 最多 ' + settings.auto_backup_max_count + ' 条）';

			const resultRes = normResponse(await desktopApi.autoBackup(settings));
			if (!resultRes.ok) {
				stateEl.textContent = `自动备份：失败${resultRes.message ? `（${resultRes.message}）` : ''}`;
				return;
			}

			const result = resultRes.data || {};
			if (result.status === 'ok') {
				stateEl.textContent = '自动备份：已完成';
			} else if (result.status === 'skipped') {
				stateEl.textContent = '自动备份：未检测到存档，已跳过';
			} else if (result.status === 'disabled') {
				stateEl.textContent = '自动备份：已关闭';
			} else {
				stateEl.textContent = `自动备份：失败${resultRes?.message ? `（${resultRes.message}）` : ''}`;
			}
		} catch (err) {
			stateEl.textContent = '自动备份：状态读取失败';
			console.error('Backup Init Error:', err);
		}
	}

	function bindBackupRowActions(row, item, title) {
		row.querySelector('[data-a="restore"]').onclick = async () => {
			if (await askConfirm({ title: '恢复确认', message: `确定要恢复 "${title}" 吗？` })) {
				await runTask('恢复存档', async ({ setProgress, taskId }) => {
					setProgress(30, '正在恢复存档...');
					return await desktopApi.restoreBackup(item.name, taskId);
				});
			}
		};

		row.querySelector('[data-a="rename"]').onclick = async () => {
			const nextLabel = await askConfirm({
				title: '重命名备份',
				message: '请输入新的备份名称',
				hasInput: true,
				defaultValue: title === '自动备份' ? '' : title
			});
			if (nextLabel !== null) {
				await runTaskAndRefresh('重命名', async () => {
					return await desktopApi.renameBackup(item.name, String(nextLabel).trim());
				});
			}
		};

		row.querySelector('[data-a="lock"]').onclick = async () => {
			if (isBusy()) return;
			await runTaskAndRefresh(item.isLocked ? '解锁备份' : '锁定备份', async ({ setProgress }) => {
				setProgress(35, item.isLocked ? '正在解锁...' : '正在锁定...');
				return await desktopApi.toggleBackupLock(item.name);
			});
		};

		row.querySelector('[data-a="export"]').onclick = async () => {
			if (isBusy()) return;
			await runTask('导出备份', async ({ setProgress, taskId }) => {
				setProgress(15, '正在打开导出对话框...');
				const r = await desktopApi.exportBackupFile(item.name, taskId);
				if (r?.ok) return { ok: true, message: `导出成功：${r.data?.path}` };
				if (r?.reason === 'cancel') return { ok: false, kind: 'info', message: '已取消导出' };
				return { ok: false, message: `导出失败：${r?.message || '未知错误'}` };
			});
		};

		row.querySelector('[data-a="delete"]').onclick = async () => {
			if (item.isLocked) return;
			if (await askConfirm({ title: '删除确认', message: '删除后无法找回！' })) {
				await desktopApi.deleteBackup(item.name);
				refreshBackups();
			}
		};
	}

	async function refreshBackups() {
		const listEl = document.getElementById('backup-list');
		const res = normResponse(await desktopApi.getBackupsData());
		if (!res.ok) {
			listEl.innerHTML = renderBackupFetchError();
			return;
		}

		const files = res.data || [];
		if (files.length === 0) {
			listEl.innerHTML = renderBackupEmpty();
			return;
		}

		listEl.innerHTML = '';
		files.forEach(item => {
			const title = renderBackupTitle(item);
			const date = item.timeText || new Date(item.mtimeMs || item.mtime || Date.now()).toLocaleString();
			const wrapper = document.createElement('div');
			wrapper.innerHTML = renderBackupRow(item, title, date);
			const row = wrapper.firstElementChild;

			bindBackupRowActions(row, item, title);
			listEl.appendChild(row);
		});
	}

	function bindEvents() {
		autoToggle.onclick = () => {
			const isNow = autoToggle.dataset.enabled !== 'true';
			applyAutoToggleUI(isNow);
			saveSettings();
		};

		['keep-days', 'max-count'].forEach(id => {
			document.getElementById(id).onchange = saveSettings;
		});

		document.getElementById('btn-create-backup').onclick = async () => {
			const timeStr = new Date().toLocaleString().replace(/\//g, '-');
			const defaultName = `手动备份_${timeStr}`;
			const res = await askConfirm({
				title: '手动备份',
				message: '给备份起个名字',
				hasInput: true,
				defaultValue: '',
				placeholder: defaultName
			});

			if (res !== null) {
				const finalName = String(res).trim() || defaultName;
				await runTaskAndRefresh('备份中', async ({ setProgress, taskId }) => {
					setProgress(30, '打包数据...');
					return await desktopApi.backupNow(taskId, finalName);
				});
			}
		};

		document.getElementById('btn-import-backup').onclick = () => {
			pickFile({
				accept: '.zip',
				onSelected: async (file) => {
					await runTaskAndRefresh('导入中', async ({ taskId }) => {
						return await desktopApi.importBackupFromBuffer(
							file.name,
							new Uint8Array(await file.arrayBuffer()),
							taskId
						);
					});
				}
			});
		};

		document.getElementById('btn-export-current').onclick = async () => {
			if (isBusy()) return;
			await runTask('导出当前存档', async ({ setProgress, taskId }) => {
				setProgress(20, '正在打开导出对话框...');
				const r = await desktopApi.exportCurrentSave(taskId);
				if (r?.ok) return { ok: true, message: `导出成功：${r.data?.path}` };
				if (r?.reason === 'empty') return { ok: false, message: r?.message || '导出失败：当前没有存档' };
				if (r?.reason === 'cancel') return { ok: false, kind: 'info', message: '已取消导出' };
				return { ok: false, message: `导出失败：${r?.message || '未知错误'}` };
			});
		};
	}

	return { initBackupSystem, refreshBackups, bindEvents };
}
