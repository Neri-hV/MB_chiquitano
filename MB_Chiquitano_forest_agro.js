//MapBiomasBolivia  Bioma Chiquitano 1985-2023 Colección 2.0
/*
*@author
* Nerida H. Valero
* @description
* Script para procesar las trayectorias bidireccionales de ganancia y pérdida boscosa 
*/ 
// ==================================================
// IMAGEN MULTIBANDAS BIOMA CHIQUITANO 1985-2023
// ==================================================

// Cargar imagen con acceso verificado
var mbBolivia = ee.Image("projects/mapbiomas-public/assets/bolivia/collection2/mapbiomas_bolivia_collection2_integration_v1");

// Definir AOI Chiquitano
var chiquitano = ee.FeatureCollection('projects/mapbiomas-raisg/BOLIVIA/DATOS_AUXILIARES/ESTADISTICAS/COLECCION1/bioma-pais')
  .filter(ee.Filter.eq('nombre', 'Chiquitano'));
Map.centerObject(chiquitano, 7);
Map.addLayer(chiquitano, {color: 'FF0000'}, 'Chiquitano');

// Crear lista de años como strings
var years = [];
for (var y = 1985; y <= 2023; y++) years.push(y.toString());

// Procesar cada año individualmente
var processYear = function(year) {
  var bandName = 'classification_' + year; // Nombre exacto de banda
  var outputName = 'Y' + year; // Nombre de salida
  
  return mbBolivia
    .select(bandName)
    .clip(chiquitano)
    .rename(outputName);
};
// Aplicar a todos los años
var yearlyImages = years.map(processYear);

// Convertir a ImageCollection y multibanda
var finalImage = ee.ImageCollection(yearlyImages)
  .toBands()
  .rename(years.map(function(y){return 'Y'+y;}));

// Reproject
finalImage = finalImage.reproject({
  crs: 'EPSG:4326',
  scale: 30
});
// VERIFICACIÓN 
print('✅ BANDAS EXPORTADAS:', finalImage.bandNames());
print('✅ ÁREA DE TRABAJO (km²):', chiquitano.geometry().area().divide(1e6));
print('ℹ️ Total de años procesados:', years.length);

//Exportación (editar assetId)
/*Export.image.toAsset({
  image: finalImage,
  description: 'mapbiomas_chiquitano_1985_2023',
  assetId: 'users/neridanadia/MAPBIOMAS/chiquitano_1985_2023_final',
  region: chiquitano.geometry(),
  scale: 30,
  maxPixels: 1e13,
  pyramidingPolicy: {'.default': 'mode'}
});
*/
// ==================================================
// ANALISIS MULTIANUAL CHIQUITANO 1985-2023
// ==================================================

// Cargar imagen multibanda exportada
var img = ee.Image('users/neridanadia/MAPBIOMAS/chiquitano_1985_2023_final');

// Grupos funcionales con sus códigos
var gruposMapBiomas = {
  'toda_formacion_boscosa': {
    codigos: [1, 3, 4, 6],
    color: '#1f8d49'
  },
  'todo_agropecuario': {
    codigos: [14, 15, 18, 21],
    color: '#ffefc3'
  }
};
// ===============================================
// CALCULAR ÁREA MULTIANUAL Y EXPORTAR TABLA
// ===============================================

function calcularSuperficiePorGrupo(grupoNombre, codigos, img, años) {
  var resultados = años.map(function(year) {
   
    // Se debe construir el nombre de la banda usando funciones del servidor de GEE.
    var nombreBanda = ee.String('Y').cat(ee.Number(year).format('%d'));
    var banda = img.select(nombreBanda);
    var mask = banda.remap(codigos, ee.List.repeat(1, codigos.length), 0);
    var area = ee.Image.pixelArea().divide(10000).updateMask(mask);// m² → ha
    //var area = ee.Image.pixelArea().divide(1e6).updateMask(mask);// m² → km²
    var suma = area.reduceRegion({
      reducer: ee.Reducer.sum(),
      geometry: chiquitano.geometry(),
      scale: 30,
      maxPixels: 1e13
    });
    return ee.Feature(null, {
      'año': year,
      'grupo': grupoNombre,
      'area_ha': suma.get('area')
    });
  });
  return ee.FeatureCollection(resultados);
}

var años = ee.List.sequence(1985, 2023);

var fcBoscosa = calcularSuperficiePorGrupo(
  'formacion_boscosa',
  gruposMapBiomas.toda_formacion_boscosa.codigos,
  img, años
);

var fcAgro = calcularSuperficiePorGrupo(
  'agropecuario',
  gruposMapBiomas.todo_agropecuario.codigos,
  img, años
);

var tablaSuperficieFinal = fcBoscosa.merge(fcAgro);

/*Export.table.toDrive({
  collection: tablaSuperficieFinal,
  description: 'superficie_por_grupo_funcional_1985_2023',
  fileFormat: 'CSV'
 });
*/

