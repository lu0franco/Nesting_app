const isDevMode = process.argv.includes('--dev') || process.argv.includes('--devtools');
const isMasDiagnosticStartup = process.mas;
const { initializeApp } = require('./main/app');

if (!isMasDiagnosticStartup) {
  const { getMainWindow, registerAppMenuIpc } = require('./main/app');
  const { registerFileIpc } = require('./main/ipc/files');
  const { registerSparrowIpc } = require('./main/ipc/sparrow');
  const { registerExportDxfIpc } = require('./main/ipc/export-dxf');

  registerFileIpc({ getMainWindow });
  registerAppMenuIpc();
  registerSparrowIpc();
  registerExportDxfIpc();
}

initializeApp({
  isDevMode,
  minimalStartup: isMasDiagnosticStartup,
});
