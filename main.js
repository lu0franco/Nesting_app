const isDevMode = process.argv.includes('--dev') || process.argv.includes('--devtools');
const { initializeApp, getMainWindow, registerAppMenuIpc } = require('./main/app');
const { registerFileIpc } = require('./main/ipc/files');
const { registerSparrowIpc } = require('./main/ipc/sparrow');
const { registerExportDxfIpc } = require('./main/ipc/export-dxf');

registerFileIpc({ getMainWindow });
registerAppMenuIpc();
registerSparrowIpc();
registerExportDxfIpc();

initializeApp({ isDevMode });
