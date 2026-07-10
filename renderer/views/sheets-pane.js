'use strict';

(function defineSheetsPane(globalScope) {
  function createSheetsPane({ state, dom, schedulePersistJobState, getOpenSheetEditor, renderTabs }) {
    // Rebuilds the sheets sidebar so it reflects current state.
    // Renders each sheet row with dimensions, material, mode label, and a per-row delete button.
    function renderSheets() {
      dom.sheetList.innerHTML = '';
      if (dom.addSheetBtn) {
        dom.addSheetBtn.style.visibility = 'visible';
        dom.addSheetBtn.disabled = false;
      }
      state.sheets.forEach(s => {
        const widthLabel = s.widthMode === 'unlimited'
          ? `${s.height} × Unlimited mm`
          : `${s.height} × ${s.width} mm`;
        const modeLabel = s.widthMode === 'unlimited'
          ? 'Auto sheets · continuous strip'
          : s.widthMode === 'max'
            ? 'Auto sheets · length capped'
            : 'Auto sheets · fixed size';
        const matLabel = [s.material, s.thickness].filter(Boolean).join(' · ') || 'No material';
        const li = document.createElement('li');
        li.className = 'sheet-item';
        li.innerHTML = `
          <div class="sheet-icon">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <rect x="1" y="2" width="12" height="10" rx="1.5" stroke="#4fcf8e" stroke-width="1.5"/>
            </svg>
          </div>
          <div class="sheet-info">
            <div class="sheet-dims">${widthLabel}</div>
            <div class="sheet-material">${matLabel} · ${modeLabel}</div>
          </div>
          <button class="sheet-remove" data-id="${s.id}" type="button" title="Eliminar chapa" aria-label="Eliminar chapa">
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M2.5 3.5h9M5.5 3.5V2.4c0-.5.4-.9.9-.9h1.2c.5 0 .9.4.9.9v1.1M4 5.2v5.1c0 .7.6 1.2 1.2 1.2h3.6c.7 0 1.2-.5 1.2-1.2V5.2M5.8 5.8v4M8.2 5.8v4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>`;
        li.addEventListener('click', e => {
          if (e.target.closest('.sheet-remove')) return;
          const openSheetEditor = getOpenSheetEditor();
          if (openSheetEditor) openSheetEditor(s.id);
        });
        dom.sheetList.appendChild(li);
      });
      dom.sheetList.querySelectorAll('.sheet-remove').forEach(btn => {
        btn.addEventListener('click', e => {
          e.stopPropagation();
          state.sheets = state.sheets.filter(sheet => sheet.id !== btn.dataset.id);
          renderSheets();
          renderTabs();
          schedulePersistJobState();
        });
      });
      renderTabs();
    }

    return { renderSheets };
  }

  globalScope.NestSheetsPane = { createSheetsPane };
})(window);