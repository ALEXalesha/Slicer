// 3MF для тестов: в духе Bambu/Orca/Elegoo (сетки в 3D/Objects, матрицы, модификатор).
'use strict';
const { writeZip } = require('../../src/core/zip');

// Куб 2x2x2 вокруг нуля текстом 3MF.
const CUBE_V = '<vertices><vertex x="1" y="1" z="1"/><vertex x="-1" y="1" z="1"/><vertex x="-1" y="-1" z="1"/><vertex x="1" y="-1" z="1"/>' +
  '<vertex x="1" y="1" z="-1"/><vertex x="-1" y="1" z="-1"/><vertex x="-1" y="-1" z="-1"/><vertex x="1" y="-1" z="-1"/></vertices>';
const CUBE_T = [[0, 1, 2], [0, 2, 3], [4, 6, 5], [4, 7, 6], [0, 4, 5], [0, 5, 1], [1, 5, 6], [1, 6, 2], [2, 6, 7], [2, 7, 3], [3, 7, 4], [3, 4, 0]];
const cubeMesh = (paintFirst = '') => `<mesh>${CUBE_V}<triangles>${CUBE_T.map((t, i) => `<triangle v1="${t[0]}" v2="${t[1]}" v3="${t[2]}"${i < 2 && paintFirst ? ` paint_supports="${paintFirst}"` : ''}/>`).join('')}</triangles></mesh>`;

/** 3MF в духе Bambu/Orca: корень со ссылками на 3D/Objects, модификатор в model_settings. */
function bambuLike({ printable = '1', unit = 'millimeter' } = {}) {
  const root = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="${unit}" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" requiredextensions="p">
 <resources>
  <object id="2" type="model"><components>
   <component p:path="/3D/Objects/Rubik&apos;s part_1.model" objectid="1" transform="1 0 0 0 1 0 0 0 1 0 0 0"/>
   <component p:path="/3D/Objects/Rubik&apos;s part_1.model" objectid="5" transform="1 0 0 0 1 0 0 0 1 0 0 3"/>
  </components></object>
  <object id="4" type="model"><components>
   <component p:path="/3D/Objects/second.model" objectid="3" transform="0 1 0 -1 0 0 0 0 1 0 0 0"/>
  </components></object>
 </resources>
 <build>
  <item objectid="2" transform="25 0 0 0 25 0 0 0 25 128 129 25" printable="${printable}"/>
  <item objectid="4" transform="1 0 0 0 2 0 0 0 3 40 50 3" printable="${printable}"/>
 </build>
</model>`;
  const part = `<?xml version="1.0" encoding="UTF-8"?><model unit="${unit}" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources>
  <object id="1" type="model">${cubeMesh('4')}</object>
  <object id="5" type="model">${cubeMesh()}</object>
 </resources><build/></model>`;
  const second = `<?xml version="1.0" encoding="UTF-8"?><model unit="${unit}" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources>
  <object id="3" type="model">${cubeMesh()}</object></resources><build/></model>`;
  const settings = `<?xml version="1.0" encoding="UTF-8"?><config>
  <object id="2"><metadata key="name" value="Кубик с модификатором"/><part id="1" subtype="normal_part"/><part id="5" subtype="modifier_part"/></object>
  <object id="4"><metadata key="name" value="second.stl"/><part id="3" subtype="normal_part"/></object>
</config>`;
  return writeZip([
    { name: '[Content_Types].xml', data: '<Types/>' },
    { name: '_rels/.rels', data: '<Relationships><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>' },
    { name: '3D/3dmodel.model', data: root },
    { name: "3D/Objects/Rubik's part_1.model", data: part },
    { name: '3D/Objects/second.model', data: second },
    { name: 'Metadata/model_settings.config', data: settings },
  ]);
}

module.exports = { bambuLike };
