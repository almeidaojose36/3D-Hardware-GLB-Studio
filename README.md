# Classroom 3D PC Hardware CAD & GLB Studio

A browser studio that builds nine PC hardware models procedurally (case fan, case, CPU cooler, CPU,
motherboard, RAM, PSU, hard drive, DVD drive), shows them with photo-studio lighting, exploded views and
training callouts, and exports each one as a `.glb` file. You can add your own models in three ways:

- **AI Builder:** Claude studies photos of an object, writes its procedural CAD code with the studio's
  modelling toolkit, renders it, compares the renders with your photos and refines it. You get an
  editable, exploded-view-ready model with teaching callouts, built like the nine built-in models.
- **AI image-to-3D:** a generator service (Meshy or Stability AI) reconstructs a textured mesh from one photo.
- **Import** any `.glb` file.

## Running the studio

**Built-in models and importing only:** open `3d_hardware_glb_studio_procedural_builder.html` in a browser.

**With the AI generators:** they run through a small local server, which keeps your API keys private
(the providers also refuse direct requests from web pages). It needs [Node.js](https://nodejs.org) 18
or newer.

1. In this folder run `npm install` once (needed for the AI Builder and `tools/build-model.mjs`; the
   image-to-3D generators work without it).
2. Copy `.env.example` to `.env` and add a key (see below).
3. Run `node studio-server.mjs` (or `npm start`).
4. Open <http://localhost:8787>.

## AI Builder

There are two ways to run the AI Builder. Both use the same modelling guide (`ai-builder-guide.md`),
the same sandbox and the same studio renders, and produce the same kind of model.

### With your Claude plan, in Claude Code (no API key)

Claude Code signs in with your Claude account, so the modelling counts toward your Pro or Max plan's
usage. Start Claude Code in this folder, from the Claude desktop app or a terminal.

1. Run `npm install` once. You also need Google Chrome or Microsoft Edge installed: the build tool uses
   it, invisibly, to run and render the model.
2. Put your photos in the folder (or drag them into the chat) and ask, for example:
   *"Build a 3D model of this car engine from these photos."* Claude Code uses the project's
   `build-3d-model` skill.
3. Claude writes `models/<Name>/model.js` and builds it with `node tools/build-model.mjs`. The tool
   writes `models/<Name>/<Name>.glb` and five studio views to `models/<Name>/views/`. Claude looks at
   the views, compares them with your photos and revises the code, usually for 2-4 rounds.
4. In the studio, choose **Image → 3D → Import .glb file** and pick the `.glb`. The title, teaching
   callouts and code come with it (see **Editable Source**).

You can run the tool yourself too: `node tools/build-model.mjs models/<Name>/model.js`. The first run
downloads and caches the three.js scripts in `tools/.cache`; later runs work offline.

### In the studio, with an API key

Choose **Image → 3D**, pick **AI Builder** as the generator, add up to four photos of the object from
different angles, optionally say what it is, choose how many versions Claude may make, and press
**Generate**. Each version appears in the window with the renders Claude was shown; when Claude accepts a
version (or the versions run out), the model is added to **My Library**. Keep the tab open while it runs:
the studio builds and renders each version.

This needs `ANTHROPIC_API_KEY` in `.env`, from <https://console.anthropic.com>. API use is billed per use,
separately from a Claude Pro or Max plan. A model typically takes 5-15 minutes and costs roughly $1-3 at
the default settings; the window shows a running estimate. `AI_BUILDER_MODEL` and `AI_BUILDER_EFFORT`
in `.env` change the Claude model and effort level.

### How it works, and what it is good at

Claude writes ordinary JavaScript against the studio's toolkit: filleted and bevelled CAD shapes, real
PBR materials, printed labels, connectors and fasteners. The code runs in a sandbox (a worker inside an
isolated frame with no network, no access to the page or your library, and a time limit), so a mistake
or a misleading photo cannot do anything beyond producing a wrong model. The result is a clean,
lightweight, editable model with named parts and exploded-view offsets, which suits technical teaching
models (computer parts, engines, machines, electronics) well. It is less suited to organic shapes such
as people, animals or fabric, where the image-to-3D generators do better.

The photos are sent to Anthropic's API (studio button) or to Claude through Claude Code. The AI builds
what it can see and knows, so check dimensions and details against the real object before teaching with
a model.

## Image → 3D generators

Click **Image → 3D**, drop or paste a photo, pick a generator and press **Generate**. When the model is
ready it appears under **My Library** in the sidebar. From there you can inspect it, edit its materials
and export it like the built-in models. Library models are stored in your browser (IndexedDB) and stay
there after reloads; remove one with its ✕ button.

| Generator | `.env` setting | Notes |
| --- | --- | --- |
| AI Builder (Claude) | `ANTHROPIC_API_KEY` | Procedural CAD model written and refined by Claude, see above. Paid per use. |
| Meshy Image-to-3D | `MESHY_API_KEY` | Textured PBR models, usually 1–4 minutes. Paid per generation. |
| Stability AI Stable Fast 3D | `STABILITY_API_KEY` | Fast reconstruction, usually under 30 seconds. Paid per generation. |

To try the Meshy workflow without paying, set `MESHY_API_KEY=msy_dummy_api_key_for_test_mode_12345678`.
That is Meshy's public test key: every photo returns the same sample model and no credits are used.

For the best results, photograph one object on a plain background with even lighting, from a
three-quarter angle. The photo is uploaded to the generator you choose, and that service's pricing,
terms and data policies apply. AI reconstructions are approximations, so check them against the real
part before using them for teaching.

**Import .glb** (in the same window) adds any self-contained binary glTF file to your library, for
example one downloaded from a generator's website. Importing doesn't need the server.

## Sharing the server on a classroom network

By default the server only answers this computer. To let other machines use it, start it with
`HOST=0.0.0.0` and `ALLOWED_HOSTS=<address:port students will type>`. Anyone who can reach that
address can spend your provider credits.
