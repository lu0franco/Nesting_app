  'use strict';

  (function defineNestingService(globalScope) {
    function createNestingService({
    state,
    dom,
    getCurrentNestingSettings,
    exportPlacementJSON,
    setStatus,
    setNestStatsTone,
    showNestResult,
    renderTabs,
      syncExportButton,
      getOpenSheetEditor,
      updateSheetModeControls,
    }) {
      const {
        MULTI_SHEET_STRATEGY_OPTIONS = {
          'auto': { multiStripMode: 'barriers', bucketFillWeight: null },
          'by-height': { multiStripMode: 'prebucket', bucketFillWeight: 1.0 },
          'by-length': { multiStripMode: 'prebucket', bucketFillWeight: 0.0 },
          'by-height-or-length': { multiStripMode: 'prebucket', bucketFillWeight: null },
        },
      } = globalScope.NestSettings || {};
      let nestInterval = null;
      let sparrowRunAborted = false;
      let activeSparrowRunId = null;
      let activeGroupSheets = null;

    // Parses raw stdout/stderr from the solver binary into a clean one-line message.
    // Prefers explicit "error:" lines, falls back to the last non-info line, then to raw text.
    function extractSparrowErrorMessage(...chunks) {
      const text = chunks.map(chunk => String(chunk || '')).filter(Boolean).join('\n').trim();
      if (!text) return 'Sparrow failed';

      const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
      const explicitError = [...lines].reverse().find(line => /^error:/i.test(line));
      if (explicitError) return explicitError.replace(/^error:\s*/i, '').trim();
      const stripLength = [...lines].reverse().find(line => /requires strip length .* exceeding the configured maximum/i.test(line));
      if (stripLength) return stripLength;
      const lastMeaningful = [...lines].reverse().find(line => !/^\[info\]/i.test(line));
      return lastMeaningful || lines[lines.length - 1] || 'Sparrow failed';
    }

    // Sets the status chip to error, tints the status bar red, and writes the error
    // message with a tooltip containing the full solver details for debugging.
    function showRunError(message, details = '') {
      setStatus('error');
      setNestStatsTone('error');
      const summary = message || 'Sparrow failed';
      dom.nestStats.textContent = `Run failed: ${summary}`;
      dom.nestStats.title = details || summary;
    }

    // Shows a gentle preflight hint when Run is pressed before the user has
    // added the required DXF parts and/or sheets.
    function showStartRequirementsWarning(message) {
      setStatus('idle');
      setNestStatsTone('warning');
      dom.nestStats.textContent = message;
      dom.nestStats.title = '';
    }

    function normalizeGroupKey(material, thickness) {
      return globalScope.NestHelpers.normalizeGroupKey(material, thickness);
    }

    function sheetMatchesFile(sheet, file) {
      const fm = globalScope.NestHelpers.normalizeMaterialOrThickness(file.material);
      const ft = globalScope.NestHelpers.normalizeMaterialOrThickness(file.thickness);
      const sm = globalScope.NestHelpers.normalizeMaterialOrThickness(sheet.material);
      const st = globalScope.NestHelpers.normalizeMaterialOrThickness(sheet.thickness);
      const materialMatch = !sm || sm === fm;
      const thicknessMatch = !st || st === ft;
      return materialMatch && thicknessMatch;
    }

    function computeMaxStripLengthForSheets(sheets) {
      if (!Array.isArray(sheets) || !sheets.length) return null;
      const hasUnlimited = sheets.some(sheet => sheet.widthMode === 'unlimited');
      if (hasUnlimited) return null;
      const widths = sheets
        .map(sheet => Number(sheet.width))
        .filter(value => Number.isFinite(value) && value > 0);
      if (!widths.length) return null;
      return Math.max(...widths);
    }

    function buildNestingGroupPayloads(payload) {
      const sheetGroups = new Map();
      const orderedGroupKeys = [];
      for (const sheet of state.sheets) {
        const key = normalizeGroupKey(sheet.material, sheet.thickness);
        if (!sheetGroups.has(key)) {
          sheetGroups.set(key, []);
          orderedGroupKeys.push(key);
        }
        sheetGroups.get(key).push(sheet);
      }

      const groupedItems = new Map();
      for (const item of payload.items || []) {
        const fileMaterial = String(item.source_material || '').trim();
        const fileThickness = String(item.source_thickness || '').trim();
        let assignedKey = null;

        for (const groupKey of orderedGroupKeys) {
          const sheets = sheetGroups.get(groupKey) || [];
          if (sheets.some(sheet => sheetMatchesFile(sheet, { material: fileMaterial, thickness: fileThickness }))) {
            assignedKey = groupKey;
            break;
          }
        }

        if (assignedKey === null) {
          assignedKey = orderedGroupKeys.length ? orderedGroupKeys[orderedGroupKeys.length - 1] : normalizeGroupKey(fileMaterial, fileThickness) || 'unspecified';
        }

        if (!groupedItems.has(assignedKey)) groupedItems.set(assignedKey, []);
        groupedItems.get(assignedKey).push(item);
      }

      const payloads = [];
      for (const [groupKey, groupItems] of groupedItems) {
        if (!groupItems || !groupItems.length) continue;
        const groupSheets = sheetGroups.get(groupKey) || [];
        const localItems = groupItems.map((originalItem, index) => ({
          ...originalItem,
          id: index,
        }));

        payloads.push({
          name: `${payload.name}_${groupKey}`,
          settings: payload.settings,
          items: localItems,
          sheets: (groupSheets.length ? groupSheets : payload.sheets).map(sheet => ({
            id: sheet.id,
            width: sheet.widthMode === 'unlimited' ? null : sheet.width,
            height: sheet.height,
            width_mode: sheet.widthMode || 'fixed',
            quantity: 'auto',
            material: sheet.material || '',
            thickness: sheet.thickness || '',
          })),
          strip_height: groupSheets[0]?.height || payload.strip_height || 0,
          meta: { groupKey },
        });
      }

      return payloads;
    }

    function annotateStripsWithSheetMeta(strips, sheets, groupInputPath = null, groupItemIdMap = null) {
      const lastSheet = (Array.isArray(sheets) && sheets.length) ? sheets[sheets.length - 1] : {};
      return (Array.isArray(strips) ? strips : []).map((strip, index) => {
        const sheet = sheets[index] || lastSheet || {};
        const widthMode = sheet.width_mode || sheet.widthMode || 'fixed';
        const widthValue = widthMode === 'fixed'
          ? Number(sheet.width)
          : Number(strip?.strip_width) || Number(sheet.width);

        return {
          ...strip,
          sheet_material: sheet.material || '',
          sheet_thickness: sheet.thickness || '',
          sheet_width_mode: widthMode,
          sheet_width: Number.isFinite(widthValue) ? widthValue : Number(strip?.strip_width) || 0,
          sheet_height: Number.isFinite(strip?.strip_height) ? strip.strip_height : Number(sheet.height) || 0,
          sheet_id: sheet.id || null,
          group_input_path: groupInputPath || null,
          group_item_id_map: groupItemIdMap ? { ...groupItemIdMap } : null,
        };
      });
    }

    async function waitForSparrowCompletion(runId, groupIndex, totalGroups) {
      while (true) {
        if (!window.electronAPI?.pollSparrow) {
          throw new Error('Sparrow polling is not available');
        }

        const result = await window.electronAPI.pollSparrow(runId);
        if (!result?.success) {
          throw new Error(result?.error || 'Failed to poll Sparrow run');
        }

        if (result.status === 'completed') {
          return result;
        }

        if (result.status === 'error') {
          throw new Error(result.error || 'Sparrow failed');
        }

        if (result.status === 'stopped') {
          throw new Error('Sparrow run was stopped');
        }

        if (sparrowRunAborted) {
          await window.electronAPI.stopSparrow(runId);
          throw new Error('Nesting run aborted');
        }

        dom.nestStats.textContent = `Running group ${groupIndex} of ${totalGroups}…`;
        await new Promise(resolve => window.setTimeout(resolve, 500));
      }
    }

    // Called on a 500ms interval while the solver is running to fetch the latest result.
    // Updates state and re-renders the canvas whenever new strips arrive, and cleans up
    // the interval on completion, error, or stop.
    async function pollSparrowRun(runId) {
      if (!window.electronAPI?.pollSparrow) return;

      const result = await window.electronAPI.pollSparrow(runId);
      if (!result?.success) {
        throw new Error(result?.error || 'Failed to poll Sparrow run');
      }

      if (result.summary?.strips?.length) {
        const previousCount = state.nestResult?.strips?.length || 0;
        const previousIndex = state.activeStripIndex || 0;
        state.nestResult = result.summary;
        state.nestResult.groupSheets = activeGroupSheets || state.nestResult.groupSheets || null;
        if (result.inputPath) state.nestInputPath = result.inputPath;

        const activeWasTrackingNewest = previousCount > 0 && previousIndex === previousCount - 1;
        if (previousCount === 0) {
          // First time strips become available this run. Default to sheet 1
          // so the user lands on the natural starting point. (Barrier mode
          // loads every sheet on the first poll, so without this guard the
          // newest-strip auto-follow below would jump straight to the last
          // tab.)
          state.activeStripIndex = 0;
        } else if (state.nestResult.strips.length > previousCount && activeWasTrackingNewest) {
          // Pre-bucket mode: Sparrow finishes one sheet at a time. Follow
          // the newest one only when the user was already on the latest
          // sheet, so manual tab selection isn't overridden.
          state.activeStripIndex = state.nestResult.strips.length - 1;
        } else if (!state.nestResult.strips[previousIndex]) {
          state.activeStripIndex = 0;
        }
        syncExportButton();
        renderTabs();
        showNestResult(state.activeStripIndex || 0);
      } else if (result.status === 'running') {
        setNestStatsTone('');
        dom.nestStats.textContent = 'Running placement… waiting for first preview';
      }

      if (result.status === 'completed') {
        clearInterval(nestInterval);
        nestInterval = null;
        activeSparrowRunId = null;
        setStatus('done');
        setNestStatsTone('');
        dom.nestStats.title = '';
        dom.startBtn.classList.remove('running');
        dom.startBtn.disabled = false;
        dom.stopBtn.disabled = true;
        dom.stopBtn.classList.remove('active');
        return;
      }

      if (result.status === 'error') {
        clearInterval(nestInterval);
        nestInterval = null;
        activeSparrowRunId = null;
        const combinedDetails = [result.error, result.stderr, result.stdout].filter(Boolean).join('\n');
        const err = new Error(extractSparrowErrorMessage(result.error, result.stderr, result.stdout));
        err.sparrowDetails = combinedDetails;
        throw err;
      }

      if (result.status === 'stopped') {
        clearInterval(nestInterval);
        nestInterval = null;
        activeSparrowRunId = null;
      }
    }

    // Wires the Start and Stop buttons.
    // Start: exports the placement JSON, launches Sparrow via IPC, and begins a 500ms
    // polling interval. Stop: sets the abort flag, calls stopSparrow, and resets the UI.
    function bind() {
      // Start button — exports placement JSON, runs Sparrow, and starts polling for results.
      dom.startBtn.addEventListener('click', async () => {
        if (state.status === 'running') return;

        const hasFiles = state.files.length > 0;
        const hasSheets = state.sheets.length > 0;
        if (!hasFiles && !hasSheets) {
          showStartRequirementsWarning('Add DXF parts and at least one sheet, then press Run.');
          return;
        }
                if (!hasFiles) {
          showStartRequirementsWarning('Add one or more DXF parts before running nesting.');
          return;
        }

        // Validación de material: las piezas deben coincidir con alguna sheet definida.
        const { normalizeMaterialOrThickness } = globalScope.NestHelpers;
        const sheetConstraints = state.sheets.map(sheet => ({
          material: normalizeMaterialOrThickness(sheet.material),
          thickness: normalizeMaterialOrThickness(sheet.thickness),
        }));
        const hasAnyConstraint = sheetConstraints.some(sheet => sheet.material || sheet.thickness);

        if (hasAnyConstraint) {
          const mismatched = state.files.filter(file => {
            const fm = normalizeMaterialOrThickness(file.material);
            const ft = normalizeMaterialOrThickness(file.thickness);

            return !sheetConstraints.some(sheet => {
              const materialMatch = !sheet.material || sheet.material === fm;
              const thicknessMatch = !sheet.thickness || sheet.thickness === ft;
              return materialMatch && thicknessMatch;
            });
          });

          if (mismatched.length > 0) {
            // Group mismatched files by material/thickness
            const materialGroups = {};
            mismatched.forEach(f => {
              const key = `${f.material || ''}|${f.thickness || ''}`;
              if (!materialGroups[key]) {
                materialGroups[key] = {
                  material: f.material,
                  thickness: f.thickness,
                  files: []
                };
              }
              materialGroups[key].files.push(f);
            });

            const groups = Object.values(materialGroups);
            const groupNames = groups.map(g => `${g.material || 'No material'} ${g.thickness ? '(' + g.thickness + ')' : ''}`).join(', ');
            
            // Create a more detailed warning with option to create sheets
            const warningEl = document.createElement('div');
            warningEl.className = 'material-mismatch-warning';
            warningEl.innerHTML = `
              <p><strong>Material mismatch:</strong> The following materials don't match any sheet:</p>
              <ul>
                ${groups.map(g => `
                  <li>
                    <strong>${g.material || 'No material'}</strong> ${g.thickness ? '(' + g.thickness + ')' : ''}
                    <button class="create-sheet-btn" data-material="${g.material || ''}" data-thickness="${g.thickness || ''}">
                      Create sheet
                    </button>
                  </li>
                `).join('')}
              </ul>
            `;
            
            // Add click handlers for create sheet buttons
            warningEl.querySelectorAll('.create-sheet-btn').forEach(btn => {
              btn.addEventListener('click', () => {
                const material = btn.dataset.material;
                const thickness = btn.dataset.thickness;
                
                // Open sheet modal with pre-filled values
                const openSheetEditor = getOpenSheetEditor ? getOpenSheetEditor() : null;
                if (openSheetEditor) {
                  // Reset form first
                  state.editingSheetId = null;
                  dom.sheetWidthMode.value = 'fixed';
                  if (typeof dom.sheetWidthMode._syncCustomSelect === 'function') dom.sheetWidthMode._syncCustomSelect();
                  dom.sheetHeight.value = '1250';
                  dom.sheetWidth.value = '3000';
                  dom.sheetMaterial.value = material;
                  if (dom.sheetThickness) dom.sheetThickness.value = thickness;
                  dom.confirmSheet.textContent = 'Add Sheet';
                  if (updateSheetModeControls) updateSheetModeControls();
                  dom.sheetModal.classList.add('open');
                }
              });
            });
            
            showStartRequirementsWarning(warningEl);
            return;
          }
        }

        if (!hasSheets) {
          showStartRequirementsWarning('Add at least one sheet before running nesting.');
          return;
        }

        let exported;
        try {
          exported = await exportPlacementJSON();
          setNestStatsTone('');
          dom.nestStats.textContent = 'Placement data prepared';
          dom.nestStats.title = exported.path || '';
        } catch (err) {
          console.error('[Placement JSON] Export failed:', err);
          setStatus('error');
          setNestStatsTone('error');
          dom.nestStats.textContent = `Export failed: ${err.message}`;
          return;
        }

        setStatus('running');
        setNestStatsTone('');
        dom.nestStats.title = '';
        sparrowRunAborted = false;
        dom.startBtn.classList.add('running');
        dom.startBtn.disabled = true;
        dom.stopBtn.disabled = false;
        dom.stopBtn.classList.add('active');
        state.nestResult = null;
        state.activeStripIndex = 0;
        syncExportButton();

        try {
          const settings = getCurrentNestingSettings();
          const partSpacing = Number(settings.partSpacing) || 0;
          const strategyKey = String(settings.multiSheetStrategy || 'auto').toLowerCase();
          const strategy = MULTI_SHEET_STRATEGY_OPTIONS[strategyKey]
            || MULTI_SHEET_STRATEGY_OPTIONS['auto'];
          const { multiStripMode, bucketFillWeight } = strategy;
          const baseSparrowOptions = {
            globalTime: Number(settings.timeLimit) || 60,
            rngSeed: Number.isFinite(Number(settings.rngSeed)) ? Math.trunc(Number(settings.rngSeed)) : 42,
            workers: Number.isFinite(Number(settings.workers)) ? Math.max(1, Math.trunc(Number(settings.workers))) : 3,
            earlyTermination: !!settings.earlyStopping,
            stripMargin: Number(settings.sheetMargin) || 0,
            minItemSeparation: partSpacing,
            exactCoedge: partSpacing === 0,
            align: String(settings.preferredAlignment || 'top'),
            multiStripMode,
            ...(Number.isFinite(bucketFillWeight) ? { bucketFillWeight } : {}),
          };

          const groupedPayloads = buildNestingGroupPayloads(exported.payload);
          if (!groupedPayloads.length) {
            throw new Error('No nesting payload groups could be created. Check sheet material/thickness configuration.');
          }

          const combinedStrips = [];
          for (let groupIndex = 0; groupIndex < groupedPayloads.length; groupIndex += 1) {
            if (sparrowRunAborted) break;
            const groupPayload = groupedPayloads[groupIndex];
            const groupSheets = Array.isArray(groupPayload.sheets) ? groupPayload.sheets : [];
            activeGroupSheets = groupSheets;
            const maxStripLength = computeMaxStripLengthForSheets(groupSheets);
            const sparrowOptions = {
              ...baseSparrowOptions,
              maxStripLength,
            };

            const result = await window.electronAPI.runSparrow(groupPayload, sparrowOptions);
            if (!result?.success || !result.runId) {
              throw new Error(result?.error || 'Failed to start Sparrow for a material/thickness group');
            }

            activeSparrowRunId = result.runId;
            setNestStatsTone('');
            dom.nestStats.textContent = `Running group ${groupIndex + 1} of ${groupedPayloads.length}…`;
            dom.nestStats.title = result.inputPath || '';

            const finalResult = await waitForSparrowCompletion(result.runId, groupIndex + 1, groupedPayloads.length);
            activeSparrowRunId = null;

            const groupStrips = annotateStripsWithSheetMeta(finalResult.summary?.strips || [], groupSheets, result.inputPath, groupPayload.meta?.itemIdMap || null);
            combinedStrips.push(...groupStrips);

            state.nestResult = {
              name: exported.payload.name || 'nesting-job',
              strips: combinedStrips,
              is_preview: false,
            };
            state.activeStripIndex = 0;
            syncExportButton();
            renderTabs();
            showNestResult(0);
            dom.nestStats.textContent = `Completed group ${groupIndex + 1} of ${groupedPayloads.length}`;
          }

          if (sparrowRunAborted) return;
          if (!combinedStrips.length) {
            throw new Error('No strips were produced by the nesting runs.');
          }

          setStatus('done');
          setNestStatsTone('');
          dom.nestStats.title = '';
          dom.nestStats.textContent = 'Placement complete';
          dom.startBtn.classList.remove('running');
          dom.startBtn.disabled = false;
          dom.stopBtn.disabled = true;
          dom.stopBtn.classList.remove('active');
        } catch (err) {
          if (sparrowRunAborted) return;
          console.error('[Sparrow] Run failed:', err?.sparrowDetails || err);
          activeSparrowRunId = null;
          if (nestInterval) {
            clearInterval(nestInterval);
            nestInterval = null;
          }
          showRunError(err.message, err?.sparrowDetails || err.message);
          dom.startBtn.classList.remove('running');
          dom.startBtn.disabled = false;
          dom.stopBtn.disabled = true;
          dom.stopBtn.classList.remove('active');
        }
      });

      // Stop button — sets the abort flag, tells the main process to stop Sparrow,
      // clears the polling interval, and resets the UI to idle.
      dom.stopBtn.addEventListener('click', async () => {
        if (state.status !== 'running') return;
        sparrowRunAborted = true;
        activeSparrowRunId = null;
        if (window.electronAPI?.stopSparrow) {
          try {
            await window.electronAPI.stopSparrow();
          } catch (err) {
            console.error('[Sparrow] Stop failed:', err);
          }
        }
        clearInterval(nestInterval);
        nestInterval = null;
        setStatus('idle');
        setNestStatsTone('');
        dom.nestStats.textContent = 'Placement stopped';
        dom.nestStats.title = '';
        dom.startBtn.classList.remove('running');
        dom.startBtn.disabled = false;
        dom.stopBtn.disabled = true;
        dom.stopBtn.classList.remove('active');
      });
    }

    return { bind };
  }

  globalScope.NestNestingService = { createNestingService };
})(window);
