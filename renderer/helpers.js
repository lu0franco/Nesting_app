'use strict';

(function defineHelpers(globalScope) {
  function uid() {
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  function formatBytes(bytes) {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  function formatWidthMeters(mm) {
    if (!Number.isFinite(mm)) return '—';
    if (mm >= 1000) return (mm / 1000).toFixed(2) + ' m';
    return mm.toFixed(1) + ' mm';
  }

  function roundCoord(value) {
    return Math.round(value * 1000) / 1000;
  }

  function partLabelFromName(fileName) {
    if (!fileName) return '';
    return String(fileName).replace(/\.dxf$/i, '');
  }

  function normalizeRotationStep(value) {
    if (value === 'none' || value === false || value == null) return 'none';
    const num = Number(value);
    if (!Number.isFinite(num) || num <= 0) return 'none';
    return String(num);
  }

  function buildAllowedOrientations(step) {
    if (step === 'none') return [0];
    const stepDeg = Number(step);
    if (!Number.isFinite(stepDeg) || stepDeg <= 0) return [0];
    const orientations = [];
    for (let deg = 0; deg < 360; deg += stepDeg) {
      orientations.push((deg * Math.PI) / 180);
    }
    return orientations;
  }

  function sameExportPoint(a, b, tolerance = 0.001) {
    if (!a || !b) return false;
    return Math.abs(a.x - b.x) <= tolerance && Math.abs(a.y - b.y) <= tolerance;
  }

  function sanitizePolygonPoints(points) {
    if (!Array.isArray(points) || points.length < 3) return [];
    const seen = new Set();
    return points.filter(p => {
      const key = `${roundCoord(p.x)},${roundCoord(p.y)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function clonePlain(obj) {
    if (obj == null) return obj;
    return JSON.parse(JSON.stringify(obj));
  }

  function effectiveFileQty(file) {
    if (!file) return 0;
    if (Array.isArray(file.shapes)) {
      return file.shapes.reduce((sum, shape) => sum + (shape.qty || 1), 0);
    }
    return file.qty || 1;
  }

  function buildJobName(files) {
    if (!Array.isArray(files) || !files.length) return 'nesting-job';
    const first = partLabelFromName(files[0].name);
    if (files.length === 1) return first;
    return `${first}+${files.length - 1}`;
  }

  /**
   * Extrae material y espesor desde el nombre de archivo DXF.
   * Formato esperado: Nombre_Material_Espesor.dxf
   * Ejemplo: BasePlate_Steel_3mm.dxf -> { material: 'Steel', thickness: '3mm' }
   */
  function parseMaterialAndThickness(fileName) {
    const clean = String(fileName || '')
      .replace(/\.dxf$/i, '')
      .trim();
    const parts = clean.split('_');
    if (parts.length < 3) {
      return { material: '', thickness: '' };
    }
    const thickness = parts.pop();
    const material = parts.pop();
    return { material: String(material), thickness: String(thickness) };
  }

  function normalizeMaterialOrThickness(value) {
    return String(value || '').trim().toLowerCase();
  }

  function normalizeGroupKey(material, thickness) {
    const mat = normalizeMaterialOrThickness(material);
    const thick = normalizeMaterialOrThickness(thickness);
    if (mat && thick) return `${mat}__${thick}`;
    return mat || thick || 'unspecified';
  }

  /**
   * Agrupa un array de objetos por una clave compuesta material+espesor.
   */
  function groupByMaterialThickness(items) {
    const groups = {};
    items.forEach(item => {
      const key = normalizeGroupKey(item.material, item.thickness);
      if (!groups[key]) groups[key] = [];
      groups[key].push(item);
    });
    return groups;
  }

  globalScope.NestHelpers = {
    uid,
    formatBytes,
    formatWidthMeters,
    roundCoord,
    partLabelFromName,
    normalizeRotationStep,
    buildAllowedOrientations,
    sameExportPoint,
    sanitizePolygonPoints,
    clonePlain,
    effectiveFileQty,
    buildJobName,
    parseMaterialAndThickness,
    normalizeMaterialOrThickness,
    normalizeGroupKey,
    groupByMaterialThickness,
  };
})(window);