function doGet(e) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const action = e.parameter.action;

  // =============== TABLAS (HOJAS) ===============
  let sheetU  = ss.getSheetByName('Usuarios')  || ss.insertSheet('Usuarios');
  let sheetC  = ss.getSheetByName('Comidas')   || ss.insertSheet('Comidas');
  let sheetD  = ss.getSheetByName('Diario')    || ss.insertSheet('Diario');
  let sheetA  = ss.getSheetByName('Ajustes')   || ss.insertSheet('Ajustes');

  // =============== INICIALIZACIÓN DE ESQUEMAS ===============
  if (sheetU.getLastRow() === 0) sheetU.appendRow(['_id_usuario', 'nombre_usuario', 'pin', 'fecha_registro']);
  if (sheetC.getLastRow() === 0) sheetC.appendRow(['fecha', 'categoria', 'alimento', 'kcal', 'proteina', '_id_usuario', '_id_comida', '_timestamp']);
  if (sheetD.getLastRow() === 0) sheetD.appendRow(['fecha', 'entreno', 'peso_kg', '_id_usuario', '_id_diario']);
  if (sheetA.getLastRow() === 0) sheetA.appendRow(['_id_usuario', 'config_json']);

  // Generador de IDs únicos
  const generateUUID = () => Utilities.getUuid() || new Date().getTime().toString() + Math.floor(Math.random()*1000);

  // =============== ENDPOINT: LOGIN / REGISTRO ===============
  if (action === 'login') {
    const username = (e.parameter.user || '').trim().toLowerCase();
    const pin = (e.parameter.pin || '').trim();
    if (!username || !pin) return jsonResponse({ok: false, error: 'Faltan credenciales'});

    const dataU = sheetU.getDataRange().getValues();
    let id_usuario = null;
    let pinValido = false;

    // Buscar usuario
    for (let i = 1; i < dataU.length; i++) {
      if (String(dataU[i][1]).toLowerCase() === username) {
        if (String(dataU[i][2]) === pin) {
          id_usuario = dataU[i][0];
          pinValido = true;
        } else {
          return jsonResponse({ok: false, error: 'PIN incorrecto'});
        }
        break;
      }
    }

    // Si no existe, lo registramos auto
    if (!id_usuario) {
      id_usuario = 'USR-' + generateUUID();
      sheetU.appendRow(['_id_usuario', 'nombre_usuario', 'pin', 'fecha_registro']); // Header auto-recovery in case missing
      sheetU.appendRow([id_usuario, username, pin, new Date()]);
      pinValido = true;
    }

    return jsonResponse({
      ok: true,
      id_usuario: id_usuario,
      nombre: username
    }, e.parameter.callback);
  }

  // A partir de aquí todas las acciones exigen id_usuario (Clave foránea)
  const id_user = e.parameter.id_usuario;
  if (!id_user && action !== 'get') return jsonResponse({ok: false, error: 'Falta Auth'}, e.parameter.callback);

  // =============== ENDPOINTS: LECTURA / ESCRITURA ===============

  if (action === 'add') { // Añadir Comida
    const id_comida = 'LOG-' + generateUUID();
    sheetC.appendRow([
      e.parameter.fecha, e.parameter.categoria, e.parameter.alimento, 
      parseFloat(e.parameter.kcal) || 0, parseFloat(e.parameter.proteina) || 0,
      id_user, id_comida, new Date()
    ]);
  }

  if (action === 'add_entreno' || action === 'remove_entreno' || action === 'add_peso') {
    const data = sheetD.getDataRange().getValues();
    let rowIndex = -1;
    const tzLocal = Session.getScriptTimeZone();
    
    // Buscar fila de ese usuario en esa fecha
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][3]) === String(id_user) && formatDt(data[i][0], tzLocal) === e.parameter.fecha) {
        rowIndex = i + 1;
        break;
      }
    }

    if (rowIndex === -1) {
      const id_diario = 'DIA-' + generateUUID();
      sheetD.appendRow([e.parameter.fecha, "", "", id_user, id_diario]);
      rowIndex = sheetD.getLastRow();
    }

    if (action === 'add_entreno') sheetD.getRange(rowIndex, 2).setValue(1);
    if (action === 'remove_entreno') sheetD.getRange(rowIndex, 2).setValue("");
    if (action === 'add_peso') sheetD.getRange(rowIndex, 3).setValue(parseFloat(e.parameter.peso) || 0);
  }

  if (action === 'save_settings') {
    const data = sheetA.getDataRange().getValues();
    let rowIndex = -1;
    
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]) === String(id_user)) { 
        rowIndex = i + 1;
        break; 
      }
    }

    if (rowIndex !== -1) {
      sheetA.getRange(rowIndex, 2).setValue(e.parameter.valor); 
    } else {
      sheetA.appendRow([id_user, e.parameter.valor]);
    }
  }

  if (action === 'get') {
    if (!id_user) return jsonResponse([]);
    
    const tz = Session.getScriptTimeZone();
    
    // Seleccionar por _id_usuario (ahora en la columna índice 5 para Comidas, y la 3 para Diario)
    const filterComida  = (sheet) => sheet.getLastRow() <= 1 ? [] : sheet.getDataRange().getValues().slice(1).filter(r => String(r[5]) === String(id_user));
    const filterDiario  = (sheet) => sheet.getLastRow() <= 1 ? [] : sheet.getDataRange().getValues().slice(1).filter(r => String(r[3]) === String(id_user));
    const filterAjustes = (sheet) => sheet.getLastRow() <= 1 ? [] : sheet.getDataRange().getValues().slice(1).filter(r => String(r[0]) === String(id_user));

    const comidas = filterComida(sheetC).map(r => ({
      tipo: 'comida', id_log: r[6], fecha: formatDt(r[0], tz),
      categoria: r[1], alimento: r[2], kcal: r[3], proteina: r[4]
    }));
    
    let entrenos = [];
    let pesos = [];
    filterDiario(sheetD).forEach(r => {
      let ft = formatDt(r[0], tz);
      if (r[1] == 1) entrenos.push({ tipo: 'entreno', fecha: ft });
      if (r[2] > 0) pesos.push({ tipo: 'peso', fecha: ft, peso: r[2] });
    });

    const config = filterAjustes(sheetA);
    const ajustes = config.length > 0 ? [{ tipo: 'ajuste', valor: config[0][1] }] : [];

    return jsonResponse([...comidas, ...entrenos, ...pesos, ...ajustes], e.parameter.callback);
  }
  
  return jsonResponse({ok: true}, e.parameter.callback);
}

function formatDt(date, tz) {
  if(!date) return "";
  try { return Utilities.formatDate(new Date(date), tz, 'yyyy-MM-dd'); } catch(e) { return date; }
}

function jsonResponse(data, callbackStr) {
  const jsonStr = JSON.stringify(data);
  if (callbackStr) {
    return ContentService.createTextOutput(callbackStr + '(' + jsonStr + ')').setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(jsonStr).setMimeType(ContentService.MimeType.JSON);
}
