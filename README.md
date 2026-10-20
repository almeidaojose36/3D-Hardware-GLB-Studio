# Classroom 3D PC Hardware CAD & GLB Studio

A browser studio that builds nine PC hardware models procedurally (case fan, case, CPU cooler, CPU,
motherboard, RAM, PSU, hard drive, DVD drive), shows them with photo-studio lighting, exploded views and
training callouts, and exports each one as a `.glb` file. It can also turn a photo into a 3D model
with an AI image-to-3D service, or import any `.glb`.

## Running the studio

**Built-in models only:** open `3d_hardware_glb_studio_procedural_builder.html` in a browser.

**With Image → 3D:** the AI generators need a small local server, which keeps your API key private
(the providers also refuse direct requests from web pages). It needs [Node.js](https://nodejs.org) 18
or newer and installs nothing.

1. Copy `.env.example` to `.env` and add a key (see below).
2. In this folder run `node studio-server.mjs`.
3. Open <http://localhost:8787>.

## Image → 3D

Click **Image → 3D** in the header, drop or paste a photo, pick a generator and press **Generate**.
When the model is ready it appears under **My Library** in the sidebar. From there you can inspect it,
edit its materials and export it like the built-in models. Library models are stored in your browser
(IndexedDB) and stay there after reloads; remove one with its ✕ button.

| Generator | `.env` setting | Notes |
| --- | --- | --- |
| Meshy Image-to-3D | `MESHY_API_KEY` | Textured PBR models, usually 1–4 minutes. Paid per generation. |
| Stability AI Stable Fast 3D | `STABILITY_API_KEY` | Fast reconstruction, usually under 30 seconds. Paid per generation. |

To try the workflow without paying, set `MESHY_API_KEY=msy_dummy_api_key_for_test_mode_12345678`.
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
