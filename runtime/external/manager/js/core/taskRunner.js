import { normResponse } from '../core/utils.js';
import { desktopApi } from './api.js';

export function createTaskRunner({ askConfirm }) {
	let busy = false;
	const taskWrap = document.getElementById('task-progress-wrap');
	const taskBar = document.getElementById('task-progress');
	const taskText = document.getElementById('task-progress-text');
	const taskTitle = document.getElementById('task-progress-title');
	const taskPercent = document.getElementById('task-progress-percent');
	const TASK_HIDE_DELAY = 1000;
	let activeTaskId = '';

	const setTaskProgress = (p, msg) => {
		const percent = Math.max(0, Math.min(100, Math.round(Number(p) || 0)));
		taskBar.style.width = `${percent}%`;
		taskPercent.textContent = `${percent}%`;
		taskText.textContent = msg || '';
	};

	const startTaskUI = (name, taskId) => {
		busy = true;
		activeTaskId = taskId;
		taskWrap.classList.remove('hidden');
		taskTitle.textContent = name;
		setTaskProgress(0, '请稍候...');
	};

	const finishTaskUI = () => {
		activeTaskId = '';
		setTimeout(() => {
			taskWrap.classList.add('hidden');
			busy = false;
		}, TASK_HIDE_DELAY);
	};

	const unsubscribeTaskProgress = desktopApi.onTaskProgress(payload => {
		if (!payload || payload.taskId !== activeTaskId) return;
		setTaskProgress(payload.percent, payload.text || '处理中...');
	});

	async function runTask(name, action) {
		if (busy) return {
			ok: false,
			kind: 'info',
			message: '已有任务在执行中'
		};
		const taskId = Math.random().toString(36).slice(2, 9);
		startTaskUI(name, taskId);
		let res;
		try {
			res = await action({ setProgress: setTaskProgress, taskId });
			if (!res || typeof res !== 'object' || !('ok' in res)) {
				res = normResponse(res);
			}
		} catch (err) {
			res = {
				ok: false,
				message: err?.message || '未知错误'
			};
		}

		if (res.ok) {
			setTaskProgress(100, '完成');
		} else if (res.kind !== 'info') {
			await askConfirm({
				title: '操作失败',
				message: res.message || '未知错误'
			});
		}

		finishTaskUI();
		return res;
	}

	function dispose() {
		unsubscribeTaskProgress && unsubscribeTaskProgress();
	}

	function isBusy() {
		return busy;
	}

	return { runTask, dispose, isBusy };
}
