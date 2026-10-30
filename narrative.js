// The scrolling narrative of the analogue view (open it with ?story on the URL).
// Hand-made: edit text and viewpoints here, then rebuild (build_viewer.py) or run tools/analogue_view.py.
//
// Each chapter:
//   title, body   -- the panel text (body is HTML: <p>, <i>, <b>)
//   camera        -- { E, N, h }: where the camera stands, EPSG:2326 metres; h = metres above the ground there
//   target        -- { E, N, h }: the point it looks at (h above the ground there, default 0)
//   seconds       -- how long the move takes (default 2.5)
//   layers        -- optional [{ label, color, rings: [[[E, N], ...], ...] }]: closed lines drawn on the ground while the
//                    chapter is active, each listed under the text with its label. Colours: blue #56B4E9 = from 1982
//                    sources, orange #E69F00 = from later data (never the tier colours)
//   tenure        -- optional { radius, label }: outlines every model structure within radius m of the target, coloured
//                    by the land it stood on (tools/narrative_tenure.py, 2026 lot register, lots granted after 1982 left out)
//   land          -- optional [{ key, color, opacity, name, label }]: land taken for the NDA, filled on the ground while the
//                    chapter is active (tools/narrative_land.py): key 'resumed' (private land resumed by Gazette notice, red
//                    #d6452b, the web map's resumed-land red) or 'cleared' (government land inside the works, grey). `name` is the
//                    chapter's one-line key; a ground click outlines its row and puts `label` (the source) in the ground box
//   present3d     -- optional { label, classes: [{ key, color, width, boost, name }] }: the present-day 3D model (tools/present_3d.py:
//                    LandsD 3D Visualisation Map, photographed mid-2021 to Feb 2024) in place of the 1982 model while the chapter is active.
//                    Its tiles load the first time the chapter is entered, never with the page. Each 1982 outline is drawn in its
//                    class's colour, `width` m thick, `boost` x past the tone mapping: key 'gone' (under 20 % of it covered by a
//                    present-day building) on the present ground, 'partly' and 'built over' (50 % or more) on the roof of the
//                    building that stands on it. `name` is the class's line in the chapter's key, `label` the source
//                    line; a ground click outlines the class's row and adds its own last row to the ground box.
//                    `follow`: a chapter id with `tenure` -- outline and count only the structures that chapter outlines.
//                    `reveal: { seconds }`: entered from the chapter before, that chapter's last frame fades out over the
//                    present day before the camera moves (the chapter before also starts the tiles loading)
//   placeholder   -- optional text shown in a labelled box: for content not yet in the model
//   photo         -- optional { caption }: the December 1982 photograph, framed, north up, over the view; it fades
//                    to the 3D view when the reader scrolls on
//
// Text: the author's "One afternoon, 21 December 1982" (2026-10-20), from logged sources (data/SOURCES.md,
// docs/pre-clearance-sources/). Run the claim-check skill on it before it is presented.
window.NARRATIVE = {
  title: 'One afternoon, 21 December 1982',
  intro: 'Kwu Tung North, as a survey aircraft photographed it. Scroll to move through the valley. Drag the view to look around; ' +
         'WASD sets you down on the ground and walks; scroll to another chapter to fly on.',
  chapters: [
    {
      id: 'photograph',
      title: 'The photograph',
      body: '<p>On 21 December 1982 a survey aircraft photographed this valley from above. Everything here is rebuilt from that photograph ' +
            'and from the Lands Department\'s 1:1000 survey sheets, editions nearest 1982 (1980 to 1983).</p>' +
            '<p>The sheets give the outlines; the photograph decides what was standing that day. Even the sun is that afternoon\'s, ' +
            'set from the shadows the buildings cast on the photograph.</p>' +
            '<p>Positions and outlines come from those sources. Colours and surfaces come from other villages and texture libraries: ' +
            'they show what such places looked like, not what these buildings were.</p>',
      // straight down over the photo's centre, so the next chapter lifts out of the photograph into the model
      camera: { E: 828640, N: 840950, h: 1100 },
      target: { E: 828640, N: 840955 },
      seconds: 3,
      photo: { caption: '<b>Kwu Tung North, 21 December 1982.</b> Digital Orthophoto DOP1000-1982, north up, 1.45 by 0.96 km ' +
                        '(E 828 000-829 450, N 840 470-841 430, HK1980 Grid). Lands Department, HKSAR Government, via the CSDI Portal.' },
    },
    {
      id: 'productive',
      title: 'Fields and fish ponds',
      body: '<p>Around the buildings lay vegetable fields and fish ponds; by the 1970s rice had largely given way to vegetables.</p>' +
            '<p>The ponds and cultivated plots in the model are traced off the 1:1000 survey sheets (editions nearest 1982) ' +
            'and the December 1982 aerial photograph.</p>',
      camera: { E: 828620, N: 840700, h: 110 },
      target: { E: 828870, N: 840920 },
      seconds: 3.5,
    },
    {
      id: 'yards',
      title: 'The yards',
      body: '<p>In Shek Tsai Leng, six yards of fermenting vats stand in open ground on the 1982 photograph; vats already stood at two of them in 1963.</p>' +
            '<p>Each vat in the model stands on a dark round blob read off the 1982 photograph, about 1,180 of them. The jars and their hats are analogue.</p>' +
            '<p>Whose they were is not confirmed. The sheets print no maker, no "soy" and no "vat". One candidate is Kui Lee, ' +
            'a sauce maker whose own history says it moved its works out of Kowloon City in the early 1960s.</p>',
      camera: { E: 828628, N: 840515, h: 62 },    // 2026-10-21: closer (was 828640, 840470 at 90 m) so the vats read
      target: { E: 828630, N: 840645 },
      layers: [
        { label: 'Vat yards traced by eye on the 1982 photograph (vat area only, to about 2-3 m).', color: '#56B4E9',
          rings: [[[828678, 840625], [828678, 840676], [828686, 840690], [828700, 840690], [828704, 840675], [828700, 840656], [828694, 840638], [828688, 840625], [828678, 840625]],
                  [[828570, 840612], [828586, 840632], [828602, 840620], [828599, 840593], [828578, 840592], [828570, 840612]],
                  [[828514, 840606], [828542, 840606], [828542, 840594], [828514, 840594], [828514, 840606]],
                  [[828490, 840582], [828504, 840582], [828504, 840551], [828490, 840551], [828490, 840582]],
                  [[828525, 840572], [828547, 840572], [828547, 840551], [828525, 840551], [828525, 840572]],
                  [[828715, 840708], [828765, 840708], [828765, 840671], [828737, 840671], [828737, 840695], [828715, 840695], [828715, 840708]],
                  [[828533, 840690], [828540, 840695], [828558, 840672], [828551, 840667], [828533, 840690]],
                  // 2026-10-27: the sixth yard (STL-Y6, three vat blocks NW of Y5; the author's decision), one tracer's outlines
                  [[828509.4, 840705.7], [828517.9, 840709.5], [828514.9, 840716.2], [828506.5, 840712.4], [828509.4, 840705.7]],
                  [[828516.4, 840702.2], [828521.2, 840704.2], [828524.7, 840695.6], [828519.9, 840693.6], [828516.4, 840702.2]],
                  [[828514.8, 840707.1], [828519.6, 840709.0], [828521.8, 840705.0], [828516.0, 840703.3], [828514.8, 840707.1]]] },
      ],
    },
    {
      id: 'estate-huts',
      title: 'The estate and the huts',
      body: '<p>Beside the words "DILLS CORNER CAMP" on the sheet stand numbered blocks, 20 to 25 among them: flat-roofed, in rows, ' +
            'where their 1982 shadows can be read (14 of 15), within a metre of their measured heights. That they were the camp\'s married quarters is a lead, not yet confirmed.</p>' +
            '<p>North of them, a dense cluster of huts and sheds, drawn on the sheets as temporary structures. In 1982 the government ' +
            'surveyed every squatter structure in Hong Kong, recording its length, width, height, materials and use. Typical heights were ' +
            '9 to 11 feet, in "iron sheets and timber". What the survey recorded was tolerated; what came after could be cleared.</p>' +
            '<p>The coloured outlines show the land each structure stood on.</p>',
      camera: { E: 828050, N: 840590, h: 120 },   // chapter 5's angle; from 1.6x out the model's edge showed, so closer (still behind chapter 5)
      target: { E: 828200, N: 840800 },
      seconds: 3,
      tenure: { radius: 280, width: 0.7,
                label: 'Land under each structure: LandsD lot register (2026), lots granted after 1982 left out. "Not on any lot" is presumed, ' +
                       'not proven; lots resumed whole for the NDA have left the register.' },
      land: [{ key: 'resumed', color: '#d6452b', opacity: 0.35, name: 'Resumed: private land taken by Gazette notice',
                label: 'Private land resumed for the NDA by Gazette notice, 2019 and 2024: LandsD Resumption Plans, georeferenced ' +
                       '(data/tenure/resumed_land_2326.geojson). Not a 1982 feature.' },
             { key: 'cleared', color: '#9e9e9e', opacity: 0.25, name: 'Cleared: government land inside the works',
                label: 'Government land inside the NDA works, cleared rather than resumed, from 2019: works area less every lot that ' +
                       'predates the NDA and the resumed land (data/tenure/govland_cleared_2326.geojson). Not a 1982 feature.' }],
    },
    {
      id: 'after',
      title: 'After the photograph',
      // the author's text (2026-10-21), reworded after the claim check by the author's approval: FSSTL 279 was the first
      // residential land SALE in the NDA, not the first tower started (docs/new-towers); 28 of the 58 structures north of it
      // lie in the First Phase works and the model does not show when they went
      body: '<p>The government land here was cleared and sold as FSSTL 279, the first residential land sale in the New Development Area (NDA).</p>' +
            '<p>The huts and sheds to the north are gone; about half of them stood inside the First Phase works, cleared from 2019.</p>',
      camera: { E: 828120, N: 840644, h: 72 },    // the same angle, closer in (0.6 times the distance)
      target: { E: 828210, N: 840770 },
      present3d: { follow: 'estate-huts', reveal: { seconds: 3 },
                   label: 'Present-day model: LandsD 3D Visualisation Map (Individualised models), photo-textured; photographed between ' +
                          'mid-2021 and February 2024, read off its own ground photo (LandsD gives no date; SOURCES.md 5ag). Not 1982.',
                   // an ordered scale, dark to light by how much of the outline a present-day building covers (scripts/check_colours.py);
                   // none of the tier colours, nor chapter 4's red and grey. Gone is drawn on the ground, thickest; partly and built
                   // over on the roof of the building that stands on them, so they show (2026-10-21, the author: none could be seen)
                   classes: [{ key: 'gone', color: '#D4148F', width: 0.5, boost: 2.2, name: 'Gone: under 20 % of the 1982 outline covered by a building in the present-day model' },
                             { key: 'partly', color: '#EE7FD0', width: 0.35, boost: 1.4, name: 'Partly covered (20-50 %), drawn on the roof' },
                             { key: 'built over', color: '#E8D4FF', width: 0.35, boost: 1.2, name: 'Built over: a building stands on 50 % or more of the outline, the same one or a later one; drawn on its roof' }] },
      layers: [{ label: 'FSSTL 279 lot outline: LandsD lots layer (2026), data/tenure/lots_2326.geojson. Not a 1982 feature.', color: '#E69F00',
                rings: [[[828133.0, 840822.4], [828144.7, 840820.8], [828142.2, 840781.2], [828149.5, 840780.7], [828162.5, 840702.2],
                [828212.9, 840697.5], [828219.8, 840700.1], [828228.2, 840704.1], [828237.6, 840704.6], [828246.1, 840701.9],
                [828249.9, 840700.9], [828270.2, 840698.9], [828274.6, 840700.2], [828276.8, 840704.3], [828288.8, 840837.9],
                [828234.3, 840842.0], [828209.9, 840842.1], [828176.4, 840839.5], [828157.4, 840838.5], [828133.9, 840836.2],
                [828133.0, 840822.4]]] }],
    },
  ],
};
