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

  /**
   * Extrae propiedades desde el contenido crudo del DXF.
   * Formato esperado en sección SUMMARYINFO:
   *   1000
   *   PartNumber
   *   1000
   *   TAPA DE CIERRE
   *   1000
   *   StockNumber
   *   1000
   *   D-638.J.11.03
   *   1000
   *   MATERIAL_PLANO
   *   1000
   *   CHAPA 1,2 mm AISI 304 2B
   *   1000
   *   CANTIDAD_USADA
   *   1000
   *   1
   */
  function parseDxfPropertiesFromRaw(rawContent) {
    if (!rawContent || typeof rawContent !== 'string') {
      return { partNumber: '', stockNumber: '', material: '', thickness: '', quantity: 1 };
    }

    const lines = rawContent.split('\n');
    const properties = {
      partNumber: '',
      stockNumber: '',
      material: '',
      thickness: '',
      quantity: 1
    };

    let i = 0;
    
    while (i < lines.length) {
      const line = lines[i].trim();
      
      // Buscar el patrón: 1000 -> valor -> 1000 -> valor
      // El formato puede ser:
      // 1000 -> PartNumber -> 1000 -> TAPA DE CIERRE
      // 1000 -> D-638.J.11.01 -> 1000 -> MATERIAL_PLANO -> 1000 -> CHAPA 1,2 mm AISI 304 2B
      if (line === '1000' && i + 3 < lines.length) {
        const firstValue = lines[i + 1].trim();
        const nextMarker = lines[i + 2].trim();
        const secondValue = lines[i + 3].trim();
        
        if (nextMarker === '1000') {
          // Caso 1: firstValue es el nombre del campo, secondValue es el valor
          if (firstValue === 'PartNumber') {
            properties.partNumber = secondValue;
            i += 4;
          } else if (firstValue === 'StockNumber') {
            properties.stockNumber = secondValue;
            i += 4;
          } else if (firstValue === 'CANTIDAD_USADA') {
            const qty = parseInt(secondValue, 10);
            properties.quantity = Number.isFinite(qty) && qty > 0 ? qty : 1;
            i += 4;
          } 
          // Caso 2: secondValue es MATERIAL_PLANO, entonces el siguiente valor es el material
          else if (secondValue === 'MATERIAL_PLANO' && i + 5 < lines.length) {
            const nextMarker2 = lines[i + 4].trim();
            const materialValue = lines[i + 5].trim();
            if (nextMarker2 === '1000') {
              properties.material = materialValue;
              // Extraer espesor del material si está disponible
              const thicknessMatch = materialValue.match(/(\d+[.,]?\d*)\s*mm/i);
              if (thicknessMatch) {
                properties.thickness = thicknessMatch[1].replace(',', '.') + 'mm';
              }
              i += 6; // Skip firstValue, nextMarker, secondValue, nextMarker2, materialValue, and next 1000
            } else {
              i += 4;
            }
          } else {
            i += 4;
          }
        } else {
          i++;
        }
      }
      i++;
    }

    return properties;
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
    parseDxfPropertiesFromRaw,
    normalizeMaterialOrThickness,
    normalizeGroupKey,
    groupByMaterialThickness,
  };
})(window);