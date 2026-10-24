# Third party notices

AstraGit's Git library, command storage primitives, shared contracts, and Codex
adapter were extracted from Zeus on 2026-10-09, under Apache-2.0. Their package
scope, application identity, and composition have been adapted for AstraGit.
See `LICENSE`. These are local source files; no Zeus checkout is required.

## Git Flow AVH 1.12.3

Source: https://github.com/petervanderdoes/gitflow-avh/tree/1.12.3

The readable shell sources are included in `vendor/git-flow-avh` and distributed
as `Contents/Resources/git-flow-avh` in the macOS application. The complete
upstream `LICENSE` is included there, covering the BSD licenses of Peter van der
Does and Vincent Driessen and the LGPL-2.1 license of gitflow-shFlags. Original
copyright and license headers are retained in every source file.

AstraGit's 2026-10-23 adaptation pins the feature-finish recursive rebase call
to the bundled launcher. The source location, upstream archive checksum,
upstream file checksums, shipped file checksums and adaptation are recorded
in `manifest.json`. The distributed scripts remain directly readable and
replaceable. No binary-only copy of this tool is distributed.

The JSON snapshots in `packages/ai-runtime/src/catalogs` and thinking-level
selection in `catalogModel.ts` are derived from `@earendil-works/pi-ai` 0.87.1.
Only the model fields used by AstraGit are retained. These snapshots describe
catalog capabilities; they are not live provider availability checks.

Source: https://github.com/earendil-works/pi/tree/v0.87.1/packages/ai

## MIT License — pi-ai

Copyright (c) 2025 Mario Zechner

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
