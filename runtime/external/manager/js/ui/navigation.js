export function createNavigation({ onMods, onBackups, onWorkshop }) {
	async function switchPage(pageId) {
		document.querySelectorAll('.nav-item').forEach(el => {
			el.classList.toggle('active', el.dataset.pageBtn === pageId);
		});
		document.querySelectorAll('.page-container').forEach(el => {
			el.classList.toggle('active', el.id === `page-${pageId}`);
		});
		if (pageId === 'mods') await onMods();
		if (pageId === 'backups') await onBackups();
		if (pageId === 'workshop' && onWorkshop) await onWorkshop();
	}

	function bindNavButtons() {
		document.querySelectorAll('[data-page-btn]').forEach(btn => {
			btn.onclick = () => switchPage(btn.dataset.pageBtn);
		});
	}

	return { switchPage, bindNavButtons };
}
