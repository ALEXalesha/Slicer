// Каталог настроек «Продвинутого»: раздел, подпись и понятное описание на двух языках,
// тип для проверки ввода. Чистые данные и функции, без Electron и без require: тот же файл
// работает и в Node (module.exports), и в окне (globalThis.SlicerCatalog).
//
// Каждый ключ, который показывает «Продвинутый» для собранных пресетов (0.20mm Standard и
// все 5 филаментов), имеет раздел: ручная запись или правило по имени. Закон в
// tests/core/settings-catalog.test.js. Русские подписи по возможности как в Orca
// (resources/i18n/ru), но проще, где официальное название ничего не объясняет.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SlicerCatalog = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SECTIONS = [
    { id: 'quality', ru: 'Качество и слои', en: 'Quality and layers' },
    { id: 'walls', ru: 'Стенки', en: 'Walls' },
    { id: 'topbottom', ru: 'Верх и низ', en: 'Top and bottom' },
    { id: 'infill', ru: 'Заполнение', en: 'Infill' },
    { id: 'speed', ru: 'Скорость', en: 'Speed' },
    { id: 'accel', ru: 'Ускорения и рывки', en: 'Acceleration and jerk' },
    { id: 'temps', ru: 'Температуры и стол', en: 'Temperatures and bed' },
    { id: 'cooling', ru: 'Охлаждение', en: 'Cooling' },
    { id: 'retract', ru: 'Откат и перемещения', en: 'Retraction and travel' },
    { id: 'support', ru: 'Поддержки', en: 'Supports' },
    { id: 'adhesion', ru: 'Адгезия (кайма, юбка, подложка)', en: 'Adhesion (brim, skirt, raft)' },
    { id: 'special', ru: 'Особые режимы (разглаживание, шероховатость, спираль)', en: 'Special modes (ironing, fuzzy skin, spiral)' },
    { id: 'filament', ru: 'Филамент (поток, PA, объёмный расход, усадка)', en: 'Filament (flow, PA, volumetric speed, shrinkage)' },
    { id: 'other', ru: 'Прочее', en: 'Other' },
  ];
  const SECTION_IDS = SECTIONS.map((s) => s.id);

  const UNITS = {
    mm: ['мм', 'mm'], mms: ['мм/с', 'mm/s'], acc: ['мм/с²', 'mm/s²'], c: ['°C', '°C'], deg: ['°', '°'],
    s: ['с', 's'], mm3s: ['мм³/с', 'mm³/s'], mm2: ['мм²', 'mm²'], mm3: ['мм³', 'mm³'], gcm3: ['г/см³', 'g/cm³'],
    pct: ['%', '%'], layers: ['слоёв', 'layers'], money: ['за кг', 'per kg'],
  };

  // Типы. num: число в [min, max]; int - целое; nil - можно «nil» (как у принтера);
  // pct: [a, b] - можно и процентом в [a, b]. pctOnly: только процент.
  const num = (min, max, unit, o = {}) => Object.assign({ t: 'num', min, max, unit: unit || '' }, o);
  const int = (min, max, unit, o = {}) => num(min, max, unit, Object.assign({ int: true }, o));
  const pct = (min, max, o = {}) => Object.assign({ t: 'pct', min, max, unit: 'pct' }, o);
  const orPct = (min, max, unit, pmin, pmax, o = {}) => num(min, max, unit, Object.assign({ pct: [pmin, pmax] }, o));
  const bool = () => ({ t: 'bool' });
  const text = () => ({ t: 'text' });
  const choice = (opts) => ({ t: 'enum', options: opts.map(([value, ru, en]) => ({ value, ru, en: en || ru })) });
  const NIL = ['nil', 'Как у принтера', 'As the printer'];
  const nilBool = () => choice([NIL, ['1', 'Да', 'Yes'], ['0', 'Нет', 'No']]);

  const SURFACE = [
    ['monotonic', 'Монотонный', 'Monotonic'], ['monotonicline', 'Монотонные линии', 'Monotonic line'],
    ['zig-zag', 'Прямолинейный', 'Rectilinear'], ['alignedrectilinear', 'Выровненный прямолинейный', 'Aligned rectilinear'],
    ['concentric', 'Концентрический', 'Concentric'], ['hilbertcurve', 'Кривая Гильберта', 'Hilbert curve'],
    ['archimedeanchords', 'Хорды Архимеда', 'Archimedean chords'], ['octagramspiral', 'Спираль-октаграмма', 'Octagram spiral'],
  ];
  const INFILL = [
    ['zig-zag', 'Прямолинейный', 'Rectilinear'], ['alignedrectilinear', 'Выровненный прямолинейный', 'Aligned rectilinear'],
    ['grid', 'Сетка', 'Grid'], ['crosshatch', 'Перекрёстная штриховка', 'Cross hatch'], ['gyroid', 'Гироид', 'Gyroid'],
    ['cubic', 'Кубический', 'Cubic'], ['adaptivecubic', 'Адаптивный кубический', 'Adaptive cubic'],
    ['triangles', 'Треугольники', 'Triangles'], ['tri-hexagon', 'Три-гексагон (звёзды)', 'Tri-hexagon'],
    ['honeycomb', 'Соты', 'Honeycomb'], ['3dhoneycomb', '3D-соты', '3D honeycomb'], ['lightning', 'Молния', 'Lightning'],
    ['line', 'Линии', 'Line'], ['concentric', 'Концентрический', 'Concentric'], ['supportcubic', 'Кубический для опоры верха', 'Support cubic'],
    ['hilbertcurve', 'Кривая Гильберта', 'Hilbert curve'], ['archimedeanchords', 'Хорды Архимеда', 'Archimedean chords'],
    ['octagramspiral', 'Спираль-октаграмма', 'Octagram spiral'],
  ];
  const PLATE_LIST = [
    ['Textured PEI Plate', 'Текстурная PEI', 'Textured PEI Plate'], ['High Temp Plate', 'Гладкая PEI / высокотемпературная', 'High Temp Plate'],
    ['Cool Plate', 'Холодная (Cool)', 'Cool Plate'], ['Engineering Plate', 'Инженерная', 'Engineering Plate'],
  ];
  const LW = (ru, en, dru, den) => [orPct(0, 2, 'mm', 0, 300), ru, en, dru, den];

  // [ключ, раздел, тип, подпись ru, подпись en, описание ru, описание en, доп.]
  // доп.: { ro: true } - только показать; { extra: 'process'|'filament', def } - ключа нет в
  // пресете, движок знает его со значением def (сверено по CONFIG_BLOCK в G-code).
  const E = [
    // Качество и слои
    ['layer_height', 'quality', num(0.04, 0.32, 'mm'), 'Высота слоя', 'Layer height',
      'Толщина одного слоя. Меньше - глаже бока и дольше печать, больше - быстрее, но видны ступеньки. Для сопла 0.4 обычно 0.12-0.28 мм.',
      'Thickness of one layer. Smaller gives smoother sides and longer prints, larger is faster but shows steps. For a 0.4 nozzle usually 0.12-0.28 mm.'],
    ['initial_layer_print_height', 'quality', num(0.05, 0.4, 'mm'), 'Высота первого слоя', 'First layer height',
      'Толщина самого первого слоя. Чуть толще обычного (0.2-0.3 мм) - лучше липнет и прощает неровный стол.',
      'Thickness of the very first layer. A bit thicker (0.2-0.3 mm) sticks better and forgives an uneven bed.'],
    ['line_width', 'quality', ...LW('Ширина линии по умолчанию', 'Default line width',
      'Ширина линии там, где своя не задана. Обычно около диаметра сопла: 0.4-0.45 мм. 0 - подобрать самому движку.',
      'Line width where no specific width is set. Usually about the nozzle size: 0.4-0.45 mm. 0 lets the engine choose.')],
    ['initial_layer_line_width', 'quality', ...LW('Ширина линии первого слоя', 'First layer line width',
      'Шире обычной (0.45-0.5 мм) - первый слой сильнее прижимается к столу и лучше держится.',
      'Wider than normal (0.45-0.5 mm) presses the first layer into the bed and helps it hold.')],
    ['outer_wall_line_width', 'quality', ...LW('Ширина внешней стенки', 'Outer wall line width',
      'Ширина видимой снаружи линии. Тоньше - точнее мелкие детали, толще - прочнее стенка.',
      'Width of the visible outer line. Thinner gives finer details, thicker gives a stronger wall.')],
    ['inner_wall_line_width', 'quality', ...LW('Ширина внутренних стенок', 'Inner wall line width',
      'Ширина стенок под внешней. Чуть шире внешней - быстрее и прочнее, снаружи не видно.',
      'Width of the walls under the outer one. Slightly wider than the outer wall is faster and stronger, it is not visible.')],
    ['top_surface_line_width', 'quality', ...LW('Ширина линии верха', 'Top surface line width',
      'Ширина линий верхней поверхности. Тоньше - глаже верх.',
      'Width of the top surface lines. Thinner gives a smoother top.')],
    ['sparse_infill_line_width', 'quality', ...LW('Ширина линии заполнения', 'Infill line width',
      'Ширина линий заполнения внутри модели. Шире - быстрее и прочнее, на вид не влияет.',
      'Width of the infill lines inside the model. Wider is faster and stronger, it does not change the look.')],
    ['internal_solid_infill_line_width', 'quality', ...LW('Ширина сплошного заполнения', 'Solid infill line width',
      'Ширина линий сплошных слоёв внутри модели (под верхом и над низом).',
      'Width of the solid layers inside the model (under the top and above the bottom).')],
    ['support_line_width', 'quality', ...LW('Ширина линии поддержек', 'Support line width',
      'Ширина линий поддержек. Тоньше - поддержки легче отламываются.',
      'Width of the support lines. Thinner supports break away more easily.')],
    ['resolution', 'quality', num(0.0001, 1, 'mm'), 'Упрощение контура', 'Resolution',
      'Детали контура мельче этого значения сглаживаются, чтобы G-code был короче. Обычно не трогать.',
      'Contour details smaller than this are smoothed to keep the G-code short. Usually leave as is.'],
    ['xy_hole_compensation', 'quality', num(-2, 2, 'mm'), 'Поправка размера отверстий', 'Hole size compensation (XY)',
      'Расширяет (плюс) или сужает (минус) отверстия. Если винты не лезут - поставьте 0.05-0.15 мм.',
      'Grows (plus) or shrinks (minus) holes. If screws do not fit, try 0.05-0.15 mm.'],
    ['xy_contour_compensation', 'quality', num(-2, 2, 'mm'), 'Поправка внешнего размера', 'Contour size compensation (XY)',
      'Увеличивает (плюс) или уменьшает (минус) внешний контур модели. Для точной подгонки деталей.',
      'Grows (plus) or shrinks (minus) the outer contour. For an exact fit of parts.'],

    // Стенки
    ['wall_loops', 'walls', int(0, 50), 'Число периметров (стенок)', 'Wall loops',
      'Сколько линий в стенке. Больше - прочнее деталь и дольше печать. 2-3 для обычных вещей, 4-6 для прочных.',
      'How many lines form a wall. More is stronger and slower. 2-3 for normal things, 4-6 for strong parts.'],
    ['wall_generator', 'walls', choice([['classic', 'Классический', 'Classic'], ['arachne', 'Arachne (переменная ширина)', 'Arachne (variable width)']]),
      'Генератор периметров', 'Wall generator',
      'Классический - линии одной ширины. Arachne меняет ширину линий и лучше заполняет тонкие места и мелкий текст.',
      'Classic uses lines of one width. Arachne varies the width and fills thin parts and small text better.'],
    ['wall_sequence', 'walls', choice([['inner wall/outer wall', 'Внутренние, потом внешняя', 'Inner, then outer'],
      ['outer wall/inner wall', 'Внешняя, потом внутренние', 'Outer, then inner'], ['inner-outer-inner wall', 'Внутренняя - внешняя - внутренняя', 'Inner - outer - inner']]),
    'Порядок печати периметров', 'Wall order',
    'Внешняя первой - точнее размеры, но хуже нависания. Внутренние первыми - нависания лучше.',
    'Outer first gives more exact sizes but worse overhangs. Inner first handles overhangs better.'],
    ['wall_infill_order', 'walls', choice([['inner wall/outer wall/infill', 'Внутр. стенки, внешняя, заполнение', 'Inner, outer, infill'],
      ['outer wall/inner wall/infill', 'Внешняя, внутр. стенки, заполнение', 'Outer, inner, infill'],
      ['infill/inner wall/outer wall', 'Заполнение, внутр. стенки, внешняя', 'Infill, inner, outer'],
      ['infill/outer wall/inner wall', 'Заполнение, внешняя, внутр. стенки', 'Infill, outer, inner']]),
    'Порядок стенок и заполнения', 'Wall and infill order',
    'Старое поле пресета: движок переводит его в «Порядок печати периметров». Меняйте ту настройку.',
    'Old preset field: the engine turns it into Wall order. Change that setting instead.', { ro: true }],
    ['precise_outer_wall', 'walls', bool(), 'Точная внешняя стенка', 'Precise outer wall',
      'Ставит внешнюю стенку ровно по контуру модели, размеры получаются точнее.',
      'Places the outer wall exactly on the model contour for more exact sizes.'],
    ['detect_thin_wall', 'walls', bool(), 'Искать тонкие стенки', 'Detect thin walls',
      'Печатает одной линией стенки, в которые не влезают две. Помогает тонким деталям не пропасть.',
      'Prints walls too thin for two lines as a single line, so thin details do not disappear.'],
    ['detect_overhang_wall', 'walls', bool(), 'Искать нависающие стенки', 'Detect overhang walls',
      'Находит стенки, висящие в воздухе, и печатает их медленнее, с обдувом.',
      'Finds walls hanging in the air and prints them slower with cooling.'],
    ['extra_perimeters_on_overhangs', 'walls', bool(), 'Доп. периметры на нависаниях', 'Extra perimeters on overhangs',
      'Добавляет стенки под крутыми нависаниями, чтобы они меньше провисали.',
      'Adds walls under steep overhangs so they sag less.'],
    ['only_one_wall_top', 'walls', bool(), 'Один периметр на верхней поверхности', 'Only one wall on top surfaces',
      'На верху модели одна стенка вместо всех: больше места для красивого верхнего слоя.',
      'Uses a single wall on top surfaces to leave more room for a nice top layer.'],
    ['min_width_top_surface', 'walls', orPct(0, 100, 'mm', 0, 1000), 'Порог одного периметра', 'One wall threshold',
      'Верх уже этого размера печатается одной стенкой. Процент - от ширины линии.',
      'Tops narrower than this get one wall. A percent is of the line width.'],
    ['ensure_vertical_shell_thickness', 'walls', choice([['ensure_all', 'Везде', 'Everywhere'], ['ensure_moderate', 'Умеренно', 'Moderate'],
      ['ensure_critical_only', 'Только в важных местах', 'Critical only'], ['none', 'Нет', 'None']]),
    'Держать толщину боковой оболочки', 'Ensure vertical shell thickness',
    'Добавляет сплошное заполнение у наклонных стенок, чтобы они не просвечивали. «Везде» надёжнее, «Нет» быстрее.',
    'Adds solid infill near sloped walls so they do not show gaps. Everywhere is safer, None is faster.'],
    ['seam_position', 'walls', choice([['aligned', 'Выровненный', 'Aligned'], ['nearest', 'Ближайший', 'Nearest'], ['back', 'Сзади', 'Back'],
      ['aligned_back', 'Выровненный сзади', 'Aligned back'], ['random', 'Случайный', 'Random']]),
    'Позиция шва', 'Seam position',
    'Где начинается каждый круг стенки: там остаётся шов. «Сзади» прячет его на задней стороне, «Случайный» размазывает по всей модели.',
    'Where each wall loop starts and leaves a seam. Back hides it at the back, Random spreads it over the model.'],
    ['staggered_inner_seams', 'walls', bool(), 'Смещать внутренние швы', 'Staggered inner seams',
      'Сдвигает швы внутренних стенок друг относительно друга, чтобы шов не проступал наружу.',
      'Shifts the seams of inner walls so the seam does not show through.'],
    ['seam_slope_type', 'walls', choice([['none', 'Нет', 'None'], ['external', 'Только внешний контур', 'Outer contour only'], ['all', 'Все контуры', 'All contours']]),
      'Клиновидный шов', 'Scarf joint seam',
      'Начинает и заканчивает круг стенки плавным клином, шов становится почти незаметным. Печать чуть дольше.',
      'Starts and ends each loop with a gentle slope so the seam almost disappears. Slightly slower.'],
    ['seam_slope_conditional', 'walls', bool(), 'Клин только где нужно', 'Conditional scarf joint',
      'Делает клиновидный шов только на гладких кривых контурах, где обычный шов заметен.',
      'Uses the scarf joint only on smooth curved contours where a normal seam shows.'],
    ['seam_slope_min_length', 'walls', num(0, 100, 'mm'), 'Длина клиновидного шва', 'Scarf length',
      'Длина клина шва. 0 - подобрать самому движку.',
      'Length of the scarf. 0 lets the engine choose.'],
    ['seam_slope_inner_walls', 'walls', bool(), 'Клиновидный шов на внутренних стенках', 'Scarf joint on inner walls',
      'Тот же клин и на внутренних стенках. Чуть дольше, на вид почти не влияет.',
      'The same scarf on inner walls. Slightly slower, barely changes the look.'],
    ['seam_gap', 'walls', orPct(0, 10, 'mm', 0, 100), 'Зазор шва', 'Seam gap',
      'Насколько раньше закрывается круг стенки. Если на шве бугорок - увеличьте.',
      'How early a wall loop stops before its start. Increase it if the seam has a bump.', { extra: 'process', def: '10%' }],
    ['wall_direction', 'walls', choice([['ccw', 'Против часовой', 'Counter clockwise'], ['cw', 'По часовой', 'Clockwise']]),
      'Направление обхода стенок', 'Wall direction',
      'В какую сторону печатаются стенки. Обычно не важно.',
      'Which way the walls are printed. Usually it does not matter.', { extra: 'process', def: 'ccw' }],
    ['alternate_extra_wall', 'walls', bool(), 'Чередующаяся доп. стенка', 'Alternate extra wall',
      'Через слой добавляет ещё одну стенку: прочнее связь стенок с заполнением.',
      'Adds one more wall every other layer for a stronger bond between walls and infill.', { extra: 'process', def: '0' }],
    ['only_one_wall_first_layer', 'walls', bool(), 'Один периметр на первом слое', 'One wall on first layer',
      'На первом слое одна стенка, остальное - заполнение. Иногда помогает ровному первому слою.',
      'One wall on the first layer, the rest is infill. Sometimes helps an even first layer.', { extra: 'process', def: '0' }],
    ['overhang_reverse', 'walls', bool(), 'Реверс на чётных слоях', 'Reverse on even layers',
      'Меняет направление стенок на нависаниях через слой, нависания меньше загибаются вверх.',
      'Reverses wall direction on overhangs every other layer so they curl up less.', { extra: 'process', def: '0' }],

    // Верх и низ
    ['top_shell_layers', 'topbottom', int(0, 100, 'layers'), 'Сплошных слоёв сверху', 'Top layers',
      'Сколько сплошных слоёв закрывает модель сверху. Мало - через верх видно заполнение. Обычно 4-6.',
      'How many solid layers close the top. Too few and the infill shows through. Usually 4-6.'],
    ['top_shell_thickness', 'topbottom', num(0, 10, 'mm'), 'Толщина верха не меньше', 'Minimum top thickness',
      'Если слоёв сверху мало для этой толщины, движок добавит ещё. 0 - смотреть только на число слоёв.',
      'If the top layers are too few for this thickness, the engine adds more. 0 uses only the layer count.'],
    ['bottom_shell_layers', 'topbottom', int(0, 100, 'layers'), 'Сплошных слоёв снизу', 'Bottom layers',
      'Сколько сплошных слоёв в дне модели. Обычно 3-4.',
      'How many solid layers form the bottom. Usually 3-4.'],
    ['bottom_shell_thickness', 'topbottom', num(0, 10, 'mm'), 'Толщина дна не меньше', 'Minimum bottom thickness',
      'Если слоёв снизу мало для этой толщины, движок добавит ещё. 0 - смотреть только на число слоёв.',
      'If the bottom layers are too few for this thickness, the engine adds more. 0 uses only the layer count.'],
    ['top_surface_pattern', 'topbottom', choice(SURFACE), 'Узор верхней поверхности', 'Top surface pattern',
      'Как уложены линии на самом верху. «Монотонный» даёт самый ровный блеск.',
      'How the lines are laid on the very top. Monotonic gives the most even shine.'],
    ['bottom_surface_pattern', 'topbottom', choice(SURFACE), 'Узор нижней поверхности', 'Bottom surface pattern',
      'Как уложены линии в дне модели, которое лежит на столе.',
      'How the lines are laid on the bottom that sits on the bed.'],
    ['internal_solid_infill_pattern', 'topbottom', choice(SURFACE), 'Узор сплошного заполнения', 'Solid infill pattern',
      'Узор сплошных слоёв внутри модели. Снаружи не видно.',
      'Pattern of solid layers inside the model. Not visible from outside.', { extra: 'process', def: 'monotonic' }],
    ['top_bottom_infill_wall_overlap', 'topbottom', pct(0, 100), 'Перекрытие верха и низа со стенкой', 'Top/bottom overlap with walls',
      'Насколько сплошные слои заходят на стенку. Больше - нет щелей по краю верха.',
      'How far solid layers overlap the walls. More closes gaps at the edge of the top.'],

    // Заполнение
    ['sparse_infill_density', 'infill', pct(0, 100), 'Плотность заполнения', 'Infill density',
      'Сколько пластика внутри. 10-20 % для фигурок, 30-50 % для нагруженных деталей, 100 % - сплошная.',
      'How much plastic is inside. 10-20 % for figures, 30-50 % for loaded parts, 100 % is solid.'],
    ['sparse_infill_pattern', 'infill', choice(INFILL), 'Узор заполнения', 'Infill pattern',
      'Форма решётки внутри. Гироид и кубический прочны во все стороны, «Молния» самая быстрая (только держит верх).',
      'Shape of the inner lattice. Gyroid and cubic are strong in all directions, Lightning is fastest (only holds the top).'],
    ['infill_direction', 'infill', num(0, 360, 'deg'), 'Угол заполнения', 'Infill direction',
      'Под каким углом идут линии заполнения. Обычно 45°.',
      'Angle of the infill lines. Usually 45°.'],
    ['infill_anchor', 'infill', orPct(0, 1000, 'mm', 0, 1000), 'Якорь заполнения', 'Infill anchor length',
      'Насколько линия заполнения цепляется за стенку. Процент - от ширины линии. 0 - без якоря.',
      'How far an infill line hooks onto the wall. A percent is of the line width. 0 means no anchor.'],
    ['infill_anchor_max', 'infill', orPct(0, 1000, 'mm', 0, 1000), 'Наибольший якорь заполнения', 'Maximum infill anchor',
      'Верхний предел длины якоря заполнения.',
      'Upper limit for the infill anchor length.'],
    ['infill_combination', 'infill', bool(), 'Заполнение через слой', 'Infill combination',
      'Печатает заполнение толще, раз в несколько слоёв. Быстрее, прочность почти та же.',
      'Prints infill thicker every few layers. Faster with almost the same strength.'],
    ['infill_wall_overlap', 'infill', pct(0, 100), 'Перекрытие заполнения со стенкой', 'Infill/wall overlap',
      'Насколько заполнение заходит на стенку. Больше - прочнее связь, но может проступать на стенке.',
      'How far infill overlaps the wall. More is a stronger bond but may show on the wall.'],
    ['minimum_sparse_infill_area', 'infill', num(0, 10000, 'mm2'), 'Малые области - сплошными', 'Minimum sparse infill area',
      'Области заполнения меньше этой площади печатаются сплошными: так мелкие части прочнее.',
      'Infill areas smaller than this are printed solid so small parts get stronger.'],
    ['detect_narrow_internal_solid_infill', 'infill', bool(), 'Узкое сплошное - концентрически', 'Detect narrow solid infill',
      'Узкие полоски сплошного заполнения печатает по кругу: меньше рывков и лучше качество.',
      'Prints narrow strips of solid infill as loops: fewer jerks and better quality.'],
    ['filter_out_gap_fill', 'infill', num(0, 10, 'mm'), 'Не заполнять щели меньше', 'Filter out tiny gaps',
      'Щели короче этого не заполняются. Меньше рывков и времени, мелкие щели почти не видны.',
      'Gaps shorter than this are not filled. Fewer jerks and less time, tiny gaps are barely visible.'],
    ['gap_fill_target', 'infill', choice([['everywhere', 'Везде', 'Everywhere'], ['topbottom', 'Только верх и низ', 'Top and bottom only'], ['nowhere', 'Нигде', 'Nowhere']]),
      'Где заполнять щели', 'Apply gap fill',
      'Где закрывать узкие щели между стенками. «Нигде» быстрее, но могут остаться дырочки.',
      'Where narrow gaps between walls are filled. Nowhere is faster but may leave small holes.'],
    ['bridge_flow', 'infill', num(0.1, 2), 'Поток на мостах', 'Bridge flow ratio',
      'Сколько пластика на мостах (линиях над пустотой). Меньше 1 - мосты меньше провисают.',
      'How much plastic goes into bridges over empty space. Below 1 bridges sag less.'],
    ['internal_bridge_flow', 'infill', num(0.1, 2), 'Поток внутренних мостов', 'Internal bridge flow ratio',
      'То же для мостов внутри модели, над заполнением.',
      'The same for bridges inside the model, over the infill.'],

    // Скорость
    ['outer_wall_speed', 'speed', num(1, 1000, 'mms'), 'Скорость внешней стенки', 'Outer wall speed',
      'Скорость видимой стенки. Медленнее - чище поверхность. Сильнее всего влияет на вид.',
      'Speed of the visible wall. Slower gives a cleaner surface. It affects the look most.'],
    ['inner_wall_speed', 'speed', num(1, 1000, 'mms'), 'Скорость внутренних стенок', 'Inner wall speed',
      'Скорость стенок, которые не видно. Можно быстрее внешней.',
      'Speed of the hidden walls. Can be faster than the outer wall.'],
    ['sparse_infill_speed', 'speed', num(1, 1000, 'mms'), 'Скорость заполнения', 'Infill speed',
      'Скорость печати решётки внутри. Ограничена ещё и предельным расходом филамента.',
      'Speed of the inner lattice. Also limited by the filament max volumetric speed.'],
    ['internal_solid_infill_speed', 'speed', num(1, 1000, 'mms'), 'Скорость сплошного заполнения', 'Solid infill speed',
      'Скорость сплошных слоёв внутри модели.',
      'Speed of the solid layers inside the model.'],
    ['top_surface_speed', 'speed', num(1, 1000, 'mms'), 'Скорость верхней поверхности', 'Top surface speed',
      'Скорость самого верхнего слоя. Медленнее - глаже верх.',
      'Speed of the very top layer. Slower gives a smoother top.'],
    ['gap_infill_speed', 'speed', num(1, 1000, 'mms'), 'Скорость заполнения щелей', 'Gap fill speed',
      'Скорость заполнения узких щелей.',
      'Speed for filling narrow gaps.'],
    ['support_speed', 'speed', num(1, 1000, 'mms'), 'Скорость поддержек', 'Support speed',
      'Скорость печати поддержек.',
      'Speed of the supports.'],
    ['support_interface_speed', 'speed', num(1, 1000, 'mms'), 'Скорость связующего слоя поддержек', 'Support interface speed',
      'Скорость слоя поддержки, на котором лежит модель. Медленнее - аккуратнее низ модели.',
      'Speed of the support layer the model sits on. Slower gives a neater underside.'],
    ['bridge_speed', 'speed', num(1, 1000, 'mms'), 'Скорость мостов', 'Bridge speed',
      'Скорость линий над пустотой. Медленнее - успевают остыть и меньше провисают.',
      'Speed of lines over empty space. Slower lets them cool and sag less.'],
    ['travel_speed', 'speed', num(1, 1000, 'mms'), 'Скорость перемещений', 'Travel speed',
      'Скорость холостых переходов без печати. Быстрее - меньше ниток.',
      'Speed of moves without printing. Faster leaves fewer strings.'],
    ['initial_layer_speed', 'speed', num(1, 500, 'mms'), 'Скорость первого слоя', 'First layer speed',
      'Скорость стенок первого слоя. Медленнее - лучше прилипает.',
      'Speed of the first layer walls. Slower sticks better.'],
    ['initial_layer_infill_speed', 'speed', num(1, 500, 'mms'), 'Скорость заполнения первого слоя', 'First layer infill speed',
      'Скорость сплошного заполнения первого слоя.',
      'Speed of the solid infill on the first layer.'],
    ['overhang_1_4_speed', 'speed', orPct(0, 1000, 'mms', 0, 100), 'Нависание 10-25 %', 'Overhang 10-25 %',
      'Скорость стенки, нависающей на 10-25 % ширины линии. 0 - не замедлять.',
      'Speed of a wall that overhangs by 10-25 % of the line width. 0 means no slowdown.'],
    ['overhang_2_4_speed', 'speed', orPct(0, 1000, 'mms', 0, 100), 'Нависание 25-50 %', 'Overhang 25-50 %',
      'Скорость стенки, нависающей на 25-50 % ширины линии. 0 - не замедлять.',
      'Speed of a wall that overhangs by 25-50 % of the line width. 0 means no slowdown.'],
    ['overhang_3_4_speed', 'speed', orPct(0, 1000, 'mms', 0, 100), 'Нависание 50-75 %', 'Overhang 50-75 %',
      'Скорость стенки, нависающей на 50-75 % ширины линии. 0 - не замедлять.',
      'Speed of a wall that overhangs by 50-75 % of the line width. 0 means no slowdown.'],
    ['overhang_4_4_speed', 'speed', orPct(0, 1000, 'mms', 0, 100), 'Нависание 75-100 %', 'Overhang 75-100 %',
      'Скорость стенки, почти целиком висящей в воздухе. 0 - не замедлять.',
      'Speed of a wall hanging almost fully in the air. 0 means no slowdown.'],
    ['overhang_speed_classic', 'speed', bool(), 'Классическое замедление нависаний', 'Classic overhang slowdown',
      'Старый способ считать скорость на нависаниях. Обычно не трогать.',
      'The old way to compute overhang speed. Usually leave as is.'],
    ['enable_overhang_speed', 'speed', bool(), 'Замедляться на нависаниях', 'Slow down on overhangs',
      'Включает скорости нависаний выше. Выключите - нависания пойдут на обычной скорости.',
      'Turns on the overhang speeds above. Off prints overhangs at normal speed.', { extra: 'process', def: '1' }],
    ['small_perimeter_speed', 'speed', orPct(0, 1000, 'mms', 0, 100), 'Скорость маленьких периметров', 'Small perimeter speed',
      'Скорость маленьких кругов (отверстия, тонкие столбики). Процент - от скорости внешней стенки.',
      'Speed of small loops (holes, thin pillars). A percent is of the outer wall speed.', { extra: 'process', def: '50%' }],
    ['internal_bridge_speed', 'speed', orPct(0, 1000, 'mms', 0, 1000), 'Скорость внутренних мостов', 'Internal bridge speed',
      'Скорость мостов внутри модели. Процент - от скорости мостов.',
      'Speed of bridges inside the model. A percent is of the bridge speed.', { extra: 'process', def: '150%' }],
    ['skirt_speed', 'speed', num(0, 1000, 'mms'), 'Скорость юбки', 'Skirt speed',
      'Скорость юбки вокруг модели. 0 - как первый слой.',
      'Speed of the skirt around the model. 0 uses the first layer speed.', { extra: 'process', def: '50' }],
    ['initial_layer_travel_speed', 'speed', orPct(0, 1000, 'mms', 0, 100), 'Перемещения на первом слое', 'First layer travel speed',
      'Скорость холостых ходов на первом слое. Процент - от обычной скорости перемещений.',
      'Speed of moves on the first layer. A percent is of the normal travel speed.', { extra: 'process', def: '100%' }],

    // Ускорения и рывки
    ['default_acceleration', 'accel', num(0, 50000, 'acc'), 'Ускорение по умолчанию', 'Default acceleration',
      'Ускорение там, где своё не задано. Меньше - тише и ровнее, больше - быстрее.',
      'Acceleration where no specific one is set. Lower is quieter and smoother, higher is faster.'],
    ['outer_wall_acceleration', 'accel', num(0, 50000, 'acc'), 'Ускорение внешней стенки', 'Outer wall acceleration',
      'Меньше - меньше ряби (звона) на видимой стенке. 0 - как по умолчанию.',
      'Lower reduces ringing on the visible wall. 0 uses the default.'],
    ['inner_wall_acceleration', 'accel', num(0, 50000, 'acc'), 'Ускорение внутренних стенок', 'Inner wall acceleration',
      'Ускорение скрытых стенок. 0 - как по умолчанию.',
      'Acceleration of hidden walls. 0 uses the default.'],
    ['top_surface_acceleration', 'accel', num(0, 50000, 'acc'), 'Ускорение верхней поверхности', 'Top surface acceleration',
      'Меньше - ровнее верх. 0 - как по умолчанию.',
      'Lower gives a smoother top. 0 uses the default.'],
    ['initial_layer_acceleration', 'accel', num(0, 50000, 'acc'), 'Ускорение первого слоя', 'First layer acceleration',
      'Небольшое ускорение не даёт первому слою отрываться от стола.',
      'A low value keeps the first layer from tearing off the bed.'],
    ['travel_acceleration', 'accel', num(0, 50000, 'acc'), 'Ускорение перемещений', 'Travel acceleration',
      'Ускорение холостых ходов. 0 - как по умолчанию.',
      'Acceleration of moves without printing. 0 uses the default.'],
    ['accel_to_decel_enable', 'accel', bool(), 'Ограничить торможение', 'Limit accel to decel',
      'Ограничивает торможение в зигзагах (настройка Klipper). Меньше рывков на коротких линиях.',
      'Limits deceleration in zigzags (Klipper setting). Fewer jerks on short lines.'],
    ['accel_to_decel_factor', 'accel', pct(0, 100), 'Доля торможения', 'Accel to decel factor',
      'Торможение в процентах от ускорения, если ограничение включено.',
      'Deceleration as a percent of acceleration when the limit is on.', { extra: 'process', def: '50%' }],
    ['bridge_acceleration', 'accel', orPct(0, 50000, 'acc', 0, 1000), 'Ускорение мостов', 'Bridge acceleration',
      'Ускорение на мостах. Процент - от ускорения внешней стенки.',
      'Acceleration on bridges. A percent is of the outer wall acceleration.', { extra: 'process', def: '50%' }],
    ['sparse_infill_acceleration', 'accel', orPct(0, 50000, 'acc', 0, 1000), 'Ускорение заполнения', 'Infill acceleration',
      'Ускорение решётки внутри. Процент - от ускорения по умолчанию.',
      'Acceleration of the inner lattice. A percent is of the default acceleration.', { extra: 'process', def: '100%' }],
    ['internal_solid_infill_acceleration', 'accel', orPct(0, 50000, 'acc', 0, 1000), 'Ускорение сплошного заполнения', 'Solid infill acceleration',
      'Ускорение сплошных слоёв внутри. Процент - от ускорения по умолчанию.',
      'Acceleration of solid layers inside. A percent is of the default acceleration.', { extra: 'process', def: '100%' }],
    ['default_jerk', 'accel', num(0, 100, 'mms'), 'Рывок по умолчанию', 'Default jerk',
      'Скорость, с которой голова проходит углы без торможения. 0 - не писать рывки в G-code (решает принтер).',
      'Speed at which the head takes corners without braking. 0 leaves it to the printer.', { extra: 'process', def: '0' }],
    ['outer_wall_jerk', 'accel', num(0, 100, 'mms'), 'Рывок внешней стенки', 'Outer wall jerk',
      'Работает, только если рывок по умолчанию не 0. Меньше - аккуратнее углы.',
      'Works only when the default jerk is not 0. Lower gives neater corners.', { extra: 'process', def: '9' }],
    ['inner_wall_jerk', 'accel', num(0, 100, 'mms'), 'Рывок внутренних стенок', 'Inner wall jerk',
      'Работает, только если рывок по умолчанию не 0.',
      'Works only when the default jerk is not 0.', { extra: 'process', def: '9' }],
    ['infill_jerk', 'accel', num(0, 100, 'mms'), 'Рывок заполнения', 'Infill jerk',
      'Работает, только если рывок по умолчанию не 0.',
      'Works only when the default jerk is not 0.', { extra: 'process', def: '9' }],
    ['top_surface_jerk', 'accel', num(0, 100, 'mms'), 'Рывок верхней поверхности', 'Top surface jerk',
      'Работает, только если рывок по умолчанию не 0.',
      'Works only when the default jerk is not 0.', { extra: 'process', def: '9' }],
    ['initial_layer_jerk', 'accel', num(0, 100, 'mms'), 'Рывок первого слоя', 'First layer jerk',
      'Работает, только если рывок по умолчанию не 0.',
      'Works only when the default jerk is not 0.', { extra: 'process', def: '9' }],
    ['travel_jerk', 'accel', num(0, 100, 'mms'), 'Рывок перемещений', 'Travel jerk',
      'Работает, только если рывок по умолчанию не 0.',
      'Works only when the default jerk is not 0.', { extra: 'process', def: '12' }],

    // Температуры и стол (филамент)
    ['nozzle_temperature', 'temps', int(150, 350, 'c'), 'Температура сопла', 'Nozzle temperature',
      'Температура сопла со второго слоя. Слои плохо слипаются - выше, тянутся нитки - ниже. Шаг 5 °C.',
      'Nozzle temperature from the second layer on. Layers do not bond - go higher, strings - go lower. Step 5 °C.'],
    ['nozzle_temperature_initial_layer', 'temps', int(150, 350, 'c'), 'Сопло на первом слое', 'Nozzle on first layer',
      'Температура сопла на первом слое. На 5 °C выше обычной помогает прилипанию.',
      'Nozzle temperature on the first layer. 5 °C above normal helps adhesion.'],
    ['nozzle_temperature_range_low', 'temps', int(0, 400, 'c'), 'Рекомендуемая температура: от', 'Recommended temperature: from',
      'Нижняя граница рекомендуемой температуры. Только для справки и предупреждений, на печать не влияет.',
      'Lower end of the recommended range. Only for reference and warnings, it does not change the print.'],
    ['nozzle_temperature_range_high', 'temps', int(0, 400, 'c'), 'Рекомендуемая температура: до', 'Recommended temperature: to',
      'Верхняя граница рекомендуемой температуры. Только для справки и предупреждений.',
      'Upper end of the recommended range. Only for reference and warnings.'],
    ['textured_plate_temp', 'temps', int(0, 120, 'c'), 'Стол: текстурная PEI', 'Bed: textured PEI',
      'Температура стола с текстурной пластиной PEI (та, что идёт с принтером). PLA 55-65, PETG 70-80.',
      'Bed temperature for the textured PEI plate (the stock one). PLA 55-65, PETG 70-80.'],
    ['textured_plate_temp_initial_layer', 'temps', int(0, 120, 'c'), 'Стол: текстурная PEI, первый слой', 'Bed: textured PEI, first layer',
      'Температура стола на первом слое для текстурной пластины.',
      'Bed temperature on the first layer for the textured plate.'],
    ['hot_plate_temp', 'temps', int(0, 120, 'c'), 'Стол: гладкая PEI', 'Bed: smooth PEI / high temp',
      'Температура стола с гладкой PEI или высокотемпературной пластиной.',
      'Bed temperature for the smooth PEI or high temp plate.'],
    ['hot_plate_temp_initial_layer', 'temps', int(0, 120, 'c'), 'Стол: гладкая PEI, первый слой', 'Bed: smooth PEI, first layer',
      'Температура стола на первом слое для гладкой пластины.',
      'Bed temperature on the first layer for the smooth plate.'],
    ['cool_plate_temp', 'temps', int(0, 120, 'c'), 'Стол: холодная пластина', 'Bed: cool plate',
      'Температура стола с холодной пластиной (Cool Plate). 0 - филамент с ней не печатают.',
      'Bed temperature for the cool plate. 0 means the filament is not used with it.'],
    ['cool_plate_temp_initial_layer', 'temps', int(0, 120, 'c'), 'Стол: холодная, первый слой', 'Bed: cool plate, first layer',
      'Температура стола на первом слое для холодной пластины.',
      'Bed temperature on the first layer for the cool plate.'],
    ['eng_plate_temp', 'temps', int(0, 120, 'c'), 'Стол: инженерная пластина', 'Bed: engineering plate',
      'Температура стола с инженерной пластиной. 0 - филамент с ней не печатают.',
      'Bed temperature for the engineering plate. 0 means the filament is not used with it.'],
    ['eng_plate_temp_initial_layer', 'temps', int(0, 120, 'c'), 'Стол: инженерная, первый слой', 'Bed: engineering, first layer',
      'Температура стола на первом слое для инженерной пластины.',
      'Bed temperature on the first layer for the engineering plate.'],
    ['supertack_plate_temp', 'temps', int(0, 120, 'c'), 'Стол: SuperTack', 'Bed: SuperTack plate',
      'Температура стола с пластиной SuperTack (в программе её нет в выборе, для полноты).',
      'Bed temperature for the SuperTack plate (not offered in this program, kept for completeness).'],
    ['supertack_plate_temp_initial_layer', 'temps', int(0, 120, 'c'), 'Стол: SuperTack, первый слой', 'Bed: SuperTack, first layer',
      'Температура стола на первом слое для пластины SuperTack.',
      'Bed temperature on the first layer for the SuperTack plate.'],
    ['textured_cool_plate_temp', 'temps', int(0, 120, 'c'), 'Стол: текстурная холодная', 'Bed: textured cool plate',
      'Температура стола с текстурной холодной пластиной (в программе её нет в выборе).',
      'Bed temperature for the textured cool plate (not offered in this program).'],
    ['textured_cool_plate_temp_initial_layer', 'temps', int(0, 120, 'c'), 'Стол: текстурная холодная, первый слой', 'Bed: textured cool, first layer',
      'Температура стола на первом слое для текстурной холодной пластины.',
      'Bed temperature on the first layer for the textured cool plate.'],
    ['chamber_temperatures', 'temps', int(0, 80, 'c'), 'Температура в камере', 'Chamber temperature',
      'Желаемая температура в камере. У Centauri Carbon нет нагревателя камеры, это только справка.',
      'Wanted chamber temperature. Centauri Carbon has no chamber heater, this is for reference.'],
    ['temperature_vitrification', 'temps', int(0, 400, 'c'), 'Температура размягчения', 'Softening temperature',
      'При какой температуре филамент мягчеет. Движок по ней решает, когда открыть крышку и включить обдув.',
      'Temperature where the filament softens. The engine uses it to decide on lid and fan advice.'],

    // Охлаждение (филамент)
    ['fan_min_speed', 'cooling', int(0, 100, 'pct'), 'Обдув: минимум', 'Fan: minimum',
      'Скорость обдува модели на обычных слоях. Для PLA высокая, для PETG/ABS низкая.',
      'Part fan speed on normal layers. High for PLA, low for PETG/ABS.'],
    ['fan_max_speed', 'cooling', int(0, 100, 'pct'), 'Обдув: максимум', 'Fan: maximum',
      'Скорость обдува на быстрых маленьких слоях, которым нужно успеть остыть.',
      'Fan speed on quick small layers that need to cool down in time.'],
    ['fan_cooling_layer_time', 'cooling', num(0, 1000, 's'), 'Время слоя для полного обдува', 'Layer time for full fan',
      'Если слой печатается быстрее этого времени, обдув растёт от минимума к максимуму.',
      'If a layer prints faster than this, the fan rises from minimum toward maximum.'],
    ['close_fan_the_first_x_layers', 'cooling', int(0, 1000, 'layers'), 'Без обдува первых слоёв', 'No fan for first layers',
      'Сколько первых слоёв печатать без обдува, чтобы они лучше прилипли.',
      'How many first layers print without the fan so they stick better.'],
    ['full_fan_speed_layer', 'cooling', int(0, 1000, 'layers'), 'Полный обдув с слоя', 'Full fan from layer',
      'Обдув плавно растёт и становится полным на этом слое. 0 - сразу после слоёв без обдува.',
      'The fan ramps up and reaches full speed at this layer. 0 means right after the no-fan layers.'],
    ['overhang_fan_speed', 'cooling', int(0, 100, 'pct'), 'Обдув нависаний и мостов', 'Overhang and bridge fan',
      'Скорость обдува на нависаниях и мостах.',
      'Fan speed on overhangs and bridges.'],
    ['overhang_fan_threshold', 'cooling', choice([['0%', '0 % (везде)', '0 % (everywhere)'], ['10%', '10 %'], ['25%', '25 %'], ['50%', '50 %'], ['75%', '75 %'], ['95%', '95 %']]),
      'Порог нависания для обдува', 'Overhang fan threshold',
      'С какого нависания (в % ширины линии) включается обдув нависаний.',
      'From which overhang (in % of line width) the overhang fan turns on.'],
    ['enable_overhang_bridge_fan', 'cooling', bool(), 'Обдув нависаний и мостов', 'Force fan on overhangs',
      'Включает отдельный обдув на нависаниях и мостах.',
      'Turns on the separate fan for overhangs and bridges.'],
    ['slow_down_for_layer_cooling', 'cooling', bool(), 'Замедлять маленькие слои', 'Slow down for cooling',
      'Если слой слишком быстрый, печать замедляется, чтобы он успел остыть. Спасает тонкие верхушки.',
      'If a layer is too fast, printing slows down so it can cool. Saves thin tips.'],
    ['slow_down_layer_time', 'cooling', num(0, 1000, 's'), 'Минимальное время слоя', 'Minimum layer time',
      'Слой не печатается быстрее этого времени (если замедление включено).',
      'A layer is never printed faster than this (when slowdown is on).'],
    ['slow_down_min_speed', 'cooling', num(0, 1000, 'mms'), 'Самая низкая скорость при замедлении', 'Minimum print speed',
      'Ниже этой скорости замедление не опускается.',
      'Slowdown never goes below this speed.'],
    ['reduce_fan_stop_start_freq', 'cooling', bool(), 'Вентилятор не выключать', 'Keep fan always on',
      'Обдув не останавливается полностью между слоями, работает хотя бы на минимуме.',
      'The fan does not stop between layers and runs at least at the minimum.'],
    ['additional_cooling_fan_speed', 'cooling', int(0, 100, 'pct'), 'Боковой вентилятор', 'Auxiliary fan',
      'Скорость бокового вентилятора модели. Для PLA помогает на нависаниях, для ABS/ASA - 0.',
      'Side part fan speed. Helps PLA overhangs, keep 0 for ABS/ASA.'],
    ['activate_air_filtration', 'cooling', bool(), 'Вытяжной вентилятор', 'Exhaust fan',
      'Включает вытяжку камеры. Нужна для ABS/ASA (запах), вредна для них же, если сильная во время печати.',
      'Turns on the chamber exhaust. Useful for ABS/ASA smell, but strong exhaust during the print cools them too much.'],
    ['during_print_exhaust_fan_speed', 'cooling', int(0, 100, 'pct'), 'Вытяжка во время печати', 'Exhaust during print',
      'Скорость вытяжки во время печати (если вытяжка включена).',
      'Exhaust fan speed during the print (when the exhaust is on).'],
    ['complete_print_exhaust_fan_speed', 'cooling', int(0, 100, 'pct'), 'Вытяжка после печати', 'Exhaust after print',
      'Скорость вытяжки после конца печати, чтобы проветрить камеру.',
      'Exhaust fan speed after the print to air the chamber.'],

    // Откат и перемещения
    ['filament_retraction_length', 'retract', num(0, 10, 'mm', { nil: true }), 'Длина отката', 'Retraction length',
      'На сколько филамент втягивается перед перемещением. Есть нитки - больше (0.8-2 мм для прямого экструдера). nil - как у принтера.',
      'How far the filament is pulled back before a move. Strings - more (0.8-2 mm for direct drive). nil uses the printer value.'],
    ['filament_retraction_speed', 'retract', num(0, 200, 'mms', { nil: true }), 'Скорость отката', 'Retraction speed',
      'Как быстро филамент втягивается. nil - как у принтера.',
      'How fast the filament is pulled back. nil uses the printer value.'],
    ['filament_deretraction_speed', 'retract', num(0, 200, 'mms', { nil: true }), 'Скорость возврата', 'Deretraction speed',
      'Как быстро филамент подаётся обратно после отката. nil - как у принтера.',
      'How fast the filament is pushed back after a retraction. nil uses the printer value.'],
    ['filament_retraction_minimum_travel', 'retract', num(0, 100, 'mm', { nil: true }), 'Откат только при переходе длиннее', 'Retract only for travel over',
      'Короткие переходы идут без отката: меньше износа филамента. nil - как у принтера.',
      'Short moves skip retraction to save filament wear. nil uses the printer value.'],
    ['filament_z_hop', 'retract', num(0, 5, 'mm', { nil: true }), 'Подъём при перемещении', 'Z hop',
      'На сколько голова поднимается при перемещении, чтобы не цеплять модель. nil - как у принтера.',
      'How far the head lifts during moves so it does not hit the model. nil uses the printer value.'],
    ['filament_z_hop_types', 'retract', choice([NIL, ['Normal Lift', 'Обычный', 'Normal'], ['Slope Lift', 'Наклонный', 'Slope'],
      ['Spiral Lift', 'Спиральный', 'Spiral'], ['Auto Lift', 'Авто', 'Auto']]), 'Тип подъёма', 'Z hop type',
    'Как голова поднимается: прямо вверх, наклонно или по спирали. Спираль меньше оставляет следов.',
    'How the head lifts: straight up, on a slope or in a spiral. Spiral leaves fewer marks.'],
    ['filament_wipe', 'retract', nilBool(), 'Очистка при откате', 'Wipe while retracting',
      'При откате сопло проходит по уже напечатанной линии и вытирает каплю.',
      'While retracting, the nozzle moves over the printed line and wipes off the drop.'],
    ['filament_wipe_distance', 'retract', num(0, 10, 'mm', { nil: true }), 'Длина очистки', 'Wipe distance',
      'Сколько миллиметров сопло вытирается. nil - как у принтера.',
      'How many millimeters the nozzle wipes. nil uses the printer value.'],
    ['filament_retract_before_wipe', 'retract', pct(0, 100, { nil: true }), 'Откат перед очисткой', 'Retract before wipe',
      'Какая часть отката делается до очистки, остальное - во время. nil - как у принтера.',
      'Which part of the retraction happens before the wipe, the rest during it. nil uses the printer value.'],
    ['filament_retract_restart_extra', 'retract', num(-5, 5, 'mm', { nil: true }), 'Доп. подача после отката', 'Extra length on restart',
      'Добавка (или убавка) пластика после возврата. Если после переходов дырочки - чуть больше. nil - как у принтера.',
      'Extra (or less) plastic after deretraction. If you see small holes after moves - a bit more. nil uses the printer value.'],
    ['filament_retract_when_changing_layer', 'retract', nilBool(), 'Откат при смене слоя', 'Retract on layer change',
      'Делать откат при переходе на новый слой.',
      'Retract when moving to a new layer.'],
    ['reduce_crossing_wall', 'retract', bool(), 'Обходить стенки', 'Avoid crossing walls',
      'Переходы идут в обход стенок, а не через них: меньше следов и ниток на поверхности.',
      'Moves go around walls instead of across them: fewer marks and strings on the surface.'],
    ['max_travel_detour_distance', 'retract', orPct(0, 1000, 'mm', 0, 1000), 'Наибольший обход', 'Max detour length',
      'Насколько длинным может быть обход стенки. 0 - без ограничения.',
      'How long a detour around a wall may be. 0 means no limit.'],
    ['reduce_infill_retraction', 'retract', bool(), 'Без отката над заполнением', 'Reduce infill retraction',
      'Над заполнением откат не делается: нитки внутри всё равно не видно, печать быстрее.',
      'No retraction over infill: strings inside are hidden anyway and the print is faster.'],
    ['wipe_on_loops', 'retract', bool(), 'Очистка внутрь периметра', 'Wipe on loops',
      'В конце круга стенки сопло уходит внутрь модели, шов аккуратнее.',
      'At the end of a wall loop the nozzle moves inward for a neater seam.'],
    ['wipe_before_external_loop', 'retract', bool(), 'Очистка перед внешней стенкой', 'Wipe before outer wall',
      'Перед внешней стенкой сопло вытирается, меньше капель на видимой стороне.',
      'The nozzle wipes before the outer wall, fewer blobs on the visible side.'],
    ['wipe_speed', 'retract', orPct(0, 1000, 'mms', 0, 1000), 'Скорость очистки', 'Wipe speed',
      'Скорость движения при очистке. Процент - от скорости перемещений.',
      'Speed of the wipe move. A percent is of the travel speed.'],
    ['role_based_wipe_speed', 'retract', bool(), 'Скорость очистки по типу линии', 'Role based wipe speed',
      'Очистка идёт со скоростью той линии, которую только что печатали.',
      'The wipe uses the speed of the line just printed.'],

    // Поддержки
    ['enable_support', 'support', bool(), 'Поддержки', 'Supports',
      'Включает поддержки под нависаниями. В «Новичке» это пункт «Поддержки».',
      'Turns on supports under overhangs. In Beginner this is the Supports choice.'],
    ['support_type', 'support', choice([['tree(auto)', 'Деревья (авто)', 'Tree (auto)'], ['normal(auto)', 'Обычные (авто)', 'Normal (auto)'],
      ['tree(manual)', 'Деревья (вручную)', 'Tree (manual)'], ['normal(manual)', 'Обычные (вручную)', 'Normal (manual)']]),
    'Тип поддержек', 'Support type',
    'Деревья тратят меньше пластика и легче снимаются. «Вручную» - только где отмечено (в этой программе отметок нет).',
    'Trees use less plastic and come off easier. Manual places supports only where painted (this program has no painting).'],
    ['support_style', 'support', choice([['default', 'По умолчанию', 'Default'], ['grid', 'Сетка', 'Grid'], ['snug', 'Облегающие', 'Snug'],
      ['tree_slim', 'Тонкие деревья', 'Tree slim'], ['tree_strong', 'Прочные деревья', 'Tree strong'], ['tree_hybrid', 'Гибридные деревья', 'Tree hybrid'],
      ['organic', 'Органические', 'Organic']]),
    'Стиль поддержек', 'Support style',
    'Форма поддержек. «Органические» деревья гладкие и легко снимаются.',
    'Shape of the supports. Organic trees are smooth and easy to remove.'],
    ['support_threshold_angle', 'support', int(0, 90, 'deg'), 'Угол, с которого нужны поддержки', 'Support threshold angle',
      'Нависания положе этого угла (от горизонта) получают поддержку. Меньше - поддержек меньше.',
      'Overhangs flatter than this angle (from horizontal) get support. Lower means fewer supports.'],
    ['support_on_build_plate_only', 'support', bool(), 'Поддержки только от стола', 'Supports from plate only',
      'Поддержки растут только со стола, не опираются на саму модель.',
      'Supports grow only from the bed, never from the model itself.'],
    ['support_top_z_distance', 'support', num(0, 5, 'mm'), 'Зазор над поддержкой', 'Top Z distance',
      'Зазор между поддержкой и моделью сверху. Больше - легче снять, меньше - ровнее низ модели.',
      'Gap between the support and the model above. More is easier to remove, less gives a neater underside.'],
    ['support_bottom_z_distance', 'support', num(0, 5, 'mm'), 'Зазор под поддержкой', 'Bottom Z distance',
      'Зазор между моделью и поддержкой, которая стоит на ней.',
      'Gap between the model and a support standing on it.'],
    ['support_object_xy_distance', 'support', num(0, 10, 'mm'), 'Зазор сбоку от модели', 'Support/object XY distance',
      'Расстояние от поддержки до стенки модели по горизонтали.',
      'Horizontal gap between the support and the model wall.'],
    ['support_base_pattern', 'support', choice([['default', 'По умолчанию', 'Default'], ['rectilinear', 'Прямолинейный', 'Rectilinear'],
      ['rectilinear-grid', 'Прямолинейная сетка', 'Rectilinear grid'], ['honeycomb', 'Соты', 'Honeycomb'], ['lightning', 'Молния', 'Lightning'], ['hollow', 'Пустой', 'Hollow']]),
    'Узор поддержек', 'Support base pattern',
    'Узор тела поддержек. Для деревьев обычно «По умолчанию».',
    'Pattern of the support body. For trees usually Default.'],
    ['support_base_pattern_spacing', 'support', num(0, 50, 'mm'), 'Шаг линий поддержек', 'Support pattern spacing',
      'Расстояние между линиями поддержек. Больше - легче и слабее.',
      'Distance between support lines. More is lighter and weaker.'],
    ['support_expansion', 'support', num(-10, 10, 'mm'), 'Расширение поддержек', 'Support expansion',
      'Насколько поддержки шире нависания (обычные поддержки).',
      'How much wider the supports are than the overhang (normal supports).'],
    ['support_interface_top_layers', 'support', int(0, 100, 'layers'), 'Связующих слоёв сверху', 'Top interface layers',
      'Плотные слои на верху поддержки, на которых лежит модель. Больше - ровнее низ модели.',
      'Dense layers on top of the support where the model sits. More gives a neater underside.'],
    ['support_interface_bottom_layers', 'support', int(-1, 100, 'layers'), 'Связующих слоёв снизу', 'Bottom interface layers',
      'Плотные слои внизу поддержки, если она стоит на модели. -1 - как сверху.',
      'Dense layers at the bottom of a support standing on the model. -1 means the same as the top.'],
    ['support_interface_pattern', 'support', choice([['auto', 'Авто', 'Auto'], ['rectilinear', 'Прямолинейный', 'Rectilinear'],
      ['concentric', 'Концентрический', 'Concentric'], ['rectilinear_interlaced', 'Прямолинейный чередующийся', 'Rectilinear interlaced'], ['grid', 'Сетка', 'Grid']]),
    'Узор связующего слоя', 'Interface pattern',
    'Узор плотных слоёв поддержки под моделью.',
    'Pattern of the dense support layers under the model.'],
    ['support_interface_spacing', 'support', num(0, 10, 'mm'), 'Шаг связующего слоя', 'Interface spacing',
      'Расстояние между линиями связующего слоя. 0 - сплошной слой.',
      'Distance between interface lines. 0 means a solid layer.'],
    ['support_interface_loop_pattern', 'support', bool(), 'Связующий слой кругами', 'Interface loop pattern',
      'Печатает связующий слой контурами по кругу.',
      'Prints the interface layer as loops.'],
    ['support_filament', 'support', int(0, 16), 'Филамент поддержек', 'Support filament',
      'Номер филамента для тела поддержек. 0 - текущий. У этого принтера один филамент.',
      'Filament number for the support body. 0 means the current one. This printer has one filament.'],
    ['support_interface_filament', 'support', int(0, 16), 'Филамент связующего слоя', 'Interface filament',
      'Номер филамента для связующего слоя поддержки. 0 - текущий.',
      'Filament number for the support interface. 0 means the current one.'],
    ['bridge_no_support', 'support', bool(), 'Не ставить поддержки под мосты', 'No supports under bridges',
      'Мосты печатаются без поддержек: экономия пластика, если мосты короткие.',
      'Bridges are printed without supports: saves plastic when the bridges are short.'],
    ['internal_bridge_support_thickness', 'support', num(0, 10, 'mm'), 'Опора внутренних мостов', 'Internal bridge support thickness',
      'Толщина опор под внутренними мостами (над заполнением). 0 - без опор.',
      'Thickness of the supports under internal bridges (over the infill). 0 means none.'],
    ['adaptive_layer_height', 'support', bool(), 'Авто высота слоёв деревьев', 'Adaptive tree layer height',
      'Высота слоёв древовидной поддержки подбирается сама (кроме первого слоя).',
      'Tree support layers get their height automatically (except the first one).'],
    ['tree_support_branch_angle', 'support', num(0, 60, 'deg'), 'Наклон ветвей', 'Branch angle',
      'Наибольший наклон ветвей дерева. Больше - ветви тянутся дальше.',
      'Largest tilt of the tree branches. More lets branches reach farther.'],
    ['tree_support_branch_angle_organic', 'support', num(0, 60, 'deg'), 'Наклон ветвей (органические)', 'Branch angle (organic)',
      'То же для органических деревьев.',
      'The same for organic trees.'],
    ['tree_support_angle_slow', 'support', num(0, 85, 'deg'), 'Предпочтительный наклон ветвей', 'Preferred branch angle',
      'Наклон, которого ветви держатся, если нет нужды сильнее.',
      'The tilt branches keep unless they need more.'],
    ['tree_support_branch_diameter', 'support', num(0, 100, 'mm'), 'Толщина ветвей', 'Branch diameter',
      'Толщина ветвей дерева. Толще - устойчивее.',
      'Thickness of the tree branches. Thicker is steadier.'],
    ['tree_support_branch_diameter_double_wall', 'support', num(0, 100, 'mm'), 'Толщина для двойной стенки', 'Diameter for double walls',
      'Ветви толще этого печатаются двумя стенками.',
      'Branches thicker than this are printed with two walls.'],
    ['tree_support_branch_distance_organic', 'support', num(0, 100, 'mm'), 'Расстояние между ветвями', 'Branch distance',
      'Как часто ветви касаются модели. Меньше - больше точек опоры.',
      'How often branches touch the model. Less gives more contact points.'],
    ['tree_support_tip_diameter', 'support', num(0, 100, 'mm'), 'Толщина кончика ветки', 'Tip diameter',
      'Толщина ветки там, где она касается модели. Тоньше - меньше следов.',
      'Branch thickness where it touches the model. Thinner leaves fewer marks.'],
    ['tree_support_wall_count', 'support', int(0, 10), 'Стенок у деревьев', 'Tree support walls',
      'Число стенок у ветвей. 0 - подобрать самому движку.',
      'Number of walls in the branches. 0 lets the engine choose.'],
    ['support_critical_regions_only', 'support', bool(), 'Только важные места', 'Critical regions only',
      'Поддержки только под самыми опасными местами (острые углы, края).',
      'Supports only under the most critical spots (sharp tips, edges).', { extra: 'process', def: '0' }],
    ['support_remove_small_overhang', 'support', bool(), 'Убирать мелкие нависания', 'Remove small overhangs',
      'Не ставит поддержки под крошечные нависания, которые и так напечатаются.',
      'Skips supports under tiny overhangs that print fine anyway.', { extra: 'process', def: '1' }],

    // Адгезия
    ['brim_type', 'adhesion', choice([['no_brim', 'Нет', 'None'], ['outer_only', 'Снаружи', 'Outer only'], ['inner_only', 'Внутри', 'Inner only'],
      ['outer_and_inner', 'Снаружи и внутри', 'Outer and inner'], ['auto_brim', 'Авто', 'Auto'], ['brim_ears', 'Ушки (на углах)', 'Mouse ears'], ['painted', 'Нарисованная', 'Painted']]),
    'Кайма', 'Brim type',
    'Плоская полоса вокруг первого слоя, держит модель на столе. В «Новичке» это переключатель «Кайма».',
    'A flat band around the first layer that holds the model on the bed. In Beginner it is the Brim switch.'],
    ['brim_width', 'adhesion', num(0, 100, 'mm'), 'Ширина каймы', 'Brim width',
      'Ширина каймы. 3-8 мм обычно хватает.',
      'Width of the brim. 3-8 mm is usually enough.'],
    ['brim_object_gap', 'adhesion', num(0, 10, 'mm'), 'Зазор каймы', 'Brim-object gap',
      'Щель между каймой и моделью. Больше - кайма легче отделяется.',
      'Gap between the brim and the model. More makes the brim easier to remove.'],
    ['brim_ears_max_angle', 'adhesion', num(0, 180, 'deg'), 'Угол для ушек', 'Brim ears max angle',
      'Ушки ставятся на углы острее этого угла.',
      'Ears are placed on corners sharper than this angle.', { extra: 'process', def: '125' }],
    ['skirt_loops', 'adhesion', int(0, 100), 'Петель юбки', 'Skirt loops',
      'Юбка - линия вокруг модели на расстоянии. Прочищает сопло перед печатью. 0 - без юбки.',
      'The skirt is a line around the model at a distance. It primes the nozzle. 0 means no skirt.'],
    ['skirt_distance', 'adhesion', num(0, 100, 'mm'), 'Расстояние до юбки', 'Skirt distance',
      'Насколько юбка отстоит от модели.',
      'How far the skirt is from the model.'],
    ['skirt_height', 'adhesion', int(0, 1000, 'layers'), 'Высота юбки', 'Skirt height',
      'Сколько слоёв в юбке. Обычно 1.',
      'How many layers the skirt has. Usually 1.'],
    ['skirt_type', 'adhesion', choice([['combined', 'Общая', 'Combined'], ['perobject', 'Для каждой модели', 'Per object']]),
      'Тип юбки', 'Skirt type',
      'Одна юбка вокруг всех моделей или своя у каждой.',
      'One skirt around all models or one for each.', { extra: 'process', def: 'combined' }],
    ['min_skirt_length', 'adhesion', num(0, 10000, 'mm'), 'Минимальная длина юбки', 'Minimum skirt length',
      'Если юбка вокруг маленькой модели короче, добавляются петли.',
      'If the skirt around a small model is shorter, more loops are added.', { extra: 'process', def: '0' }],
    ['draft_shield', 'adhesion', choice([['disabled', 'Нет', 'Disabled'], ['enabled', 'Да', 'Enabled']]),
      'Защитная стенка', 'Draft shield',
      'Юбка во всю высоту модели: стенка от сквозняков. Для ABS/ASA при открытой крышке.',
      'A skirt as tall as the model: a wall against drafts. For ABS/ASA with the lid open.'],
    ['raft_layers', 'adhesion', int(0, 100, 'layers'), 'Слоёв подложки', 'Raft layers',
      'Подложка - решётка под всей моделью. Для кривых моделей и плохого стола. 0 - без подложки.',
      'A raft is a lattice under the whole model. For warped models or a bad bed. 0 means no raft.'],
    ['raft_contact_distance', 'adhesion', num(0, 5, 'mm'), 'Зазор подложки', 'Raft contact distance',
      'Зазор между подложкой и моделью. Больше - легче отделить.',
      'Gap between the raft and the model. More is easier to separate.', { extra: 'process', def: '0.1' }],
    ['raft_expansion', 'adhesion', num(0, 100, 'mm'), 'Расширение подложки', 'Raft expansion',
      'Насколько подложка шире модели.',
      'How much wider the raft is than the model.', { extra: 'process', def: '1.5' }],
    ['raft_first_layer_density', 'adhesion', pct(10, 100), 'Плотность первого слоя подложки', 'Raft first layer density',
      'Плотность первого слоя подложки и поддержек.',
      'Density of the first raft and support layer.', { extra: 'process', def: '90%' }],
    ['raft_first_layer_expansion', 'adhesion', num(-1, 100, 'mm'), 'Расширение первого слоя подложки', 'Raft first layer expansion',
      'Насколько первый слой подложки шире остальных.',
      'How much wider the first raft layer is.', { extra: 'process', def: '2' }],
    ['elefant_foot_compensation', 'adhesion', num(0, 1, 'mm'), 'Компенсация «слоновьей ноги»', 'Elephant foot compensation',
      'Сужает первый слой, который при прижатии расползается. Если низ шире модели - больше (0.1-0.2 мм).',
      'Shrinks the first layer that spreads when pressed. If the bottom is wider than the model - more (0.1-0.2 mm).'],
    ['elefant_foot_compensation_layers', 'adhesion', int(1, 100, 'layers'), 'Слоёв компенсации', 'Compensation layers',
      'На скольких первых слоях действует компенсация «слоновьей ноги».',
      'How many first layers get the elephant foot compensation.', { extra: 'process', def: '1' }],

    // Особые режимы
    ['ironing_type', 'special', choice([['no ironing', 'Нет', 'No ironing'], ['top', 'Все верхние поверхности', 'Top surfaces'],
      ['topmost', 'Только самый верх', 'Topmost surface'], ['solid', 'Все сплошные слои', 'All solid layers']]),
    'Разглаживание', 'Ironing',
    'Горячее сопло ещё раз проходит по верху почти без пластика, верх становится гладким. Печать дольше.',
    'The hot nozzle passes over the top again with almost no plastic, the top gets smooth. Takes longer.'],
    ['ironing_flow', 'special', pct(0, 100), 'Поток разглаживания', 'Ironing flow',
      'Сколько пластика при разглаживании. Видны бороздки - больше, наплывы - меньше.',
      'How much plastic is used for ironing. Grooves - more, blobs - less.'],
    ['ironing_spacing', 'special', num(0.01, 1, 'mm'), 'Шаг разглаживания', 'Ironing line spacing',
      'Расстояние между проходами разглаживания. Меньше - глаже и дольше.',
      'Distance between ironing passes. Less is smoother and slower.'],
    ['ironing_speed', 'special', num(1, 500, 'mms'), 'Скорость разглаживания', 'Ironing speed',
      'Скорость прохода разглаживания.',
      'Speed of the ironing pass.'],
    ['ironing_pattern', 'special', choice([['rectilinear', 'Прямолинейный', 'Rectilinear'], ['concentric', 'Концентрический', 'Concentric']]),
      'Узор разглаживания', 'Ironing pattern',
      'Как идут проходы разглаживания.',
      'How the ironing passes go.', { extra: 'process', def: 'rectilinear' }],
    ['ironing_angle', 'special', num(-1, 359, 'deg'), 'Угол разглаживания', 'Ironing angle',
      'Сдвиг угла разглаживания относительно верхнего слоя.',
      'Angle offset of ironing relative to the top layer.', { extra: 'process', def: '0' }],
    ['ironing_inset', 'special', num(0, 100, 'mm'), 'Отступ разглаживания от края', 'Ironing inset',
      'Насколько разглаживание не доходит до края.',
      'How far ironing stays away from the edge.', { extra: 'process', def: '0' }],
    ['fuzzy_skin', 'special', choice([['disabled_fuzzy', 'Нет', 'None'], ['external', 'Только внешние стенки', 'Outer walls'],
      ['all', 'Все стенки и отверстия', 'All walls and holes'], ['allwalls', 'Все стенки', 'All walls']]),
    'Шероховатая поверхность', 'Fuzzy skin',
    'Стенки печатаются с мелкой дрожью - поверхность матовая и шершавая, прячет слои и шов.',
    'Walls get a fine jitter: a matte rough surface that hides layers and the seam.', { extra: 'process', def: 'disabled_fuzzy' }],
    ['fuzzy_skin_thickness', 'special', num(0, 1, 'mm'), 'Глубина шероховатости', 'Fuzzy skin thickness',
      'Насколько сильно дрожит стенка. Больше - грубее.',
      'How strong the wall jitter is. More is rougher.', { extra: 'process', def: '0.2' }],
    ['fuzzy_skin_point_distance', 'special', num(0.01, 10, 'mm'), 'Шаг шероховатости', 'Fuzzy skin point distance',
      'Расстояние между точками дрожи. Меньше - мельче узор.',
      'Distance between jitter points. Less gives a finer texture.', { extra: 'process', def: '0.3' }],
    ['fuzzy_skin_first_layer', 'special', bool(), 'Шероховатость на первом слое', 'Fuzzy skin on first layer',
      'Применять шероховатость и на первом слое.',
      'Apply fuzzy skin on the first layer too.', { extra: 'process', def: '0' }],
    ['spiral_mode', 'special', bool(), 'Спиральная ваза', 'Spiral vase',
      'Одна стенка по спирали без швов, без верха и заполнения. Для ваз и стаканов.',
      'A single seamless spiral wall with no top or infill. For vases and cups.'],
    ['spiral_mode_smooth', 'special', bool(), 'Сглаживать спираль', 'Smooth spiral',
      'Сглаживает переходы в спиральной вазе, стенка ровнее.',
      'Smooths transitions in spiral vase mode for an even wall.', { extra: 'process', def: '0' }],
    ['make_overhang_printable', 'special', bool(), 'Делать нависания печатаемыми', 'Make overhangs printable',
      'Меняет форму крутых нависаний на коническую, чтобы печатать их без поддержек.',
      'Reshapes steep overhangs into cones so they print without supports.', { extra: 'process', def: '0' }],
    ['make_overhang_printable_angle', 'special', num(0, 90, 'deg'), 'Угол для нависаний', 'Overhang printable angle',
      'Наибольший угол нависания после изменения формы.',
      'Largest overhang angle after reshaping.', { extra: 'process', def: '55' }],
    ['hole_to_polyhole', 'special', bool(), 'Многогранные отверстия', 'Polyholes',
      'Круглые отверстия печатаются многогранниками: точнее размер вертикальных отверстий.',
      'Round holes are printed as polygons for more exact vertical holes.', { extra: 'process', def: '0' }],

    // Филамент
    ['filament_flow_ratio', 'filament', num(0.1, 2), 'Поток филамента', 'Filament flow ratio',
      'Сколько пластика подаётся относительно расчёта. Щели между линиями - больше, наплывы - меньше. Обычно 0.95-1.02.',
      'How much plastic is pushed compared to the calculation. Gaps between lines - more, blobs - less. Usually 0.95-1.02.'],
    ['print_flow_ratio', 'filament', num(0.1, 2), 'Поток модели', 'Object flow ratio',
      'Ещё один множитель потока, из настроек печати. Итог - произведение двух потоков.',
      'One more flow multiplier from the print settings. The result is the product of both.'],
    ['enable_pressure_advance', 'filament', bool(), 'Задать Pressure advance', 'Set pressure advance',
      'Писать свой Pressure advance в G-code. Выключено - принтер берёт свой.',
      'Write your own pressure advance into the G-code. Off leaves the printer value.', { extra: 'filament', def: '0' }],
    ['pressure_advance', 'filament', num(0, 2), 'Pressure advance', 'Pressure advance',
      'Компенсация давления в сопле: ровные углы без наплывов. Подбирается калибровкой, у PLA около 0.02-0.04.',
      'Compensates nozzle pressure for clean corners without blobs. Found by calibration, about 0.02-0.04 for PLA.'],
    ['filament_max_volumetric_speed', 'filament', num(0, 200, 'mm3s'), 'Предел объёмного расхода', 'Max volumetric speed',
      'Сколько пластика сопло успевает расплавить за секунду. Скорость печати режется под этот предел.',
      'How much plastic the nozzle can melt per second. Print speed is capped to this limit.'],
    ['filament_shrink', 'filament', pct(50, 150), 'Усадка по XY', 'Shrinkage (XY)',
      'Размер после остывания в процентах. Деталь 100 мм вышла 99.5 мм - поставьте 99.5 %.',
      'Size after cooling in percent. A 100 mm part came out 99.5 mm - set 99.5 %.', { extra: 'filament', def: '100%' }],
    ['filament_shrinkage_compensation_z', 'filament', pct(50, 150), 'Усадка по Z', 'Shrinkage (Z)',
      'То же по высоте.',
      'The same for height.', { extra: 'filament', def: '100%' }],
    ['filament_diameter', 'filament', num(1, 3.5, 'mm'), 'Диаметр филамента', 'Filament diameter',
      'Диаметр нити. Для этого принтера 1.75 мм.',
      'Thread diameter. 1.75 mm for this printer.'],
    ['filament_density', 'filament', num(0.5, 5, 'gcm3'), 'Плотность', 'Density',
      'Плотность пластика. Нужна только чтобы посчитать граммы.',
      'Plastic density. Only used to count grams.'],
    ['filament_cost', 'filament', num(0, 1000000, 'money'), 'Цена', 'Cost',
      'Цена катушки за килограмм. Только для подсчёта стоимости.',
      'Spool price per kilogram. Only for the cost estimate.'],
    ['filament_type', 'filament', text(), 'Тип пластика', 'Filament type',
      'Название материала (PLA, PETG...). Движок по нему решает некоторые мелочи, например вытяжку.',
      'Material name (PLA, PETG...). The engine uses it for some details, like the exhaust.'],
    ['filament_vendor', 'filament', text(), 'Производитель', 'Vendor',
      'Производитель катушки. Только надпись.',
      'Spool maker. Just a label.'],
    ['filament_soluble', 'filament', bool(), 'Растворимый', 'Soluble',
      'Филамент растворяется (для поддержек). Обычно нет.',
      'The filament dissolves (for supports). Usually not.'],
    ['filament_is_support', 'filament', bool(), 'Филамент для поддержек', 'Support filament',
      'Отметка, что это особый филамент для поддержек.',
      'Marks this as a special support filament.'],

    // Прочее
    ['curr_bed_type', 'other', choice(PLATE_LIST), 'Пластина', 'Plate type',
      'Меняется выбором «Пластина» выше.',
      'Changed with the Plate choice above.', { ro: true }],
    ['print_sequence', 'other', choice([['by layer', 'Послойно', 'By layer'], ['by object', 'По очереди', 'By object']]),
      'Порядок печати моделей', 'Print sequence',
      'Несколько моделей: все сразу слой за слоем или каждая целиком по очереди (меньше ниток, но голова может задеть).',
      'Several models: all together layer by layer, or one after another (fewer strings, but the head may hit).'],
    ['exclude_object', 'other', bool(), 'Отмена отдельных моделей', 'Exclude objects',
      'Позволяет на принтере отменить одну модель из нескольких, если она сорвалась.',
      'Lets you cancel one of several models on the printer if it fails.'],
    ['gcode_label_objects', 'other', bool(), 'Подписывать модели в G-code', 'Label objects',
      'Комментарии с именами моделей в G-code.',
      'Comments with model names in the G-code.'],
    ['enable_arc_fitting', 'other', bool(), 'Дуги в G-code', 'Arc fitting',
      'Кривые записываются дугами (G2/G3): файл меньше, круги плавнее.',
      'Curves are written as arcs (G2/G3): a smaller file and smoother circles.'],
    ['enable_prime_tower', 'other', bool(), 'Башня очистки', 'Prime tower',
      'Башня для очистки сопла при смене филамента. У этого принтера один филамент - обычно не нужна.',
      'A tower to purge the nozzle on filament change. This printer has one filament, usually not needed.'],
    ['prime_tower_width', 'other', num(0, 300, 'mm'), 'Ширина башни очистки', 'Prime tower width',
      'Ширина башни очистки.',
      'Width of the prime tower.'],
    ['wipe_tower_no_sparse_layers', 'other', bool(), 'Башня без пустых слоёв', 'No sparse layers',
      'Башня печатается только на слоях со сменой филамента.',
      'The tower is printed only on layers with a filament change.'],
    ['wipe_tower_wall_type', 'other', choice([['rectangle', 'Прямоугольная', 'Rectangle'], ['cone', 'Конус', 'Cone'], ['rib', 'С рёбрами', 'Rib']]),
      'Стенка башни очистки', 'Prime tower wall',
      'Форма стенки башни очистки.',
      'Shape of the prime tower wall.'],
    ['standby_temperature_delta', 'other', int(-300, 300, 'c'), 'Остывание неактивного сопла', 'Standby temperature delta',
      'Для принтеров с несколькими соплами. Здесь не используется.',
      'For printers with several nozzles. Not used here.'],
    ['interface_shells', 'other', bool(), 'Оболочки между материалами', 'Interface shells',
      'Сплошные стенки между разными материалами. Для многоцветной печати.',
      'Solid shells between different materials. For multicolor printing.'],
    ['filament_minimal_purge_on_wipe_tower', 'other', num(0, 1000, 'mm3'), 'Мин. сброс на башне', 'Minimal purge on tower',
      'Сколько пластика сбросить на башне при смене филамента.',
      'How much plastic is purged on the tower on filament change.'],
    ['required_nozzle_HRC', 'other', int(0, 500), 'Нужная твёрдость сопла', 'Required nozzle HRC',
      'Абразивным пластикам нужно твёрдое сопло. У Centauri Carbon сопло закалённое.',
      'Abrasive plastics need a hard nozzle. Centauri Carbon has a hardened one.'],
    ['filename_format', 'other', text(), 'Шаблон имени файла', 'File name format',
      'Шаблон имени у Elegoo Slicer. Здесь имя на принтере программа делает сама, поэтому не влияет.',
      'Elegoo Slicer file name template. This program names the file itself, so it has no effect.', { ro: true }],
    ['compatible_printers_condition', 'other', text(), 'Условие совместимости', 'Compatibility condition',
      'Служебное поле пресета. Менять нельзя: движок может отвергнуть пресет.',
      'Internal preset field. Not editable: the engine may reject the preset.', { ro: true }],
    ['filament_id', 'other', text(), 'Код филамента', 'Filament ID',
      'Служебный код пресета.',
      'Internal preset code.', { ro: true }],
    ['renamed_from', 'other', text(), 'Старое имя пресета', 'Renamed from',
      'Служебное поле: прежнее имя пресета.',
      'Internal field: the previous preset name.', { ro: true }],
    ['filament_extruder_variant', 'other', text(), 'Вариант экструдера', 'Extruder variant',
      'Служебное поле: для какого экструдера пресет.',
      'Internal field: which extruder the preset is for.', { ro: true }],
  ];

  const ENTRIES = new Map();
  for (const [key, section, type, lru, len, dru, den, extra] of E) {
    ENTRIES.set(key, Object.assign({ key, section, type, label: { ru: lru, en: len }, desc: { ru: dru, en: den } }, extra || {}));
  }

  // Раздел для ключей без ручной записи: по имени.
  const RULES = [
    [/^(support_|tree_support_)/, 'support'],
    [/^(brim_|skirt_|raft_)|draft_shield|elefant/, 'adhesion'],
    [/^(ironing_|fuzzy_skin|spiral_)/, 'special'],
    [/fan|cooling|slow_down|exhaust|air_filtration/, 'cooling'],
    [/_acceleration$|^accel_|_jerk$/, 'accel'],
    [/retract|z_hop|wipe_(distance|speed)|^wipe_on|travel/, 'retract'],
    [/_speed$/, 'speed'],
    [/temp|temperature/, 'temps'],
    [/^(wall_|outer_wall|inner_wall|seam_)|_wall$|perimeter/, 'walls'],
    [/^(top_|bottom_)/, 'topbottom'],
    [/infill|gap_fill|bridge/, 'infill'],
    [/^filament_|pressure_advance|flow_ratio|shrink/, 'filament'],
    [/layer_height|line_width|resolution|compensation/, 'quality'],
  ];

  function entry(key) { return ENTRIES.get(key) || null; }

  function sectionOf(key) {
    const e = ENTRIES.get(key);
    if (e) return e.section;
    for (const [re, s] of RULES) if (re.test(key)) return s;
    return 'other';
  }

  const isNum = (s) => /^[-+]?(\d+(\.\d*)?|\.\d+)$/.test(s);
  const plain = (v) => (Array.isArray(v) ? String(v[0] ?? '') : String(v ?? ''));

  /** Тип ключа: ручной из каталога или по значению из пресета. */
  function typeOf(key, base) {
    const e = ENTRIES.get(key);
    if (e) return e.type;
    const b = plain(base).trim();
    if (isNum(b)) return { t: 'num', min: -Infinity, max: Infinity, unit: '', inferred: true };
    if (/%$/.test(b) && isNum(b.slice(0, -1))) return { t: 'num', min: -Infinity, max: Infinity, unit: '', pct: [-Infinity, Infinity], inferred: true };
    return { t: 'text' };
  }

  const canon = (s) => String(Number(s));
  const inRange = (n, a, b) => n >= a && n <= b;

  /**
   * Проверка ввода. Запятая - как точка. Возвращает {ok, value} (value - как писать в пресет)
   * или {ok: false, err: {code, ...}}; текст ошибки - message(err, lang).
   */
  function check(key, raw, base) {
    const ty = typeOf(key, base);
    const s = plain(raw).trim();
    const fail = (code) => ({ ok: false, err: Object.assign({ code }, ty) });
    if (/[\r\n]/.test(s)) return fail('line');
    if (ty.t === 'text') return { ok: true, value: s };
    if (ty.t === 'bool') {
      const v = { 0: '0', 1: '1', false: '0', true: '1' }[s.toLowerCase()];
      return v ? { ok: true, value: v } : fail('bool');
    }
    if (ty.t === 'enum') {
      if (ty.options.some((o) => o.value === s) || (s !== '' && s === plain(base).trim())) return { ok: true, value: s };
      return fail('enum');
    }
    if (ty.nil && s.toLowerCase() === 'nil') return { ok: true, value: 'nil' };
    const v = s.replace(/,/g, '.').replace(/\s+/g, '');
    if (ty.t === 'pct') {
      const n = v.replace(/%$/, '');
      if (!isNum(n) || !inRange(Number(n), ty.min, ty.max)) return fail('pct');
      return { ok: true, value: canon(n) + '%' };
    }
    // num
    if (/%$/.test(v)) {
      const n = v.slice(0, -1);
      if (!ty.pct || !isNum(n) || !inRange(Number(n), ty.pct[0], ty.pct[1])) return fail('range');
      return { ok: true, value: canon(n) + '%' };
    }
    if (!isNum(v)) return fail('range');
    const n = Number(v);
    if (ty.int && !Number.isInteger(n)) return fail('range');
    if (!inRange(n, ty.min, ty.max)) return fail('range');
    return { ok: true, value: canon(v) };
  }

  const L = (lang) => (lang === 'en' ? 'en' : 'ru');
  function unitText(unit, lang) {
    const u = UNITS[unit];
    return u ? u[L(lang) === 'en' ? 1 : 0] : '';
  }

  /** Понятный текст ошибки: «Нужно число от 0.04 до 0.32 мм». */
  function message(err, lang) {
    const en = L(lang) === 'en';
    const u = err.unit && err.unit !== 'pct' ? ' ' + unitText(err.unit, lang) : '';
    const nil = err.nil ? (en ? ' or nil (printer value)' : ' или nil (как у принтера)') : '';
    const finite = Number.isFinite(err.min) && Number.isFinite(err.max);
    switch (err.code) {
      case 'line': return en ? 'One line only' : 'Только одна строка';
      case 'bool': return en ? 'Needs 0 or 1' : 'Нужно 0 или 1';
      case 'enum': return en ? 'Pick a value from the list' : 'Выберите вариант из списка';
      case 'pct': return (en ? `Needs a percent from ${err.min} to ${err.max} %` : `Нужен процент от ${err.min} до ${err.max} %`) + nil;
      default: {
        const kind = err.int ? (en ? 'a whole number' : 'целое число') : (en ? 'a number' : 'число');
        let s = finite ? (en ? `Needs ${kind} from ${err.min} to ${err.max}${u}` : `Нужно ${kind} от ${err.min} до ${err.max}${u}`)
          : (en ? `Needs ${kind}` : `Нужно ${kind}`);
        if (err.pct) {
          const pf = Number.isFinite(err.pct[0]) && Number.isFinite(err.pct[1]);
          s += pf ? (en ? ` or a percent from ${err.pct[0]} to ${err.pct[1]} %` : ` или процент от ${err.pct[0]} до ${err.pct[1]} %`)
            : (en ? ' or a percent' : ' или процент');
        }
        return s + nil;
      }
    }
  }

  function label(key, lang) {
    const e = ENTRIES.get(key);
    return e ? e.label[L(lang)] : '';
  }
  function desc(key, lang) {
    const e = ENTRIES.get(key);
    return e ? e.desc[L(lang)] : '';
  }
  function unitOf(key, lang) {
    const e = ENTRIES.get(key);
    return e && e.type.unit ? unitText(e.type.unit, lang) : '';
  }
  function optionLabel(key, value, lang) {
    const e = ENTRIES.get(key);
    const o = e && e.type.t === 'enum' ? e.type.options.find((x) => x.value === value) : null;
    return o ? o[L(lang)] : value;
  }
  function sectionTitle(id, lang) {
    const s = SECTIONS.find((x) => x.id === id);
    return s ? s[L(lang)] : id;
  }

  /** Ключи, которых нет в пресете, но движок их знает: [{key, kind, def}]. */
  function extras(kind) {
    const out = [];
    for (const e of ENTRIES.values()) if (e.extra && (!kind || e.extra === kind)) out.push({ key: e.key, kind: e.extra, def: e.def });
    return out;
  }
  function isExtra(kind, key) {
    const e = ENTRIES.get(key);
    return !!(e && e.extra === kind);
  }
  function isReadOnly(key) {
    const e = ENTRIES.get(key);
    return !!(e && e.ro);
  }

  /** Строка поиска совпадает с подписью (оба языка), описанием или именем ключа. */
  function matches(key, query) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return true;
    const e = ENTRIES.get(key);
    const hay = [key, e ? e.label.ru : '', e ? e.label.en : '', e ? e.desc.ru : '', e ? e.desc.en : ''].join('\n').toLowerCase();
    return q.split(/\s+/).every((w) => hay.includes(w));
  }

  /** Ключ, который упоминает текст ошибки движка: «parameter layer_height» или «Layer height cannot ...». */
  function findKeyInText(textIn, keys, preferred) {
    const t = String(textIn || '');
    const known = new Set(keys || []);
    const m = /parameter\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(t);
    if (m && known.has(m[1])) return m[1];
    const low = t.toLowerCase();
    let best = null;
    for (const k of [...(preferred || []), ...known]) {
      if (!known.has(k)) continue;
      const exact = new RegExp('(^|[^a-z0-9_])' + k.toLowerCase() + '([^a-z0-9_]|$)').exec(low);
      const words = k.includes('_') ? low.indexOf(k.toLowerCase().replace(/_/g, ' ')) : -1;
      const pos = exact ? exact.index : words;
      if (pos < 0) continue;
      const len = k.length;
      if (!best || pos < best.pos || (pos === best.pos && len > best.len)) best = { key: k, pos, len };
    }
    return best ? best.key : null;
  }

  return {
    SECTIONS, SECTION_IDS, UNITS, ENTRIES,
    entry, sectionOf, typeOf, check, message, label, desc, unitOf, optionLabel, sectionTitle,
    extras, isExtra, isReadOnly, matches, findKeyInText,
  };
});
