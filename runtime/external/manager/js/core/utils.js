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
