# Slicer CC

A slicer for one printer, the Elegoo Centauri Carbon. Slicing is done by the proven ElegooSlicer engine (an OrcaSlicer fork);
the program adds two things Elegoo Slicer lacks:

1. **Beginner mode**: three decisions instead of hundreds of settings - filament, temperature adjustment, supports (with a
   brim switch). Everything else is the maker's base for the Centauri Carbon 0.4 nozzle at 0.20 mm. Advanced mode shows
   every engine setting with search.
2. **Reliable sending**: the print starts only after the printer itself lists the file and the size matches. A dropped
   connection, a cut file or a file that never shows up is retried up to three times, with a plain message about what happened.

[Русский](README.ru.md)

## Found by measurement (2026-10-17, ElegooSlicer 1.5.3.5)

| What | Before | Done |
|---|---|---|
| The engine does not resolve the whole `inherits` chain of a preset passed as a file | `filament_density: 0`, outer wall acceleration 1000 instead of 5000, a cube takes 18 min instead of 10; "Generic PETG @System" bed 45 °C instead of 80 | The chain is resolved here (`src/core/presets.js`), the engine gets full presets without `inherits` |
| Printer preset with `"from": "User"` and no `inherits` | Refused, exit code 127 | Always `"from": "system"` in the job |
| Small binary STL with zero normals | Cubes of 10-15 mm fail to load, 16 mm and up slice. admesh treats a file as ASCII if the 128 bytes after the header have no byte > 127 | The job copy gets -0.0 in the first facet normal (the same zero, byte 0x80) |
| Full model path | Ended up in the G-code (`EXCLUDE_OBJECT_DEFINE NAME=C_/Users/...`) | Models are copied into the job folder under neutral names |
| ElegooSlicer file names | `ECC_0.4_旋转花瓶E_Generic PETG _0.2_4h20m.gcode` - spaces, CJK | Printer name only from `[A-Za-z0-9_.-]`, at most 60 chars, Cyrillic transliterated |

## Sending

SDCP like Elegoo Slicer: WebSocket `ws://<ip>:3030/websocket` for commands and `POST http://<ip>:3030/uploadFile/upload`
for the file (1 MB chunks, MD5 of the whole file in each). Busy printer - refused before upload. A name not yet on the
printer, so an old file cannot pass the check. The start command is sent **once**. The camera is only ever enabled: SDCP 386
`Enable: 0` cuts the video for everyone and is refused in `src/core/sdcp.js`, guarded by a law.

## Tests

```
npm test           # core laws: 63 tests (node:test + fast-check), with the real engine when installed
npm run test:app   # the real Electron window, invisible: 12 tests
npm run mutate     # 17 mutants, all must be caught
```

The printer in tests is a fake (`tests/support/fake-printer.js`) with faults on demand. Law over random fault mixes: at most
one start, nobody disables the camera, success means the printer holds the file byte for byte.