// ===============================================
// MATRIZ DE TRANSICIONES FROM → TO 
// ===============================================
function calcularTransiciones(fromCodigos, toCodigos, tipoTransicion, periodos) {
  var trayectorias = ee.Image(0).selfMask();
  
  for (var i = 0; i < periodos.length; i++) {
    var inicio = periodos[i][0];
    var fin = periodos[i][1];
    
    var desde = img.select('Y' + inicio).remap(
      fromCodigos,
      ee.List.repeat(1, fromCodigos.length),
      0
    );
    var hacia = img.select('Y' + fin).remap(
      toCodigos,
      ee.List.repeat(1, toCodigos.length),
      0
    );
    
    var transicion = desde.and(hacia).selfMask();
    
    // Crear código único: periodo + tipo de transición
    var codigoPeriodo = inicio * 10000 + fin;
    var codigoTransicion = codigoPeriodo * 10 + tipoTransicion;
    
    var imagenTransicion = ee.Image.constant(codigoTransicion)
      .rename('transicion_codigo') 
      .updateMask(transicion);
    
    trayectorias = trayectorias.blend(imagenTransicion);
  }
  return trayectorias;
}

// Lista de pares de años (inicio, fin)
var periodos = [
  [1985, 1990],
  [1990, 1995],
  [1995, 2000],
  [2000, 2005],
  [2005, 2010],
  [2010, 2015],
  [2015, 2018],
  [2018, 2023]
];

// ===============================================
// CREAR DOS TIPOS DE TRAYECTORIAS 
// ===============================================

var transicionPerdidaBosque = calcularTransiciones(
  gruposMapBiomas.toda_formacion_boscosa.codigos,
  gruposMapBiomas.todo_agropecuario.codigos,
  1, // código 1 = pérdida de bosque
  periodos
);

var transicionGananciaBosque = calcularTransiciones(
  gruposMapBiomas.todo_agropecuario.codigos,
  gruposMapBiomas.toda_formacion_boscosa.codigos,
  2, // código 2 = ganancia de bosque
  periodos
);

// Combinar ambas imágenes 
var transicionesCompletas = transicionPerdidaBosque.blend(transicionGananciaBosque);

// Función para decodifica
function decodificarTransicion(codigo) {
  var tipoTransicion = ee.Number(codigo).mod(10);
  var codigoPeriodo = ee.Number(codigo).divide(10).floor();
  var anoFin = codigoPeriodo.mod(10000);
  var anoInicio = codigoPeriodo.divide(10000).floor();
  
  var tipoTexto = ee.Algorithms.If(
    tipoTransicion.eq(1),
    'bosque_a_agropecuario',
    'agropecuario_a_bosque'
  );
  
  return ee.Dictionary({
    'periodo': ee.String(anoInicio.format('%.0f')).cat('-').cat(ee.String(anoFin.format('%.0f'))),
    'transicion': tipoTexto,
    'ano_inicio': anoInicio.format('%.0f'), // Sin decimales
    'ano_fin': anoFin.format('%.0f')        // Sin decimales
  });
}

// Calcular área por transición 
var areaPorTransicion = ee.Image.pixelArea().divide(10000)
  .addBands(transicionesCompletas.select([0])) // Seleccionar la primera banda
  .reduceRegion({
    reducer: ee.Reducer.sum().group({
      groupField: 1, // banda de transición
      groupName: 'codigo_transicion'
    }),
    geometry: chiquitano.geometry(),
    scale: 30,
    maxPixels: 1e13
  });

// Convertir a tabla exportable 
var tablaTransicionesFinal = ee.FeatureCollection(
  ee.List(areaPorTransicion.get('groups')).map(function(grupo) {
    var codigo = ee.Dictionary(grupo).get('codigo_transicion');
    var area = ee.Number(ee.Dictionary(grupo).get('sum')).format('%.2f');
    
    var info = decodificarTransicion(codigo);
    
    return ee.Feature(null, {
      'periodo': info.get('periodo'),
      'ano_inicio': info.get('ano_inicio'),
      'ano_fin': info.get('ano_fin'),
      'transicion': info.get('transicion'),
      'area_ha': area
    });
  })
);

//Exportar tabla final
/*Export.table.toDrive({
  collection: tablaTransicionesFinal,
  description: 'transiciones_bosque_agro_y_ganancia',
  fileFormat: 'CSV'
});
*/
// Exportar imagen de trayectorias a Assets (editar assetId)
/*Export.image.toAsset({
  image: transicionesCompletas,
  description: 'export_trayectorias_bosque_agro_bidireccional',
  assetId: 'users/neridanadia/MAPBIOMAS/trayectorias_bosque_agro_bidireccional',
  region: chiquitano.geometry(),
  scale: 30,
  maxPixels: 1e13,
  pyramidingPolicy: {'.default': 'mode'}
});
*/
//Exportar imagen de trayectorias al drive
/*Export.image.toDrive({
  image: transicionesCompletas,
  description: 'trayectorias_bosque_agro_bidireccional_tif',
  folder: 'GEE_EXPORT',   
  fileNamePrefix: 'trayectorias_bosque_agro_bidireccional',
  region: chiquitano.geometry(),
  scale: 30,
  crs: 'EPSG:4326',       
  maxPixels: 1e13,
  fileFormat: 'GeoTIFF'
});
*/

//Exportar el AOI Chiquitano como shapefile
/*Export.table.toDrive({
  collection: chiquitano,
  description: 'chiquitano',
  folder: 'GEE_EXPORT',  
  fileFormat: 'SHP'
});
*/

