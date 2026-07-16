export function normResponse(res) {
	if (res && typeof res === 'object' && 'ok' in res) return res;
	return {
		ok: false,
		reason: 'error',
		message: '响应异常',
		data: null
	};
}

export function sizeMB(bytes) {
	if (!bytes) return '0.00 MB';
	return (bytes / 1024 / 1024).toFixed(2) + ' MB';
}

export function normalizePositiveInt(value, fallback) {
	const n = parseInt(value, 10);
	if (!Number.isFinite(n) || n <= 0) return fallback;
	return n;
}

export function escapeHtml(text) {
	return String(text == null ? '' : text)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

// 弹系统文件选择框（模组导入 / 备份导入共用）。multiple=false 回调单个 File，multiple=true 回调 File 数组。
export function pickFiles({ accept, multiple = false, onSelected }) {
	const input = document.createElement('input');
	input.type = 'file';
	input.accept = accept;
	if (multiple) input.multiple = true;
	input.onchange = async () => {
		const files = [...input.files];
		if (files.length) await onSelected(multiple ? files : files[0]);
	};
	input.click();
}
