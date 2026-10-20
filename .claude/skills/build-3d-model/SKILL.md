---
name: build-3d-model
description: Build a photorealistic 3D model (.glb) of a tech object (computer part, engine, machine, tool, electronics) from reference photos with this studio's procedural CAD toolkit, rendering each version and comparing it with the photos until it matches. Use when the user asks to model, build or create a 3D model of an object from photos or a description.
---

# Build a 3D model from photos

You are the AI Builder, working directly in this repository. You write a model program, build and
render it with `tools/build-model.mjs`, compare the renders with the user's photos and revise. This
is the same loop the studio's API-based AI Builder runs, done here in Claude Code.

## 1. Prepare

- Read `ai-builder-guide.md` in full. It defines the program format, coordinates and scale, materials,
  geometry helpers, realism rules and how to review a version. Follow it exactly.
- The toolkit is the `<script id="studio-toolkit">` block of
  `3d_hardware_glb_studio_procedural_builder.html`. Read `createPBRMaterials()` for the material
  names, the `CAD` and `Parts` objects for the helpers, and one or two built-in builders closest to
  the object (e.g. `buildPSUModel` for a boxy metal unit, `buildCaseFanModel` for anything with a
  rotor) as examples of the expected detail.
- Look at every reference photo the user gave (read the image files). If you cannot tell what the
  object is, or the photos leave its size unclear, ask one short question; otherwise proceed.
- Check `node_modules/playwright-core` exists; if not, run `npm install` once.

## 2. Write the model

Create `models/<Name>/model.js` (Name in PascalCase with underscores, e.g. `models/V8_Engine/model.js`)
containing, besides `buildModel()`, a top-level metadata object:

```js
const MODEL_INFO = {
  title: 'V8 Engine',
  subtitle: 'One line naming the key features',
  summary: 'One or two sentences for students: what it is and what it does.',
  callouts: [{ pos: [x, y, z], tag: 'Feature name', desc: 'What it does, in a sentence or two.' }]
};
```

The title, summary and callouts are embedded in the `.glb` and appear in the studio when it is
imported. Plan the model in comments at the top of the file (identity, real dimensions,
sub-assemblies, materials, distinctive details), as the guide describes.

## 3. Build, look, revise

Run:

```
node tools/build-model.mjs models/<Name>/model.js
```

It prints build statistics, warnings and console output, and writes `models/<Name>/<Name>.glb` (named
after the folder; `--name` overrides it) and the studio views in `models/<Name>/views/`: five angles
plus an exploded view with every offset applied. If the build fails, the error names the line: fix it
and run again. Useful options:

- `--size 1024` renders the views at 1024 px, for objects with small printed or connector detail;
- `--bottom` adds a view of the underside (feet, screws, labels, oil pans).

After a successful build, read `models/<Name>/views/sheet.jpg` (all views on one sheet; open the
individual view images when you need more detail) and compare it with the photos as the guide's
"Reviewing a version" section describes, including the exploded view. Write down the most important
differences, fix them in `model.js`, rebuild and look again.

Stop when the model matches the photos well, or after about four review rounds unless the user asked
for more. Say what still differs rather than iterating on changes the renders cannot show.

## 4. Hand over

Tell the user:

- the `.glb` path, and that in the studio they can add it with **Image → 3D → Import .glb file**,
  which restores the title, teaching callouts and code (shown under **Editable Source**);
- a short summary of what was modelled and anything you were unsure of (dimensions or details the
  photos did not show).

Keep `model.js` next to the `.glb` so the model can be revised later.
